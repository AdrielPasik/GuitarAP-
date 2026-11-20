import { afterEach, describe, expect, it } from 'vitest';
import { createTablatureContent, type LibraryNode, type MusicalDocument } from '@/core/model';
import { autoRecoveryEnabled } from '@/core/flags';
import { db } from '@/data/database';
import { authenticated, signedOutExplicitly } from '@/data/identity';
import { activateOwner, anonymousRecords, belongsToOwner, claimAnonymous, libraryScope, linkWithoutClaiming } from '@/data/library-scope';
import { SyncEngine, verifyLibrary } from '@/features/sync/engine';
import { FakeTransport, SyncTransportError, type SyncTransport } from '@/features/sync/transport';

/**
 * v0.8 phase 1.3 — recovering an account's library on a device that has nothing of it. Everything runs against a FAKE
 * server and a throwaway database: no real account, no network.
 */
const A = 'user-a';
const node = (id: string, parentId: string | null = null, kind: 'folder' | 'song' = 'folder'): LibraryNode => ({ id, parentId, kind, name: id, order: 1, rev: 1, createdAt: 1, updatedAt: 1, ownerId: A });
const doc = (id: string, nodeId: string | null = null, title = id): MusicalDocument => ({ id, nodeId, songId: null, type: 'tablature', title, content: createTablatureContent(), rev: 1, createdAt: 1, updatedAt: 1, ownerId: A });
const library = async () => {
  await db.nodes.bulkAdd([node('f'), node('s', 'f', 'song')]);
  await db.documents.bulkAdd([doc('d1', 's'), doc('d2', 'f'), { ...doc('trashed', 'f'), deletedAt: 5 }]);
  await db.versions.add({ id: 'v1', documentId: 'd1', createdAt: 2, reason: 'manual', title: 'v', content: createTablatureContent(), ownerId: A });
};
const wipe = async () => {
  await db.delete();
  await db.open();
};
afterEach(wipe);

/** Device 1 builds the library and uploads it; the second device is a brand-new database. */
async function uploaded() {
  await activateOwner(A);
  await library();
  const remote = new FakeTransport();
  await new SyncEngine(remote).sync(A);
  await wipe();
  return remote;
}

describe('a new device recovers the whole account with no manual step', () => {
  it('links without claiming, downloads everything, reports progress and confirms the recovery from the library itself', async () => {
    const remote = await uploaded();
    await linkWithoutClaiming(A);
    const seen: Array<{ phase: string; pulled: number; pages: number }> = [];
    const report = await new SyncEngine(remote, 2, 2).sync(A, { onProgress: (progress) => seen.push(progress) });
    expect(report.complete).toBe(true);
    expect(seen.filter((item) => item.phase === 'pull').length).toBeGreaterThan(1); // several pages, each reported
    expect(seen.at(-1)!.pulled).toBe(report.pulled);
    const check = await verifyLibrary(A);
    expect(check).toMatchObject({ ok: true, counts: { folders: 1, songs: 1, documents: 2, trashed: 1, versions: 1 } });
  });
  it('a device with a library of its own for this account keeps its pending changes and does not duplicate anything', async () => {
    const remote = await uploaded();
    await activateOwner(A);
    await new SyncEngine(remote).sync(A); // the second device comes up to date
    await db.documents.update('d1', { title: 'Editada aquí', rev: 2, updatedAt: 9 });
    const report = await new SyncEngine(remote).sync(A);
    expect(report.pushed).toBeGreaterThanOrEqual(1);
    expect(await db.documents.count()).toBe(3);
    expect((await db.documents.get('d1'))?.title).toBe('Editada aquí');
  });
  it('an interrupted download resumes where it stopped, with no duplicates and nothing missing', async () => {
    const remote = await uploaded();
    await linkWithoutClaiming(A);
    let pulls = 0;
    const flaky: SyncTransport = {
      push: (...args) => remote.push(...args),
      pull: async (owner, cursor, limit) => {
        pulls += 1;
        if (pulls === 3) throw new SyncTransportError('sin red (simulado)', true);
        return remote.pull(owner, cursor, limit);
      },
    };
    const first = await new SyncEngine(flaky, 2, 2).sync(A);
    expect(first.offline).toBe(true);
    expect(first.complete).toBe(false); // an error is never reported as "all received"
    expect(await db.documents.count()).toBeGreaterThan(0);
    const second = await new SyncEngine(remote, 2, 2).sync(A);
    expect(second.complete).toBe(true);
    expect(await db.documents.count()).toBe(3);
    expect((await verifyLibrary(A)).ok).toBe(true);
  });
  it('an unreachable server is an error, never an empty library', async () => {
    await activateOwner(A);
    await library();
    const down: SyncTransport = {
      push: async () => {
        throw new SyncTransportError('sin red (simulado)', true);
      },
      pull: async () => {
        throw new SyncTransportError('sin red (simulado)', true);
      },
    };
    const report = await new SyncEngine(down).sync(A);
    expect(report.offline).toBe(true);
    expect(report.complete).toBe(false);
    expect(await db.documents.count()).toBe(3); // nothing local was touched
  });
  it("an account that is really empty on the server leaves the device's own records alone, and uploads them", async () => {
    await activateOwner(A);
    await library();
    const remote = new FakeTransport(); // empty
    const report = await new SyncEngine(remote).sync(A);
    expect(report.complete).toBe(true);
    expect(await db.documents.count()).toBe(3);
    expect(remote.size(A)).toBeGreaterThan(0);
  });
  it('what the server returns never replaces or deletes a local record that has edits of its own', async () => {
    const remote = await uploaded();
    await activateOwner(A);
    await db.documents.add({ ...doc('d1', null, 'Mi versión local sin subir'), rev: 7 });
    await new SyncEngine(remote).sync(A);
    const titles = (await db.documents.toArray()).map((item) => item.title);
    expect(titles.join('|')).toContain('Mi versión local sin subir'); // kept, as the document or as a visible copy
  });
});

