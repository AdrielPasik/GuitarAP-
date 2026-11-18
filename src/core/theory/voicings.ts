import { chordTones, roleOfDegree, type Chord, type ChordTone } from '@/core/theory/chords';
import { mod12, tuningToMidi } from '@/core/theory/pitch';

/**
 * Guitar voicings, generated from the chord's formula and the instrument's real tuning (never assumed EADGBE).
 *
 * Strings are numbered as guitarists do: string 1 is the highest (thin E in standard tuning), string 6 the lowest.
 * Arrays are indexed by `string - 1`, the same order as `tuning` everywhere in GuitarAP (['E4','B3','G3','D3','A2','E2']).
 *
 * Two different things are kept apart on purpose:
 *  - a harmonic MAP (every note of the chord in a fret range): `chordMap`;
 *  - a playable VOICING (one note per string at most, reachable by one hand): `generateVoicings`.
 */

export type VoicedNote = {
  /** 1..6, guitarist numbering. */
  string: number;
  fret: number;
  midi: number;
  pc: number;
  degree: string;
  role: ChordTone['role'];
  name: string;
};
export type Inversion = 'root' | 'first' | 'second' | 'third' | 'other';
export type Voicing = {
  id: string;
  /** Index = string - 1. null = the string is not played. */
  frets: Array<number | null>;
  /** Sounding notes, lowest pitch first. */
  notes: VoicedNote[];
  bass: VoicedNote;
  inversion: Inversion;
  /** Chord degrees not present in this voicing (e.g. «5» in a 9th chord). Always shown, never hidden. */
  omitted: string[];
  /** Lowest fretted note (0 when the voicing only uses open strings). */
  position: number;
  /** Fret distance between the lowest and highest fretted notes. */
  span: number;
  fingers: number;
  barre?: { fret: number; from: number; to: number };
  kind: 'open' | 'barre' | 'closed';
  strings: number;
};

export const INVERSION_NAMES: Record<Inversion, string> = {
  root: 'Estado fundamental',
  first: 'Primera inversión',
  second: 'Segunda inversión',
  third: 'Tercera inversión',
  other: 'Tensión en el bajo',
};

export function inversionOf(degree: string): Inversion {
  const role = roleOfDegree(degree);
  if (role === 'root') return 'root';
  if (role === 'third') return 'first';
  if (role === 'fifth') return 'second';
  if (role === 'seventh') return 'third';
  return 'other';
}

/** Degrees a guitarist may leave out without changing the chord's name. Root, 3rd, 7th and alterations always stay. */
export function omittableDegrees(chord: Chord): Set<string> {
  const degrees = chord.quality.degrees;
  const omittable = new Set<string>();
  if (degrees.includes('5') && degrees.length >= 4) omittable.add('5');
  if (degrees.includes('13')) {
    omittable.add('9');
    omittable.add('11');
  }
  if (degrees.includes('11') && degrees.length >= 6) omittable.add('9');
  return omittable;
}

export type VoicingOptions = {
  tuning: readonly string[];
  /** Highest fret considered. */
  maxFret?: number;
  /** Only voicings whose fretted notes all lie in [minPosition, maxPosition] (open strings always allowed). */
  minPosition?: number;
  maxPosition?: number;
  /** Largest stretch between fretted notes, in frets. 3 = four consecutive frets: a comfortable hand. */
  maxSpan?: number;
  minStrings?: number;
  maxStrings?: number;
  /** Required bass: an inversion, or any. */
  bass?: 'any' | Inversion;
  /** Only these strings may sound (1..6). */
  allowedStrings?: number[];
  /** Played strings must be adjacent (no muted string in between). */
  adjacent?: boolean;
  /** Use open strings (default true). */
  open?: boolean;
  limit?: number;
};

type Candidate = { fret: number; tone: ChordTone } | null;

export function tuningMidis(tuning: readonly string[]) {
  return tuning.map((open) => {
    const midi = tuningToMidi(open);
    if (midi === null) throw new Error(`Afinación inválida: ${open}`);
    return midi;
  });
}

