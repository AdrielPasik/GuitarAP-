import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFretboardContent,
  createTablatureContent,
  type LibraryNode,
  type MusicalDocument,
} from '@/core/model';
import { FakeTransport, SupabaseTransport, SyncTransportError } from '@/features/sync/transport';
const doc = (rev = 1): MusicalDocument => ({
  id: 'doc',
  nodeId: null,
  type: 'tablature',
  title: 'Riff',
  content: createTablatureContent(),
  rev,
  createdAt: 1,
  updatedAt: 1,
});
afterEach(() => vi.unstubAllGlobals());
describe('FakeTransport', () => {
  it('is idempotent and exposes concurrent revisions as conflicts', async () => {
    const transport = new FakeTransport();
    const snapshot = { documents: [doc()], nodes: [], versions: [] };
    expect((await transport.push('u', 'op-1', snapshot)).documents).toHaveLength(1);
    expect((await transport.push('u', 'op-1', snapshot)).documents).toHaveLength(1);
    expect((await transport.push('u', 'op-2', snapshot)).conflicts).toHaveLength(1);
  });

  it('replicates songs, spatial maps, movement, trash, restoration and history', async () => {
    const transport = new FakeTransport();
    const folder: LibraryNode = {
      id: 'folder',
      parentId: null,
      kind: 'folder',
      name: 'Escalas',
      order: 1,
      rev: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    const song: LibraryNode = {
      id: 'song',
      parentId: null,
      kind: 'song',
      name: 'Canción',
      order: 2,
      song: { key: 'C', bpm: 96 },
      rev: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    const map: MusicalDocument = {
      id: 'map',
      nodeId: 'folder',
      songId: 'song',
      type: 'fretboard',
      title: 'Do mayor',
      content: {
        ...createFretboardContent(),
        positions: [1, 2, 3].map((number) => ({
          id: `p-${number}`,
          name: `Posición ${number}`,
          notes: [{ string: 5, fret: number * 2 }],
        })),
        selectedPositionId: 'p-1',
      },
      rev: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    const version = {
      id: 'version',
      documentId: 'map',
      reason: 'manual' as const,
      title: map.title,
      content: map.content,
      createdAt: 1,
    };
    const initial = await transport.push('u', 'create', {
      nodes: [folder, song],
      documents: [map],
      versions: [version],
    });
    expect(initial).toMatchObject({
      conflicts: [],
      nodes: [{ id: 'folder' }, { id: 'song' }],
      documents: [{ id: 'map' }],
      versions: [{ id: 'version' }],
    });

    const moved = { ...map, nodeId: null, rev: 2, updatedAt: 2 };
    expect(
      (await transport.push('u', 'move', { nodes: [], documents: [moved], versions: [] }))
        .documents[0],
    ).toMatchObject({ nodeId: null, rev: 2 });
    const trashed = { ...moved, rev: 3, deletedAt: 3, updatedAt: 3 };
    expect(
      (await transport.push('u', 'trash', { nodes: [], documents: [trashed], versions: [] }))
        .documents[0].deletedAt,
    ).toBe(3);
    const restored = { ...moved, rev: 4, updatedAt: 4 };
    expect(
      (await transport.push('u', 'restore', { nodes: [], documents: [restored], versions: [] }))
        .documents[0],
    ).not.toHaveProperty('deletedAt');

    const firstPage = await transport.pull('u', '0', 2);
    const secondPage = await transport.pull('u', firstPage.cursor, 10);
    expect(firstPage.hasMore).toBe(true);
    expect([...firstPage.changes, ...secondPage.changes]).toHaveLength(7);
  });
});
describe('SupabaseTransport', () => {
  it('marks rejected RPC calls as non-retryable without exposing the response body', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ message: 'internal sql detail' }), { status: 400 }),
        ),
    );
    const transport = new SupabaseTransport(
      'https://example.supabase.co',
      'public-key',
      'user-token',
    );
    await expect(transport.pull('user', '0', 100)).rejects.toMatchObject<
      Partial<SyncTransportError>
    >({ retryable: false, status: 400 });
    await expect(transport.pull('user', '0', 100)).rejects.not.toThrow(/internal sql detail/);
  });

  it('marks network failures as retryable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    const transport = new SupabaseTransport(
      'https://example.supabase.co',
      'public-key',
      'user-token',
    );
    await expect(transport.pull('user', '0', 100)).rejects.toMatchObject<
      Partial<SyncTransportError>
    >({ retryable: true });
  });
});
