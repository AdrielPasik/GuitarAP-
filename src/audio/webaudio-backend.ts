import type { AudioBackend, InstrumentId } from '@/audio/types';
import { midiToHz } from '@/core/theory/pitch';

/**
 * Local synthesis only: nothing is downloaded and nothing leaves the browser.
 *  - Piano: additive partials with a quick attack and a decay that follows pitch (a synthesis, not a sampled piano).
 *  - Guitar: a Karplus–Strong plucked string rendered into a buffer (an approximation of a nylon/steel string).
 */
type Voice = { stop: (at: number) => void; kill: () => void };

declare global {
  interface Window {
    __GUITARAP_AUDIO_TEST__?: boolean;
    __guitarapAudioLog?: Array<Record<string, unknown>>;
  }
}

let shared: AudioContext | null = null;
let master: GainNode | null = null;
let volume = 0.7;

/** The one AudioContext of the app (metronome and instruments share it). Created lazily, on a gesture. */
export function getAudioContext() {
  if (!shared) {
    shared = new AudioContext({ latencyHint: 'interactive' });
    master = shared.createGain();
    master.gain.value = volume;
    const limiter = shared.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.ratio.value = 6;
    master.connect(limiter).connect(shared.destination);
  }
  return shared;
}
export function getMaster() {
  getAudioContext();
  return master!;
}
export function setMasterVolume(next: number) {
  volume = Math.max(0, Math.min(1, next));
  if (master) master.gain.value = volume;
}

const pluckCache = new Map<string, AudioBuffer>();
/** Karplus–Strong: a noise burst circulating in a damped delay line of one period. */
function pluckBuffer(ctx: AudioContext, midi: number) {
  const key = `${ctx.sampleRate}:${midi}`;
  const cached = pluckCache.get(key);
  if (cached) return cached;
  const rate = ctx.sampleRate;
  const period = Math.max(2, Math.round(rate / midiToHz(midi)));
  const length = Math.floor(rate * 3);
  const buffer = ctx.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);
  // Deterministic noise so a note always sounds the same.
  let seed = 1234567 + midi * 7919;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296 - 0.5;
  };
  let last = 0;
  for (let i = 0; i < period; i += 1) {
    last = last * 0.4 + random() * 0.6; // softened burst: less pick noise
    data[i] = last;
  }
  const damping = midi < 52 ? 0.9985 : 0.997;
  for (let i = period; i < length; i += 1) data[i] = damping * 0.5 * (data[i - period] + data[i - period + 1]);
  pluckCache.set(key, buffer);
  return buffer;
}

const PIANO_WAVE = new Map<AudioContext, PeriodicWave>();
function pianoWave(ctx: AudioContext) {
  let wave = PIANO_WAVE.get(ctx);
  if (!wave) {
    const amps = [0, 1, 0.52, 0.3, 0.2, 0.11, 0.07, 0.04, 0.02];
    wave = ctx.createPeriodicWave(new Float32Array(amps.length), Float32Array.from(amps), { disableNormalization: false });
    PIANO_WAVE.set(ctx, wave);
  }
  return wave;
}

export class WebAudioBackend implements AudioBackend {
  private voices = new Set<Voice>();

  now() {
    return getAudioContext().currentTime;
  }

  async resume() {
    const ctx = getAudioContext();
    if (ctx.state !== 'running') await ctx.resume();
  }

  activeVoices() {
    return this.voices.size;
  }

  private log(entry: Record<string, unknown>) {
    if (typeof window !== 'undefined' && window.__GUITARAP_AUDIO_TEST__) (window.__guitarapAudioLog ??= []).push(entry);
  }

  private track(voice: Voice, endsAt: number, ctx: AudioContext) {
    this.voices.add(voice);
    // Voices free themselves once they have finished, so nothing accumulates.
    const delay = Math.max(0, (endsAt - ctx.currentTime) * 1000) + 120;
    const id = window.setTimeout(() => {
      voice.kill();
      this.voices.delete(voice);
    }, delay);
    const kill = voice.kill;
    voice.kill = () => {
      window.clearTimeout(id);
      kill();
    };
  }

