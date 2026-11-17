import { describe, expect, it } from 'vitest';
import type { NotebookBlock, NotebookContent } from '@/core/model';
import { mergeNotebooks } from '@/core/merge';

const lyrics = (id: string, text: string): NotebookBlock => ({ id, kind: 'lyrics', content: { text } });
const melody = (id: string, midis: number[]): NotebookBlock => ({ id, kind: 'melody', content: { version: 1, events: midis.map((midi, index) => ({ id: `${id}-${index}`, type: 'note', midi, beats: 1 })) } });
const book = (blocks: NotebookBlock[], extra: Partial<NotebookContent> = {}): NotebookContent => ({ kind: 'notebook', version: 1, blocks, ...extra });
const text = (notebook: NotebookContent, id: string) => {
  const block = notebook.blocks.find((item) => item.id === id);
  return block?.kind === 'lyrics' ? block.content.text : undefined;
};

const base = () => book([lyrics('l1', 'verso'), melody('m1', [60, 62]), lyrics('l2', 'estribillo')]);

describe('merging two people\'s edits of one song', () => {
  it('keeps both changes when they touch different blocks (melody here, lyrics there)', () => {
    const mine = base();
    mine.blocks[1] = melody('m1', [60, 62, 64]);
    const theirs = base();
    theirs.blocks[0] = lyrics('l1', 'verso nuevo');
    const { merged, conflicts } = mergeNotebooks(base(), mine, theirs);
    expect(conflicts).toEqual([]);
    expect(text(merged, 'l1')).toBe('verso nuevo');
    const m1 = merged.blocks.find((block) => block.id === 'm1');
    expect(m1?.kind === 'melody' && m1.content.events.map((event) => event.midi)).toEqual([60, 62, 64]);
    expect(merged.blocks.map((block) => block.id)).toEqual(['l1', 'm1', 'l2']);
  });

  it('a block edited on both sides keeps THEIR text in place and MY text as a visible copy, reported as a conflict', () => {
    const mine = base();
    mine.blocks[0] = lyrics('l1', 'mi verso');
    const theirs = base();
    theirs.blocks[0] = lyrics('l1', 'su verso');
    const { merged, conflicts } = mergeNotebooks(base(), mine, theirs);
    expect(text(merged, 'l1')).toBe('su verso');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ blockId: 'l1', kind: 'both-edited' });
    const copy = merged.blocks.find((block) => block.id === conflicts[0].mineCopyId);
    expect(copy?.kind === 'lyrics' && copy.content.text).toBe('mi verso');
    expect(copy && 'title' in copy && copy.title).toContain('(tu versión)');
    expect(merged.blocks.map((block) => block.id).slice(0, 2)).toEqual(['l1', conflicts[0].mineCopyId]); // right after it
    // Nothing of mine is lost anywhere in the result.
    expect(JSON.stringify(merged)).toContain('mi verso');
  });

  it('the same change on both sides is not a conflict', () => {
    const mine = base();
    mine.blocks[0] = lyrics('l1', 'igual');
    const theirs = base();
    theirs.blocks[0] = lyrics('l1', 'igual');
    const { merged, conflicts } = mergeNotebooks(base(), mine, theirs);
    expect(conflicts).toEqual([]);
    expect(merged.blocks).toHaveLength(3);
  });

  it('additions from both sides are kept, mine after the block it followed', () => {
    const mine = base();
    mine.blocks.splice(1, 0, lyrics('mine-new', 'agregada por mí'));
    const theirs = base();
    theirs.blocks.push(lyrics('their-new', 'agregada por él'));
    const { merged, conflicts } = mergeNotebooks(base(), mine, theirs);
    expect(conflicts).toEqual([]);
    expect(merged.blocks.map((block) => block.id)).toEqual(['l1', 'mine-new', 'm1', 'l2', 'their-new']);
  });

  it('deletions: untouched on the other side it goes; edited on the other side it stays and is reported', () => {
    const mine = base();
    mine.blocks = mine.blocks.filter((block) => block.id !== 'm1'); // I delete m1, they did not touch it
    const theirs = base();
    theirs.blocks[2] = lyrics('l2', 'estribillo editado por él'); // they edit l2 ...
    const mineAlsoDeletesL2 = { ...mine, blocks: mine.blocks.filter((block) => block.id !== 'l2') }; // ... which I deleted
    const { merged } = mergeNotebooks(base(), mineAlsoDeletesL2, theirs);
    expect(merged.blocks.map((block) => block.id)).toEqual(['l1', 'l2']);
    expect(text(merged, 'l2')).toBe('estribillo editado por él');

    // They delete a block that I edited: I keep it and it is reported.
    const edited = base();
    edited.blocks[1] = melody('m1', [72]);
    const gone = base();
    gone.blocks = gone.blocks.filter((block) => block.id !== 'm1');
    const result = mergeNotebooks(base(), edited, gone);
    expect(result.merged.blocks.map((block) => block.id)).toContain('m1');
    expect(result.conflicts.map((conflict) => conflict.kind)).toEqual(['edited-here-deleted-there']);
    // They delete a block I did not touch: it is gone.
    expect(mergeNotebooks(base(), base(), gone).merged.blocks.map((block) => block.id)).toEqual(['l1', 'l2']);
  });

  it('comments from both people are kept; the comments of a block that disappeared go with it', () => {
    const baseNotebook = base();
    const mine = base();
    mine.comments = [{ id: 'c-mine', text: 'mío', createdAt: 1, updatedAt: 1, blockId: 'l1' }];
    const theirs = base();
    theirs.comments = [{ id: 'c-theirs', text: 'suyo', createdAt: 2, updatedAt: 2, blockId: 'm1', eventId: 'm1-1' }];
    expect(mergeNotebooks(baseNotebook, mine, theirs).merged.comments?.map((comment) => comment.id).sort()).toEqual(['c-mine', 'c-theirs']);
    const theirsWithoutM1 = { ...theirs, blocks: theirs.blocks.filter((block) => block.id !== 'm1') };
    expect(mergeNotebooks(baseNotebook, mine, theirsWithoutM1).merged.comments?.map((comment) => comment.id)).toEqual(['c-mine']);
  });

  it('song data merges field by field and reports only a true clash', () => {
    const mine = base();
    mine.meta = { bpm: 100 };
    const theirs = base();
    theirs.meta = { key: { tonic: 'F', mode: 'major' } };
    const both = mergeNotebooks(base(), mine, theirs);
    expect(both.merged.meta).toEqual({ bpm: 100, key: { tonic: 'F', mode: 'major' } });
    expect(both.conflicts).toEqual([]);
    const clash = base();
    clash.meta = { bpm: 100 };
    const other = base();
    other.meta = { bpm: 120 };
    const result = mergeNotebooks(base(), clash, other);
    expect(result.merged.meta).toEqual({ bpm: 120 });
    expect(result.conflicts[0].blockId).toBe('meta:bpm');
  });

  it('with nothing changed on either side the result is the server\'s notebook', () => {
    const { merged, conflicts, changedByThem } = mergeNotebooks(base(), base(), base());
    expect(conflicts).toEqual([]);
    expect(changedByThem).toBe(false);
    expect(merged.blocks.map((block) => block.id)).toEqual(['l1', 'm1', 'l2']);
  });
});
