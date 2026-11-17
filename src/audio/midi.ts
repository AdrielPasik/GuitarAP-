import { melodyToSequence } from '@/audio/plan';
import type { Sequence } from '@/audio/types';
import type { MelodyContent } from '@/core/model';

/**
 * Standard MIDI File, format 0, one track, 480 ticks per beat. Only pitch, timing and tempo are written:
 * it is a file of musical events, not an audio recording and not an image of the notation.
 */
const PPQ = 480;

function vlq(value: number): number[] {
  let rest = Math.max(0, Math.round(value));
  const bytes = [rest & 0x7f];
  while ((rest >>= 7)) bytes.unshift((rest & 0x7f) | 0x80);
  return bytes;
}
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number) => [(n >>> 8) & 255, n & 255];

export function sequenceToMidi(sequence: Sequence, bpm: number, program = 0, name = 'GuitarAP'): Uint8Array {
  type Raw = { tick: number; order: number; bytes: number[] };
  const raw: Raw[] = [];
  for (const event of sequence.events) {
    const on = Math.round(event.start * PPQ);
    const off = Math.round((event.start + event.beats) * PPQ);
    for (const midi of event.midis) {
      raw.push({ tick: on, order: 1, bytes: [0x90, midi & 127, 90] });
      raw.push({ tick: off, order: 0, bytes: [0x80, midi & 127, 0] });
    }
  }
  raw.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const track: number[] = [];
  const text = [...new TextEncoder().encode(name)];
  track.push(0, 0xff, 0x03, ...vlq(text.length), ...text);
  const micros = Math.round(60_000_000 / bpm);
  track.push(0, 0xff, 0x51, 0x03, (micros >> 16) & 255, (micros >> 8) & 255, micros & 255);
  track.push(0, 0xc0, program & 127);
  let last = 0;
  for (const item of raw) {
    track.push(...vlq(item.tick - last), ...item.bytes);
    last = item.tick;
  }
  const end = Math.max(last, Math.round(sequence.totalBeats * PPQ));
  track.push(...vlq(end - last), 0xff, 0x2f, 0x00);
  return Uint8Array.from([0x4d, 0x54, 0x68, 0x64, ...u32(6), ...u16(0), ...u16(1), ...u16(PPQ), 0x4d, 0x54, 0x72, 0x6b, ...u32(track.length), ...track]);
}

export const melodyToMidi = (content: MelodyContent, bpm: number) =>
  sequenceToMidi(melodyToSequence(content), bpm, content.instrument === 'guitar' ? 24 : 0);

export function downloadMidi(bytes: Uint8Array, baseName: string) {
  const safe = baseName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'melodia';
  const blob = new Blob([bytes as BlobPart], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safe}.mid`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
