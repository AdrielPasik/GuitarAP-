import { afterEach, describe, expect, it } from 'vitest';
import type { MusicalDocument, NotebookContent } from '@/core/model';
import { db } from '@/data/database';
import { activateOwner } from '@/data/library-scope';
import { diffNotebooks, lineDiff, mergeByBlocks } from '@/features/sync/conflict-diff';
import { listConflicts, resolveConflict, SyncEngine } from '@/features/sync/engine';
import { FakeTransport, type RemoteDocument } from '@/features/sync/transport';

const lyrics = (id: string, text: string) => ({ id, kind: 'lyrics' as const, content: { text } });
const notebook = (...blocks: NotebookContent['blocks']): NotebookContent => ({ kind: 'notebook', version: 1, blocks });
const doc = (content: NotebookContent, rev = 1, title = 'Tema'): MusicalDocument => ({ id: 'doc', nodeId: null, songId: null, type: 'tablature', title, content, rev, createdAt: 1, updatedAt: 1, ownerId: 'u' });

afterEach(async () => {
  await db.delete();
  await db.open();
});

describe('reading a conflict', () => {
  it('shows what changed line by line, and says plainly which blocks exist on one side only', () => {
    expect(lineDiff(['a', 'b', 'c'], ['a', 'x', 'c'])).toEqual([
      { type: 'same', text: 'a' },
      { type: 'removed', text: 'b' },
      { type: 'added', text: 'x' },
      { type: 'same', text: 'c' },
    ]);
    const device = notebook(lyrics('l1', 'Hoy vuelvo\nconmigo'), lyrics('l2', 'solo aca'));
    const cloud = notebook(lyrics('l1', 'Hoy vuelvo\ncontigo'), lyrics('l3', 'solo en la nube'));
    const diff = diffNotebooks(device, cloud);
    expect(diff.identical).toBe(false);
    expect(diff.blocks.map((b) => [b.id, b.status])).toEqual([['l1', 'changed'], ['l3', 'only-cloud'], ['l2', 'only-device']]);
    expect(diff.blocks[0].lines?.map((l) => l.type)).toEqual(['same', 'removed', 'added']); // cloud -> device
    expect(diffNotebooks(device, device).identical).toBe(true);
  });

  it('a manual merge takes the chosen side per block, keeps blocks that exist on one side, and unites the comments', () => {
    const device = { ...notebook(lyrics('l1', 'mia'), lyrics('l2', 'solo aca')), comments: [{ id: 'c1', text: 'mine', createdAt: 1, updatedAt: 1 }] };
    const cloud = { ...notebook(lyrics('l1', 'nube'), lyrics('l3', 'solo nube')), comments: [{ id: 'c2', text: 'theirs', createdAt: 1, updatedAt: 1 }] };
    const merged = mergeByBlocks(device, cloud, { l1: 'cloud' });
    expect(merged.blocks.map((b) => (b as { content?: { text: string } }).content?.text)).toEqual(['nube', 'solo aca', 'solo nube']);
    expect((merged.comments ?? []).map((c) => c.id).sort()).toEqual(['c1', 'c2']);
    expect(mergeByBlocks(device, cloud, { l1: 'device' }, new Set(['l3'])).blocks.map((b) => b.id)).toEqual(['l1', 'l2']);
  });
});

