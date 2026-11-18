import { liveQuery } from 'dexie';
import { db } from '@/data/database';
import { libraryRepository } from '@/data/library-repository';
import { activateOwner } from '@/data/library-scope';
import { countConflicts, countPending, SyncEngine } from '@/features/sync/engine';
import { probeSyncServer, type SyncDiagnostic } from '@/features/sync/diagnostic';
import { SupabaseTransport, SyncTransportError } from '@/features/sync/transport';
import type { SupabaseConfig, SupabaseSession } from '@/features/sync/supabase-auth';

/**
 * Everything the account UI needs from the local database and the sync engine. It lives in
 * its own module so the heavy parts load only when someone is signed in or opens a backup.
 */
const backupKey = (userId: string) => `sync-backup-confirmed:${userId}`;
const lastSyncKey = (userId: string) => `sync-last:${userId}`;
const autoSyncKey = 'account-auto-sync';

export async function isLinked(userId: string) {
  return Boolean((await db.settings.get(backupKey(userId)))?.value);
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

export async function runSync(config: SupabaseConfig, session: SupabaseSession) {
  const engine = new SyncEngine(new SupabaseTransport(config.url, config.anonKey, session.accessToken));
  const owner = session.user.id;
  let report;
  try {
    report = await engine.sync(owner);
  } catch (error) {
    const detail = error instanceof SyncTransportError ? error.detail : undefined;
    // A refused push on sync_library may be the known server defect: find out, so the message can say it exactly.
    const server = detail && detail.rpc === 'sync_library' && detail.kind !== 'network' ? await probeSyncServer(config.url, config.anonKey, session.accessToken) : undefined;
    await writeDiagnostic(owner, { at: Date.now(), ok: false, detail, server }).catch(() => undefined);
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
    server: (await readDiagnostic(owner))?.server,
  };
  await writeDiagnostic(owner, diagnostic).catch(() => undefined);
  return { report, lastSyncAt, diagnostic, skipped: skipped.nodes + skipped.documents + skipped.versions, conflicts: await countConflicts(owner) };
}

export function watchPending(userId: string, onChange: (value: { pending: number; conflicts: number }) => void) {
  const subscription = liveQuery(async () => ({
    pending: await countPending(userId),
    conflicts: await countConflicts(userId),
  })).subscribe({ next: onChange, error: () => undefined });
  return () => subscription.unsubscribe();
}
