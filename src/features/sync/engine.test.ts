import { afterEach, describe, expect, it } from 'vitest';
import { createTablatureContent, type LibraryNode, type MusicalDocument } from '@/core/model';
import { db } from '@/data/database';
import { activateOwner } from '@/data/library-scope';
import { SyncEngine, sortNodes, splitSnapshot } from '@/features/sync/engine';
import { FakeTransport, SyncTransportError, type SyncTransport } from '@/features/sync/transport';
const doc = (id = 'doc', rev = 1): MusicalDocument => ({
  id,
  nodeId: 'folder',
  type: 'tablature',
  title: 'Riff',
  content: createTablatureContent(),
  rev,
  createdAt: 1,
  updatedAt: 10 + rev,
  ownerId: 'u',
});
const node = (): LibraryNode => ({
  id: 'folder',
  parentId: null,
  kind: 'folder',
  name: 'Escalas',
  order: 1,
  rev: 1,
  createdAt: 1,
  updatedAt: 1,
  ownerId: 'u',
});
afterEach(async () => {
  await db.delete();
  await db.open();
});
describe('SyncEngine', () => {
  it('syncs a folder, document and version to a second device in pages', async () => {
    await activateOwner('u');
    await db.nodes.add(node());
    await db.documents.add(doc());
    await db.versions.add({
      id: 'v',
      documentId: 'doc',
      reason: 'manual',
      title: 'Riff',
      content: createTablatureContent(),
      createdAt: 2,
      ownerId: 'u',
    });
    const remote = new FakeTransport();
    expect((await new SyncEngine(remote, 2, 1).sync('u')).pushed).toBe(3);
    await db.delete();
    await db.open();
    await activateOwner('u');
    const report = await new SyncEngine(remote, 2, 1).sync('u');
    expect(report.pulled).toBe(3);
    expect(await db.nodes.get('folder')).toMatchObject({ name: 'Escalas' });
    expect(await db.documents.get('doc')).toMatchObject({ nodeId: 'folder' });
    expect(await db.versions.get('v')).toBeTruthy();
  });
  it('reuses its operation after a response is lost', async () => {
    await activateOwner('u');
    await db.documents.add({ ...doc(), nodeId: null });
    const remote = new FakeTransport();
    remote.loseNextResponse();
    const report = await new SyncEngine(remote, 1).sync('u');
    expect(report.retries).toBe(1);
    expect(report.pushed).toBe(1);
    expect((await new SyncEngine(remote).sync('u')).pushed).toBe(0);
  });
  it('pulls more than 250 remote changes without skipping pages', async () => {
    await activateOwner('u');
    const remote = new FakeTransport();
    await db.documents.bulkAdd(
      Array.from({ length: 251 }, (_, index) => ({
        ...doc(`d-${index}`),
        id: `d-${index}`,
        nodeId: null,
      })),
    );
    await new SyncEngine(remote, 1, 100).sync('u');
    await db.delete();
    await db.open();
    await activateOwner('u');
    const report = await new SyncEngine(remote, 1, 100).sync('u');
    expect(report.pulled).toBe(251);
    expect(await db.documents.count()).toBe(251);
  });
  it('keeps another user records outside the active account', async () => {
    const remote = new FakeTransport();
    await activateOwner('a');
    await db.documents.add({ ...doc('a'), nodeId: null, ownerId: 'a' });
    await new SyncEngine(remote).sync('a');
    await activateOwner('b');
    await expect(new SyncEngine(remote).sync('b')).resolves.toMatchObject({ pulled: 0 });
  });
  it('reports retryable pull failures as offline and surfaces rejected RPC calls', async () => {
    await activateOwner('u');
    const transport = (error: SyncTransportError): SyncTransport => ({
      push: async () => ({ documents: [], nodes: [], versions: [], conflicts: [] }),
      pull: async () => {
        throw error;
      },
    });
    await expect(
      new SyncEngine(transport(new SyncTransportError('offline', true))).sync('u'),
    ).resolves.toMatchObject({ offline: true });
    await expect(
      new SyncEngine(transport(new SyncTransportError('migration missing', false, 400))).sync('u'),
    ).rejects.toThrow('migration missing');
  });
});

const folder = (id: string, parentId: string | null, order = 1): LibraryNode => ({ id, parentId, kind: 'folder', name: id, order, rev: 1, createdAt: 1, updatedAt: 1, ownerId: 'u' });

