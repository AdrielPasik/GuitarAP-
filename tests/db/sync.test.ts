// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness';

/**
 * The private library sync (sync_library / pull_library) with REAL, NON-EMPTY snapshots on a real PostgreSQL engine.
 * The earlier tests only ever pushed an empty snapshot, which is why a defect that broke every library with a folder
 * went unnoticed: see supabase/migrations/0008_sync_library_fix.sql.
 */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = 1_700_000_000_000;
const node = (n: number, name: string, kind: 'folder' | 'song', parentId: string | null, rev = 1, extra: Record<string, unknown> = {}) =>
  ({ id: id(n), parentId, kind, name, order: n, rev, createdAt: now, updatedAt: now, ...extra });
const document = (n: number, title: string, nodeId: string | null, songId: string | null, rev = 1, text = title) =>
  ({ id: id(n), nodeId, songId, type: 'tablature', title, content: { kind: 'notebook', version: 1, blocks: [{ id: 'l', kind: 'lyrics', content: { text } }] }, rev, createdAt: now, updatedAt: now });
const version = (n: number, documentId: string) => ({ id: id(n), documentId, reason: 'manual', title: 'v', content: { kind: 'notebook', version: 1, blocks: [] }, createdAt: now });
type Result = { documents: Array<{ id: string }>; nodes: Array<{ id: string }>; versions: Array<{ id: string }>; conflicts: Array<{ id: string }> };

describe('the defect (0006) and its repair (0008)', () => {
  it('0006 fails every snapshot that contains a folder with 42702; an empty snapshot passes (why nothing noticed)', async () => {
    const old = await createHarness('0007');
    const owner = await old.newUser('old@example.com');
    const push = (snapshot: unknown) => old.as('authenticated', owner).rpc('sync_library', { p_owner_id: owner, p_op_id: crypto.randomUUID(), p_snapshot: snapshot });
    await expect(push({ nodes: [], documents: [], versions: [] })).resolves.toBeTruthy();
    await expect(push({ nodes: [node(1, 'ESCALAS', 'folder', null)], documents: [], versions: [] })).rejects.toThrow(/ambiguous/);
    await old.close();
  }, 120_000);
});

