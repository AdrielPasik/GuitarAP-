import { describe, expect, it } from 'vitest';
import { chordSymbol, chordTones, parseChord, transposeChord } from '@/core/theory/chords';
import {
  accidentalsOf, circleDistance, diatonicChords, isDiatonic, modulation, neighbors, relativeOf, romanOf, scaleNames, scaleOf,
} from '@/core/theory/keys';
import { formatNote, midiToHz, parseNote, tuningToMidi } from '@/core/theory/pitch';

describe('pitch', () => {
  it('Do4 = C4 = 60 and A4 = 440 Hz', () => {
    expect(parseNote('Do4')?.midi).toBe(60);
    expect(parseNote('C4')?.midi).toBe(60);
    expect(parseNote('Mi4')?.midi).toBe(64);
    expect(parseNote('Sol4')?.midi).toBe(67);
    expect(midiToHz(69)).toBeCloseTo(440);
    expect(midiToHz(60)).toBeCloseTo(261.63, 1);
  });
  it('reads both systems, accidentals and octaves, and rejects chords', () => {
    expect(parseNote('Sib3')).toEqual({ midi: 58, accidental: 'flat' });
    expect(parseNote('Bb3')).toEqual({ midi: 58, accidental: 'flat' });
    expect(parseNote('Fa#4')?.midi).toBe(66);
    expect(parseNote('F♯4')?.midi).toBe(66);
    expect(parseNote('Dob4')?.midi).toBe(59);
    expect(parseNote('Lab2')?.midi).toBe(44);
    expect(parseNote('Cmaj7')).toBeNull();
    expect(parseNote('Am')).toBeNull();
    expect(parseNote('C')).toBeNull();
  });
  it('formats the same pitch in either naming system without changing it', () => {
    expect(formatNote(60, 'latin')).toBe('Do4');
    expect(formatNote(60, 'english')).toBe('C4');
    expect(formatNote(61, 'latin', 'flat')).toBe('Re♭4');
    expect(formatNote(61, 'english', 'sharp')).toBe('C♯4');
    for (let midi = 24; midi < 100; midi += 1) {
      expect(parseNote(formatNote(midi, 'latin'))?.midi).toBe(midi);
      expect(parseNote(formatNote(midi, 'english', 'flat'))?.midi).toBe(midi);
    }
  });
  it('maps the standard tuning to MIDI', () => {
    expect(['E4', 'B3', 'G3', 'D3', 'A2', 'E2'].map(tuningToMidi)).toEqual([64, 59, 55, 50, 45, 40]);
  });
});

describe('chords', () => {
  it('parses symbols and refuses note names', () => {
    expect(chordSymbol(parseChord('Am')!)).toBe('Am');
    expect(chordSymbol(parseChord('Bbmaj7')!)).toBe('B♭maj7');
    expect(chordSymbol(parseChord('F#m7b5')!)).toBe('F♯m7♭5');
    expect(parseChord('C4')).toBeNull();
    expect(parseChord('H')).toBeNull();
    expect(parseChord('Cxyz')).toBeNull();
    expect(parseChord('C/G')?.bass).toBe('G');
  });
  it('spells chord tones with the right letters', () => {
    expect(chordTones(parseChord('C')!).map((tone) => tone.name)).toEqual(['C', 'E', 'G']);
    expect(chordTones(parseChord('Eb')!).map((tone) => tone.name)).toEqual(['E♭', 'G', 'B♭']);
    expect(chordTones(parseChord('G7')!).map((tone) => tone.name)).toEqual(['G', 'B', 'D', 'F']);
    expect(chordTones(parseChord('Bdim')!).map((tone) => tone.name)).toEqual(['B', 'D', 'F']);
    expect(chordTones(parseChord('Caug')!).map((tone) => tone.name)).toEqual(['C', 'E', 'G♯']);
  });
  it('transposes explicitly and reversibly', () => {
    const progression = ['C', 'G', 'Am', 'F'];
    const up = progression.map((chord) => transposeChord(chord, 2));
    expect(up).toEqual(['D', 'A', 'Bm', 'G']);
    expect(up.map((chord) => transposeChord(chord, -2))).toEqual(progression);
    expect(transposeChord('Dm7', 3, true)).toBe('Fm7');
    expect(transposeChord('C/G', 2)).toBe('D/A');
  });
});

