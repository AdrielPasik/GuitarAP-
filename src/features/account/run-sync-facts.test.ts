import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTablatureContent, type MusicalDocument } from '@/core/model';
import { db } from '@/data/database';
import { authenticated } from '@/data/identity';
import { activateOwner } from '@/data/library-scope';
import { readOverview, runSync } from '@/features/account/account-data';
import { describeStatus } from '@/features/account/account-status';
import { readFacts, readHistory } from '@/features/sync/sync-facts';
import { SyncTransportError } from '@/features/sync/transport';

/**
 * v0.8 phase 1.5 — what the sync RECORDS about itself. The server is a scripted fetch: no network, no real account.
 * The point of every case: a fact is written only if it was proven, and "confirmed" only by a complete round trip that
 * left nothing pending, in conflict, waiting or set aside.
 */
const A = 'user-a';
const B = 'user-b';
const config = { url: 'https://example.invalid', anonKey: 'public-key' };
const session = (id = A) => ({ accessToken: 'tok', refreshToken: 'r', expiresAt: Date.now() + 3_600_000, user: { id, email: undefined } });
const doc = (id: string, nodeId: string | null = null): MusicalDocument => ({ id, nodeId, songId: null, type: 'tablature', title: `Material ${id}`, content: createTablatureContent(), rev: 1, createdAt: 1, updatedAt: 1, ownerId: A });
const page = (changes: unknown[] = [], extra: Record<string, unknown> = {}) => ({ cursor: String(changes.length), changes, hasMore: false, ...extra });
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
type Step = Response | Error | ((init: RequestInit) => Response | Promise<Response>);
/** A scripted server: each call to an RPC takes the next step; the last one repeats. */
function server(script: { pull?: Step[]; push?: Step[] }) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const rpc = String(url).split('/rpc/')[1];
    calls.push(rpc);
    const steps = (rpc === 'pull_library' ? script.pull : script.push) ?? [];
    const step = steps.length > 1 ? steps.shift()! : steps[0];
    if (!step) throw new Error(`unscripted rpc ${rpc}`);
    if (step instanceof Error) throw step;
    return typeof step === 'function' ? step(init) : step.clone();
  });
  return calls;
}

beforeEach(async () => {
  await activateOwner(A);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await db.delete();
  await db.open();
});

describe('a normal, complete round trip is the only thing that confirms', () => {
  it('records the confirmation, the pull, the attempt, and clears the failures', async () => {
    server({ pull: [json(page())] });
    const run = await runSync(config, session());
    expect(run?.confirmed).toBe(true);
    const facts = await readFacts(A);
    expect(facts).toMatchObject({ lastAttemptOk: true, failures: 0, nextAttemptAt: null });
    expect(facts.lastConfirmedAt).toBeTypeOf('number');
    expect(facts.lastPullAt).toBeTypeOf('number');
    expect(facts.lastError).toBeUndefined();
    const [entry] = await readHistory(A);
    expect(entry).toMatchObject({ op: 'sync', result: 'ok' });
  });
  it('uploads and confirms: pending changes leave only once the server answered', async () => {
    await db.documents.add(doc('d1'));
    server({ push: [json({ documents: [{ ...doc('d1'), ownerId: A, lastOpId: 'x' }], nodes: [], versions: [], conflicts: [] })], pull: [json(page())] });
    const run = await runSync(config, session());
    expect(run?.confirmed).toBe(true);
    expect((await readFacts(A)).lastPushAt).toBeTypeOf('number');
    expect((await readOverview(A)).pending.documents).toBe(0);
  });
});

