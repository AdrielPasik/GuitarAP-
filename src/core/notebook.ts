import {
  createFretboardContent,
  createTablatureContent,
  type FretboardContent,
  type MusicalDocument,
  type NoteComment,
  type NotebookBlock,
  type NotebookContent,
  type TablatureContent,
  type TextBlockStyle,
} from '@/core/model';

/**
 * A GuitarAP document is always edited as a notebook (an ordered list of musical blocks).
 * Documents saved before notebooks existed hold a bare tablature or fretboard: they are
 * wrapped on load and written back in their original shape for as long as they remain a
 * single, untitled block. That keeps old data, old devices and the SQL `type` valid.
 */
export type DocumentKind = 'tablature' | 'map' | 'mixed' | 'melody' | 'lyrics' | 'chords' | 'composition';
type Shaped = Pick<MusicalDocument, 'id' | 'type' | 'content'>;

export const isNotebook = (content: unknown): content is NotebookContent =>
  typeof content === 'object' &&
  content !== null &&
  (content as { kind?: unknown }).kind === 'notebook' &&
  Array.isArray((content as { blocks?: unknown }).blocks);

const mainBlockId = (documentId: string) => `${documentId}:main`;

function normalizeTablature(content: TablatureContent): TablatureContent {
  return { ...content, techniqueLinks: content.techniqueLinks ?? [], annotations: content.annotations ?? [] };
}

export function toNotebook(document: Shaped): NotebookContent {
  if (isNotebook(document.content)) {
    return {
      ...document.content,
      blocks: document.content.blocks.map((block) =>
        block.kind === 'tablature' ? { ...block, content: normalizeTablature(block.content) } : block,
      ),
    };
  }
  const block: NotebookBlock =
    document.type === 'fretboard'
      ? { id: mainBlockId(document.id), kind: 'map', content: document.content as FretboardContent }
      : {
          id: mainBlockId(document.id),
          kind: 'tablature',
          content: normalizeTablature(document.content as TablatureContent),
        };
  return { kind: 'notebook', version: 1, blocks: [block] };
}

/** Inverse of `toNotebook`: a lone untitled block is saved in its legacy shape. */
export function fromNotebook(document: Pick<MusicalDocument, 'type'>, notebook: NotebookContent) {
  const [only] = notebook.blocks;
  const hasContext = Boolean(notebook.meta && Object.keys(notebook.meta).length) || Boolean(notebook.comments?.length);
  if (!hasContext && notebook.blocks.length === 1 && only.kind !== 'text' && !only.title?.trim()) {
    if (only.kind === 'tablature' && document.type === 'tablature') return only.content;
    if (only.kind === 'map' && document.type === 'fretboard') return only.content;
  }
  return notebook;
}

export function documentKind(document: Shaped): DocumentKind {
  const kinds = new Set(toNotebook(document).blocks.map((block) => block.kind));
  const music = ['tablature', 'map', 'melody', 'chords'].filter((kind) => kinds.has(kind as NotebookBlock['kind']));
  if (kinds.has('lyrics') && music.length > 0) return 'composition';
  if (music.length > 1) return kinds.has('melody') || kinds.has('chords') ? 'composition' : 'mixed';
  if (kinds.has('melody')) return 'melody';
  if (kinds.has('chords')) return 'chords';
  if (kinds.has('lyrics')) return 'lyrics';
  if (kinds.has('map')) return 'map';
  if (kinds.has('tablature')) return 'tablature';
  return document.type === 'fretboard' ? 'map' : 'tablature';
}

export function newBlock(kind: NotebookBlock['kind'], style: TextBlockStyle = 'note'): NotebookBlock {
  const id = crypto.randomUUID();
  if (kind === 'tablature') return { id, kind, content: createTablatureContent() };
  if (kind === 'map') return { id, kind, content: createFretboardContent() };
  if (kind === 'melody') return { id, kind, content: { version: 1, events: [] } };
  if (kind === 'lyrics') return { id, kind, content: { text: '' } };
  if (kind === 'chords') return { id, kind, content: { version: 1, items: [] } };
  return { id, kind: 'text', style, text: '' };
}

/** Deep copy with fresh ids, keeping technique links consistent with the new column ids. */
export function cloneBlock(block: NotebookBlock): NotebookBlock {
  const copy = structuredClone(block);
  copy.id = crypto.randomUUID();
  if (copy.kind === 'tablature') {
    const ids = new Map(copy.content.columns.map((column) => [column.id, crypto.randomUUID()]));
    copy.content.columns = copy.content.columns.map((column) => ({ ...column, id: ids.get(column.id)! }));
    copy.content.techniqueLinks = (copy.content.techniqueLinks ?? []).map((link) => ({
      ...link,
      id: crypto.randomUUID(),
      from: { ...link.from, columnId: ids.get(link.from.columnId)! },
      to: { ...link.to, columnId: ids.get(link.to.columnId)! },
    }));
  } else if (copy.kind === 'melody') {
    copy.content.events = copy.content.events.map((event) => ({ ...event, id: crypto.randomUUID() }));
  } else if (copy.kind === 'chords') {
    copy.content.items = copy.content.items.map((item) => ({ ...item, id: crypto.randomUUID() }));
  } else if (copy.kind === 'map') {
    const ids = new Map(copy.content.positions.map((position) => [position.id, crypto.randomUUID()]));
    copy.content.positions = copy.content.positions.map((position) => ({ ...position, id: ids.get(position.id)! }));
    copy.content.selectedPositionId = ids.get(copy.content.selectedPositionId) ?? copy.content.positions[0].id;
  }
  return copy;
}

