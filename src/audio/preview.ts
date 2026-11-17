import { backend } from '@/audio/engine';
import { getAudioContext } from '@/audio/webaudio-backend';
import type { InstrumentId } from '@/audio/types';

/** One short note (e.g. when picking a pitch). Only called from a user action and only if the person enabled previews. */
export async function previewNote(midi: number, instrument: InstrumentId, seconds = 0.45) {
  await backend.resume();
  backend.playNote(instrument, midi, getAudioContext().currentTime + 0.01, seconds);
}
