import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthError, restoreSession, signIn, signOut, type SupabaseConfig } from '@/features/sync/supabase-auth';

const config: SupabaseConfig = { url: 'https://example.supabase.co', anonKey: 'public-key' };
const response = (body: object) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
afterEach(() => { vi.unstubAllGlobals(); window.localStorage.clear(); });

describe('Supabase authentication', () => {
  it('uses the anonymous key to start and persist an email/password session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ access_token: 'jwt', refresh_token: 'refresh', expires_in: 3600, user: { id: 'user-1', email: 'guitar@example.com' } })); vi.stubGlobal('fetch', fetchMock);
    const session = await signIn(config, 'guitar@example.com', 'not-a-real-password');
    expect(session.user.id).toBe('user-1'); expect(fetchMock.mock.calls[0][0]).toContain('token?grant_type=password'); expect(fetchMock.mock.calls[0][1].headers.apikey).toBe('public-key');
    await expect(restoreSession(config)).resolves.toMatchObject({ accessToken: 'jwt' }); signOut(); await expect(restoreSession(config)).resolves.toBeNull();
  });

  it('explains failures in plain words and never leaks status codes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 400 })));
    await expect(signIn(config, 'a@b.co', 'x')).rejects.toMatchObject({ failure: 'credentials', message: 'El correo o la contraseña no son correctos.' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 429 })));
    await expect(signIn(config, 'a@b.co', 'x')).rejects.toMatchObject({ failure: 'rate-limit' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
    await expect(signIn(config, 'a@b.co', 'x')).rejects.toMatchObject({ failure: 'service' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const error = await signIn(config, 'a@b.co', 'x').catch((problem: unknown) => problem);
    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).failure).toBe('offline');
    expect((error as AuthError).message).not.toMatch(/\d{3}/);
  });

  it('keeps an expired session while offline instead of silently signing the person out', async () => {
    window.localStorage.setItem('guitarap:supabase-session', JSON.stringify({ accessToken: 'old', refreshToken: 'r', expiresAt: Date.now() - 1000, user: { id: 'u' } }));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(restoreSession(config)).resolves.toMatchObject({ accessToken: 'old' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 400 })));
    await expect(restoreSession(config)).resolves.toBeNull();
  });
});
