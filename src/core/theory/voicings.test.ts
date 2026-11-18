import { describe, expect, it } from 'vitest';
import { chordPitchClasses, chordSymbol, chordTones, parseChord } from '@/core/theory/chords';
import { mod12 } from '@/core/theory/pitch';
import { chordMap, generateVoicings, omittableDegrees, shapeLabel, stringSetVoicings, tuningMidis, TRIAD_STRING_SETS } from '@/core/theory/voicings';

const STANDARD = ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'];
const DROP_D = ['E4', 'B3', 'G3', 'D3', 'A2', 'D2'];
const chord = (text: string) => {
  const parsed = parseChord(text);
  if (!parsed) throw new Error(text);
  return parsed;
};
const names = (text: string) => chordTones(chord(text)).map((tone) => tone.name).join(' ');
const degrees = (text: string) => chord(text).quality.degrees.join(' ');

describe('chord formulas (the laboratory catalog)', () => {
  it('spells the essential chords correctly', () => {
    expect(names('C')).toBe('C E G');
    expect(names('Cm')).toBe('C E♭ G');
    expect(names('Cmaj7')).toBe('C E G B');
    expect(names('C7')).toBe('C E G B♭');
    expect(names('Cm7')).toBe('C E♭ G B♭');
    expect(names('Cm(maj7)')).toBe('C E♭ G B');
    expect(names('Cadd9')).toBe('C E G D');
    expect(names('C9')).toBe('C E G B♭ D');
    expect(names('Cmaj9')).toBe('C E G B D');
    expect(names('Am9')).toBe('A C E G B');
    expect(names('Gm7')).toBe('G B♭ D F');
    expect(names('Bdim')).toBe('B D F');
    expect(names('Bm7b5')).toBe('B D F A');
    expect(names('Bdim7')).toBe('B D F A♭');
    expect(names('Caug')).toBe('C E G♯');
  });
  it('keeps add9, 9 and maj9 different, and 7 / maj7 / m7 / m(maj7) different', () => {
    expect(degrees('Cadd9')).toBe('1 3 5 9');
    expect(degrees('C9')).toBe('1 3 5 ♭7 9');
    expect(degrees('Cmaj9')).toBe('1 3 5 7 9');
    const sets = ['C7', 'Cmaj7', 'Cm7', 'Cm(maj7)'].map((text) => chordPitchClasses(chord(text)).join(','));
    expect(new Set(sets).size).toBe(4);
  });
  it('reads altered dominants, 6/9, 11 and 13 and writes them back', () => {
    expect(names('G7b9')).toBe('G B D F A♭');
    expect(names('G7#9')).toBe('G B D F A♯');
    expect(names('C6/9')).toBe('C E G A D');
    expect(chordSymbol(chord('C6/9'))).toBe('C6/9');
    expect(names('G13')).toBe('G B D F A E');
    expect(names('Am11')).toBe('A C E G B D');
    expect(chordSymbol(chord('E7#9'))).toBe('E7♯9');
    expect(parseChord('C4')).toBeNull();
    expect(parseChord('C8')).toBeNull();
  });
});

/** The core guarantee: every note a voicing claims is the note that string and fret actually produce. */
function assertHonest(text: string, tuning: string[]) {
  const parsed = chord(text);
  const pcs = new Set(chordPitchClasses(parsed));
  const open = tuningMidis(tuning);
  const voicings = generateVoicings(parsed, { tuning });
  expect(voicings.length, text).toBeGreaterThan(0);
  for (const voicing of voicings) {
    const sounding = voicing.frets.flatMap((fret, index) => (fret === null ? [] : [open[index] + fret]));
    expect(voicing.notes.map((note) => note.midi).sort((a, b) => a - b)).toEqual(sounding.sort((a, b) => a - b));
    for (const midi of sounding) expect(pcs.has(mod12(midi)), `${text} ${shapeLabel(voicing)}`).toBe(true);
    // Root, third and seventh are never omitted; only degrees declared omittable can be missing.
    const omittable = omittableDegrees(parsed);
    for (const degree of voicing.omitted) expect(omittable.has(degree), `${text} omits ${degree}`).toBe(true);
    const present = new Set(voicing.notes.map((note) => note.degree));
    for (const tone of chordTones(parsed)) expect(present.has(tone.degree) || voicing.omitted.includes(tone.degree)).toBe(true);
    expect(voicing.span).toBeLessThanOrEqual(3);
    expect(voicing.fingers).toBeLessThanOrEqual(4);
    expect(voicing.bass.midi).toBe(Math.min(...sounding));
  }
}

