import { chordSymbol, parseChord } from '@/core/theory/chords';

/**
 * Lyrics are plain text. `# Verso 1` starts a section; `[Am]` inside a line marks a chord change at that word.
 * Brackets that are not a real chord symbol stay as ordinary text, so "[sotto voce]" is never mangled.
 */
export type LyricSegment = { chord?: string; text: string };
export type LyricLine = { kind: 'section'; title: string } | { kind: 'blank' } | { kind: 'line'; segments: LyricSegment[]; hasChords: boolean };

export const SECTIONS = ['Verso 1', 'Verso 2', 'Preestribillo', 'Estribillo', 'Puente', 'Outro'] as const;

export function parseLyrics(text: string): LyricLine[] {
  return text.split('\n').map((raw): LyricLine => {
    const section = /^#\s*(.*)$/.exec(raw);
    if (section) return { kind: 'section', title: section[1].trim() || 'Sección' };
    if (!raw.trim()) return { kind: 'blank' };
    const segments: LyricSegment[] = [];
    let cursor = 0;
    let pending: string | undefined;
    for (const match of raw.matchAll(/\[([^\]\n]+)\]/g)) {
      const chord = parseChord(match[1]);
      if (!chord) continue;
      const before = raw.slice(cursor, match.index);
      if (before || pending) segments.push({ chord: pending, text: before });
      pending = chordSymbol(chord);
      cursor = (match.index ?? 0) + match[0].length;
    }
    const rest = raw.slice(cursor);
    if (rest || pending || !segments.length) segments.push({ chord: pending, text: rest });
    return { kind: 'line', segments, hasChords: segments.some((segment) => segment.chord) };
  });
}

export const lyricChords = (text: string) =>
  parseLyrics(text).flatMap((line) => (line.kind === 'line' ? line.segments.flatMap((segment) => (segment.chord ? [segment.chord] : [])) : []));