describe('material that belongs to nobody is shown, not adopted', () => {
  it('stays unowned and hidden from the account until an explicit decision, which then claims it', async () => {
    await db.documents.add({ ...doc('anon'), ownerId: undefined } as MusicalDocument);
    await db.nodes.add({ ...node('anon-folder'), ownerId: undefined } as LibraryNode);
    await linkWithoutClaiming(A);
    const summary = await anonymousRecords();
    expect(summary.documents).toEqual([{ id: 'anon', title: 'anon' }]);
    expect(summary.nodes).toBe(1);
    const scope = await libraryScope();
    expect(belongsToOwner((await db.documents.get('anon'))!, scope)).toBe(false); // not part of the account's library
    await new SyncEngine(new FakeTransport()).sync(A);
    expect((await db.documents.get('anon'))?.ownerId).toBeUndefined(); // sync did not take it either
    await claimAnonymous(A);
    expect((await db.documents.get('anon'))?.ownerId).toBe(A);
  });
  it('data of another account is never listed, claimed or uploaded for this one', async () => {
    await db.documents.add({ ...doc('theirs'), ownerId: 'user-b' });
    await linkWithoutClaiming(A);
    expect((await anonymousRecords()).documents).toEqual([]);
    await claimAnonymous(A);
    expect((await db.documents.get('theirs'))?.ownerId).toBe('user-b');
    const remote = new FakeTransport();
    await new SyncEngine(remote).sync(A);
    expect(remote.size(A)).toBe(0);
  });
});

describe('rebuild from the cloud is non-destructive and idempotent', () => {
  it('fetches again only what the library lacks, keeps pending edits, and twice is the same as once', async () => {
    const remote = await uploaded();
    await linkWithoutClaiming(A);
    await new SyncEngine(remote).sync(A);
    await db.documents.delete('d2'); // damage: the state says it was received, the library lost it
    await db.documents.update('d1', { title: 'Cambio sin subir', rev: 2, updatedAt: 9 });
    const before = await verifyLibrary(A);
    expect(before.missing.documents).toEqual(['d2']);
    const engine = new SyncEngine(remote);
    const report = await engine.rebuildFromCloud(A);
    expect(report.refetched).toBe(1);
    expect(await db.documents.get('d2')).toBeTruthy();
    expect(await db.documents.count()).toBe(3);
    expect((await db.documents.get('d1'))?.title).toBe('Cambio sin subir'); // the pending edit survived
    const snapshot = JSON.stringify([await db.nodes.toArray(), await db.documents.toArray(), await db.versions.toArray()]);
    const again = await engine.rebuildFromCloud(A);
    expect(again.refetched).toBe(0);
    expect(JSON.stringify([await db.nodes.toArray(), await db.documents.toArray(), await db.versions.toArray()])).toBe(snapshot);
    expect((await verifyLibrary(A)).ok).toBe(true);
  });
  it('refuses to run for an account that is not the one on screen', async () => {
    await linkWithoutClaiming(A);
    await signedOutExplicitly();
    await expect(new SyncEngine(new FakeTransport()).rebuildFromCloud(A)).rejects.toThrow('no está vinculada');
    await authenticated(A);
  });
});

describe('the feature flag keeps all of this switched off by default', () => {
  it('is off unless asked for, and a browser override only exists outside production builds', () => {
    window.localStorage.clear();
    expect(autoRecoveryEnabled()).toBe(false);
    window.localStorage.setItem('guitarap.flag.autoRecovery', 'on');
    expect(autoRecoveryEnabled()).toBe(true); // test build: the override works
    window.localStorage.clear();
  });
});
