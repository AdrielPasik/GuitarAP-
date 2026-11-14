import { describe, expect, it } from 'vitest';
import { createTablatureContent } from '@/core/model';
import { annotateColumn, copyColumns, copyTabFragment, insertColumn, linkTechnique, pasteColumns, pasteTabFragment, removeColumn, setFret, toggleTechnique } from '@/features/tablature/operations';

describe('tablature operations', () => {
  it('keeps a two digit fret in its originating cell', () => { const tab = setFret(createTablatureContent(), 0, 0, 24); expect(tab.columns[0].cells[0].fret).toBe(24); expect(tab.columns[1].cells[0].fret).toBeUndefined(); });
  it('copies columns without sharing mutable ids or cells', () => { const source = setFret(createTablatureContent(), 0, 0, 12); const pasted = pasteColumns(source, 1, copyColumns(source, 0, 0)); expect(pasted.columns).toHaveLength(17); expect(pasted.columns[1].id).not.toBe(source.columns[0].id); expect(pasted.columns[1].cells[0].fret).toBe(12); });
  it('attaches techniques only to the selected note', () => { const tab = toggleTechnique(insertColumn(createTablatureContent(), 0), 1, 2, 'vibrato'); expect(tab.columns[1].cells[2].techniques).toEqual(['vibrato']); expect(tab.columns[1].cells[1].techniques).toBeUndefined(); });
  it('keeps annotations attached to their selected column', () => { const tab = annotateColumn(createTablatureContent(), 1, 'Estribillo'); expect(tab.columns[1].section).toBe('Estribillo'); expect(tab.columns[0].section).toBeUndefined(); });
  it('keeps an explicit slide stable by column id and removes it with either endpoint', () => {
    let tab = setFret(createTablatureContent(), 0, 0, 5); tab = setFret(tab, 1, 0, 7); tab = linkTechnique(tab, { column: 0, string: 0 }, { column: 1, string: 0 }, 'slide-up');
    expect(tab.techniqueLinks).toHaveLength(1); expect(tab.techniqueLinks?.[0].from.columnId).toBe(tab.columns[0].id);
    expect(setFret(tab, 1, 0, undefined).techniqueLinks).toEqual([]); expect(removeColumn(tab, 0).techniqueLinks).toEqual([]);
  });
  it('rejects musical links with the wrong fret direction', () => {
    let tab = setFret(createTablatureContent(), 0, 0, 7); tab = setFret(tab, 1, 0, 5);
    expect(linkTechnique(tab, { column: 0, string: 0 }, { column: 1, string: 0 }, 'slide-up').techniqueLinks).toEqual([]);
    expect(linkTechnique(tab, { column: 0, string: 0 }, { column: 1, string: 0 }, 'hammer-on').techniqueLinks).toEqual([]);
  });
  it('remaps both endpoints when copying a fragment', () => {
    let tab = setFret(createTablatureContent(), 0, 0, 5); tab = setFret(tab, 1, 0, 7); tab = linkTechnique(tab, { column: 0, string: 0 }, { column: 1, string: 0 }, 'hammer-on');
    const pasted = pasteTabFragment(tab, 2, copyTabFragment(tab, 0, 1)); const link = pasted.techniqueLinks?.[1];
    expect(link?.from.columnId).toBe(pasted.columns[2].id); expect(link?.to.columnId).toBe(pasted.columns[3].id); expect(link?.id).not.toBe(tab.techniqueLinks?.[0].id);
  });
});
