import { liveQuery } from 'dexie';
import { db } from '@/data/database';
import { libraryRepository } from '@/data/library-repository';
import { activateOwner, anonymousRecords, claimAnonymous, linkWithoutClaiming } from '@/data/library-scope';
import { countConflicts, countDeferred, countPending, countQuarantined, failureOf, planPush, readCursor, readHalt, SyncEngine, syncSummary, verifyLibrary, type LibraryCheck, type SyncOptions, type SyncReport } from '@/features/sync/engine';
import { describeProbe, probeConnectivity } from '@/features/sync/connectivity';
import { decideRetry } from '@/features/sync/retry-policy';
import { readFacts, readHistory, recordAttempt, updateFacts, type AttemptOperation, type AttemptResult } from '@/features/sync/sync-facts';
import { probeSyncServer, type SyncDiagnostic } from '@/features/sync/diagnostic';
import { autoRecoveryEnabled } from '@/core/flags';
import { SupabaseTransport, SyncTransportError } from '@/features/sync/transport';
import type { SupabaseConfig, SupabaseSession } from '@/features/sync/supabase-auth';

/**
 * Everything the account UI needs from the local database and the sync engine. It lives in
 * its own module so the heavy parts load only when someone is signed in or opens a backup.
 */
const backupKey = (userId: string) => `sync-backup-confirmed:${userId}`;
const lastSyncKey = (userId: string) => `sync-last:${userId}`;
const autoSyncKey = 'account-auto-sync';

const autoLinkKey = (userId: string) => `sync-link:${userId}`;
export async function isLinked(userId: string) {
  return Boolean((await db.settings.get(backupKey(userId)))?.value) || Boolean((await db.settings.get(autoLinkKey(userId)))?.value);
}

/**
 * v0.8 (behind the autoRecovery flag): signing in links this device to the account by itself, with no backup step and
 * without claiming anything the device holds that has no owner (that is the person's decision, see below).
 */
export async function linkAutomatically(userId: string) {
  await linkWithoutClaiming(userId);
  await db.settings.put({ key: autoLinkKey(userId), value: { at: Date.now() }, updatedAt: Date.now() });
}

/* ---- Recovery: did this device ever receive the whole account, and what exactly did it get? ---- */
export type RecoveryRecord = { at: number; check: LibraryCheck; seen: boolean; remoteEmpty: boolean };
const recoveryKey = (userId: string) => `recovered:${userId}`;
export async function readRecovery(userId: string) {
  return (await db.settings.get(recoveryKey(userId)))?.value as RecoveryRecord | undefined;
}
export async function dismissRecovery(userId: string) {
  const current = await readRecovery(userId);
  if (current) await db.settings.put({ key: recoveryKey(userId), value: { ...current, seen: true }, updatedAt: Date.now() });
}
/** Verifies what the download left in the library and records it. Never trusts "no error" as "everything arrived". */
async function recordRecovery(userId: string, pulled: number, quiet: boolean): Promise<RecoveryRecord> {
  const check = await verifyLibrary(userId);
  const empty = !check.counts.folders && !check.counts.songs && !check.counts.documents && !check.counts.trashed && !check.counts.versions;
  const record: RecoveryRecord = { at: Date.now(), check, seen: quiet, remoteEmpty: empty && pulled === 0 };
  await db.settings.put({ key: recoveryKey(userId), value: record, updatedAt: record.at });
  return record;
}

/* ---- What the device holds that belongs to nobody: shown, never adopted without a decision ---- */
const localDataKey = (userId: string) => `local-data:${userId}`;
export async function readLocalData(userId: string) {
  const [summary, decision] = await Promise.all([anonymousRecords(), db.settings.get(localDataKey(userId))]);
  if (!summary.documents.length && !summary.nodes) return null;
  return { nodes: summary.nodes, documents: summary.documents, decided: decision?.value === 'keep' };
}
export async function adoptLocalData(userId: string) {
  await claimAnonymous(userId);
  await db.settings.delete(localDataKey(userId));
}
export async function keepLocalData(userId: string) {
  await db.settings.put({ key: localDataKey(userId), value: 'keep', updatedAt: Date.now() });
}
export async function exportLocalDataBackup() {
  return libraryRepository.exportBackup({ anonymous: true });
}

