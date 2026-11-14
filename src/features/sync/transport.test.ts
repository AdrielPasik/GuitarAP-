import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTablatureContent, type MusicalDocument } from '@/core/model';
import { FakeTransport, SupabaseTransport } from '@/features/sync/transport';

const document = (rev = 1): MusicalDocument => ({ id: 'doc', nodeId: null, type: 'tablature', title: 'Riff', content: createTablatureContent(), rev, createdAt: 1, updatedAt: 1 });
describe('FakeTransport', () => { it('is idempotent and exposes concurrent revisions as conflicts', async () => { const transport = new FakeTransport(); expect((await transport.push('u', 'op-1', [document()])).applied).toHaveLength(1); expect((await transport.push('u', 'op-1', [document()])).applied).toHaveLength(1); const conflict = await transport.push('u', 'op-2', [document(1)]); expect(conflict.conflicts).toHaveLength(1); }); });
afterEach(() => vi.unstubAllGlobals());
describe('SupabaseTransport', () => {
  it('sends the public key separately from the user JWT and normalizes RPC fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ applied: [{ id: 'doc', node_id: null, type: 'tablature', title: 'Riff', payload: createTablatureContent(), rev: 1, created_at: '1970-01-01T00:00:00.001Z', updated_at: '1970-01-01T00:00:00.002Z', owner_id: 'user' }], conflicts: [] }), { status: 200 })); vi.stubGlobal('fetch', fetchMock);
    const result = await new SupabaseTransport('https://example.supabase.co', 'anon-key', 'session-jwt').push('user', 'op', [document()]);
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ apikey: 'anon-key', authorization: 'Bearer session-jwt' }); expect(result.applied[0]).toMatchObject({ ownerId: 'user', updatedAt: 2, content: expect.any(Object) });
  });
});
