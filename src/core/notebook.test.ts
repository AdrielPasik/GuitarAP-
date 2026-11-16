import { describe, expect, it } from 'vitest';
import {
  createFretboardContent,
  createTablatureContent,
  type MusicalDocument,
  type NotebookContent,
} from '@/core/model';
import {
  cloneBlock,
  documentKind,
  duplicateBlock,
  fromNotebook,
  insertBlock,
  isNotebook,
  moveBlock,
  newBlock,
  notebookOutline,
  removeBlock,
  toNotebook,
  updateBlock,
} from '@/core/notebook';
import { setFret } from '@/features/tablature/operations';

const legacyTab = (): MusicalDocument => ({
  id: 'doc-tab', nodeId: null, type: 'tablature', title: 'Riff', content: createTablatureContent(),
  rev: 1, createdAt: 1, updatedAt: 1,
});
const legacyMap = (): MusicalDocument => ({
  id: 'doc-map', nodeId: null, type: 'fretboard', title: 'Escala', content: createFretboardContent(),
  rev: 1, createdAt: 1, updatedAt: 1,
});

describe('notebook compatibility with documents saved before blocks', () => {
  it('wraps a legacy tablature and writes it back in its original shape', () => {
    const doc = legacyTab();
    const notebook = toNotebook(doc);
    expect(notebook.blocks).toHaveLength(1);
    expect(notebook.blocks[0].kind).toBe('tablature');
    expect(fromNotebook(doc, notebook)).toEqual(expect.objectContaining({ tuning: expect.any(Array), columns: expect.any(Array) }));
    expect(isNotebook(fromNotebook(doc, notebook))).toBe(false);
  });

  it('wraps a legacy map and writes it back unchanged', () => {
    const doc = legacyMap();
    const saved = fromNotebook(doc, toNotebook(doc));
    expect(isNotebook(saved)).toBe(false);
    expect(saved).toEqual(doc.content);
  });

  it('upgrades to a notebook only when a second block exists', () => {
    const doc = legacyTab();
    const grown = insertBlock(toNotebook(doc), newBlock('map'));
    const saved = fromNotebook(doc, grown) as NotebookContent;
    expect(isNotebook(saved)).toBe(true);
    expect(saved.blocks.map((block) => block.kind)).toEqual(['tablature', 'map']);
    expect(documentKind({ ...doc, content: saved })).toBe('mixed');
  });

  it('keeps a titled single block as a notebook so the title is not lost', () => {
    const doc = legacyMap();
    const titled = updateBlock(toNotebook(doc), toNotebook(doc).blocks[0].id, (block) =>
      block.kind === 'map' ? { ...block, title: 'Pentatónica' } : block,
    );
    expect(isNotebook(fromNotebook(doc, titled))).toBe(true);
  });

  it('classifies documents for the library', () => {
    expect(documentKind(legacyTab())).toBe('tablature');
    expect(documentKind(legacyMap())).toBe('map');
  });
});

describe('notebook block operations', () => {
  it('inserts, moves, duplicates and removes blocks', () => {
    let notebook = toNotebook(legacyTab());
    const tabId = notebook.blocks[0].id;
    notebook = insertBlock(notebook, newBlock('map'));
    notebook = insertBlock(notebook, newBlock('text', 'heading'), 0);
    expect(notebook.blocks.map((block) => block.kind)).toEqual(['tablature', 'text', 'map']);
    notebook = moveBlock(notebook, tabId, 1);
    expect(notebook.blocks.map((block) => block.kind)).toEqual(['text', 'tablature', 'map']);
    notebook = duplicateBlock(notebook, tabId);
    expect(notebook.blocks).toHaveLength(4);
    expect(new Set(notebook.blocks.map((block) => block.id)).size).toBe(4);
    notebook = removeBlock(notebook, tabId);
    expect(notebook.blocks).toHaveLength(3);
  });

  it('clones a tablature with fresh column ids and consistent technique links', () => {
    const block = newBlock('tablature');
    if (block.kind !== 'tablature') throw new Error('expected a tablature block');
    block.content = setFret(setFret(block.content, 0, 0, 5), 1, 0, 7);
    block.content.techniqueLinks = [
      {
        id: 'link', technique: 'hammer-on',
        from: { columnId: block.content.columns[0].id, string: 0 },
        to: { columnId: block.content.columns[1].id, string: 0 },
      },
    ];
    const copy = cloneBlock(block);
    if (copy.kind !== 'tablature') throw new Error('expected a tablature block');
    expect(copy.content.columns[0].id).not.toBe(block.content.columns[0].id);
    expect(copy.content.techniqueLinks?.[0].from.columnId).toBe(copy.content.columns[0].id);
    expect(copy.content.columns[0].cells[0].fret).toBe(5);
    expect(block.content.techniqueLinks?.[0].from.columnId).toBe(block.content.columns[0].id);
  });

  it('builds an outline from headings and titled blocks', () => {
    let notebook = toNotebook(legacyMap());
    notebook = insertBlock(notebook, { id: 'h', kind: 'text', style: 'heading', text: 'Posición 1' }, -1);
    notebook = insertBlock(notebook, { id: 'n', kind: 'text', style: 'note', text: 'Practicar lento' });
    expect(notebookOutline(notebook).map((item) => item.label)).toEqual(['Posición 1']);
  });
});
