import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/data/database';
import { describeProbe, probeConnectivity } from '@/features/sync/connectivity';
import { HISTORY_LIMIT, readFacts, readHistory, recordAttempt, sanitizeAttempt, updateFacts, type Attempt } from '@/features/sync/sync-facts';
import { parseRetryAfter, SupabaseTransport, SyncTransportError } from '@/features/sync/transport';

/** v0.8 phase 1.5 — what is known about the connection, said with no more certainty than the browser gives. */
afterEach(async () => {
  vi.unstubAllGlobals();
  await db.delete();
  await db.open();
});
const config = { url: 'https://example.invalid', anonKey: 'public-key' };

describe('"Probar conexión" is read-only and honest about what a browser can tell', () => {
  it('reaches the server: says so', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
    const probe = await probeConnectivity(config, { fetcher: fetcher as unknown as typeof fetch });
    expect(probe.server).toBe('reachable');
    expect(describeProbe(probe).ok).toBe(true);
  });
  it('a read-only request: GET, the public key only, no session, no body', async () => {
    const fetcher = vi.fn(async (...args: [string, RequestInit?]) => (void args, new Response('{}', { status: 200 })));
    await probeConnectivity(config, { fetcher: fetcher as unknown as typeof fetch });
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.invalid/auth/v1/health');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(Object.keys(init.headers as Record<string, string>)).toEqual(['apikey']); // no authorization header, nothing of the person's
  });
  it('an error status still means the path works', async () => {
    const probe = await probeConnectivity(config, { fetcher: (async () => new Response('', { status: 503 })) as unknown as typeof fetch });
    expect(probe).toMatchObject({ server: 'refused', status: 503 });
    expect(describeProbe(probe).text).toContain('503');
    expect(describeProbe(probe).ok).toBe(true);
  });
  it('a generic network failure is NOT presented as a definite cause (DNS, blocking and CORS look the same)', async () => {
    const probe = await probeConnectivity(config, { fetcher: (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch });
    expect(probe.server).toBe('unreachable');
    const text = describeProbe(probe).text;
    expect(text).toMatch(/no pudo llegar/);
    expect(text).toMatch(/no deja distinguirlo/);
    expect(text).not.toMatch(/el DNS (falló|no resuelve)/i);
  });
  it('a device that says it is offline is told so, without inventing more', () => {
    vi.stubGlobal('navigator', { onLine: false });
    const text = describeProbe({ at: 1, navigatorOnline: false, server: 'unreachable', ms: 5 }).text;
    expect(text).toMatch(/no tiene conexión/);
  });
  it('gives up waiting by itself (timeout), and says only that', async () => {
    const hang = ((_url: string, init?: RequestInit) => new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as unknown as typeof fetch;
    const probe = await probeConnectivity(config, { fetcher: hang, timeoutMs: 20 });
    expect(probe.server).toBe('timeout');
    expect(describeProbe(probe).text).toMatch(/no contestó a tiempo/);
  });
});

describe('the transport classifies what it can and says "network" for what it cannot', () => {
  const answer = (status: number, headers: Record<string, string> = {}, body: unknown = {}) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers })));
  const failure = async (transport = new SupabaseTransport('https://example.invalid', 'k', 'secret-token-value')) => {
    try {
      await transport.pull('o', '0', 10);
    } catch (error) {
      return error as SyncTransportError;
    }
    throw new Error('should have failed');
  };
  it.each([
    [429, 'rate-limit', true],
    [500, 'server', true],
    [503, 'server', true],
    [408, 'timeout', true],
    [504, 'timeout', true],
    [401, 'auth', false],
    [403, 'permission', false],
    [404, 'schema', false],
  ])('HTTP %i is %s (retryable: %s)', async (status, kind, retryable) => {
    answer(status);
    const error = await failure();
    expect(error.detail?.kind).toBe(kind);
    expect(error.retryable).toBe(retryable);
  });
  it('reads Retry-After (seconds or date), capped', async () => {
    answer(429, { 'retry-after': '90' });
    expect((await failure()).detail?.retryAfterMs).toBe(90_000);
    expect(parseRetryAfter('120')).toBe(120_000);
    expect(parseRetryAfter(new Date(Date.now() + 30_000).toUTCString(), Date.now())).toBeGreaterThan(20_000);
    expect(parseRetryAfter('999999999')).toBe(3_600_000);
    expect(parseRetryAfter('basura')).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });
  it('a browser-level failure is "network": no claim about DNS, CORS or blocking', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const error = await failure();
    expect(error.detail?.kind).toBe('network');
    expect(error.retryable).toBe(true);
    expect(error.message).not.toMatch(/dns|cors/i);
  });
  it('its own timeout is "timeout", retryable', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))));
    const error = await failure(new SupabaseTransport('https://example.invalid', 'k', 'secret-token-value', 25));
    expect(error.detail?.kind).toBe('timeout');
    expect(error.retryable).toBe(true);
  });
  it('no error carries the session token', async () => {
    answer(500, {}, { message: 'boom secret-token-value' });
    const error = await failure();
    expect(JSON.stringify(error.detail)).not.toContain('secret-token-value');
    expect(error.message).not.toContain('secret-token-value');
  });
});

describe('the history of attempts holds no content', () => {
  const attempt = (extra: Record<string, unknown> = {}): Attempt => ({ at: 1_000, op: 'sync', result: 'ok', ms: 120, ...extra }) as Attempt;
  it('keeps only the allowed fields, whatever a caller hands in', () => {
    const clean = sanitizeAttempt(attempt({ title: 'Mi letra secreta', content: { notes: [60] }, token: 'abc', url: 'https://u:p@x', kind: 'network', status: 500, willRetry: true, pushed: 2, pulled: 3 }));
    expect(clean).toEqual({ at: 1_000, op: 'sync', result: 'ok', ms: 120, kind: 'network', status: 500, willRetry: true, pushed: 2, pulled: 3 });
    expect(JSON.stringify(clean)).not.toMatch(/secreta|notes|abc|u:p/);
  });
  it('drops values outside the closed lists', () => {
    expect(sanitizeAttempt(attempt({ op: 'exfiltrate' }))).toBeUndefined();
    expect(sanitizeAttempt(attempt({ result: 'maybe' }))).toBeUndefined();
    expect(sanitizeAttempt(attempt({ kind: 'texto libre con datos' }))?.kind).toBeUndefined();
    expect(sanitizeAttempt(attempt({ ms: -5, pulled: Number.NaN }))).toMatchObject({ ms: 0 });
  });
  it('is bounded, newest first', async () => {
    for (let index = 0; index < HISTORY_LIMIT + 10; index += 1) await recordAttempt('user-a', attempt({ at: index }));
    const history = await readHistory('user-a');
    expect(history).toHaveLength(HISTORY_LIMIT);
    expect(history[0].at).toBe(HISTORY_LIMIT + 9);
  });
  it('is kept per account: another account never sees it', async () => {
    await recordAttempt('user-a', attempt({ kind: 'server', result: 'offline' }));
    expect(await readHistory('user-b')).toEqual([]);
    expect(await readFacts('user-b')).toEqual({ failures: 0 });
    await updateFacts('user-a', (facts) => ({ ...facts, lastConfirmedAt: 5 }));
    expect((await readFacts('user-b')).lastConfirmedAt).toBeUndefined();
  });
});
