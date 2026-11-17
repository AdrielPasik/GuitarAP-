import { describe, expect, it } from 'vitest';
import { lyricChords, parseLyrics } from '@/features/lyrics/parse';

describe('lyrics', () => {
  it('reads sections, blank lines and plain lines', () => {
    const lines = parseLyrics('# Verso 1\nHoy vuelvo a casa\n\n#Estribillo\nY canto');
    expect(lines.map((line) => line.kind)).toEqual(['section', 'line', 'blank', 'section', 'line']);
    expect(lines[0]).toEqual({ kind: 'section', title: 'Verso 1' });
    expect(lines[3]).toEqual({ kind: 'section', title: 'Estribillo' });
  });
  it('places chords over the word they precede and keeps other brackets as text', () => {
    const [line] = parseLyrics('[C]Hoy vuelvo [G]a casa [sotto voce]');
    expect(line).toMatchObject({ kind: 'line', hasChords: true });
    if (line.kind !== 'line') return;
    expect(line.segments).toEqual([
      { chord: 'C', text: 'Hoy vuelvo ' },
      { chord: 'G', text: 'a casa [sotto voce]' },
    ]);
    expect(lyricChords('[Am]uno [F♯m7]dos [Bb]tres')).toEqual(['Am', 'F♯m7', 'B♭']);
  });
});
