// FROZEN COPY of src/features/sync/engine.ts exactly as shipped in commit 23e1e22 (v0.7.0). It exists only so that tests can
// run the previous client against the same log as the current one. Do not edit, do not import it from the app.
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

/**
 * Per-account replication state, stored locally next to the library.
 *
 * Revisions. The local `rev` goes up by one on EVERY save (autosave included), while the server accepts a write only
 * when its stored revision is exactly the one this device last saw (compare-and-swap: stored = sent - 1). So the
 * engine keeps two numbers per record: `documents[id]` is the LOCAL revision the server confirmed (what is pending is
 * whatever differs from it), and `remote.documents[id]` is the SERVER revision. A push sends `remote + 1`, however many
 * times the person saved in between, so several edits between two syncs are one clean update, never a false conflict.
 */
type State = {
  cursor: string;
  documents: Record<string, number>;
  nodes: Record<string, number>;
  versions: Record<string, true>;
  conflicts: Record<string, RemoteDocument>;
  remote?: { documents: Record<string, number>; nodes: Record<string, number> };
  pending?: { id: string; snapshot: SyncSnapshot };
};
const key = (owner: string) => `sync-state:${owner}`;
const blank = (): State => ({ cursor: '0', documents: {}, nodes: {}, versions: {}, conflicts: {} });
const get = async (owner: string) => {
  const state = ((await db.settings.get(key(owner)))?.value as State | undefined) ?? blank();
  state.remote ??= { documents: {}, nodes: {} };
  return state;
};
const save = async (owner: string, value: State) => db.settings.put({ key: key(owner), value, updatedAt: Date.now() });
const local = (item: RemoteDocument): MusicalDocument => {
  const { ownerId, lastOpId, ...document } = item;
  void ownerId;
  void lastOpId;
  return document;
};

