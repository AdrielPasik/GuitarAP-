import type { MusicalDocument } from '@/core/model';

export type RemoteDocument = MusicalDocument & { ownerId: string; lastOpId: string };
export type PushResult = { applied: RemoteDocument[]; conflicts: RemoteDocument[] };
export interface SyncTransport { push(ownerId: string, opId: string, documents: MusicalDocument[]): Promise<PushResult>; pull(ownerId: string, afterUpdatedAt: number): Promise<RemoteDocument[]>; }

export class FakeTransport implements SyncTransport {
  private documents = new Map<string, RemoteDocument>(); private operations = new Map<string, PushResult>();
  async push(ownerId: string, opId: string, documents: MusicalDocument[]): Promise<PushResult> {
    const cached = this.operations.get(`${ownerId}:${opId}`); if (cached) return structuredClone(cached);
    const applied: RemoteDocument[] = []; const conflicts: RemoteDocument[] = [];
    for (const document of documents) {
      const current = this.documents.get(document.id);
      if (current && current.rev !== document.rev - 1) { conflicts.push(structuredClone(current)); continue; }
      const next = { ...structuredClone(document), ownerId, lastOpId: opId };
      this.documents.set(document.id, next); applied.push(next);
    }
    const result = { applied, conflicts }; this.operations.set(`${ownerId}:${opId}`, structuredClone(result)); return result;
  }
  async pull(ownerId: string, afterUpdatedAt: number) { return [...this.documents.values()].filter((item) => item.ownerId === ownerId && item.updatedAt > afterUpdatedAt).map((item) => structuredClone(item)); }
}

/** Browser transport for the SQL RPC shipped in supabase/migrations/0002_sync.sql. */
export class SupabaseTransport implements SyncTransport {
  constructor(private readonly url: string, private readonly anonKey: string, private readonly accessToken: string) {}
  private async rpc<T>(method: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.url.replace(/\/$/, '')}/rest/v1/rpc/${method}`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: this.anonKey, authorization: `Bearer ${this.accessToken}` }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`Supabase ${method}: ${response.status} ${await response.text()}`);
    return response.json() as Promise<T>;
  }
  async push(ownerId: string, opId: string, documents: MusicalDocument[]) { const result = await this.rpc<{ applied: unknown[]; conflicts: unknown[] }>('sync_documents', { p_owner_id: ownerId, p_op_id: opId, p_documents: documents }); return { applied: result.applied.map(remoteDocument), conflicts: result.conflicts.map(remoteDocument) }; }
  async pull(ownerId: string, afterUpdatedAt: number) { return (await this.rpc<unknown[]>('pull_documents', { p_owner_id: ownerId, p_after_updated_at: new Date(afterUpdatedAt).toISOString() })).map(remoteDocument); }
}

function epoch(value: unknown) { if (typeof value === 'number') return value; const parsed = Date.parse(String(value)); return Number.isFinite(parsed) ? parsed : 0; }
function remoteDocument(value: unknown): RemoteDocument {
  const item = value as Record<string, unknown>; const payload = (item.content ?? item.payload) as MusicalDocument['content'];
  return { id: String(item.id), nodeId: item.nodeId === undefined ? (item.node_id === undefined ? null : String(item.node_id)) : item.nodeId as string | null, songId: item.songId === undefined ? (item.song_id === undefined ? null : String(item.song_id)) : item.songId as string | null, type: item.type as MusicalDocument['type'], title: String(item.title), content: payload, rev: Number(item.rev), createdAt: epoch(item.createdAt ?? item.created_at), updatedAt: epoch(item.updatedAt ?? item.updated_at), deletedAt: item.deletedAt ?? item.deleted_at ? epoch(item.deletedAt ?? item.deleted_at) : undefined, ownerId: String(item.ownerId ?? item.owner_id), lastOpId: String(item.lastOpId ?? item.last_op_id ?? '') };
}
