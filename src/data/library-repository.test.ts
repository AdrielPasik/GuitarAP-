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

  it('trashes and restores a folder subtree with its documents atomically', async () => {
    const parent = await libraryRepository.createNode('Escalas', 'folder');
    const child = await libraryRepository.createNode('Mayor', 'folder', parent.id);
    const document = await libraryRepository.createDocument('fretboard', 'Re mayor', child.id);
    await libraryRepository.trashNode(parent.id);
    expect((await db.nodes.get(child.id))?.deletedAt).toBeTypeOf('number');
    expect((await db.documents.get(document.id))?.deletedAt).toBeTypeOf('number');
    await libraryRepository.restoreNode(parent.id);
    expect((await db.nodes.get(child.id))?.deletedAt).toBeUndefined();
    expect((await db.documents.get(document.id))?.deletedAt).toBeUndefined();
  });

  it('validates a backup before replacing local data', async () => {
    await expect(libraryRepository.importBackup('{"schema":2}', 'replace')).rejects.toThrow('esquema compatible');
    expect(await db.documents.count()).toBe(0);
  });

  it('exports the visible library with folders, documents and recovery versions', async () => {
    const folder = await libraryRepository.createNode('Escalas', 'folder');
    const document = await libraryRepository.createDocument('tablature', 'Riff', folder.id);
    await libraryRepository.saveDocument({ ...document, title: 'Riff guardado' });

    const backup = JSON.parse(await libraryRepository.exportBackup()) as {
      schema: number;
      nodes: Array<{ id: string }>;
      documents: Array<{ id: string }>;
      versions: Array<{ documentId: string }>;
    };
    expect(backup.schema).toBe(1);
    expect(backup.nodes.map((item) => item.id)).toContain(folder.id);
    expect(backup.documents.map((item) => item.id)).toContain(document.id);
    expect(backup.versions.map((item) => item.documentId)).toContain(document.id);
  });
});
