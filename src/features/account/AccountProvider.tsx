import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { describeBackup, downloadBackup } from '@/features/backup/backup-download';
import { AccountContext, emptyBackup, type Account, type BackupFlow, type Dialog } from '@/features/account/account-context';
import { describeStatus } from '@/features/account/account-status';
import {
  AuthError,
  configuredSupabase,
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
  const [autoSync, setAutoSyncState] = useState(true);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [backup, setBackup] = useState<BackupFlow>(emptyBackup);
  const running = useRef(false);
  const lastError = useRef(0);
  const sessionRef = useRef<SupabaseSession | null>(null);
  sessionRef.current = session;

  const adopt = useCallback(async (next: SupabaseSession) => {
    const data = await lazyData();
    const isLinked = await data.isLinked(next.user.id);
    if (isLinked) await data.reactivate(next.user.id);
    setSession(next);
    setLinked(isLinked);
    setLastSyncAt(await data.readLastSync(next.user.id));
    return isLinked;
  }, []);

  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    void (async () => {
      try {
        const current = await restoreSession(config);
        if (current && !cancelled) await adopt(current);
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

  const syncNow = useCallback(async () => {
    const current = sessionRef.current;
    if (!config || !current || !linked || running.current) return;
    running.current = true;
    setPhase('syncing');
    setMessage('');
    try {
      const fresh = await restoreSession(config);
      if (!fresh) {
        setSession(null);
        setPhase('idle');
        setMessage('Tu sesión venció. Iniciá sesión de nuevo para seguir sincronizando.');
        return;
      }
      if (fresh.accessToken !== current.accessToken) setSession(fresh);
      const data = await lazyData();
      const result = await data.runSync(config, fresh);
      setConflicts(result.conflicts);
      if (result.report.offline) setPhase('offline');
      else {
        setPhase('idle');
        setLastSyncAt(result.lastSyncAt);
      }
    } catch (error) {
      lastError.current = Date.now();
      setPhase('error');
      setMessage(
        error instanceof Error && !(error instanceof AuthError)
          ? 'No pudimos completar la sincronización. Tus cambios siguen guardados en este dispositivo.'
          : error instanceof Error
            ? error.message
            : 'No pudimos sincronizar.',
      );
    } finally {
      running.current = false;
    }
  }, [config, linked]);

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
      const next = await signInRequest(config, email.trim(), password);
      const isLinked = await adopt(next);
      setPhase('idle');
      setMessage('');
      setDialog(isLinked ? null : 'protect');
    },
    [adopt, config],
  );

  const signOut = useCallback(() => {
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

  const status = describeStatus({
    signedIn,
    linked,
    online,
    syncing: phase === 'syncing',
    failed: phase === 'error',
    offlineReport: phase === 'offline',
    pending,
    conflicts,
  });

  const value: Account = {
    configured: Boolean(config),
    restoring,
    session,
    email: session?.user.email,
    linked,
    status,
    lastSyncAt,
    message,
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
    backup,
    prepareBackup,
    setBackupConfirmed: (confirmed) => setBackup((current) => ({ ...current, confirmed })),
    linkLibrary,
  };
  return <AccountContext value={value}>{children}</AccountContext>;
}
