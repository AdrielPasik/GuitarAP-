import { describe, expect, it } from 'vitest';
import type { NotebookBlock, NotebookContent } from '@/core/model';
import {
  addComment, appendBlocks, cloneBlocks, duplicateSection, extractBlocks, moveBlockTo, moveBlockToSection, moveSection, newBlock,
  removeSection, sectionOfBlock, sectionRange, sectionsOf, textOf, transferText,
} from '@/core/notebook';
import { parseMelodyText } from '@/features/melody/operations';

const make = (kind: Parameters<typeof newBlock>[0], id: string, patch: Partial<NotebookBlock> = {}): NotebookBlock => ({ ...newBlock(kind), id, ...patch }) as NotebookBlock;
const section = (id: string, title: string) => make('section', id, { title } as Partial<NotebookBlock>);
const ids = (notebook: NotebookContent) => notebook.blocks.map((block) => block.id);

const song = (): NotebookContent => ({
  kind: 'notebook',
  version: 1,
  blocks: [
    make('text', 'idea'),
    section('s1', 'Verso 1'),
    make('lyrics', 'l1'),
    make('melody', 'm1'),
    section('s2', 'Estribillo'),
    make('lyrics', 'l2'),
    make('melody', 'm2'),
    section('s3', 'Solo'),
    make('tablature', 't1'),
  ],
});

describe('sections', () => {
  it('group the blocks that follow them, and the first blocks belong to no section', () => {
    expect(sectionRange(song(), 's2')).toEqual([4, 7]);
    expect(sectionsOf(song()).map((item) => item.title)).toEqual(['Verso 1', 'Estribillo', 'Solo']);
    expect(sectionOfBlock(song(), 'm2')).toBe('s2');
    expect(sectionOfBlock(song(), 'idea')).toBeNull();
  });
  it('moves a whole section up or down with its content, and ignores the ends', () => {
    expect(ids(moveSection(song(), 's2', -1))).toEqual(['idea', 's2', 'l2', 'm2', 's1', 'l1', 'm1', 's3', 't1']);
    expect(ids(moveSection(song(), 's2', 1))).toEqual(['idea', 's1', 'l1', 'm1', 's3', 't1', 's2', 'l2', 'm2']);
    const base = song();
    expect(moveSection(base, 's1', -1)).toEqual(base);
    expect(moveSection(base, 's3', 1)).toEqual(base);
  });
  it('duplicates a section with new ids, keeping the lyrics-melody link inside the copy', () => {
    const base = song();
    const melody = base.blocks.find((block) => block.id === 'm1')!;
    if (melody.kind === 'melody') {
      melody.content.events = parseMelodyText('C4 D4').events;
      melody.content.lyricsBlockId = 'l1';
    }
    const withComment = addComment(base, { blockId: 'm1', eventId: melody.kind === 'melody' ? melody.content.events[0].id : undefined }, 'Suave').notebook;
    const copy = duplicateSection(withComment, 's1');
    expect(copy.blocks.map((block) => block.kind)).toEqual(['text', 'section', 'lyrics', 'melody', 'section', 'lyrics', 'melody', 'section', 'lyrics', 'melody', 'section', 'tablature']);
    const [dupLyrics, dupMelody] = [copy.blocks[5], copy.blocks[6]];
    expect(dupLyrics.id).not.toBe('l1');
    if (dupMelody.kind !== 'melody') throw new Error('unreachable');
    expect(dupMelody.content.lyricsBlockId).toBe(dupLyrics.id);
    const copied = (copy.comments ?? []).filter((comment) => comment.blockId === dupMelody.id);
    expect(copied).toHaveLength(1);
    expect(copied[0].eventId).toBe(dupMelody.content.events[0].id);
    expect(copy.blocks[4].kind === 'section' && copy.blocks[4].title).toBe('Verso 1 (copia)');
  });
  it('deleting a section keeps its blocks unless the content is asked for too', () => {
    expect(ids(removeSection(song(), 's2', false))).toEqual(['idea', 's1', 'l1', 'm1', 'l2', 'm2', 's3', 't1']);
    expect(ids(removeSection(song(), 's2', true))).toEqual(['idea', 's1', 'l1', 'm1', 's3', 't1']);
  });
  it('moves a block to another section, to an exact place, or to the end', () => {
    expect(ids(moveBlockToSection(song(), 'l1', 's3'))).toEqual(['idea', 's1', 'm1', 's2', 'l2', 'm2', 's3', 't1', 'l1']);
    expect(ids(moveBlockTo(song(), 't1', 1))).toEqual(['idea', 't1', 's1', 'l1', 'm1', 's2', 'l2', 'm2', 's3']);
    expect(ids(moveBlockToSection(song(), 'idea', null)).at(-1)).toBe('idea');
    const base = song();
    expect(moveBlockToSection(base, 's1', 's2')).toBe(base); // a section is not a block you drop into another
  });
});

