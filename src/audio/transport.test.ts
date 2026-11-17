import { describe, expect, it } from 'vitest';
import { chordsToSequence, melodyToSequence, tablatureToSequence } from '@/audio/plan';
import { baseTempo, effectiveTempo } from '@/audio/tempo';
import { Transport } from '@/audio/transport';
import type { AudioBackend, InstrumentId } from '@/audio/types';
import { createTablatureContent } from '@/core/model';
import { parseNote } from '@/core/theory/pitch';

/** A virtual audio clock: nothing runs until the test advances it. */
class FakeBackend implements AudioBackend {
  time = 0;
  notes: Array<{ midi: number; when: number; seconds: number; instrument: InstrumentId; muted?: boolean }> = [];
  clicks: number[] = [];
  stopped = 0;
  active = 0;
  now() { return this.time; }
  async resume() {}
  activeVoices() { return this.active; }
  playNote(instrument: InstrumentId, midi: number, when: number, seconds: number, options?: { muted?: boolean }) {
    this.notes.push({ instrument, midi, when, seconds, muted: options?.muted });
    this.active += 1;
  }
  playClick(when: number) { this.clicks.push(when); }
  stopAll() { this.stopped += 1; this.active = 0; }
}

function rig() {
  const backend = new FakeBackend();
  let tick: (() => void) | null = null;
  const transport = new Transport(backend, { setInterval: (fn) => { tick = fn; return 1; }, clearInterval: () => { tick = null; } });
  const advance = (seconds: number) => {
    const end = backend.time + seconds;
    while (backend.time < end - 1e-9) {
      backend.time = Math.min(end, backend.time + 0.025);
      tick?.();
    }
  };
  return { backend, transport, advance };
}

const melody = (names: string[], beats = 1) => ({
  version: 1 as const,
  events: names.map((name, index) => ({ id: `n${index}`, type: 'note' as const, midi: parseNote(name)!.midi, beats })),
});

describe('planner', () => {
  it('melody keeps order, pitch and duration; rests take time but make no sound', () => {
    const sequence = melodyToSequence({ version: 1, events: [
      { id: 'a', type: 'note', midi: 60, beats: 1 },
      { id: 'b', type: 'rest', beats: 2 },
      { id: 'c', type: 'note', midi: 64, beats: 0.5 },
    ] });
    expect(sequence.events.map((event) => [event.id, event.start, event.midis])).toEqual([['a', 0, [60]], ['b', 1, []], ['c', 3, [64]]]);
    expect(sequence.totalBeats).toBe(3.5);
  });
  it('tablature converts string + fret through the document tuning (5-7-8-7-5 on the first string)', () => {
    const tab = createTablatureContent();
    [5, 7, 8, 7, 5].forEach((fret, index) => { tab.columns[index].cells[0] = { fret }; });
    expect(tablatureToSequence(tab).events.map((event) => event.midis[0])).toEqual([69, 71, 72, 71, 69]);
    tab.tuning = ['D4', 'B3', 'G3', 'D3', 'A2', 'D2']; // drop D, first string lowered a tone
    expect(tablatureToSequence(tab).events.map((event) => event.midis[0])).toEqual([67, 69, 70, 69, 67]);
  });
  it('a column with several strings is one chord event and trailing empty columns are not played', () => {
    const tab = createTablatureContent();
    tab.columns[0].cells[5] = { fret: 3 };
    tab.columns[0].cells[4] = { fret: 2 };
    tab.columns[0].cells[3] = { fret: 0 };
    const sequence = tablatureToSequence(tab);
    expect(sequence.events).toHaveLength(1);
    expect(sequence.events[0].midis.sort()).toEqual([43, 47, 50]);
    expect(sequence.totalBeats).toBe(1);
    tab.stepBeats = 2;
    expect(tablatureToSequence(tab).totalBeats).toBe(2);
  });
  it('chords sound together, and a bad symbol is silent instead of wrong', () => {
    const sequence = chordsToSequence({ version: 1, items: [{ id: 'a', symbol: 'C', beats: 2 }, { id: 'b', symbol: 'nope', beats: 2 }] });
    expect(sequence.events[0].midis).toEqual([36, 48, 52, 55]);
    expect(sequence.events[1].midis).toEqual([]);
  });
  it('one visible tempo rule', () => {
    expect(effectiveTempo({ practice: 80, block: 70, song: 92, preference: 100 })).toEqual({ bpm: 80, source: 'práctica' });
    expect(effectiveTempo({ block: 70, song: 92, preference: 100 })).toEqual({ bpm: 70, source: 'bloque' });
    expect(effectiveTempo({ song: 92, preference: 100 })).toEqual({ bpm: 92, source: 'canción' });
    expect(effectiveTempo({ preference: 100 })).toEqual({ bpm: 100, source: 'preferencia' });
    expect(effectiveTempo({})).toEqual({ bpm: 96, source: 'sistema' });
    // "Volver a…" returns to what the tempo would be without the temporary one.
    expect(baseTempo({ practice: 80, block: 70, song: 92 })).toEqual({ bpm: 70, source: 'bloque' });
    expect(baseTempo({ practice: 80, song: 92 })).toEqual({ bpm: 92, source: 'canción' });
  });
});

