export const STANDARD_TUNING = ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'] as const;

export const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const LATIN_NAMES = [
  'Do',
  'Do♯',
  'Re',
  'Re♯',
  'Mi',
  'Fa',
  'Fa♯',
  'Sol',
  'Sol♯',
  'La',
  'La♯',
  'Si',
];
export const INTERVAL_NAMES = ['1', '♭2', '2', '♭3', '3', '4', '♭5', '5', '♭6', '6', '♭7', '7'];

export const SCALE_PATTERNS = {
  Mayor: [0, 2, 4, 5, 7, 9, 11],
  'Menor natural': [0, 2, 3, 5, 7, 8, 10],
  'Pentatónica mayor': [0, 2, 4, 7, 9],
  'Pentatónica menor': [0, 3, 5, 7, 10],
  Blues: [0, 3, 5, 6, 7, 10],
  Jónico: [0, 2, 4, 5, 7, 9, 11],
  Dórico: [0, 2, 3, 5, 7, 9, 10],
  Frigio: [0, 1, 3, 5, 7, 8, 10],
  Lidio: [0, 2, 4, 6, 7, 9, 11],
  Mixolidio: [0, 2, 4, 5, 7, 9, 10],
  Eólico: [0, 2, 3, 5, 7, 8, 10],
  Locrio: [0, 1, 3, 5, 6, 8, 10],
} as const;

export type ScaleName = keyof typeof SCALE_PATTERNS;

const mod12 = (value: number) => ((value % 12) + 12) % 12;

/** Note name for a pitch class. `interval` is added to `root` (kept for callers that transpose). */
export function noteName(root: number, interval: number, latin = false) {
  return (latin ? LATIN_NAMES : NOTE_NAMES)[mod12(root + interval)];
}

const PITCH_CLASSES: Record<string, number> = {
  C: 0,
  'C#': 1,
  'C♯': 1,
  D: 2,
  'D#': 3,
  'D♯': 3,
  E: 4,
  F: 5,
  'F#': 6,
  'F♯': 6,
  G: 7,
  'G#': 8,
  'G♯': 8,
  A: 9,
  'A#': 10,
  'A♯': 10,
  B: 11,
};

/** Pitch class (0-11) of an open string written like "E4" or "A#2". */
export function tuningPitch(openString: string) {
  return PITCH_CLASSES[openString.slice(0, -1)] ?? 0;
}

/** Pitch class sounded at `fret` on an open string. */
export function pitchClassAt(openString: string, fret: number) {
  return mod12(tuningPitch(openString) + fret);
}

/** Interval label (1, ♭3, 5…) of a pitch class relative to the root. */
export function intervalName(pitchClass: number, root: number) {
  return INTERVAL_NAMES[mod12(pitchClass - root)];
}

/** Open-string label without octave, in latin or english notation. */
export function stringName(openString: string, latin = false) {
  return noteName(tuningPitch(openString), 0, latin);
}

/** All fretted positions of a scale inside a fret window. */
export function scalePositions(
  tuning: readonly string[],
  root: number,
  scale: ScaleName,
  fromFret: number,
  toFret: number,
) {
  const intervals: readonly number[] = SCALE_PATTERNS[scale];
  const positions: Array<{ string: number; fret: number }> = [];
  tuning.forEach((openString, string) => {
    for (let fret = fromFret; fret <= toFret; fret += 1) {
      if (intervals.includes(mod12(pitchClassAt(openString, fret) - root))) {
        positions.push({ string, fret });
      }
    }
  });
  return positions;
}
