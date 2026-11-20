import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { autoRecoveryEnabled } from '@/core/flags';
import { authenticated, identityMode as modeOf, readIdentity, resolveVisible, signedOutExplicitly, trustsSession, watchVisible, type Visible } from '@/data/identity';
import { flushAllPendingSaves } from '@/data/pending-saves';
import { describeBackup, downloadBackup } from '@/features/backup/backup-download';
import { AccountContext, emptyBackup, type Account, type BackupFlow, type Dialog, type LocalDataView, type RecoveryView } from '@/features/account/account-context';
import type { RecoveryRecord } from '@/features/account/account-data';
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
/** The first download retries on its own with a growing wait (5 s, 10 s, 20 s... up to 5 min). */
const recoveryDelay = (attempts: number) => Math.min(5_000 * 2 ** Math.max(0, attempts - 1), 300_000);
const viewOf = (record: RecoveryRecord): RecoveryView => ({
  phase: 'done',
  counts: record.check.counts,
  empty: record.remoteEmpty,
  issues: record.check.missing.nodes.length + record.check.missing.documents.length + record.check.missing.versions.length + record.check.deferred + record.check.quarantined,
  seen: record.seen,
});

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
  // The person's choice about automatic sync is read BEFORE anything runs by itself (otherwise a person who turned it off
  // would still get one sync at every start, while the choice is being read).
  const [autoSyncReady, setAutoSyncReady] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [visible, setVisible] = useState<Visible>();
  const [signedOutFlag, setSignedOutFlag] = useState(false);
  const adopting = useRef(false);
  const [recovery, setRecovery] = useState<RecoveryView>({ phase: 'idle' });
  const [localData, setLocalData] = useState<LocalDataView | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const recoveryDone = useRef(true); // false only while the first download of this account on this device is outstanding
  const recoveryAttempts = useRef(0);
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
      const flag = autoRecoveryEnabled();
      let isLinked = await data.isLinked(next.user.id);
      // v0.8 (flag): a device with nothing of this account links itself, silently and without claiming anything.
      if (flag && !isLinked) {
        await data.linkAutomatically(next.user.id);
        isLinked = true;
      }
      if (isLinked) await data.reactivate(next.user.id);
      if (flag) {
        const record = await data.readRecovery(next.user.id);
        recoveryDone.current = Boolean(record) || (await data.readLastSync(next.user.id)) !== undefined;
        setRecovery(record && !record.seen ? viewOf(record) : { phase: 'idle' });
        setLocalData(await data.readLocalData(next.user.id));
      }
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
        setRecovery({ phase: 'idle' });
        setLocalData(null);
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
        if (!cancelled) {
          setAutoSyncReady(true);
          setRestoring(false);
        }
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
    const recovering = autoRecoveryEnabled() && !recoveryDone.current;
    if (recovering) setRecovery((now) => (now.phase === 'recovering' ? now : { phase: 'recovering', pulled: 0, pages: 0 }));
    const waiting = (reason: 'offline' | 'error' | 'halted') => {
      if (!recovering) return;
      recoveryAttempts.current += 1;
      setRecovery({ phase: 'waiting', reason });
      setRetryTick((tick) => tick + 1);
    };
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
      const result = await data.runSync(config, fresh, recovering ? { onProgress: (progress) => setRecovery({ phase: 'recovering', pulled: progress.pulled, pages: progress.pages }) } : {});
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
        waiting('offline');
        return false;
      }
      if (halted) {
        // Never say "everything is synced" while the download is stopped at an event this version cannot read.
        setPhase('error');
        waiting('halted');
        return false;
      }
      if (recovering && result.recovery) {
        recoveryDone.current = true;
        recoveryAttempts.current = 0;
        setRecovery(result.recovery.seen ? { phase: 'idle' } : viewOf(result.recovery));
      }
      setPhase('idle');
      setLastSyncAt(result.lastSyncAt);
      return result.skipped === 0;
    } catch (error) {
      lastError.current = Date.now();
      setPhase('error');
      waiting('error');
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

  // The first download keeps trying by itself, with a growing wait, until the library is confirmed complete.
  useEffect(() => {
    if (recovery.phase !== 'waiting' || !session || !linked || !online || !autoSync) return;
    const timer = window.setTimeout(() => void syncNow(), recoveryDelay(recoveryAttempts.current));
    return () => window.clearTimeout(timer);
  }, [autoSync, linked, online, recovery.phase, retryTick, session, syncNow]);

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
    if (!signedIn || !linked || !autoSync || !autoSyncReady || !online) return;
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
  }, [autoSync, autoSyncReady, linked, online, signedIn, syncNow]);

  useEffect(() => {
    if (!signedIn || !linked || !autoSync || !autoSyncReady || !online || pending === 0 || phase === 'syncing') return;
    const wait = Math.max(AUTO_SYNC_DELAY, ERROR_COOLDOWN - (Date.now() - lastError.current));
    const timer = window.setTimeout(() => void syncNow(), phase === 'error' ? wait : AUTO_SYNC_DELAY);
    return () => window.clearTimeout(timer);
  }, [autoSync, autoSyncReady, linked, online, pending, phase, signedIn, syncNow]);

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
    setRecovery({ phase: 'idle' });
    setLocalData(null);
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
    syncing: phase === 'syncing' && recovery.phase !== 'recovering',
    recovering: recovery.phase === 'recovering' ? { pulled: recovery.pulled } : undefined,
    recoveryPending: recovery.phase === 'waiting',
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
    autoRecovery: autoRecoveryEnabled(),
    recovery,
    dismissRecovery: () => {
      setRecovery({ phase: 'idle' });
      const owner = sessionRef.current?.user.id;
      if (owner) void lazyData().then((data) => data.dismissRecovery(owner));
    },
    rebuildFromCloud: async (mode) => {
      const current = sessionRef.current;
      if (!config || !current || !autoRecoveryEnabled()) return undefined;
      // A sync that is already running finishes first (two runs at once could not tell what each one did).
      for (let waited = 0; running.current && waited < 150; waited += 1) await new Promise((resolve) => window.setTimeout(resolve, 200));
      if (running.current) return undefined;
      running.current = true;
      setPhase('syncing');
      const downloadOnly = mode === 'download';
      setRecovery({ phase: 'recovering', pulled: 0, pages: 0, step: downloadOnly ? 'pull' : 'push', downloadOnly });
      try {
        const fresh = (await restoreSession(config)) ?? current;
        const data = await lazyData();
        const result = await data.rebuildFromCloud(config, fresh, {
          downloadOnly,
          onProgress: (progress) => setRecovery({ phase: 'recovering', pulled: progress.pulled, pages: progress.pages, step: progress.phase, downloadOnly }),
        });
        if (result.recovery) {
          recoveryDone.current = true;
          setRecovery(viewOf(result.recovery));
          setLastSyncAt(Date.now());
          setPhase('idle');
          return { refetched: result.report.refetched, held: result.report.held, pushed: result.report.pushed };
        }
        setPhase(result.report.offline ? 'offline' : 'error');
        setRecovery({ phase: 'waiting', reason: result.report.offline ? 'offline' : 'halted' });
        return undefined;
      } catch (error) {
        setPhase('error');
        setRecovery({ phase: 'waiting', reason: 'error' });
        setMessage(error instanceof Error ? error.message : 'No se pudo reconstruir desde la nube.');
        return undefined;
      } finally {
        running.current = false;
      }
    },
    localData,
    adoptLocalData: async () => {
      const owner = sessionRef.current?.user.id;
      if (!owner) return;
      const data = await lazyData();
      await data.adoptLocalData(owner);
      setLocalData(null);
      void syncNow();
    },
    keepLocalData: async () => {
      const owner = sessionRef.current?.user.id;
      if (!owner) return;
      await (await lazyData()).keepLocalData(owner);
      setLocalData((now) => (now ? { ...now, decided: true } : now));
    },
    backupLocalData: async () => {
      const data = await lazyData();
      downloadBackup(await data.exportLocalDataBackup());
    },
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
