import type { DocumentType, FretboardContent, LibraryNode, MusicalDocument, NotebookContent } from '@/core/model';

export type MaterialTemplate = 'scale' | 'triad' | 'riff' | 'empty' | 'study' | 'text' | 'melody' | 'song-lyrics' | 'song-melody' | 'chords' | 'composition';
import { createFretboardContent, createTablatureContent } from '@/core/model';
import { newBlock } from '@/core/notebook';
import { db } from '@/data/database';
import { activeOwnerId, belongsToOwner, libraryScope } from '@/data/library-scope';

const now = () => Date.now();
/** Autosaves keep one recovery checkpoint per document at most this often. */
const AUTOSAVE_VERSION_INTERVAL = 2 * 60 * 1000;

export class LibraryRepository {
  async createNode(name: string, kind: LibraryNode['kind'], parentId: string | null = null) {
    const createdAt = now();
    const node: LibraryNode = { id: crypto.randomUUID(), parentId, kind, name: name.trim() || 'Sin título', order: createdAt, createdAt, updatedAt: createdAt, rev: 1, ownerId: (await activeOwnerId()) ?? undefined };
    await db.nodes.add(node);
    return node;
  }

  async updateNode(id: string, change: Partial<Pick<LibraryNode, 'name' | 'parentId' | 'order' | 'song'>>) {
    const node = await db.nodes.get(id); if (!node || node.ownerId !== ((await activeOwnerId()) ?? undefined)) return;
    await db.nodes.update(id, { ...change, rev: (node.rev ?? 1) + 1, updatedAt: now() });
  }

  async createDocument(type: DocumentType, title: string, nodeId: string | null = null, songId: string | null = null) {
    const createdAt = now();
    const document: MusicalDocument = {
      id: crypto.randomUUID(), nodeId, songId, type, title: title.trim() || (type === 'tablature' ? 'Nueva tablatura' : 'Nuevo mapa'),
      content: type === 'tablature' ? createTablatureContent() : createFretboardContent(), rev: 1, createdAt, updatedAt: createdAt, ownerId: (await activeOwnerId()) ?? undefined,
    };
    await db.documents.add(document);
    return document;
  }

  /**
   * Starts a material from a template. A material is a notebook of blocks, so a template only decides
   * which blocks exist at the start; nothing is created that was not asked for, and any block can be removed.
   */
  async createFromTemplate(template: MaterialTemplate, nodeId: string | null = null, songId: string | null = null) {
    if (template === 'scale') return this.createDocument('fretboard', 'Nueva escala', nodeId, songId);
    if (template === 'riff') return this.createDocument('tablature', 'Nuevo riff', nodeId, songId);
    if (template === 'triad') {
      const document = await this.createDocument('fretboard', 'Nueva tríada', nodeId, songId);
      const content = document.content as FretboardContent;
      content.view = { labels: 'both', emphasis: ['root', 'third', 'fifth'] };
      await db.documents.put({ ...document, content });
      return { ...document, content };
    }
    const plans: Record<string, { title: string; blocks: NotebookContent['blocks']; meta?: NotebookContent['meta'] }> = {
      empty: { title: 'Nuevo cuaderno', blocks: [] },
      text: { title: 'Nueva nota', blocks: [newBlock('text', 'note')] },
      melody: { title: 'Nueva melodía', blocks: [newBlock('melody')] },
      chords: { title: 'Nueva progresión', blocks: [newBlock('chords')] },
      'song-lyrics': { title: 'Nueva canción', blocks: [newBlock('lyrics')], meta: { status: 'idea' } },
      'song-melody': { title: 'Nueva canción', blocks: [newBlock('melody')], meta: { status: 'idea' } },
      composition: { title: 'Nuevo cuaderno de composición', blocks: [], meta: { status: 'idea' } },
      study: { title: 'Nuevo cuaderno de estudio', blocks: [newBlock('map'), newBlock('tablature')] },
    };
    const plan = plans[template] ?? plans.study;
    return this.createNotebook(plan.title, plan.blocks, nodeId, songId, plan.meta);
  }