/** Parents before children, so the server never receives a folder whose parent it has not stored yet. */
export function sortNodes<T extends { id: string; parentId: string | null; order?: number }>(nodes: T[]): T[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const depth = new Map<string, number>();
  const depthOf = (node: T, trail = new Set<string>()): number => {
    const known = depth.get(node.id);
    if (known !== undefined) return known;
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    // A parent that is not part of this batch is already on the server (or reported separately): depth 0.
    const value = !parent || trail.has(node.id) ? 0 : depthOf(parent, new Set(trail).add(node.id)) + 1;
    depth.set(node.id, value);
    return value;
  };
  return [...nodes].sort((a, b) => depthOf(a) - depthOf(b) || (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
}

/** Key-order independent text of a JSON value (PostgreSQL's jsonb does not keep key order). */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
const sameDocument = (a: Pick<MusicalDocument, 'title' | 'content' | 'nodeId' | 'songId' | 'deletedAt'>, b: Pick<MusicalDocument, 'title' | 'content' | 'nodeId' | 'songId' | 'deletedAt'>) =>
  a.title === b.title && (a.nodeId ?? null) === (b.nodeId ?? null) && (a.songId ?? null) === (b.songId ?? null) && !a.deletedAt === !b.deletedAt && canonical(a.content) === canonical(b.content);

export type Skipped = { nodes: string[]; documents: string[]; versions: string[] };

/**
 * Splits what is pending into requests small enough for the API gateway and the statement timeout: folders first
 * (parents before children), then documents, then history. One oversized document still travels alone.
 */
export const LIMITS = { nodes: 200, documents: 40, bytes: 900_000, versions: 60 };
export function splitSnapshot(snapshot: SyncSnapshot, limits = LIMITS): SyncSnapshot[] {
  const chunks: SyncSnapshot[] = [];
  const nodes = sortNodes(snapshot.nodes);
  for (let i = 0; i < nodes.length; i += limits.nodes) chunks.push({ nodes: nodes.slice(i, i + limits.nodes), documents: [], versions: [] });
  const fill = <T,>(items: T[], max: number, put: (batch: T[]) => SyncSnapshot) => {
    let batch: T[] = [];
    let bytes = 0;
    for (const item of items) {
      const size = JSON.stringify(item).length;
      if (batch.length && (batch.length >= max || bytes + size > limits.bytes)) {
        chunks.push(put(batch));
        batch = [];
        bytes = 0;
      }
      batch.push(item);
      bytes += size;
    }
    if (batch.length) chunks.push(put(batch));
  };
  fill(snapshot.documents, limits.documents, (batch) => ({ nodes: [], documents: batch, versions: [] }));
  fill(snapshot.versions, limits.versions, (batch) => ({ nodes: [], documents: [], versions: batch }));
  return chunks;
}

async function pendingSnapshot(owner: string, state: State, exclude: ReadonlySet<string> = new Set()): Promise<{ snapshot: SyncSnapshot; skipped: Skipped }> {
  const [documents, nodes, versions] = await Promise.all([
    db.documents.where('ownerId').equals(owner).toArray(),
    db.nodes.where('ownerId').equals(owner).toArray(),
    db.versions.where('ownerId').equals(owner).toArray(),
  ]);
  const localNodes = new Set(nodes.map((node) => node.id));
  const knownNode = (id: string | null | undefined) => !id || localNodes.has(id) || id in state.nodes;
  const skipped: Skipped = { nodes: [], documents: [], versions: [] };
  const free = (id: string) => !exclude.has(id) && !(id in state.conflicts);
  const snapshot: SyncSnapshot = {
    nodes: nodes.filter((x) => free(x.id) && state.nodes[x.id] !== (x.rev ?? 1)).filter((x) => (knownNode(x.parentId) ? true : (skipped.nodes.push(x.id), false))),
    documents: documents
      .filter((x) => free(x.id) && state.documents[x.id] !== x.rev)
      .filter((x) => (knownNode(x.nodeId) && knownNode(x.songId) ? true : (skipped.documents.push(x.id), false))),
    versions: versions
      .filter((x) => !state.versions[x.id] && !exclude.has(x.id))
      .filter((x) => (x.documentId in state.documents || documents.some((d) => d.id === x.documentId) ? true : (skipped.versions.push(x.id), false))),
  };
  return { snapshot, skipped };
}
/** What would travel to the server on the next sync, as a request-sized list (and what cannot travel and why). */
export async function planPush(owner: string) {
  const state = await get(owner);
  const { snapshot, skipped } = await pendingSnapshot(owner, state);
  return { snapshot, skipped, requests: splitSnapshot(snapshot).length };
}

/** Number of local changes (documents, folders) not yet confirmed by the server. History versions are not counted. */
export async function countPending(owner: string) {
  const { snapshot } = await pendingSnapshot(owner, await get(owner));
  return snapshot.documents.length + snapshot.nodes.length;
}
/** What the server has confirmed, in plain counts: never guessed (everything not confirmed counts as not confirmed). */
export async function syncSummary(owner: string) {
  const state = await get(owner);
  const { snapshot, skipped } = await pendingSnapshot(owner, state);
  const [documents, nodes] = await Promise.all([db.documents.where('ownerId').equals(owner).count(), db.nodes.where('ownerId').equals(owner).count()]);
  const pendingDocuments = snapshot.documents.length;
  return {
    documents, nodes,
    documentsConfirmed: Math.max(0, documents - pendingDocuments - skipped.documents.length - Object.keys(state.conflicts).length),
    pendingDocuments, pendingNodes: snapshot.nodes.length,
    conflicts: Object.keys(state.conflicts).length,
    skipped: skipped.nodes.length + skipped.documents.length + skipped.versions.length,
  };
}
/** Conflicts kept locally for manual review. */
export async function countConflicts(owner: string) {
  return Object.keys((await get(owner)).conflicts).length;
}
export type SyncReport = {
  pushed: number;
  pulled: number;
  conflicts: number;
  retries: number;
  offline: boolean;
  /** Local records that cannot be uploaded (they point to a folder/song that does not exist locally). Never silently dropped. */
  skipped: Skipped;
  requests: number;
  /** Documents edited on two devices: the server's version was kept and this device's version was saved as a copy. */
  copies: Array<{ id: string; title: string }>;
};

export class SyncEngine {
  constructor(
    private readonly transport: SyncTransport,
    private readonly maxRetries = 2,
    private readonly pageSize = 100,
    private readonly limits = LIMITS,
  ) {}

  async sync(owner: string): Promise<SyncReport> {
    if ((await activeOwnerId()) !== owner) throw new Error('La biblioteca local no está vinculada a esta cuenta.');
    const state = await get(owner);
    const report: SyncReport = { pushed: 0, pulled: 0, conflicts: 0, retries: 0, offline: false, skipped: { nodes: [], documents: [], versions: [] }, requests: 0, copies: [] };
    const attempted = new Set<string>();

    for (;;) {
      if (!state.pending) {
        const { snapshot, skipped } = await pendingSnapshot(owner, state, attempted);
        report.skipped = skipped;
        const [first] = splitSnapshot(snapshot, this.limits);
        if (!first) break;
        // Saved BEFORE sending: if the response is lost the same operation id is replayed and the server answers
        // from its record instead of applying the batch twice.
        state.pending = { id: crypto.randomUUID(), snapshot: first };
        await save(owner, state);
      } else {
        // A batch saved by an older client may be mis-ordered; the order is part of what the server needs.
        state.pending.snapshot = { ...state.pending.snapshot, nodes: sortNodes(state.pending.snapshot.nodes) };
      }
      const batch = state.pending;
      let result;
      for (let attempt = 0; attempt <= this.maxRetries; attempt += 1)
        try {
          result = await this.transport.push(owner, batch.id, this.withBaseRevisions(batch.snapshot, state));
          break;
        } catch (error) {
          if (error instanceof SyncTransportError && !error.retryable) {
            // The server refused this batch for good (it did not apply it). Keeping it would replay the very same
            // refusal forever, even after the cause is fixed: drop it so the next attempt is rebuilt from the library.
            state.pending = undefined;
            await save(owner, state);
            throw error;
          }
          report.retries += 1;
        }
      if (!result) {
        await save(owner, state);
        return { ...report, offline: true };
      }
      report.requests += 1;
      for (const x of result.documents) {
        const sent = batch.snapshot.documents.find((item) => item.id === x.id);
        state.documents[x.id] = sent?.rev ?? x.rev;
        state.remote!.documents[x.id] = x.rev;
      }
      for (const x of result.nodes) {
        const sent = batch.snapshot.nodes.find((item) => item.id === x.id);
        state.nodes[x.id] = sent?.rev ?? x.rev ?? 1;
        state.remote!.nodes[x.id] = x.rev ?? 1;
      }
      result.versions.forEach((x) => {
        state.versions[x.id] = true;
      });
      for (const x of result.conflicts) {
        if ('type' in x) await this.settleConflict(owner, state, x as RemoteDocument, report);
        else await this.adoptRemoteNode(owner, state, x as LibraryNode);
      }
      report.pushed += result.documents.length + result.nodes.length + result.versions.length;
      report.conflicts += result.conflicts.length;
      for (const item of [...batch.snapshot.nodes, ...batch.snapshot.documents, ...batch.snapshot.versions]) attempted.add(item.id);
      state.pending = undefined;
      await save(owner, state);
    }

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

  /** The record as the server must receive it: its revision is the server's revision + 1 (see State). */
  private withBaseRevisions(snapshot: SyncSnapshot, state: State): SyncSnapshot {
    const nodeRemote = (id: string) => state.remote?.nodes[id] ?? state.nodes[id];
    const documentRemote = (id: string) => state.remote?.documents[id] ?? state.documents[id];
    return {
      nodes: snapshot.nodes.map((node) => (nodeRemote(node.id) === undefined ? node : { ...node, rev: nodeRemote(node.id)! + 1 })),
      documents: snapshot.documents.map((doc) => (documentRemote(doc.id) === undefined ? doc : { ...doc, rev: documentRemote(doc.id)! + 1 })),
      versions: snapshot.versions,
    };
  }

  private async apply(owner: string, state: State, page: PullPage, report: SyncReport) {
    await db.transaction('rw', db.nodes, db.documents, db.versions, async () => {
      for (const change of page.changes) {
        if (change.kind === 'node') {
          const x = change.record as LibraryNode;
          const known = state.remote!.nodes[x.id];
          if (known === (x.rev ?? 1) && state.nodes[x.id] !== undefined) continue; // echo of what this device already pushed
          if (x.parentId && !(await db.nodes.get(x.parentId))) throw new Error(`El cambio remoto ${x.id} apunta a una carpeta inexistente.`);
          const current = await db.nodes.get(x.id);
          if (current && current.ownerId === owner && state.nodes[x.id] !== undefined && current.rev !== state.nodes[x.id] && (current.name !== x.name || current.parentId !== x.parentId)) {
            // A folder renamed or moved on two devices: the server's arrangement wins (only a name/position is at stake).
            report.conflicts += 1;
          }
          await db.nodes.put({ ...x, ownerId: owner });
          state.nodes[x.id] = x.rev ?? 1;
          state.remote!.nodes[x.id] = x.rev ?? 1;
        } else if (change.kind === 'version') {
          const x = change.record as DocumentVersion;
          if (!(await db.documents.get(x.documentId))) throw new Error(`La versión remota ${x.id} apunta a un documento inexistente.`);
          if (state.versions[x.id]) continue;
          await db.versions.put({ ...x, ownerId: owner });
          state.versions[x.id] = true;
        } else {
          const x = change.record as RemoteDocument;
          if (x.id in state.conflicts) {
            // A person has yet to decide this one: only keep the newest cloud version for the comparison, touch nothing.
            state.conflicts[x.id] = x;
            continue;
          }
          const knownRemote = state.remote!.documents[x.id];
          if (knownRemote === x.rev && state.documents[x.id] !== undefined) continue; // echo of our own push (or a replay)
          if (x.nodeId && !(await db.nodes.get(x.nodeId))) throw new Error(`El documento remoto ${x.id} apunta a una carpeta inexistente.`);
          if (x.songId) {
            const song = await db.nodes.get(x.songId);
            if (!song || song.kind !== 'song') throw new Error(`El documento remoto ${x.id} apunta a una canción inexistente.`);
          }
          const current = await db.documents.get(x.id);
          const known = state.documents[x.id] ?? 0;
          // Equal revision NUMBERS prove nothing (two devices that each edited once both end at the same number):
          // what decides is whether this device changed it since the last sync and whether the content differs.
          if (current && current.ownerId === owner && current.rev !== known && !sameDocument(current, x)) {
            await this.settleConflict(owner, state, x, report);
            continue;
          }
          await db.documents.put({ ...local(x), ownerId: owner });
          state.documents[x.id] = x.rev;
          state.remote!.documents[x.id] = x.rev;
        }
        report.pulled += 1;
      }
      state.cursor = page.cursor;
    });
  }
  /**
   * The same document changed on two devices. Nothing is lost and nothing stays stuck: the server's version becomes
   * the document (it is the one already shared), and this device's version is saved next to it as a visible copy that
   * syncs like any other document.
   */
  private async settleConflict(owner: string, state: State, remote: RemoteDocument, report: SyncReport) {
    await db.transaction('rw', db.documents, async () => {
      const mine = await db.documents.get(remote.id);
      if (mine && mine.ownerId === owner && !sameDocument(mine, remote)) {
        const now = Date.now();
        const copy: MusicalDocument = {
          id: crypto.randomUUID(), nodeId: mine.nodeId, songId: mine.songId, type: mine.type,
          title: `${mine.title || 'Sin título'} (copia de este dispositivo)`, content: structuredClone(mine.content),
          rev: 1, createdAt: now, updatedAt: now, ownerId: owner,
        };
        await db.documents.add(copy);
        report.copies.push({ id: copy.id, title: copy.title });
      }
      await db.documents.put({ ...local(remote), ownerId: owner });
    });
    state.documents[remote.id] = remote.rev;
    state.remote!.documents[remote.id] = remote.rev;
    delete state.conflicts[remote.id];
    report.conflicts += 0;
  }

  private async adoptRemoteNode(owner: string, state: State, remote: LibraryNode) {
    await db.nodes.put({ ...remote, ownerId: owner });
    state.nodes[remote.id] = remote.rev ?? 1;
    state.remote!.nodes[remote.id] = remote.rev ?? 1;
  }

  async conflicts(owner: string) {
    return (await get(owner)).conflicts;
  }
}

/* ------------------------------------------------------------------------------------------------------------------
 * Conflicts that need a person. A conflict reaches this list only when a version of a document was kept aside by the
 * sync (older clients stored it; nothing here is ever resolved automatically). Every way out first leaves a recovery
 * point in the document's history, and none deletes the other version: it is copied, kept in history, or both.
 * ------------------------------------------------------------------------------------------------------------------ */
export type ConflictItem = { id: string; local?: MusicalDocument; remote: RemoteDocument };
export type ConflictChoice =
  | { kind: 'keep-both' }
  | { kind: 'use-cloud'; alsoCopyMine?: boolean }
  | { kind: 'use-device' }
  | { kind: 'merged'; title: string; content: MusicalDocument['content'] };

export async function listConflicts(owner: string): Promise<ConflictItem[]> {
  const state = await get(owner);
  const items: ConflictItem[] = [];
  for (const [id, remote] of Object.entries(state.conflicts)) items.push({ id, remote, local: await db.documents.get(id) });
  return items.sort((a, b) => (b.local?.updatedAt ?? 0) - (a.local?.updatedAt ?? 0));
}

export async function resolveConflict(owner: string, id: string, choice: ConflictChoice): Promise<{ copyId?: string }> {
  if ((await activeOwnerId()) !== owner) throw new Error('La biblioteca local no está vinculada a esta cuenta.');
  const state = await get(owner);
  const remote = state.conflicts[id];
  if (!remote) return {};
  let copyId: string | undefined;
  let hadLocal = false;
  await db.transaction('rw', db.documents, db.versions, db.nodes, async () => {
    const mine = await db.documents.get(id);
    hadLocal = Boolean(mine);
    const now = Date.now();
    const checkpoint = (doc: Pick<MusicalDocument, 'title' | 'content'>, reason: 'conflict-device' | 'conflict-cloud') =>
      db.versions.add({ id: crypto.randomUUID(), documentId: id, createdAt: now, reason, title: doc.title, content: structuredClone(doc.content), ownerId: owner });
    const copyOf = async (doc: Pick<MusicalDocument, 'title' | 'content' | 'nodeId' | 'songId' | 'type'>, label: string) => {
      const nodeOk = async (nodeId?: string | null) => (nodeId && (await db.nodes.get(nodeId)) ? nodeId : null);
      const copy: MusicalDocument = {
        id: crypto.randomUUID(), nodeId: await nodeOk(doc.nodeId ?? mine?.nodeId), songId: await nodeOk(doc.songId ?? mine?.songId), type: doc.type,
        title: `${doc.title || 'Sin título'} (${label})`, content: structuredClone(doc.content), rev: 1, createdAt: now, updatedAt: now, ownerId: owner,
      };
      await db.documents.add(copy);
      copyId = copy.id;
    };
    if (!mine) {
      await db.documents.put({ ...local(remote), ownerId: owner }); // nothing local to protect: simply bring the cloud version
    } else if (choice.kind === 'keep-both') {
      await checkpoint(mine, 'conflict-device');
      await copyOf(remote, 'versión de la nube');
    } else if (choice.kind === 'use-cloud') {
      await checkpoint(mine, 'conflict-device');
      if (choice.alsoCopyMine !== false) await copyOf(mine, 'versión de este dispositivo');
      await db.documents.put({ ...local(remote), ownerId: owner });
    } else if (choice.kind === 'use-device') {
      await checkpoint(remote, 'conflict-cloud'); // the cloud version stays in this document's history
    } else {
      await checkpoint(mine, 'conflict-device');
      await checkpoint(remote, 'conflict-cloud');
      await db.documents.put({ ...mine, title: choice.title, content: choice.content, rev: mine.rev + 1, updatedAt: now });
    }
  });
  // From here on the cloud's revision is the base. What stays on this device (keep both, use the device version, a
  // merge) is sent as the next update; if the cloud version won, there is nothing pending for this document.
  state.remote!.documents[id] = remote.rev;
  state.documents[id] = hadLocal && choice.kind !== 'use-cloud' ? -1 : remote.rev;
  delete state.conflicts[id];
  await save(owner, state);
  return { copyId };
}
