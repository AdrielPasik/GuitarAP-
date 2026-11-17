import { describe, expect, it } from 'vitest';
import { parseProgression } from '@/features/chords/progression';

describe('progression entry', () => {
  it('reads C - G - Am - F in any separator and keeps durations', () => {
    expect(parseProgression('C G Am F').items.map((item) => item.symbol)).toEqual(['C', 'G', 'Am', 'F']);
    expect(parseProgression('C - G - Am7 - F:4').items.map((item) => [item.symbol, item.beats])).toEqual([['C', 2], ['G', 2], ['Am7', 2], ['F', 4]]);
    expect(parseProgression('Bbmaj7 | Gm7').items.map((item) => item.symbol)).toEqual(['B♭maj7', 'Gm7']);
  });
  it('refuses notes and nonsense without producing a half progression', () => {
    const result = parseProgression('C G C4 Zm');
    expect(result.errors.map((error) => error.token)).toEqual(['C4', 'Zm']);
    expect(result.errors[0].reason).toMatch(/nota con octava/);
  });
});
