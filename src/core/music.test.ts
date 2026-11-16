import { describe, expect, it } from 'vitest';
import { intervalName, noteName, pitchClassAt, scalePositions, stringName } from '@/core/music';

describe('music theory', () => {
  it('names all twelve pitch classes in latin notation without corrupting Do', () => {
    expect(Array.from({ length: 12 }, (_, pitch) => noteName(pitch, 0, true))).toEqual([
      'Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si',
    ]);
  });

  it('names all twelve pitch classes in english notation', () => {
    expect(Array.from({ length: 12 }, (_, pitch) => noteName(pitch, 0, false))).toEqual([
      'C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B',
    ]);
  });

  it('computes the sounding note of a fret from the open string', () => {
    expect(stringName('E4', true)).toBe('Mi');
    expect(noteName(pitchClassAt('E2', 8), 0, true)).toBe('Do');
    expect(noteName(pitchClassAt('B3', 1), 0, true)).toBe('Do');
    expect(noteName(pitchClassAt('G3', 0), 0, false)).toBe('G');
  });

  it('labels intervals relative to the tonic', () => {
    expect(intervalName(0, 0)).toBe('1');
    expect(intervalName(3, 0)).toBe('♭3');
    expect(intervalName(2, 4)).toBe('♭7');
    expect(intervalName(2, 9)).toBe('4');
  });

  it('lists the notes of a scale inside a fret window', () => {
    const cMajor = scalePositions(['E4', 'B3', 'G3', 'D3', 'A2', 'E2'], 0, 'Mayor', 0, 12);
    const lowE = cMajor.filter((note) => note.string === 5).map((note) => note.fret);
    expect(lowE).toEqual([0, 1, 3, 5, 7, 8, 10, 12]);
  });
});
