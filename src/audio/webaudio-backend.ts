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
let clickBus: GainNode | null = null;
let clickVolume = 0.6;
let accentOn = true;
/** Highest gain the click bus can reach: with the soft limiter after it, the loudest setting still cannot clip. */
const CLICK_CEILING = 0.85;

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
    // The metronome has its OWN level: it joins after the instruments' master gain, before the shared limiter.
    clickBus = shared.createGain();
    clickBus.gain.value = CLICK_CEILING * clickVolume;
    clickBus.connect(limiter);
  }
  return shared;
}
export function getMaster() {
  getAudioContext();
  return master!;
}
/** 0..1. Independent of the instruments' volume. */
export function setClickVolume(next: number) {
  clickVolume = Math.max(0, Math.min(1, next));
  if (clickBus) clickBus.gain.value = CLICK_CEILING * clickVolume;
}
export function setClickAccent(on: boolean) {
  accentOn = on;
}

/**
 * Click timbres, all synthesised here (nothing downloaded, nothing copied from a commercial metronome).
 * Each one is tuned to a similar PEAK, so switching timbre never jumps the level, but they differ in body and length:
 * a longer, denser body (woodblock, analog) is heard as louder over a guitar at the same peak, without clipping.
 */
export type ClickSound = 'digital' | 'woodblock' | 'analog' | 'dry';
export const CLICK_SOUNDS: Array<{ id: ClickSound; name: string; blurb: string }> = [
  { id: 'digital', name: 'Clic digital', blurb: 'Agudo y definido. El de siempre.' },
  { id: 'woodblock', name: 'Woodblock', blurb: 'Madera seca con cuerpo: se oye sobre una guitarra con distorsión.' },
  { id: 'analog', name: 'Clic analógico', blurb: 'Tic-tac de metrónomo de péndulo, cálido y redondo.' },
  { id: 'dry', name: 'Percusión seca', blurb: 'Golpe corto tipo aro de caja, muy preciso.' },
];
let clickSound: ClickSound = 'digital';
export function setClickSound(next: ClickSound) {
  clickSound = CLICK_SOUNDS.some((sound) => sound.id === next) ? next : 'digital';
}

function seededNoise(ctx: BaseAudioContext, seconds: number) {
  const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * seconds)), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 424242;
  for (let i = 0; i < data.length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 0xffffffff) * 2 - 1;
  }
  return buffer;
}
let longNoise: AudioBuffer | null = null;

type ClickParts = { tone: OscillatorNode; burst: AudioBufferSourceNode; toneGain: GainNode; burstGain: GainNode; extra?: AudioNode[] };

function toneVoice(ctx: BaseAudioContext, out: AudioNode, when: number, type: OscillatorType, freq: number, endFreq: number, peak: number, decay: number) {
  const tone = ctx.createOscillator();
  tone.type = type;
  tone.frequency.setValueAtTime(freq, when);
  if (endFreq !== freq) tone.frequency.exponentialRampToValueAtTime(endFreq, when + decay * 0.6);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.linearRampToValueAtTime(peak, when + 0.0015);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + decay);
  tone.connect(gain).connect(out);
  tone.start(when);
  tone.stop(when + decay + 0.01);
  return { tone, gain };
}

function noiseVoice(ctx: BaseAudioContext, out: AudioNode, when: number, filter: BiquadFilterType, freq: number, q: number, peak: number, decay: number) {
  if (!longNoise || longNoise.sampleRate !== ctx.sampleRate) longNoise = seededNoise(ctx, 0.12);
  const burst = ctx.createBufferSource();
  burst.buffer = longNoise;
  const band = ctx.createBiquadFilter();
  band.type = filter;
  band.frequency.value = freq;
  band.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(peak, when);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + decay);
  burst.connect(band).connect(gain).connect(out);
  burst.start(when);
  burst.stop(when + decay + 0.01);
  return { burst, gain, band };
}