describe('copying and extracting blocks', () => {
  it('a copy of a melody that is not copied with its lyrics drops the link instead of pointing elsewhere', () => {
    const base = song();
    const melody = base.blocks.find((block) => block.id === 'm1')!;
    if (melody.kind === 'melody') melody.content.lyricsBlockId = 'l1';
    const alone = cloneBlocks(base, ['m1']);
    const copied = alone.blocks[0];
    expect(copied.kind === 'melody' && copied.content.lyricsBlockId).toBeUndefined();
    const together = cloneBlocks(base, ['l1', 'm1']);
    const [l, m] = together.blocks;
    expect(m.kind === 'melody' && m.content.lyricsBlockId).toBe(l.id);
  });
  it('moving a linked melody alone to another notebook does not leave a dangling link', () => {
    const base = song();
    const melody = base.blocks.find((block) => block.id === 'm1')!;
    if (melody.kind === 'melody') melody.content.lyricsBlockId = 'l1';
    const { blocks } = extractBlocks(base, ['m1']);
    const arrived = appendBlocks({ kind: 'notebook', version: 1, blocks: [] }, blocks);
    expect(arrived.blocks[0].kind === 'melody' && arrived.blocks[0].content.lyricsBlockId).toBeUndefined();
    // Moving both keeps the link.
    const pair = extractBlocks(base, ['l1', 'm1']);
    const arrivedPair = appendBlocks({ kind: 'notebook', version: 1, blocks: [] }, pair.blocks);
    expect(arrivedPair.blocks[1].kind === 'melody' && arrivedPair.blocks[1].content.lyricsBlockId).toBe('l1');
  });
});

describe('moving text between writing blocks', () => {
  const notebook = (): NotebookContent => ({
    kind: 'notebook',
    version: 1,
    blocks: [
      { id: 'arreglos', kind: 'text', style: 'note', text: 'Intro suave\nHoy vuelvo a empezar\nPuente con bajo' },
      { id: 'letra', kind: 'lyrics', content: { text: '# Verso 1\nOtra línea' } },
      { id: 'vacia', kind: 'lyrics', content: { text: '' } },
    ],
  });
  const text = (n: NotebookContent, id: string) => textOf(n.blocks.find((block) => block.id === id)!);
  it('moves the selection, taking its line with it, and appends it on its own line', () => {
    const source = text(notebook(), 'arreglos');
    const start = source.indexOf('Hoy');
    const end = start + 'Hoy vuelvo a empezar'.length;
    const moved = transferText(notebook(), { blockId: 'arreglos', start, end }, 'letra', 'move');
    expect(text(moved, 'arreglos')).toBe('Intro suave\nPuente con bajo');
    expect(text(moved, 'letra')).toBe('# Verso 1\nOtra línea\nHoy vuelvo a empezar');
  });
  it('copy leaves the source alone; an empty destination receives just the text; partial words are cut exactly', () => {
    const copied = transferText(notebook(), { blockId: 'arreglos', start: 0, end: 5 }, 'vacia', 'copy');
    expect(text(copied, 'arreglos')).toBe(text(notebook(), 'arreglos'));
    expect(text(copied, 'vacia')).toBe('Intro');
    const partial = transferText(notebook(), { blockId: 'arreglos', start: 6, end: 11 }, 'letra', 'move');
    expect(text(partial, 'arreglos')).toBe('Intro \nHoy vuelvo a empezar\nPuente con bajo');
  });
  it('refuses nonsense: same block, empty selection, non-writing blocks', () => {
    const base = notebook();
    expect(transferText(base, { blockId: 'arreglos', start: 0, end: 4 }, 'arreglos', 'move')).toBe(base);
    expect(transferText(base, { blockId: 'arreglos', start: 3, end: 3 }, 'letra', 'move')).toBe(base);
    const withMelody: NotebookContent = { ...base, blocks: [...base.blocks, make('melody', 'm')] };
    expect(transferText(withMelody, { blockId: 'arreglos', start: 0, end: 4 }, 'm', 'move')).toBe(withMelody);
  });
});
