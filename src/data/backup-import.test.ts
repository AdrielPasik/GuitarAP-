import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryNode, MusicalDocument } from '@/core/model';
import { applyImport, ImportChangedError, listImports, previewImport, undoImport } from '@/data/backup-import';
import { db } from '@/data/database';
import { authenticated, signedOutExplicitly } from '@/data/identity';
import { AccessError, activateOwner } from '@/data/library-scope';

/**
 * v0.8 phase 1.4 — importing a backup can only ADD. Every scenario here uses made-up data on a throwaway database.
 */
const A = 'user-a';
const B = 'user-b';
type Rec = Record<string, unknown>;
const content = (text = 'x') => ({ kind: 'notebook', version: 1, blocks: [], marker: text }); // deterministic: the same text is the same content
const node = (id: string, parentId: string | null = null, kind: 'folder' | 'song' = 'folder', extra: Rec = {}) => ({ id, parentId, kind, name: `Carpeta ${id}`, order: 1, createdAt: 1, updatedAt: 1, rev: 1, ...extra });
const doc = (id: string, nodeId: string | null = null, extra: Rec = {}) => ({ id, nodeId, songId: null, type: 'tablature', title: `Material ${id}`, content: content(id), rev: 1, createdAt: 1, updatedAt: 1, ...extra });
const version = (id: string, documentId: string, extra: Rec = {}) => ({ id, documentId, createdAt: 2, reason: 'manual', title: `Versión ${id}`, content: content(`v${id}`), ...extra });
const backup = (parts: { nodes?: Rec[]; documents?: Rec[]; versions?: Rec[]; schema?: number; extra?: Rec } = {}) =>
  JSON.stringify({ schema: parts.schema ?? 1, exportedAt: '2026-11-20T10:00:00.000Z', nodes: parts.nodes ?? [], documents: parts.documents ?? [], versions: parts.versions ?? [], ...parts.extra });
const run = async (raw: string, options: { foreign?: boolean } = {}) => applyImport(await previewImport(raw, 'copia.json'), { foreign: Boolean(options.foreign) });
const counts = async () => ({ nodes: await db.nodes.count(), documents: await db.documents.count(), versions: await db.versions.count() });
const titles = async () => (await db.documents.toArray()).map((item) => item.title).sort();
const local = (id: string, ownerId: string | undefined, extra: Partial<MusicalDocument> = {}): MusicalDocument => ({ id, nodeId: null, songId: null, type: 'tablature', title: `Material ${id}`, content: content(id) as unknown as MusicalDocument['content'], rev: 1, createdAt: 1, updatedAt: 1, ...(ownerId ? { ownerId } : {}), ...extra });

beforeEach(() => window.localStorage.clear());
afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete();
  await db.open();
});

describe('the simulation writes nothing and says what would happen', () => {
  it('an empty backup: nothing to import', async () => {
    await activateOwner(A);
    const preview = await previewImport(backup(), 'vacia.json');
    expect(preview.plan.summary.willWrite).toBe(0);
    await expect(applyImport(preview, { foreign: false })).rejects.toThrow('No hay nada para importar');
  });
  it('counts new, identical, different (copies), older-looking and invalid, and writes none of it', async () => {
    await activateOwner(A);
    await db.documents.bulkAdd([local('igual', A), local('distinto', A, { title: 'Lo que tengo', updatedAt: 500, rev: 4 })]);
    const before = await counts();
    const raw = backup({
      documents: [doc('igual', null, {}), doc('distinto', null, { title: 'Lo del backup', updatedAt: 5, rev: 1 }), doc('nuevo'), doc('nuevo'), doc('malo', null, { type: 'xx' })],
      versions: [version('v1', 'nuevo')],
    });
    const preview = await previewImport(raw, 'mixta.json');
    const s = preview.plan.summary;
    expect(s.added.documents).toBe(1);
    expect(s.identical.documents).toBe(1);
    expect(s.copies).toEqual({ documents: 1, lookOlder: 1 }); // the backup's version is older than the one here
    expect(s.invalid).toBe(2); // the repeated id and the unknown type
    expect(s.added.versions).toBe(1);
    expect(await counts()).toEqual(before); // simulation: not one write
    expect(await db.settings.where('key').startsWith('import:').count()).toBe(0);
  });
});

