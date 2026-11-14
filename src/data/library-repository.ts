import type { DocumentType, LibraryNode, MusicalDocument } from '@/core/model';
import { createFretboardContent, createTablatureContent } from '@/core/model';
import { db } from '@/data/database';

const now = () => Date.now();

export class LibraryRepository {
  async createNode(name: string, kind: LibraryNode['kind'], parentId: string | null = null) {
    const createdAt = now();
    const node: LibraryNode = { id: crypto.randomUUID(), parentId, kind, name: name.trim() || 'Sin título', order: createdAt, createdAt, updatedAt: createdAt };
    await db.nodes.add(node);
    return node;
  }

  async updateNode(id: string, change: Partial<Pick<LibraryNode, 'name' | 'parentId' | 'order' | 'song'>>) {
    await db.nodes.update(id, { ...change, updatedAt: now() });
  }

  async createDocument(type: DocumentType, title: string, nodeId: string | null = null, songId: string | null = null) {
    const createdAt = now();
    const document: MusicalDocument = {
      id: crypto.randomUUID(), nodeId, songId, type, title: title.trim() || (type === 'tablature' ? 'Nueva tablatura' : 'Nuevo diapasón'),
      content: type === 'tablature' ? createTablatureContent() : createFretboardContent(), rev: 1, createdAt, updatedAt: createdAt,
    };
    await db.documents.add(document);
    return document;
  }

  async saveDocument(document: MusicalDocument, reason: 'autosave' | 'manual' = 'autosave') {
    await db.transaction('rw', db.documents, db.versions, async () => {
      const current = await db.documents.get(document.id);
      if (!current) throw new Error('El documento no existe.');
      await db.versions.add({ id: crypto.randomUUID(), documentId: current.id, createdAt: now(), reason, title: current.title, content: structuredClone(current.content) });
      await db.documents.put({ ...document, rev: current.rev + 1, updatedAt: now() });
    });
  }

  async duplicateDocument(id: string) {
    const source = await db.documents.get(id);
    if (!source) throw new Error('El documento no existe.');
    const copy = { ...source, id: crypto.randomUUID(), title: `${source.title} — copia`, rev: 1, createdAt: now(), updatedAt: now(), content: structuredClone(source.content) };
    await db.documents.add(copy);
    return copy;
  }

  async trashDocument(id: string) { await db.documents.update(id, { deletedAt: now(), updatedAt: now() }); }
  async restoreDocument(id: string) { await db.documents.update(id, { deletedAt: undefined, updatedAt: now() }); }
  async trashNode(id: string) { await db.nodes.update(id, { deletedAt: now(), updatedAt: now() }); }
  async restoreNode(id: string) { await db.nodes.update(id, { deletedAt: undefined, updatedAt: now() }); }

  async restoreVersion(documentId: string, versionId: string) {
    const version = await db.versions.get(versionId);
    const document = await db.documents.get(documentId);
    if (!version || !document) throw new Error('No se encontró la versión solicitada.');
    await db.transaction('rw', db.documents, db.versions, async () => {
      await db.versions.add({ id: crypto.randomUUID(), documentId, createdAt: now(), reason: 'pre-restore', title: document.title, content: structuredClone(document.content) });
      await db.documents.put({ ...document, title: version.title, content: structuredClone(version.content), rev: document.rev + 1, updatedAt: now() });
    });
  }

  async exportBackup() {
    return JSON.stringify({ schema: 1, exportedAt: new Date().toISOString(), nodes: await db.nodes.toArray(), documents: await db.documents.toArray(), versions: await db.versions.toArray() }, null, 2);
  }
}

export const libraryRepository = new LibraryRepository();
