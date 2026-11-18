import { createContext, useContext } from 'react';
import type { TempoSource } from '@/audio/tempo';
import type { ClickSound } from '@/audio/webaudio-backend';

export type Metro = {
  running: boolean;
  /** The tempo the metronome is clicking at: practice tempo, else the open song's, else the preference. */
  bpm: number;
  source: TempoSource;
  /** A temporary tempo for studying. Never saved; undefined when following the song. */
  practiceBpm?: number;
  /** The BPM of the song being worked on, if it has one. */
  songBpm?: number;
  /** The tempo the metronome returns to when the practice tempo is cleared. */
  baseBpm: number;
  beat: number;
  volume: number;
  /** Stronger, higher first beat of each bar. */
  accent: boolean;
  setAccent: (on: boolean) => void;
  /** Timbre of the click: a device preference. */
  sound: ClickSound;
  setSound: (sound: ClickSound) => void;
  /** One accented and one weak click, so the timbre and level can be judged without starting. */
  testClick: () => void;
  beatsPerMeasure: number;
  /** Changing the metronome tempo is a practice tempo: it does not touch any document. */
  setBpm: (value: number) => void;
  resetPractice: () => void;
  /** Tells the metronome which song is open. Switching song drops the previous practice tempo. */
  setSongContext: (documentId: string | null, bpm?: number) => void;
  setVolume: (value: number) => void;
  setBeatsPerMeasure: (value: number) => void;
  toggle: () => void;
  tap: () => void;
};

export const MetronomeContext = createContext<Metro | null>(null);

export function useMetronome() {
  const metro = useContext(MetronomeContext);
  if (!metro) throw new Error('MetronomeProvider ausente');
  return metro;
}