  private async createNotebook(title: string, blocks: NotebookContent['blocks'], nodeId: string | null, songId: string | null, meta?: NotebookContent['meta']) {
    const createdAt = now();
    const content: NotebookContent = { kind: 'notebook', version: 1, blocks, ...(meta ? { meta } : {}) };
    const document: MusicalDocument = {
      id: crypto.randomUUID(), nodeId, songId, type: 'tablature', title,
      content, rev: 1, createdAt, updatedAt: createdAt, ownerId: (await activeOwnerId()) ?? undefined,
    };
    await db.documents.add(document);
    return document;
  }

  /** An empty study notebook: blocks (tablature, map, text) are added from the editor. */
  async createStudyMaterial(title: string, nodeId: string | null = null, songId: string | null = null) {
    const createdAt = now();
    const content: NotebookContent = { kind: 'notebook', version: 1, blocks: [] };
    const document: MusicalDocument = {
      id: crypto.randomUUID(), nodeId, songId, type: 'tablature', title: title.trim() || 'Nuevo material de estudio',
      content, rev: 1, createdAt, updatedAt: createdAt, ownerId: (await activeOwnerId()) ?? undefined,
    };
    await db.documents.add(document);
    return document;
  }

  /**
   * Saves only what an editor owns (title and content); location, trash state and sync metadata are
   * read from the stored record so a stale open editor can never overwrite them. A recovery version of
   * the previous state is kept at most once every few minutes for autosaves, always for explicit saves.
   */
  async saveDocument(document: MusicalDocument, reason: 'autosave' | 'manual' = 'autosave') {
    await db.transaction('rw', db.documents, db.versions, async () => {
      const current = await db.documents.get(document.id);
      if (!current) throw new Error('El documento no existe.');
      const latest = (await db.versions.where('documentId').equals(document.id).sortBy('createdAt')).at(-1);
      const recent = reason === 'autosave' && latest && now() - latest.createdAt < AUTOSAVE_VERSION_INTERVAL;
      if (!recent) await db.versions.add({ id: crypto.randomUUID(), documentId: current.id, createdAt: now(), reason, title: current.title, content: structuredClone(current.content), ownerId: current.ownerId });
      await db.documents.put({ ...current, title: document.title, content: document.content, rev: current.rev + 1, updatedAt: now() });
    });
  }

  async duplicateDocument(id: string) {
    const source = await db.documents.get(id);
    if (!source) throw new Error('El documento no existe.');
    const copy = { ...source, id: crypto.randomUUID(), title: `${source.title} — copia`, rev: 1, createdAt: now(), updatedAt: now(), content: structuredClone(source.content) };
    await db.documents.add(copy);
    return copy;
  }

  async duplicateNode(id: string) {
    const source = await db.nodes.get(id);
    if (!source) throw new Error('La carpeta no existe.');
    const copy: LibraryNode = { ...source, id: crypto.randomUUID(), name: `${source.name} — copia`, createdAt: now(), updatedAt: now(), deletedAt: undefined, rev: 1 };
    await db.nodes.add(copy);
    return copy;
  }

  async moveDocument(id: string, nodeId: string | null) { const current = await db.documents.get(id); if (current) await db.documents.update(id, { nodeId, rev: current.rev + 1, updatedAt: now() }); }

  private async descendants(id: string) {
    const result: string[] = [id];
    const visit = async (parentId: string) => { const children = await db.nodes.where('parentId').equals(parentId).toArray(); for (const child of children) { result.push(child.id); await visit(child.id); } };
    await visit(id); return result;
  }

  /** Moves a folder or song. A folder can never be placed inside itself or one of its own subfolders. */
  async moveNode(id: string, parentId: string | null) {
    if (parentId && (await this.descendants(id)).includes(parentId)) throw new Error('No se puede mover una carpeta dentro de sí misma.');
    await this.updateNode(id, { parentId });
  }