function scheduleAltClick(ctx: BaseAudioContext, out: AudioNode, when: number, accent: boolean, sound: Exclude<ClickSound, 'digital'>): ClickParts {
  if (sound === 'woodblock') {
    // Two inharmonic modes of a struck block, a fast pitch drop and a filtered knock.
    const base = accent ? 1250 : 900;
    const a = toneVoice(ctx, out, when, 'sine', base * 1.12, base, accent ? 0.62 : 0.52, 0.09);
    const b = toneVoice(ctx, out, when, 'sine', base * 2.76, base * 2.7, accent ? 0.22 : 0.18, 0.045);
    const n = noiseVoice(ctx, out, when, 'bandpass', base * 2, 2.5, accent ? 0.35 : 0.28, 0.012);
    return { tone: a.tone, toneGain: a.gain, burst: n.burst, burstGain: n.gain, extra: [b.tone, b.gain, n.band] };
  }
  if (sound === 'analog') {
    // A soft, rounded «tock»: triangle body through a low-pass, a little lower for the weak beats.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = accent ? 3200 : 2400;
    lp.connect(out);
    const a = toneVoice(ctx, lp, when, 'triangle', accent ? 1050 : 760, accent ? 980 : 700, accent ? 0.78 : 0.68, 0.075);
    const n = noiseVoice(ctx, lp, when, 'lowpass', 1800, 0.7, accent ? 0.3 : 0.24, 0.008);
    return { tone: a.tone, toneGain: a.gain, burst: n.burst, burstGain: n.gain, extra: [lp, n.band] };
  }
  // dry: a short, bright rim-like crack with a tiny pitched body.
  const a = toneVoice(ctx, out, when, 'square', accent ? 520 : 400, accent ? 420 : 330, accent ? 0.22 : 0.18, 0.03);
  const n = noiseVoice(ctx, out, when, 'highpass', accent ? 2400 : 1800, 0.8, accent ? 0.7 : 0.58, 0.028);
  return { tone: a.tone, toneGain: a.gain, burst: n.burst, burstGain: n.gain, extra: [n.band] };
}

let noiseBuffer: AudioBuffer | null = null;
/**
 * One click: a short pitched tick with a crisp noise transient on top (so the beat is felt even over a loud guitar),
 * 1 ms attack and a ~60 ms decay. The first beat is higher and a little stronger. Peak before the bus is 1.05 at most;
 * the bus ceiling (0.85) keeps the maximum setting under full scale. Works on any BaseAudioContext (tests render it offline).
 */
export function scheduleClick(ctx: BaseAudioContext, out: AudioNode, when: number, accent: boolean, sound: ClickSound = clickSound): ClickParts {
  if (sound !== 'digital') return scheduleAltClick(ctx, out, when, accent, sound);
  const tone = ctx.createOscillator();
  const toneGain = ctx.createGain();
  tone.frequency.value = accent ? 1760 : 1175;
  toneGain.gain.setValueAtTime(0.0001, when);
  toneGain.gain.linearRampToValueAtTime(accent ? 0.75 : 0.6, when + 0.001);
  toneGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.06);
  tone.connect(toneGain).connect(out);
  tone.start(when);
  tone.stop(when + 0.07);
  if (!noiseBuffer || noiseBuffer.sampleRate !== ctx.sampleRate) {
    noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.02), ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    let seed = 99991;
    for (let i = 0; i < data.length; i += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = (seed / 0xffffffff) * 2 - 1;
    }
  }
  const burst = ctx.createBufferSource();
  burst.buffer = noiseBuffer;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = accent ? 4200 : 3200;
  band.Q.value = 0.8;
  const burstGain = ctx.createGain();
  burstGain.gain.setValueAtTime(accent ? 0.3 : 0.25, when);
  burstGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.014);
  burst.connect(band).connect(burstGain).connect(out);
  burst.start(when);
  return { tone, burst, toneGain, burstGain };
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
    const strong = accent && accentOn;
    const parts = scheduleClick(ctx, clickBus!, when, strong);
    const voice: Voice = {
      stop: (at) => parts.tone.stop(at),
      kill: () => {
        parts.tone.disconnect();
        parts.burst.disconnect();
        parts.toneGain.disconnect();
        parts.burstGain.disconnect();
        parts.extra?.forEach((node) => node.disconnect());
      },
    };
    this.track(voice, when + 0.08, ctx);
    this.log({ type: 'click', when, accent: strong, sound: clickSound });
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

if (typeof window !== 'undefined') {
  /** Read-only probe for browser tests: renders one click offline through the bus ceiling and the limiter and returns its peak. */
  (window as unknown as Record<string, unknown>).__guitarapMeasureClick = async (accent: boolean, level: number, sound?: ClickSound) => {
    const ctx = new OfflineAudioContext(1, 4410, 44100);
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.ratio.value = 6;
    limiter.connect(ctx.destination);
    const bus = ctx.createGain();
    bus.gain.value = CLICK_CEILING * level;
    bus.connect(limiter);
    scheduleClick(ctx, bus, 0.001, accent, sound ?? clickSound);
    const rendered = await ctx.startRendering();
    let peak = 0;
    for (const value of rendered.getChannelData(0)) peak = Math.max(peak, Math.abs(value));
    return { peak };
  };
}
