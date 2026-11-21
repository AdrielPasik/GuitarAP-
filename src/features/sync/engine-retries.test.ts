import { afterEach, describe, expect, it } from 'vitest';
import { createTablatureContent, type MusicalDocument } from '@/core/model';
import { db } from '@/data/database';
import { activateOwner } from '@/data/library-scope';
import { SyncEngine } from '@/features/sync/engine';
import { FakeTransport, SyncTransportError, type PushResult, type SyncSnapshot, type SyncTransport } from '@/features/sync/transport';

/** v0.8 phase 1.5 — the pauses and limits inside ONE request, and idempotence across its attempts. */
const A = 'user-a';
const doc = (id: string): MusicalDocument => ({ id, nodeId: null, songId: null, type: 'tablature', title: id, content: createTablatureContent(), rev: 1, createdAt: 1, updatedAt: 1, ownerId: A });
const detail = (kind: 'network' | 'server' | 'rate-limit' | 'timeout' | 'permission', extra: Record<string, unknown> = {}) => ({ operation: 'push' as const, rpc: 'sync_library', kind, ...extra });
afterEach(async () => {
  await db.delete();
  await db.open();
});

/** A server whose push fails with the given errors first, then works; remembers the operation ids it was asked. */
function flaky(errors: SyncTransportError[]) {
  const remote = new FakeTransport();
  const ops: string[] = [];
  const transport: SyncTransport = {
    push: async (owner: string, op: string, snapshot: SyncSnapshot): Promise<PushResult> => {
      ops.push(op);
      const next = errors.shift();
      if (next) throw next;
      return remote.push(owner, op, snapshot);
    },
    pull: (...args) => remote.pull(...args),
  };
  return { transport, ops, remote };
}

describe('pauses between attempts of one request', () => {
  it('grow, are spread, and every attempt carries the SAME operation id (so a lost answer is never applied twice)', async () => {
    await activateOwner(A);
    await db.documents.add(doc('d1'));
    const waits: number[] = [];
    const { transport, ops, remote } = flaky([new SyncTransportError('x', true, 500, detail('server')), new SyncTransportError('x', true, 500, detail('server'))]);
    const report = await new SyncEngine(transport, 3, 100, undefined, [], async (ms) => void waits.push(ms)).sync(A);
    expect(report.pushed).toBe(1);
    expect(report.retries).toBe(2);
    expect(waits).toHaveLength(2);
    expect(waits[0]).toBeGreaterThanOrEqual(300);
    expect(waits[0]).toBeLessThanOrEqual(500);
    expect(waits[1]).toBeGreaterThanOrEqual(600);
    expect(waits[1]).toBeLessThanOrEqual(1000);
    expect(new Set(ops).size).toBe(1); // one operation id across the three attempts
    expect(remote.size(A)).toBe(1); // applied once
  });
  it('a server that asks for a long wait is not asked again in this run, and the failure says how long it asked', async () => {
    await activateOwner(A);
    await db.documents.add(doc('d1'));
    const waits: number[] = [];
    const { transport, ops } = flaky([new SyncTransportError('x', true, 429, detail('rate-limit', { retryAfterMs: 90_000 }))]);
    const report = await new SyncEngine(transport, 3, 100, undefined, [], async (ms) => void waits.push(ms)).sync(A);
    expect(ops).toHaveLength(1); // no hammering
    expect(waits).toEqual([]);
    expect(report.offline).toBe(true);
    expect(report.failure).toMatchObject({ kind: 'rate-limit', retryable: true, retryAfterMs: 90_000 });
    expect(await db.documents.count()).toBe(1); // the local record is exactly where it was
  });
  it('gives up after the limit and reports a failure that can pass, leaving the pending batch to be replayed', async () => {
    await activateOwner(A);
    await db.documents.add(doc('d1'));
    const errors = Array.from({ length: 10 }, () => new SyncTransportError('x', true, undefined, detail('network')));
    const { transport, ops } = flaky(errors);
    const first = await new SyncEngine(transport, 2, 100, undefined, [], async () => undefined).sync(A);
    expect(ops).toHaveLength(3); // the first try and two retries, no more
    expect(first.failure).toMatchObject({ kind: 'network', retryable: true });
    const second = await new SyncEngine(transport, 2, 100, undefined, [], async () => undefined).sync(A);
    expect(second.failure).toBeDefined();
    expect(new Set(ops).size).toBe(1); // the next run replays the SAME operation: still idempotent
  });
  it('a refusal that waiting cannot fix is not retried at all', async () => {
    await activateOwner(A);
    await db.documents.add(doc('d1'));
    const { transport, ops } = flaky([new SyncTransportError('no', false, 403, detail('permission'))]);
    await expect(new SyncEngine(transport, 3, 100, undefined, [], async () => undefined).sync(A)).rejects.toBeInstanceOf(SyncTransportError);
    expect(ops).toHaveLength(1);
    expect(await db.documents.count()).toBe(1);
  });
  it('a failure during the download is reported with its class and leaves the library as it was', async () => {
    await activateOwner(A);
    await db.documents.add(doc('d1'));
    const transport: SyncTransport = {
      push: async () => ({ documents: [], nodes: [], versions: [], conflicts: [] }),
      pull: async () => {
        throw new SyncTransportError('x', true, 503, detail('server'));
      },
    };
    const report = await new SyncEngine(transport).sync(A);
    expect(report).toMatchObject({ offline: true, complete: false, failure: { kind: 'server', status: 503, retryable: true } });
    expect(await db.documents.count()).toBe(1);
  });
});