/** Fingers needed. A first-finger barre on the lowest fret is used when 5+ notes are fretted and nothing under it is open or silent. */
export function fingering(frets: Array<number | null>) {
  const fretted = frets
    .map((fret, index) => ({ fret, string: index + 1 }))
    .filter((item): item is { fret: number; string: number } => item.fret !== null && item.fret > 0);
  if (fretted.length <= 4) return { fingers: fretted.length };
  const min = Math.min(...fretted.map((item) => item.fret));
  const atMin = fretted.filter((item) => item.fret === min);
  if (atMin.length < 2) return { fingers: fretted.length };
  const from = Math.min(...atMin.map((item) => item.string));
  const to = Math.max(...atMin.map((item) => item.string));
  for (let string = from; string <= to; string += 1) {
    const fret = frets[string - 1];
    if (fret === null || fret === 0 || fret < min) return { fingers: fretted.length };
  }
  return { fingers: fretted.length - atMin.length + 1, barre: { fret: min, from, to } };
}

/**
 * Playable voicings of the chord under the options, best first. Every note is computed from the tuning, so what a
 * voicing says it contains is exactly what sounds.
 */
export function generateVoicings(chord: Chord, options: VoicingOptions): Voicing[] {
  const tuning = tuningMidis(options.tuning);
  const maxFret = options.maxFret ?? 15;
  const maxSpan = options.maxSpan ?? 3;
  const tones = chordTones(chord);
  const byPc = new Map<number, ChordTone>();
  for (const tone of tones) if (!byPc.has(tone.pc)) byPc.set(tone.pc, tone);
  const omittable = omittableDegrees(chord);
  const required = tones.filter((tone) => !omittable.has(tone.degree));
  const minStrings = options.minStrings ?? Math.min(Math.max(3, required.length), tuning.length);
  const maxStrings = options.maxStrings ?? tuning.length;
  const allowed = new Set(options.allowedStrings ?? tuning.map((_, index) => index + 1));
  const lo = options.minPosition ?? 0;
  const hi = Math.min(options.maxPosition ?? maxFret, maxFret);
  const useOpen = options.open ?? true;

  const perString: Candidate[][] = tuning.map((open, index) => {
    const list: Candidate[] = [null];
    if (!allowed.has(index + 1)) return list;
    for (let fret = 0; fret <= maxFret; fret += 1) {
      if (fret === 0 && !useOpen) continue;
      if (fret > 0 && (fret < lo || fret > hi)) continue;
      const tone = byPc.get(mod12(open + fret));
      if (tone) list.push({ fret, tone });
    }
    return list;
  });

  const results: Voicing[] = [];
  const pick: Candidate[] = new Array(tuning.length).fill(null);

  const finish = () => {
    const playedIdx: number[] = [];
    pick.forEach((item, index) => {
      if (item) playedIdx.push(index);
    });
    if (playedIdx.length < minStrings || playedIdx.length > maxStrings) return;
    const first = playedIdx[0];
    const last = playedIdx[playedIdx.length - 1];
    const interiorMutes = last - first + 1 - playedIdx.length;
    if (options.adjacent ? interiorMutes > 0 : interiorMutes > 1) return;
    const present = new Set(playedIdx.map((index) => pick[index]!.tone.degree));
    if (!required.every((tone) => present.has(tone.degree))) return;
    const fretted = playedIdx.map((index) => pick[index]!.fret).filter((fret) => fret > 0);
    const span = fretted.length ? Math.max(...fretted) - Math.min(...fretted) : 0;
    const frets = pick.map((item) => (item ? item.fret : null));
    const { fingers, barre } = fingering(frets);
    if (fingers > 4) return;
    const notes: VoicedNote[] = playedIdx
      .map((index) => {
        const item = pick[index]!;
        const midi = tuning[index] + item.fret;
        return { string: index + 1, fret: item.fret, midi, pc: mod12(midi), degree: item.tone.degree, role: item.tone.role, name: item.tone.name };
      })
      .sort((a, b) => a.midi - b.midi);
    const bass = notes[0];
    const inversion = inversionOf(bass.degree);
    if (options.bass && options.bass !== 'any' && options.bass !== inversion) return;
    results.push({
      id: frets.map((fret) => (fret === null ? 'x' : fret)).join('-'),
      frets,
      notes,
      bass,
      inversion,
      omitted: tones.filter((tone) => !present.has(tone.degree)).map((tone) => tone.degree),
      position: fretted.length ? Math.min(...fretted) : 0,
      span,
      fingers,
      barre,
      kind: frets.some((fret) => fret === 0) ? 'open' : barre ? 'barre' : 'closed',
      strings: playedIdx.length,
    });
  };

  const walk = (index: number, minF: number, maxF: number) => {
    if (index === tuning.length) {
      finish();
      return;
    }
    for (const candidate of perString[index]) {
      let nextMin = minF;
      let nextMax = maxF;
      if (candidate && candidate.fret > 0) {
        nextMin = Math.min(minF, candidate.fret);
        nextMax = Math.max(maxF, candidate.fret);
        if (nextMax - nextMin > maxSpan) continue;
      }
      pick[index] = candidate;
      walk(index + 1, nextMin, nextMax);
    }
    pick[index] = null;
  };
  walk(0, Infinity, -Infinity);

  const score = (voicing: Voicing) =>
    voicing.span * 3 +
    voicing.omitted.length * 2 +
    (voicing.inversion === 'root' ? 0 : 3) +
    (6 - voicing.strings) * 1.5 +
    voicing.position * 0.35 +
    (voicing.barre ? 1 : 0) +
    (voicing.notes.length - new Set(voicing.notes.map((note) => note.pc)).size) * 0.5;
  results.sort((a, b) => score(a) - score(b) || a.position - b.position);
  return results.slice(0, options.limit ?? 60);
}

