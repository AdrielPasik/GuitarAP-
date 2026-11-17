import { describe, expect, it } from 'vitest';
import { sequenceToMidi } from '@/audio/midi';
import { melodyToSequence } from '@/audio/plan';

describe('MIDI export', () => {
  it('writes a real Standard MIDI File with the tempo, the pitches and the lengths', () => {
    const bytes = sequenceToMidi(melodyToSequence({ version: 1, events: [
      { id: 'a', type: 'note', midi: 60, beats: 1 },
      { id: 'b', type: 'rest', beats: 1 },
      { id: 'c', type: 'note', midi: 64, beats: 2 },
    ] }), 120);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('MThd');
    expect([...bytes.slice(8, 14)]).toEqual([0, 0, 0, 1, 1, 0xe0]); // format 0, 1 track, 480 PPQ
    expect(String.fromCharCode(...bytes.slice(14, 18))).toBe('MTrk');
    const text = [...bytes];
    const tempo = text.findIndex((value, index) => value === 0xff && text[index + 1] === 0x51);
    expect(((text[tempo + 3] << 16) | (text[tempo + 4] << 8) | text[tempo + 5])).toBe(500000);
    // C4 on at tick 0, off at 480; E4 on at 960, off at 1920.
    const ons = text.flatMap((value, index) => (value === 0x90 ? [text[index + 1]] : []));
    expect(ons).toEqual([60, 64]);
    expect(text.slice(-3)).toEqual([0xff, 0x2f, 0x00]);
  });
});
