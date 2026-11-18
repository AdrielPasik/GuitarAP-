import type { NotebookContent, NoteComment } from '@/core/model';
import { configuredSupabase, type SupabaseSession } from '@/features/sync/supabase-auth';

/**
 * The browser side of sharing. It only ever talks to the project's database functions (migration 0007) with the
 * public anon key and, when signed in, the user's own session token. There is no admin key and no secret here:
 * every permission decision is made by the database, and these helpers only translate its answers.
 */
export type Role = 'editor' | 'commenter' | 'viewer';
export type ResourceKind = 'document' | 'node';
export type CollabFailure = 'unavailable' | 'offline' | 'forbidden' | 'signed-out' | 'invalid' | 'other';

export class CollabError extends Error {
  constructor(
    message: string,
    readonly failure: CollabFailure,
  ) {
    super(message);
    this.name = 'CollabError';
  }
}

export type Gateway = { url: string; anonKey: string; accessToken?: string };

export function gatewayFor(session?: SupabaseSession | null): Gateway | null {
  const config = configuredSupabase();
  if (!config) return null;
  return { url: config.url, anonKey: config.anonKey, accessToken: session?.accessToken };
}

const WORDS: Record<CollabFailure, string> = {
  unavailable: 'Compartir todavía no está activado en tu proyecto de Supabase.',
  offline: 'No hay conexión. Probá de nuevo cuando vuelva Internet.',
  forbidden: 'No tenés permiso para hacer eso (o ese acceso ya no existe).',
  'signed-out': 'Iniciá sesión para continuar.',
  invalid: 'Revisá los datos: el servicio los rechazó.',
  other: 'No se pudo completar la operación. Probá de nuevo.',
};

export async function rpc<T>(gateway: Gateway, name: string, args: Record<string, unknown> = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${gateway.url}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: gateway.anonKey,
        authorization: `Bearer ${gateway.accessToken ?? gateway.anonKey}`,
        // Shared reads must never be cached by an intermediary.
        'cache-control': 'no-store',
      },
      body: JSON.stringify(args),
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    throw new CollabError(WORDS.offline, 'offline');
  }
  if (response.ok) {
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
  let code = '';
  let detail = '';
  try {
    const body = (await response.json()) as { code?: string; message?: string };
    code = body.code ?? '';
    detail = body.message ?? '';
  } catch {
    /* no JSON body */
  }
  if (response.status === 404 || code === 'PGRST202' || code === '42883') throw new CollabError(WORDS.unavailable, 'unavailable');
  if (response.status === 401 || code === '28000') throw new CollabError(WORDS['signed-out'], 'signed-out');
  if (code === '42501' || response.status === 403 || /permission denied|forbidden/i.test(detail)) throw new CollabError(WORDS.forbidden, 'forbidden');
  if (code === '22023' || response.status === 400) throw new CollabError(detail && !/[A-Z]{2,}\d/.test(detail) ? humanize(detail) : WORDS.invalid, 'invalid');
  throw new CollabError(WORDS.other, 'other');
}

function humanize(detail: string) {
  if (/password too short/.test(detail)) return 'La contraseña debe tener al menos 8 caracteres.';
  if (/expiry must be in the future/.test(detail)) return 'La fecha de vencimiento debe ser futura.';
  if (/invalid comment/.test(detail)) return 'El comentario está vacío o es demasiado largo.';
  if (/invalid content/.test(detail)) return 'El contenido no es válido o es demasiado grande.';
  return WORDS.invalid;
}

/** Cheap probe with no side effects: is sharing installed in this project? */
export async function probeCapabilities(gateway: Gateway): Promise<'ready' | 'unavailable' | 'offline'> {
  try {
    await rpc(gateway, 'collab_capabilities');
    return 'ready';
  } catch (error) {
    return error instanceof CollabError && error.failure === 'offline' ? 'offline' : 'unavailable';
  }
}

export type LinkInfo = { id: string; hasPassword: boolean; expiresAt: string | null; revokedAt: string | null; allowExport: boolean; createdAt: string; openCount: number; lastOpenedAt: string | null; locked: boolean };
export type InviteInfo = { id: string; role: Role; expiresAt: string; acceptedAt: string | null; revokedAt: string | null; createdAt: string };
export type MemberInfo = { id: string; role: Role; label: string; createdAt: string; revokedAt: string | null };
export type Overview = { links: LinkInfo[]; invites: InviteInfo[]; members: MemberInfo[] };
export type ActivityEntry = { id: number; action: string; detail: Record<string, unknown>; createdAt: string; actor: 'owner' | 'me' | string | null };
export type SharedDocument = { id: string; title: string; type: string; content: unknown; rev: number; updatedAt: number; role: 'owner' | Role };

