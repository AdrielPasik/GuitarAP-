import { useEffect, useRef, useState } from 'react';
import { transport } from '@/audio/engine';
import { getAudioContext } from '@/audio/webaudio-backend';
import { MetronomeContext as Context } from '@/features/metronome/metronome-context';
import type { ReactNode } from 'react';


export function MetronomeProvider({ children }: { children: ReactNode }) {
  const [running, setRunning] = useState(false); const [bpm, setBpm] = useState(96); const [beat, setBeat] = useState(0); const [volume, setVolume] = useState(.45); const [beatsPerMeasure, setBeatsPerMeasure] = useState(4); const audio = useRef<AudioContext | null>(null); const timer = useRef<number | undefined>(undefined); const next = useRef(0); const count = useRef(0); const taps = useRef<number[]>([]);
  useEffect(() => { if (!running) return; if (!audio.current) audio.current = getAudioContext(); void audio.current.resume(); next.current = audio.current.currentTime + .05; const schedule = () => { const ctx = audio.current!; while (next.current < ctx.currentTime + .12) { const oscillator = ctx.createOscillator(); const gain = ctx.createGain(); const accented = count.current % beatsPerMeasure === 0; oscillator.frequency.value = accented ? 1050 : 720; gain.gain.setValueAtTime(.0001, next.current); gain.gain.exponentialRampToValueAtTime(volume * (accented ? .22 : .13), next.current + .004); gain.gain.exponentialRampToValueAtTime(.0001, next.current + .04); oscillator.connect(gain).connect(ctx.destination); oscillator.start(next.current); oscillator.stop(next.current + .05); const current = count.current++; window.setTimeout(() => setBeat(current % beatsPerMeasure), Math.max(0, (next.current - ctx.currentTime) * 1000)); next.current += 60 / bpm; } }; timer.current = window.setInterval(schedule, 25); schedule(); return () => window.clearInterval(timer.current); }, [beatsPerMeasure, bpm, running, volume]);
  // Music and the metronome never run on two clocks: when something plays, the metronome steps aside.
  useEffect(() => { const off = transport.onStart(() => setRunning(false)); return () => { off(); }; }, []);
  function tap() { const time = performance.now(); taps.current = [...taps.current.filter((item) => time - item < 2200), time]; if (taps.current.length > 1) { const pairs = taps.current.slice(1).map((item, index) => item - taps.current[index]); setBpm(Math.round(60000 / (pairs.reduce((sum, item) => sum + item, 0) / pairs.length))); } }
  return <Context value={{ running, bpm, beat, volume, beatsPerMeasure, setBpm: (value) => setBpm(Math.max(30, Math.min(280, value))), setVolume: (value) => setVolume(Math.max(0, Math.min(1, value))), setBeatsPerMeasure: (value) => setBeatsPerMeasure(Math.max(2, Math.min(12, value))), toggle: () => setRunning((value) => !value), tap }}>{children}</Context>;
}
