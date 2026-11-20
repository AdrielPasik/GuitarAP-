import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicalDocument } from '@/core/model';
import { db } from '@/data/database';
import { deleteDraftsOf, draftsOf, listDrafts, readDraft, writeDraft } from '@/data/drafts';
import { authenticated } from '@/data/identity';
import { libraryRepository as repo, type EditTicket } from '@/data/library-repository';
import { activateOwner, libraryScope } from '@/data/library-scope';
import { useNotebookDocument } from '@/features/notebook/useNotebookDocument';

/**
 * v0.8 phase 1.4, part 1 — the window between typing and the disk. An edit is "saved" only when IndexedDB confirmed it;
 * until then the editor says so, and the browser is asked to warn before the page is left. Everything here runs on a
 * throwaway database with made-up accounts.
 */
const A = 'user-a';
const setup = async () => {
  await activateOwner(A);
  const created = await repo.createStudyMaterial('Material de prueba');
  const ticket = await repo.openForEdit(created);
  return { created, ticket };
};
const mount = (document: MusicalDocument, ticket: EditTicket) => renderHook(() => useNotebookDocument(document, false, ticket));
const beforeUnload = () => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

beforeEach(() => {
  window.localStorage.clear();
  window.__GUITARAP_AUTOSAVE_DELAY = 600_000; // only the lifecycle and the journal may save in these tests
});
afterEach(async () => {
  vi.restoreAllMocks();
  window.__GUITARAP_AUTOSAVE_DELAY = undefined;
  await db.delete();
  await db.open();
});

describe('what the editor says about an edit, and when', () => {
  it('is "Guardando…" from the keystroke until the document itself is written, never "Guardado" in between', async () => {
    const { created, ticket } = await setup();
    const { result } = mount(created, ticket);
    expect(result.current.saveState).toBe('saved');
    act(() => result.current.setTitle('Escribí algo'));
    expect(result.current.saveState).toBe('saving'); // immediately, not after a timer
    await waitFor(async () => expect((await readDraft(created.id, await libraryScope()))?.title).toBe('Escribí algo')); // the journal reached the disk
    expect(result.current.saveState).toBe('saving'); // on disk as a draft is safer, but it is not "saved"
    await act(async () => {
      await result.current.retry(); // the lifecycle finishes the save
    });
    expect(result.current.saveState).toBe('saved');
    expect((await db.documents.get(created.id))?.title).toBe('Escribí algo');
    expect(await listDrafts(await libraryScope())).toEqual([]); // and the draft is gone
  });
  it('the journal write starts in the same task as the keystroke (it does not wait for a timer or a paint)', async () => {
    const { created, ticket } = await setup();
    const put = vi.spyOn(db.settings, 'put');
    const { result } = mount(created, ticket);
    act(() => result.current.setTitle('Inmediato'));
    expect(put.mock.calls.some(([row]) => String((row as { key: string }).key).startsWith('draft:'))).toBe(true); // already issued when act() returns
  });
  it('a disk that refuses the write is reported as an error, not as saved, and the browser is asked to warn', async () => {
    const { created, ticket } = await setup();
    const original = db.settings.put.bind(db.settings);
    vi.spyOn(db.settings, 'put').mockImplementation(((row: { key: string }) => (String(row.key).startsWith('draft:') ? Promise.reject(new Error('cuota agotada (simulada)')) : original(row as never))) as unknown as typeof db.settings.put);
    const { result } = mount(created, ticket);
    act(() => result.current.setTitle('No cabe'));
    await waitFor(() => expect(result.current.saveState).toBe('error'));
    expect(beforeUnload()).toBe(true);
  });
  it('asks the browser to warn while a write is in flight, and stops asking once it is confirmed', async () => {
    const { created, ticket } = await setup();
    const original = db.settings.put.bind(db.settings);
    vi.spyOn(db.settings, 'put').mockImplementation(((row: { key: string }) =>
      String(row.key).startsWith('draft:') ? new Promise((resolve) => setTimeout(() => resolve(original(row as never)), 150)) : original(row as never)) as unknown as typeof db.settings.put);
    const { result } = mount(created, ticket);
    act(() => result.current.setTitle('Lento'));
    expect(beforeUnload()).toBe(true); // slow disk: leaving now could lose it
    await waitFor(async () => expect((await readDraft(created.id, await libraryScope()))?.title).toBe('Lento'));
    await waitFor(() => expect(beforeUnload()).toBe(false)); // confirmed on disk
  });
  it('closing the editor right after typing finishes the save for its owner', async () => {
    const { created, ticket } = await setup();
    const { result, unmount } = mount(created, ticket);
    act(() => result.current.setTitle('Cierre inmediato'));
    unmount(); // the screen goes away at once
    await waitFor(async () => expect((await db.documents.get(created.id))?.title).toBe('Cierre inmediato'));
  });
  it('a failing save after the journal keeps the edit as a draft of its owner', async () => {
    const { created, ticket } = await setup();
    const { result } = mount(created, ticket);
    act(() => result.current.setTitle('Se cae el guardado'));
    await waitFor(async () => expect(await readDraft(created.id, await libraryScope())).toBeTruthy());
    vi.spyOn(db.documents, 'put').mockRejectedValueOnce(new Error('simulado'));
    await act(async () => {
      await result.current.retry();
    });
    expect(result.current.saveState).toBe('draft');
    expect((await db.documents.get(created.id))?.title).toBe('Material de prueba'); // untouched
    expect((await readDraft(created.id, await libraryScope()))?.title).toBe('Se cae el guardado');
  });
});

