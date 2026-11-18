import type { LibraryNode, MusicalDocument } from '@/core/model';
import { ancestry, pathOf } from '@/data/paths';

/**
 * The library's own hierarchy, read for Practice (no second structure): a folder holds folders, songs and loose
 * materials; a song holds its parts (documents whose songId is the song). Same rules the Library screen uses.
 */
export type Level = {
  /** The folder or song being looked at; null is the library root. */
  at: LibraryNode | null;
  trail: LibraryNode[];
  nodes: LibraryNode[];
  documents: MusicalDocument[];
};

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'es');

export function levelOf(nodes: LibraryNode[], documents: MusicalDocument[], atId: string | null): Level {
  const at = atId ? (nodes.find((node) => node.id === atId) ?? null) : null;
  const here = at?.id ?? null;
  const children = nodes.filter((node) => (node.parentId ?? null) === here).sort(byName);
  const docs = (at?.kind === 'song' ? documents.filter((doc) => doc.songId === at.id) : documents.filter((doc) => !doc.songId && (doc.nodeId ?? null) === here)).sort(
    (a, b) => (at?.kind === 'song' ? a.createdAt - b.createdAt : a.title.localeCompare(b.title, 'es')),
  );
  return { at, trail: at ? ancestry(nodes, at.id) : [], nodes: at?.kind === 'song' ? [] : children, documents: docs };
}

/** Where a document lives: its song if it has one, else its folder, else the root. */
export function locationOf(nodes: LibraryNode[], doc: Pick<MusicalDocument, 'songId' | 'nodeId'> | undefined): string | null {
  const id = doc?.songId ?? doc?.nodeId ?? null;
  return id && nodes.some((node) => node.id === id) ? id : null;
}

/** The other parts of the same song, in the order they were created (the document itself included). */
export function partsOf(documents: MusicalDocument[], doc: Pick<MusicalDocument, 'songId'> | undefined): MusicalDocument[] {
  if (!doc?.songId) return [];
  return documents.filter((item) => item.songId === doc.songId).sort((a, b) => a.createdAt - b.createdAt);
}

/** How many materials sit anywhere below a node: shown next to a folder so it is not a blind door. */
export function countBelow(nodes: LibraryNode[], documents: MusicalDocument[], node: LibraryNode): number {
  const down = new Set([node.id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const item of nodes) {
      if (item.parentId && down.has(item.parentId) && !down.has(item.id)) {
        down.add(item.id);
        grew = true;
      }
    }
  }
  return documents.filter((doc) => (doc.nodeId && down.has(doc.nodeId)) || (doc.songId && down.has(doc.songId))).length;
}

export type Hit = { document: MusicalDocument; where: string };
/** Title search across the whole library, each result with the path it lives in. */
export function searchMaterials(nodes: LibraryNode[], documents: MusicalDocument[], query: string, limit = 30): Hit[] {
  const text = query.trim().toLocaleLowerCase('es');
  if (!text) return [];
  return documents
    .filter((doc) => (doc.title || '').toLocaleLowerCase('es').includes(text))
    .slice(0, limit)
    .map((doc) => ({ document: doc, where: pathOf(nodes, doc.songId ?? doc.nodeId) }));
}
