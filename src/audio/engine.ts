import { useSyncExternalStore } from 'react';
import { Transport, type Snapshot } from '@/audio/transport';
import { WebAudioBackend } from '@/audio/webaudio-backend';

/** The app's single transport, created on first import (no AudioContext exists until the first Play). */
export const backend = new WebAudioBackend();
export const transport = new Transport(backend);

if (typeof window !== 'undefined') {
  // Read-only probe used by browser tests to check that nothing is left sounding.
  Object.defineProperty(window, '__guitarapAudio', {
    configurable: true,
    get: () => ({ ...transport.snapshot(), voices: backend.activeVoices() }),
  });
}

export function useTransport(): Snapshot {
  return useSyncExternalStore(transport.subscribe, transport.snapshot, transport.snapshot);
}
