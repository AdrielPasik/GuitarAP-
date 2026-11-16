import { degreeOf, presentDistances, type Degree, type Role } from '@/core/harmony';
import type { FretNote, FretPosition, FretboardContent } from '@/core/model';
import { noteName, pitchClassAt } from '@/core/music';
import type { Marker } from '@/features/fretboard/FretboardCanvas';
import { noteKey } from '@/features/fretboard/operations';

export type ShowMode = 'notes' | 'intervals' | 'both' | 'fingers' | 'positions';

export type MarkerOptions = {
  show: ShowMode;
  emphasis?: Role[];
  extensions?: boolean;
  /** Hues by position instead of by harmonic function (only meaningful with several positions). */
  colorByPosition?: boolean;
};

const pitchOf = (content: FretboardContent, note: FretNote) => pitchClassAt(content.tuning[note.string], note.fret);

/** The harmonic context is the whole map, so every position labels the same note the same way. */
function context(content: FretboardContent) {
  return presentDistances(content.baseNotes.map((note) => pitchOf(content, note)), content.root);
}

export function degreeAt(content: FretboardContent, note: FretNote, extensions = false): Degree {
  const semitones = (((pitchOf(content, note) - content.root) % 12) + 12) % 12;
  return degreeOf(semitones, context(content), { extensions });
}

export function rolesPresent(content: FretboardContent, extensions = false): Role[] {
  const roles = new Set<Role>();
  content.baseNotes.forEach((note) => roles.add(degreeAt(content, note, extensions).role));
  return [...roles];
}

/** The label a legend swatch should carry: "3" or "♭3", whatever the map actually uses. */
export function legendLabel(content: FretboardContent, role: Role, extensions = false) {
  const found = content.baseNotes.map((note) => degreeAt(content, note, extensions)).find((degree) => degree.role === role);
  return found?.label ?? (role === 'root' ? '1' : role === 'third' ? '3' : role === 'fifth' ? '5' : '7');
}

export function markerFor(content: FretboardContent, note: FretNote, positionIndex: number, options: MarkerOptions): Marker {
  const degree = degreeAt(content, note, options.extensions);
  const name = noteName(pitchOf(content, note), 0, content.latin);
  const byPosition = options.show === 'positions' || options.colorByPosition;
  let label: string | undefined;
  let sub: string | undefined;
  if (options.show === 'notes') label = name;
  else if (options.show === 'intervals') label = degree.label;
  else if (options.show === 'both') {
    label = name;
    sub = degree.label;
  } else if (options.show === 'fingers') label = note.finger ? String(note.finger) : '';
  else label = String(positionIndex + 1);
  return {
    string: note.string,
    fret: note.fret,
    label,
    sub,
    tone: degree.role === 'root' ? 'root' : 'note',
    role: byPosition ? undefined : degree.role,
    altered: byPosition ? undefined : degree.altered,
    group: byPosition ? positionIndex : undefined,
    dim: Boolean(options.emphasis) && !options.emphasis!.includes(degree.role),
  };
}

export function markersForPosition(content: FretboardContent, position: FretPosition, index: number, options: MarkerOptions) {
  return position.notes.map((note) => markerFor(content, note, index, options));
}

/** Every saved note once, attributed to the first position that holds it. */
export function markersForAll(content: FretboardContent, options: MarkerOptions) {
  const owner = new Map<string, number>();
  content.positions.forEach((position, index) =>
    position.notes.forEach((note) => {
      if (!owner.has(noteKey(note))) owner.set(noteKey(note), index);
    }),
  );
  return content.baseNotes.map((note) => markerFor(content, note, owner.get(noteKey(note)) ?? 0, options));
}
