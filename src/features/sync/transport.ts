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
  constructor(private readonly url: string, private readonly accessToken: string) {}
  private async rpc<T>(method: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.url.replace(/\/$/, '')}/rest/v1/rpc/${method}`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: this.accessToken, authorization: `Bearer ${this.accessToken}` }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`Supabase ${method}: ${response.status} ${await response.text()}`);
    return response.json() as Promise<T>;
  }
  async push(ownerId: string, opId: string, documents: MusicalDocument[]) { return this.rpc<PushResult>('sync_documents', { p_owner_id: ownerId, p_op_id: opId, p_documents: documents }); }
  async pull(ownerId: string, afterUpdatedAt: number) { return this.rpc<RemoteDocument[]>('pull_documents', { p_owner_id: ownerId, p_after_updated_at: new Date(afterUpdatedAt).toISOString() }); }
}
