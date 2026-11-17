import { useCallback, useEffect, useMemo } from 'react';
import { transport, useTransport } from '@/audio/engine';
import { resolveBpm } from '@/audio/plan';
import type { InstrumentId, Sequence } from '@/audio/types';
import { useMetronome } from '@/features/metronome/metronome-context';
import { useNotebookInfo } from '@/features/notebook/notebook-context';
import { usePref } from '@/core/prefs';

export type PlayerOptions = {
  /** Block id: the transport belongs to one block at a time. */
  owner: string;
  sequence: Sequence;
  blockBpm?: number;
  instrument?: InstrumentId;
  /** Lets the block remember a tempo or instrument change (a block-level setting of the document). */
};

export function useSoundPrefs() {
  const [instrument, setInstrument] = usePref<InstrumentId>('sound.instrument', 'piano');
  const [click, setClick] = usePref<boolean>('sound.click', false);
  const [loop, setLoop] = usePref<boolean>('sound.loop', false);
  const [preview, setPreview] = usePref<boolean>('sound.preview', false);
  return { instrument, setInstrument, click, setClick, loop, setLoop, preview, setPreview };
}

/**
 * Connects a block to the one transport. Playing, pausing and stopping always act on the shared transport,
 * so leaving the screen (unmount) stops the sound this block started.
 */
export function useBlockPlayer({ owner, sequence, blockBpm, instrument }: PlayerOptions) {
  const snapshot = useTransport();
  const metro = useMetronome();
  const { docBpm } = useNotebookInfo();
  const prefs = useSoundPrefs();
  const tempo = resolveBpm(blockBpm, docBpm, metro.bpm);
  const chosen = instrument ?? prefs.instrument;
  const mine = snapshot.owner === owner;
  const state = mine ? snapshot.state : 'idle';

  const play = useCallback(
    (fromBeat = 0) =>
      transport.play({
        owner,
        sequence,
        bpm: tempo.bpm,
        instrument: chosen,
        fromBeat,
        loop: prefs.loop,
        click: prefs.click,
        beatsPerBar: metro.beatsPerMeasure,
      }),
    [owner, sequence, tempo.bpm, chosen, prefs.loop, prefs.click, metro.beatsPerMeasure],
  );

  // Editing the sequence while it sounds would desynchronise it: stop instead of playing stale notes.
  const signature = useMemo(() => JSON.stringify(sequence.events.map((event) => [event.id, event.midis, event.beats])), [sequence]);
  useEffect(() => {
    if (transport.snapshot().owner === owner && transport.snapshot().state !== 'idle') transport.stop();
  }, [signature, owner]);

  // Leaving the block, the notebook or the app view never leaves music running.
  useEffect(
    () => () => {
      if (transport.snapshot().owner === owner) transport.stop();
    },
    [owner],
  );

  return {
    state,
    activeId: mine ? snapshot.activeId : null,
    bpm: tempo.bpm,
    source: tempo.source,
    instrument: chosen,
    play,
    pause: () => transport.pause(),
    resume: () => transport.resume(),
    stop: () => transport.stop(),
    toggle: () => {
      if (state === 'playing') transport.pause();
      else if (state === 'paused') void transport.resume();
      else void play(0);
    },
    setBpm: (bpm: number) => {
      if (mine) transport.setBpm(bpm);
    },
    prefs,
  };
}
export type BlockPlayer = ReturnType<typeof useBlockPlayer>;
