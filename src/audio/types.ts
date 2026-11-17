/**
 * Three layers, kept apart on purpose:
 *   1. Music data (notes, chords, tablature) lives in documents and knows nothing about sound.
 *   2. A `Sequence` is the neutral list of timed events the planner produces from that data.
 *   3. An `AudioBackend` turns events into sound with a concrete instrument.
 * Swapping a synth for samples later changes layer 3 only; saved songs are untouched.
 */
export type InstrumentId = 'piano' | 'guitar';

export type PlayEvent = {
  /** Stable id of the musical event (melody note id, tablature column id, chord id) used to highlight it. */
  id: string;
  /** Start in beats from the beginning of the sequence. */
  start: number;
  /** Length in beats. */
  beats: number;
  /** MIDI pitches sounded together at this event. Empty = a rest (nothing sounds, time still passes). */
  midis: number[];
  /** Shorter, dry attack for muted notes. */
  muted?: boolean;
};

export type Sequence = { events: PlayEvent[]; totalBeats: number };

export interface AudioBackend {
  /** Audio clock in seconds. */
  now(): number;
  /** Starts sound at `when` (audio clock). Must be safe to call ahead of time. */
  playNote(instrument: InstrumentId, midi: number, when: number, seconds: number, options?: { muted?: boolean }): void;
  playClick(when: number, accent: boolean): void;
  /** Silences everything that is sounding or scheduled and releases the voices. */
  stopAll(): void;
  /** Called from a user gesture; resolves when sound can start. */
  resume(): Promise<void>;
  activeVoices(): number;
}
