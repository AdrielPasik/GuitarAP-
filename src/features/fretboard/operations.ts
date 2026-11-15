import type { FretNote, FretPosition, FretboardContent } from '@/core/model';
import { tuningPitch } from '@/core/music';

const noteKey = (note: Pick<FretNote, 'string' | 'fret'>) => `${note.string}:${note.fret}`;

export function uniqueSpatialNotes(notes: FretNote[]) {
  return [...new Map(notes.map((note) => [noteKey(note), note])).values()];
}

export function toggleSpatialNote(
  content: FretboardContent,
  string: number,
  fret: number,
  finger: 1 | 2 | 3 | 4,
) {
  const selected = content.positions.find((position) => position.id === content.selectedPositionId);
  if (
    !selected ||
    string < 0 ||
    string >= content.tuning.length ||
    fret < 0 ||
    fret > content.maxFret
  )
    return content;
  const exists = selected.notes.some((note) => note.string === string && note.fret === fret);
  const notes = exists
    ? selected.notes.filter((note) => note.string !== string || note.fret !== fret)
    : [
        ...selected.notes,
        {
          string,
          fret,
          finger,
          root: (tuningPitch(content.tuning[string]) + fret) % 12 === content.root,
        },
      ];
  const positions = content.positions.map((position) =>
    position.id === selected.id ? { ...position, notes } : position,
  );
  return {
    ...content,
    positions,
    baseNotes: uniqueSpatialNotes(positions.flatMap((position) => position.notes)),
  };
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
    ...content,
    positions,
    selectedPositionId:
      content.selectedPositionId === positionId ? positions[0].id : content.selectedPositionId,
    baseNotes: uniqueSpatialNotes(positions.flatMap((position) => position.notes)),
  };
}
