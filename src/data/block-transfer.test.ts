import { afterEach, describe, expect, it } from 'vitest';
import type { NotebookContent } from '@/core/model';
import { addComment, cloneBlocks, extractBlocks, newBlock, removeBlock, toNotebook } from '@/core/notebook';
import { db } from '@/data/database';
import { appendBlocksToDocument, removeBlocksFromDocument } from '@/data/block-transfer';
import { libraryRepository } from '@/data/library-repository';
import { parseMelodyText } from '@/features/melody/operations';

function songWithMelody(): NotebookContent {
  const melody = newBlock('melody');
  if (melody.kind !== 'melody') throw new Error('unreachable');
  melody.content.events = parseMelodyText('Do4 Re4:2 r Mi4').events;
  melody.content.bpm = 70;
  melody.content.instrument = 'guitar';
  melody.content.phrase = 'Hoy vuelvo';
  melody.content.events[0].lyric = 'Hoy';
  const base: NotebookContent = { kind: 'notebook', version: 1, blocks: [melody] };
  return addComment(addComment(base, { blockId: melody.id }, 'Cantar suave').notebook, { blockId: melody.id, eventId: melody.content.events[1].id }, 'Probar una tercera abajo').notebook;
}

describe('moving and copying blocks between documents', () => {
  afterEach(async () => {
    await db.delete();
    await db.open();
  });

  async function twoSongs() {
    const a = await libraryRepository.createFromTemplate('composition');
    const b = await libraryRepository.createFromTemplate('composition');
    const content = songWithMelody();
    await db.documents.put({ ...a, content });
    return { a: { ...a, content }, b };
  }

  it('a move keeps notes, durations, lyrics, comments and settings, and removes the source', async () => {
    const { a, b } = await twoSongs();
    const source = toNotebook(a);
    const { blocks, comments } = extractBlocks(source, [source.blocks[0].id]);
    await appendBlocksToDocument(b.id, blocks, comments);
    const moved = toNotebook((await db.documents.get(b.id))!);
    const melody = moved.blocks[0];
    expect(melody.kind).toBe('melody');
    if (melody.kind !== 'melody') return;
    expect(melody.content.events.map((event) => [event.midi, event.beats, event.type])).toEqual([[60, 1, 'note'], [62, 2, 'note'], [undefined, 1, 'rest'], [64, 1, 'note']]);
    expect(melody.content.events[0].lyric).toBe('Hoy');
    expect(melody.content).toMatchObject({ bpm: 70, instrument: 'guitar', phrase: 'Hoy vuelvo' });
    expect(moved.comments?.map((comment) => comment.text).sort()).toEqual(['Cantar suave', 'Probar una tercera abajo']);
    // Every comment points at something that exists in the destination.
    const eventIds = new Set(melody.content.events.map((event) => event.id));
    for (const comment of moved.comments ?? []) {
      expect(comment.blockId).toBe(melody.id);
      if (comment.eventId) expect(eventIds.has(comment.eventId)).toBe(true);
    }
    // A recovery version of the destination was kept before the write.
    expect(await db.versions.where('documentId').equals(b.id).count()).toBe(1);
    // Removing from the source is the caller's second step and drops the comments with the block.
    expect(removeBlock(source, source.blocks[0].id).comments ?? []).toHaveLength(0);
  });

  it('a copy gets new ids everywhere, leaves the original untouched and never shares references', async () => {
    const { a, b } = await twoSongs();
    const source = toNotebook(a);
    const { blocks, comments } = cloneBlocks(source, [source.blocks[0].id]);
    await appendBlocksToDocument(b.id, blocks, comments);
    const copy = toNotebook((await db.documents.get(b.id))!).blocks[0];
    const original = toNotebook((await db.documents.get(a.id))!).blocks[0];
    if (copy.kind !== 'melody' || original.kind !== 'melody') throw new Error('unreachable');
    expect(copy.id).not.toBe(original.id);
    expect(copy.content.events.map((event) => event.midi)).toEqual(original.content.events.map((event) => event.midi));
    const originalIds = new Set(original.content.events.map((event) => event.id));
    expect(copy.content.events.every((event) => !originalIds.has(event.id))).toBe(true);
    const copiedComments = toNotebook((await db.documents.get(b.id))!).comments ?? [];
    expect(copiedComments).toHaveLength(2);
    expect(copiedComments.every((comment) => comment.blockId === copy.id)).toBe(true);
    expect(toNotebook((await db.documents.get(a.id))!).comments).toHaveLength(2); // the original keeps its own
  });

  it('if saving the destination fails nothing changes anywhere (no content is lost)', async () => {
    const { a, b } = await twoSongs();
    const before = JSON.stringify(await db.documents.get(b.id));
    const versionsBefore = await db.versions.count();
    const source = toNotebook(a);
    const { blocks, comments } = extractBlocks(source, [source.blocks[0].id]);
    await expect(appendBlocksToDocument(b.id, blocks, comments, { failAfterWrite: true })).rejects.toThrow('Falló el guardado');
    expect(JSON.stringify(await db.documents.get(b.id))).toBe(before);
    expect(await db.versions.count()).toBe(versionsBefore);
    // The source was never touched, so the melody still exists.
    expect(toNotebook((await db.documents.get(a.id))!).blocks).toHaveLength(1);
  });

  it('refuses a destination that is trashed or belongs to another account, and can undo a transfer', async () => {
    const { a, b } = await twoSongs();
    const source = toNotebook(a);
    const { blocks, comments } = extractBlocks(source, [source.blocks[0].id]);
    await libraryRepository.trashDocument(b.id);
    await expect(appendBlocksToDocument(b.id, blocks, comments)).rejects.toThrow('papelera');
    await libraryRepository.restoreDocument(b.id);
    await db.documents.update(b.id, { ownerId: 'someone-else' });
    await expect(appendBlocksToDocument(b.id, blocks, comments)).rejects.toThrow('No tenés permiso');
    await db.documents.update(b.id, { ownerId: undefined });
    await appendBlocksToDocument(b.id, blocks, comments);
    await removeBlocksFromDocument(b.id, blocks.map((block) => block.id));
    const after = toNotebook((await db.documents.get(b.id))!);
    expect(after.blocks).toHaveLength(0);
    expect(after.comments ?? []).toHaveLength(0);
  });
});