describe('transport', () => {
  it('schedules every note once, in order, at the right time for the BPM', async () => {
    const { backend, transport, advance } = rig();
    await transport.play({ owner: 'm', sequence: melodyToSequence(melody(['Do4', 'Re4', 'Mi4', 'Sol4'])), bpm: 120, instrument: 'piano' });
    advance(4);
    expect(backend.notes.map((note) => note.midi)).toEqual([60, 62, 64, 67]);
    const gaps = backend.notes.slice(1).map((note, index) => +(note.when - backend.notes[index].when).toFixed(3));
    expect(gaps).toEqual([0.5, 0.5, 0.5]);
    expect(backend.notes[0].seconds).toBeGreaterThan(0.4);
    expect(backend.notes[0].seconds).toBeLessThanOrEqual(0.5);
    expect(transport.snapshot().state).toBe('idle');
  });
  it('a slower BPM spaces notes further apart', async () => {
    const { backend, transport, advance } = rig();
    await transport.play({ owner: 'm', sequence: melodyToSequence(melody(['Do4', 'Re4'])), bpm: 60, instrument: 'guitar' });
    advance(3);
    expect(+(backend.notes[1].when - backend.notes[0].when).toFixed(3)).toBe(1);
    expect(backend.notes[0].instrument).toBe('guitar');
  });
  it('pause keeps the place, resume continues, stop releases every voice', async () => {
    const { backend, transport, advance } = rig();
    await transport.play({ owner: 'm', sequence: melodyToSequence(melody(['Do4', 'Re4', 'Mi4', 'Sol4'])), bpm: 120, instrument: 'piano' });
    advance(0.8);
    transport.pause();
    expect(transport.snapshot().state).toBe('paused');
    expect(backend.active).toBe(0);
    const played = backend.notes.length;
    advance(2); // time passes while paused: nothing new is scheduled
    expect(backend.notes.length).toBe(played);
    await transport.resume();
    advance(3);
    expect(backend.notes.map((note) => note.midi)).toEqual([60, 62, 64, 67]);
    await transport.play({ owner: 'm', sequence: melodyToSequence(melody(['Do4', 'Re4', 'Mi4', 'Sol4'])), bpm: 120, instrument: 'piano' });
    advance(0.3);
    transport.stop();
    expect(transport.snapshot().state).toBe('idle');
    expect(backend.active).toBe(0);
    const count = backend.notes.length;
    advance(5);
    expect(backend.notes.length).toBe(count);
  });
  it('starts from a chosen note and reports which one sounds', async () => {
    const { backend, transport, advance } = rig();
    const sequence = melodyToSequence(melody(['Do4', 'Re4', 'Mi4', 'Sol4']));
    await transport.play({ owner: 'm', sequence, bpm: 120, instrument: 'piano', fromBeat: 2 });
    advance(0.3);
    expect(transport.snapshot().activeId).toBe('n2');
    advance(2);
    expect(backend.notes.map((note) => note.midi)).toEqual([64, 67]);
  });
  it('changing BPM while playing continues from the same place', async () => {
    const { backend, transport, advance } = rig();
    await transport.play({ owner: 'm', sequence: melodyToSequence(melody(['Do4', 'Re4', 'Mi4', 'Sol4', 'Fa4', 'Mi4'])), bpm: 120, instrument: 'piano' });
    advance(1.2);
    transport.setBpm(60);
    advance(8);
    const midis = backend.notes.map((note) => note.midi);
    expect(midis.slice(0, 3)).toEqual([60, 62, 64]);
    expect(midis[midis.length - 1]).toBe(64);
    expect(new Set(midis.slice(0, 3)).size).toBe(3);
  });
  it('a new source replaces the current one and chords are polyphonic', async () => {
    const { backend, transport, advance } = rig();
    await transport.play({ owner: 'a', sequence: melodyToSequence(melody(['Do4', 'Re4'])), bpm: 60, instrument: 'piano' });
    advance(0.3);
    await transport.play({ owner: 'b', sequence: chordsToSequence({ version: 1, items: [{ id: 'c1', symbol: 'Am', beats: 2 }] }), bpm: 60, instrument: 'piano' });
    expect(transport.snapshot().owner).toBe('b');
    advance(0.2);
    // The first source was cut (stopAll) and only the chord remains: bass + A, C, E sound at the same instant.
    expect(backend.stopped).toBeGreaterThanOrEqual(2);
    const last = backend.notes[backend.notes.length - 1].when;
    const chord = backend.notes.filter((note) => note.when === last);
    expect(chord.map((note) => note.midi).sort((x, y) => x - y)).toEqual([45, 57, 60, 64]);
  });
  it('loops and can click on the same clock', async () => {
    const { backend, transport, advance } = rig();
    await transport.play({ owner: 'm', sequence: melodyToSequence(melody(['Do4', 'Re4'])), bpm: 120, instrument: 'piano', loop: true, click: true });
    advance(3);
    expect(backend.notes.length).toBeGreaterThanOrEqual(5);
    expect(backend.clicks.length).toBeGreaterThanOrEqual(5);
    expect(transport.snapshot().state).toBe('playing');
    transport.stop();
    expect(backend.active).toBe(0);
  });
});
