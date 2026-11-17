import { chordSymbol, parseChord, prettyRoot, qualityById, type Chord } from '@/core/theory/chords';
import { mod12, NATURAL_PC, type NameStyle } from '@/core/theory/pitch';

/**
 * Keys, the circle of fifths, diatonic chords and modulation paths.
 * Everything here is derived from one rule: a scale is spelled with each letter used once, so
 * D♭ major has G♭ (never F♯) and the chords inherit the right names.
 * Minor keys use the natural minor (Aeolian). Where harmony is a matter of context (harmonic minor's
 * major V, borrowed chords, which pivot "works") the result is labelled as a suggestion, not a rule.
 */
export type Mode = 'major' | 'minor';
export type KeyRef = { tonic: string; mode: Mode };

const LETTERS = 'CDEFGAB';
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];

/** The twelve major keys in fifths order, starting at C and going up by fifths. */
export const CIRCLE_MAJOR = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'] as const;
/** Relative minors, same order. */
export const CIRCLE_MINOR = ['A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'Bb', 'F', 'C', 'G', 'D'] as const;
/** Alternative spellings of the three keys that have two names. */
export const ENHARMONIC_KEYS: Record<string, string> = { 'F#': 'Gb', Gb: 'F#', Db: 'C#', 'C#': 'Db', B: 'Cb', Cb: 'B' };

export function tonicPc(tonic: string) {
  const letter = LETTERS.indexOf(tonic[0]);
  const mark = tonic.slice(1);
  const shift = mark === '#' || mark === '♯' ? 1 : mark === 'b' || mark === '♭' ? -1 : 0;
  return mod12(NATURAL_PC[letter] + shift);
}

const spell = (pc: number, letterIndex: number) => {
  let delta = mod12(pc - NATURAL_PC[letterIndex]);
  if (delta > 6) delta -= 12;
  const mark = delta === 0 ? '' : delta === 1 ? '#' : delta === -1 ? 'b' : delta === 2 ? '##' : delta === -2 ? 'bb' : '?';
  return `${LETTERS[letterIndex]}${mark}`;
};

export const keyId = (key: KeyRef) => `${key.tonic}${key.mode === 'minor' ? 'm' : ''}`;
export const keyLabel = (key: KeyRef) => `${prettyRoot(key.tonic)}${key.mode === 'minor' ? 'm' : ''}`;
export const sameKey = (a: KeyRef, b: KeyRef) => tonicPc(a.tonic) === tonicPc(b.tonic) && a.mode === b.mode;

/** Scale notes (as ASCII-accidental names, e.g. "F#") with correct letters. */
export function scaleOf(key: KeyRef): string[] {
  const steps = key.mode === 'major' ? MAJOR_STEPS : MINOR_STEPS;
  const rootLetter = LETTERS.indexOf(key.tonic[0]);
  const root = tonicPc(key.tonic);
  return steps.map((step, index) => spell(root + step, (rootLetter + index) % 7));
}

export function scaleNames(key: KeyRef, style: NameStyle) {
  const latin = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Si'];
  return scaleOf(key).map((note) => {
    const base = style === 'latin' ? latin[LETTERS.indexOf(note[0])] : note[0];
    return `${base}${note.slice(1).replace(/#/g, '♯').replace(/b/g, '♭')}`;
  });
}

/** Number of sharps (+) or flats (−) in the key signature, by name, without drawing a staff. */
export function accidentalsOf(key: KeyRef) {
  const altered = scaleOf(key).filter((note) => note.length > 1);
  const sharps = altered.filter((note) => note.includes('#')).length;
  const flats = altered.filter((note) => note.includes('b')).length;
  return { sharps, flats, notes: altered };
}

export const relativeOf = (key: KeyRef): KeyRef => {
  const scale = scaleOf(key);
  return key.mode === 'major' ? { tonic: scale[5], mode: 'minor' } : { tonic: scale[2], mode: 'major' };
};
export const parallelOf = (key: KeyRef): KeyRef => ({ tonic: key.tonic, mode: key.mode === 'major' ? 'minor' : 'major' });

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const MAJOR_QUALITIES = ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim'];
const MINOR_QUALITIES = ['min', 'dim', 'maj', 'min', 'min', 'maj', 'maj'];
const MAJOR_SEVENTHS = ['maj7', 'm7', 'm7', 'maj7', '7', 'm7', 'm7b5'];
const MINOR_SEVENTHS = ['m7', 'm7b5', 'maj7', 'm7', 'm7', 'maj7', '7'];

export type DiatonicChord = {
  degree: number;
  roman: string;
  symbol: string;
  root: string;
  quality: string;
  /** Short function name, a convention not a law. */
  role: 'tónica' | 'subdominante' | 'dominante';
};

const FUNCTION_OF_DEGREE: DiatonicChord['role'][] = ['tónica', 'subdominante', 'tónica', 'subdominante', 'dominante', 'tónica', 'dominante'];

function romanFor(degree: number, quality: string) {
  const base = ROMAN[degree];
  if (quality === 'min') return base.toLowerCase();
  if (quality === 'dim' || quality === 'm7b5') return `${base.toLowerCase()}°`;
  return base;
}

export function diatonicChords(key: KeyRef, sevenths = false): DiatonicChord[] {
  const scale = scaleOf(key);
  const qualities = key.mode === 'major' ? MAJOR_QUALITIES : MINOR_QUALITIES;
  const seventhQualities = key.mode === 'major' ? MAJOR_SEVENTHS : MINOR_SEVENTHS;
  return scale.map((root, degree) => {
    const quality = sevenths ? seventhQualities[degree] : qualities[degree];
    const chord = parseChord(`${root}${qualityById(quality)!.suffix}`)!;
    return {
      degree,
      roman: romanFor(degree, qualities[degree]) + (sevenths ? (quality === 'maj7' ? 'maj7' : '7') : ''),
      symbol: chordSymbol(chord),
      root,
      quality,
      role: FUNCTION_OF_DEGREE[degree],
    };
  });
}

/** Is the chord built only from notes of the key? Pitch classes decide, not spelling. */
export function isDiatonic(chord: Chord, key: KeyRef) {
  const scale = new Set(scaleOf(key).map(tonicPc));
  return chord.quality.intervals.every((interval) => scale.has(mod12(chord.rootPc + interval)));
}

/** Roman numeral of a chord inside a key when its root is in the scale and quality matches; otherwise null. */
export function romanOf(text: string, key: KeyRef): string | null {
  const chord = parseChord(text);
  if (!chord) return null;
  const degree = scaleOf(key).findIndex((note) => tonicPc(note) === chord.rootPc);
  if (degree < 0) return null;
  const triad = diatonicChords(key)[degree];
  const seventh = diatonicChords(key, true)[degree];
  if (chord.quality.id === triad.quality) return triad.roman;
  if (chord.quality.id === seventh.quality) return seventh.roman;
  return null;
}

export type Neighbor = { key: KeyRef; relation: string };

/** Keys one step away on the circle plus the relative and parallel. */
export function neighbors(key: KeyRef): Neighbor[] {
  const list = key.mode === 'major' ? CIRCLE_MAJOR : CIRCLE_MINOR;
  const index = list.findIndex((tonic) => tonicPc(tonic) === tonicPc(key.tonic));
  const next = list[(index + 1) % 12];
  const previous = list[(index + 11) % 12];
  return [
    { key: { tonic: next, mode: key.mode }, relation: 'Una quinta arriba (dominante)' },
    { key: { tonic: previous, mode: key.mode }, relation: 'Una quinta abajo (subdominante)' },
    { key: relativeOf(key), relation: key.mode === 'major' ? 'Relativa menor' : 'Relativa mayor' },
    { key: parallelOf(key), relation: key.mode === 'major' ? 'Paralela menor' : 'Paralela mayor' },
  ];
}

/** Distance in steps around the circle between two keys of the same mode (0–6). */
export function circleDistance(a: KeyRef, b: KeyRef) {
  const toMajor = (key: KeyRef) => (key.mode === 'major' ? key : relativeOf(key));
  const list = CIRCLE_MAJOR.map(tonicPc);
  const i = list.indexOf(tonicPc(toMajor(a).tonic));
  const j = list.indexOf(tonicPc(toMajor(b).tonic));
  const raw = Math.abs(i - j);
  return Math.min(raw, 12 - raw);
}

export type Modulation = {
  from: KeyRef;
  to: KeyRef;
  distance: number;
  commonNotes: string[];
  onlyFrom: string[];
  onlyTo: string[];
  changed: Array<{ from: string; to: string }>;
  commonChords: Array<{ symbol: string; fromRoman: string; toRoman: string }>;
  paths: Array<{ name: string; chords: string[]; note: string }>;
};

/**
 * Ways to move from one key to another. These are *possibilities*, not the "correct" modulation:
 * pivot chords are those diatonic to both keys, the dominant path uses the target's V7.
 */
export function modulation(from: KeyRef, to: KeyRef): Modulation {
  const fromScale = scaleOf(from);
  const toScale = scaleOf(to);
  const fromPcs = new Set(fromScale.map(tonicPc));
  const toPcs = new Set(toScale.map(tonicPc));
  const label = (note: string) => prettyRoot(note);
  const commonNotes = fromScale.filter((note) => toPcs.has(tonicPc(note))).map(label);
  const onlyFrom = fromScale.filter((note) => !toPcs.has(tonicPc(note))).map(label);
  const onlyTo = toScale.filter((note) => !fromPcs.has(tonicPc(note))).map(label);
  // A note of the origin that the destination spells with the same letter but altered (F -> F#).
  const changed = fromScale
    .filter((note) => !toPcs.has(tonicPc(note)))
    .flatMap((note) => {
      const other = toScale.find((candidate) => candidate[0] === note[0]);
      return other ? [{ from: label(note), to: label(other) }] : [];
    });

  const fromChords = diatonicChords(from);
  const toChords = diatonicChords(to);
  const commonChords = fromChords.flatMap((chord) => {
    const match = toChords.find((other) => other.symbol === chord.symbol);
    return match ? [{ symbol: chord.symbol, fromRoman: chord.roman, toRoman: match.roman }] : [];
  });

  const tonic = toChords[0].symbol;
  const dominant7 = chordSymbol(parseChord(`${toScale[4]}7`)!);
  const subdominant = toChords[3].symbol;
  const paths: Modulation['paths'] = [];
  const fromTonic = fromChords[0].symbol;
  if (commonChords.length) {
    const pivot = commonChords[0];
    paths.push({
      name: `Por acorde pivote (${pivot.symbol})`,
      chords: [fromTonic, pivot.symbol, dominant7, tonic],
      note: `${pivot.symbol} es ${pivot.fromRoman} en ${keyLabel(from)} y ${pivot.toRoman} en ${keyLabel(to)}: sirve de bisagra.`,
    });
  }
  paths.push({
    name: 'Por dominante del destino',
    chords: [fromTonic, dominant7, tonic],
    note: `${dominant7} anuncia ${keyLabel(to)}; es el camino más directo, aunque el cambio se nota.`,
  });
  paths.push({
    name: 'Con II–V–I en el destino',
    chords: [fromTonic, toChords[1].symbol, dominant7, tonic],
    note: `Un II–V–I completo en ${keyLabel(to)} deja claro el nuevo centro.`,
  });
  if (!commonChords.length) {
    paths.push({ name: 'Por subdominante', chords: [fromTonic, subdominant, dominant7, tonic], note: 'Pasa por el IV del destino antes de afirmar la dominante.' });
  }
  return { from, to, distance: circleDistance(from, to), commonNotes, onlyFrom, onlyTo, changed, commonChords, paths };
}

export const allKeys = (): KeyRef[] => [
  ...CIRCLE_MAJOR.map((tonic) => ({ tonic, mode: 'major' as const })),
  ...CIRCLE_MINOR.map((tonic) => ({ tonic, mode: 'minor' as const })),
];

/** Transposes a key by semitones, choosing the circle spelling. */
export function transposeKey(key: KeyRef, semitones: number): KeyRef {
  const target = mod12(tonicPc(key.tonic) + semitones);
  const list = key.mode === 'major' ? CIRCLE_MAJOR : CIRCLE_MINOR;
  return { tonic: list.find((tonic) => tonicPc(tonic) === target) ?? key.tonic, mode: key.mode };
}

const LATIN_LETTER: Record<string, string> = { C: 'Do', D: 'Re', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si' };
/** "F#" -> "F♯" or "Fa♯", "Bb" -> "B♭" or "Si♭". */
export function tonicName(tonic: string, style: NameStyle) {
  const mark = tonic.slice(1).replace('#', '♯').replace('b', '♭');
  return `${style === 'latin' ? LATIN_LETTER[tonic[0]] : tonic[0]}${mark}`;
}
export const keyTitle = (key: KeyRef, style: NameStyle) =>
  `${tonicName(key.tonic, style)} ${key.mode === 'major' ? 'mayor' : 'menor'}`;
