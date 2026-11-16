import type {
  LinkedTechnique,
  TabColumn,
  TabTechniqueLink,
  TablatureContent,
  Technique,
} from '@/core/model';
import { tuningPitch } from '@/core/music';

export type TabClipboard = { columns: TabColumn[]; links: TabTechniqueLink[] };
export type TabCursor = { column: number; string: number };

/** Absolute pitch (semitones) of a fret on a string, used to validate musical direction. */
export function absolutePitch(openString: string, fret: number) {
  const octave = Number(openString.match(/(-?\d+)$/)?.[1] ?? 0);
  return octave * 12 + tuningPitch(openString) + fret;
}

export const hasNote = (column: TabColumn | undefined) =>
  Boolean(column?.cells.some((cell) => cell.fret !== undefined));

export function blankColumn(): TabColumn {
  return { id: crypto.randomUUID(), cells: Array.from({ length: 6 }, () => ({})) };
}

export function insertColumn(tab: TablatureContent, index: number): TablatureContent {
  return {
    ...tab,
    columns: [...tab.columns.slice(0, index + 1), blankColumn(), ...tab.columns.slice(index + 1)],
  };
}

export function removeColumn(tab: TablatureContent, index: number): TablatureContent {
  if (tab.columns.length <= 1) return tab;
  const removedId = tab.columns[index]?.id;
  return {
    ...tab,
    columns: tab.columns.filter((_, item) => item !== index),
    techniqueLinks: (tab.techniqueLinks ?? []).filter(
      (link) => link.from.columnId !== removedId && link.to.columnId !== removedId,
    ),
  };
}

export function setFret(
  tab: TablatureContent,
  column: number,
  string: number,
  fret: number | undefined,
): TablatureContent {
  if (fret !== undefined && (!Number.isInteger(fret) || fret < 0 || fret > 24)) return tab;
  const columnId = tab.columns[column]?.id;
  return {
    ...tab,
    columns: tab.columns.map((item, index) =>
      index !== column
        ? item
        : {
            ...item,
            cells: item.cells.map((cell, row) => (row !== string ? cell : { ...cell, fret })),
          },
    ),
    techniqueLinks:
      fret === undefined
        ? (tab.techniqueLinks ?? []).filter(
            (link) =>
              !(link.from.columnId === columnId && link.from.string === string) &&
              !(link.to.columnId === columnId && link.to.string === string),
          )
        : tab.techniqueLinks,
  };
}

export function toggleTechnique(
  tab: TablatureContent,
  column: number,
  string: number,
  technique: Technique,
): TablatureContent {
  return {
    ...tab,
    columns: tab.columns.map((item, index) =>
      index !== column
        ? item
        : {
            ...item,
            cells: item.cells.map((cell, row) => {
              if (row !== string) return cell;
              const techniques = new Set(cell.techniques ?? []);
              if (techniques.has(technique)) techniques.delete(technique);
              else techniques.add(technique);
              return { ...cell, techniques: [...techniques] };
            }),
          },
    ),
  };
}

export function copyColumns(tab: TablatureContent, start: number, end: number) {
  return structuredClone(tab.columns.slice(Math.max(0, start), Math.min(tab.columns.length, end + 1)));
}

export function pasteColumns(tab: TablatureContent, at: number, columns: TabColumn[]): TablatureContent {
  return {
    ...tab,
    columns: [
      ...tab.columns.slice(0, at),
      ...structuredClone(columns).map((column) => ({ ...column, id: crypto.randomUUID() })),
      ...tab.columns.slice(at),
    ],
  };
}

export function copyTabFragment(tab: TablatureContent, start: number, end: number): TabClipboard {
  const columns = copyColumns(tab, start, end);
  const ids = new Set(columns.map((column) => column.id));
  return {
    columns,
    links: structuredClone(
      (tab.techniqueLinks ?? []).filter((link) => ids.has(link.from.columnId) && ids.has(link.to.columnId)),
    ),
  };
}

export function pasteTabFragment(tab: TablatureContent, at: number, fragment: TabClipboard): TablatureContent {
  const columnIds = new Map(fragment.columns.map((column) => [column.id, crypto.randomUUID()]));
  const columns = structuredClone(fragment.columns).map((column) => ({ ...column, id: columnIds.get(column.id)! }));
  const links = fragment.links.map((link) => ({
    ...link,
    id: crypto.randomUUID(),
    from: { ...link.from, columnId: columnIds.get(link.from.columnId)! },
    to: { ...link.to, columnId: columnIds.get(link.to.columnId)! },
  }));
  return {
    ...tab,
    columns: [...tab.columns.slice(0, at), ...columns, ...tab.columns.slice(at)],
    techniqueLinks: [...(tab.techniqueLinks ?? []), ...links],
  };
}

