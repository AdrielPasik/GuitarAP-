import type { PlayEvent, Sequence } from '@/audio/types';
import type { ChordsContent, MelodyContent, TablatureContent } from '@/core/model';
import { chordPitchClasses, parseChord } from '@/core/theory/chords';
import { tuningToMidi } from '@/core/theory/pitch';

/**
 * Planner: musical data in, neutral timed events out. No sound and no browser API here.
 * Rule for time: a step of a tablature lasts one beat unless the block says otherwise.
 */

export function melodyToSequence(content: MelodyContent): Sequence {
  let cursor = 0;
  const events: PlayEvent[] = content.events.map((event) => {
    const planned: PlayEvent = {
      id: event.id,
      start: cursor,
      beats: event.beats,
      midis: event.type === 'note' && event.midi !== undefined ? [event.midi] : [],
    };
    cursor += event.beats;
    return planned;
  });
  return { events, totalBeats: cursor };
}

/** Columns become events; several strings in one column sound together. Trailing empty columns are not played. */
export function tablatureToSequence(content: TablatureContent): Sequence {
  const step = content.stepBeats && content.stepBeats > 0 ? content.stepBeats : 1;
  const opens = content.tuning.map((string) => tuningToMidi(string));
  const events: PlayEvent[] = content.columns.map((column, index) => {
    const midis: number[] = [];
    let muted = false;
    column.cells.forEach((cell, string) => {
      const open = opens[string];
      if (cell.fret === undefined || open === null || open === undefined) return;
      midis.push(open + cell.fret);
      if (cell.techniques?.includes('mute')) muted = true;
    });
    return { id: column.id, start: index * step, beats: step, midis, muted: muted || undefined };
  });
  while (events.length && events[events.length - 1].midis.length === 0) events.pop();
  return { events, totalBeats: events.length * step };
}

/** A simple, repeatable voicing: bass note plus the chord tones stacked from the root (octave 3). */
export function chordVoicing(symbol: string): number[] {
  const chord = parseChord(symbol);
  if (!chord) return [];
  const root = 48 + chord.rootPc;
  const tones = chordPitchClasses(chord).map((_, index) => root + chord.quality.intervals[index]);
  const bass = chord.bassPc !== undefined ? 36 + chord.bassPc : root - 12;
  return [bass, ...tones];
}

export function chordsToSequence(content: ChordsContent): Sequence {
  let cursor = 0;
  const events: PlayEvent[] = content.items.map((item) => {
    const planned: PlayEvent = { id: item.id, start: cursor, beats: item.beats, midis: chordVoicing(item.symbol) };
    cursor += item.beats;
    return planned;
  });
  return { events, totalBeats: cursor };
}

/** Same, for a list of symbols with equal length (used by the harmony tools to hear a progression). */
export function progressionToSequence(symbols: string[], beatsEach = 2): Sequence {
  return chordsToSequence({ version: 1, items: symbols.map((symbol, index) => ({ id: `p${index}`, symbol, beats: beatsEach })) });
}
