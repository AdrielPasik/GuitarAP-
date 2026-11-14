import { afterEach, describe, expect, it } from 'vitest';
import { db } from '@/data/database';
import { libraryRepository } from '@/data/library-repository';

describe('LibraryRepository', () => {
  afterEach(async () => { await db.delete(); await db.open(); });

  it('persists documents and creates a recovery version before saving', async () => {
    const document = await libraryRepository.createDocument('tablature', 'Riff');
    const changed = { ...document, title: 'Riff final' };
    await libraryRepository.saveDocument(changed);

    expect((await db.documents.get(document.id))?.title).toBe('Riff final');
    expect(await db.versions.where('documentId').equals(document.id).count()).toBe(1);
  });

  it('restores without discarding the document state being replaced', async () => {
    const document = await libraryRepository.createDocument('fretboard', 'Escala');
    await libraryRepository.saveDocument({ ...document, title: 'Escala editada' });
    const oldVersion = await db.versions.where('documentId').equals(document.id).first();
    await libraryRepository.restoreVersion(document.id, oldVersion!.id);

    expect((await db.documents.get(document.id))?.title).toBe('Escala');
    expect(await db.versions.where('documentId').equals(document.id).count()).toBe(2);
  });
});
