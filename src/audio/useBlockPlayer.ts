import { useCallback, useEffect, useMemo } from 'react';
import { transport, useTransport } from '@/audio/engine';
import { baseTempo, effectiveTempo } from '@/audio/tempo';
import type { InstrumentId, Sequence } from '@/audio/types';
import { useMetronome } from '@/features/metronome/metronome-context';
import { useNotebookInfo } from '@/features/notebook/notebook-context';
import { usePref } from '@/core/prefs';
import { setMasterVolume } from '@/audio/webaudio-backend';

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
  const [volume, setVolume] = usePref<number>('sound.volume', 0.7);
  return { instrument, setInstrument, click, setClick, loop, setLoop, preview, setPreview, volume, setVolume };
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
  const [preference] = usePref<number>('default-bpm', 96);
  const inputs = { practice: metro.practiceBpm, block: blockBpm, song: docBpm, preference };
  const tempo = effectiveTempo(inputs);
  const base = baseTempo(inputs);
  const chosen = instrument ?? prefs.instrument;
  const mine = snapshot.owner === owner;
  const state = mine ? snapshot.state : 'idle';

  const play = useCallback(
    (fromBeat = 0) => {
      setMasterVolume(prefs.volume);
      return transport.play({
        owner,
        sequence,
        bpm: tempo.bpm,
        instrument: chosen,
        fromBeat,
        loop: prefs.loop,
        click: prefs.click,
        beatsPerBar: metro.beatsPerMeasure,
      });
    },
    [owner, sequence, tempo.bpm, chosen, prefs.loop, prefs.click, prefs.volume, metro.beatsPerMeasure],
  );

  // A tempo change (song BPM, practice tempo, block exception) is heard immediately without losing the place.
  useEffect(() => {
    if (transport.snapshot().owner === owner && transport.snapshot().state !== 'idle' && transport.snapshot().bpm !== tempo.bpm) transport.setBpm(tempo.bpm);
  }, [tempo.bpm, owner]);

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
    /** What the tempo returns to when the practice tempo is cleared. */
    base,
    blockBpm,
    setPractice: metro.setBpm,
    resetPractice: metro.resetPractice,
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
