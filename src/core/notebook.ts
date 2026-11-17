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
  if (kind === 'section') return { id, kind, title: '' };
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

/* ---------------- sections, moving and copying ---------------- */

/** Index range [start, end) of a section: its header plus the blocks that follow, up to the next section. */
export function sectionRange(notebook: NotebookContent, sectionId: string): [number, number] | null {
  const start = notebook.blocks.findIndex((block) => block.id === sectionId && block.kind === 'section');
  if (start < 0) return null;
  let end = start + 1;
  while (end < notebook.blocks.length && notebook.blocks[end].kind !== 'section') end += 1;
  return [start, end];
}

export const sectionsOf = (notebook: NotebookContent) =>
  notebook.blocks.flatMap((block, index) => (block.kind === 'section' ? [{ id: block.id, title: block.title, index }] : []));

/** The section a block belongs to (the closest section header above it), if any. */
export function sectionOfBlock(notebook: NotebookContent, blockId: string) {
  const index = notebook.blocks.findIndex((block) => block.id === blockId);
  for (let at = index; at >= 0; at -= 1) if (notebook.blocks[at].kind === 'section') return notebook.blocks[at].id;
  return null;
}

/** Moves a block to an exact position (used by drag and drop). `index` is where it ends up in the new list. */
export function moveBlockTo(notebook: NotebookContent, id: string, index: number): NotebookContent {
  const from = notebook.blocks.findIndex((block) => block.id === id);
  if (from < 0) return notebook;
  const blocks = [...notebook.blocks];
  const [block] = blocks.splice(from, 1);
  blocks.splice(Math.max(0, Math.min(index, blocks.length)), 0, block);
  return { ...notebook, blocks };
}

/** Moves a block to the end of a section (or, with null, to the very end). */
export function moveBlockToSection(notebook: NotebookContent, blockId: string, sectionId: string | null): NotebookContent {
  const block = notebook.blocks.find((item) => item.id === blockId);
  if (!block || block.kind === 'section') return notebook;
  const without = { ...notebook, blocks: notebook.blocks.filter((item) => item.id !== blockId) };
  if (sectionId === null) return { ...without, blocks: [...without.blocks, block] };
  const range = sectionRange(without, sectionId);
  if (!range) return notebook;
  const blocks = [...without.blocks];
  blocks.splice(range[1], 0, block);
  return { ...without, blocks };
}

/** Moves a whole section (header and content) above or below its neighbouring section. */
export function moveSection(notebook: NotebookContent, sectionId: string, offset: -1 | 1): NotebookContent {
  const sections = sectionsOf(notebook);
  const at = sections.findIndex((item) => item.id === sectionId);
  const other = sections[at + offset];
  if (at < 0 || !other) return notebook;
  const mine = sectionRange(notebook, sectionId)!;
  const theirs = sectionRange(notebook, other.id)!;
  const [first, second] = mine[0] < theirs[0] ? [mine, theirs] : [theirs, mine];
  const before = notebook.blocks.slice(0, first[0]);
  const a = notebook.blocks.slice(first[0], first[1]);
  const between = notebook.blocks.slice(first[1], second[0]);
  const b = notebook.blocks.slice(second[0], second[1]);
  const after = notebook.blocks.slice(second[1]);
  return { ...notebook, blocks: [...before, ...b, ...between, ...a, ...after] };
}

/** A copy of a section right after it. Ids are new; links between copied blocks follow the copies. */
export function duplicateSection(notebook: NotebookContent, sectionId: string): NotebookContent {
  const range = sectionRange(notebook, sectionId);
  if (!range) return notebook;
  const originals = notebook.blocks.slice(range[0], range[1]);
  const { blocks: copies, comments } = cloneBlocks(notebook, originals.map((block) => block.id));
  const header = copies[0];
  if (header.kind === 'section') header.title = header.title ? `${header.title} (copia)` : 'Sección (copia)';
  return {
    ...notebook,
    blocks: [...notebook.blocks.slice(0, range[1]), ...copies, ...notebook.blocks.slice(range[1])],
    ...(notebook.comments?.length || comments.length ? { comments: [...(notebook.comments ?? []), ...comments] } : {}),
  };
}

/** Removes a section header; its blocks stay (they simply join the previous section) unless `withContent`. */
export function removeSection(notebook: NotebookContent, sectionId: string, withContent: boolean): NotebookContent {
  const range = sectionRange(notebook, sectionId);
  if (!range) return notebook;
  const blocks = withContent ? [...notebook.blocks.slice(0, range[0]), ...notebook.blocks.slice(range[1])] : notebook.blocks.filter((block) => block.id !== sectionId);
  return pruneComments({ ...notebook, blocks });
}

/**
 * Copies blocks with fresh ids, carrying their comments (re-pointed at the new ids) and keeping links between
 * blocks that are copied together (a melody still points at its lyrics copy). A link to a block that is not in
 * the copied set is dropped: a copy never points into another place by accident.
 */
