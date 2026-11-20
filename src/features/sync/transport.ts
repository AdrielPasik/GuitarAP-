import type { DocumentVersion, LibraryNode, MusicalDocument } from '@/core/model';
export type RemoteDocument = MusicalDocument & { ownerId: string; lastOpId: string };
export type RemoteNode = LibraryNode & { ownerId: string; lastOpId: string };
export type RemoteVersion = DocumentVersion & { ownerId: string; lastOpId: string };
export type SyncSnapshot = {
  documents: MusicalDocument[];
  nodes: LibraryNode[];
  versions: DocumentVersion[];
};
export type PushResult = {
  documents: RemoteDocument[];
  nodes: RemoteNode[];
  versions: RemoteVersion[];
  conflicts: Array<RemoteDocument | RemoteNode>;
};
/**
 * One entry of the change log. Today the server only publishes `node`, `document` and `version`; `kind` is a plain
 * string on purpose so that a client can receive (and set aside) an event it does not know without misreading it.
 * `v` and `required` are the optional envelope of FUTURE events (see event-policy.ts); the current server sends neither.
 */
export type ChangeEvent = {
  kind: string;
  record: RemoteDocument | RemoteNode | RemoteVersion | unknown;
  v?: number;
  required?: boolean;
};
export type PullPage = {
  cursor: string;
  changes: ChangeEvent[];
  hasMore: boolean;
};
export interface SyncTransport {
  push(ownerId: string, opId: string, snapshot: SyncSnapshot): Promise<PushResult>;
  pull(ownerId: string, cursor: string, limit: number): Promise<PullPage>;
}
export type SyncErrorKind = 'network' | 'auth' | 'permission' | 'schema' | 'data' | 'conflict' | 'too-large' | 'server' | 'unknown';

/**
 * What a failed request carries, without anything private: which operation and RPC, the HTTP status, the
 * PostgreSQL/PostgREST code and a redacted, short server message. Never a token, an e-mail, or document content.
 */
export type SyncErrorDetail = {
  operation: 'push' | 'pull';
  rpc: string;
  status?: number;
  code?: string;
  message?: string;
  hint?: string;
  kind: SyncErrorKind;
};

export class SyncTransportError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
    readonly detail?: SyncErrorDetail,
  ) {
    super(message);
    this.name = 'SyncTransportError';
  }
}

/** Removes anything that could identify the person or authorise a request, and keeps the message short. */
export function redact(text: unknown, max = 240): string {
  return String(text ?? '')
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, '[token]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[correo]')
    .replace(/\b(?:sb|sk|pk)_[A-Za-z0-9_-]{16,}\b/g, '[clave]')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[secreto]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Maps a PostgREST/PostgreSQL failure to something the person can act on. */
export function classify(status: number | undefined, code: string | undefined): SyncErrorKind {
  if (status === undefined) return 'network';
  if (status === 401 || code === 'PGRST301' || code === 'PGRST303') return 'auth';
  if (status === 413) return 'too-large';
  if (code === '42501' || status === 403) return 'permission';
  if (code === 'PGRST202' || code === '42883' || code === '42P01' || code === '42703' || code === 'PGRST200' || status === 404) return 'schema';
  if (code === '40001' || code === '40P01' || code === '23505' || status === 409) return code === '23503' ? 'data' : 'conflict';
  if (code && /^(22|23)/.test(code)) return 'data';
  if (status === 400) return 'data';
  if (status === 408 || status === 429 || status >= 500) return 'server';
  return 'unknown';
}

