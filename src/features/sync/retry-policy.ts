import { RETRYABLE_KINDS, type SyncErrorKind } from '@/features/sync/transport';

/**
 * When to try again after a failed attempt, and when NOT to (v0.8 phase 1.5). One policy for every automatic retry:
 *
 *  - failures that can pass by themselves (no connection, a timeout, server trouble, a rate limit) are retried with a wait
 *    that doubles from 5 s up to 5 min, spread randomly so many devices never retry in step; a server that asks to wait
 *    (Retry-After) is obeyed, up to 15 min here (longer asks are honoured as 15 min and asked again);
 *  - failures that need a person or an update (a refused session, a permission, a missing function, rejected data, an
 *    app that cannot read what the server holds) are NOT retried by themselves: asking again cannot change the answer;
 *  - nothing is retried while the page is hidden or the device says it has no connection: coming back (visible, online,
 *    resumed) is the trigger, and it is one attempt, not a burst.
 */
export const BACKOFF = { baseMs: 5_000, capMs: 5 * 60_000, rateLimitCapMs: 15 * 60_000, minMs: 2_000 } as const;

export type FailureLike = { kind: SyncErrorKind | 'halted' | 'session'; retryable?: boolean; retryAfterMs?: number };
export type RetryDecision = { retry: true; delayMs: number } | { retry: false; needs: 'sign-in' | 'update' | 'attention' };

export function decideRetry(failure: FailureLike, failuresInARow: number, random: () => number = Math.random): RetryDecision {
  if (failure.kind === 'halted') return { retry: false, needs: 'update' };
  if (failure.kind === 'auth' || failure.kind === 'session') return { retry: false, needs: 'sign-in' };
  const retryable = failure.retryable ?? (RETRYABLE_KINDS as ReadonlySet<string>).has(failure.kind);
  if (!retryable) return { retry: false, needs: 'attention' };
  const steps = Math.max(1, failuresInARow);
  const grown = Math.min(BACKOFF.baseMs * 2 ** (steps - 1), BACKOFF.capMs);
  // Full jitter between half and all of the wait: devices that failed together do not return together.
  let delay = grown * (0.5 + random() * 0.5);
  if (failure.kind === 'rate-limit') delay = Math.min(Math.max(failure.retryAfterMs ?? 0, delay), BACKOFF.rateLimitCapMs);
  else if (failure.retryAfterMs) delay = Math.min(Math.max(failure.retryAfterMs, delay), BACKOFF.rateLimitCapMs);
  return { retry: true, delayMs: Math.max(BACKOFF.minMs, Math.round(delay)) };
}

/** May an automatic attempt start right now? (The caller still decides whether anything is due.) */
export function mayTryNow(state: { visible: boolean; online: boolean; running: boolean }) {
  return state.visible && state.online && !state.running;
}
