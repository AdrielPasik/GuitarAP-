import type { DocumentType, FretboardContent, LibraryNode, MusicalDocument, NotebookContent } from '@/core/model';

export type SongTemplate = 'empty' | 'lyrics' | 'melody' | 'chords' | 'structure';
export type MaterialTemplate = 'scale' | 'triad' | 'riff' | 'empty' | 'study' | 'text' | 'melody' | 'song-lyrics' | 'song-melody' | 'chords' | 'composition';
import { createFretboardContent, createTablatureContent } from '@/core/model';
import { newBlock } from '@/core/notebook';
import { db } from '@/data/database';
import { activeOwnerId, authorize, belongsToOwner, libraryScope, mustExist } from '@/data/library-scope';

const now = () => Date.now();
/** Autosaves keep one recovery checkpoint per document at most this often. */
const AUTOSAVE_VERSION_INTERVAL = 2 * 60 * 1000;

export class LibraryRepository {
  /** A folder or song named as a place to put something must be the current owner's (or not exist at all). */
  private async checkPlace(...ids: Array<string | null | undefined>) {
    const scope = await libraryScope();
    for (const id of ids) if (id) authorize(await db.nodes.get(id), scope, 'carpeta');
  }


  async createNode(name: string, kind: LibraryNode['kind'], parentId: string | null = null) {
    await this.checkPlace(parentId);
    const createdAt = now();
    const node: LibraryNode = { id: crypto.randomUUID(), parentId, kind, name: name.trim() || 'Sin título', order: createdAt, createdAt, updatedAt: createdAt, rev: 1, ownerId: (await activeOwnerId()) ?? undefined };
    await db.nodes.add(node);
    return node;
  }

  async updateNode(id: string, change: Partial<Pick<LibraryNode, 'name' | 'parentId' | 'order' | 'song'>>) {
    const scope = await libraryScope();
    const node = authorize(await db.nodes.get(id), scope, 'carpeta'); if (!node) return;
    if (change.parentId) authorize(await db.nodes.get(change.parentId), scope, 'carpeta');
    await db.nodes.update(id, { ...change, rev: (node.rev ?? 1) + 1, updatedAt: now() });
  }