describe('undoing back to what is stored', () => {
  it('leaves "Guardado" and no stale draft (the state that was undone must not be offered back later)', async () => {
    const { created, ticket } = await setup();
    const { result } = mount(created, ticket);
    act(() => result.current.setTitle('Un cambio que se deshace'));
    await waitFor(async () => expect(await readDraft(created.id, await libraryScope())).toBeTruthy());
    expect(result.current.saveState).toBe('saving');
    act(() => result.current.setTitle(created.title)); // back to exactly what is stored
    await waitFor(() => expect(result.current.saveState).toBe('saved'));
    await waitFor(async () => expect(await readDraft(created.id, await libraryScope())).toBeUndefined());
  });
});

describe('two tabs editing the same document', () => {
  it('each tab keeps its own draft; neither overwrites the other', async () => {
    const { created } = await setup();
    const base = { documentId: created.id, ownerId: A, content: created.content, baseRev: created.rev, reason: 'journal' as const };
    await writeDraft({ ...base, title: 'Pestaña uno', savedAt: 100, tab: 'one' });
    await writeDraft({ ...base, title: 'Pestaña dos', savedAt: 200, tab: 'two' });
    const scope = await libraryScope();
    expect((await draftsOf(created.id, scope)).map((draft) => draft.title)).toEqual(['Pestaña uno', 'Pestaña dos']);
    expect((await readDraft(created.id, scope))?.title).toBe('Pestaña dos'); // the most recent is the one offered
  });
  it('recovering applies the newest after a recovery point and keeps every draft in the history; nothing is lost', async () => {
    const { created } = await setup();
    const base = { documentId: created.id, ownerId: A, content: created.content, baseRev: created.rev, reason: 'journal' as const };
    await writeDraft({ ...base, title: 'Pestaña uno', savedAt: 100, tab: 'one' });
    await writeDraft({ ...base, title: 'Pestaña dos', savedAt: 200, tab: 'two' });
    await repo.resolveDrafts(created.id, 'apply');
    expect((await db.documents.get(created.id))?.title).toBe('Pestaña dos');
    const titles = (await db.versions.where('documentId').equals(created.id).toArray()).map((version) => version.title);
    expect(titles).toEqual(expect.arrayContaining(['Pestaña uno (borrador guardado)', 'Pestaña dos (borrador recuperado)', 'Material de prueba']));
    expect(await listDrafts(await libraryScope())).toEqual([]);
  });
  it('discarding leaves the document as it is and still keeps every draft in the history', async () => {
    const { created } = await setup();
    await writeDraft({ documentId: created.id, ownerId: A, title: 'No lo quiero', content: created.content, baseRev: 1, savedAt: 100, reason: 'journal', tab: 'one' });
    await repo.resolveDrafts(created.id, 'keep-in-history');
    expect((await db.documents.get(created.id))?.title).toBe('Material de prueba');
    expect((await db.versions.where('documentId').equals(created.id).toArray()).map((version) => version.title)).toContain('No lo quiero (borrador guardado)');
    expect(await listDrafts(await libraryScope())).toEqual([]);
  });
  it('a save that finds the document changed by someone else keeps what was there in the history, whatever the throttle says', async () => {
    const { created, ticket } = await setup();
    await repo.saveEdit(ticket, { ...created, title: 'Primera' }, 'autosave', { expectedRev: created.rev }); // leaves a recent version
    const before = await db.versions.where('documentId').equals(created.id).count();
    await db.documents.update(created.id, { title: 'Escrita por la otra pestaña', rev: 9 }); // the other tab saved meanwhile
    await repo.saveEdit(ticket, { ...created, title: 'Segunda' }, 'autosave', { expectedRev: 2 });
    const versions = await db.versions.where('documentId').equals(created.id).toArray();
    expect(versions.length).toBe(before + 1); // a checkpoint even though the throttle would have skipped it
    expect(versions.map((version) => version.title)).toContain('Escrita por la otra pestaña');
  });
  it('drafts of the first account are invisible to the second one in the same browser', async () => {
    const { created } = await setup();
    await writeDraft({ documentId: created.id, ownerId: A, title: 'Mío', content: created.content, baseRev: 1, savedAt: 1, reason: 'journal', tab: 'one' });
    await authenticated('user-b');
    const scope = await libraryScope();
    expect(await draftsOf(created.id, scope)).toEqual([]);
    expect(await listDrafts(scope)).toEqual([]);
    await authenticated(A);
    expect((await draftsOf(created.id, await libraryScope())).length).toBe(1);
    await deleteDraftsOf(A, created.id);
  });
});
