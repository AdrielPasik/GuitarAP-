import type { AudioBackend, InstrumentId, Sequence } from '@/audio/types';

/**
 * The one transport of the app. Scheduling follows the audio clock (a short look-ahead refilled by a timer),
 * never a timer alone, and React is never in the path: the UI only observes `snapshot()`.
 * Only one thing plays at a time: starting another source stops the previous one.
 */
export type TransportState = 'idle' | 'playing' | 'paused';
export type PlayRequest = {
  /** Who is playing (a block id). Lets a block know whether it is the one sounding. */
  owner: string;
  sequence: Sequence;
  bpm: number;
  instrument: InstrumentId;
  fromBeat?: number;
  loop?: boolean;
  click?: boolean;
  /** Accent every N beats when `click` is on. */
  beatsPerBar?: number;
};
export type Snapshot = { state: TransportState; owner: string | null; activeId: string | null; beat: number; bpm: number };

const LOOKAHEAD = 0.18; // seconds scheduled ahead
const TICK_MS = 25;
const START_DELAY = 0.06;
const TAIL = 0.25; // seconds the last note may ring before the transport reports it ended

type Timers = { setInterval: (fn: () => void, ms: number) => unknown; clearInterval: (id: unknown) => void };
const realTimers: Timers = {
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (id) => globalThis.clearInterval(id as number),
};

export class Transport {
  private request: PlayRequest | null = null;
  private state: TransportState = 'idle';
  private timer: unknown = null;
  private anchorTime = 0; // audio time at which `anchorBeat` sounds
  private anchorBeat = 0;
  private pausedAt = 0;
  private nextIndex = 0;
  private cycle = 0;
  private nextClick = 0;
  private activeId: string | null = null;
  private current: Snapshot = { state: 'idle', owner: null, activeId: null, beat: 0, bpm: 0 };
  private listeners = new Set<() => void>();
  private startListeners = new Set<() => void>();

  constructor(
    private backend: AudioBackend,
    private timers: Timers = realTimers,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  /** Lets other audio (the metronome) step aside when music starts, so there is a single clock. */
  onStart(listener: () => void) {
    this.startListeners.add(listener);
    return () => this.startListeners.delete(listener);
  }
  snapshot = (): Snapshot => this.current;

  private secondsPerBeat() {
    return 60 / this.request!.bpm;
  }

  private publish() {
    const request = this.request;
    const next: Snapshot = {
      state: this.state,
      owner: this.state === 'idle' ? null : (request?.owner ?? null),
      activeId: this.state === 'idle' ? null : this.activeId,
      beat: this.state === 'paused' ? this.pausedAt : this.state === 'playing' ? this.positionBeat() : 0,
      bpm: request?.bpm ?? 0,
    };
    const old = this.current;
    if (old.state === next.state && old.owner === next.owner && old.activeId === next.activeId && old.bpm === next.bpm) return;
    this.current = next;
    this.listeners.forEach((listener) => listener());
  }

  /** Beat reached by the audio clock, wrapped for loops. */
  positionBeat() {
    if (!this.request) return 0;
    const elapsed = Math.max(0, this.backend.now() - this.anchorTime);
    const beat = this.anchorBeat + elapsed / this.secondsPerBeat();
    const total = this.request.sequence.totalBeats;
    return this.request.loop && total > 0 ? beat % total : beat;
  }

  async play(request: PlayRequest) {
    this.halt();
    await this.backend.resume();
    this.startListeners.forEach((listener) => listener());
    this.request = { ...request, bpm: Math.max(20, Math.min(300, request.bpm)) };
    this.begin(request.fromBeat ?? 0);
  }

  private begin(fromBeat: number) {
    const request = this.request!;
    this.state = 'playing';
    this.anchorBeat = fromBeat;
    this.anchorTime = this.backend.now() + START_DELAY;
    this.nextIndex = request.sequence.events.findIndex((event) => event.start + event.beats > fromBeat + 1e-6 && event.start >= fromBeat - 1e-6);
    if (this.nextIndex < 0) this.nextIndex = request.sequence.events.length;
    this.cycle = 0;
    this.nextClick = Math.ceil(fromBeat - 1e-6);
    this.activeId = null;
    this.timer = this.timers.setInterval(() => this.tick(), TICK_MS);
    this.tick();
    this.publish();
  }

  /** Fills the look-ahead window. Idempotent: called by the timer and once at start. */
  tick() {
    const request = this.request;
    if (this.state !== 'playing' || !request) return;
    const spb = this.secondsPerBeat();
    const now = this.backend.now();
    const horizon = now + LOOKAHEAD;
    const { events, totalBeats } = request.sequence;
    const timeOf = (beat: number) => this.anchorTime + (beat - this.anchorBeat) * spb;

    // With loop on, events repeat every `totalBeats`.
    for (;;) {
      if (this.nextIndex >= events.length) {
        if (!request.loop || totalBeats <= 0 || events.length === 0) break;
        if (timeOf((this.cycle + 1) * totalBeats) > horizon) break;
        this.cycle += 1;
        this.nextIndex = 0;
        continue;
      }
      const event = events[this.nextIndex];
      const start = event.start + this.cycle * totalBeats;
      const when = timeOf(start);
      if (when > horizon) break;
      const seconds = Math.max(0.05, event.beats * spb * 0.96);
      for (const midi of event.midis) this.backend.playNote(request.instrument, midi, Math.max(when, now), seconds, { muted: event.muted });
      this.nextIndex += 1;
    }
    if (request.click) {
      const bar = request.beatsPerBar ?? 4;
      const endBeat = request.loop ? Infinity : totalBeats;
      while (this.nextClick < endBeat && timeOf(this.nextClick) <= horizon) {
        if (timeOf(this.nextClick) >= now - 0.01) this.backend.playClick(Math.max(timeOf(this.nextClick), now), this.nextClick % bar === 0);
        this.nextClick += 1;
      }
    }

    const beat = this.positionBeat();
    const active = events.find((event) => event.midis.length > 0 && beat >= event.start && beat < event.start + event.beats);
    this.activeId = active?.id ?? null;
    const finished = !request.loop && now >= timeOf(totalBeats) + TAIL && this.nextIndex >= events.length;
    if (finished) {
      this.stop();
      return;
    }
    this.publish();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.pausedAt = this.positionBeat();
    this.halt();
    this.state = 'paused';
    this.publish();
  }

  async resume() {
    if (this.state !== 'paused' || !this.request) return;
    await this.backend.resume();
    this.begin(this.pausedAt);
  }

  stop() {
    this.halt();
    this.state = 'idle';
    this.pausedAt = 0;
    this.activeId = null;
    this.publish();
  }

  /** Changes tempo without losing the place. */
  setBpm(bpm: number) {
    const request = this.request;
    if (!request) return;
    const next = Math.max(20, Math.min(300, bpm));
    if (this.state === 'playing') {
      const at = this.positionBeat();
      this.halt();
      this.request = { ...request, bpm: next };
      this.begin(at);
    } else {
      this.request = { ...request, bpm: next };
      this.publish();
    }
  }

  private halt() {
    if (this.timer !== null) this.timers.clearInterval(this.timer);
    this.timer = null;
    this.backend.stopAll();
  }
}
