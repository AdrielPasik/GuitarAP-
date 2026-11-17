/**
 * Pitch: the single place where note names and MIDI numbers are converted.
 * Convention: scientific pitch notation, so C4 = Do4 = MIDI 60 and A4 = 69 (440 Hz).
 * Note names (C4) and chord symbols (Cmaj7) are different things; chords live in `chords.ts`.
 */
export type NameStyle = 'latin' | 'english';
export type Accidental = 'sharp' | 'flat';

const LATIN = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Si'] as const;
const ENGLISH = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
/** Pitch class of each natural letter, in the order C D E F G A B. */
export const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11] as const;

const SHARP_PC = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6]; // letter index for sharp spelling
const FLAT_PC = [0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6]; // letter index for flat spelling
const IS_BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];

export const mod12 = (value: number) => ((value % 12) + 12) % 12;
export const octaveOf = (midi: number) => Math.floor(midi / 12) - 1;
export const pitchClassOf = (midi: number) => mod12(midi);
export const isBlackKey = (midi: number) => IS_BLACK[mod12(midi)];
export const midiToHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
export const MIDI_MIN = 12; // C0
export const MIDI_MAX = 108; // C8

/** Letter and accidental that spell a pitch class. Naturals ignore `accidental`. */
export function spellPitchClass(pc: number, accidental: Accidental = 'sharp') {
  const letter = (accidental === 'flat' ? FLAT_PC : SHARP_PC)[mod12(pc)];
  const natural = NATURAL_PC[letter];
  const delta = mod12(pc) - natural;
  return { letter, mark: delta === 0 ? '' : delta > 0 ? '♯' : '♭' };
}

export function pitchClassName(pc: number, style: NameStyle = 'english', accidental: Accidental = 'sharp') {
  const { letter, mark } = spellPitchClass(pc, accidental);
  return (style === 'latin' ? LATIN : ENGLISH)[letter] + mark;
}

/** "Do♯4" / "C♯4". The octave number is always shown for melodies. */
export function formatNote(midi: number, style: NameStyle = 'english', accidental: Accidental = 'sharp') {
  const { letter, mark } = spellPitchClass(midi, accidental);
  // B♯ and C♭ would change octave; they are never produced by this table, so the octave is that of the MIDI value.
  return `${(style === 'latin' ? LATIN : ENGLISH)[letter]}${mark}${octaveOf(midi)}`;
}

export type ParsedNote = { midi: number; accidental: Accidental };

const NOTE_RE = /^(do|re|mi|fa|sol|la|si|[a-g])([#♯b♭]?)(-?\d{1,2})$/i;
const LATIN_INDEX: Record<string, number> = { do: 0, re: 1, mi: 2, fa: 3, sol: 4, la: 5, si: 6 };

/**
 * Reads "Do4", "sol#3", "Sib4", "C4", "Eb2", "F♯3". Both naming systems are accepted whatever the display
 * preference is. Returns null for anything that is not a note with an octave (a chord such as "Cmaj7" is not one).
 */
export function parseNote(text: string): ParsedNote | null {
  const match = NOTE_RE.exec(text.trim());
  if (!match) return null;
  const [, name, mark, octave] = match;
  const lower = name.toLowerCase();
  const letter = lower in LATIN_INDEX ? LATIN_INDEX[lower] : ENGLISH.indexOf(name.toUpperCase() as (typeof ENGLISH)[number]);
  if (letter < 0) return null;
  const shift = mark === '#' || mark === '♯' ? 1 : mark === '' ? 0 : -1;
  const midi = (Number(octave) + 1) * 12 + NATURAL_PC[letter] + shift;
  if (midi < 0 || midi > 127) return null;
  return { midi, accidental: shift < 0 ? 'flat' : 'sharp' };
}

/** MIDI number of an open string such as "E4" or "A#2" (standard tuning is E2 A2 D3 G3 B3 E4). */
export function tuningToMidi(openString: string) {
  const parsed = parseNote(openString);
  return parsed ? parsed.midi : null;
}
