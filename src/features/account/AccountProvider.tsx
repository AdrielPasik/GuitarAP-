import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { authenticated, identityMode as modeOf, readIdentity, resolveVisible, signedOutExplicitly, trustsSession, watchVisible, type Visible } from '@/data/identity';
import { flushAllPendingSaves } from '@/data/pending-saves';
import { describeBackup, downloadBackup } from '@/features/backup/backup-download';
import { AccountContext, emptyBackup, type Account, type BackupFlow, type Dialog } from '@/features/account/account-context';
import { describeStatus } from '@/features/account/account-status';
import { explainSyncError, type Explained, type SyncDiagnostic } from '@/features/sync/diagnostic';
import { explainHalt } from '@/features/sync/event-policy';
import { SyncTransportError } from '@/features/sync/transport';
import {
  AuthError,
  configuredSupabase,
  isValidated,
  restoreSession,
  signIn as signInRequest,
  signOut as signOutRequest,
  type SupabaseSession,
} from '@/features/sync/supabase-auth';

type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error';

const lazyData = () => import('@/features/account/account-data');
const AUTO_SYNC_DELAY = 8_000;
const POLL_INTERVAL = 90_000;
const ERROR_COOLDOWN = 60_000;

export function AccountProvider({ children }: { children: ReactNode }) {
  const config = useMemo(() => configuredSupabase(), []);
  const [session, setSession] = useState<SupabaseSession | null>(null);
  const [restoring, setRestoring] = useState(Boolean(config));
  const [linked, setLinked] = useState(false);
  const [phase, setPhase] = useState<SyncPhase>('idle');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(0);
  const [conflicts, setConflicts] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<number>();
  const [diagnostic, setDiagnostic] = useState<SyncDiagnostic>();
  const [problem, setProblem] = useState<Explained>();
  const [skipped, setSkipped] = useState(0);
  const [autoSync, setAutoSyncState] = useState(true);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [visible, setVisible] = useState<Visible>();
  const [signedOutFlag, setSignedOutFlag] = useState(false);
  const adopting = useRef(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [backup, setBackup] = useState<BackupFlow>(emptyBackup);
  const running = useRef(false);
  const lastError = useRef(0);
  const sessionRef = useRef<SupabaseSession | null>(null);
  sessionRef.current = session;

  const adopt = useCallback(async (next: SupabaseSession) => {
    adopting.current = true;
    try {
      // The account service has just accepted this person: from now on THEIR library is the one on screen.
      await authenticated(next.user.id);
      const data = await lazyData();
      const isLinked = await data.isLinked(next.user.id);
      if (isLinked) await data.reactivate(next.user.id);
      setSession(next);
      setLinked(isLinked);
      setLastSyncAt(await data.readLastSync(next.user.id));
      setDiagnostic(await data.readDiagnostic(next.user.id));
      return isLinked;
    } finally {
      adopting.current = false;
    }
  }, []);

  // The visible owner is read from one place and followed live, also when another tab signs in or out.
  useEffect(() => {
    let cancelled = false;
    void readIdentity().then((identity) => !cancelled && setSignedOutFlag(Boolean(identity?.signedOut)));
    const stop = watchVisible((next) => {
      if (cancelled) return;
      setVisible(next);
      void readIdentity().then((identity) => !cancelled && setSignedOutFlag(Boolean(identity?.signedOut)));
      const current = sessionRef.current;
      // Another tab signed out, or signed in as someone else: this tab must not keep working as the previous person.
      if (current && !adopting.current && next.ownerId !== current.user.id) {
        setSession(null);
        setLinked(false);
        setPhase('idle');
      }
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    void (async () => {
      try {
        const stored = await restoreSession(config);
        // A session just renewed by the account service may put its account on screen; one merely read from local
        // storage only if that account is already the profile's own (it cannot be edited into someone else's library).
        const current = stored && (isValidated(stored) || (await trustsSession(stored.user.id))) ? stored : null;
        if (current && !cancelled) await adopt(current);
        else if (!current && !cancelled) {
          // No session. A profile that predates v0.8 has no record of whether the person signed out or simply
          // expired: its library is hidden until they sign in (nothing is deleted). Otherwise the record decides.
          const now = await resolveVisible();
          if (now.legacy && now.ownerId) await signedOutExplicitly();
        }
        const data = await lazyData();
        if (!cancelled) setAutoSyncState(await data.readAutoSync());
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adopt, config]);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  const syncNow = useCallback(async (): Promise<boolean> => {
    const current = sessionRef.current;
    if (!config || !current || !linked || running.current) return false;
    running.current = true;
    setPhase('syncing');
    setMessage('');
    try {
      const fresh = await restoreSession(config);
      if (!fresh) {
        setSession(null);
        setPhase('idle');
        setMessage('Tu sesión venció. Iniciá sesión de nuevo para seguir sincronizando.');
        return false;
      }
      if (fresh.accessToken !== current.accessToken) setSession(fresh);
      const data = await lazyData();
      const result = await data.runSync(config, fresh);
      setConflicts(result.conflicts);
      setSkipped(result.skipped);
      setDiagnostic(result.diagnostic);
      const halted = result.report.halted;
      setProblem(halted ? explainHalt(halted) : undefined);
      if (halted) setMessage(explainHalt(halted).explanation);
      const copies = result.report.copies;
      if (copies.length)
        setMessage(`Se editó ${copies.length === 1 ? 'un material' : `${copies.length} materiales`} en dos dispositivos. Se conservó la versión del servidor y la tuya quedó guardada como «${copies[0].title}»${copies.length > 1 ? ' (y otras copias)' : ''}. No se perdió nada: compará y quedate con lo que prefieras.`);
      if (result.report.offline) {
        setPhase('offline');
        return false;
      }
      if (halted) {
        // Never say "everything is synced" while the download is stopped at an event this version cannot read.
        setPhase('error');
        return false;
      }
      setPhase('idle');
      setLastSyncAt(result.lastSyncAt);
      return result.skipped === 0;
    } catch (error) {
      lastError.current = Date.now();
      setPhase('error');
      if (error instanceof AuthError) {
        setProblem(undefined);
        setMessage(error.message);
      } else {
        // The real cause, in words: never one generic sentence for every failure.
        const data = await lazyData();
        const saved = await data.readDiagnostic(current.user.id).catch(() => undefined);
        setDiagnostic(saved);
        const explained = explainSyncError(error instanceof SyncTransportError ? error.detail : undefined, saved?.server);
        setProblem(explained);
        setMessage(explained.explanation);
      }
      return false;
    } finally {
      running.current = false;
    }
  }, [config, linked]);

  const probeServer = useCallback(async () => {
    const current = sessionRef.current;
    if (!config || !current) return;
    const data = await lazyData();
    await data.probeServer(config, current);
    setDiagnostic(await data.readDiagnostic(current.user.id));
  }, [config]);

  // Track unsynced local changes so the status is always truthful.
  useEffect(() => {
    if (!session || !linked) {
      setPending(0);
      setConflicts(0);
      return;
    }
    let stop: () => void = () => undefined;
    let cancelled = false;
    void lazyData().then((data) => {
      if (cancelled) return;
      stop = data.watchPending(session.user.id, (value) => {
        setPending(value.pending);
        setConflicts(value.conflicts);
      });
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [linked, session]);

  // Automatic sync: on start, when the connection returns, periodically, and shortly after edits.
  const signedIn = Boolean(session);
  useEffect(() => {
    if (!signedIn || !linked || !autoSync || !online) return;
    void syncNow();
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void syncNow();
    }, POLL_INTERVAL);
    const visible = () => {
      if (document.visibilityState === 'visible') void syncNow();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [autoSync, linked, online, signedIn, syncNow]);

  useEffect(() => {
    if (!signedIn || !linked || !autoSync || !online || pending === 0 || phase === 'syncing') return;
    const wait = Math.max(AUTO_SYNC_DELAY, ERROR_COOLDOWN - (Date.now() - lastError.current));
    const timer = window.setTimeout(() => void syncNow(), phase === 'error' ? wait : AUTO_SYNC_DELAY);
    return () => window.clearTimeout(timer);
  }, [autoSync, linked, online, pending, phase, signedIn, syncNow]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!config) throw new AuthError('Esta versión de GuitarAP todavía no tiene la nube configurada.', 'service');
      await flushAllPendingSaves(); // the previous person's last edits are saved while they are still the owner
      const next = await signInRequest(config, email.trim(), password);
      const isLinked = await adopt(next);
      setPhase('idle');
      setMessage('');
      setDialog(isLinked ? null : 'protect');
    },
    [adopt, config],
  );

  const signOutNow = useCallback(() => {
    // Signing out only stops syncing: nothing of yours is hidden or deleted from this device. Copies of OTHER
    // people's songs that you were only reading are dropped (they are not yours to keep on a shared computer);
    // anything you wrote there and had not uploaded stays, and only your own account can ever reopen it.
    void import('@/data/database').then(({ db }) => db.shared.filter((copy) => !copy.dirty).delete()).catch(() => undefined);
    signOutRequest();
    setSession(null);
    setLinked(false);
    setPhase('idle');
    setMessage('');
    setBackup(emptyBackup);
  }, []);

  const signOut = useCallback(() => {
    void (async () => {
      // 1. save what is being typed while the person is still authorised, 2. hide their library everywhere, 3. end the session.
      await flushAllPendingSaves();
      await signedOutExplicitly();
    })().finally(() => signOutNow());
  }, [signOutNow]);


  const prepareBackup = useCallback(async () => {
    setBackup({ ...emptyBackup, busy: true });
    try {
      const data = await lazyData();
      const summary = downloadBackup(await data.exportLibraryBackup());
      setBackup({ ...emptyBackup, summary, summaryText: describeBackup(summary) });
    } catch (error) {
      setBackup({
        ...emptyBackup,
        error: error instanceof Error ? error.message : 'No se pudo preparar la copia. Tus datos locales no fueron modificados.',
      });
    }
  }, []);

  const linkLibrary = useCallback(async () => {
    if (!session || !backup.summary || !backup.confirmed) return;
    setBackup((value) => ({ ...value, busy: true, error: '' }));
    try {
      const data = await lazyData();
      await data.linkLibrary(session.user.id);
      setLinked(true);
      setBackup(emptyBackup);
      setDialog(null);
    } catch (error) {
      setBackup((value) => ({
        ...value,
        busy: false,
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo vincular la biblioteca. La copia y tus documentos locales siguen intactos.',
      }));
    }
  }, [backup.confirmed, backup.summary, session]);

  const mode = modeOf(visible ?? { ownerId: null, epoch: 0, legacy: false }, signedIn, signedOutFlag);
  const status = describeStatus({
    signedIn,
    expired: mode === 'expired',
    linked,
    online,
    syncing: phase === 'syncing',
    failed: phase === 'error',
    offlineReport: phase === 'offline',
    pending,
    conflicts,
    skipped,
    confirmed: lastSyncAt !== undefined,
    errorLabel: problem?.headline,
    errorDetail: problem?.explanation,
  });

  const value: Account = {
    configured: Boolean(config),
    restoring,
    session,
    email: session?.user.email,
    identityMode: mode,
    linked,
    status,
    lastSyncAt,
    message,
    pendingCount: pending,
    conflictCount: conflicts,
    autoSync,
    setAutoSync: (enabled) => {
      setAutoSyncState(enabled);
      void lazyData().then((data) => data.writeAutoSync(enabled));
    },
    dialog,
    openDialog: setDialog,
    closeDialog: () => setDialog(null),
    signIn,
    signOut,
    syncNow,
    syncDiagnostic: diagnostic,
    syncProblem: problem,
    probeServer,
    backup,
    prepareBackup,
    setBackupConfirmed: (confirmed) => setBackup((current) => ({ ...current, confirmed })),
    linkLibrary,
  };
  return <AccountContext value={value}>{children}</AccountContext>;
}