/**
 * Close voicings on a set of adjacent strings: one chord tone per string, every tone exactly once, up the neck.
 * The study tool for triads (3 strings) and four-note sevenths (4 strings).
 */
export function stringSetVoicings(chord: Chord, tuning: readonly string[], strings: number[], maxFret = 15): Voicing[] {
  const unique = new Set(chordTones(chord).map((tone) => tone.pc)).size;
  return generateVoicings(chord, {
    tuning,
    maxFret,
    allowedStrings: strings,
    minStrings: strings.length,
    maxStrings: strings.length,
    maxSpan: 4,
    adjacent: true,
    limit: 500,
  })
    .filter((voicing) => voicing.omitted.length === 0 && new Set(voicing.notes.map((note) => note.pc)).size === unique && voicing.notes.length === unique)
    .sort((a, b) => a.position - b.position || a.span - b.span);
}

/** Every note of the chord between two frets: a map of possibilities, not something to play at once. */
export function chordMap(chord: Chord, tuning: readonly string[], from = 0, to = 12) {
  const midis = tuningMidis(tuning);
  const tones = chordTones(chord);
  const byPc = new Map(tones.map((tone) => [tone.pc, tone]));
  const out: VoicedNote[] = [];
  midis.forEach((open, index) => {
    for (let fret = from; fret <= to; fret += 1) {
      const tone = byPc.get(mod12(open + fret));
      if (tone) out.push({ string: index + 1, fret, midi: open + fret, pc: tone.pc, degree: tone.degree, role: tone.role, name: tone.name });
    }
  });
  return out;
}

/** Standard «x32010» label, from string 6 to string 1. Frets above 9 are parenthesised. */
export const shapeLabel = (voicing: Pick<Voicing, 'frets'>) =>
  [...voicing.frets]
    .reverse()
    .map((fret) => (fret === null ? 'x' : fret > 9 ? `(${fret})` : String(fret)))
    .join('');

/** Adjacent string sets used for study, with guitarist numbering (1 = highest string). */
export const TRIAD_STRING_SETS = [[1, 2, 3], [2, 3, 4], [3, 4, 5], [4, 5, 6]];
export const FOUR_STRING_SETS = [[1, 2, 3, 4], [2, 3, 4, 5], [3, 4, 5, 6]];
