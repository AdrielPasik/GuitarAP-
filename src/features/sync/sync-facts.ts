import { db } from '@/data/database';
import type { SyncErrorKind } from '@/features/sync/transport';

/**
 * What can be proven about this account's synchronisation on this device, kept per account in the local database (so every
 * tab reads the same facts and a change of person never shows the previous person's):
 *
 *   lastConfirmedAt  the server confirmed a COMPLETE round trip: everything pending was received and everything the
 *                    server had was downloaded, with nothing left in conflict, waiting or set aside. This is the only
 *                    moment "Guardado en tu cuenta" can be based on.
 *   lastPushAt       the server confirmed receiving something this device sent.
 *   lastPullAt       a download reached the end of the account's log.
 *   lastAttemptAt    the last time this device tried to talk to the server at all, and whether that worked.
 *
 * Nothing here holds content, tokens or identifiers beyond the account's own key in the storage.
 */
export type FactError = { at: number; kind: SyncErrorKind | 'update' | 'session'; status?: number; code?: string; retryable: boolean; retryAfterMs?: number };
export type SyncFacts = {
  lastAttemptAt?: number;
  lastAttemptOk?: boolean;
  lastPushAt?: number;
  lastPullAt?: number;
  lastConfirmedAt?: number;
  lastError?: FactError;
  /** Failures in a row since the last success (drives the growing wait). */
  failures: number;
  /** When the next automatic attempt is due, if one is scheduled. Shared by every tab. */
  nextAttemptAt?: number | null;
};
const factsKey = (owner: string) => `sync-facts:${owner}`;
export const emptyFacts = (): SyncFacts => ({ failures: 0 });

export async function readFacts(owner: string): Promise<SyncFacts> {
  return ((await db.settings.get(factsKey(owner)))?.value as SyncFacts | undefined) ?? emptyFacts();
}
export async function updateFacts(owner: string, change: (current: SyncFacts) => SyncFacts) {
  await db.transaction('rw', db.settings, async () => {
    const next = change(await readFacts(owner));
    await db.settings.put({ key: factsKey(owner), value: next, updatedAt: Date.now() });
  });
}

/* ---- The history of attempts: short, local, and free of anything private ---- */
export type AttemptOperation = 'sync' | 'download' | 'upload-and-download' | 'probe';
export type AttemptResult = 'ok' | 'offline' | 'failed' | 'halted' | 'session' | 'paused';
export type Attempt = {
  at: number;
  op: AttemptOperation;
  result: AttemptResult;
  /** About how long it took (ms). */
  ms: number;
  /** The class of the failure, in words from a closed list. */
  kind?: string;
  status?: number;
  /** Whether the app will try again by itself. */
  willRetry?: boolean;
  pushed?: number;
  pulled?: number;
};
export const HISTORY_LIMIT = 40;
const historyKey = (owner: string) => `sync-history:${owner}`;
const OPS = new Set<string>(['sync', 'download', 'upload-and-download', 'probe']);
const RESULTS = new Set<string>(['ok', 'offline', 'failed', 'halted', 'session', 'paused']);
const KINDS = new Set<string>(['network', 'timeout', 'rate-limit', 'auth', 'permission', 'schema', 'data', 'conflict', 'too-large', 'server', 'unknown', 'update', 'session']);
const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(Math.round(value), 1_000_000) : undefined);

/** Only these fields, only these shapes: whatever else a caller hands in is dropped, so no content can reach the history. */
export function sanitizeAttempt(input: Attempt): Attempt | undefined {
  if (!OPS.has(input.op) || !RESULTS.has(input.result) || !Number.isFinite(input.at)) return undefined;
  return {
    at: Math.round(input.at),
    op: input.op,
    result: input.result,
    ms: count(input.ms) ?? 0,
    ...(input.kind && KINDS.has(input.kind) ? { kind: input.kind } : {}),
    ...(count(input.status) !== undefined ? { status: count(input.status) } : {}),
    ...(typeof input.willRetry === 'boolean' ? { willRetry: input.willRetry } : {}),
    ...(count(input.pushed) !== undefined ? { pushed: count(input.pushed) } : {}),
    ...(count(input.pulled) !== undefined ? { pulled: count(input.pulled) } : {}),
  };
}
export async function readHistory(owner: string): Promise<Attempt[]> {
  return ((await db.settings.get(historyKey(owner)))?.value as Attempt[] | undefined) ?? [];
}
export async function recordAttempt(owner: string, attempt: Attempt) {
  const clean = sanitizeAttempt(attempt);
  if (!clean) return;
  await db.transaction('rw', db.settings, async () => {
    const history = await readHistory(owner);
    await db.settings.put({ key: historyKey(owner), value: [clean, ...history].slice(0, HISTORY_LIMIT), updatedAt: clean.at });
  });
}
