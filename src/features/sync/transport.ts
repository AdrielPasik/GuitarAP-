import type { MusicalDocument } from '@/core/model';

export type RemoteDocument = MusicalDocument & { ownerId: string; lastOpId: string };
export type PushResult = { applied: RemoteDocument[]; conflicts: RemoteDocument[] };
export interface SyncTransport { push(ownerId: string, opId: string, documents: MusicalDocument[]): Promise<PushResult>; pull(ownerId: string, afterRev: number): Promise<RemoteDocument[]>; }

export class FakeTransport implements SyncTransport {
  private documents = new Map<string, RemoteDocument>(); private operations = new Map<string, PushResult>();
  async push(ownerId: string, opId: string, documents: MusicalDocument[]): Promise<PushResult> {
    const cached = this.operations.get(`${ownerId}:${opId}`); if (cached) return structuredClone(cached);
    const applied: RemoteDocument[] = []; const conflicts: RemoteDocument[] = [];
    for (const document of documents) { const current = this.documents.get(document.id); if (current && current.rev !== document.rev - 1) { conflicts.push(structuredClone(current)); continue; } const next = { ...structuredClone(document), ownerId, lastOpId: opId }; this.documents.set(document.id, next); applied.push(next); }
    const result = { applied, conflicts }; this.operations.set(`${ownerId}:${opId}`, structuredClone(result)); return result;
  }
  async pull(ownerId: string, afterRev: number) { return [...this.documents.values()].filter((item) => item.ownerId === ownerId && item.rev > afterRev).map((item) => structuredClone(item)); }
}
