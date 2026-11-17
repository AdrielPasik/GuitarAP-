import type { MelodyContent, MelodyEvent } from '@/core/model';
import { parseChord } from '@/core/theory/chords';
import { formatNote, parseNote } from '@/core/theory/pitch';

/** Pure edits of a melody. Every function returns a new value; none touches sound or presentation. */
export const MIN_MIDI = 21; // A0
export const MAX_MIDI = 108; // C8
export const DURATIONS = [
  { beats: 0.5, label: 'Corta', hint: 'Medio pulso' },
  { beats: 1, label: 'Normal', hint: 'Un pulso' },
  { beats: 2, label: 'Larga', hint: 'Dos pulsos' },
  { beats: 4, label: 'Sostener', hint: 'Cuatro pulsos' },
] as const;

export const newId = () => crypto.randomUUID();
export const emptyMelody = (): MelodyContent => ({ version: 1, events: [] });
export const noteEvent = (midi: number, beats = 1, accidental?: MelodyEvent['accidental']): MelodyEvent => ({
  id: newId(),
  type: 'note',
  midi: clampMidi(midi),
  beats,
  ...(accidental ? { accidental } : {}),
});
export const restEvent = (beats = 1): MelodyEvent => ({ id: newId(), type: 'rest', beats });
export const clampMidi = (midi: number) => Math.max(MIN_MIDI, Math.min(MAX_MIDI, Math.round(midi)));
export const clampBeats = (beats: number) => Math.max(0.25, Math.min(16, Math.round(beats * 4) / 4));

export type ParseResult = { events: MelodyEvent[]; errors: Array<{ token: string; reason: string }> };

/**
 * "C4 D4 E4:2 r G4:0.5" or "Do4 — Re4 — Mi4". Both naming systems work. `r` is a rest, `:n` the length in beats.
 * Nothing here touches the melody: the caller decides whether to apply the result (errors mean it does not).
 */
export function parseMelodyText(text: string, defaultBeats = 1): ParseResult {
  const tokens = text
    .replace(/[—–|,;]/g, ' ')
    .replace(/(^|\s)-(?=\s|$)/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const events: MelodyEvent[] = [];
  const errors: ParseResult['errors'] = [];
  for (const token of tokens) {
    const [name, length] = token.split(':');
    let beats = defaultBeats;
    if (length !== undefined) {
      const value = Number(length.replace(',', '.'));
      if (!Number.isFinite(value) || value <= 0 || value > 16) {
        errors.push({ token, reason: 'La duración debe ser un número de pulsos entre 0.25 y 16.' });
        continue;
      }
      beats = clampBeats(value);
    }
    if (/^(r|R|silencio)$/.test(name)) {
      events.push(restEvent(beats));
      continue;
    }
    const note = parseNote(name);
    if (!note) {
      errors.push({ token, reason: parseChord(name) ? 'Parece un acorde: las notas llevan octava (por ejemplo C4). Los acordes van en un bloque de Acordes.' : 'No es una nota válida. Probá con Do4, Re♯3, C4 o Bb3.' });
      continue;
    }
    if (note.midi < MIN_MIDI || note.midi > MAX_MIDI) {
      errors.push({ token, reason: 'Fuera del rango del programa (A0–C8).' });
      continue;
    }
    events.push(noteEvent(note.midi, beats, note.accidental));
  }
  return { events, errors };
}

export const insertEvents = (melody: MelodyContent, events: MelodyEvent[], index = melody.events.length): MelodyContent => {
  const at = Math.max(0, Math.min(index, melody.events.length));
  return { ...melody, events: [...melody.events.slice(0, at), ...events, ...melody.events.slice(at)] };
};

const patchEvents = (melody: MelodyContent, ids: Iterable<string>, change: (event: MelodyEvent) => MelodyEvent): MelodyContent => {
  const set = new Set(ids);
  return { ...melody, events: melody.events.map((event) => (set.has(event.id) ? change(event) : event)) };
};

export const removeEvents = (melody: MelodyContent, ids: Iterable<string>): MelodyContent => {
  const set = new Set(ids);
  return { ...melody, events: melody.events.filter((event) => !set.has(event.id)) };
};

export const setPitch = (melody: MelodyContent, id: string, midi: number, accidental?: MelodyEvent['accidental']) =>
  patchEvents(melody, [id], (event) => ({ ...event, type: 'note', midi: clampMidi(midi), accidental }));

export const setBeats = (melody: MelodyContent, ids: Iterable<string>, beats: number) =>
  patchEvents(melody, ids, (event) => ({ ...event, beats: clampBeats(beats) }));

export const setLyric = (melody: MelodyContent, id: string, lyric: string) =>
  patchEvents(melody, [id], (event) => {
    const { lyric: _old, ...rest } = event;
    void _old;
    return lyric ? { ...rest, lyric } : rest;
  });

export const toggleRest = (melody: MelodyContent, id: string) =>
  patchEvents(melody, [id], (event) => {
    if (event.type === 'rest') return { ...event, type: 'note', midi: 60 };
    const { midi: _midi, accidental: _accidental, ...rest } = event;
    void _midi; void _accidental;
    return { ...rest, type: 'rest' };
  });

/** Explicit transposition of the chosen notes (or every note). Rests and rhythm are untouched. */
export function transpose(melody: MelodyContent, semitones: number, ids?: Iterable<string>): MelodyContent {
  const set = ids ? new Set(ids) : null;
  return {
    ...melody,
    events: melody.events.map((event) =>
      event.type === 'note' && event.midi !== undefined && (!set || set.has(event.id))
        ? { ...event, midi: clampMidi(event.midi + semitones) }
        : event,
    ),
  };
}

export const shiftOctave = (melody: MelodyContent, octaves: number, ids?: Iterable<string>) => transpose(melody, octaves * 12, ids);

export const moveEvent = (melody: MelodyContent, id: string, offset: -1 | 1): MelodyContent => {
  const index = melody.events.findIndex((event) => event.id === id);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= melody.events.length) return melody;
  const events = [...melody.events];
  [events[index], events[target]] = [events[target], events[index]];
  return { ...melody, events };
};

