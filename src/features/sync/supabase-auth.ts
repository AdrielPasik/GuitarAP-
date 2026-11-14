export type SupabaseConfig = { url: string; anonKey: string };
export type SupabaseSession = { accessToken: string; refreshToken: string; expiresAt: number; user: { id: string; email?: string } };

const sessionKey = 'guitarap:supabase-session';

export function configuredSupabase(): SupabaseConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  return url && anonKey ? { url: url.replace(/\/$/, ''), anonKey } : null;
}

function persist(session: SupabaseSession | null) {
  if (session) window.localStorage.setItem(sessionKey, JSON.stringify(session));
  else window.localStorage.removeItem(sessionKey);
}

function toSession(payload: Record<string, unknown>): SupabaseSession {
  const user = payload.user as { id?: unknown; email?: unknown } | undefined;
  if (typeof payload.access_token !== 'string' || typeof payload.refresh_token !== 'string' || typeof user?.id !== 'string') throw new Error('La respuesta de autenticación de Supabase no es válida.');
  return { accessToken: payload.access_token, refreshToken: payload.refresh_token, expiresAt: Number(payload.expires_at ?? Math.floor(Date.now() / 1000) + Number(payload.expires_in ?? 3600)) * 1000, user: { id: user.id, email: typeof user.email === 'string' ? user.email : undefined } };
}

async function authRequest(config: SupabaseConfig, path: string, body: unknown) {
  const response = await fetch(`${config.url}/auth/v1/${path}`, { method: 'POST', headers: { apikey: config.anonKey, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`No se pudo iniciar sesión (${response.status}). Revisá el email, la contraseña y la configuración de Supabase Auth.`);
  return toSession(await response.json() as Record<string, unknown>);
}

export async function signIn(config: SupabaseConfig, email: string, password: string) {
  const session = await authRequest(config, 'token?grant_type=password', { email, password });
  persist(session); return session;
}

export async function restoreSession(config: SupabaseConfig) {
  const raw = window.localStorage.getItem(sessionKey); if (!raw) return null;
  try {
    const session = JSON.parse(raw) as SupabaseSession;
    if (session.expiresAt > Date.now() + 30_000) return session;
    const refreshed = await authRequest(config, 'token?grant_type=refresh_token', { refresh_token: session.refreshToken });
    persist(refreshed); return refreshed;
  } catch { persist(null); return null; }
}

export function signOut() { persist(null); }
