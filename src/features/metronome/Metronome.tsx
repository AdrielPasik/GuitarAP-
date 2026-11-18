import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { backend, transport } from '@/audio/engine';
import { baseTempo, clampBpm, effectiveTempo } from '@/audio/tempo';
import { getAudioContext, setClickAccent, setClickSound, setClickVolume, type ClickSound } from '@/audio/webaudio-backend';
import { usePref } from '@/core/prefs';
import { MetronomeContext as Context, type Metro } from '@/features/metronome/metronome-context';

/**
 * The global metronome. It shares the app's single AudioContext, schedules ahead on the audio clock, and steps
 * aside when music starts (one clock at a time). Its tempo follows the open song; changing it by hand sets a
 * temporary practice tempo that is never written to a document.
 */
export function MetronomeProvider({ children }: { children: ReactNode }) {
  const [preference] = usePref<number>('default-bpm', 96);
  const [running, setRunning] = useState(false);
  const [beat, setBeat] = useState(0);
  // Remembered per device. Moderate by default; the person raises it. Independent of the instruments' volume.
  const [volume, setVolumeState] = usePref<number>('metronome.volume', 0.6);
  const [accent, setAccentState] = usePref<boolean>('metronome.accent', true);
  const [sound, setSoundState] = usePref<ClickSound>('metronome.sound', 'digital');
  const [beatsPerMeasure, setBeatsPerMeasureState] = usePref<number>('metronome.beats', 4);
  const [practiceBpm, setPracticeBpm] = useState<number | undefined>(undefined);
  const [song, setSong] = useState<{ id: string | null; bpm?: number }>({ id: null });
  const timer = useRef<number | undefined>(undefined);
  const next = useRef(0);
  const count = useRef(0);
  const taps = useRef<number[]>([]);

  useEffect(() => {
    setClickVolume(volume);
  }, [volume]);
  useEffect(() => {
    setClickAccent(accent);
  }, [accent]);
  useEffect(() => {
    setClickSound(sound);
  }, [sound]);

  const inputs = { practice: practiceBpm, song: song.bpm, preference };
  const { bpm, source } = effectiveTempo(inputs);
  const baseBpm = baseTempo(inputs).bpm;

  useEffect(() => {
    if (!running) return;
    const ctx = getAudioContext();
    void ctx.resume();
    next.current = ctx.currentTime + 0.05;
    const schedule = () => {
      while (next.current < ctx.currentTime + 0.12) {
        // The same click as when music plays: one synth, one level, one accent rule.
        backend.playClick(next.current, count.current % beatsPerMeasure === 0);
        const current = count.current;
        count.current += 1;
        window.setTimeout(() => setBeat(current % beatsPerMeasure), Math.max(0, (next.current - ctx.currentTime) * 1000));
        next.current += 60 / bpm;
      }
    };
    timer.current = window.setInterval(schedule, 25);
    schedule();
    return () => window.clearInterval(timer.current);
  }, [beatsPerMeasure, bpm, running, volume]);

  // Music and the metronome never run on two clocks: when something plays, the metronome steps aside.
  useEffect(() => {
    const off = transport.onStart(() => setRunning(false));
    return () => {
      off();
    };
  }, []);

  const setBpm = useCallback((value: number) => setPracticeBpm(clampBpm(value)), []);
  const resetPractice = useCallback(() => setPracticeBpm(undefined), []);
  const lastSong = useRef<string | null>(null);
  const setSongContext = useCallback((id: string | null, songBpm?: number) => {
    setSong((current) => (current.id === id && current.bpm === songBpm ? current : { id, bpm: songBpm }));
    // Going from one song to a different one drops the practice tempo; leaving to the library and coming back
    // to the same song (or editor <-> practice of one song) keeps it.
    if (id !== null) {
      if (lastSong.current !== null && lastSong.current !== id) setPracticeBpm(undefined);
      lastSong.current = id;
    }
  }, []);

  const value = useMemo<Metro>(
    () => ({
      running,
      bpm,
      source,
      practiceBpm,
      songBpm: song.bpm,
      baseBpm,
      beat,
      volume,
      beatsPerMeasure,
      setBpm,
      resetPractice,
      setSongContext,
      accent,
      sound,
      setSound: (next: ClickSound) => setSoundState(next),
      testClick: () => {
        const ctx = getAudioContext();
        void ctx.resume();
        backend.playClick(ctx.currentTime + 0.03, true);
        backend.playClick(ctx.currentTime + 0.43, false);
      },
      setAccent: (on: boolean) => setAccentState(on),
      setVolume: (next_: number) => setVolumeState(Math.max(0, Math.min(1, next_))),
      setBeatsPerMeasure: (next_: number) => setBeatsPerMeasureState(Math.max(2, Math.min(12, next_))),
      toggle: () => setRunning((current) => !current),
      tap: () => {
        const time = performance.now();
        taps.current = [...taps.current.filter((item) => time - item < 2200), time];
        if (taps.current.length > 1) {
          const gaps = taps.current.slice(1).map((item, index) => item - taps.current[index]);
          setBpm(60000 / (gaps.reduce((sum, item) => sum + item, 0) / gaps.length));
        }
      },
    }),
    [running, bpm, source, practiceBpm, song.bpm, baseBpm, beat, volume, accent, sound, setSoundState, setBeatsPerMeasureState, beatsPerMeasure, setBpm, resetPractice, setSongContext, setVolumeState, setAccentState],
  );
  return <Context value={value}>{children}</Context>;
}