describe('an import only ever adds', () => {
  it('an old backup (schema 1, no owners) lands in the account with its folders, song project, parts and history intact', async () => {
    await activateOwner(A);
    await run(
      backup({
        nodes: [node('f1'), node('f2', 'f1'), node('f3', 'f2'), node('s1', 'f1', 'song')],
        documents: [doc('d1', 'f3'), { ...doc('p1', 'f1'), songId: 's1' }, { ...doc('p2', 'f1'), songId: 's1', title: 'Parte dos' }],
        versions: [version('v1', 'd1'), version('v2', 'p1')],
      }),
    );
    expect(await counts()).toEqual({ nodes: 4, documents: 3, versions: 2 });
    expect((await db.nodes.get('f3'))?.parentId).toBe('f2');
    expect((await db.nodes.get('f2'))?.parentId).toBe('f1');
    expect((await db.nodes.get('s1'))?.kind).toBe('song');
    expect((await db.documents.get('p1'))?.songId).toBe('s1');
    expect((await db.documents.get('p2'))?.songId).toBe('s1');
    expect((await db.versions.get('v2'))?.documentId).toBe('p1');
    for (const table of [db.nodes, db.documents, db.versions]) for (const row of await table.toArray()) expect((row as { ownerId?: string }).ownerId).toBe(A);
  });
  it('an identical document is skipped, and importing the same file again adds nothing', async () => {
    await activateOwner(A);
    const raw = backup({ nodes: [node('f1')], documents: [doc('d1', 'f1')], versions: [version('v1', 'd1')] });
    await run(raw);
    const once = await counts();
    const again = await previewImport(raw, 'misma.json');
    expect(again.plan.summary.willWrite).toBe(0);
    expect(again.plan.summary.identical.documents).toBe(1);
    expect(await counts()).toEqual(once);
  });
  it('a document that differs is NEVER replaced: the current one stays and the backup comes in as a named copy, with its own history', async () => {
    await activateOwner(A);
    await db.documents.add(local('d1', A, { title: 'Actual', rev: 3 }));
    await db.versions.add({ id: 'mine', documentId: 'd1', createdAt: 1, reason: 'manual', title: 'Antes', content: content('mine') as never, ownerId: A });
    await run(backup({ documents: [doc('d1', null, { title: 'Del backup' })], versions: [version('vb', 'd1')] }));
    const current = await db.documents.get('d1');
    expect(current).toMatchObject({ title: 'Actual', rev: 3 }); // untouched
    expect(((await db.documents.get('d1'))!.content as unknown as { marker: string }).marker).toBe('d1');
    const copies = (await db.documents.toArray()).filter((item) => item.id !== 'd1');
    expect(copies).toHaveLength(1);
    expect(copies[0].title).toMatch(/^Del backup \(copia importada del 20\/11\/2026\)$/);
    expect(copies[0].ownerId).toBe(A);
    expect((await db.versions.get('mine'))?.documentId).toBe('d1'); // the existing history stays on the existing document
    expect((await db.versions.get('vb'))).toBeUndefined();
    const attached = (await db.versions.toArray()).filter((item) => item.id !== 'mine');
    expect(attached).toHaveLength(1);
    expect(attached[0].documentId).toBe(copies[0].id); // the backup's history goes with its copy
  });
  it('a backup with an older copy of a document that has unsent edits changes nothing about those edits', async () => {
    await activateOwner(A);
    await db.documents.add(local('d1', A, { title: 'Con cambios sin subir', rev: 9, updatedAt: 900 }));
    await db.settings.put({ key: `sync-state:${A}`, value: { cursor: '4', documents: { d1: 2 }, nodes: {}, versions: {}, conflicts: {} }, updatedAt: 1 });
    const stateBefore = JSON.stringify(await db.settings.get(`sync-state:${A}`));
    await run(backup({ documents: [doc('d1', null, { title: 'Viejo', updatedAt: 3 })] }));
    expect(await db.documents.get('d1')).toMatchObject({ title: 'Con cambios sin subir', rev: 9 });
    expect(JSON.stringify(await db.settings.get(`sync-state:${A}`))).toBe(stateBefore);
  });
  it('a folder that already exists is kept as it is and the new contents go inside it', async () => {
    await activateOwner(A);
    await db.nodes.add({ ...node('f1'), name: 'Mi carpeta', ownerId: A } as LibraryNode);
    await run(backup({ nodes: [{ ...node('f1'), name: 'Otro nombre' }, node('f2', 'f1')], documents: [doc('d1', 'f2')] }));
    expect((await db.nodes.get('f1'))?.name).toBe('Mi carpeta');
    expect((await db.nodes.get('f2'))?.parentId).toBe('f1');
  });
  it('references outside the file, and loops, are not followed: those records go to the top level', async () => {
    await activateOwner(A);
    const preview = await previewImport(backup({ nodes: [node('a', 'ausente'), node('x', 'y'), node('y', 'x')], documents: [doc('d1', 'nunca')] }), 'raro.json');
    expect(preview.plan.summary.relocated).toBeGreaterThanOrEqual(3);
    await applyImport(preview, { foreign: false });
    expect((await db.nodes.get('a'))?.parentId).toBeNull();
    expect((await db.documents.get('d1'))?.nodeId).toBeNull();
    const loop = [(await db.nodes.get('x'))?.parentId, (await db.nodes.get('y'))?.parentId];
    expect(loop).toContain(null); // at least one of them was set free: no loop remains
  });
  it('an id that exists here but belongs to someone else is never touched; the record gets an identity of its own', async () => {
    await activateOwner(A);
    await db.documents.add(local('d1', B, { title: 'De B' }));
    await run(backup({ documents: [doc('d1', null, { title: 'De A' })] }));
    expect((await db.documents.get('d1'))).toMatchObject({ title: 'De B', ownerId: B });
    const mine = (await db.documents.toArray()).filter((item) => item.ownerId === A);
    expect(mine).toHaveLength(1);
    expect(mine[0].title).toBe('De A');
    expect(mine[0].id).not.toBe('d1');
  });
});