/** Re-attaches the local library to the account after signing in again. */
export async function reactivate(userId: string) {
  await activateOwner(userId);
}

/** Only called after the person downloaded a verified backup and confirmed it. */
export async function linkLibrary(userId: string) {
  await activateOwner(userId);
  await db.settings.put({ key: backupKey(userId), value: true, updatedAt: Date.now() });
}

export async function readLastSync(userId: string) {
  return (await db.settings.get(lastSyncKey(userId)))?.value as number | undefined;
}

export async function readAutoSync() {
  const value = (await db.settings.get(autoSyncKey))?.value;
  return value === undefined ? true : Boolean(value);
}

export async function writeAutoSync(enabled: boolean) {
  await db.settings.put({ key: autoSyncKey, value: enabled, updatedAt: Date.now() });
}

export async function exportLibraryBackup() {
  return libraryRepository.exportBackup();
}

const diagnosticKey = (userId: string) => `sync-diagnostic:${userId}`;
export async function readDiagnostic(userId: string) {
  return (await db.settings.get(diagnosticKey(userId)))?.value as SyncDiagnostic | undefined;
}
async function writeDiagnostic(userId: string, value: SyncDiagnostic) {
  await db.settings.put({ key: diagnosticKey(userId), value, updatedAt: value.at });
}

/** Asks the server (read-only) which version of the sync function it runs and remembers the answer. */
export async function probeServer(config: SupabaseConfig, session: SupabaseSession) {
  const server = await probeSyncServer(config.url, config.anonKey, session.accessToken);
  const previous = await readDiagnostic(session.user.id);
  await writeDiagnostic(session.user.id, { ...(previous ?? { at: Date.now(), ok: false }), server });
  return server;
}

declare global {
  interface Window {
    /** Test hook: how many events one download request asks for (small, to exercise interrupted downloads). */
    __GUITARAP_PULL_PAGE?: number;
  }
}
const makeEngine = (config: SupabaseConfig, session: SupabaseSession) =>
  new SyncEngine(new SupabaseTransport(config.url, config.anonKey, session.accessToken), 2, typeof window !== 'undefined' && window.__GUITARAP_PULL_PAGE ? window.__GUITARAP_PULL_PAGE : 100);

/**
 * One tab at a time talks to the server for an account: the others skip (their screens follow the facts this one writes to
 * the shared local database). Where Web Locks do not exist the run simply goes ahead; the server is idempotent anyway.
 */
async function withSyncLock<T>(owner: string, run: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks?.request) return { ran: true, value: await run() };
  return locks.request(`guitarap-sync:${owner}`, { ifAvailable: true }, async (lock) => (lock ? { ran: true as const, value: await run() } : { ran: false as const }));
}

/**
 * Writes down what an attempt PROVED, and only that. "Confirmed" means a complete round trip that left nothing pending,
 * in conflict, waiting or set aside; anything less is not a confirmation, however well it went.
 */
