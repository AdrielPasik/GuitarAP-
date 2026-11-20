import type { DocumentVersion, LibraryNode, MusicalDocument } from '@/core/model';
import { belongsToOwner, type Scope } from '@/data/library-scope';
import type { BackupDocument, BackupNode, BackupVersion, ParsedBackup } from '@/features/backup/backup-schema';
import { canonicalJson, fingerprint } from '@/features/sync/event-policy';

/**
 * What importing a backup would do, worked out WITHOUT writing anything (the "simulation"), and the exact records the
 * import would add if the person confirms. The rules, in order of importance:
 *
 *  1. An import only ADDS. It never replaces, edits or deletes a record that exists; there is no mode that does.
 *  2. A record whose id already exists and is identical is skipped. If it exists and differs, the current one stays and
 *     the backup's version comes in as a clearly named COPY. Timestamps never decide anything on their own.
 *  3. A backup of ANOTHER account never touches this account's records and carries nothing that points back to the
 *     original account: every record gets a new, deterministic id (so importing the same file twice adds nothing the
 *     second time), this account as owner, and its relations rebuilt among the new ids.
 *  4. A reference that points outside the file is not followed: the record lands at the top level instead.
 */
export type LocalSnapshot = { nodes: LibraryNode[]; documents: MusicalDocument[]; versions: DocumentVersion[] };
export type DerivedIds = {
  /** The id a record gets when it must not keep its own (another account's, or an id that belongs to someone else here). */
  foreign: (table: 'node' | 'document' | 'version', sourceId: string) => string;
  /** The id of the copy of a document that differs from the one already here (depends on what it contains). */
  copyOfDocument: (sourceId: string) => string;
  /** The id of a version that is attached to such a copy. */
  copyOfVersion: (sourceId: string) => string;
};

export type Counts = { folders: number; songs: number; documents: number; versions: number };
export type ImportSummary = {
  inFile: Counts;
  /** Would be added as they are. */
  added: Counts;
  /** Already here and identical: skipped. */
  identical: Counts;
  /** Exist here but differ: the current ones stay; these come in as copies. */
  copies: { documents: number; /** of those, the ones that look older than what is here (by revision or date; informational) */ lookOlder: number };
  /** Folders and songs that already exist here (kept as they are, the file's contents are placed inside them). */
  existingFolders: number;
  invalid: number;
  /** Records whose folder or song is not in the file (or would loop): placed at the top level. */
  relocated: number;
  /** Records that will actually be written. */
  willWrite: number;
};
export type ImportPlan = {
  owner: string | null;
  /** Some record belongs to an account other than the one on screen. */
  foreign: boolean;
  summary: ImportSummary;
  writes: { nodes: LibraryNode[]; documents: MusicalDocument[]; versions: DocumentVersion[] };
  /** A fingerprint of everything the import would do: the apply step refuses to run if it is not the one that was confirmed. */
  key: string;
};

const sameDocument = (a: Pick<MusicalDocument, 'title' | 'content'>, b: Pick<BackupDocument, 'title' | 'content'>) => a.title === b.title && canonicalJson(a.content) === canonicalJson(b.content);
const dayOf = (exportedAt: string | undefined) => {
  const time = exportedAt ? Date.parse(exportedAt) : NaN;
  return Number.isFinite(time) ? new Date(time).toLocaleDateString('es-AR', { timeZone: 'UTC' }) : undefined;
};