describe('voicing generator', () => {
  it.each(['C', 'Cm', 'Cmaj7', 'C7', 'Cm7', 'Cadd9', 'C9', 'Cmaj9', 'Am9', 'Gm7', 'Bdim', 'Bm7b5', 'Cdim7', 'G13', 'E7#9'])(
    '%s: every proposed shape sounds exactly the chord',
    (text) => assertHonest(text, STANDARD),
  );
  it('finds the classic open shapes', () => {
    const shapes = (text: string) => generateVoicings(chord(text), { tuning: STANDARD, limit: 400 }).map(shapeLabel);
    expect(shapes('C')).toContain('x32010');
    expect(shapes('Am')).toContain('x02210');
    expect(shapes('G')).toContain('320003');
    expect(shapes('Cmaj7')).toContain('x32000');
    expect(shapes('E')).toContain('022100');
    expect(shapes('F')).toContain('133211'); // barre
  });
  it('marks the barre and counts fingers correctly', () => {
    const f = generateVoicings(chord('F'), { tuning: STANDARD, limit: 400 }).find((voicing) => shapeLabel(voicing) === '133211')!;
    expect(f.barre).toEqual({ fret: 1, from: 1, to: 6 });
    expect(f.fingers).toBe(4);
    expect(f.kind).toBe('barre');
  });
  it('declares the omitted fifth instead of pretending it is there', () => {
    const c9 = generateVoicings(chord('C9'), { tuning: STANDARD, limit: 400 });
    const shape = c9.find((voicing) => shapeLabel(voicing) === 'x3233x');
    expect(shape).toBeDefined();
    expect(shape!.omitted).toEqual(['5']);
    expect(shape!.notes.map((note) => note.degree)).not.toContain('5');
  });
  it('filters by bass note (inversions)', () => {
    const first = generateVoicings(chord('C'), { tuning: STANDARD, bass: 'first', limit: 100 });
    expect(first.length).toBeGreaterThan(0);
    for (const voicing of first) expect(voicing.bass.name).toBe('E');
  });
  it('uses the real tuning: drop D changes the shapes', () => {
    assertHonest('D', DROP_D);
    const shapes = generateVoicings(chord('D'), { tuning: DROP_D, limit: 400 }).map(shapeLabel);
    expect(shapes).toContain('000232');
  });
});

describe('triads and inversions on string sets', () => {
  it('C major on strings 1-2-3: every inversion, each note once', () => {
    const list = stringSetVoicings(chord('C'), STANDARD, [1, 2, 3]);
    const kinds = new Set(list.map((voicing) => voicing.inversion));
    expect(kinds).toEqual(new Set(['root', 'first', 'second']));
    for (const voicing of list) {
      expect(voicing.notes).toHaveLength(3);
      expect(new Set(voicing.notes.map((note) => note.name))).toEqual(new Set(['C', 'E', 'G']));
      expect(voicing.frets.slice(3)).toEqual([null, null, null]);
    }
    // Root position on 3-2-1: G string 5 (C), B string 5 (E), e string 3 (G).
    expect(list.map(shapeLabel)).toContain('xxx553');
  });
  it('first inversion has the third in the bass, second the fifth', () => {
    for (const set of TRIAD_STRING_SETS) {
      for (const voicing of stringSetVoicings(chord('C'), STANDARD, set)) {
        const expected = { root: 'C', first: 'E', second: 'G' }[voicing.inversion as 'root' | 'first' | 'second'];
        expect(voicing.bass.name).toBe(expected);
      }
    }
  });
  it('sevenths on four strings include the third inversion', () => {
    const list = stringSetVoicings(chord('G7'), STANDARD, [1, 2, 3, 4]);
    expect(new Set(list.map((voicing) => voicing.inversion)).has('third')).toBe(true);
    for (const voicing of list.filter((item) => item.inversion === 'third')) expect(voicing.bass.name).toBe('F');
  });
});

describe('chord map (possibilities, not a shape)', () => {
  it('lists every chord tone in range on every string', () => {
    const map = chordMap(chord('Cmaj7'), STANDARD, 0, 12);
    expect(map.every((note) => [0, 4, 7, 11].includes(note.pc))).toBe(true);
    expect(map.filter((note) => note.string === 6).map((note) => note.fret)).toEqual([0, 3, 7, 8, 12]);
  });
});