describe('sync_library after 0008', () => {
  let h: Harness;
  let owner: string, other: string;
  const as = (who: string) => h.as('authenticated', who);
  const push = (who: string, snapshot: Record<string, unknown>, op = crypto.randomUUID()) => as(who).rpc<Result>('sync_library', { p_owner_id: who, p_op_id: op, p_snapshot: snapshot });
  const count = async (table: string, who = owner) => Number((await h.admin.sql(`select count(*) as n from public.${table} where owner_id = $1`, [who]))[0].n);

  beforeAll(async () => {
    h = await createHarness();
    owner = await h.newUser('owner@example.com');
    other = await h.newUser('other@example.com');
  }, 120_000);
  afterAll(() => h.close());

  it('stores a hierarchy sent child-first (the order IndexedDB returns it) and the song with its two parts', async () => {
    const snapshot = {
      // children BEFORE parents, on purpose
      nodes: [node(4, 'Tema 1 ft Gottya', 'song', id(3)), node(2, 'Modos', 'folder', id(1)), node(3, 'Proyectos', 'folder', null), node(1, 'ESCALAS', 'folder', null)],
      documents: [document(10, 'Letra y melodía', id(3), id(4)), document(11, 'Arreglos', id(3), id(4)), document(12, 'Do jónico', id(2), null)],
      versions: [version(20, id(10)), version(21, id(12))],
    };
    const result = await push(owner, snapshot);
    expect(result.nodes).toHaveLength(4);
    expect(result.documents).toHaveLength(3);
    expect(result.versions).toHaveLength(2);
    expect(result.conflicts).toEqual([]);
    expect(await count('library_nodes')).toBe(4);
    expect(await count('documents')).toBe(3);
    const parts = await h.admin.sql(`select string_agg(title, ',' order by title) as t from public.documents where song_id = $1`, [id(4)]);
    expect(parts[0].t).toBe('Arreglos,Letra y melodía');
    expect((await h.admin.sql(`select parent_id::text as p from public.library_nodes where id = $1`, [id(2)]))[0].p).toBe(id(1));
  });

  it('is idempotent: replaying the same operation changes nothing and answers from its record', async () => {
    const op = crypto.randomUUID();
    const snapshot = { nodes: [node(30, 'Una carpeta', 'folder', null)], documents: [document(31, 'Un doc', id(30), null)], versions: [] };
    const first = await push(owner, snapshot, op);
    const again = await push(owner, snapshot, op);
    expect(again).toEqual(first);
    expect(await h.admin.sql(`select count(*) as n from public.library_nodes where id = $1`, [id(30)])).toEqual([{ n: 1 }]);
  });

  it('accepts an update whose revision is the stored one + 1, and reports a conflict (writing nothing) otherwise', async () => {
    await push(owner, { nodes: [], documents: [document(40, 'v1', null, null, 1, 'uno')], versions: [] });
    const ok = await push(owner, { nodes: [], documents: [document(40, 'v2', null, null, 2, 'dos')], versions: [] });
    expect(ok.documents).toHaveLength(1);
    const stale = await push(owner, { nodes: [], documents: [document(40, 'v5', null, null, 5, 'cinco')], versions: [] }); // skipped revisions: the client must send stored + 1
    expect(stale.documents).toHaveLength(0);
    expect(stale.conflicts).toHaveLength(1);
    expect((await h.admin.sql(`select payload->'blocks'->0->'content'->>'text' as t from public.documents where id = $1`, [id(40)]))[0].t).toBe('dos');
  });

  it("refuses a folder whose parent is not in the account, a document pointing at a missing folder, and another account's ids", async () => {
    await expect(push(owner, { nodes: [node(50, 'Huérfana', 'folder', id(999))], documents: [], versions: [] })).rejects.toThrow(/parent does not exist/);
    await expect(push(owner, { nodes: [], documents: [document(51, 'x', id(998), null)], versions: [] })).rejects.toThrow(/folder does not exist/);
    await expect(push(owner, { nodes: [], documents: [document(52, 'x', null, id(2))], versions: [] })).rejects.toThrow(/song does not exist/); // id(2) is a folder, not a song
    await expect(push(other, { nodes: [node(1, 'Robada', 'folder', null, 2)], documents: [], versions: [] })).rejects.toThrow(/another account/);
    await expect(push(other, { nodes: [], documents: [document(10, 'Robado', null, null, 2)], versions: [] })).rejects.toThrow(/another account/);
    await expect(as(other).rpc('sync_library', { p_owner_id: owner, p_op_id: crypto.randomUUID(), p_snapshot: { nodes: [], documents: [], versions: [] } })).rejects.toThrow(/owner mismatch/);
    await expect(h.as('anon', null).rpc('sync_library', { p_owner_id: owner, p_op_id: crypto.randomUUID(), p_snapshot: {} })).rejects.toThrow();
    // Nothing from the refused requests was stored.
    expect(await count('library_nodes', other)).toBe(0);
  });

  it('a refused request is atomic: no half of it stays', async () => {
    const before = await count('library_nodes');
    await expect(push(owner, { nodes: [node(60, 'Buena', 'folder', null), node(61, 'Mala', 'folder', id(997))], documents: [], versions: [] })).rejects.toThrow();
    expect(await count('library_nodes')).toBe(before);
  });

  it('pull_library returns every change in commit order, in pages, and a second device reconstructs the same library', async () => {
    const reader = await h.newUser('reader@example.com');
    await push(reader, { nodes: [node(70, 'A', 'folder', null), node(71, 'B', 'folder', id(70))], documents: [document(72, 'Doc', id(71), null)], versions: [version(73, id(72))] });
    const first = await as(reader).rpc<{ cursor: string; changes: Array<{ kind: string; record: { id: string } }>; hasMore: boolean }>('pull_library', { p_owner_id: reader, p_after: '0', p_limit: 2 });
    expect(first.changes).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    const rest = await as(reader).rpc<typeof first>('pull_library', { p_owner_id: reader, p_after: first.cursor, p_limit: 10 });
    const all = [...first.changes, ...rest.changes];
    expect(all.map((change) => change.kind)).toEqual(['node', 'node', 'document', 'version']);
    expect(all.map((change) => change.record.id)).toEqual([id(70), id(71), id(72), id(73)]); // parents were committed first
    expect(rest.hasMore).toBe(false);
    // Nobody else can read this log.
    await expect(as(other).rpc('pull_library', { p_owner_id: reader, p_after: '0', p_limit: 10 })).rejects.toThrow(/owner mismatch/);
  });

  it('keeps soft-deleted folders and documents (trash) with their deletion time, and does not duplicate on repeat', async () => {
    await push(owner, { nodes: [node(80, 'Papelera', 'folder', null, 1, { deletedAt: now + 5 })], documents: [document(81, 'Borrado', id(80), null)], versions: [] });
    const row = (await h.admin.sql(`select deleted_at is not null as gone from public.library_nodes where id = $1`, [id(80)]))[0];
    expect(row.gone).toBe(true);
    await push(owner, { nodes: [node(80, 'Papelera', 'folder', null, 2, { deletedAt: null })], documents: [], versions: [] }); // restored
    expect((await h.admin.sql(`select deleted_at is null as live from public.library_nodes where id = $1`, [id(80)]))[0].live).toBe(true);
    expect(await h.admin.sql(`select count(*) as n from public.library_nodes where id = $1`, [id(80)])).toEqual([{ n: 1 }]);
  });

  it('a shared project lists its parts in the order they were created, and a shared_with_me entry names its project', async () => {
    const author = await h.newUser('author@example.com');
    const friend = await h.newUser('friend@example.com');
    const t = (n: number) => ({ ...document(n, 'x', id(300), id(301)), createdAt: now + n });
    await push(author, {
      nodes: [node(300, 'Carpeta', 'folder', null), node(301, 'Tema', 'song', id(300))],
      documents: [{ ...t(310), title: 'Zeta primera parte' }, { ...t(311), title: 'Alfa segunda parte' }],
      versions: [],
    });
    const link = await as(author).rpc<{ token: string }>('share_create_link', { p_kind: 'node', p_id: id(301) });
    const read = await h.as('anon', null).rpc<{ documents: Array<{ title: string }> }>('share_read', { p_token: link.token });
    expect(read.documents.map((d) => d.title)).toEqual(['Zeta primera parte', 'Alfa segunda parte']);
    const preview = await as(author).rpc<{ documents: Array<{ title: string }> }>('share_preview_scope', { p_kind: 'node', p_id: id(301) });
    expect(preview.documents.map((d) => d.title)).toEqual(['Zeta primera parte', 'Alfa segunda parte']);

    const invite = await as(author).rpc<{ token: string }>('share_create_invite', { p_kind: 'node', p_id: id(301), p_role: 'editor' });
    await as(friend).rpc('share_accept_invite', { p_token: invite.token, p_label: 'Amigo' });
    const mine = await as(friend).rpc<{ documents: Array<{ title: string; project: { name: string; kind: string } }>; folders: Array<{ name: string; kind: string }> }>('shared_with_me');
    expect(mine.documents).toHaveLength(2);
    expect(mine.documents.every((d) => d.project.name === 'Tema' && d.project.kind === 'song')).toBe(true);
    expect(mine.folders).toEqual([expect.objectContaining({ name: 'Tema', kind: 'song' })]);
  });

  it('sync_capabilities answers for signed-in and anonymous callers and writes nothing', async () => {
    expect(await h.as('anon', null).rpc('sync_capabilities')).toEqual({ syncLibrary: 2 });
    expect(await as(owner).rpc('sync_capabilities')).toEqual({ syncLibrary: 2 });
  });
});