describe('SyncEngine: what the first sync of a real library needs', () => {
  it('sends parents before children even when IndexedDB hands them back child-first', async () => {
    await activateOwner('u');
    // Keys sort a < b < c, so the child "a" comes back before its parent "c".
    await db.nodes.bulkAdd([folder('a-child', 'b-middle'), folder('b-middle', 'c-root'), folder('c-root', null)]);
    expect((await db.nodes.where('ownerId').equals('u').toArray()).map((n) => n.id)).toEqual(['a-child', 'b-middle', 'c-root']);
    const report = await new SyncEngine(new FakeTransport()).sync('u');
    expect(report.pushed).toBe(3);
    expect(sortNodes([folder('a', 'b'), folder('b', 'c'), folder('c', null)]).map((n) => n.id)).toEqual(['c', 'b', 'a']);
  });

  it('splits a big library into small requests, folders first, nothing lost', async () => {
    await activateOwner('u');
    await db.nodes.bulkAdd([folder('f1', null), folder('f2', 'f1')]);
    for (let i = 0; i < 7; i += 1) await db.documents.add({ ...doc(`d${i}`), nodeId: 'f2' });
    const remote = new FakeTransport();
    const report = await new SyncEngine(remote, 2, 100, { nodes: 1, documents: 3, bytes: 10_000_000, versions: 10 }).sync('u');
    expect(report.requests).toBe(2 + 3); // two folders one by one, then 3 + 3 + 1 documents
    expect(report.pushed).toBe(9);
    const chunks = splitSnapshot({ nodes: [], documents: Array.from({ length: 5 }, (_, i) => doc(`x${i}`)), versions: [] }, { nodes: 10, documents: 100, bytes: 1, versions: 10 });
    expect(chunks.map((c) => c.documents.length)).toEqual([1, 1, 1, 1, 1]); // an oversized record travels alone
  });

  it('a document saved several times between two syncs is one clean update, never a conflict', async () => {
    await activateOwner('u');
    await db.documents.add({ ...doc(), nodeId: null });
    const remote = new FakeTransport();
    await new SyncEngine(remote).sync('u');
    for (const title of ['uno', 'dos', 'tres']) {
      const current = (await db.documents.get('doc'))!;
      await db.documents.put({ ...current, title, rev: current.rev + 1 });
    }
    const report = await new SyncEngine(remote).sync('u');
    expect(report.conflicts).toBe(0);
    expect(report.pushed).toBe(1);
    // And a second device receives the final state.
    await db.delete();
    await db.open();
    await activateOwner('u');
    await new SyncEngine(remote).sync('u');
    expect((await db.documents.get('doc'))!.title).toBe('tres');
  });

  it('after the server refuses a batch for good, the next attempt is rebuilt instead of replaying the same refusal', async () => {
    await activateOwner('u');
    await db.nodes.bulkAdd([folder('a-child', 'c-root'), folder('c-root', null)]);
    let refuse = true;
    const calls: number[] = [];
    const inner = new FakeTransport();
    const transport: SyncTransport = {
      pull: (owner, cursor, limit) => inner.pull(owner, cursor, limit),
      async push(owner, opId, snapshot) {
        calls.push(snapshot.nodes.length);
        if (refuse) throw new SyncTransportError('rechazado', false, 400, { operation: 'push', rpc: 'sync_library', status: 400, code: '42702', kind: 'data' });
        return inner.push(owner, opId, snapshot);
      },
    };
    await expect(new SyncEngine(transport).sync('u')).rejects.toMatchObject({ detail: { code: '42702' } });
    expect((await db.nodes.toArray()).length).toBe(2); // the local library is untouched
    refuse = false;
    const report = await new SyncEngine(transport).sync('u');
    expect(report.pushed).toBe(2);
  });

  it('reports records that point to a missing folder instead of blocking the rest', async () => {
    await activateOwner('u');
    await db.documents.bulkAdd([{ ...doc('ok'), nodeId: null }, { ...doc('orphan'), nodeId: 'gone' }]);
    const report = await new SyncEngine(new FakeTransport()).sync('u');
    expect(report.pushed).toBe(1);
    expect(report.skipped.documents).toEqual(['orphan']);
    expect((await db.documents.get('orphan'))!.nodeId).toBe('gone'); // still there, untouched
  });

  it('does not call its own echo a conflict when the person keeps typing during a sync', async () => {
    await activateOwner('u');
    await db.documents.add({ ...doc(), nodeId: null });
    const remote = new FakeTransport();
    await new SyncEngine(remote).sync('u');
    const current = (await db.documents.get('doc'))!;
    await db.documents.put({ ...current, title: 'editado', rev: current.rev + 1 });
    const slow: SyncTransport = {
      pull: (owner, cursor, limit) => remote.pull(owner, cursor, limit),
      async push(owner, opId, snapshot) {
        const result = await remote.push(owner, opId, snapshot);
        const during = (await db.documents.get('doc'))!;
        await db.documents.put({ ...during, title: 'seguí escribiendo', rev: during.rev + 1 }); // typed while the request was in flight
        return result;
      },
    };
    const report = await new SyncEngine(slow).sync('u');
    expect(report.conflicts).toBe(0);
    expect((await db.documents.get('doc'))!.title).toBe('seguí escribiendo');
    expect(await new SyncEngine(remote).sync('u')).toMatchObject({ conflicts: 0 });
    expect((await db.documents.get('doc'))!.title).toBe('seguí escribiendo');
  });
});

describe('SyncEngine: two devices editing the same document', () => {
  it('equal revision numbers by coincidence are not "the same version": the edit on this device becomes a copy, not a casualty', async () => {
    await activateOwner('u');
    await db.documents.add({ ...doc(), nodeId: null });
    const remote = new FakeTransport();
    await new SyncEngine(remote).sync('u');
    const deviceA = await db.documents.toArray();
    // Device B edits once and uploads (server revision 2).
    await db.delete();
    await db.open();
    await activateOwner('u');
    await new SyncEngine(remote).sync('u');
    const onB = (await db.documents.get('doc'))!;
    await db.documents.put({ ...onB, title: 'cambio de B', rev: onB.rev + 1 });
    await new SyncEngine(remote).sync('u');
    // Device A, offline until now, edited once as well: its revision NUMBER is also 2.
    await db.delete();
    await db.open();
    await activateOwner('u');
    await db.documents.bulkAdd(deviceA);
    const onA = (await db.documents.get('doc'))!;
    await db.documents.put({ ...onA, title: 'cambio de A', rev: onA.rev + 1 });
    const report = await new SyncEngine(remote).sync('u');
    expect(report.copies).toHaveLength(1);
    expect((await db.documents.get('doc'))!.title).toBe('cambio de B');
    const titles = (await db.documents.toArray()).map((d) => d.title).sort();
    expect(titles).toEqual(['cambio de A (copia de este dispositivo)', 'cambio de B']);
  });
});
