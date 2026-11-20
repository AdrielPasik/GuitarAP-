import type { NotebookContent, MusicalDocument } from '@/core/model';
import { db } from '@/data/database';
import { belongsToOwner, type Scope } from '@/data/library-scope';

/**
 * Edits that could not be written into their document (the record vanished, or is no longer the same person's, or the
 * database refused) are kept here instead of being thrown away. An editor also writes what it holds here as soon as it
 * changes (a journal: one write at a time, always the latest, no timer), so a closed tab or a crash cannot lose typing
 * either; a successful save removes it. A draft belongs to the account that was typing: it is
 * stored under that account, listed and read only for it, and never sent anywhere. Recovering one is an explicit act
 * that first leaves a recovery point of the current document.
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
};
const key = (ownerId: string | null, documentId: string) => `draft:${ownerId ?? 'anon'}:${documentId}`;

export async function writeDraft(draft: Draft) {
  await db.settings.put({ key: key(draft.ownerId, draft.documentId), value: draft, updatedAt: draft.savedAt });
}
export async function deleteDraft(ownerId: string | null, documentId: string) {
  await db.settings.delete(key(ownerId, documentId));
}
/** The draft of a document, only if it belongs to the person on screen. */
export async function readDraft(documentId: string, scope: Pick<Scope, 'ownerId' | 'locked'>): Promise<Draft | undefined> {
  const stored = (await db.settings.get(key(scope.ownerId, documentId)))?.value as Draft | undefined;
  return stored && belongsToOwner({ ownerId: stored.ownerId ?? undefined }, scope) ? stored : undefined;
}
export async function listDrafts(scope: Pick<Scope, 'ownerId' | 'locked'>): Promise<Draft[]> {
  const all = await db.settings.where('key').startsWith('draft:').toArray();
  return all.map((row) => row.value as Draft).filter((draft) => belongsToOwner({ ownerId: draft.ownerId ?? undefined }, scope));
}