describe('failures are recorded as facts, never as success', () => {
  const failing = async (step: Step, previouslyConfirmed = true) => {
    if (previouslyConfirmed) {
      server({ pull: [json(page())] });
      await runSync(config, session());
    }
    const before = (await readFacts(A)).lastConfirmedAt;
    server({ pull: [step] });
    const run = await runSync(config, session());
    return { run, before, facts: await readFacts(A), history: await readHistory(A) };
  };
  it('a server error (500): retryable, a wait is scheduled, the old confirmation stays and is not renewed', async () => {
    const { run, before, facts, history } = await failing(json({ message: 'boom' }, 500));
    expect(run?.confirmed).toBe(false);
    expect(facts.lastConfirmedAt).toBe(before); // an old success is not a current one, and a failure does not erase it
    expect(facts).toMatchObject({ lastAttemptOk: false, failures: 1, lastError: { kind: 'server', status: 500, retryable: true } });
    expect(facts.nextAttemptAt).toBeGreaterThan(Date.now() + 1_500);
    expect(history[0]).toMatchObject({ result: 'offline', kind: 'server', status: 500, willRetry: true });
  });
  it('a rate limit (429): paused for as long as the server asked', async () => {
    const { facts, history } = await failing(json({}, 429, { 'retry-after': '120' }));
    expect(facts.lastError).toMatchObject({ kind: 'rate-limit', retryAfterMs: 120_000 });
    expect(facts.nextAttemptAt).toBeGreaterThanOrEqual(Date.now() + 119_000);
    expect(history[0]).toMatchObject({ result: 'paused', kind: 'rate-limit', willRetry: true });
  });
  it('no connection: the generic "network" class, retried later', async () => {
    const { facts, history } = await failing(new TypeError('Failed to fetch'));
    expect(facts.lastError).toMatchObject({ kind: 'network', retryable: true });
    expect(history[0]).toMatchObject({ result: 'offline', kind: 'network', willRetry: true });
  });
  it('a gateway timeout (504): "timeout", retried later', async () => {
    const { facts } = await failing(json({}, 504));
    expect(facts.lastError).toMatchObject({ kind: 'timeout', retryable: true });
  });
  it('the waits grow with consecutive failures and reset after a success', async () => {
    server({ pull: [json({}, 500)] });
    await runSync(config, session());
    const first = (await readFacts(A)).nextAttemptAt! - Date.now();
    await runSync(config, session());
    await runSync(config, session());
    const third = (await readFacts(A)).nextAttemptAt! - Date.now();
    expect((await readFacts(A)).failures).toBe(3);
    expect(third).toBeGreaterThan(first * 1.2);
    server({ pull: [json(page())] });
    await runSync(config, session());
    expect(await readFacts(A)).toMatchObject({ failures: 0, nextAttemptAt: null });
  });
  it('a refused session (401): NOT retried by itself, and says it needs signing in', async () => {
    server({ pull: [json({ message: 'JWT expired' }, 401)] });
    await expect(runSync(config, session())).rejects.toBeInstanceOf(SyncTransportError);
    const facts = await readFacts(A);
    expect(facts.lastError).toMatchObject({ kind: 'auth', retryable: false });
    expect(facts.nextAttemptAt).toBeNull();
    expect((await readHistory(A))[0]).toMatchObject({ result: 'session', willRetry: false });
  });
  it('a permission (403) or a missing function (404): not retried either', async () => {
    for (const status of [403, 404]) {
      server({ pull: [json({}, status)] });
      await expect(runSync(config, session())).rejects.toBeInstanceOf(SyncTransportError);
      expect((await readFacts(A)).nextAttemptAt).toBeNull();
      expect((await readHistory(A))[0]).toMatchObject({ result: 'failed', willRetry: false, status });
    }
  });
  it('local data is never touched by any of this: a failed run leaves every record', async () => {
    await db.documents.add(doc('d1'));
    server({ push: [json({}, 500)], pull: [json({}, 500)] });
    const run = await runSync(config, session());
    expect(run?.report.offline).toBe(true);
    expect(await db.documents.count()).toBe(1);
    expect((await readOverview(A)).pending.documents).toBe(1); // still pending: a failed upload is not an upload
    expect((await readFacts(A)).lastPushAt).toBeUndefined();
  });
});