  async createDocument(type: DocumentType, title: string, nodeId: string | null = null, songId: string | null = null) {
    await this.checkPlace(nodeId, songId);
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

  /** A song from the minimal form: a name, an optional BPM and key, and how to start. Never imposes a structure. */
  async createSong(
    input: { title: string; bpm?: number; key?: { tonic: string; mode: 'major' | 'minor' }; template: SongTemplate },
    nodeId: string | null = null,
    songId: string | null = null,
  ) {
    const section = (title: string) => ({ ...newBlock('section'), title }) as NotebookContent['blocks'][number];
    let blocks: NotebookContent['blocks'] = [];
    if (input.template === 'lyrics') blocks = [newBlock('lyrics')];
    else if (input.template === 'melody') blocks = [newBlock('melody')];
    else if (input.template === 'chords') blocks = [newBlock('chords')];
    else if (input.template === 'structure') {
      const pair = (title: string) => {
        const lyrics = newBlock('lyrics');
        const melody = newBlock('melody');
        if (melody.kind === 'melody') melody.content.lyricsBlockId = lyrics.id;
        return [section(title), lyrics, melody];
      };
      blocks = [...pair('Verso 1'), ...pair('Estribillo')];
    }
    const meta: NonNullable<NotebookContent['meta']> = { status: 'idea' };
    if (input.bpm) meta.bpm = input.bpm;
    if (input.key) meta.key = input.key;
    return this.createNotebook(input.title.trim() || 'Nueva canción', blocks, nodeId, songId, meta);
  }

  private async createNotebook(title: string, blocks: NotebookContent['blocks'], nodeId: string | null, songId: string | null, meta?: NotebookContent['meta']) {
    await this.checkPlace(nodeId, songId);
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
    await this.checkPlace(nodeId, songId);
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
    await db.transaction('rw', db.documents, db.versions, db.settings, async () => {
      const current = mustExist(await db.documents.get(document.id), await libraryScope(), 'El documento no existe.');
      const latest = (await db.versions.where('documentId').equals(document.id).sortBy('createdAt')).at(-1);
      const recent = reason === 'autosave' && latest && now() - latest.createdAt < AUTOSAVE_VERSION_INTERVAL;
      if (!recent) await db.versions.add({ id: crypto.randomUUID(), documentId: current.id, createdAt: now(), reason, title: current.title, content: structuredClone(current.content), ownerId: current.ownerId });
      await db.documents.put({ ...current, title: document.title, content: document.content, rev: current.rev + 1, updatedAt: now() });
    });
  }

  async duplicateDocument(id: string) {
    const scope = await libraryScope();
    const source = mustExist(await db.documents.get(id), scope, 'El documento no existe.');
    const copy = { ...source, id: crypto.randomUUID(), title: `${source.title} — copia`, rev: 1, createdAt: now(), updatedAt: now(), content: structuredClone(source.content) };
    await db.documents.add(copy);
    return copy;
  }

  async duplicateNode(id: string) {
    const source = mustExist(await db.nodes.get(id), await libraryScope(), 'La carpeta no existe.', 'carpeta');
    const copy: LibraryNode = { ...source, id: crypto.randomUUID(), name: `${source.name} — copia`, createdAt: now(), updatedAt: now(), deletedAt: undefined, rev: 1 };
    await db.nodes.add(copy);
    return copy;
  }

  async moveDocument(id: string, nodeId: string | null) { const scope = await libraryScope(); const current = authorize(await db.documents.get(id), scope); if (nodeId) authorize(await db.nodes.get(nodeId), scope, 'carpeta'); if (current) await db.documents.update(id, { nodeId, rev: current.rev + 1, updatedAt: now() }); }

  private async descendants(id: string) {
    const result: string[] = [id];
    const scope = await libraryScope();
    authorize(await db.nodes.get(id), scope, 'carpeta');
    const visit = async (parentId: string) => { const children = (await db.nodes.where('parentId').equals(parentId).toArray()).filter((child) => belongsToOwner(child, scope)); for (const child of children) { result.push(child.id); await visit(child.id); } };
    await visit(id); return result;
  }

  /** Moves a folder or song. A folder can never be placed inside itself or one of its own subfolders. */
  async moveNode(id: string, parentId: string | null) {
    if (parentId && (await this.descendants(id)).includes(parentId)) throw new Error('No se puede mover una carpeta dentro de sí misma.');
    await this.updateNode(id, { parentId });
  }

  async trashDocument(id: string) { const current = authorize(await db.documents.get(id), await libraryScope()); if (current) await db.documents.update(id, { deletedAt: now(), rev: current.rev + 1, updatedAt: now() }); }
  async restoreDocument(id: string) { const current = authorize(await db.documents.get(id), await libraryScope()); if (current) await db.documents.update(id, { deletedAt: undefined, rev: current.rev + 1, updatedAt: now() }); }
  async trashNode(id: string) {
    const scope = await libraryScope();
    const ids = await this.descendants(id); const time = now();
    await db.transaction('rw', db.nodes, db.documents, async () => { const nodes = await db.nodes.bulkGet(ids); await db.nodes.bulkPut(nodes.filter(Boolean).map((node) => ({ ...node!, deletedAt: time, updatedAt: time, rev: (node!.rev ?? 1) + 1 }))); const documents = (await db.documents.where('nodeId').anyOf(ids).toArray()).filter((document) => belongsToOwner(document, scope)); await db.documents.bulkPut(documents.map((document) => ({ ...document, deletedAt: time, updatedAt: time, rev: document.rev + 1 }))); });
  }
  async restoreNode(id: string) {
    const scope = await libraryScope();
    const ids = await this.descendants(id); const time = now();
    await db.transaction('rw', db.nodes, db.documents, async () => { const nodes = await db.nodes.bulkGet(ids); await db.nodes.bulkPut(nodes.filter(Boolean).map((node) => ({ ...node!, deletedAt: undefined, updatedAt: time, rev: (node!.rev ?? 1) + 1 }))); const documents = (await db.documents.where('nodeId').anyOf(ids).toArray()).filter((document) => belongsToOwner(document, scope)); await db.documents.bulkPut(documents.map((document) => ({ ...document, deletedAt: undefined, updatedAt: time, rev: document.rev + 1 }))); });
  }

  async restoreVersion(documentId: string, versionId: string) {
    const scope = await libraryScope();
    const version = authorize(await db.versions.get(versionId), scope, 'historial');
    const document = authorize(await db.documents.get(documentId), scope);
    if (!version || !document || version.documentId !== documentId) throw new Error('No se encontró la versión solicitada.');
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

  /**
   * Brings the records of a backup into the library on screen. It can never touch another account's records: an id that
   * already exists for someone else is refused, and records that name a different owner are refused unless the caller
   * says they are to be taken as copies of the current owner (a person's explicit decision).
   * `replace` replaces ONLY what the current owner can see.
   */
  async importBackup(raw: string, mode: 'merge' | 'replace', options: { asCopies?: boolean } = {}) {
    const candidate: unknown = JSON.parse(raw);
    if (!candidate || typeof candidate !== 'object' || !('schema' in candidate) || (candidate as { schema: unknown }).schema !== 1) throw new Error('El backup no tiene un esquema compatible.');
    const backup = candidate as { nodes?: unknown; documents?: unknown; versions?: unknown };
    if (!Array.isArray(backup.nodes) || !Array.isArray(backup.documents) || !Array.isArray(backup.versions)) throw new Error('El backup está incompleto.');
    const scope = await libraryScope();
    const mine = (item: { ownerId?: string }) => !item.ownerId || belongsToOwner(item, scope);
    const nodes = backup.nodes as LibraryNode[];
    const documents = backup.documents as MusicalDocument[];
    const versions = backup.versions as import('@/core/model').DocumentVersion[];
    const foreign = [...nodes, ...documents, ...versions].filter((item) => !mine(item)).length;
    if (foreign && !options.asCopies) throw new Error(`Este backup pertenece a otra cuenta (${foreign} elementos). No se importó nada.`);
    // With copies, ids are renewed so that nothing of the backup can collide with (or replace) a record of anyone.
    const ids = new Map<string, string>();
    const renew = (id: string) => ids.get(id) ?? ids.set(id, crypto.randomUUID()).get(id)!;
    const stamp = <T extends { ownerId?: string }>(item: T): T => ({ ...item, ownerId: scope.ownerId ?? undefined });
    const take = <T extends { id: string; ownerId?: string }>(items: T[]) => items.map((item) => (mine(item) ? stamp(item) : stamp({ ...item, id: renew(item.id) })));
    const incoming = {
      nodes: take(nodes).map((item) => ({ ...item, parentId: item.parentId && ids.has(item.parentId) ? ids.get(item.parentId)! : item.parentId })),
      documents: take(documents).map((item) => ({ ...item, nodeId: item.nodeId && ids.has(item.nodeId) ? ids.get(item.nodeId)! : item.nodeId, songId: item.songId && ids.has(item.songId) ? ids.get(item.songId)! : item.songId })),
      versions: take(versions).map((item) => ({ ...item, documentId: ids.has(item.documentId) ? ids.get(item.documentId)! : item.documentId })),
    };
    await db.transaction('rw', db.nodes, db.documents, db.versions, async () => {
      const clash = async (table: 'nodes' | 'documents' | 'versions', rows: Array<{ id: string }>) => {
        const existing = (await db[table].bulkGet(rows.map((row) => row.id))) as Array<{ ownerId?: string } | undefined>;
        if (existing.some((row) => row && !belongsToOwner(row, scope))) throw new Error('El backup contiene identificadores que pertenecen a otra cuenta. No se importó nada.');
      };
      await clash('nodes', incoming.nodes); await clash('documents', incoming.documents); await clash('versions', incoming.versions);
      if (mode === 'replace') {
        const owned = <T extends { id: string; ownerId?: string }>(rows: T[]) => rows.filter((row) => belongsToOwner(row, scope)).map((row) => row.id);
        await db.nodes.bulkDelete(owned(await db.nodes.toArray())); await db.documents.bulkDelete(owned(await db.documents.toArray())); await db.versions.bulkDelete(owned(await db.versions.toArray()));
      }
      await db.nodes.bulkPut(incoming.nodes); await db.documents.bulkPut(incoming.documents); await db.versions.bulkPut(incoming.versions);
    });
  }
}

export const libraryRepository = new LibraryRepository();
