import { mod12, NATURAL_PC } from '@/core/theory/pitch';

/**
 * Chord symbols (American "cifrado": C, Am, Dm7, G7, Cmaj7). They are text with a harmonic meaning,
 * never notes of a melody. Chords are spelled with the root the user typed ("Db" stays "Db").
 */
export type ChordQuality = {
  id: string;
  /** Canonical suffix written after the root. */
  suffix: string;
  /** Semitones above the root. */
  intervals: number[];
  /** Interval labels, parallel to `intervals`. */
  degrees: string[];
  name: string;
  family: 'triad' | 'seventh' | 'other';
};

const q = (id: string, suffix: string, intervals: number[], degrees: string[], name: string, family: ChordQuality['family']): ChordQuality => ({
  id, suffix, intervals, degrees, name, family,
});

export const QUALITIES: ChordQuality[] = [
  q('maj', '', [0, 4, 7], ['1', '3', '5'], 'Mayor', 'triad'),
  q('min', 'm', [0, 3, 7], ['1', '♭3', '5'], 'Menor', 'triad'),
  q('dim', 'dim', [0, 3, 6], ['1', '♭3', '♭5'], 'Disminuido', 'triad'),
  q('aug', 'aug', [0, 4, 8], ['1', '3', '♯5'], 'Aumentado', 'triad'),
  q('sus2', 'sus2', [0, 2, 7], ['1', '2', '5'], 'Suspendido 2', 'other'),
  q('sus4', 'sus4', [0, 5, 7], ['1', '4', '5'], 'Suspendido 4', 'other'),
  q('5', '5', [0, 7], ['1', '5'], 'Quinta (power chord)', 'other'),
  q('6', '6', [0, 4, 7, 9], ['1', '3', '5', '6'], 'Mayor con sexta', 'other'),
  q('m6', 'm6', [0, 3, 7, 9], ['1', '♭3', '5', '6'], 'Menor con sexta', 'other'),
  q('7', '7', [0, 4, 7, 10], ['1', '3', '5', '♭7'], 'Dominante 7', 'seventh'),
  q('maj7', 'maj7', [0, 4, 7, 11], ['1', '3', '5', '7'], 'Mayor 7', 'seventh'),
  q('m7', 'm7', [0, 3, 7, 10], ['1', '♭3', '5', '♭7'], 'Menor 7', 'seventh'),
  q('mMaj7', 'mMaj7', [0, 3, 7, 11], ['1', '♭3', '5', '7'], 'Menor con 7 mayor', 'seventh'),
  q('m7b5', 'm7♭5', [0, 3, 6, 10], ['1', '♭3', '♭5', '♭7'], 'Semidisminuido', 'seventh'),
  q('dim7', 'dim7', [0, 3, 6, 9], ['1', '♭3', '♭5', '♭♭7'], 'Disminuido 7', 'seventh'),
  q('add9', 'add9', [0, 4, 7, 14], ['1', '3', '5', '9'], 'Mayor con novena añadida', 'other'),
  q('9', '9', [0, 4, 7, 10, 14], ['1', '3', '5', '♭7', '9'], 'Dominante 9', 'other'),
  q('maj9', 'maj9', [0, 4, 7, 11, 14], ['1', '3', '5', '7', '9'], 'Mayor 9', 'other'),
  q('m9', 'm9', [0, 3, 7, 10, 14], ['1', '♭3', '5', '♭7', '9'], 'Menor 9', 'other'),
];

/** Spellings accepted when typing, mapped to a quality id. Longest first at match time. */
const ALIASES: Array<[string, string]> = [
  ['', 'maj'], ['maj', 'maj'], ['M', 'maj'], ['mayor', 'maj'],
  ['m', 'min'], ['min', 'min'], ['-', 'min'], ['menor', 'min'],
  ['dim', 'dim'], ['°', 'dim'], ['o', 'dim'],
  ['aug', 'aug'], ['+', 'aug'],
  ['sus2', 'sus2'], ['sus4', 'sus4'], ['sus', 'sus4'],
  ['5', '5'], ['6', '6'], ['m6', 'm6'], ['min6', 'm6'],
  ['7', '7'], ['dom7', '7'],
  ['maj7', 'maj7'], ['M7', 'maj7'], ['Δ', 'maj7'], ['Δ7', 'maj7'], ['maj', 'maj'],
  ['m7', 'm7'], ['min7', 'm7'], ['-7', 'm7'],
  ['mMaj7', 'mMaj7'], ['mM7', 'mMaj7'], ['m(maj7)', 'mMaj7'],
  ['m7b5', 'm7b5'], ['m7♭5', 'm7b5'], ['ø', 'm7b5'], ['ø7', 'm7b5'],
  ['dim7', 'dim7'], ['°7', 'dim7'], ['o7', 'dim7'],
  ['add9', 'add9'], ['9', '9'], ['maj9', 'maj9'], ['M9', 'maj9'], ['m9', 'm9'], ['min9', 'm9'],
];
const ALIAS_MAP = new Map(ALIASES);
const BY_ID = new Map(QUALITIES.map((quality) => [quality.id, quality]));
export const qualityById = (id: string) => BY_ID.get(id);

export type Chord = {
  /** Root letter + accidental as typed, e.g. "Db". */
  root: string;
  rootPc: number;
  quality: ChordQuality;
  /** Optional slash bass, e.g. "G" in "C/G". */
  bass?: string;
  bassPc?: number;
};