describe('keys', () => {
  it('C major: notes, diatonic chords, functions', () => {
    expect(scaleNames({ tonic: 'C', mode: 'major' }, 'latin')).toEqual(['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Si']);
    const chords = diatonicChords({ tonic: 'C', mode: 'major' });
    expect(chords.map((chord) => chord.symbol)).toEqual(['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim']);
    expect(chords.map((chord) => chord.roman)).toEqual(['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']);
    expect(diatonicChords({ tonic: 'C', mode: 'major' }, true).map((chord) => chord.symbol)).toEqual(['Cmaj7', 'Dm7', 'Em7', 'Fmaj7', 'G7', 'Am7', 'Bm7♭5']);
  });
  it('spells flat and sharp keys with one letter per degree', () => {
    expect(scaleOf({ tonic: 'Db', mode: 'major' })).toEqual(['Db', 'Eb', 'F', 'Gb', 'Ab', 'Bb', 'C']);
    expect(scaleOf({ tonic: 'F#', mode: 'major' })).toEqual(['F#', 'G#', 'A#', 'B', 'C#', 'D#', 'E#']);
    expect(scaleOf({ tonic: 'G', mode: 'major' })).toEqual(['G', 'A', 'B', 'C', 'D', 'E', 'F#']);
    expect(accidentalsOf({ tonic: 'Eb', mode: 'major' }).flats).toBe(3);
    expect(accidentalsOf({ tonic: 'D', mode: 'major' }).sharps).toBe(2);
  });
  it('relatives and the whole circle', () => {
    expect(relativeOf({ tonic: 'C', mode: 'major' })).toEqual({ tonic: 'A', mode: 'minor' });
    expect(relativeOf({ tonic: 'A', mode: 'minor' })).toEqual({ tonic: 'C', mode: 'major' });
    expect(relativeOf({ tonic: 'Db', mode: 'major' })).toEqual({ tonic: 'Bb', mode: 'minor' });
    expect(neighbors({ tonic: 'C', mode: 'major' })[0].key.tonic).toBe('G');
    expect(neighbors({ tonic: 'C', mode: 'major' })[1].key.tonic).toBe('F');
    expect(circleDistance({ tonic: 'C', mode: 'major' }, { tonic: 'G', mode: 'major' })).toBe(1);
    expect(circleDistance({ tonic: 'C', mode: 'major' }, { tonic: 'F#', mode: 'major' })).toBe(6);
    expect(circleDistance({ tonic: 'A', mode: 'minor' }, { tonic: 'C', mode: 'major' })).toBe(0);
  });
  it('A minor chords and roman numerals', () => {
    expect(diatonicChords({ tonic: 'A', mode: 'minor' }).map((chord) => chord.symbol)).toEqual(['Am', 'Bdim', 'C', 'Dm', 'Em', 'F', 'G']);
    expect(diatonicChords({ tonic: 'A', mode: 'minor' }).map((chord) => chord.roman)).toEqual(['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII']);
    expect(romanOf('G7', { tonic: 'C', mode: 'major' })).toBe('V7');
    expect(romanOf('Eb', { tonic: 'C', mode: 'major' })).toBeNull();
    expect(isDiatonic(parseChord('Am')!, { tonic: 'C', mode: 'major' })).toBe(true);
    expect(isDiatonic(parseChord('A')!, { tonic: 'C', mode: 'major' })).toBe(false);
  });
  it('C to G: one changed note, shared chords, several offered paths', () => {
    const result = modulation({ tonic: 'C', mode: 'major' }, { tonic: 'G', mode: 'major' });
    expect(result.commonNotes).toHaveLength(6);
    expect(result.changed).toEqual([{ from: 'F', to: 'F♯' }]);
    expect(result.commonChords.map((chord) => chord.symbol).sort()).toEqual(['Am', 'Em', 'C', 'G'].sort());
    expect(result.paths.length).toBeGreaterThanOrEqual(2);
    expect(result.paths.some((path) => path.chords.includes('D7'))).toBe(true);
  });
});
