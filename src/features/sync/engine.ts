import type { DocumentVersion, LibraryNode, MusicalDocument } from '@/core/model';
import { db } from '@/data/database';
import { activeOwnerId } from '@/data/library-scope';
import {
  SyncTransportError,
  type PullPage,
  type RemoteDocument,
  type SyncSnapshot,
  type SyncTransport,
} from '@/features/sync/transport';
type State = {
  cursor: string;
  documents: Record<string, number>;
  nodes: Record<string, number>;
  versions: Record<string, true>;
  conflicts: Record<string, RemoteDocument>;
  pending?: { id: string; snapshot: SyncSnapshot };
};
const key = (owner: string) => `sync-state:${owner}`;
const blank = (): State => ({ cursor: '0', documents: {}, nodes: {}, versions: {}, conflicts: {} });
const get = async (owner: string) =>
  ((await db.settings.get(key(owner)))?.value as State | undefined) ?? blank();
const save = async (owner: string, value: State) =>
  db.settings.put({ key: key(owner), value, updatedAt: Date.now() });
const local = (item: RemoteDocument): MusicalDocument => {
  const { ownerId, lastOpId, ...document } = item;
  void ownerId;
  void lastOpId;
  return document;
};
export type SyncReport = {
  pushed: number;
  pulled: number;
  conflicts: number;
  retries: number;
  offline: boolean;
};
export class SyncEngine {
  constructor(
    private readonly transport: SyncTransport,
    private readonly maxRetries = 2,
    private readonly pageSize = 100,
  ) {}
  async sync(owner: string): Promise<SyncReport> {
    if ((await activeOwnerId()) !== owner)
      throw new Error('La biblioteca local no está vinculada a esta cuenta.');
    const state = await get(owner);
    const report: SyncReport = { pushed: 0, pulled: 0, conflicts: 0, retries: 0, offline: false };
    if (!state.pending)
      state.pending = { id: crypto.randomUUID(), snapshot: await this.pending(owner, state) };
    if (Object.values(state.pending.snapshot).some((items) => items.length)) {
      let result;
      for (let attempt = 0; attempt <= this.maxRetries; attempt += 1)
        try {
          result = await this.transport.push(owner, state.pending.id, state.pending.snapshot);
          break;
        } catch (error) {
          if (error instanceof SyncTransportError && !error.retryable) {
            await save(owner, state);
            throw error;
          }
          report.retries += 1;
        }
      if (!result) {
        await save(owner, state);
        return { ...report, offline: true };
      }
      result.documents.forEach((x) => {
        state.documents[x.id] = x.rev;
      });
      result.nodes.forEach((x) => {
        state.nodes[x.id] = x.rev ?? 1;
      });
      result.versions.forEach((x) => {
        state.versions[x.id] = true;
      });
      result.conflicts.forEach((x) => {
        if ('type' in x) state.conflicts[x.id] = x;
      });
      report.pushed = result.documents.length + result.nodes.length + result.versions.length;
      report.conflicts = result.conflicts.length;
      state.pending = undefined;
    } else state.pending = undefined;
    try {
      let page: PullPage;
      do {
        page = await this.transport.pull(owner, state.cursor, this.pageSize);
        await this.apply(owner, state, page, report);
      } while (page.hasMore);
    } catch (error) {
      if (error instanceof SyncTransportError && error.retryable) report.offline = true;
      else {
        await save(owner, state);
        throw error;
      }
    }
    await save(owner, state);
    return report;
  }
  private async pending(owner: string, state: State): Promise<SyncSnapshot> {
    const [documents, nodes, versions] = await Promise.all([
      db.documents.where('ownerId').equals(owner).toArray(),
      db.nodes.where('ownerId').equals(owner).toArray(),
      db.versions.where('ownerId').equals(owner).toArray(),
    ]);
    return {
      documents: documents.filter((x) => state.documents[x.id] !== x.rev),
      nodes: nodes.filter((x) => state.nodes[x.id] !== (x.rev ?? 1)),
      versions: versions.filter((x) => !state.versions[x.id]),
    };
  }
  private async apply(owner: string, state: State, page: PullPage, report: SyncReport) {
    await db.transaction('rw', db.nodes, db.documents, db.versions, async () => {
      for (const change of page.changes) {
        if (change.kind === 'node') {
          const x = change.record as LibraryNode;
          if (x.parentId && !(await db.nodes.get(x.parentId)))
            throw new Error(`El cambio remoto ${x.id} apunta a una carpeta inexistente.`);
          await db.nodes.put({ ...x, ownerId: owner });
          state.nodes[x.id] = x.rev ?? 1;
        } else if (change.kind === 'version') {
          const x = change.record as DocumentVersion;
          if (!(await db.documents.get(x.documentId)))
            throw new Error(`La versión remota ${x.id} apunta a un documento inexistente.`);
          await db.versions.put({ ...x, ownerId: owner });
          state.versions[x.id] = true;
        } else {
          const x = change.record as RemoteDocument;
          if (x.nodeId && !(await db.nodes.get(x.nodeId)))
            throw new Error(`El documento remoto ${x.id} apunta a una carpeta inexistente.`);
          if (x.songId) {
            const song = await db.nodes.get(x.songId);
            if (!song || song.kind !== 'song')
              throw new Error(`El documento remoto ${x.id} apunta a una canción inexistente.`);
          }
          const current = await db.documents.get(x.id);
          const known = state.documents[x.id] ?? 0;
          if (
            current &&
            current.ownerId === owner &&
            current.rev !== known &&
            current.rev !== x.rev
          ) {
            state.conflicts[x.id] = x;
            report.conflicts += 1;
            continue;
          }
          await db.documents.put({ ...local(x), ownerId: owner });
          state.documents[x.id] = x.rev;
        }
        report.pulled += 1;
      }
      state.cursor = page.cursor;
    });
  }
  async conflicts(owner: string) {
    return (await get(owner)).conflicts;
  }
}
