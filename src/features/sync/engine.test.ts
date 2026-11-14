import { afterEach, describe, expect, it } from 'vitest';
import { createTablatureContent, type MusicalDocument } from '@/core/model';
import { db } from '@/data/database';
import { SyncEngine } from '@/features/sync/engine';
import { FakeTransport, type SyncTransport } from '@/features/sync/transport';

const document = (id = 'doc', rev = 1): MusicalDocument => ({ id, nodeId: null, type: 'tablature', title: 'Riff', content: createTablatureContent(), rev, createdAt: 1, updatedAt: 10 + rev });
afterEach(async () => { await db.delete(); await db.open(); });
describe('SyncEngine', () => {
  it('pushes only unsynced local revisions and is quiet when up to date', async () => {
    await db.documents.add(document()); const engine = new SyncEngine(new FakeTransport());
    expect((await engine.sync('u')).pushed).toBe(1);
    expect((await engine.sync('u')).pushed).toBe(0);
  });
  it('marks a transport outage and retries it', async () => {
    await db.documents.add(document()); let tries = 0;
    const offline: SyncTransport = { push: async () => { tries += 1; throw new Error('offline'); }, pull: async () => [] };
    const report = await new SyncEngine(offline, 1).sync('u');
    expect(report.offline).toBe(true); expect(tries).toBe(2);
  });
  it('records an optimistic concurrency conflict', async () => {
    const transport = new FakeTransport(); await transport.push('u', 'seed', [document()]);
    await db.documents.add(document('doc', 1)); const engine = new SyncEngine(transport);
    const report = await engine.sync('u');
    expect(report.conflicts).toBe(1); expect(Object.keys(await engine.conflicts('u'))).toEqual(['doc']);
  });
});