export function linkTechnique(
  tab: TablatureContent,
  from: { column: number; string: number },
  to: { column: number; string: number },
  technique: LinkedTechnique,
): TablatureContent {
  const source = tab.columns[from.column];
  const destination = tab.columns[to.column];
  if (
    !source ||
    !destination ||
    source.cells[from.string]?.fret === undefined ||
    destination.cells[to.string]?.fret === undefined ||
    (source.id === destination.id && from.string === to.string)
  )
    return tab;
  const sourcePitch = absolutePitch(tab.tuning[from.string], source.cells[from.string].fret!);
  const destinationPitch = absolutePitch(tab.tuning[to.string], destination.cells[to.string].fret!);
  if ((technique === 'hammer-on' || technique === 'slide-up') && destinationPitch <= sourcePitch) return tab;
  if ((technique === 'pull-off' || technique === 'slide-down') && destinationPitch >= sourcePitch) return tab;
  const links = tab.techniqueLinks ?? [];
  const same = links.find(
    (link) =>
      link.from.columnId === source.id &&
      link.from.string === from.string &&
      link.to.columnId === destination.id &&
      link.to.string === to.string &&
      link.technique === technique,
  );
  if (same) return { ...tab, techniqueLinks: links.filter((link) => link.id !== same.id) };
  return {
    ...tab,
    techniqueLinks: [
      ...links,
      {
        id: crypto.randomUUID(),
        technique,
        from: { columnId: source.id, string: from.string },
        to: { columnId: destination.id, string: to.string },
      },
    ],
  };
}

export function annotateColumn(tab: TablatureContent, columnIndex: number, text: string): TablatureContent {
  const label = text.trim();
  if (!tab.columns[columnIndex]) return tab;
  return {
    ...tab,
    annotations: label ? [...tab.annotations, label] : tab.annotations,
    columns: tab.columns.map((column, index) =>
      index === columnIndex ? { ...column, section: label || undefined } : column,
    ),
  };
}

/** Column index of the next note to the right on the same string, if any. */
export function nextNoteColumn(tab: TablatureContent, column: number, string: number) {
  for (let index = column + 1; index < tab.columns.length; index += 1) {
    if (tab.columns[index].cells[string]?.fret !== undefined) return index;
  }
  return null;
}

export type LinkFamily = 'legato' | 'slide';
export type AutoLinkOutcome = 'linked' | 'unlinked' | 'no-target' | 'same-pitch' | 'no-note';

/**
 * Hammer-on/pull-off and slides always join a note with the next one on the same string.
 * The musical direction is derived from the frets, so a contradictory gesture cannot exist.
 */
export function autoLink(
  tab: TablatureContent,
  from: TabCursor,
  family: LinkFamily,
): { tab: TablatureContent; outcome: AutoLinkOutcome } {
  const source = tab.columns[from.column]?.cells[from.string];
  if (source?.fret === undefined) return { tab, outcome: 'no-note' };
  const target = nextNoteColumn(tab, from.column, from.string);
  if (target === null) return { tab, outcome: 'no-target' };
  const sourcePitch = absolutePitch(tab.tuning[from.string], source.fret);
  const targetPitch = absolutePitch(tab.tuning[from.string], tab.columns[target].cells[from.string].fret!);
  if (sourcePitch === targetPitch) return { tab, outcome: 'same-pitch' };
  const up = targetPitch > sourcePitch;
  const technique: LinkedTechnique =
    family === 'legato' ? (up ? 'hammer-on' : 'pull-off') : up ? 'slide-up' : 'slide-down';
  const before = tab.techniqueLinks?.length ?? 0;
  const next = linkTechnique(tab, from, { column: target, string: from.string }, technique);
  return { tab: next, outcome: (next.techniqueLinks?.length ?? 0) < before ? 'unlinked' : 'linked' };
}

/** Make sure `index` exists, appending blank columns at the end if needed. */
export function ensureColumn(tab: TablatureContent, index: number): TablatureContent {
  let next = tab;
  while (next.columns.length <= index) next = { ...next, columns: [...next.columns, blankColumn()] };
  return next;
}

/** Move the cursor one event to the right, growing the tablature at the end of the phrase. */
export function advanceCursor(tab: TablatureContent, cursor: TabCursor) {
  const next = ensureColumn(tab, cursor.column + 1);
  return { tab: next, cursor: { column: cursor.column + 1, string: cursor.string } };
}

/**
 * Melody entry from the fretboard: every click becomes the next event of the phrase.
 * It fills the cursor event if it is still empty, otherwise the following one, and
 * inserts a new event rather than overwriting music that already exists.
 */
export function appendNote(
  tab: TablatureContent,
  cursor: TabCursor,
  string: number,
  fret: number,
): { tab: TablatureContent; cursor: TabCursor } {
  let next = tab;
  let target = cursor.column;
  if (hasNote(next.columns[cursor.column])) {
    target = cursor.column + 1;
    if (target >= next.columns.length || hasNote(next.columns[target])) {
      next = insertColumn(next, cursor.column);
    }
  }
  next = setFret(next, target, string, fret);
  return { tab: next, cursor: { column: target, string } };
}

/** Chord/edit entry from the fretboard: same event, one fret per string, clicking again removes it. */
export function toggleChordNote(tab: TablatureContent, column: number, string: number, fret: number) {
  const current = tab.columns[column]?.cells[string]?.fret;
  return setFret(tab, column, string, current === fret ? undefined : fret);
}