const copy = <T>(item: T) => structuredClone(item);
export class FakeTransport implements SyncTransport {
  private documents = new Map<string, RemoteDocument>();
  private nodes = new Map<string, RemoteNode>();
  private versions = new Map<string, RemoteVersion>();
  private operations = new Map<string, PushResult>();
  private logs = new Map<string, PullPage['changes']>();
  private lost = false;
  loseNextResponse() {
    this.lost = true;
  }
  private log(
    owner: string,
    kind: PullPage['changes'][number]['kind'],
    record: PullPage['changes'][number]['record'],
  ) {
    this.logs.set(owner, [...(this.logs.get(owner) ?? []), { kind, record: copy(record) }]);
  }
  /** Test helper: puts any event (also one this client does not know) into an account's log, as a newer server could. */
  inject(owner: string, event: ChangeEvent) {
    this.logs.set(owner, [...(this.logs.get(owner) ?? []), copy(event)]);
  }
  /** Test helper: how many events the account's log holds. */
  size(owner: string) {
    return (this.logs.get(owner) ?? []).length;
  }
  async push(ownerId: string, opId: string, snapshot: SyncSnapshot) {
    const prior = this.operations.get(`${ownerId}:${opId}`);
    if (prior) return copy(prior);
    const result: PushResult = { documents: [], nodes: [], versions: [], conflicts: [] };
    // Like the real server (0006): nodes are checked in the order they arrive, so a child that comes before its
    // parent is refused. The client is responsible for sending parents first.
    for (const node of snapshot.nodes) {
      if (node.parentId && !this.nodes.has(node.parentId))
        throw new SyncTransportError('node parent does not exist in this account', false, 409, { operation: 'push', rpc: 'sync_library', status: 409, code: '23503', message: 'node parent does not exist in this account', kind: 'data' });
      const current = this.nodes.get(node.id);
      if (current && current.rev !== (node.rev ?? 1) - 1) result.conflicts.push(copy(current));
      else {
        const next = { ...copy(node), rev: node.rev ?? 1, ownerId, lastOpId: opId };
        this.nodes.set(node.id, next);
        result.nodes.push(next);
        this.log(ownerId, 'node', next);
      }
    }
    for (const document of snapshot.documents) {
      const current = this.documents.get(document.id);
      if (current && current.rev !== document.rev - 1) result.conflicts.push(copy(current));
      else {
        const next = { ...copy(document), ownerId, lastOpId: opId };
        this.documents.set(document.id, next);
        result.documents.push(next);
        this.log(ownerId, 'document', next);
      }
    }
    for (const version of snapshot.versions) {
      const current = this.versions.get(version.id);
      if (current) result.versions.push(copy(current));
      else {
        const next = { ...copy(version), ownerId, lastOpId: opId };
        this.versions.set(version.id, next);
        result.versions.push(next);
        this.log(ownerId, 'version', next);
      }
    }
    this.operations.set(`${ownerId}:${opId}`, copy(result));
    if (this.lost) {
      this.lost = false;
      throw new Error('response lost after commit');
    }
    return copy(result);
  }
  async pull(ownerId: string, cursor: string, limit: number) {
    const all = this.logs.get(ownerId) ?? [];
    const start = Number(cursor) || 0;
    const changes = all.slice(start, start + limit).map(copy);
    return {
      cursor: String(start + changes.length),
      changes,
      hasMore: start + changes.length < all.length,
    };
  }
}
export class SupabaseTransport implements SyncTransport {
  constructor(
    private readonly url: string,
    private readonly anonKey: string,
    private readonly accessToken: string,
  ) {}
  private async rpc<T>(method: string, body: unknown, operation: 'push' | 'pull'): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.url.replace(/\/$/, '')}/rest/v1/rpc/${method}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          apikey: this.anonKey,
          authorization: `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new SyncTransportError(
        'No se pudo conectar con Supabase. Los cambios permanecen guardados localmente.',
        true,
        undefined,
        { operation, rpc: method, kind: 'network' },
      );
    }
    if (!response.ok) {
      let parsed: { code?: string; message?: string; hint?: string; details?: string } = {};
      try {
        parsed = (await response.json()) as typeof parsed;
      } catch {
        /* a gateway error page: only the status is known */
      }
      const kind = classify(response.status, parsed.code);
      const retryable = kind === 'server' || (kind === 'conflict' && parsed.code === '40001');
      const detail: SyncErrorDetail = {
        operation,
        rpc: method,
        status: response.status,
        code: parsed.code ? redact(parsed.code, 16) : undefined,
        message: parsed.message ? redact([parsed.message, parsed.details].filter(Boolean).join(' · ')) : undefined,
        hint: parsed.hint ? redact(parsed.hint, 160) : undefined,
        kind,
      };
      throw new SyncTransportError(
        retryable
          ? `Supabase no está disponible temporalmente (${response.status}).`
          : `Supabase rechazó la sincronización (${response.status}${detail.code ? `, ${detail.code}` : ''}).`,
        retryable,
        response.status,
        detail,
      );
    }
    return response.json() as Promise<T>;
  }
  async push(ownerId: string, opId: string, snapshot: SyncSnapshot) {
    return this.rpc<PushResult>('sync_library', { p_owner_id: ownerId, p_op_id: opId, p_snapshot: snapshot }, 'push');
  }
  async pull(ownerId: string, cursor: string, limit: number) {
    return this.rpc<PullPage>('pull_library', { p_owner_id: ownerId, p_after: cursor, p_limit: limit }, 'pull');
  }
}
