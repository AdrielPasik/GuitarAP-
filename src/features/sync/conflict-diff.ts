import type { NotebookBlock, NotebookContent } from '@/core/model';
import { formatNote } from '@/core/theory/pitch';

/**
 * Comparing two versions of the same notebook (the one on this device and the one in the cloud) in terms a musician can
 * read. Blocks are matched by their stable id. Where a faithful difference exists (text, notes, chords) it is shown;
 * where it does not (a tablature grid, a fretboard map) the two complete versions are shown instead and nothing
 * pretends to be merged automatically.
 */
export type LineChange = { type: 'same' | 'removed' | 'added'; text: string };
export type BlockStatus = 'same' | 'changed' | 'only-device' | 'only-cloud';
export type BlockDiff = {
  id: string;
  kind: NotebookBlock['kind'];
  title: string;
  status: BlockStatus;
  device?: NotebookBlock;
  cloud?: NotebookBlock;
  /** A line-by-line difference, when the block has a faithful text form. */
  lines?: LineChange[];
};

/** Longest-common-subsequence line diff: small inputs only (lyrics, a phrase of notes). */
export function lineDiff(before: string[], after: string[]): LineChange[] {
  const n = before.length;
  const m = after.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) table[i][j] = before[i] === after[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const out: LineChange[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      out.push({ type: 'same', text: before[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      out.push({ type: 'removed', text: before[i] });
      i += 1;
    } else {
      out.push({ type: 'added', text: after[j] });
      j += 1;
    }
  }
  while (i < n) out.push({ type: 'removed', text: before[i++] });
  while (j < m) out.push({ type: 'added', text: after[j++] });
  return out;
}

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
};

const BEATS: Record<number, string> = { 0.5: 'corta', 1: 'normal', 2: 'larga', 4: 'sostenida' };

/** The readable lines of a block, or undefined when it has no faithful text form (then both versions are shown whole). */
export function textLines(block: NotebookBlock): string[] | undefined {
  switch (block.kind) {
    case 'lyrics':
      return block.content.text.split('\n');
    case 'text':
      return block.text.split('\n');
    case 'section':
      return [block.title];
    case 'melody': {
      const notes = block.content.events.map((event) => `${event.type === 'rest' ? 'silencio' : formatNote(event.midi ?? 0, 'latin', event.accidental ?? 'sharp')} · ${BEATS[event.beats] ?? `${event.beats} pulsos`}${event.lyric ? ` · «${event.lyric}»` : ''}`);
      return block.content.phrase ? [`frase: ${block.content.phrase}`, ...notes] : notes;
    }
    case 'chords':
      return block.content.items.map((item) => `${item.symbol} · ${item.beats} pulsos`);
    default:
      return undefined;
  }
}

const titleOf = (block: NotebookBlock) => ('title' in block && block.title) || ({ lyrics: 'Letra', melody: 'Melodía', tablature: 'Tablatura', map: 'Mapa del mástil', chords: 'Acordes', section: 'Sección', text: 'Texto' } as const)[block.kind];

export type NotebookDiff = { blocks: BlockDiff[]; metaChanged: boolean; commentsOnlyDevice: number; commentsOnlyCloud: number; identical: boolean };

export function diffNotebooks(device: NotebookContent, cloud: NotebookContent): NotebookDiff {
  const deviceById = new Map(device.blocks.map((block) => [block.id, block]));
  const cloudById = new Map(cloud.blocks.map((block) => [block.id, block]));
  const order = [...cloud.blocks.map((block) => block.id), ...device.blocks.map((block) => block.id).filter((id) => !cloudById.has(id))];
  const blocks: BlockDiff[] = order.map((id) => {
    const here = deviceById.get(id);
    const there = cloudById.get(id);
    const reference = (here ?? there)!;
    const base = { id, kind: reference.kind, title: titleOf(reference), device: here, cloud: there };
    if (here && !there) return { ...base, status: 'only-device' as const };
    if (there && !here) return { ...base, status: 'only-cloud' as const };
    if (canonical(here) === canonical(there)) return { ...base, status: 'same' as const };
    const a = textLines(there!);
    const b = textLines(here!);
    return { ...base, status: 'changed' as const, lines: a && b ? lineDiff(a, b) : undefined };
  });
  const deviceComments = new Set((device.comments ?? []).map((comment) => comment.id));
  const cloudComments = new Set((cloud.comments ?? []).map((comment) => comment.id));
  const metaChanged = canonical(device.meta ?? null) !== canonical(cloud.meta ?? null);
  const commentsOnlyDevice = [...deviceComments].filter((id) => !cloudComments.has(id)).length;
  const commentsOnlyCloud = [...cloudComments].filter((id) => !deviceComments.has(id)).length;
  return { blocks, metaChanged, commentsOnlyDevice, commentsOnlyCloud, identical: blocks.every((block) => block.status === 'same') && !metaChanged && !commentsOnlyDevice && !commentsOnlyCloud };
}

export type Pick = 'device' | 'cloud';
/**
 * A manual merge, block by block. `picks` says which version to take for each block that differs; a block present on
 * one side only is included unless `drop` lists it. Order follows the cloud, with device-only blocks after the block
 * that precedes them on the device. Comments are the union; song data is the device's unless it has none.
 */
export function mergeByBlocks(device: NotebookContent, cloud: NotebookContent, picks: Record<string, Pick>, drop: ReadonlySet<string> = new Set()): NotebookContent {
  const deviceById = new Map(device.blocks.map((block) => [block.id, block]));
  const cloudById = new Map(cloud.blocks.map((block) => [block.id, block]));
  const merged: NotebookBlock[] = [];
  for (const block of cloud.blocks) {
    if (drop.has(block.id)) continue;
    const mine = deviceById.get(block.id);
    merged.push(mine && (picks[block.id] ?? 'device') === 'device' ? mine : block);
  }
  device.blocks.forEach((block, index) => {
    if (cloudById.has(block.id) || drop.has(block.id)) return;
    let at = 0;
    for (let back = index - 1; back >= 0; back -= 1) {
      const found = merged.findIndex((item) => item.id === device.blocks[back].id);
      if (found >= 0) {
        at = found + 1;
        break;
      }
    }
    merged.splice(at, 0, block);
  });
  const comments = [...(device.comments ?? [])];
  for (const comment of cloud.comments ?? []) if (!comments.some((item) => item.id === comment.id)) comments.push(comment);
  const meta = device.meta ?? cloud.meta;
  return { ...device, blocks: structuredClone(merged), ...(meta ? { meta: structuredClone(meta) } : {}), ...(comments.length ? { comments: structuredClone(comments) } : {}) };
}
