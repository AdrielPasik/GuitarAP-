import type { ChordItem } from '@/core/model';
import { chordSymbol, parseChord } from '@/core/theory/chords';

/** "C - G - Am - F", "C G Am F" or "C | G | Am7 | F:4" (length in beats after a colon). */
export function parseProgression(text: string, beats = 2) {
  const tokens = text.replace(/[—–|,;]/g, ' ').replace(/(^|\s)-(?=\s|$)/g, ' ').split(/\s+/).filter(Boolean);
  const items: ChordItem[] = [];
  const errors: Array<{ token: string; reason: string }> = [];
  for (const token of tokens) {
    const [symbol, length] = token.split(':');
    const chord = parseChord(symbol);
    if (!chord) {
      errors.push({
        token,
        reason: /\d$/.test(symbol) && /^[A-Ga-g]/.test(symbol) && /^[A-G][#b]?\d$/.test(symbol)
          ? 'Eso es una nota con octava. Un acorde se escribe C, Am, G7, Cmaj7…'
          : 'No es un acorde que reconozca. Probá con C, Am, G7, Dm7, Cmaj7 o F#m7b5.',
      });
      continue;
    }
    const value = length === undefined ? beats : Number(length);
    if (!Number.isFinite(value) || value <= 0 || value > 16) {
      errors.push({ token, reason: 'La duración debe ser un número de pulsos entre 0.25 y 16.' });
      continue;
    }
    items.push({ id: crypto.randomUUID(), symbol: chordSymbol(chord), beats: value });
  }
  return { items, errors };
}
