import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/database';
import { belongsToOwner, libraryScope } from '@/data/library-scope';

export function useLibrary() {
  return useLiveQuery(async () => {
    const scope = await libraryScope(); const [allNodes, allDocuments] = await Promise.all([db.nodes.toArray(), db.documents.toArray()]);
    const nodes = allNodes.filter((node) => belongsToOwner(node, scope) && !node.deletedAt).sort((a, b) => a.name.localeCompare(b.name));
    const documents = allDocuments.filter((document) => belongsToOwner(document, scope) && !document.deletedAt).sort((a, b) => a.updatedAt - b.updatedAt);
    return { nodes, documents: documents.reverse() };
  }, []) ?? { nodes: [], documents: [] };
}