/** New notes after the selection with fresh ids. Lyrics are not copied: a syllable belongs to one note. */
export function duplicateEvents(melody: MelodyContent, ids: Iterable<string>): { melody: MelodyContent; ids: string[] } {
  const set = new Set(ids);
  const picked = melody.events.filter((event) => set.has(event.id));
  if (!picked.length) return { melody, ids: [] };
  const copies = picked.map(({ lyric: _lyric, ...event }) => {
    void _lyric;
    return { ...event, id: newId() };
  });
  let last = -1;
  melody.events.forEach((event, index) => { if (set.has(event.id)) last = index; });
  return { melody: insertEvents(melody, copies, last + 1), ids: copies.map((event) => event.id) };
}

export const reverseOrder = (melody: MelodyContent): MelodyContent => ({ ...melody, events: [...melody.events].reverse() });

export function range(melody: MelodyContent) {
  const midis = melody.events.flatMap((event) => (event.type === 'note' && event.midi !== undefined ? [event.midi] : []));
  if (!midis.length) return null;
  const low = Math.min(...midis);
  const high = Math.max(...midis);
  return { low, high, span: high - low };
}

const INTERVALS = ['unísono', '2ª menor', '2ª mayor', '3ª menor', '3ª mayor', '4ª justa', 'tritono', '5ª justa', '6ª menor', '6ª mayor', '7ª menor', '7ª mayor', 'octava'];
export function intervalLabel(from: number, to: number) {
  const distance = Math.abs(to - from);
  const octaves = Math.floor(distance / 12);
  const rest = distance % 12;
  const base = distance === 12 ? 'octava' : INTERVALS[rest];
  const name = octaves > 0 && distance !== 12 ? `${base} + ${octaves} ${octaves === 1 ? 'octava' : 'octavas'}` : base;
  return distance === 0 ? name : `${name} ${to > from ? '↑' : '↓'}`;
}

/** Melody events with their notes as written text, for reading and for the quick entry field. */
export function melodyToText(melody: MelodyContent, style: 'latin' | 'english') {
  return melody.events
    .map((event) => {
      const length = event.beats === 1 ? '' : `:${event.beats}`;
      return event.type === 'rest' || event.midi === undefined ? `r${length}` : `${formatNote(event.midi, style, event.accidental ?? 'sharp')}${length}`;
    })
    .join(' ');
}

/** "Hoy vuel-vo a" -> ["Hoy", "vuel", "vo", "a"]. */
export const splitSyllables = (text: string) => text.split(/[\s]+|(?<=\S)-(?=\S)/).filter(Boolean);

/** Explicit action: writes syllables onto consecutive notes from `startId`. Existing syllables are replaced only where one is written. */
export function assignSyllables(melody: MelodyContent, syllables: string[], startId?: string): MelodyContent {
  const startIndex = startId ? Math.max(0, melody.events.findIndex((event) => event.id === startId)) : 0;
  let next = 0;
  return {
    ...melody,
    events: melody.events.map((event, index) => {
      if (index < startIndex || event.type !== 'note' || next >= syllables.length) return event;
      return { ...event, lyric: syllables[next++] };
    }),
  };
}

export const noteCount = (melody: MelodyContent) => melody.events.filter((event) => event.type === 'note').length;
export const totalBeats = (melody: MelodyContent) => melody.events.reduce((sum, event) => sum + event.beats, 0);
