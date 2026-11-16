import { describe, expect, it } from 'vitest';
import { degreeOf, emphasisOf, EMPHASIS_ROLES, presentDistances } from '@/core/harmony';

const labels = (semitones: number[], context: number[] = semitones) =>
  semitones.map((value) => degreeOf(value, new Set(context)).label);

describe('harmonic degrees', () => {
  it('reads the major scale as 1 2 3 4 5 6 7', () => {
    expect(labels([0, 2, 4, 5, 7, 9, 11])).toEqual(['1', '2', '3', '4', '5', '6', '7']);
  });

  it('reads natural minor with flat third, sixth and seventh', () => {
    expect(labels([0, 2, 3, 5, 7, 8, 10])).toEqual(['1', '2', '♭3', '4', '5', '♭6', '♭7']);
  });

  it('does not confuse the number of the degree with the chromatic distance', () => {
    expect(degreeOf(7).label).toBe('5');
    expect(degreeOf(4).label).toBe('3');
    expect(degreeOf(11).label).toBe('7');
    expect(degreeOf(10).label).toBe('♭7');
  });

  it('spells six semitones from the context: ♭5 in locrian and blues, ♯4 in lydian', () => {
    expect(degreeOf(6, new Set([0, 1, 3, 5, 6, 8, 10])).label).toBe('♭5');
    expect(degreeOf(6, new Set([0, 3, 5, 6, 7, 10])).label).toBe('♭5');
    expect(degreeOf(6, new Set([0, 2, 4, 6, 7, 9, 11])).label).toBe('♯4');
    expect(degreeOf(6, new Set([0, 2, 4, 6, 7, 9, 11])).role).toBe('other');
  });

  it('spells eight semitones as ♯5 over a major third without a fifth, otherwise ♭6', () => {
    expect(degreeOf(8, new Set([0, 4, 8])).label).toBe('♯5');
    expect(degreeOf(8, new Set([0, 4, 8])).role).toBe('fifth');
    expect(degreeOf(8, new Set([0, 2, 3, 5, 7, 8, 10])).label).toBe('♭6');
  });

  it('assigns one color role per harmonic function', () => {
    const role = (value: number) => degreeOf(value).role;
    expect([role(0), role(3), role(4), role(7), role(10), role(11), role(2), role(5), role(9)]).toEqual([
      'root', 'third', 'third', 'fifth', 'seventh', 'seventh', 'other', 'other', 'other',
    ]);
    expect(degreeOf(3).altered).toBe(true);
    expect(degreeOf(4).altered).toBe(false);
  });

  it('offers extension names only on request', () => {
    expect(degreeOf(2, new Set(), { extensions: true }).label).toBe('9');
    expect(degreeOf(5, new Set(), { extensions: true }).label).toBe('11');
    expect(degreeOf(9, new Set(), { extensions: true }).label).toBe('13');
    expect(degreeOf(2).label).toBe('2');
  });

  it('measures the distances present relative to the tonic', () => {
    expect([...presentDistances([0, 4, 7, 11], 0)].sort((a, b) => a - b)).toEqual([0, 4, 7, 11]);
    expect([...presentDistances([9, 0, 4], 9)].sort((a, b) => a - b)).toEqual([0, 3, 7]);
  });

  it('recognises the highlight presets', () => {
    expect(emphasisOf(undefined)).toBe('all');
    expect(emphasisOf(EMPHASIS_ROLES.triad)).toBe('triad');
    expect(emphasisOf(['root', 'fifth'])).toBe('custom');
  });
});
