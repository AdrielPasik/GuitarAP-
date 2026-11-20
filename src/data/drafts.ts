import type { NotebookContent, MusicalDocument } from '@/core/model';
import { db } from '@/data/database';
import { belongsToOwner, type Scope } from '@/data/library-scope';

/**
 * Edits that could not be written into their document (the record vanished, or is no longer the same person's, or the
 * database refused) are kept here instead of being thrown away. An editor also writes what it holds here the moment it
 * changes (a journal: one write at a time, always the latest, no timer), so a closed tab or a crash cannot lose typing
 * either; a successful save removes it. A draft belongs to the account that was typing: it is stored under that
 * account, listed and read only for it, and never sent anywhere.
 *
 * Each TAB keeps its own draft of a document (the key carries a per-tab id), so two tabs editing the same document can
 * never overwrite each other's draft. When the owner recovers or discards, every draft of that document is first kept in
 * the document's history: nothing is thrown away by choosing.
 *
 * Honest limits (see docs/drafts-and-limits in the v0.8 plan): an edit is on disk only once IndexedDB confirms the
 * write; a browser or machine that dies in the milliseconds before that confirmation, or a storage that refuses writes,
 * cannot be helped. The editor says "Guardando…" until the confirmation and asks the browser to warn before leaving.
 */
export type Draft = {
  documentId: string;
  ownerId: string | null;
  title: string;
  content: MusicalDocument['content'] | NotebookContent;
  /** Revision of the document the edit started from, when it still existed. */
  baseRev: number | null;
  savedAt: number;
  reason: 'missing' | 'other-owner' | 'write-failed' | 'journal';
  /** Which tab wrote it (absent in drafts made before tabs were told apart). */
  tab?: string;
};
/** One id per page load: the tab this code is running in. */
export const TAB_ID = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random());
const prefix = (ownerId: string | null, documentId: string) => `draft:${ownerId ?? 'anon'}:${documentId}`;
const key = (ownerId: string | null, documentId: string, tab: string | undefined) => `${prefix(ownerId, documentId)}${tab ? `:${tab}` : ''}`;

export async function writeDraft(draft: Draft) {
  const tagged = { ...draft, tab: draft.tab ?? TAB_ID };
  await db.settings.put({ key: key(draft.ownerId, draft.documentId, tagged.tab), value: tagged, updatedAt: draft.savedAt });
}
/** Removes the draft THIS tab wrote (a save of this tab supersedes it). Other tabs' drafts are not touched. */
export async function deleteDraft(ownerId: string | null, documentId: string, tab: string | undefined = TAB_ID) {
  await db.settings.delete(key(ownerId, documentId, tab));
}
async function rowsOf(ownerId: string | null, documentId: string) {
  const base = prefix(ownerId, documentId);
  const rows = await db.settings.where('key').startsWith(base).toArray();
  // `draft:<owner>:<doc>` also prefixes `draft:<owner>:<doc>-other`: keep only this document's own keys.
  return rows.filter((row) => row.key === base || row.key.startsWith(`${base}:`));
}
/** Every draft of one document that belongs to the person on screen, oldest first. */
export async function draftsOf(documentId: string, scope: Pick<Scope, 'ownerId' | 'locked'>): Promise<Draft[]> {
  const found = (await rowsOf(scope.ownerId, documentId)).map((row) => row.value as Draft);
  return found.filter((draft) => belongsToOwner({ ownerId: draft.ownerId ?? undefined }, scope)).sort((a, b) => a.savedAt - b.savedAt);
}
/** The most recent draft of a document, only if it belongs to the person on screen. */
export async function readDraft(documentId: string, scope: Pick<Scope, 'ownerId' | 'locked'>): Promise<Draft | undefined> {
  return (await draftsOf(documentId, scope)).at(-1);
}
export async function deleteDraftsOf(ownerId: string | null, documentId: string) {
  await db.settings.bulkDelete((await rowsOf(ownerId, documentId)).map((row) => row.key));
}
export async function listDrafts(scope: Pick<Scope, 'ownerId' | 'locked'>): Promise<Draft[]> {
  const all = await db.settings.where('key').startsWith('draft:').toArray();
  return all.map((row) => row.value as Draft).filter((draft) => belongsToOwner({ ownerId: draft.ownerId ?? undefined }, scope));
}
