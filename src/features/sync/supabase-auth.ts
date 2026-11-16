export type SupabaseConfig = { url: string; anonKey: string };
export type SupabaseSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: { id: string; email?: string };
};

const sessionKey = 'guitarap:supabase-session';

export type AuthFailure = 'credentials' | 'rate-limit' | 'offline' | 'service' | 'unknown';

/** Failure with a message that is safe and useful to show; technical detail stays out of the UI. */
export class AuthError extends Error {
  constructor(
    message: string,
    readonly failure: AuthFailure,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

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
  if (
    typeof payload.access_token !== 'string' ||
    typeof payload.refresh_token !== 'string' ||
    typeof user?.id !== 'string'
  )
    throw new AuthError('El servicio de cuentas respondió algo inesperado. Probá de nuevo.', 'service');
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt:
      Number(payload.expires_at ?? Math.floor(Date.now() / 1000) + Number(payload.expires_in ?? 3600)) * 1000,
    user: { id: user.id, email: typeof user.email === 'string' ? user.email : undefined },
  };
}

async function authRequest(config: SupabaseConfig, path: string, body: unknown) {
  let response: Response;
  try {
    response = await fetch(`${config.url}/auth/v1/${path}`, {
      method: 'POST',
      headers: { apikey: config.anonKey, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthError(
      'No hay conexión con el servidor. Podés seguir trabajando sin conexión y volver a intentarlo después.',
      'offline',
    );
  }
  if (!response.ok) {
    if (response.status === 400 || response.status === 401 || response.status === 422)
      throw new AuthError('El correo o la contraseña no son correctos.', 'credentials');
    if (response.status === 429)
      throw new AuthError('Hubo demasiados intentos. Esperá unos minutos y probá de nuevo.', 'rate-limit');
    if (response.status >= 500)
      throw new AuthError('El servicio de cuentas no responde en este momento. Probá más tarde.', 'service');
    throw new AuthError('No pudimos iniciar sesión. Revisá tus datos y probá de nuevo.', 'unknown');
  }
  return toSession((await response.json()) as Record<string, unknown>);
}

export async function signIn(config: SupabaseConfig, email: string, password: string) {
  const session = await authRequest(config, 'token?grant_type=password', { email, password });
  persist(session);
  return session;
}

export async function restoreSession(config: SupabaseConfig) {
  const raw = window.localStorage.getItem(sessionKey);
  if (!raw) return null;
  let session: SupabaseSession;
  try {
    session = JSON.parse(raw) as SupabaseSession;
  } catch {
    persist(null);
    return null;
  }
  if (session.expiresAt > Date.now() + 30_000) return session;
  try {
    const refreshed = await authRequest(config, 'token?grant_type=refresh_token', {
      refresh_token: session.refreshToken,
    });
    persist(refreshed);
    return refreshed;
  } catch (error) {
    // Without a connection the stored session is kept: the person is still signed in,
    // sync simply waits. Only a refused refresh ends the session.
    if (error instanceof AuthError && (error.failure === 'offline' || error.failure === 'service')) return session;
    persist(null);
    return null;
  }
}

export function signOut() {
  persist(null);
}
