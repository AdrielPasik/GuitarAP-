import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { autoRecoveryEnabled } from '@/core/flags';
import { authenticated, identityMode as modeOf, readIdentity, resolveVisible, signedOutExplicitly, trustsSession, watchVisible, type Visible } from '@/data/identity';
import { listDrafts } from '@/data/drafts';
import { libraryScope } from '@/data/library-scope';
import { dirtyEditors, flushAllPendingSaves, subscribeDirty } from '@/data/pending-saves';
import { describeBackup, downloadBackup } from '@/features/backup/backup-download';
import { AccountContext, emptyBackup, type Account, type BackupFlow, type Dialog, type LocalDataView, type RecoveryView } from '@/features/account/account-context';
import type { RecoveryRecord } from '@/features/account/account-data';
import { describeStatus } from '@/features/account/account-status';
import { explainSyncError, type Explained, type SyncDiagnostic } from '@/features/sync/diagnostic';
import { explainHalt } from '@/features/sync/event-policy';
import { SyncTransportError } from '@/features/sync/transport';
import { readFacts, updateFacts, type SyncFacts } from '@/features/sync/sync-facts';
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
/** Two automatic attempts are never closer than this (a tab coming back to the front is not a reason to ask again at once). */
const MIN_GAP = 20_000;
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
  const recoveryDone = useRef(true); // false only while the first download of this account on this device is outstanding
  const [failure, setFailure] = useState<{ kind: string; status?: number }>();
  const [updateNeeded, setUpdateNeeded] = useState(false);
  // What the server has confirmed, written by whichever tab last talked to it and read by all of them.
  const ownerId = session?.user.id;
  const facts = useLiveQuery(async () => (ownerId ? readFacts(ownerId) : undefined), [ownerId]);
  const factsRef = useRef<SyncFacts | undefined>(undefined);
  factsRef.current = facts;
  const draftCount = useLiveQuery(async () => (ownerId ? (await listDrafts(await libraryScope())).length : 0), [ownerId]) ?? 0;
  const typing = useSyncExternalStore(subscribeDirty, dirtyEditors);
  const unsaved = Math.max(draftCount, typing);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [backup, setBackup] = useState<BackupFlow>(emptyBackup);
  const running = useRef(false);
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

  const attempt = useCallback(async (manual: boolean): Promise<boolean> => {
    const current = sessionRef.current;
    if (!config || !current || !linked || running.current) return false;
    // An automatic attempt keeps to the wait the last failure asked for; a person pressing a button does not.
    const due = factsRef.current?.nextAttemptAt;
    if (!manual && due && due > Date.now()) return false;
    const attemptOwner = current.user.id;
    const stillTheSamePerson = () => sessionRef.current?.user.id === attemptOwner;
    running.current = true;
    setPhase('syncing');
    setMessage('');
    const recovering = autoRecoveryEnabled() && !recoveryDone.current;
    if (recovering) setRecovery((now) => (now.phase === 'recovering' ? now : { phase: 'recovering', pulled: 0, pages: 0 }));
    const waiting = (reason: 'offline' | 'error' | 'halted') => {
      if (!recovering) return;
      setRecovery({ phase: 'waiting', reason });
    };
    try {
      const fresh = await restoreSession(config);
      if (!fresh) {
        // The session ended by itself (a refused renewal): the library stays, sync waits for a valid session.
        await updateFacts(attemptOwner, (f) => ({ ...f, lastAttemptAt: Date.now(), lastAttemptOk: false, lastError: { at: Date.now(), kind: 'session', retryable: false }, nextAttemptAt: null })).catch(() => undefined);
        if (stillTheSamePerson()) {
          setSession(null);
          setPhase('idle');
          setMessage('Tu sesión venció. Iniciá sesión de nuevo para seguir sincronizando.');
        }
        return false;
      }
      if (fresh.accessToken !== current.accessToken) setSession(fresh);
      const data = await lazyData();
      const result = await data.runSync(config, fresh, recovering ? { onProgress: (progress) => stillTheSamePerson() && setRecovery({ phase: 'recovering', pulled: progress.pulled, pages: progress.pages }) } : {});
      if (!result) {
        // Another tab is talking to the server for this account right now: nothing to do here, its facts will arrive.
        setPhase('idle');
        return false;
      }
      // Whatever came back belongs to the person who started it: if somebody else is on screen now, none of it is theirs.
      if (!stillTheSamePerson()) return false;
      setFailure(result.report.failure ? { kind: result.report.failure.kind, status: result.report.failure.status } : undefined);
      setUpdateNeeded(Boolean(result.report.halted));
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
        setRecovery(result.recovery.seen ? { phase: 'idle' } : viewOf(result.recovery));
      }
      setPhase('idle');
      setLastSyncAt(result.lastSyncAt);
      return result.skipped === 0;
    } catch (error) {
      if (!stillTheSamePerson()) return false;
      setPhase('error');
      waiting('error');
      // A refused session (401) is not retried by itself (the facts say so); the person decides: «Sincronizar ahora» renews the session first.
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
  const syncNow = useCallback(() => attempt(true), [attempt]);
  const autoAttempt = useCallback(() => attempt(false), [attempt]);

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

  // Automatic sync. ONE scheduler for everything: a failed attempt writes when the next one is due (a growing wait with
  // jitter, see sync/retry-policy.ts) into the shared facts; every tab reads that, nothing retries on its own clock.
  const signedIn = Boolean(session);
  const nextAt = facts?.nextAttemptAt ?? null;
  const lastAttemptAt = facts?.lastAttemptAt ?? 0;
  const lastAttemptRef = useRef(0);
  lastAttemptRef.current = lastAttemptAt;
  const ready = signedIn && linked && autoSync && autoSyncReady;
  useEffect(() => {
    if (!ready || !online) return;
    void autoAttempt();
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void autoAttempt();
    }, POLL_INTERVAL);
    // Coming back to the front, or back from a suspension (a phone, a sleeping laptop): one attempt, if enough time has passed.
    const resume = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastAttemptRef.current > MIN_GAP) void autoAttempt();
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pageshow', resume);
    return () => {
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('pageshow', resume);
    };
  }, [autoAttempt, online, ready]);

  // The connection came back: if an attempt was waiting out a failure, it is due now (with a little spread, not a burst).
  useEffect(() => {
    if (!ready || !online || !ownerId || nextAt === null) return;
    void updateFacts(ownerId, (f) => (f.nextAttemptAt && f.nextAttemptAt > Date.now() + 3_000 ? { ...f, nextAttemptAt: Date.now() + Math.round(Math.random() * 2_000) } : f)).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  // The scheduled retry itself.
  useEffect(() => {
    if (!ready || !online || nextAt === null) return;
    const timer = window.setTimeout(() => {
      if (document.visibilityState === 'visible') void autoAttempt();
    }, Math.max(0, nextAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [autoAttempt, nextAt, online, ready]);

  // Shortly after local changes, unless a failure asked for a longer wait.
  useEffect(() => {
    if (!ready || !online || pending === 0 || phase === 'syncing') return;
    if (nextAt !== null && nextAt > Date.now()) return;
    const timer = window.setTimeout(() => void autoAttempt(), AUTO_SYNC_DELAY);
    return () => window.clearTimeout(timer);
  }, [autoAttempt, nextAt, online, pending, phase, ready]);

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
  // What another tab (or an earlier run) already proved is as true here as in the tab that did it: the shared facts fill
  // in for a tab that has not tried anything itself, so two tabs never show two different stories.
  const lastError = facts?.lastError;
  const lastFailed = facts?.lastAttemptOk === false && lastError !== undefined;
  const sharedPassing = lastFailed && lastError.retryable && lastError.kind !== 'update' && lastError.kind !== 'session';
  const sharedUpdate = lastFailed && lastError.kind === 'update';
  const sharedBlocked = lastFailed && !lastError.retryable && lastError.kind !== 'update' && lastError.kind !== 'session';
  const own = phase === 'offline' ? failure : undefined;
  const sharedExplained = sharedBlocked ? explainSyncError({ operation: 'pull', rpc: 'pull_library', kind: lastError.kind as never, status: lastError.status, code: lastError.code }, undefined) : undefined;
  const status = describeStatus({
    signedIn,
    expired: mode === 'expired',
    linked,
    online,
    syncing: phase === 'syncing' && recovery.phase !== 'recovering',
    updateNeeded: updateNeeded || sharedUpdate,
    failure: own ?? (sharedPassing ? { kind: lastError.kind, status: lastError.status } : undefined),
    retryInMs: nextAt !== null ? Math.max(0, nextAt - Date.now()) : undefined,
    lastConfirmedAt: facts?.lastConfirmedAt,
    unsaved,
    recovering: recovery.phase === 'recovering' ? { pulled: recovery.pulled } : undefined,
    recoveryPending: recovery.phase === 'waiting',
    failed: phase === 'error' || sharedBlocked,
    offlineReport: phase === 'offline' || sharedPassing,
    pending,
    conflicts,
    skipped,
    confirmed: facts?.lastConfirmedAt !== undefined,
    errorLabel: problem?.headline ?? sharedExplained?.headline,
    errorDetail: problem?.explanation ?? sharedExplained?.explanation,
  });

  const value: Account = {
    configured: Boolean(config),
    restoring,
    session,
    email: session?.user.email,
    identityMode: mode,
    linked,
    status,
    facts,
    probeConnection: async () => {
      const current = sessionRef.current;
      if (!config || !current) return undefined;
      return (await lazyData()).probeConnection(config, current.user.id);
    },
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
