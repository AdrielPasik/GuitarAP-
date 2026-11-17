/**
 * One rule for tempo, resolved (never copied). From strongest to weakest:
 *   1. practice   - a temporary tempo chosen on purpose while studying; never saved in a document
 *   2. block      - a tempo the block carries as an explicit exception
 *   3. song       - the song's general BPM (meta.bpm of the notebook)
 *   4. preference - the person's default BPM for new work (Configuración)
 *   5. system     - 96
 * Nothing here writes to a document: a block that has no tempo of its own simply follows the song, so changing
 * the song's BPM changes every block that inherits it.
 */
export const SYSTEM_BPM = 96;
export const BPM_MIN = 30;
export const BPM_MAX = 280;
export type TempoSource = 'práctica' | 'bloque' | 'canción' | 'preferencia' | 'sistema';

export const clampBpm = (value: number) => Math.max(BPM_MIN, Math.min(BPM_MAX, Math.round(value)));

export type TempoInputs = { practice?: number; block?: number; song?: number; preference?: number };

export function effectiveTempo(inputs: TempoInputs): { bpm: number; source: TempoSource } {
  if (inputs.practice) return { bpm: clampBpm(inputs.practice), source: 'práctica' };
  if (inputs.block) return { bpm: clampBpm(inputs.block), source: 'bloque' };
  if (inputs.song) return { bpm: clampBpm(inputs.song), source: 'canción' };
  if (inputs.preference) return { bpm: clampBpm(inputs.preference), source: 'preferencia' };
  return { bpm: SYSTEM_BPM, source: 'sistema' };
}

/** What the tempo would be without the temporary practice tempo: the value "Volver a…" returns to. */
export const baseTempo = (inputs: TempoInputs) => effectiveTempo({ ...inputs, practice: undefined });

/** Sets the block's own tempo, or removes it (undefined) so the block follows the song again. Never leaves `bpm: undefined` behind. */
export function withBlockBpm<T extends { bpm?: number }>(content: T, bpm: number | undefined): T {
  const next = { ...content };
  if (bpm === undefined) delete next.bpm;
  else next.bpm = clampBpm(bpm);
  return next;
}