async function recordRun(owner: string, op: AttemptOperation, started: number, outcome: { report?: SyncReport; error?: unknown }) {
  const finished = Date.now();
  const report = outcome.report;
  const failure = outcome.error !== undefined ? failureOf(outcome.error) : report?.failure;
  const pendingAfter = await countPending(owner).catch(() => 0);
  const conflictsAfter = await countConflicts(owner).catch(() => 0);
  const skipped = report ? report.skipped.nodes.length + report.skipped.documents.length + report.skipped.versions.length : 0;
  const halted = Boolean(report?.halted);
  const ok = Boolean(report) && !report!.offline && !halted && !failure;
  const confirmed = ok && report!.complete && pendingAfter === 0 && skipped === 0 && report!.deferred === 0 && report!.quarantined === 0 && conflictsAfter === 0;
  let nextAttemptAt: number | null = null;
  let willRetry = false;
  let result: AttemptResult = 'ok';
  if (halted) result = 'halted';
  else if (failure) {
    const decision = decideRetry(failure, 1 + ((await readFacts(owner)).failures ?? 0));
    willRetry = decision.retry;
    if (decision.retry) nextAttemptAt = finished + decision.delayMs;
    result = failure.kind === 'rate-limit' ? 'paused' : failure.kind === 'auth' ? 'session' : failure.retryable ? 'offline' : 'failed';
  }
  await updateFacts(owner, (facts) => ({
    ...facts,
    lastAttemptAt: started,
    lastAttemptOk: ok,
    ...(report && report.pushed > 0 && !failure ? { lastPushAt: finished } : {}),
    ...(report?.complete ? { lastPullAt: finished } : {}),
    ...(confirmed ? { lastConfirmedAt: finished } : {}),
    lastError: ok ? undefined : halted ? { at: finished, kind: 'update', retryable: false } : failure ? { at: finished, kind: failure.kind, status: failure.status, code: failure.code, retryable: failure.retryable, retryAfterMs: failure.retryAfterMs } : facts.lastError,
    failures: ok ? 0 : facts.failures + 1,
    nextAttemptAt,
  }));
  await recordAttempt(owner, { at: started, op, result, ms: finished - started, kind: halted ? 'update' : failure?.kind, status: failure?.status, willRetry, pushed: report?.pushed, pulled: report?.pulled });
  return { confirmed, ok };
}

/** The attempt did not finish because another tab holds the account's lock: nothing was tried, nothing is recorded as failed. */
export type SyncRun = Awaited<ReturnType<typeof runSyncInner>>;
export async function runSync(config: SupabaseConfig, session: SupabaseSession, options: SyncOptions = {}): Promise<SyncRun | null> {
  const outcome = await withSyncLock(session.user.id, () => runSyncInner(config, session, options));
  return outcome.ran ? outcome.value : null;
}

async function runSyncInner(config: SupabaseConfig, session: SupabaseSession, options: SyncOptions = {}) {
  const engine = makeEngine(config, session);
  const owner = session.user.id;
  const hadSynced = (await readLastSync(owner)) !== undefined;
  const started = Date.now();
  const op: AttemptOperation = options.downloadOnly ? 'download' : 'sync';
  let report;
  try {
    report = await engine.sync(owner, options);
  } catch (error) {
    const detail = error instanceof SyncTransportError ? error.detail : undefined;
    // A refused push on sync_library may be the known server defect: find out, so the message can say it exactly.
    const server = detail && detail.rpc === 'sync_library' && detail.kind !== 'network' ? await probeSyncServer(config.url, config.anonKey, session.accessToken) : undefined;
    await writeDiagnostic(owner, { at: Date.now(), ok: false, detail, server }).catch(() => undefined);
    await recordRun(owner, op, started, { error }).catch(() => undefined);
    throw error;
  }
  const skipped = { nodes: report.skipped.nodes.length, documents: report.skipped.documents.length, versions: report.skipped.versions.length };
  let lastSyncAt: number | undefined;
  if (!report.offline) {
    lastSyncAt = Date.now();
    await db.settings.put({ key: lastSyncKey(owner), value: lastSyncAt, updatedAt: lastSyncAt });
  }
  const diagnostic: SyncDiagnostic = {
    at: Date.now(),
    ok: !report.offline,
    pushed: report.pushed,
    pulled: report.pulled,
    requests: report.requests,
    skipped,
    copies: report.copies.length,
    halted: report.halted,
    deferred: report.deferred,
    quarantined: report.quarantined,
    server: (await readDiagnostic(owner))?.server,
  };
  await writeDiagnostic(owner, diagnostic).catch(() => undefined);
  const facts = await recordRun(owner, op, started, { report });
  // First complete download on this device: verify it for real and keep the verdict. A device that had synced before
  // the recovery existed gets its record quietly (it has nothing to be told).
  let recovery = autoRecoveryEnabled() ? await readRecovery(owner) : undefined;
  if (autoRecoveryEnabled() && !recovery && report.complete && !report.halted) recovery = await recordRecovery(owner, report.pulled, hadSynced);
  return { report, lastSyncAt, diagnostic, recovery, confirmed: facts.confirmed, skipped: skipped.nodes + skipped.documents + skipped.versions, conflicts: await countConflicts(owner) };
}

