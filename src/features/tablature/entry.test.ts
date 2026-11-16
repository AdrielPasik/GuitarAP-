import { describe, expect, it } from 'vitest';
import { enterDigit, type DigitResult } from '@/features/tablature/entry';

/** Runs a sequence of keys against one cell, as the editor does, and returns the committed values. */
function typeInto(keys: string, maxFret = 24) {
  const committed: number[] = [];
  const rejected: string[] = [];
  let pending: number | null = null;
  for (const key of keys) {
    if (key === '↵') {
      if (pending !== null) committed.push(pending);
      pending = null;
      continue;
    }
    const result: DigitResult = enterDigit(pending, Number(key), maxFret);
    if (result.kind === 'rejected') rejected.push(key);
    else if (result.pending) pending = result.value;
    else {
      committed.push(result.value);
      pending = null;
    }
  }
  return { committed, pending, rejected };
}

describe('deterministic fret entry', () => {
  it.each([
    ['3', [3]],
    ['7', [7]],
    ['0', [0]],
    ['12', [12]],
    ['15', [15]],
    ['24', [24]],
    ['10', [10]],
  ])('writes %s as one fret', (keys, expected) => {
    expect(typeInto(keys).committed).toEqual(expected);
  });

  it('keeps 1 and 2 pending until confirmed, however slowly they are typed', () => {
    expect(typeInto('1')).toMatchObject({ committed: [], pending: 1 });
    expect(typeInto('1↵').committed).toEqual([1]);
    expect(typeInto('2↵').committed).toEqual([2]);
  });

  it('rejects an invalid second digit instead of writing somewhere else', () => {
    const result = typeInto('25');
    expect(result.rejected).toEqual(['5']);
    expect(result.committed).toEqual([]);
    expect(result.pending).toBe(2);
    expect(typeInto('25↵').committed).toEqual([2]);
  });

  it('adapts to a shorter neck', () => {
    expect(typeInto('2', 19).committed).toEqual([2]);
    expect(typeInto('18', 19).committed).toEqual([18]);
    expect(typeInto('19', 19).committed).toEqual([19]);
    expect(typeInto('1', 9).committed).toEqual([1]);
  });

  it('never produces two events from a two digit number', () => {
    expect(typeInto('12').committed).toHaveLength(1);
  });
});
