import type { FretNote, FretPosition, FretboardContent, FretboardView } from '@/core/model';
import { scalePositions, type ScaleName } from '@/core/music';

export const noteKey = (note: Pick<FretNote, 'string' | 'fret'>) => `${note.string}:${note.fret}`;

export function uniqueSpatialNotes(notes: FretNote[]) {
  return [...new Map(notes.map((note) => [noteKey(note), note])).values()];
}

const unionOf = (positions: FretPosition[]) => uniqueSpatialNotes(positions.flatMap((position) => position.notes));

function withPositions(content: FretboardContent, positions: FretPosition[]): FretboardContent {
  return { ...content, positions, baseNotes: unionOf(positions) };
}

export function visibleRange(content: FretboardContent) {
  const from = Math.max(0, Math.min(content.minFret ?? 0, content.maxFret - 1));
  return { from, to: content.maxFret };
}

/**
 * Mark or unmark a point on one position. Any number of frets can live on the same
 * string: a map is spatial, not temporal. A finger is only stored when it was chosen.
 */
export function toggleNoteIn(
  content: FretboardContent,
  positionId: string,
  string: number,
  fret: number,
  finger?: 1 | 2 | 3 | 4,
): FretboardContent {
  const target = content.positions.find((position) => position.id === positionId);
  if (!target || string < 0 || string >= content.tuning.length || fret < 0 || fret > content.maxFret) {
    return content;
  }
  const exists = target.notes.some((note) => note.string === string && note.fret === fret);
  const notes = exists
    ? target.notes.filter((note) => note.string !== string || note.fret !== fret)
    : [...target.notes, finger ? { string, fret, finger } : { string, fret }];
  return withPositions(
    content,
    content.positions.map((position) => (position.id === positionId ? { ...position, notes } : position)),
  );
}

/** Same as `toggleNoteIn` for the currently selected position (kept for existing callers). */
export function toggleSpatialNote(
  content: FretboardContent,
  string: number,
  fret: number,
  finger?: 1 | 2 | 3 | 4,
) {
  return toggleNoteIn(content, content.selectedPositionId, string, fret, finger);
}

/** Set, change or clear the finger of a note that already exists in the position. */
export function setNoteFinger(
  content: FretboardContent,
  positionId: string,
  string: number,
  fret: number,
  finger: 1 | 2 | 3 | 4 | undefined,
): FretboardContent {
  return withPositions(
    content,
    content.positions.map((position) =>
      position.id !== positionId
        ? position
        : {
            ...position,
            notes: position.notes.map((note) =>
              note.string === string && note.fret === fret ? { string, fret, ...(finger ? { finger } : {}) } : note,
            ),
          },
    ),
  );
}

export function addPosition(content: FretboardContent): FretboardContent {
  const position: FretPosition = { id: crypto.randomUUID(), name: `Posición ${content.positions.length + 1}`, notes: [] };
  return { ...content, positions: [...content.positions, position], selectedPositionId: position.id };
}

export function updatePosition(
  content: FretboardContent,
  positionId: string,
  change: Partial<Pick<FretPosition, 'name' | 'comments'>>,
): FretboardContent {
  return {
    ...content,
    positions: content.positions.map((position) => (position.id === positionId ? { ...position, ...change } : position)),
  };
}

export function clearPosition(content: FretboardContent, positionId: string) {
  return withPositions(
    content,
    content.positions.map((position) => (position.id === positionId ? { ...position, notes: [] } : position)),
  );
}

export function duplicateSpatialPosition(content: FretboardContent, positionId: string) {
  const source = content.positions.find((position) => position.id === positionId);
  if (!source) return content;
  const copy: FretPosition = {
    ...source,
    id: crypto.randomUUID(),
    name: `${source.name} — copia`,
    notes: structuredClone(source.notes),
  };
  return { ...content, positions: [...content.positions, copy], selectedPositionId: copy.id };
}

export function removeSpatialPosition(content: FretboardContent, positionId: string) {
  if (content.positions.length <= 1) return content;
  const positions = content.positions.filter((position) => position.id !== positionId);
  if (positions.length === content.positions.length) return content;
  return {
    ...withPositions(content, positions),
    selectedPositionId: content.selectedPositionId === positionId ? positions[0].id : content.selectedPositionId,
  };
}

/** Notes a scale would add inside the visible fret window; never applied automatically. */
export function generatedScaleNotes(content: FretboardContent, scale: ScaleName): FretNote[] {
  const { from, to } = visibleRange(content);
  return scalePositions(content.tuning, content.root, scale, from, to);
}

/** Merge (default) or replace the notes of a position with a proposed set. */
export function applyNotes(
  content: FretboardContent,
  positionId: string,
  notes: FretNote[],
  mode: 'merge' | 'replace',
): FretboardContent {
  return withPositions(
    content,
    content.positions.map((position) => {
      if (position.id !== positionId) return position;
      if (mode === 'replace') return { ...position, notes: structuredClone(notes) };
      return { ...position, notes: uniqueSpatialNotes([...position.notes, ...notes]) };
    }),
  );
}

export function setRange(content: FretboardContent, minFret: number, maxFret: number): FretboardContent {
  const max = Math.max(1, Math.min(24, Math.round(maxFret)));
  const min = Math.max(0, Math.min(Math.round(minFret), max - 1));
  return { ...content, minFret: min, maxFret: max };
}

/** Reading preferences with the defaults older maps get. */
export function resolvedView(content: FretboardContent): Required<Pick<FretboardView, 'labels' | 'legend' | 'extensions' | 'guide'>> & Pick<FretboardView, 'emphasis'> {
  return {
    guide: content.view?.guide ?? true,
    labels: content.view?.labels ?? (content.notation === 'intervals' ? 'intervals' : 'notes'),
    emphasis: content.view?.emphasis,
    legend: content.view?.legend ?? true,
    extensions: content.view?.extensions ?? false,
  };
}

/** Changes how the map is read. Never touches a note. */
export function setView(content: FretboardContent, patch: Partial<FretboardView>): FretboardContent {
  const view: FretboardView = { ...content.view, ...patch };
  if ('emphasis' in patch && patch.emphasis === undefined) delete view.emphasis;
  return {
    ...content,
    view,
    // Older versions only know notes | intervals.
    notation: patch.labels ? (patch.labels === 'intervals' ? 'intervals' : 'notes') : content.notation,
  };
}