  async trashDocument(id: string) { const current = await db.documents.get(id); if (current) await db.documents.update(id, { deletedAt: now(), rev: current.rev + 1, updatedAt: now() }); }
  async restoreDocument(id: string) { const current = await db.documents.get(id); if (current) await db.documents.update(id, { deletedAt: undefined, rev: current.rev + 1, updatedAt: now() }); }
  async trashNode(id: string) {
    const ids = await this.descendants(id); const time = now();
    await db.transaction('rw', db.nodes, db.documents, async () => { const nodes = await db.nodes.bulkGet(ids); await db.nodes.bulkPut(nodes.filter(Boolean).map((node) => ({ ...node!, deletedAt: time, updatedAt: time, rev: (node!.rev ?? 1) + 1 }))); const documents = await db.documents.where('nodeId').anyOf(ids).toArray(); await db.documents.bulkPut(documents.map((document) => ({ ...document, deletedAt: time, updatedAt: time, rev: document.rev + 1 }))); });
  }
  async restoreNode(id: string) {
    const ids = await this.descendants(id); const time = now();
    await db.transaction('rw', db.nodes, db.documents, async () => { const nodes = await db.nodes.bulkGet(ids); await db.nodes.bulkPut(nodes.filter(Boolean).map((node) => ({ ...node!, deletedAt: undefined, updatedAt: time, rev: (node!.rev ?? 1) + 1 }))); const documents = await db.documents.where('nodeId').anyOf(ids).toArray(); await db.documents.bulkPut(documents.map((document) => ({ ...document, deletedAt: undefined, updatedAt: time, rev: document.rev + 1 }))); });
  }

  async restoreVersion(documentId: string, versionId: string) {
    const version = await db.versions.get(versionId);
    const document = await db.documents.get(documentId);
    if (!version || !document) throw new Error('No se encontró la versión solicitada.');
    await db.transaction('rw', db.documents, db.versions, async () => {
      await db.versions.add({ id: crypto.randomUUID(), documentId, createdAt: now(), reason: 'pre-restore', title: document.title, content: structuredClone(document.content), ownerId: document.ownerId });
      await db.documents.put({ ...document, title: version.title, content: structuredClone(version.content), rev: document.rev + 1, updatedAt: now() });
    });
  }

  async exportBackup() {
    const scope = await libraryScope();
    const [nodes, documents, versions] = await Promise.all([db.nodes.toArray(), db.documents.toArray(), db.versions.toArray()]);
    return JSON.stringify({
      schema: 1,
      exportedAt: new Date().toISOString(),
      nodes: nodes.filter((item) => belongsToOwner(item, scope)),
      documents: documents.filter((item) => belongsToOwner(item, scope)),
      versions: versions.filter((item) => belongsToOwner(item, scope)),
    }, null, 2);
  }

  async importBackup(raw: string, mode: 'merge' | 'replace') {
    const candidate: unknown = JSON.parse(raw);
    if (!candidate || typeof candidate !== 'object' || !('schema' in candidate) || (candidate as { schema: unknown }).schema !== 1) throw new Error('El backup no tiene un esquema compatible.');
    const backup = candidate as { nodes?: unknown; documents?: unknown; versions?: unknown };
    if (!Array.isArray(backup.nodes) || !Array.isArray(backup.documents) || !Array.isArray(backup.versions)) throw new Error('El backup está incompleto.');
    await db.transaction('rw', db.nodes, db.documents, db.versions, async () => {
      if (mode === 'replace') { await db.nodes.clear(); await db.documents.clear(); await db.versions.clear(); }
      await db.nodes.bulkPut(backup.nodes as LibraryNode[]); await db.documents.bulkPut(backup.documents as MusicalDocument[]); await db.versions.bulkPut(backup.versions as import('@/core/model').DocumentVersion[]);
    });
  }
}

export const libraryRepository = new LibraryRepository();
