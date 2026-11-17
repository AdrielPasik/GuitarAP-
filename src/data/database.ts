import Dexie, { type Table } from 'dexie';
import type { AppSetting, DocumentVersion, LibraryNode, MusicalDocument, NotebookContent } from '@/core/model';

/** A document that belongs to someone else and that I may read or edit. It lives apart from my own library. */
export type SharedCopy = {
  id: string;
  title: string;
  role: 'owner' | 'editor' | 'commenter' | 'viewer';
  /** The version both sides last agreed on, and the revision it had on the server. */
  baseContent: NotebookContent;
  baseRev: number;
  /** What I have now (may include edits not yet uploaded). */
  content: NotebookContent;
  localTitle: string;
  dirty: boolean;
  updatedAt: number;
  /** The account that may use this copy: a copy never crosses accounts. */
  userId: string;
};

export class GuitarDatabase extends Dexie {
  nodes!: Table<LibraryNode, string>;
  documents!: Table<MusicalDocument, string>;
  versions!: Table<DocumentVersion, string>;
  settings!: Table<AppSetting, string>;
  shared!: Table<SharedCopy, string>;

  constructor(name = 'guitarap') {
    super(name);
    this.version(1).stores({
      nodes: 'id, parentId, kind, name, updatedAt, deletedAt, [parentId+order]',
      documents: 'id, nodeId, songId, type, title, updatedAt, deletedAt, [nodeId+updatedAt]',
      versions: 'id, documentId, createdAt, [documentId+createdAt]',
      settings: 'key, updatedAt',
    });
    this.version(2).stores({
      nodes: 'id, ownerId, parentId, kind, name, updatedAt, deletedAt, [ownerId+parentId], [ownerId+updatedAt]',
      documents: 'id, ownerId, nodeId, songId, type, title, updatedAt, deletedAt, [ownerId+nodeId], [ownerId+updatedAt]',
      versions: 'id, ownerId, documentId, createdAt, [ownerId+documentId], [ownerId+createdAt]',
      settings: 'key, updatedAt',
    });
    // Additive: copies of documents shared with this account. Nothing else changes.
    this.version(3).stores({
      nodes: 'id, ownerId, parentId, kind, name, updatedAt, deletedAt, [ownerId+parentId], [ownerId+updatedAt]',
      documents: 'id, ownerId, nodeId, songId, type, title, updatedAt, deletedAt, [ownerId+nodeId], [ownerId+updatedAt]',
      versions: 'id, ownerId, documentId, createdAt, [ownerId+documentId], [ownerId+createdAt]',
      settings: 'key, updatedAt',
      shared: 'id, userId, updatedAt',
    });
  }
}

export const db = new GuitarDatabase();
