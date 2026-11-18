import type { LibraryNode, MusicalDocument } from '@/core/model';
import { db } from '@/data/database';
import { activeOwnerId, belongsToOwner, libraryScope } from '@/data/library-scope';

/**
 * What sharing a folder or a song project reaches, on this device. It mirrors the server rule exactly
 * (private.documents_under in migration 0007): every live document that sits in the node, in any live folder or song
 * below it, or whose song is one of those. Used to warn BEFORE sharing when some part has not reached the cloud yet.
 */
export async function projectParts(nodeId: string): Promise<MusicalDocument[]> {
  const scope = await libraryScope();
  const nodes = (await db.nodes.toArray()).filter((node) => belongsToOwner(node, scope) && !node.deletedAt);
  const live = new Set(nodes.map((node) => node.id));
  if (!live.has(nodeId)) return [];
  const down = new Set([nodeId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const node of nodes) {
      if (node.parentId && down.has(node.parentId) && !down.has(node.id)) {
        down.add(node.id);
        grew = true;
      }
    }
  }
  const documents = await db.documents.toArray();
  return documents.filter((doc) => belongsToOwner(doc, scope) && !doc.deletedAt && ((doc.nodeId && down.has(doc.nodeId)) || (doc.songId && down.has(doc.songId))));
}

/** The container a document belongs to for sharing: its song project if it has one, else its folder. */
export async function containerOf(doc: Pick<MusicalDocument, 'nodeId' | 'songId'>): Promise<LibraryNode | null> {
  const id = doc.songId ?? doc.nodeId;
  if (!id) return null;
  const owner = await activeOwnerId();
  const node = await db.nodes.get(id);
  return node && !node.deletedAt && (owner ? node.ownerId === owner : !node.ownerId) ? node : null;
}
