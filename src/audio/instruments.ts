import type { InstrumentId } from '@/audio/types';

/**
 * Which instrument a block sounds with. Three layers, strongest first:
 *   1. the instrument chosen explicitly for that block (stored in the document),
 *   2. the person's preference for that KIND of block (per device),
 *   3. the system default for that kind: melodies on piano, tablatures and chord progressions on guitar.
 * Nothing is ever written to a document to apply a default, so changing a preference never rewrites old material and
 * never overrides a block that has its own instrument.
 */
export type InstrumentKind = 'melody' | 'tablature' | 'chords';
export const INSTRUMENT_KINDS: Array<{ kind: InstrumentKind; label: string; hint: string }> = [
  { kind: 'melody', label: 'Melodías', hint: 'La voz o la línea que cantás' },
  { kind: 'tablature', label: 'Tablaturas', hint: 'Riffs y solos' },
  { kind: 'chords', label: 'Progresiones de acordes', hint: 'Acompañamiento' },
];
export const SYSTEM_INSTRUMENT: Record<InstrumentKind, InstrumentId> = { melody: 'piano', tablature: 'guitar', chords: 'guitar' };
export const instrumentPrefKey = (kind: InstrumentKind) => `sound.instrument.${kind}`;
export const INSTRUMENT_LABEL: Record<InstrumentId, string> = { piano: 'Piano', guitar: 'Guitarra' };

export type InstrumentSource = 'temporary' | 'block' | 'preference' | 'system';
export function resolveInstrument(input: {
  kind: InstrumentKind;
  /** Chosen for this block, saved in the document. */
  explicit?: InstrumentId | null;
  /** Chosen on this device for this kind of block. */
  preference?: InstrumentId | null;
}): { id: InstrumentId; source: InstrumentSource } {
  if (input.explicit) return { id: input.explicit, source: 'block' };
  if (input.preference) return { id: input.preference, source: 'preference' };
  return { id: SYSTEM_INSTRUMENT[input.kind], source: 'system' };
}

/** The block's content with an explicit instrument, or without the key at all when it returns to the default. */
export function withInstrument<T extends { instrument?: InstrumentId }>(content: T, instrument: InstrumentId | undefined): T {
  const { instrument: _removed, ...rest } = content;
  void _removed;
  return (instrument ? { ...rest, instrument } : rest) as T;
}
