import type { DocumentType, FretboardContent, LibraryNode, MusicalDocument, NotebookContent } from '@/core/model';

export type SongTemplate = 'empty' | 'lyrics' | 'melody' | 'chords' | 'structure';
export type MaterialTemplate = 'scale' | 'triad' | 'riff' | 'empty' | 'study' | 'text' | 'melody' | 'song-lyrics' | 'song-melody' | 'chords' | 'composition';
import { createFretboardContent, createTablatureContent } from '@/core/model';
import { newBlock } from '@/core/notebook';
import { db } from '@/data/database';
import { deleteDraft, deleteDraftsOf, draftsOf, writeDraft } from '@/data/drafts';
import { AccessError, activeOwnerId, authorize, belongsToOwner, libraryScope, mustExist } from '@/data/library-scope';

const now = () => Date.now();

/**
 * Proof that an editor was opened, by a person who was allowed to, for ONE document of ONE owner. Issued only by
 * `openForEdit` and recognised only if this module issued it. It lets the editor finish saving what the person typed
 * even if the person on screen changes in the meantime (sign-out in another tab, switching account): the edit goes into
 * the record of the owner who was typing, never anywhere else, and it is not visible to anyone else.
 */
export type EditTicket = { readonly documentId: string; readonly ownerId: string | null };
const issued = new WeakSet<object>();
export type SaveOutcome = 'saved' | 'draft';
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

  /** The only way to get a ticket: the document must be the current owner's right now. */
  async openForEdit(document: Pick<MusicalDocument, 'id'>): Promise<EditTicket> {
    const current = mustExist(await db.documents.get(document.id), await libraryScope(), 'El documento no existe.');
    const ticket: EditTicket = Object.freeze({ documentId: current.id, ownerId: current.ownerId ?? null });
    issued.add(ticket);
    return ticket;
  }

  /**
   * Saves what an editor holds, on behalf of the owner named by its ticket. The record is written only if it still
   * exists and still belongs to that owner; otherwise (or if the database refuses) the edit is kept as a draft of that
   * owner and the caller is told, so nothing the interface accepted is ever dropped.
   */
  async saveEdit(
    ticket: EditTicket,
    document: Pick<MusicalDocument, 'id' | 'title' | 'content'>,
    reason: 'autosave' | 'manual' = 'autosave',
    options: { expectedRev?: number; onRev?: (rev: number) => void } = {},
  ): Promise<SaveOutcome> {
    if (!issued.has(ticket) || ticket.documentId !== document.id) throw new AccessError();
    const keep = async (why: 'missing' | 'other-owner' | 'write-failed', baseRev: number | null) => {
      await writeDraft({ documentId: document.id, ownerId: ticket.ownerId, title: document.title, content: structuredClone(document.content), baseRev, savedAt: now(), reason: why });
      return 'draft' as const;
    };
    try {
      return await db.transaction('rw', db.documents, db.versions, db.settings, async () => {
        const current = await db.documents.get(document.id);
        if (!current) return keep('missing', null);
        if ((current.ownerId ?? null) !== ticket.ownerId) return keep('other-owner', current.rev);
        const latest = (await db.versions.where('documentId').equals(document.id).sortBy('createdAt')).at(-1);
        // Somebody else (another tab, another device's sync) changed the document since this editor last saved it: what is
        // there now is kept in the history whatever the throttle says, so a save can never silently replace it.
        const changedUnderneath = options.expectedRev !== undefined && current.rev !== options.expectedRev;
        const recent = !changedUnderneath && reason === 'autosave' && latest && now() - latest.createdAt < AUTOSAVE_VERSION_INTERVAL;
        if (!recent) await db.versions.add({ id: crypto.randomUUID(), documentId: current.id, createdAt: now(), reason, title: current.title, content: structuredClone(current.content), ownerId: current.ownerId });
        await db.documents.put({ ...current, title: document.title, content: document.content, rev: current.rev + 1, updatedAt: now() });
        await deleteDraft(ticket.ownerId, document.id); // what this tab saved now supersedes ITS older draft
        options.onRev?.(current.rev + 1);
        return 'saved' as const;
      });
    } catch {
      return keep('write-failed', null);
    }
  }

  /**
   * The owner's decision about the drafts of a document (there may be one per tab). NOTHING is thrown away either way:
   * every draft goes into the document's history first; «apply» then also makes the newest one the document, after a
   * recovery point of what is there now.
   */
  async resolveDrafts(documentId: string, choice: 'apply' | 'keep-in-history') {
    const scope = await libraryScope();
    await db.transaction('rw', db.documents, db.versions, db.settings, async () => {
      const current = mustExist(await db.documents.get(documentId), scope, 'El documento no existe.');
      const drafts = await draftsOf(documentId, scope);
      if (!drafts.length) return;
      const newest = drafts.at(-1)!;
      for (const draft of drafts) {
        const label = draft === newest && choice === 'apply' ? 'borrador recuperado' : 'borrador guardado';
        await db.versions.add({ id: crypto.randomUUID(), documentId, createdAt: draft.savedAt, reason: 'manual', title: `${draft.title} (${label})`, content: structuredClone(draft.content as MusicalDocument['content']), ownerId: current.ownerId });
      }
      if (choice === 'apply') {
        await db.versions.add({ id: crypto.randomUUID(), documentId, createdAt: now(), reason: 'manual', title: current.title, content: structuredClone(current.content), ownerId: current.ownerId });
        await db.documents.put({ ...current, title: newest.title, content: structuredClone(newest.content as MusicalDocument['content']), rev: current.rev + 1, updatedAt: now() });
      }
      await deleteDraftsOf(current.ownerId ?? null, documentId);
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

  /** `anonymous`: the copy of what this device holds that belongs to no account (the one offered before adopting it). */
  async exportBackup(options: { anonymous?: boolean } = {}) {
    const scope = options.anonymous ? { ownerId: null, locked: false } : await libraryScope();
    const [nodes, documents, versions] = await Promise.all([db.nodes.toArray(), db.documents.toArray(), db.versions.toArray()]);
    return JSON.stringify({
      schema: 1,
      exportedAt: new Date().toISOString(),
      nodes: nodes.filter((item) => belongsToOwner(item, scope)),
      documents: documents.filter((item) => belongsToOwner(item, scope)),
      versions: versions.filter((item) => belongsToOwner(item, scope)),
    }, null, 2);
  }

  // Importing a backup is NOT a repository operation: it lives in data/backup-import.ts, which can only add records.
}

export const libraryRepository = new LibraryRepository();