describe('resolving a conflict is always an explicit act and never loses a version', () => {
  const mine = notebook(lyrics('l1', 'version de este dispositivo'));
  const theirs = notebook(lyrics('l1', 'version de la nube'));

  /** A library with one document whose conflict was kept aside by an earlier sync (the state a real library can be in). */
  async function conflicted() {
    await activateOwner('u');
    await db.documents.add(doc(mine, 3));
    const remote = new FakeTransport();
    const engine = new SyncEngine(remote);
    await engine.sync('u');
    // The cloud really is at revision 5 with the other version (another device got there first).
    await remote.push('u', 'seed-4', { documents: [doc(theirs, 4, 'Tema (nube)')], nodes: [], versions: [] });
    await remote.push('u', 'seed-5', { documents: [doc(theirs, 5, 'Tema (nube)')], nodes: [], versions: [] });
    const key = 'sync-state:u';
    const state = (await db.settings.get(key))!.value as { conflicts: Record<string, RemoteDocument>; remote?: { documents: Record<string, number> } };
    (state as unknown as { documents: Record<string, number> }).documents.doc = 2; // this device changed it since the last confirmed sync
    state.conflicts.doc = { ...doc(theirs, 5, 'Tema (nube)'), ownerId: 'u', lastOpId: 'x' };
    await db.settings.put({ key, value: state, updatedAt: Date.now() });
    return { remote, engine };
  }

  it('a normal sync neither resolves nor touches it', async () => {
    const { remote } = await conflicted();
    const before = JSON.stringify(await db.documents.get('doc'));
    await new SyncEngine(remote).sync('u');
    expect((await listConflicts('u')).map((c) => c.id)).toEqual(['doc']);
    expect(JSON.stringify(await db.documents.get('doc'))).toBe(before);
  });

  it('keep both: the cloud version becomes its own document, this device keeps its own, a recovery point is left', async () => {
    const { remote } = await conflicted();
    const { copyId } = await resolveConflict('u', 'doc', { kind: 'keep-both' });
    expect((await db.documents.get(copyId!))!.title).toBe('Tema (nube) (versión de la nube)');
    expect(JSON.stringify((await db.documents.get(copyId!))!.content)).toContain('version de la nube');
    expect(JSON.stringify((await db.documents.get('doc'))!.content)).toContain('version de este dispositivo');
    expect((await db.versions.where('documentId').equals('doc').toArray()).map((v) => v.reason)).toContain('conflict-device');
    expect(await listConflicts('u')).toEqual([]);
    const report = await new SyncEngine(remote).sync('u');
    expect(report.conflicts).toBe(0);
    expect(await db.documents.count()).toBe(2);
  });

  it('use the cloud version: replaces this device\'s only after a recovery point and a copy of what was here', async () => {
    await conflicted();
    const { copyId } = await resolveConflict('u', 'doc', { kind: 'use-cloud' });
    expect(JSON.stringify((await db.documents.get('doc'))!.content)).toContain('version de la nube');
    expect(JSON.stringify((await db.documents.get(copyId!))!.content)).toContain('version de este dispositivo');
    expect((await db.versions.where('documentId').equals('doc').toArray()).some((v) => v.reason === 'conflict-device' && JSON.stringify(v.content).includes('este dispositivo'))).toBe(true);
    expect(await listConflicts('u')).toEqual([]);
  });

  it('use this device\'s version: the cloud version stays in the history and the device version is the next update', async () => {
    const { remote } = await conflicted();
    await resolveConflict('u', 'doc', { kind: 'use-device' });
    expect((await db.versions.where('documentId').equals('doc').toArray()).some((v) => v.reason === 'conflict-cloud' && JSON.stringify(v.content).includes('la nube'))).toBe(true);
    expect(JSON.stringify((await db.documents.get('doc'))!.content)).toContain('este dispositivo');
    const report = await new SyncEngine(remote).sync('u');
    expect(report.pushed).toBeGreaterThanOrEqual(1);
  });

  it('a manual merge saves recovery points for BOTH versions before writing the result', async () => {
    await conflicted();
    const merged = mergeByBlocks(mine, theirs, { l1: 'cloud' });
    await resolveConflict('u', 'doc', { kind: 'merged', title: 'Tema', content: merged });
    const reasons = (await db.versions.where('documentId').equals('doc').toArray()).map((v) => v.reason);
    expect(reasons).toEqual(expect.arrayContaining(['conflict-device', 'conflict-cloud']));
    expect(JSON.stringify((await db.documents.get('doc'))!.content)).toContain('version de la nube');
  });
});
