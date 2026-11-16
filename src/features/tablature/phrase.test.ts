import { describe, expect, it } from 'vitest';
import { createTablatureContent } from '@/core/model';
import {
  advanceCursor,
  appendNote,
  autoLink,
  hasNote,
  setFret,
  toggleChordNote,
  type TabCursor,
} from '@/features/tablature/operations';

const frets = (tab: ReturnType<typeof createTablatureContent>, string: number) =>
  tab.columns.map((column) => column.cells[string].fret);

describe('writing a phrase from the fretboard', () => {
  it('turns consecutive clicks on the first string into consecutive events', () => {
    let tab = createTablatureContent();
    let cursor: TabCursor = { column: 0, string: 0 };
    for (const fret of [5, 7, 8, 7, 5]) ({ tab, cursor } = appendNote(tab, cursor, 0, fret));
    expect(frets(tab, 0).slice(0, 6)).toEqual([5, 7, 8, 7, 5, undefined]);
    expect(tab.columns.slice(0, 5).every(hasNote)).toBe(true);
    expect(cursor.column).toBe(4);
  });

  it('inserts a new event instead of overwriting music that already exists', () => {
    let tab = createTablatureContent();
    tab = setFret(tab, 0, 0, 3);
    tab = setFret(tab, 1, 0, 9);
    const { tab: next, cursor } = appendNote(tab, { column: 0, string: 0 }, 0, 5);
    expect(frets(next, 0).slice(0, 3)).toEqual([3, 5, 9]);
    expect(cursor.column).toBe(1);
    expect(next.columns).toHaveLength(tab.columns.length + 1);
  });

  it('grows the tablature at the end of a long phrase', () => {
    let tab = { ...createTablatureContent(), columns: createTablatureContent().columns.slice(0, 2) };
    let cursor: TabCursor = { column: 0, string: 0 };
    for (const fret of [1, 2, 3, 4]) ({ tab, cursor } = appendNote(tab, cursor, 0, fret));
    expect(frets(tab, 0)).toEqual([1, 2, 3, 4]);
  });

  it('keeps several strings in the same chord and edits only the clicked string', () => {
    let tab = createTablatureContent();
    for (const [string, fret] of [[5, 3], [4, 2], [3, 0]] as const) tab = toggleChordNote(tab, 0, string, fret);
    expect([5, 4, 3].map((string) => tab.columns[0].cells[string].fret)).toEqual([3, 2, 0]);
    tab = toggleChordNote(tab, 0, 4, 5);
    expect([5, 4, 3].map((string) => tab.columns[0].cells[string].fret)).toEqual([3, 5, 0]);
    tab = toggleChordNote(tab, 0, 4, 5);
    expect([5, 4, 3].map((string) => tab.columns[0].cells[string].fret)).toEqual([3, undefined, 0]);
  });

  it('advances to the next event for the second chord and keeps temporal order', () => {
    let tab = createTablatureContent();
    let cursor: TabCursor = { column: 0, string: 5 };
    tab = toggleChordNote(tab, 0, 5, 3);
    ({ tab, cursor } = advanceCursor(tab, cursor));
    tab = toggleChordNote(tab, cursor.column, 5, 5);
    expect(frets(tab, 5).slice(0, 3)).toEqual([3, 5, undefined]);
  });
});

describe('linking techniques from the selected note', () => {
  const phrase = () => {
    let tab = createTablatureContent();
    tab = setFret(tab, 0, 0, 5);
    tab = setFret(tab, 1, 0, 7);
    tab = setFret(tab, 2, 0, 5);
    return tab;
  };

  it('derives hammer-on or pull-off from the direction of the next note on the string', () => {
    const up = autoLink(phrase(), { column: 0, string: 0 }, 'legato');
    expect(up.outcome).toBe('linked');
    expect(up.tab.techniqueLinks?.[0].technique).toBe('hammer-on');
    const down = autoLink(phrase(), { column: 1, string: 0 }, 'legato');
    expect(down.tab.techniqueLinks?.[0].technique).toBe('pull-off');
  });

  it('derives slide direction and toggles an existing link off', () => {
    const slid = autoLink(phrase(), { column: 0, string: 0 }, 'slide');
    expect(slid.tab.techniqueLinks?.[0].technique).toBe('slide-up');
    expect(autoLink(slid.tab, { column: 0, string: 0 }, 'slide').outcome).toBe('unlinked');
  });

  it('explains when there is nothing to link to', () => {
    expect(autoLink(phrase(), { column: 2, string: 0 }, 'legato').outcome).toBe('no-target');
    expect(autoLink(phrase(), { column: 0, string: 3 }, 'legato').outcome).toBe('no-note');
  });
});
