import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('never lets a stale open editor overwrite where a material lives or whether it is in the trash', async () => {
    const folder = await libraryRepository.createNode('Escalas', 'folder');
    const document = await libraryRepository.createDocument('tablature', 'Riff');
    const staleCopy = { ...document };
    await libraryRepository.moveDocument(document.id, folder.id);
    await libraryRepository.trashDocument(document.id);

    await libraryRepository.saveDocument({ ...staleCopy, title: 'Riff editado' });

    const stored = await db.documents.get(document.id);
    expect(stored?.title).toBe('Riff editado');
    expect(stored?.nodeId).toBe(folder.id);
    expect(stored?.deletedAt).toBeTypeOf('number');
  });

  it('keeps one autosave checkpoint every few minutes, and always one for explicit saves', async () => {
    const start = Date.now();
    const clock = vi.spyOn(Date, 'now');
    clock.mockReturnValue(start);
    const document = await libraryRepository.createDocument('tablature', 'Riff');
    const versions = () => db.versions.where('documentId').equals(document.id).count();

    await libraryRepository.saveDocument({ ...document, title: 'a' });
    expect(await versions()).toBe(1);
    clock.mockReturnValue(start + 20_000);
    await libraryRepository.saveDocument({ ...document, title: 'b' });
    await libraryRepository.saveDocument({ ...document, title: 'c' });
    expect(await versions()).toBe(1);
    await libraryRepository.saveDocument({ ...document, title: 'd' }, 'manual');
    expect(await versions()).toBe(2);
    clock.mockReturnValue(start + 5 * 60_000);
    await libraryRepository.saveDocument({ ...document, title: 'e' });
    expect(await versions()).toBe(3);
    clock.mockRestore();
  });

  it('stores a study notebook and exports it in the backup', async () => {
    const material = await libraryRepository.createStudyMaterial('Pentatónica');
    expect(material.content).toMatchObject({ kind: 'notebook', blocks: [] });
    const backup = JSON.parse(await libraryRepository.exportBackup()) as { documents: Array<{ id: string; content: { kind?: string } }> };
    expect(backup.documents.find((item) => item.id === material.id)?.content.kind).toBe('notebook');
  });
});
