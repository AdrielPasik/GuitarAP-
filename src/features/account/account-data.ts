import { liveQuery } from 'dexie';
import { db } from '@/data/database';
import { libraryRepository } from '@/data/library-repository';
import { activateOwner } from '@/data/library-scope';
import { countConflicts, countPending, SyncEngine } from '@/features/sync/engine';
import { SupabaseTransport } from '@/features/sync/transport';
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

export async function runSync(config: SupabaseConfig, session: SupabaseSession) {
  const engine = new SyncEngine(new SupabaseTransport(config.url, config.anonKey, session.accessToken));
  const report = await engine.sync(session.user.id);
  let lastSyncAt: number | undefined;
  if (!report.offline) {
    lastSyncAt = Date.now();
    await db.settings.put({ key: lastSyncKey(session.user.id), value: lastSyncAt, updatedAt: lastSyncAt });
  }
  return { report, lastSyncAt, conflicts: await countConflicts(session.user.id) };
}

export function watchPending(userId: string, onChange: (value: { pending: number; conflicts: number }) => void) {
  const subscription = liveQuery(async () => ({
    pending: await countPending(userId),
    conflicts: await countConflicts(userId),
  })).subscribe({ next: onChange, error: () => undefined });
  return () => subscription.unsubscribe();
}
