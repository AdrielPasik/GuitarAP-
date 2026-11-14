import type { MusicalDocument } from '@/core/model';
import { db } from '@/data/database';
import type { RemoteDocument, SyncTransport } from '@/features/sync/transport';

type SyncState = { cursor: number; revisions: Record<string, number>; conflicts: Record<string, RemoteDocument> };
const stateKey = (ownerId: string) => `sync-state:${ownerId}`;
const initialState = (): SyncState => ({ cursor: 0, revisions: {}, conflicts: {} });
function local(remote: RemoteDocument): MusicalDocument { const { ownerId, lastOpId, ...document } = remote; void ownerId; void lastOpId; return document; }
async function getState(ownerId: string) { return ((await db.settings.get(stateKey(ownerId)))?.value as SyncState | undefined) ?? initialState(); }
async function saveState(ownerId: string, state: SyncState) { await db.settings.put({ key: stateKey(ownerId), value: state, updatedAt: Date.now() }); }

export type SyncReport = { pushed: number; pulled: number; conflicts: number; retries: number; offline: boolean };
export class SyncEngine {
  constructor(private readonly transport: SyncTransport, private readonly maxRetries = 2) {}
  async sync(ownerId: string): Promise<SyncReport> {
    const state = await getState(ownerId); const report: SyncReport = { pushed: 0, pulled: 0, conflicts: 0, retries: 0, offline: false };
    const pending = (await db.documents.toArray()).filter((document) => state.revisions[document.id] !== document.rev);
    if (pending.length) {
      let failed = false;
      for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) try {
        const result = await this.transport.push(ownerId, crypto.randomUUID(), pending);
        result.applied.forEach((document) => { state.revisions[document.id] = document.rev; }); result.conflicts.forEach((document) => { state.conflicts[document.id] = document; });
        report.pushed = result.applied.length; report.conflicts += result.conflicts.length; failed = false; break;
      } catch { failed = true; report.retries += 1; }
      if (failed) { await saveState(ownerId, state); return { ...report, offline: true }; }
    }
    try {
      const remote = await this.transport.pull(ownerId, state.cursor);
      await db.transaction('rw', db.documents, async () => { for (const incoming of remote) { const current = await db.documents.get(incoming.id); const known = state.revisions[incoming.id] ?? 0; if (current && current.rev !== known && current.rev !== incoming.rev) { state.conflicts[incoming.id] = incoming; report.conflicts += 1; continue; } await db.documents.put(local(incoming)); state.revisions[incoming.id] = incoming.rev; report.pulled += 1; } });
      state.cursor = Math.max(state.cursor, ...remote.map((document) => document.updatedAt));
    } catch { report.offline = true; }
    await saveState(ownerId, state); return report;
  }
  async conflicts(ownerId: string) { return (await getState(ownerId)).conflicts; }
  async acceptRemote(ownerId: string, documentId: string) { const state = await getState(ownerId); const remote = state.conflicts[documentId]; if (!remote) return; await db.documents.put(local(remote)); state.revisions[documentId] = remote.rev; delete state.conflicts[documentId]; await saveState(ownerId, state); }
}