export const collabApi = {
  overview: (g: Gateway, kind: ResourceKind, id: string) => rpc<Overview>(g, 'share_overview', { p_kind: kind, p_id: id }),
  previewScope: (g: Gateway, kind: ResourceKind, id: string) => rpc<{ documents: Array<{ id: string; title: string }> }>(g, 'share_preview_scope', { p_kind: kind, p_id: id }),
  createLink: (g: Gateway, kind: ResourceKind, id: string, options: { password?: string; expiresAt?: string; allowExport?: boolean }) =>
    rpc<{ id: string; token: string }>(g, 'share_create_link', { p_kind: kind, p_id: id, p_password: options.password ?? null, p_expires: options.expiresAt ?? null, p_allow_export: options.allowExport ?? false }),
  revokeLink: (g: Gateway, linkId: string) => rpc<void>(g, 'share_revoke_link', { p_link_id: linkId }),
  createInvite: (g: Gateway, kind: ResourceKind, id: string, role: Role) => rpc<{ id: string; token: string }>(g, 'share_create_invite', { p_kind: kind, p_id: id, p_role: role }),
  revokeInvite: (g: Gateway, inviteId: string) => rpc<void>(g, 'share_revoke_invite', { p_invite_id: inviteId }),
  setRole: (g: Gateway, memberId: string, role: Role) => rpc<void>(g, 'share_set_role', { p_member_id: memberId, p_role: role }),
  revokeMember: (g: Gateway, memberId: string) => rpc<void>(g, 'share_revoke_member', { p_member_id: memberId }),
  activity: (g: Gateway, kind: ResourceKind, id: string) => rpc<ActivityEntry[]>(g, 'collab_activity', { p_kind: kind, p_id: id, p_limit: 60 }),
  acceptInvite: (g: Gateway, token: string, label: string) =>
    rpc<{ ok: boolean; reason?: string; kind?: ResourceKind; id?: string; role?: Role; title?: string }>(g, 'share_accept_invite', { p_token: token, p_label: label }),
  sharedByMe: (g: Gateway) => rpc<Array<{ kind: ResourceKind; id: string; links: number; members: number; invites: number }>>(g, 'shared_by_me'),
  sharedWithMe: (g: Gateway) =>
    rpc<{ documents: Array<{ id: string; title: string; role: Role; updatedAt: string; project?: { id: string; name: string; kind: 'song' | 'folder' } | null }>; folders: Array<{ id: string; name: string; role: Role; kind?: 'song' | 'folder' }> }>(g, 'shared_with_me'),
  pull: (g: Gateway, documentId: string) => rpc<SharedDocument>(g, 'collab_pull_document', { p_doc: documentId }),
  save: (g: Gateway, documentId: string, baseRev: number, title: string, content: NotebookContent, opId: string) =>
    rpc<{ conflict: false; rev: number; updatedAt: number } | { conflict: true; current: { title: string; content: unknown; rev: number; updatedAt: number } }>(g, 'collab_save_document', {
      p_doc: documentId, p_base_rev: baseRev, p_title: title, p_content: content, p_op_id: opId,
    }),
  comment: (g: Gateway, documentId: string, comment: NoteComment) => rpc<{ rev: number }>(g, 'collab_add_comment', { p_doc: documentId, p_comment: comment }),
  // Anonymous gateway
  linkInfo: (g: Gateway, token: string) =>
    rpc<{ valid: boolean; reason?: 'invalid' | 'revoked' | 'expired' | 'gone'; requiresPassword?: boolean; kind?: ResourceKind; title?: string; locked?: boolean }>(g, 'share_link_info', { p_token: token }),
  unlock: (g: Gateway, token: string, password: string) =>
    rpc<{ ok: boolean; reason?: 'invalid' | 'locked' | 'wrong_password'; session?: string | null; retryAfterSeconds?: number }>(g, 'share_unlock', { p_token: token, p_password: password }),
  read: (g: Gateway, token: string, session: string | null) =>
    rpc<{ ok: boolean; reason?: string; kind?: ResourceKind; title?: string; allowExport?: boolean; documents?: Array<{ id: string; title: string; type: string; content: unknown }> }>(g, 'share_read', { p_token: token, p_session: session }),
};

/** Links shown once are remembered on this device only, so the owner can copy them again from here. */
const KNOWN = 'guitarap.share-urls';
export function rememberUrl(id: string, url: string) {
  try {
    const all = JSON.parse(window.localStorage.getItem(KNOWN) ?? '{}') as Record<string, string>;
    all[id] = url;
    window.localStorage.setItem(KNOWN, JSON.stringify(all));
  } catch {
    /* storage unavailable */
  }
}
export function knownUrl(id: string): string | null {
  try {
    return (JSON.parse(window.localStorage.getItem(KNOWN) ?? '{}') as Record<string, string>)[id] ?? null;
  } catch {
    return null;
  }
}
export const guestUrl = (token: string) => `${window.location.origin}/c/${token}`;
export const inviteUrl = (token: string) => `${window.location.origin}/invitacion/${token}`;
