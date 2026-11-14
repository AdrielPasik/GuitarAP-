import { describe, expect, it } from 'vitest';
import { createTablatureContent } from '@/core/model';
import { annotateColumn, copyColumns, insertColumn, pasteColumns, setFret, toggleTechnique } from '@/features/tablature/operations';

describe('tablature operations', () => {
  it('keeps a two digit fret in its originating cell', () => { const tab = setFret(createTablatureContent(), 0, 0, 24); expect(tab.columns[0].cells[0].fret).toBe(24); expect(tab.columns[1].cells[0].fret).toBeUndefined(); });
  it('copies columns without sharing mutable ids or cells', () => { const source = setFret(createTablatureContent(), 0, 0, 12); const pasted = pasteColumns(source, 1, copyColumns(source, 0, 0)); expect(pasted.columns).toHaveLength(17); expect(pasted.columns[1].id).not.toBe(source.columns[0].id); expect(pasted.columns[1].cells[0].fret).toBe(12); });
  it('attaches techniques only to the selected note', () => { const tab = toggleTechnique(insertColumn(createTablatureContent(), 0), 1, 2, 'vibrato'); expect(tab.columns[1].cells[2].techniques).toEqual(['vibrato']); expect(tab.columns[1].cells[1].techniques).toBeUndefined(); });
  it('keeps annotations attached to their selected column', () => { const tab = annotateColumn(createTablatureContent(), 1, 'Estribillo'); expect(tab.columns[1].section).toBe('Estribillo'); expect(tab.columns[0].section).toBeUndefined(); });
});
