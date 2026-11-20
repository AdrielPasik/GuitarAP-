import type { DocumentVersion, LibraryNode, MusicalDocument } from '@/core/model';
import { db } from '@/data/database';
import { activeOwnerId, libraryScope } from '@/data/library-scope';
import { decideEvent, eventKey, type EventExtension } from '@/features/sync/event-policy';
import {
  SyncTransportError,
  type ChangeEvent,
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
/** An event that cannot be applied YET because what it points to has not arrived (a folder, a song, a document). It is kept, never dropped. */
type Deferred = { kind: 'node' | 'document' | 'version'; record: unknown; since: string };
/** The download stopped here because the log holds an event this client cannot read; the cursor did not move past it. */
export type Halt = { kind: string; v?: number; cursor: string; at: number };
type State = {
  cursor: string;
  documents: Record<string, number>;
  nodes: Record<string, number>;
  versions: Record<string, true>;
  conflicts: Record<string, RemoteDocument>;
  remote?: { documents: Record<string, number>; nodes: Record<string, number> };
  pending?: { id: string; snapshot: SyncSnapshot };
  deferred?: Record<string, Deferred>;
  halted?: Halt;
};
const key = (owner: string) => `sync-state:${owner}`;
const blank = (): State => ({ cursor: '0', documents: {}, nodes: {}, versions: {}, conflicts: {} });
const get = async (owner: string) => {
  const state = ((await db.settings.get(key(owner)))?.value as State | undefined) ?? blank();
  state.remote ??= { documents: {}, nodes: {} };
  state.deferred ??= {};
  return state;
};
const save = async (owner: string, value: State) => db.settings.put({ key: key(owner), value, updatedAt: Date.now() });

/** Events this client could not understand, kept exactly as received so a later version can replay them. */
export type QuarantineEntry = { key: string; kind: string; v?: number; reason: 'unsupported' | 'invalid'; record: unknown; afterCursor: string; at: number };
export const QUARANTINE_LIMIT = 5000;
const quarantineKey = (owner: string) => `sync-quarantine:${owner}`;
export async function readQuarantine(owner: string): Promise<QuarantineEntry[]> {
  return ((await db.settings.get(quarantineKey(owner)))?.value as QuarantineEntry[] | undefined) ?? [];
}
const writeQuarantine = (owner: string, entries: QuarantineEntry[]) => db.settings.put({ key: quarantineKey(owner), value: entries, updatedAt: Date.now() });
/** Plain counts for the interface and the diagnostics: never content. */
export async function countDeferred(owner: string) {
  return Object.keys((await get(owner)).deferred ?? {}).length;
}
export async function countQuarantined(owner: string) {
  return (await readQuarantine(owner)).length;
}
export async function readHalt(owner: string) {
  return (await get(owner)).halted;
}
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
/** What a long sync tells the screen while it runs (counts only). */
export type SyncProgress = { phase: 'push' | 'pull'; pushed: number; pulled: number; pages: number };
export type SyncOptions = {
  onProgress?: (progress: SyncProgress) => void;
  /**
   * Read-only toward the server: nothing is uploaded, and a record that has changes of its own that were never uploaded
   * is left exactly as it is (counted in `held`) instead of being compared, replaced or turned into a copy.
   */
  downloadOnly?: boolean;
};
export type SyncReport = {
  /** The download reached the end of the account's log: everything the server had at that moment was received. */
  complete: boolean;
  /** Records with changes of their own that were not uploaded, left untouched by a download-only run. */
  held: number;
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
  /** The download stopped at an event this version cannot read (an update is needed). Nothing was skipped or lost. */
  halted?: { kind: string; v?: number };
  /** Changes received but waiting for the folder, song or document they belong to. */
  deferred: number;
  /** Events set aside, untouched, for a version that understands them. */
  quarantined: number;
};

type Context = { owner: string; draft: State; report: SyncReport; quarantine: QuarantineEntry[]; cursor: string; seen?: Set<string>; hold?: boolean };
const entityKey = (kind: string, record: unknown) => `${kind}:${(record as { id?: string }).id ?? '?'}`;

export class SyncEngine {
  constructor(
    private readonly transport: SyncTransport,
    private readonly maxRetries = 2,
    private readonly pageSize = 100,
    private readonly limits = LIMITS,
    /** Support for event kinds this client does not know natively (registered by later versions of the app). */
    private readonly extensions: readonly EventExtension[] = [],
  ) {}

  async sync(owner: string, options: SyncOptions = {}): Promise<SyncReport> {
    if ((await activeOwnerId()) !== owner) throw new Error('La biblioteca local no está vinculada a esta cuenta.');
    const state = await get(owner);
    const report: SyncReport = { complete: false, held: 0, pushed: 0, pulled: 0, conflicts: 0, retries: 0, offline: false, skipped: { nodes: [], documents: [], versions: [] }, requests: 0, copies: [], deferred: 0, quarantined: 0 };
    let pages = 0;
    const attempted = new Set<string>();

    for (; !options.downloadOnly; ) {
      // Another person took the screen while this sync was running: stop, nothing more leaves for this account.
      if ((await activeOwnerId()) !== owner) throw new Error('La biblioteca local no está vinculada a esta cuenta.');
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
      options.onProgress?.({ phase: 'push', pushed: report.pushed, pulled: report.pulled, pages });
    }

    try {
      let page: PullPage;
      let halted: Halt | undefined;
      do {
        page = await this.transport.pull(owner, state.cursor, this.pageSize);
        halted = (await this.apply(owner, state, page, report, Boolean(options.downloadOnly))).halted;
        pages += 1;
        options.onProgress?.({ phase: 'pull', pushed: report.pushed, pulled: report.pulled, pages });
      } while (page.hasMore && !halted);
      if (halted) report.halted = { kind: halted.kind, v: halted.v };
      else report.complete = true;
    } catch (error) {
      if (error instanceof SyncTransportError && error.retryable) report.offline = true;
      else {
        await save(owner, state);
        throw error;
      }
    }
    await save(owner, state);
    report.deferred = Object.keys(state.deferred ?? {}).length;
    report.quarantined = (await readQuarantine(owner)).length;
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

  /**
   * Applies one page of the log. The page is all-or-nothing: the library changes, the quarantine and the replication
   * state (cursor included) are written in ONE local transaction, and the in-memory state is replaced only after that
   * transaction committed. So an interruption or an error in the middle of a page can neither leave a half-applied page
   * nor make a later attempt believe that an event already arrived when it did not.
   */
  private async apply(owner: string, state: State, page: PullPage, report: SyncReport, hold = false): Promise<{ halted?: Halt }> {
    const draft: State = structuredClone(state);
    draft.deferred ??= {};
    const outcome: { halted?: Halt } = {};
    await db.transaction('rw', db.nodes, db.documents, db.versions, db.settings, async () => {
      // The page lands only if the person on screen is still the one this sync belongs to.
      if ((await libraryScope()).ownerId !== owner) throw new Error('La sesión cambió durante la sincronización: no se aplicó nada.');
      const ctx: Context = { owner, draft, report, quarantine: await readQuarantine(owner), cursor: state.cursor, hold };
      ctx.seen = new Set(ctx.quarantine.map((entry) => entry.key));
      for (const change of page.changes) {
        const decision = decideEvent(change, this.extensions);
        if (decision.action === 'halt') {
          outcome.halted = { kind: change.kind, v: change.v, cursor: state.cursor, at: Date.now() };
          break;
        }
        if (decision.action === 'quarantine') {
          if (!this.setAside(ctx, change, decision.reason)) {
            outcome.halted = { kind: change.kind, v: change.v, cursor: state.cursor, at: Date.now() };
            break;
          }
          continue;
        }
        if (decision.action === 'extension') {
          await decision.extension.apply(change.record, owner);
          report.pulled += 1;
          continue;
        }
        const key = entityKey(decision.kind, change.record);
        delete draft.deferred![key]; // a newer event about the same record replaces a waiting older one
        if (this.alreadyHave(ctx, decision.kind, change.record)) continue;
        const result = await this.applyCore(ctx, decision.kind, change.record);
        if (result === 'deferred') draft.deferred![key] = { kind: decision.kind, record: change.record, since: state.cursor };
        else if (result === 'invalid' && !this.setAside(ctx, change, 'invalid')) {
          outcome.halted = { kind: change.kind, v: change.v, cursor: state.cursor, at: Date.now() };
          break;
        }
      }
      if (outcome.halted) draft.halted = outcome.halted;
      else {
        if (Object.keys(draft.deferred!).length) await this.retryDeferred(ctx);
        draft.cursor = page.cursor;
        delete draft.halted;
      }
      await writeQuarantine(owner, ctx.quarantine);
      await save(owner, draft);
    });
    state.cursor = draft.cursor;
    state.documents = draft.documents;
    state.nodes = draft.nodes;
    state.versions = draft.versions;
    state.conflicts = draft.conflicts;
    state.remote = draft.remote;
    state.deferred = draft.deferred;
    state.halted = draft.halted;
    return outcome;
  }

  /** Keeps an event untouched in the local quarantine. Returns false when the quarantine is full (the download then stops instead of discarding). */
  private setAside(ctx: Context, change: ChangeEvent, reason: QuarantineEntry['reason']) {
    const key = eventKey(change);
    if (ctx.seen!.has(key)) return true;
    if (ctx.quarantine.length >= QUARANTINE_LIMIT) return false;
    ctx.seen!.add(key);
    ctx.quarantine.push({ key, kind: change.kind, v: change.v, reason, record: structuredClone(change.record), afterCursor: ctx.cursor, at: Date.now() });
    return true;
  }

  /** Waiting changes whose folder, song or document has arrived since: apply them, in as many passes as it takes. */
  private async retryDeferred(ctx: Context) {
    for (let progress = true; progress; ) {
      progress = false;
      for (const [key, entry] of Object.entries(ctx.draft.deferred!)) {
        const result = await this.applyCore(ctx, entry.kind, entry.record);
        if (result === 'deferred') continue;
        delete ctx.draft.deferred![key];
        progress = true;
        if (result === 'invalid') this.setAside(ctx, { kind: entry.kind, record: entry.record }, 'invalid');
      }
    }
  }

  /**
   * Synchronous: is this event something the library already has (our own echo, a replay, or a record waiting for a
   * person's decision)? It must not yield: a local transaction that awaits something other than a database request can
   * be closed by the browser, which would drop the whole page.
   */
  private alreadyHave(ctx: Context, kind: 'node' | 'document' | 'version', record: unknown): boolean {
    const { draft } = ctx;
    if (kind === 'node') {
      const x = record as LibraryNode;
      return draft.remote!.nodes[x.id] === (x.rev ?? 1) && draft.nodes[x.id] !== undefined;
    }
    if (kind === 'version') return Boolean(draft.versions[(record as DocumentVersion).id]);
    const x = record as RemoteDocument;
    if (x.id in draft.conflicts) {
      draft.conflicts[x.id] = x;
      return true;
    }
    return draft.remote!.documents[x.id] === x.rev && draft.documents[x.id] !== undefined;
  }

  /** One known event. `deferred`: what it points to is not here yet. `invalid`: it contradicts what it points to. */
  private async applyCore(ctx: Context, kind: 'node' | 'document' | 'version', record: unknown): Promise<'applied' | 'skipped' | 'deferred' | 'invalid'> {
    const { owner, draft, report } = ctx;
    if (kind === 'node') {
      const x = record as LibraryNode;
      const known = draft.remote!.nodes[x.id];
      if (known === (x.rev ?? 1) && draft.nodes[x.id] !== undefined) return 'skipped'; // echo of what this device already pushed
      if (x.parentId && !(await db.nodes.get(x.parentId))) return 'deferred';
      const current = await db.nodes.get(x.id);
      if (ctx.hold && current && current.ownerId === owner && current.rev !== (draft.nodes[x.id] ?? -1) && (current.name !== x.name || current.parentId !== x.parentId)) {
        report.held += 1; // a folder with an arrangement of its own that was never uploaded: left as it is
        return 'skipped';
      }
      if (current && current.ownerId === owner && draft.nodes[x.id] !== undefined && current.rev !== draft.nodes[x.id] && (current.name !== x.name || current.parentId !== x.parentId)) {
        // A folder renamed or moved on two devices: the server's arrangement wins (only a name/position is at stake).
        report.conflicts += 1;
      }
      await db.nodes.put({ ...x, ownerId: owner });
      draft.nodes[x.id] = x.rev ?? 1;
      draft.remote!.nodes[x.id] = x.rev ?? 1;
    } else if (kind === 'version') {
      const x = record as DocumentVersion;
      if (draft.versions[x.id]) return 'skipped';
      if (!(await db.documents.get(x.documentId))) return 'deferred';
      await db.versions.put({ ...x, ownerId: owner });
      draft.versions[x.id] = true;
    } else {
      const x = record as RemoteDocument;
      if (x.id in draft.conflicts) {
        // A person has yet to decide this one: only keep the newest cloud version for the comparison, touch nothing.
        draft.conflicts[x.id] = x;
        return 'skipped';
      }
      const knownRemote = draft.remote!.documents[x.id];
      if (knownRemote === x.rev && draft.documents[x.id] !== undefined) return 'skipped'; // echo of our own push (or a replay)
      if (x.nodeId && !(await db.nodes.get(x.nodeId))) return 'deferred';
      if (x.songId) {
        const song = await db.nodes.get(x.songId);
        if (!song) return 'deferred';
        if (song.kind !== 'song') return 'invalid';
      }
      const current = await db.documents.get(x.id);
      const known = draft.documents[x.id] ?? 0;
      if (ctx.hold && current && current.ownerId === owner && current.rev !== known && !sameDocument(current, x)) {
        ctx.report.held += 1; // changes of its own that were never uploaded: not compared, not replaced, not copied
        return 'skipped';
      }
      // Equal revision NUMBERS prove nothing (two devices that each edited once both end at the same number):
      // what decides is whether this device changed it since the last sync and whether the content differs.
      if (current && current.ownerId === owner && current.rev !== known && !sameDocument(current, x)) {
        await this.settleConflict(owner, draft, x, report);
        return 'skipped';
      }
      await db.documents.put({ ...local(x), ownerId: owner });
      draft.documents[x.id] = x.rev;
      draft.remote!.documents[x.id] = x.rev;
    }
    report.pulled += 1;
    return 'applied';
  }

  /** Replays what a past version could not read, now that this one (or an extension) can. Never discards what is still unreadable. */
  async replayQuarantine(owner: string): Promise<{ replayed: number; remaining: number }> {
    const state = await get(owner);
    const draft: State = structuredClone(state);
    draft.deferred ??= {};
    const report: SyncReport = { complete: false, held: 0, pushed: 0, pulled: 0, conflicts: 0, retries: 0, offline: false, skipped: { nodes: [], documents: [], versions: [] }, requests: 0, copies: [], deferred: 0, quarantined: 0 };
    let replayed = 0;
    let remaining = 0;
    await db.transaction('rw', db.nodes, db.documents, db.versions, db.settings, async () => {
      const entries = await readQuarantine(owner);
      const ctx: Context = { owner, draft, report, quarantine: [], cursor: state.cursor };
      ctx.seen = new Set();
      for (const entry of entries) {
        const event: ChangeEvent = { kind: entry.kind, record: entry.record, v: entry.v, required: false };
        const decision = decideEvent(event, this.extensions);
        if (decision.action === 'extension') {
          await decision.extension.apply(entry.record, owner);
          replayed += 1;
        } else if (decision.action === 'apply') {
          const result = await this.applyCore(ctx, decision.kind, entry.record);
          if (result === 'deferred') draft.deferred![entityKey(decision.kind, entry.record)] = { kind: decision.kind, record: entry.record, since: entry.afterCursor };
          if (result === 'invalid') ctx.quarantine.push(entry);
          else replayed += 1;
        } else ctx.quarantine.push(entry);
      }
      await this.retryDeferred(ctx);
      remaining = ctx.quarantine.length;
      await writeQuarantine(owner, ctx.quarantine);
      await save(owner, draft);
    });
    return { replayed, remaining };
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

  /**
   * "Rebuild from the cloud": downloads the account's whole log again from the start. It deletes nothing and overwrites
   * nothing that has not been uploaded. Two modes, and the caller must say which one the person chose:
   *   - `downloadOnly: true` — never writes to the server; records with changes of their own that were not uploaded are
   *     held exactly as they are;
   *   - otherwise — a full sync: pending local changes are sent FIRST so the server and this device agree before
   *     anything is compared (that is why it writes remotely, and why the person must confirm it).
   * Records the replication state claims to have but the library lacks are forgotten so they are fetched again, and
   * everything else is recognised as already received. Running it twice changes nothing more than running it once.
   */
  async rebuildFromCloud(owner: string, options: SyncOptions = {}): Promise<SyncReport & { refetched: number }> {
    // `options.downloadOnly` makes this a pure download: it cannot write to the server at all.
    if ((await activeOwnerId()) !== owner) throw new Error('La biblioteca local no está vinculada a esta cuenta.');
    const check = await verifyLibrary(owner);
    const state = await get(owner);
    for (const id of check.missing.nodes) {
      delete state.nodes[id];
      delete state.remote!.nodes[id];
    }
    for (const id of check.missing.documents) {
      delete state.documents[id];
      delete state.remote!.documents[id];
    }
    for (const id of check.missing.versions) delete state.versions[id];
    state.cursor = '0';
    state.deferred = {};
    delete state.halted;
    await save(owner, state);
    const report = await this.sync(owner, options);
    return { ...report, refetched: check.missing.nodes.length + check.missing.documents.length + check.missing.versions.length };
  }
}

export type LibraryCheck = {
  /** Every record the server confirmed is present locally, nothing waits, nothing is set aside. */
  ok: boolean;
  counts: { folders: number; songs: number; documents: number; trashed: number; versions: number };
  missing: { nodes: string[]; documents: string[]; versions: string[] };
  deferred: number;
  quarantined: number;
};
/**
 * Compares what the replication state says it received with what the library really holds. Counts are of the
 * account's own records only. Used to confirm a recovery for real instead of assuming it.
 */
export async function verifyLibrary(owner: string): Promise<LibraryCheck> {
  const state = await get(owner);
  const [nodes, documents, versions] = await Promise.all([
    db.nodes.where('ownerId').equals(owner).toArray(),
    db.documents.where('ownerId').equals(owner).toArray(),
    db.versions.where('ownerId').equals(owner).toArray(),
  ]);
  const have = { nodes: new Set(nodes.map((x) => x.id)), documents: new Set(documents.map((x) => x.id)), versions: new Set(versions.map((x) => x.id)) };
  const missing = {
    nodes: Object.keys(state.nodes).filter((id) => !have.nodes.has(id)),
    documents: Object.keys(state.documents).filter((id) => !have.documents.has(id)),
    versions: Object.keys(state.versions).filter((id) => !have.versions.has(id)),
  };
  const deferred = Object.keys(state.deferred ?? {}).length;
  const quarantined = (await readQuarantine(owner)).length;
  return {
    ok: !missing.nodes.length && !missing.documents.length && !missing.versions.length && !deferred && !quarantined && !state.halted,
    counts: {
      folders: nodes.filter((x) => x.kind === 'folder' && !x.deletedAt).length,
      songs: nodes.filter((x) => x.kind === 'song' && !x.deletedAt).length,
      documents: documents.filter((x) => !x.deletedAt).length,
      trashed: documents.filter((x) => x.deletedAt).length + nodes.filter((x) => x.deletedAt).length,
      versions: versions.length,
    },
    missing,
    deferred,
    quarantined,
  };
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