describe('"confirmed" needs a clean outcome, not just a reply', () => {
  it('a download that stopped half way (a page, then an error) is not complete and does not confirm', async () => {
    server({ pull: [json({ cursor: '1', changes: [{ kind: 'document', record: { ...doc('r1'), ownerId: A, lastOpId: 'x' } }], hasMore: true }), json({}, 500)] });
    const run = await runSync(config, session());
    expect(run?.report.complete).toBe(false);
    const facts = await readFacts(A);
    expect(facts.lastPullAt).toBeUndefined();
    expect(facts.lastConfirmedAt).toBeUndefined();
    expect(await db.documents.get('r1')).toBeTruthy(); // what arrived stays
  });
  it('an event this version cannot read stops it: not confirmed, not retried by itself, flagged as an update', async () => {
    server({ pull: [json(page([{ kind: 'mystery', record: { id: 'm1' } }]))] });
    const run = await runSync(config, session());
    expect(run?.report.halted).toMatchObject({ kind: 'mystery' });
    expect(run?.confirmed).toBe(false);
    const facts = await readFacts(A);
    expect(facts.lastError).toMatchObject({ kind: 'update', retryable: false });
    expect(facts.nextAttemptAt).toBeNull();
    expect((await readHistory(A))[0]).toMatchObject({ result: 'halted', kind: 'update', willRetry: false });
    expect((await readOverview(A)).halted).toMatchObject({ kind: 'mystery' });
  });
  it('events set aside for a newer version, or waiting for what they point to, prevent the confirmation', async () => {
    server({ pull: [json(page([{ kind: 'mystery', record: { id: 'm1' }, required: false }]))] });
    expect((await runSync(config, session()))?.confirmed).toBe(false);
    expect((await readOverview(A)).quarantined).toBe(1);
    await db.settings.delete(`sync-quarantine:${A}`);
    await db.settings.delete(`sync-state:${A}`);
    server({ pull: [json(page([{ kind: 'document', record: { ...doc('w1', 'missing-folder'), ownerId: A, lastOpId: 'x' } }]))] });
    expect((await runSync(config, session()))?.confirmed).toBe(false);
    expect((await readOverview(A)).deferred).toBe(1);
  });
  it('a conflict that waits for a person prevents it too', async () => {
    await db.settings.put({ key: `sync-state:${A}`, value: { cursor: '0', documents: {}, nodes: {}, versions: {}, conflicts: { c1: { ...doc('c1'), ownerId: A, lastOpId: 'x' } } }, updatedAt: 1 });
    server({ pull: [json(page())] });
    const run = await runSync(config, session());
    expect(run?.confirmed).toBe(false);
    expect((await readOverview(A)).conflicts).toBe(1);
  });
  it('records that cannot be uploaded prevent it', async () => {
    await db.documents.add(doc('orphan', 'a-folder-that-does-not-exist'));
    server({ pull: [json(page())] });
    expect((await runSync(config, session()))?.confirmed).toBe(false);
  });
});

describe('the screen reads these facts, so an old success never passes for a current one', () => {
  it('after a failure the status stays honest even though a confirmation exists from long ago', async () => {
    server({ pull: [json(page())] });
    await runSync(config, session());
    const confirmed = (await readFacts(A)).lastConfirmedAt!;
    server({ pull: [json({}, 500)] });
    await runSync(config, session());
    const facts = await readFacts(A);
    const status = describeStatus({ signedIn: true, linked: true, online: true, syncing: false, failed: false, offlineReport: true, failure: { kind: 'server', status: 500 }, pending: 0, conflicts: 0, confirmed: true, lastConfirmedAt: facts.lastConfirmedAt, retryInMs: facts.nextAttemptAt! - Date.now(), now: Date.now() });
    expect(facts.lastConfirmedAt).toBe(confirmed);
    expect(status.label).not.toMatch(/^Guardado en tu cuenta/);
  });
});

describe('another tab holds the account lock, or another person takes the screen', () => {
  it('a second tab does not talk to the server at the same time and records nothing', async () => {
    const calls = server({ pull: [json(page())] });
    vi.stubGlobal('navigator', { onLine: true, locks: { request: async (_name: string, _options: unknown, callback: (lock: unknown) => unknown) => callback(null) } });
    expect(await runSync(config, session())).toBeNull();
    expect(calls).toEqual([]);
    expect(await readHistory(A)).toEqual([]);
  });
  it('with the lock free the run goes ahead and holds it for its duration', async () => {
    server({ pull: [json(page())] });
    const names: string[] = [];
    vi.stubGlobal('navigator', { onLine: true, locks: { request: async (name: string, _options: unknown, callback: (lock: unknown) => unknown) => (names.push(name), callback({})) } });
    expect((await runSync(config, session()))?.confirmed).toBe(true);
    expect(names).toEqual([`guitarap-sync:${A}`]); // one lock per account
  });
  it('the person changed while the download was in flight: nothing of it lands, and the other account has no facts from it', async () => {
    server({
      pull: [
        async () => {
          await authenticated(B); // B takes the screen while A's response is on its way
          return json(page([{ kind: 'document', record: { ...doc('late'), ownerId: A, lastOpId: 'x' } }]));
        },
      ],
    });
    await expect(runSync(config, session(A))).rejects.toThrow('La sesión cambió');
    expect(await db.documents.get('late')).toBeUndefined();
    expect(await readFacts(B)).toEqual({ failures: 0 });
    expect(await readHistory(B)).toEqual([]);
  });
});
