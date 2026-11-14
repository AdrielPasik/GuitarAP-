import { afterEach, describe, expect, it, vi } from 'vitest';
import { restoreSession, signIn, signOut, type SupabaseConfig } from '@/features/sync/supabase-auth';

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
});
