import type { NoteComment, NotebookBlock, NotebookContent } from '@/core/model';
import { pruneComments } from '@/core/notebook';

/**
 * Three-way merge of two people's edits of one notebook, by block.
 *   base   = the version both started from (the last one this device synchronised)
 *   mine   = what I have now
 *   theirs = what the server has now
 * Rules, chosen so that nothing is ever silently lost:
 *   - Different blocks edited (one by each): both changes are kept.
 *   - Only one side changed a block: that side wins.
 *   - Both changed the SAME block differently: the other person's version stays in place and mine is kept right
 *     after it as an explicit copy titled "(tu versión)". It is reported as a conflict to be resolved by hand.
 *   - Edited by me, deleted by them: my edited block is kept and reported.
 *   - Added by either side: kept. Deleted by one side and untouched by the other: deleted.
 *   - Comments: the union, by id; comments of blocks that no longer exist are dropped.
 *   - Song data (key, BPM, status…): per field; if both changed the same field differently the other person's wins and it is reported.
 */
export type Conflict = { blockId: string; kind: 'both-edited' | 'edited-here-deleted-there'; mineCopyId?: string; label: string };
export type MergeResult = { merged: NotebookContent; conflicts: Conflict[]; changedByThem: boolean };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const labelOf = (block: NotebookBlock) => ('title' in block && block.title?.trim()) || block.kind;

export function mergeNotebooks(base: NotebookContent, mine: NotebookContent, theirs: NotebookContent): MergeResult {
  const baseBlocks = new Map(base.blocks.map((block) => [block.id, block]));
  const myBlocks = new Map(mine.blocks.map((block) => [block.id, block]));
  const theirBlocks = new Map(theirs.blocks.map((block) => [block.id, block]));
  const conflicts: Conflict[] = [];
  const result: NotebookBlock[] = [];
  const copies = new Map<string, NotebookBlock>(); // my version to place right after a conflicted block

  // Start from their order: it is the shared truth.
  for (const theirBlock of theirs.blocks) {
    const baseBlock = baseBlocks.get(theirBlock.id);
    const myBlock = myBlocks.get(theirBlock.id);
    if (!baseBlock) {
      // They added it (it is not in my base); if I also have it, the ids matched by chance: theirs wins.
      result.push(theirBlock);
      continue;
    }
    if (!myBlock) {
      // I deleted it. If they did not touch it, it stays deleted; if they changed it, keep theirs (their work wins over my deletion).
      if (!same(baseBlock, theirBlock)) result.push(theirBlock);
      continue;
    }
    if (same(myBlock, baseBlock)) result.push(theirBlock); // only they changed it (or nobody)
    else if (same(theirBlock, baseBlock) || same(myBlock, theirBlock)) result.push(myBlock); // only I changed it (or the same change)
    else {
      result.push(theirBlock);
      const copy = { ...structuredClone(myBlock), id: crypto.randomUUID() } as NotebookBlock;
      if (copy.kind !== 'section' && copy.kind !== 'text') copy.title = `${copy.title?.trim() || labelOf(copy)} (tu versión)`;
      copies.set(theirBlock.id, copy);
      conflicts.push({ blockId: theirBlock.id, kind: 'both-edited', mineCopyId: copy.id, label: labelOf(theirBlock) });
    }
  }

  // Blocks they deleted: keep mine only if I changed it.
  const kept = new Set(result.map((block) => block.id));
  for (const baseBlock of base.blocks) {
    if (theirBlocks.has(baseBlock.id)) continue;
    const myBlock = myBlocks.get(baseBlock.id);
    if (myBlock && !same(myBlock, baseBlock)) {
      copies.set(`deleted:${baseBlock.id}`, myBlock);
      conflicts.push({ blockId: baseBlock.id, kind: 'edited-here-deleted-there', label: labelOf(myBlock) });
    }
  }

  // Place my additions (blocks that are not in base and not in theirs) after the block that precedes them in my order.
  const additions = mine.blocks.filter((block) => !baseBlocks.has(block.id) && !theirBlocks.has(block.id));
  const merged: NotebookBlock[] = [];
  const emitted = new Set<string>();
  const place = (block: NotebookBlock) => {
    if (emitted.has(block.id)) return;
    emitted.add(block.id);
    merged.push(block);
    const copy = copies.get(block.id);
    if (copy) merged.push(copy);
    for (const added of additions) {
      const index = mine.blocks.findIndex((item) => item.id === added.id);
      if (index > 0 && mine.blocks[index - 1].id === block.id) place(added);
    }
  };
  for (const block of result) place(block);
  for (const added of additions) place(added);
  for (const [key, block] of copies) if (key.startsWith('deleted:') && !emitted.has(block.id)) place(block);
  void kept;

  // Song data, field by field.
  const meta = { ...(theirs.meta ?? {}) };
  const fields = new Set([...Object.keys(base.meta ?? {}), ...Object.keys(mine.meta ?? {})]) as Set<keyof NonNullable<NotebookContent['meta']>>;
  for (const field of fields) {
    const b = base.meta?.[field];
    const m = mine.meta?.[field];
    const t = theirs.meta?.[field];
    if (same(m, b) || same(m, t)) continue; // I did not change it, or we agree
    if (same(t, b)) {
      if (m === undefined) delete meta[field];
      else (meta as Record<string, unknown>)[field] = m;
    } else conflicts.push({ blockId: `meta:${String(field)}`, kind: 'both-edited', label: `Dato de la canción: ${String(field)}` });
  }

  // Comments: everything either side has, once.
  const comments = new Map<string, NoteComment>();
  for (const comment of [...(theirs.comments ?? []), ...(mine.comments ?? [])]) {
    const known = comments.get(comment.id);
    if (!known || comment.updatedAt > known.updatedAt) comments.set(comment.id, comment);
  }
  // A comment I deleted (it is in base, not in mine) stays deleted unless they changed it.
  for (const comment of base.comments ?? []) {
    const stillMine = (mine.comments ?? []).some((item) => item.id === comment.id);
    const theirsNow = (theirs.comments ?? []).find((item) => item.id === comment.id);
    if (!stillMine && theirsNow && same(theirsNow, comment)) comments.delete(comment.id);
  }

  const output: NotebookContent = { ...theirs, blocks: merged };
  if (Object.keys(meta).length) output.meta = meta;
  else delete output.meta;
  if (comments.size) output.comments = [...comments.values()];
  else delete output.comments;
  const changedByThem = !same(base, theirs);
  return { merged: pruneComments(output), conflicts, changedByThem };
}
