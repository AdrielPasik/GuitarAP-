import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTablatureContent, type MusicalDocument } from '@/core/model';
import { db } from '@/data/database';
import { listDrafts, readDraft, deleteDraft } from '@/data/drafts';
import { authenticated, signedOutExplicitly } from '@/data/identity';
import { libraryRepository as repo } from '@/data/library-repository';
import { AccessError, activateOwner, libraryScope } from '@/data/library-scope';
import { SyncEngine } from '@/features/sync/engine';
import { FakeTransport } from '@/features/sync/transport';

/**
 * v0.8 phase 1.3 prerequisite — the life of a pending edit. The original defect: an editor in one tab still holds the
 * last moments of typing when ANOTHER tab signs out; the strict gate then refused its save and the typing was lost.
 * Now an editor carries a ticket issued while it was allowed to edit, and what it holds is always finished for the
 * owner who typed it (or kept as that owner's draft), whoever is on screen by then.
 */
const A = 'user-a';
const B = 'user-b';
const doc = (id: string, ownerId: string, title = `Material ${id}`): MusicalDocument => ({ id, nodeId: null, songId: null, type: 'tablature', title, content: createTablatureContent(), rev: 1, createdAt: 1, updatedAt: 1, ownerId });
const edited = (original: MusicalDocument, title: string) => ({ ...original, title });
const visibleTitles = async () => {
  const scope = await libraryScope();
  const all = await db.documents.toArray();
  return all.filter((item) => (scope.ownerId ? item.ownerId === scope.ownerId : !item.ownerId)).map((item) => item.title).sort();
};

beforeEach(() => window.localStorage.clear());
afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete();
  await db.open();
});

describe('the original problem: someone else signs out while this editor still holds the last edit', () => {
  it('WITHOUT a ticket the strict gate refuses the save (what used to lose the edit)', async () => {
    await activateOwner(A);
    await db.documents.add(doc('d', A));
    await signedOutExplicitly();
    await expect(repo.saveDocument(edited(doc('d', A), 'Lo último que escribí'))).rejects.toBeInstanceOf(AccessError);
    expect((await db.documents.get('d'))?.title).toBe('Material d');
  });
  it('WITH a ticket the edit is finished for its owner after the sign-out, and stays hidden from everyone else', async () => {
    await activateOwner(A);
    await db.documents.add(doc('d', A));
    const ticket = await repo.openForEdit({ id: 'd' }); // issued while A was on screen
    await signedOutExplicitly(); // another tab signs out
    expect(await repo.saveEdit(ticket, edited(doc('d', A), 'Lo último que escribí'))).toBe('saved');
    expect(await visibleTitles()).toEqual([]); // nothing of A is shown to nobody
    await authenticated(B);
    expect(await visibleTitles()).toEqual([]); // nor to B
    await authenticated(A);
    expect(await visibleTitles()).toEqual(['Lo último que escribí']); // and A has it back
    const stored = await db.documents.get('d');
    expect(stored).toMatchObject({ title: 'Lo último que escribí', rev: 2, ownerId: A });
    expect(await db.versions.where('documentId').equals('d').count()).toBe(1); // a recovery point of what was there
  });
  it('also when the person on screen changes to another account', async () => {
    await activateOwner(A);
    await db.documents.bulkAdd([doc('d', A), doc('b', B)]);
    const ticket = await repo.openForEdit({ id: 'd' });
    await authenticated(B);
    expect(await repo.saveEdit(ticket, edited(doc('d', A), 'Para A'))).toBe('saved');
    expect((await db.documents.get('d'))?.ownerId).toBe(A);
    expect((await db.documents.get('b'))?.title).toBe('Material b'); // B's record is untouched
    expect(await visibleTitles()).toEqual(['Material b']);
  });
  it('also when the session simply expired (nothing about who is on screen changes)', async () => {
    await activateOwner(A);
    await db.documents.add(doc('d', A));
    const ticket = await repo.openForEdit({ id: 'd' });
    expect(await repo.saveEdit(ticket, edited(doc('d', A), 'Sin sesión'))).toBe('saved');
    expect(await visibleTitles()).toEqual(['Sin sesión']);
  });
});

