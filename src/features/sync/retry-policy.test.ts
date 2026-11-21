import { describe, expect, it } from 'vitest';
import { BACKOFF, decideRetry, mayTryNow } from '@/features/sync/retry-policy';

/** v0.8 phase 1.5 — when to try again, and when asking again would be pointless. */
const delayOf = (decision: ReturnType<typeof decideRetry>) => {
  if (!decision.retry) throw new Error('expected a retry');
  return decision.delayMs;
};

describe('failures that pass by themselves are retried with a growing, spread-out wait', () => {
  it('doubles from the base up to the cap', () => {
    const full = () => 1; // no jitter reduction
    expect(delayOf(decideRetry({ kind: 'network' }, 1, full))).toBe(5_000);
    expect(delayOf(decideRetry({ kind: 'network' }, 2, full))).toBe(10_000);
    expect(delayOf(decideRetry({ kind: 'timeout' }, 3, full))).toBe(20_000);
    expect(delayOf(decideRetry({ kind: 'server' }, 10, full))).toBe(BACKOFF.capMs);
    expect(delayOf(decideRetry({ kind: 'server' }, 40, full))).toBe(BACKOFF.capMs); // never an aggressive loop, never overflow
  });
  it('spreads devices out: half to all of the wait', () => {
    expect(delayOf(decideRetry({ kind: 'network' }, 3, () => 0))).toBe(10_000);
    expect(delayOf(decideRetry({ kind: 'network' }, 3, () => 1))).toBe(20_000);
    const seen = new Set(Array.from({ length: 50 }, () => delayOf(decideRetry({ kind: 'network' }, 3))));
    expect(seen.size).toBeGreaterThan(5);
    for (const value of seen) {
      expect(value).toBeGreaterThanOrEqual(10_000);
      expect(value).toBeLessThanOrEqual(20_000);
    }
  });
  it('is never shorter than the minimum', () => {
    expect(delayOf(decideRetry({ kind: 'network' }, 1, () => 0))).toBeGreaterThanOrEqual(BACKOFF.minMs);
  });
  it('a rate limit obeys what the server asked for, within a ceiling', () => {
    expect(delayOf(decideRetry({ kind: 'rate-limit', retryAfterMs: 120_000 }, 1, () => 1))).toBe(120_000);
    expect(delayOf(decideRetry({ kind: 'rate-limit', retryAfterMs: 10 * 3_600_000 }, 1, () => 1))).toBe(BACKOFF.rateLimitCapMs);
    expect(delayOf(decideRetry({ kind: 'rate-limit' }, 1, () => 1))).toBe(5_000); // no hint: the ordinary growing wait
  });
  it('a server error that names a wait is obeyed too', () => {
    expect(delayOf(decideRetry({ kind: 'server', retryAfterMs: 90_000 }, 1, () => 1))).toBe(90_000);
  });
});

describe('failures that need a person or an update are NOT retried by themselves', () => {
  it('the app cannot read what the server holds: it needs an update', () => {
    expect(decideRetry({ kind: 'halted' }, 1)).toEqual({ retry: false, needs: 'update' });
  });
  it('a refused or ended session needs signing in', () => {
    expect(decideRetry({ kind: 'auth' }, 1)).toEqual({ retry: false, needs: 'sign-in' });
    expect(decideRetry({ kind: 'session' }, 1)).toEqual({ retry: false, needs: 'sign-in' });
  });
  it('a permission, a missing function, rejected data, an oversized request or the unknown need attention', () => {
    for (const kind of ['permission', 'schema', 'data', 'too-large', 'unknown'] as const) expect(decideRetry({ kind }, 1)).toEqual({ retry: false, needs: 'attention' });
  });
  it('an explicit retryable flag from the engine wins over the class', () => {
    expect(decideRetry({ kind: 'unknown', retryable: true }, 1, () => 1)).toMatchObject({ retry: true });
    expect(decideRetry({ kind: 'network', retryable: false }, 1)).toEqual({ retry: false, needs: 'attention' });
  });
});

describe('nothing runs while the page is hidden, the device is offline, or a run is already going', () => {
  it('allows an attempt only when all three are fine', () => {
    expect(mayTryNow({ visible: true, online: true, running: false })).toBe(true);
    expect(mayTryNow({ visible: false, online: true, running: false })).toBe(false);
    expect(mayTryNow({ visible: true, online: false, running: false })).toBe(false);
    expect(mayTryNow({ visible: true, online: true, running: true })).toBe(false);
  });
});
