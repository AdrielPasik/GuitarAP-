import { createContext, useContext } from 'react';

export type Metro = { running: boolean; bpm: number; beat: number; volume: number; beatsPerMeasure: number; setBpm: (value: number) => void; setVolume: (value: number) => void; setBeatsPerMeasure: (value: number) => void; toggle: () => void; tap: () => void };

export const MetronomeContext = createContext<Metro | null>(null);

export function useMetronome() {
  const metro = useContext(MetronomeContext);
  if (!metro) throw new Error('MetronomeProvider ausente');
  return metro;
}