export function cloneBlocks(notebook: NotebookContent, ids: string[]): { blocks: NotebookBlock[]; comments: NoteComment[] } {
  const originals = ids.map((id) => notebook.blocks.find((block) => block.id === id)).filter((block): block is NotebookBlock => Boolean(block));
  const idMap = new Map<string, string>();
  const blocks = originals.map((original) => {
    const copy = cloneBlock(original);
    idMap.set(original.id, copy.id);
    // cloneBlock gave every inner event a new id; remember the mapping so comments can follow.
    if (original.kind === 'melody' && copy.kind === 'melody') original.content.events.forEach((event, index) => idMap.set(event.id, copy.content.events[index].id));
    if (original.kind === 'chords' && copy.kind === 'chords') original.content.items.forEach((item, index) => idMap.set(item.id, copy.content.items[index].id));
    if (original.kind === 'tablature' && copy.kind === 'tablature') original.content.columns.forEach((column, index) => idMap.set(column.id, copy.content.columns[index].id));
    return copy;
  });
  for (const copy of blocks) {
    if (copy.kind === 'melody' && copy.content.lyricsBlockId) {
      const target = idMap.get(copy.content.lyricsBlockId);
      if (target) copy.content.lyricsBlockId = target;
      else delete copy.content.lyricsBlockId;
    }
  }
  const comments = (notebook.comments ?? [])
    .filter((comment) => comment.blockId && idMap.has(comment.blockId) && (!comment.eventId || idMap.has(comment.eventId)))
    .map((comment) => ({ ...comment, id: crypto.randomUUID(), blockId: idMap.get(comment.blockId!), eventId: comment.eventId ? idMap.get(comment.eventId) : undefined }));
  return { blocks, comments: comments.map((comment) => (comment.eventId === undefined ? (({ eventId: _e, ...rest }) => (void _e, rest))(comment) : comment)) as NoteComment[] };
}

/** Takes blocks out of a notebook together with their comments (what a move carries to the destination). */
export function extractBlocks(notebook: NotebookContent, ids: string[]): { blocks: NotebookBlock[]; comments: NoteComment[] } {
  const set = new Set(ids);
  return {
    blocks: notebook.blocks.filter((block) => set.has(block.id)).map((block) => structuredClone(block)),
    comments: (notebook.comments ?? []).filter((comment) => comment.blockId && set.has(comment.blockId)).map((comment) => structuredClone(comment)),
  };
}

/** Appends blocks (and their comments) to a notebook, as they are. Links to blocks that did not come along are dropped. */
export function appendBlocks(notebook: NotebookContent, blocks: NotebookBlock[], comments: NoteComment[] = []): NotebookContent {
  const present = new Set([...notebook.blocks.map((block) => block.id), ...blocks.map((block) => block.id)]);
  const adjusted = blocks.map((block) => {
    if (block.kind !== 'melody' || !block.content.lyricsBlockId || present.has(block.content.lyricsBlockId)) return block;
    const content = { ...block.content };
    delete content.lyricsBlockId;
    return { ...block, content };
  });
  const merged = { ...notebook, blocks: [...notebook.blocks, ...adjusted] };
  return comments.length ? { ...merged, comments: [...(merged.comments ?? []), ...comments] } : merged;
}


/** Headings and titled blocks, used for section navigation in practice mode. */
export function notebookOutline(notebook: NotebookContent): OutlineItem[] {
  return notebook.blocks.flatMap((block): OutlineItem[] => {
    if (block.kind === 'section') return [{ id: block.id, label: block.title.trim() || 'Sección', kind: block.kind }];
    if (block.kind === 'text') {
      const first = block.text.trim().split('\n')[0];
      return block.style === 'heading' && first ? [{ id: block.id, label: first, kind: block.kind }] : [];
    }
    return block.title?.trim() ? [{ id: block.id, label: block.title.trim(), kind: block.kind }] : [];
  });
}

/* ---------------- text that lives in blocks ---------------- */

/** Blocks that hold writing: free notes and lyrics. These are the ones text can be moved between. */
export const isTextual = (block: NotebookBlock) => block.kind === 'text' || block.kind === 'lyrics';
export const textOf = (block: NotebookBlock) => (block.kind === 'text' ? block.text : block.kind === 'lyrics' ? block.content.text : '');
function withText(block: NotebookBlock, text: string): NotebookBlock {
  if (block.kind === 'text') return { ...block, text };
  if (block.kind === 'lyrics') return { ...block, content: { ...block.content, text } };
  return block;
}

/**
 * Moves (or copies) a selected piece of text from one writing block to another. The selection is cut from the
 * source (taking its line break with it when it was whole lines) and appended to the destination on its own
 * line. Ranges that do not fit the text are refused instead of guessed.
 */
export function transferText(
  notebook: NotebookContent,
  from: { blockId: string; start: number; end: number },
  toBlockId: string,
  mode: 'move' | 'copy',
): NotebookContent {
  const source = notebook.blocks.find((block) => block.id === from.blockId);
  const target = notebook.blocks.find((block) => block.id === toBlockId);
  if (!source || !target || !isTextual(source) || !isTextual(target) || source.id === target.id) return notebook;
  const text = textOf(source);
  const start = Math.max(0, Math.min(from.start, from.end));
  const end = Math.min(text.length, Math.max(from.start, from.end));
  const picked = text.slice(start, end);
  if (!picked.trim()) return notebook;
  const destination = textOf(target);
  const joined = destination.trim() ? `${destination}${destination.endsWith('\n') ? '' : '\n'}${picked.replace(/^\n+|\n+$/g, '')}` : picked.replace(/^\n+|\n+$/g, '');
  const wholeLines = (start === 0 || text[start - 1] === '\n') && (end === text.length || text[end] === '\n');
  const cutEnd = wholeLines && text[end] === '\n' ? end + 1 : end;
  const remaining = wholeLines && cutEnd === end && start > 0 ? text.slice(0, start - 1) + text.slice(end) : text.slice(0, start) + text.slice(cutEnd);
  return {
    ...notebook,
    blocks: notebook.blocks.map((block) => {
      if (block.id === target.id) return withText(block, joined);
      if (block.id === source.id && mode === 'move') return withText(block, remaining);
      return block;
    }),
  };
}