/** "Rebuild from the cloud": non-destructive and idempotent (see SyncEngine.rebuildFromCloud). */
export async function rebuildFromCloud(config: SupabaseConfig, session: SupabaseSession, options: SyncOptions = {}) {
  // `options.downloadOnly` decides whether anything may be written to the server: the caller states it explicitly.
  const owner = session.user.id;
  const started = Date.now();
  const op: AttemptOperation = options.downloadOnly ? 'download' : 'upload-and-download';
  let report;
  try {
    report = await makeEngine(config, session).rebuildFromCloud(owner, options);
  } catch (error) {
    await recordRun(owner, op, started, { error }).catch(() => undefined);
    throw error;
  }
  await recordRun(owner, op, started, { report }).catch(() => undefined);
  if (!report.offline && report.complete) {
    const now = Date.now();
    await db.settings.put({ key: lastSyncKey(owner), value: now, updatedAt: now });
    const recovery = await recordRecovery(owner, report.pulled, false);
    return { report, recovery };
  }
  return { report, recovery: undefined };
}

/** "Probar conexión": read-only (see connectivity.ts). Recorded in the history like any other attempt. */
export async function probeConnection(config: SupabaseConfig, owner: string) {
  const probe = await probeConnectivity(config);
  const verdict = describeProbe(probe);
  await recordAttempt(owner, { at: probe.at, op: 'probe', result: verdict.ok ? 'ok' : probe.server === 'timeout' ? 'offline' : 'offline', ms: probe.ms, kind: verdict.ok ? undefined : probe.server === 'timeout' ? 'timeout' : 'network', status: probe.status });
  return { probe, verdict };
}

/** Everything the diagnostic screen shows, as counts and times (and the titles of what is pending, for the person who owns them). */
export async function readOverview(owner: string) {
  const [facts, history, summary, deferred, quarantined, halt, cursor, recovery, plan] = await Promise.all([
    readFacts(owner), readHistory(owner), syncSummary(owner), countDeferred(owner), countQuarantined(owner), readHalt(owner), readCursor(owner), readRecovery(owner), planPush(owner),
  ]);
  return {
    facts,
    history,
    pending: { documents: summary.pendingDocuments, folders: summary.pendingNodes, skipped: summary.skipped, titles: plan.snapshot.documents.slice(0, 10).map((item: { title?: string }) => item.title || 'Sin título'), folderNames: plan.snapshot.nodes.slice(0, 10).map((item: { name: string }) => item.name) },
    conflicts: summary.conflicts,
    deferred,
    quarantined,
    halted: halt ? { kind: halt.kind, v: halt.v } : undefined,
    cursor,
    recoveryComplete: autoRecoveryEnabled() ? Boolean(recovery) : undefined,
  };
}

export function watchPending(userId: string, onChange: (value: { pending: number; conflicts: number }) => void) {
  const subscription = liveQuery(async () => ({
    pending: await countPending(userId),
    conflicts: await countConflicts(userId),
  })).subscribe({ next: onChange, error: () => undefined });
  return () => subscription.unsubscribe();
}
