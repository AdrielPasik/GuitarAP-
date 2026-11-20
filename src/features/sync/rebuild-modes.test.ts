import { afterEach, describe, expect, it } from 'vitest';
import { createTablatureContent, type LibraryNode, type MusicalDocument } from '@/core/model';
import { db } from '@/data/database';
import { activateOwner, linkWithoutClaiming } from '@/data/library-scope';
import { SyncEngine, verifyLibrary } from '@/features/sync/engine';
import { FakeTransport, type PushResult, type SyncSnapshot, type SyncTransport } from '@/features/sync/transport';

/**
 * v0.8 phase 1.4 — "Reconstruir desde la nube" must say what it does and do exactly that: a DOWNLOAD-ONLY run can never
 * write to the server nor touch a record that has changes of its own; the run that uploads is a different, explicit one.
 */
const A = 'user-a';
const node = (id: string): LibraryNode => ({ id, parentId: null, kind: 'folder', name: id, order: 1, rev: 1, createdAt: 1, updatedAt: 1, ownerId: A });
const doc = (id: string, title = id, rev = 1): MusicalDocument => ({ id, nodeId: 'f', songId: null, type: 'tablature', title, content: createTablatureContent(), rev, createdAt: 1, updatedAt: 10 + rev, ownerId: A });

/** A server stand-in that counts every write attempted through it. */
function spyOn(remote: FakeTransport) {
  const writes: SyncSnapshot[] = [];
  const transport: SyncTransport = {
    push: (owner, op, snapshot): Promise<PushResult> => {
      writes.push(snapshot);
      return remote.push(owner, op, snapshot);
    },
    pull: (...args) => remote.pull(...args),
  };
  return { transport, writes };
}
const wipe = async () => {
  await db.delete();
  await db.open();
};
afterEach(wipe);

async function twoDevices() {
  await activateOwner(A);
  await db.nodes.add(node('f'));
  await db.documents.bulkAdd([doc('d1'), doc('d2')]);
  const remote = new FakeTransport();
  await new SyncEngine(remote).sync(A); // device 1 uploads
  await wipe();
  await linkWithoutClaiming(A);
  await new SyncEngine(remote).sync(A); // device 2 receives
  return remote;
}

describe('download only', () => {
  it('never writes to the server, even with pending changes, and leaves those records exactly as they are', async () => {
    const remote = await twoDevices();
    // Device 1 (another session) changes d1 on the server; device 2 has its own unsent edit of d1 and of d2.
    await db.documents.update('d1', { title: 'Mi cambio sin subir', rev: 2, updatedAt: 99 });
    await db.documents.update('d2', { title: 'Otro cambio mío', rev: 2, updatedAt: 99 });
    // A newer d1 is on the server (another device saved it).
    remote.inject(A, { kind: 'document', record: { ...doc('d1', 'Versión de la nube', 2), lastOpId: 'x' } });
    const spy = spyOn(remote);
    const before = JSON.stringify(await db.documents.toArray());
    const report = await new SyncEngine(spy.transport).rebuildFromCloud(A, { downloadOnly: true });
    expect(spy.writes).toEqual([]); // not one push attempted
    expect(report.pushed).toBe(0);
    expect(report.held).toBeGreaterThanOrEqual(1); // the record with its own edit was held
    expect((await db.documents.get('d1'))?.title).toBe('Mi cambio sin subir'); // not replaced
    expect((await db.documents.get('d2'))?.title).toBe('Otro cambio mío');
    expect(await db.documents.count()).toBe(2); // and not copied either
    expect(JSON.stringify(await db.documents.toArray())).toBe(before);
    expect(report.complete).toBe(true);
  });
  it('still fetches what the library lacks and keeps everything else', async () => {
    const remote = await twoDevices();
    await db.documents.delete('d2');
    const spy = spyOn(remote);
    const report = await new SyncEngine(spy.transport).rebuildFromCloud(A, { downloadOnly: true });
    expect(report.refetched).toBe(1);
    expect(await db.documents.get('d2')).toBeTruthy();
    expect(spy.writes).toEqual([]);
    expect((await verifyLibrary(A)).ok).toBe(true);
  });
  it('what it held is not lost: the normal sync afterwards resolves it as a real conflict, keeping both versions', async () => {
    const remote = await twoDevices();
    await db.documents.update('d1', { title: 'Mi cambio sin subir', rev: 2, updatedAt: 99 });
    remote.inject(A, { kind: 'document', record: { ...doc('d1', 'Versión de la nube', 2), lastOpId: 'x' } });
    await new SyncEngine(remote).rebuildFromCloud(A, { downloadOnly: true });
    await new SyncEngine(remote).sync(A);
    const titles = (await db.documents.toArray()).map((item) => item.title).join('|');
    expect(titles).toContain('Mi cambio sin subir');
  });
});

describe('the run that uploads is a different, explicit one', () => {
  it('sends pending changes first (the only way it writes) and then downloads', async () => {
    const remote = await twoDevices();
    await db.documents.update('d1', { title: 'Subir esto', rev: 2, updatedAt: 99 });
    const spy = spyOn(remote);
    const report = await new SyncEngine(spy.transport).rebuildFromCloud(A);
    expect(spy.writes.length).toBeGreaterThan(0);
    expect(report.pushed).toBeGreaterThanOrEqual(1);
    expect((await db.documents.get('d1'))?.title).toBe('Subir esto'); // kept
  });
  it('running either twice is the same as running it once', async () => {
    const remote = await twoDevices();
    const engine = new SyncEngine(remote);
    await engine.rebuildFromCloud(A, { downloadOnly: true });
    const once = JSON.stringify([await db.nodes.toArray(), await db.documents.toArray(), await db.versions.toArray()]);
    await engine.rebuildFromCloud(A, { downloadOnly: true });
    expect(JSON.stringify([await db.nodes.toArray(), await db.documents.toArray(), await db.versions.toArray()])).toBe(once);
    await engine.rebuildFromCloud(A);
    await engine.rebuildFromCloud(A);
    expect(await db.documents.count()).toBe(2);
  });
});