export function insertBlock(notebook: NotebookContent, block: NotebookBlock, afterIndex = notebook.blocks.length - 1) {
  const at = Math.max(-1, Math.min(afterIndex, notebook.blocks.length - 1)) + 1;
  return { ...notebook, blocks: [...notebook.blocks.slice(0, at), block, ...notebook.blocks.slice(at)] };
}

/** Ids of the musical events a block owns (comment targets inside it). */
function eventIdsOf(block: NotebookBlock): Set<string> {
  if (block.kind === 'melody') return new Set(block.content.events.map((event) => event.id));
  if (block.kind === 'chords') return new Set(block.content.items.map((item) => item.id));
  if (block.kind === 'tablature') return new Set(block.content.columns.map((column) => column.id));
  return new Set();
}

/** Drops comments whose block or event no longer exists, so no reference is left dangling. */
export function pruneComments(notebook: NotebookContent): NotebookContent {
  if (!notebook.comments?.length) return notebook;
  const blocks = new Map(notebook.blocks.map((block) => [block.id, block]));
  const kept = notebook.comments.filter((comment) => {
    if (!comment.blockId) return true;
    const block = blocks.get(comment.blockId);
    if (!block) return false;
    return !comment.eventId || eventIdsOf(block).has(comment.eventId);
  });
  return kept.length === notebook.comments.length ? notebook : { ...notebook, comments: kept };
}

export function updateBlock(notebook: NotebookContent, id: string, change: (block: NotebookBlock) => NotebookBlock) {
  return pruneComments({ ...notebook, blocks: notebook.blocks.map((block) => (block.id === id ? change(block) : block)) });
}

/** Removing a block removes its comments with it; undoing the removal restores both (they live in one document). */
export function removeBlock(notebook: NotebookContent, id: string) {
  return pruneComments({ ...notebook, blocks: notebook.blocks.filter((block) => block.id !== id) });
}

export function addComment(notebook: NotebookContent, target: { blockId?: string; eventId?: string }, text: string): { notebook: NotebookContent; comment: NoteComment } {
  const now = Date.now();
  const comment: NoteComment = { id: crypto.randomUUID(), text, createdAt: now, updatedAt: now, ...target };
  return { notebook: { ...notebook, comments: [...(notebook.comments ?? []), comment] }, comment };
}
export const editComment = (notebook: NotebookContent, id: string, text: string): NotebookContent => ({
  ...notebook,
  comments: (notebook.comments ?? []).map((comment) => (comment.id === id ? { ...comment, text, updatedAt: Date.now() } : comment)),
});
export const deleteComment = (notebook: NotebookContent, id: string): NotebookContent => {
  const comments = (notebook.comments ?? []).filter((comment) => comment.id !== id);
  const { comments: _old, ...rest } = notebook;
  void _old;
  return comments.length ? { ...rest, comments } : rest;
};
export const commentsFor = (notebook: NotebookContent, blockId?: string, eventId?: string) =>
  (notebook.comments ?? []).filter((comment) => comment.blockId === blockId && (eventId === undefined || comment.eventId === eventId));

export function setMeta(notebook: NotebookContent, patch: Partial<NonNullable<NotebookContent['meta']>>): NotebookContent {
  const meta = { ...notebook.meta, ...patch };
  for (const key of Object.keys(meta) as Array<keyof typeof meta>) if (meta[key] === undefined) delete meta[key];
  const { meta: _old, ...rest } = notebook;
  void _old;
  return Object.keys(meta).length ? { ...rest, meta } : rest;
}

export function duplicateBlock(notebook: NotebookContent, id: string) {
  const index = notebook.blocks.findIndex((block) => block.id === id);
  if (index < 0) return notebook;
  return insertBlock(notebook, cloneBlock(notebook.blocks[index]), index);
}

export function moveBlock(notebook: NotebookContent, id: string, offset: -1 | 1) {
  const index = notebook.blocks.findIndex((block) => block.id === id);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= notebook.blocks.length) return notebook;
  const blocks = [...notebook.blocks];
  [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
  return { ...notebook, blocks };
}

export type OutlineItem = { id: string; label: string; kind: NotebookBlock['kind'] };

/** Headings and titled blocks, used for section navigation in practice mode. */
export function notebookOutline(notebook: NotebookContent): OutlineItem[] {
  return notebook.blocks.flatMap((block): OutlineItem[] => {
    if (block.kind === 'text') {
      const first = block.text.trim().split('\n')[0];
      return block.style === 'heading' && first ? [{ id: block.id, label: first, kind: block.kind }] : [];
    }
    return block.title?.trim() ? [{ id: block.id, label: block.title.trim(), kind: block.kind }] : [];
  });
}