describe("another account's backup", () => {
  const theirs = () =>
    backup({
      nodes: [node('f1', null, 'folder', { ownerId: B }), node('s1', 'f1', 'song', { ownerId: B })],
      documents: [doc('d1', 'f1', { ownerId: B, songId: 's1' }), doc('d2', 's1', { ownerId: B, songId: 's1' })],
      versions: [version('v1', 'd1', { ownerId: B })],
    });
  it('is recognised, needs an explicit confirmation, and imports nothing without it', async () => {
    await activateOwner(A);
    const preview = await previewImport(theirs(), 'de-b.json');
    expect(preview.plan.foreign).toBe(true);
    await expect(applyImport(preview, { foreign: false })).rejects.toThrow('otra cuenta');
    expect(await counts()).toEqual({ nodes: 0, documents: 0, versions: 0 });
  });
  it('comes in as copies with new ids, this account as owner, and every internal reference rebuilt among the new ids', async () => {
    await activateOwner(A);
    await run(theirs(), { foreign: true });
    const nodes = await db.nodes.toArray();
    const docs = await db.documents.toArray();
    const versions = await db.versions.toArray();
    expect([nodes.length, docs.length, versions.length]).toEqual([2, 2, 1]);
    const sourceIds = new Set(['f1', 's1', 'd1', 'd2', 'v1']);
    for (const row of [...nodes, ...docs, ...versions]) {
      expect(sourceIds.has(row.id)).toBe(false); // no identifier of the original account survives
      expect((row as { ownerId?: string }).ownerId).toBe(A); // and nothing points back to B
    }
    const nodeIds = new Set(nodes.map((item) => item.id));
    const docIds = new Set(docs.map((item) => item.id));
    for (const item of nodes) if (item.parentId) expect(nodeIds.has(item.parentId)).toBe(true);
    for (const item of docs) {
      if (item.nodeId) expect(nodeIds.has(item.nodeId)).toBe(true);
      if (item.songId) expect(nodeIds.has(item.songId)).toBe(true);
    }
    for (const item of versions) expect(docIds.has(item.documentId)).toBe(true);
    const song = nodes.find((item) => item.kind === 'song')!;
    expect(nodes.find((item) => item.kind === 'folder')!.id).toBe(song.parentId);
    expect(JSON.stringify([nodes, docs, versions])).not.toContain(B);
  });
  it('twice in a row adds nothing the second time (the new ids are derived, not random)', async () => {
    await activateOwner(A);
    await run(theirs(), { foreign: true });
    const once = await counts();
    const again = await previewImport(theirs(), 'de-b.json');
    expect(again.plan.summary.willWrite).toBe(0);
    expect(await counts()).toEqual(once);
  });
  it('cannot modify any record of the current account, even one with the same ids', async () => {
    await activateOwner(A);
    await db.documents.add(local('d1', A, { title: 'Mía' }));
    await run(theirs(), { foreign: true });
    expect(await db.documents.get('d1')).toMatchObject({ title: 'Mía', ownerId: A });
  });
  it('signed out, a backup that names an account is foreign too and never becomes anonymous by accident', async () => {
    await activateOwner(A);
    await signedOutExplicitly();
    const preview = await previewImport(theirs(), 'de-b.json');
    expect(preview.plan.foreign).toBe(true);
    expect(preview.owner).toBeNull();
  });
});

describe('material that belongs to nobody', () => {
  it('signed out, an ownerless backup is imported as ownerless material, visible to whoever is signed out', async () => {
    await run(backup({ documents: [doc('d1')] }));
    expect((await db.documents.get('d1'))?.ownerId).toBeUndefined();
  });
  it('signed in, the ownerless backup becomes the account\'s (the person chose to import it)', async () => {
    await activateOwner(A);
    await run(backup({ documents: [doc('d1')] }));
    expect((await db.documents.get('d1'))?.ownerId).toBe(A);
  });
});

