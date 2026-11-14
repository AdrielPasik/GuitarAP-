import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/database';

export function useLibrary() {
  return useLiveQuery(async () => {
    const [nodes, documents] = await Promise.all([
      db.nodes.filter((node) => !node.deletedAt).sortBy('name'),
      db.documents.filter((document) => !document.deletedAt).sortBy('updatedAt'),
    ]);
    return { nodes, documents: documents.reverse() };
  }, []) ?? { nodes: [], documents: [] };
}