const ROOT_RE = /^([A-G])([#♯b♭]?)/;

export function rootToPc(root: string): number | null {
  const match = /^([A-G])([#♯b♭]?)$/.exec(root);
  if (!match) return null;
  const shift = match[2] === '#' || match[2] === '♯' ? 1 : match[2] === '' ? 0 : -1;
  return mod12(NATURAL_PC['CDEFGAB'.indexOf(match[1])] + shift);
}

/** Normalises ASCII accidentals ("C#", "Bb") to the display marks ("C♯", "B♭"). */
export const prettyRoot = (root: string) => root.replace('#', '♯').replace(/(?<=[A-G])b/, '♭');

/**
 * Parses a chord symbol. Returns null for text that is not a chord (including note names with an octave,
 * such as "C4"), so a melody can never be mistaken for a progression.
 */
export function parseChord(text: string): Chord | null {
  const clean = text.trim().replace(/♯/g, '#').replace(/♭/g, 'b');
  const root = ROOT_RE.exec(clean);
  if (!root) return null;
  const rootName = root[1] + root[2];
  let rest = clean.slice(rootName.length);
  let bass: string | undefined;
  const slash = rest.lastIndexOf('/');
  if (slash >= 0) {
    bass = rest.slice(slash + 1);
    rest = rest.slice(0, slash);
    if (!/^[A-G][#b]?$/.test(bass)) return null;
  }
  // "C4" is a note, not a chord: a bare octave number is rejected.
  if (/^\d$/.test(rest) && !['5', '6', '7', '9'].includes(rest)) return null;
  const id = ALIAS_MAP.get(rest);
  const quality = id ? BY_ID.get(id) : undefined;
  if (!quality) return null;
  const rootPc = rootToPc(rootName);
  if (rootPc === null) return null;
  return { root: rootName, rootPc, quality, bass, bassPc: bass ? (rootToPc(bass) ?? undefined) : undefined };
}

/** Canonical symbol: roots with display accidentals ("B♭m7"), qualities in their standard suffix. */
export function chordSymbol(chord: Chord) {
  return `${prettyRoot(chord.root)}${chord.quality.suffix}${chord.bass ? `/${prettyRoot(chord.bass)}` : ''}`;
}

/** Pitch classes of the chord, root first. */
export function chordPitchClasses(chord: Chord) {
  return chord.quality.intervals.map((interval) => mod12(chord.rootPc + interval));
}

export type ChordTone = { pc: number; name: string; degree: string; role: 'root' | 'third' | 'fifth' | 'seventh' | 'other' };

const ROLE_OF_DEGREE: Record<string, ChordTone['role']> = {
  '1': 'root', '3': 'third', '♭3': 'third', '5': 'fifth', '♭5': 'fifth', '♯5': 'fifth',
  '7': 'seventh', '♭7': 'seventh', '♭♭7': 'seventh',
};

const LETTERS = 'CDEFGAB';
/** Spells a pitch class on a given letter, so "Eb" stays "E♭" and never "D♯". */
function spellOnLetter(pc: number, letterIndex: number) {
  const natural = NATURAL_PC[letterIndex];
  let delta = mod12(pc - natural);
  if (delta > 6) delta -= 12;
  const mark = delta === 0 ? '' : delta === 1 ? '♯' : delta === -1 ? '♭' : delta === 2 ? '𝄪' : delta === -2 ? '𝄫' : '';
  return `${LETTERS[letterIndex]}${mark}`;
}

const DEGREE_STEPS: Record<string, number> = { '1': 0, '2': 1, '♭3': 2, '3': 2, '4': 3, '♭5': 4, '5': 4, '♯5': 4, '6': 5, '♭♭7': 6, '♭7': 6, '7': 6, '9': 1 };

/** The notes of a chord with correct letter names (a C♭ chord uses F♭, not E). */
export function chordTones(chord: Chord): ChordTone[] {
  const rootLetter = LETTERS.indexOf(chord.root[0]);
  return chord.quality.intervals.map((interval, index) => {
    const degree = chord.quality.degrees[index];
    const pc = mod12(chord.rootPc + interval);
    const letter = (rootLetter + (DEGREE_STEPS[degree] ?? 0)) % 7;
    return { pc, name: spellOnLetter(pc, letter), degree, role: ROLE_OF_DEGREE[degree] ?? 'other' };
  });
}

const FLAT_ROOTS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb']);

/** Transposes a symbol by a number of semitones. Flats are used when the result key is a flat key. */
export function transposeChord(text: string, semitones: number, preferFlats?: boolean): string {
  const chord = parseChord(text);
  if (!chord) return text;
  const useFlats = preferFlats ?? chord.root.includes('b');
  const name = (pc: number) => pitchRoot(pc, useFlats);
  const root = name(chord.rootPc + semitones);
  const bass = chord.bassPc === undefined ? '' : `/${prettyRoot(name(chord.bassPc + semitones))}`;
  return `${prettyRoot(root)}${chord.quality.suffix}${bass}`;
}

const SHARP_ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_ROOT_LIST = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
export const pitchRoot = (pc: number, flats: boolean) => (flats ? FLAT_ROOT_LIST : SHARP_ROOTS)[mod12(pc)];
export const isFlatRoot = (root: string) => FLAT_ROOTS.has(root);

