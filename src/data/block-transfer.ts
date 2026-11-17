import type { MusicalDocument, NoteComment, NotebookBlock, NotebookContent } from '@/core/model';
import { appendBlocks, fromNotebook, pruneComments, toNotebook } from '@/core/notebook';
import { db } from '@/data/database';
import { belongsToOwner, libraryScope } from '@/data/library-scope';

declare global {
  interface Window {
    /** Test hook: makes the next transfer fail after writing, to prove nothing is left half done. */
    __GUITARAP_FAIL_TRANSFER?: boolean;
  }
}

export type TransferReceipt = { documentId: string; title: string; blockIds: string[] };
type Options = { failAfterWrite?: boolean };

async function loadWritable(id: string): Promise<MusicalDocument> {
  const document = await db.documents.get(id);
  if (!document) throw new Error('La canción de destino no existe.');
  if (document.deletedAt) throw new Error('La canción de destino está en la papelera.');
  // Cross-owner writes are refused here too, not only in the interface.
  if (!belongsToOwner(document, await libraryScope())) throw new Error('No tenés permiso para escribir en esa canción.');
  return document;
}

/**
 * Puts blocks (and their comments) at the end of another document in ONE IndexedDB transaction, after keeping a
 * recovery version of that document. If anything fails the transaction rolls back and the destination is exactly
 * as it was. Callers always write the destination first and remove from the source afterwards, so a failure can
 * duplicate content but never lose it.
 */
export async function appendBlocksToDocument(targetId: string, blocks: NotebookBlock[], comments: NoteComment[] = [], options: Options = {}): Promise<TransferReceipt> {
  return db.transaction('rw', db.documents, db.versions, db.settings, async () => {
    const target = await loadWritable(targetId);
    const notebook = toNotebook(target);
    const next: NotebookContent = appendBlocks(notebook, blocks, comments);
    await db.versions.add({ id: crypto.randomUUID(), documentId: target.id, createdAt: Date.now(), reason: 'manual', title: target.title, content: structuredClone(target.content), ownerId: target.ownerId });
    await db.documents.put({ ...target, content: fromNotebook(target, next), rev: target.rev + 1, updatedAt: Date.now() });
    if (options.failAfterWrite || (typeof window !== 'undefined' && window.__GUITARAP_FAIL_TRANSFER)) {
      window.__GUITARAP_FAIL_TRANSFER = false;
      throw new Error('Falló el guardado en la canción de destino.');
    }
    return { documentId: target.id, title: target.title, blockIds: blocks.map((block) => block.id) };
  });
}

/** Takes blocks (and their comments) back out of a document: the undo of a move or a copy. */
export async function removeBlocksFromDocument(documentId: string, blockIds: string[]): Promise<void> {
  await db.transaction('rw', db.documents, db.versions, db.settings, async () => {
    const target = await loadWritable(documentId);
    const notebook = toNotebook(target);
    const gone = new Set(blockIds);
    const next = pruneComments({ ...notebook, blocks: notebook.blocks.filter((block) => !gone.has(block.id)) });
    await db.versions.add({ id: crypto.randomUUID(), documentId: target.id, createdAt: Date.now(), reason: 'manual', title: target.title, content: structuredClone(target.content), ownerId: target.ownerId });
    await db.documents.put({ ...target, content: fromNotebook(target, next), rev: target.rev + 1, updatedAt: Date.now() });
  });
}