  playNote(instrument: InstrumentId, midi: number, when: number, seconds: number, options: { muted?: boolean } = {}) {
    const ctx = getAudioContext();
    const out = getMaster();
    const gain = ctx.createGain();
    const hz = midiToHz(midi);
    const muted = Boolean(options.muted);
    const length = muted ? Math.min(seconds, 0.09) : seconds;
    const release = muted ? 0.02 : instrument === 'guitar' ? 0.09 : 0.18;
    const end = when + length + release;
    let stopSource: (at: number) => void;
    let killSource: () => void;

    if (instrument === 'guitar') {
      const source = ctx.createBufferSource();
      source.buffer = pluckBuffer(ctx, midi);
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = Math.min(7000, hz * 14);
      source.connect(tone).connect(gain);
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.linearRampToValueAtTime(0.5, when + 0.003);
      gain.gain.setValueAtTime(0.5, when + length);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      source.start(when);
      source.stop(end + 0.02);
      stopSource = (at) => source.stop(at);
      killSource = () => source.disconnect();
    } else {
      const wave = pianoWave(ctx);
      const a = ctx.createOscillator();
      const b = ctx.createOscillator();
      a.setPeriodicWave(wave);
      b.setPeriodicWave(wave);
      a.frequency.value = hz;
      b.frequency.value = hz;
      b.detune.value = 4;
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.Q.value = 0.4;
      tone.frequency.setValueAtTime(Math.min(9000, hz * 9), when);
      tone.frequency.exponentialRampToValueAtTime(Math.max(700, hz * 2.2), when + 0.6);
      const mix = ctx.createGain();
      mix.gain.value = 0.5;
      a.connect(mix);
      b.connect(mix);
      mix.connect(tone).connect(gain);
      // Higher keys fade sooner, like strings; the key-up adds a short release.
      const decay = Math.max(0.5, 2.6 - (midi - 36) * 0.03);
      const peak = 0.42 - Math.min(0.14, Math.max(0, midi - 72) * 0.01);
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.linearRampToValueAtTime(peak, when + 0.006);
      gain.gain.setTargetAtTime(peak * 0.3, when + 0.006, decay * 0.18);
      gain.gain.setTargetAtTime(0.0001, when + length, release * 0.45);
      a.start(when);
      b.start(when);
      a.stop(end + 0.1);
      b.stop(end + 0.1);
      stopSource = (at) => {
        a.stop(at);
        b.stop(at);
      };
      killSource = () => {
        a.disconnect();
        b.disconnect();
      };
    }
    gain.connect(out);
    const voice: Voice = {
      stop: (at) => {
        gain.gain.cancelScheduledValues(at);
        gain.gain.setTargetAtTime(0.0001, at, 0.008);
        stopSource(at + 0.06);
      },
      kill: () => {
        killSource();
        gain.disconnect();
      },
    };
    this.track(voice, end + 0.12, ctx);
    this.log({ type: 'note', instrument, midi, when, seconds: length, muted });
  }

  playClick(when: number, accent: boolean) {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = accent ? 1050 : 720;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.16 : 0.1, when + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);
    osc.connect(gain).connect(getMaster());
    osc.start(when);
    osc.stop(when + 0.05);
    const voice: Voice = { stop: (at) => osc.stop(at), kill: () => { osc.disconnect(); gain.disconnect(); } };
    this.track(voice, when + 0.05, ctx);
    this.log({ type: 'click', when, accent });
  }

  stopAll() {
    const ctx = shared;
    const voices = [...this.voices];
    this.voices.clear();
    if (!ctx) return;
    const at = ctx.currentTime;
    for (const voice of voices) {
      voice.stop(at);
      window.setTimeout(voice.kill, 120);
    }
    this.log({ type: 'stopAll', voices: voices.length });
  }
}