export function planImport(parsed: ParsedBackup, local: LocalSnapshot, scope: Pick<Scope, 'ownerId' | 'locked'>, ids: DerivedIds, now: number): ImportPlan {
  const owner = scope.ownerId;
  const stamp = owner ?? undefined;
  const allNodes = new Map(local.nodes.map((item) => [item.id, item]));
  const allDocs = new Map(local.documents.map((item) => [item.id, item]));
  const allVersions = new Set(local.versions.map((item) => item.id));
  const isForeign = (record: { ownerId?: string }) => Boolean(record.ownerId) && record.ownerId !== owner;
  const theirs = <T extends { ownerId?: string }>(item: T | undefined) => (item && belongsToOwner(item, scope) ? item : undefined);

  const summary: ImportSummary = {
    inFile: { folders: 0, songs: 0, documents: parsed.documents.length, versions: parsed.versions.length },
    added: { folders: 0, songs: 0, documents: 0, versions: 0 },
    identical: { folders: 0, songs: 0, documents: 0, versions: 0 },
    copies: { documents: 0, lookOlder: 0 },
    existingFolders: 0,
    invalid: parsed.invalidTotal,
    relocated: 0,
    willWrite: 0,
  };
  for (const item of parsed.nodes) summary.inFile[item.kind === 'folder' ? 'folders' : 'songs'] += 1;
  let foreign = false;

  /* ---- folders and songs: id decides where each one lands ---- */
  const nodeTarget = new Map<string, { id: string; fresh: boolean }>();
  const sourceNodes = new Map(parsed.nodes.map((item) => [item.id, item]));
  for (const item of parsed.nodes) {
    const outsider = isForeign(item);
    foreign ||= outsider;
    const here = allNodes.get(item.id);
    if (!outsider && theirs(here)) {
      nodeTarget.set(item.id, { id: item.id, fresh: false }); // the folder is already here: kept as it is
      summary.existingFolders += 1;
    } else {
      // Another account's record, or an id that exists here but belongs to someone else: a new id of its own.
      const id = outsider || here ? ids.foreign('node', item.id) : item.id;
      const existing = allNodes.get(id);
      nodeTarget.set(item.id, { id, fresh: !existing });
      if (existing) summary.existingFolders += 1;
    }
  }
  // Where each new folder goes, following only references that exist in the file and never looping.
  const parentOf = (item: BackupNode): string | null => {
    if (item.parentId === null) return null;
    const target = nodeTarget.get(item.parentId);
    if (!target) {
      summary.relocated += 1;
      return null;
    }
    const seen = new Set([item.id]);
    for (let cursor = sourceNodes.get(item.parentId); cursor; cursor = cursor.parentId ? sourceNodes.get(cursor.parentId) : undefined) {
      if (seen.has(cursor.id)) {
        summary.relocated += 1; // a loop of folders inside folders: this one goes to the top
        return null;
      }
      seen.add(cursor.id);
    }
    return target.id;
  };
  const nodeWrites: LibraryNode[] = [];
  for (const item of parsed.nodes) {
    const target = nodeTarget.get(item.id)!;
    if (!target.fresh) {
      if (allNodes.has(target.id)) summary.identical[item.kind === 'folder' ? 'folders' : 'songs'] += 1;
      continue;
    }
    summary.added[item.kind === 'folder' ? 'folders' : 'songs'] += 1;
    nodeWrites.push({ id: target.id, parentId: parentOf(item), kind: item.kind, name: item.name, order: item.order, createdAt: item.createdAt, updatedAt: item.updatedAt, rev: 1, ...(item.deletedAt ? { deletedAt: item.deletedAt } : {}), ...(item.song ? { song: item.song } : {}), ...(stamp ? { ownerId: stamp } : {}) });
  }
  const placeOf = (sourceId: string | null, wantSong = false) => {
    if (!sourceId) return null;
    const target = nodeTarget.get(sourceId);
    const source = sourceNodes.get(sourceId);
    if (!target || !source || (wantSong && source.kind !== 'song')) {
      summary.relocated += 1;
      return null;
    }
    return target.id;
  };

  /* ---- documents ---- */
  const docTarget = new Map<string, { id: string; action: 'new' | 'identical' | 'copy' }>();
  const docWrites: MusicalDocument[] = [];
  const labelDay = dayOf(parsed.exportedAt);
  for (const item of parsed.documents) {
    const outsider = isForeign(item);
    foreign ||= outsider;
    const mine = outsider ? undefined : theirs(allDocs.get(item.id));
    const taken = allDocs.has(item.id);
    let id = item.id;
    let action: 'new' | 'identical' | 'copy' = 'new';
    let title = item.title;
    if (outsider || (taken && !mine)) {
      id = ids.foreign('document', item.id); // someone else's, or an id that is not ours here: a new identity
      const existing = allDocs.get(id);
      if (existing) action = sameDocument(existing, item) ? 'identical' : 'copy';
    } else if (mine) {
      if (sameDocument(mine, item)) action = 'identical';
      else {
        action = 'copy';
        id = ids.copyOfDocument(item.id);
        if (allDocs.has(id)) action = 'identical'; // this very copy was imported before
        else if (mine.updatedAt > item.updatedAt || mine.rev > item.rev) summary.copies.lookOlder += 1;
      }
    }
    if (action === 'copy') {
      title = `${item.title || 'Sin título'} (copia importada${labelDay ? ` del ${labelDay}` : ''})`;
      summary.copies.documents += 1;
    }
    docTarget.set(item.id, { id, action });
    if (action === 'identical') {
      summary.identical.documents += 1;
      continue;
    }
    if (action === 'new') summary.added.documents += 1;
    docWrites.push({
      id, nodeId: placeOf(item.nodeId), songId: placeOf(item.songId, true), type: item.type, title, content: structuredClone(item.content) as MusicalDocument['content'],
      rev: 1, createdAt: item.createdAt, updatedAt: action === 'copy' ? now : item.updatedAt, ...(item.deletedAt ? { deletedAt: item.deletedAt } : {}), ...(stamp ? { ownerId: stamp } : {}),
    });
  }

  /* ---- versions: attached to the document they describe (or to its copy) ---- */
  const versionWrites: DocumentVersion[] = [];
  const attach = (version: BackupVersion) => {
    const target = docTarget.get(version.documentId);
    if (target) return { documentId: target.id, copied: target.action === 'copy' || (target.action === 'new' && target.id !== version.documentId) };
    const here = theirs(allDocs.get(version.documentId));
    return here && !isForeign(version) ? { documentId: here.id, copied: false } : undefined; // a version of a document that is already here but not in the file
  };
  for (const item of parsed.versions) {
    const outsider = isForeign(item);
    foreign ||= outsider;
    const where = attach(item);
    if (!where) {
      summary.invalid += 1;
      continue;
    }
    const copied = where.copied || outsider;
    const id = copied ? ids.copyOfVersion(item.id) : item.id;
    if (allVersions.has(id)) {
      summary.identical.versions += 1;
      continue;
    }
    summary.added.versions += 1;
    versionWrites.push({ id, documentId: where.documentId, createdAt: item.createdAt, reason: item.reason as DocumentVersion['reason'], title: item.title, content: structuredClone(item.content) as DocumentVersion['content'], ...(stamp ? { ownerId: stamp } : {}) });
  }

  summary.willWrite = nodeWrites.length + docWrites.length + versionWrites.length;
  const writes = { nodes: nodeWrites, documents: docWrites, versions: versionWrites };
  const key = fingerprint(canonicalJson({ owner, summary, nodes: nodeWrites.map((x) => [x.id, x.parentId]), documents: docWrites.map((x) => [x.id, x.nodeId, x.songId]), versions: versionWrites.map((x) => [x.id, x.documentId]) }));
  return { owner, foreign, summary, writes, key };
}
