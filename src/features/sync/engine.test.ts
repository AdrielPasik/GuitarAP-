import { afterEach, describe, expect, it } from 'vitest';
import { createTablatureContent, type LibraryNode, type MusicalDocument } from '@/core/model';
import { db } from '@/data/database';
import { activateOwner } from '@/data/library-scope';
import { SyncEngine } from '@/features/sync/engine';
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
