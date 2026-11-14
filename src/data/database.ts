import Dexie, { type Table } from 'dexie';
import type { AppSetting, DocumentVersion, LibraryNode, MusicalDocument } from '@/core/model';

export class GuitarDatabase extends Dexie {
  nodes!: Table<LibraryNode, string>;
  documents!: Table<MusicalDocument, string>;
  versions!: Table<DocumentVersion, string>;
  settings!: Table<AppSetting, string>;

  constructor(name = 'guitarap') {
    super(name);
    this.version(1).stores({
      nodes: 'id, parentId, kind, name, updatedAt, deletedAt, [parentId+order]',
      documents: 'id, nodeId, songId, type, title, updatedAt, deletedAt, [nodeId+updatedAt]',
      versions: 'id, documentId, createdAt, [documentId+createdAt]',
      settings: 'key, updatedAt',
    });
  }
}

export const db = new GuitarDatabase();