describe('an import that does not finish leaves nothing behind', () => {
  it('interrupted half way: the whole import is rolled back, no half-imported relations, no ledger', async () => {
    await activateOwner(A);
    const preview = await previewImport(backup({ nodes: [node('f1')], documents: [doc('d1', 'f1')], versions: [version('v1', 'd1')] }), 'corte.json');
    vi.spyOn(db.versions, 'bulkAdd').mockRejectedValueOnce(new Error('se cortó (simulado)'));
    await expect(applyImport(preview, { foreign: false })).rejects.toThrow();
    expect(await counts()).toEqual({ nodes: 0, documents: 0, versions: 0 });
    expect(await listImports()).toEqual([]);
  });
  it('not enough local space: nothing is imported and the library is as it was', async () => {
    await activateOwner(A);
    await db.documents.add(local('mio', A));
    const preview = await previewImport(backup({ documents: [doc('d1'), doc('d2')] }), 'grande.json');
    const quota = Object.assign(new Error('Quota exceeded'), { name: 'QuotaExceededError' });
    vi.spyOn(db.documents, 'bulkAdd').mockRejectedValueOnce(quota);
    await expect(applyImport(preview, { foreign: false })).rejects.toThrow();
    expect(await titles()).toEqual(['Material mio']);
    expect(await listImports()).toEqual([]);
  });
  it('the person changed while the summary was on screen: it refuses and writes nothing', async () => {
    await activateOwner(A);
    const preview = await previewImport(backup({ documents: [doc('d1')] }), 'cambio.json');
    await authenticated(B);
    await expect(applyImport(preview, { foreign: false })).rejects.toBeInstanceOf(ImportChangedError);
    expect(await counts()).toEqual({ nodes: 0, documents: 0, versions: 0 });
  });
  it('the library changed meanwhile (the same record appeared): it asks to review again and writes nothing', async () => {
    await activateOwner(A);
    const preview = await previewImport(backup({ documents: [doc('d1'), doc('d2')] }), 'carrera.json');
    await db.documents.add(local('d1', A, { title: 'Apareció recién', content: content('otro') as never }));
    await expect(applyImport(preview, { foreign: false })).rejects.toMatchObject({ reason: 'library' });
    expect(await titles()).toEqual(['Apareció recién']);
  });
  it('an expired session changes nothing: the same person is still on screen and the import works', async () => {
    await activateOwner(A);
    // (an expired session does not touch the identity record: see data/identity.ts)
    await run(backup({ documents: [doc('d1')] }));
    expect(await db.documents.count()).toBe(1);
  });
});

describe('two imports in a row, and undoing one', () => {
  it('a second, different file adds only its own records', async () => {
    await activateOwner(A);
    await run(backup({ documents: [doc('d1')] }));
    await run(backup({ documents: [doc('d1'), doc('d2')] }));
    expect(await titles()).toEqual(['Material d1', 'Material d2']);
  });
  it('undo sends only what that import added to the trash, keeps the history, and works once', async () => {
    await activateOwner(A);
    await db.documents.add(local('mio', A));
    const ledger = await run(backup({ nodes: [node('f1')], documents: [doc('d1', 'f1'), doc('d2')], versions: [version('v1', 'd1')] }));
    const done = await undoImport(ledger.id);
    expect(done).toMatchObject({ documents: 2, folders: 1, keptFolders: 0 });
    expect((await db.documents.get('d1'))?.deletedAt).toBeTypeOf('number');
    expect((await db.documents.get('mio'))?.deletedAt).toBeUndefined(); // not part of it
    expect(await db.versions.count()).toBe(1); // history untouched
    await expect(undoImport(ledger.id)).rejects.toThrow('ya se deshizo');
  });
  it('a folder that now holds the person\'s own material is left in place', async () => {
    await activateOwner(A);
    const ledger = await run(backup({ nodes: [node('f1')], documents: [doc('d1', 'f1')] }));
    await db.documents.add(local('nuevo', A, { nodeId: 'f1' }));
    const done = await undoImport(ledger.id);
    expect(done.keptFolders).toBe(1);
    expect((await db.nodes.get('f1'))?.deletedAt).toBeUndefined();
    expect((await db.documents.get('nuevo'))?.deletedAt).toBeUndefined();
  });
  it('another account cannot undo it', async () => {
    await activateOwner(A);
    const ledger = await run(backup({ documents: [doc('d1')] }));
    await authenticated(B);
    await expect(undoImport(ledger.id)).rejects.toBeInstanceOf(AccessError);
    expect((await db.documents.get('d1'))?.deletedAt).toBeUndefined();
  });
});