describe('a ticket is not a way around the gate', () => {
  it('cannot be forged, reused for another document, or obtained for someone else\'s record', async () => {
    await activateOwner(A);
    await db.documents.bulkAdd([doc('d', A), doc('b', B)]);
    await expect(repo.saveEdit({ documentId: 'd', ownerId: A }, edited(doc('d', A), 'x'))).rejects.toBeInstanceOf(AccessError); // made up
    const ticket = await repo.openForEdit({ id: 'd' });
    await expect(repo.saveEdit(ticket, edited(doc('b', B), 'x'))).rejects.toBeInstanceOf(AccessError); // another document
    await expect(repo.openForEdit({ id: 'b' })).rejects.toBeInstanceOf(AccessError); // another account's record
    expect((await db.documents.get('b'))?.title).toBe('Material b');
  });
  it('never writes into a record that is not its owner\'s any more: the edit becomes that owner\'s draft', async () => {
    await activateOwner(A);
    await db.documents.add(doc('d', A));
    const ticket = await repo.openForEdit({ id: 'd' });
    await db.documents.put({ ...doc('d', B), title: 'Ahora es de B' }); // the record changed hands
    expect(await repo.saveEdit(ticket, edited(doc('d', A), 'Lo que tipeaba A'))).toBe('draft');
    expect((await db.documents.get('d'))?.title).toBe('Ahora es de B');
    await authenticated(B);
    expect(await readDraft('d', await libraryScope())).toBeUndefined();
    expect(await listDrafts(await libraryScope())).toEqual([]);
  });
});

describe('what cannot be saved safely is kept as a draft of the original account only', () => {
  it('a record that vanished: the edit is a draft, visible to its owner, hidden from others and from a signed-out profile', async () => {
    await activateOwner(A);
    await db.documents.add(doc('d', A));
    const ticket = await repo.openForEdit({ id: 'd' });
    await db.documents.delete('d');
    expect(await repo.saveEdit(ticket, edited(doc('d', A), 'No quiero perder esto'))).toBe('draft');
    expect((await readDraft('d', await libraryScope()))?.title).toBe('No quiero perder esto');
    await signedOutExplicitly();
    expect(await readDraft('d', await libraryScope())).toBeUndefined();
    expect(await listDrafts(await libraryScope())).toEqual([]);
    await authenticated(B);
    expect(await listDrafts(await libraryScope())).toEqual([]);
    await authenticated(A);
    expect(await listDrafts(await libraryScope())).toHaveLength(1); // back for its owner, intact
    await deleteDraft(A, 'd');
    expect(await listDrafts(await libraryScope())).toEqual([]);
  });
  it('a database that refuses the write: the document stays as it was and the edit is kept', async () => {
    await activateOwner(A);
    await db.documents.add(doc('d', A));
    const ticket = await repo.openForEdit({ id: 'd' });
    vi.spyOn(db.documents, 'put').mockRejectedValueOnce(new Error('cuota agotada (simulada)'));
    expect(await repo.saveEdit(ticket, edited(doc('d', A), 'Pendiente'))).toBe('draft');
    expect(await db.documents.get('d')).toMatchObject({ title: 'Material d', rev: 1 });
    expect((await readDraft('d', await libraryScope()))?.title).toBe('Pendiente');
  });
  it('a later successful save supersedes an older draft', async () => {
    await activateOwner(A);
    await db.documents.add(doc('d', A));
    const ticket = await repo.openForEdit({ id: 'd' });
    vi.spyOn(db.documents, 'put').mockRejectedValueOnce(new Error('simulado'));
    await repo.saveEdit(ticket, edited(doc('d', A), 'Primero'));
    expect(await listDrafts(await libraryScope())).toHaveLength(1);
    expect(await repo.saveEdit(ticket, edited(doc('d', A), 'Después'))).toBe('saved');
    expect(await listDrafts(await libraryScope())).toEqual([]);
  });
  it('recovering a draft is explicit and leaves a recovery point of the document', async () => {
    await activateOwner(A);
    await db.documents.add(doc('d', A, 'Original'));
    const ticket = await repo.openForEdit({ id: 'd' });
    vi.spyOn(db.documents, 'put').mockRejectedValueOnce(new Error('simulado'));
    await repo.saveEdit(ticket, edited(doc('d', A), 'Borrador'));
    const draft = (await readDraft('d', await libraryScope()))!;
    await repo.saveDocument({ ...doc('d', A), title: draft.title, content: draft.content as MusicalDocument['content'] }, 'manual');
    expect((await db.documents.get('d'))?.title).toBe('Borrador');
    expect((await db.versions.where('documentId').equals('d').toArray()).map((version) => version.title)).toContain('Original');
  });
});

describe('an edit finished for A is never sent while B is signed in', () => {
  it('the sync of B uploads nothing of A, and A\'s edit is still pending for when A returns', async () => {
    await activateOwner(A);
    await db.documents.add(doc('d', A));
    const ticket = await repo.openForEdit({ id: 'd' });
    await authenticated(B);
    await repo.saveEdit(ticket, edited(doc('d', A), 'Edición de A'));
    const remote = new FakeTransport();
    const report = await new SyncEngine(remote).sync(B);
    expect(report.pushed).toBe(0);
    expect(remote.size(B)).toBe(0);
    expect(remote.size(A)).toBe(0);
    await expect(new SyncEngine(remote).sync(A)).rejects.toThrow('no está vinculada'); // A's sync does not run for B's screen either
    await authenticated(A);
    expect((await new SyncEngine(remote).sync(A)).pushed).toBe(2); // the edit and its recovery point
  });
});
