// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, lyricsBlock, notebook, type Harness } from './harness';

const sql = (file: string) => readFileSync(path.resolve('supabase/migrations', file), 'utf8');

describe('0007 is additive, repeatable and reversible, and the private sync keeps working beside it', () => {
  let h: Harness;
  let owner: string;
  let bob: string;
  beforeAll(async () => {
    h = await createHarness('0006'); // a project that only ran 0001-0006, with real data in it
    owner = await h.newUser('owner@example.com');
    bob = await h.newUser('bob@example.com');
    const node = await h.newNode(owner, 'Carpeta');
    await h.newDocument(owner, 'Mi canción', notebook(lyricsBlock('l1', 'tal cual')), node);
  }, 120_000);
  afterAll(async () => {
    await h.close();
  });

  const snapshot = async () => JSON.stringify(await h.admin.sql('select id, owner_id, node_id, title, payload, rev from public.documents order by id'));

  it('applying it leaves every existing row and every existing grant exactly as they were, and applying it twice is harmless', async () => {
    const before = await snapshot();
    const nodesBefore = JSON.stringify(await h.admin.sql('select * from public.library_nodes order by id'));
    await h.db.exec(sql('0007_sharing.sql'));
    await h.db.exec(sql('0007_sharing.sql'));
    expect(await snapshot()).toBe(before);
    expect(JSON.stringify(await h.admin.sql('select * from public.library_nodes order by id'))).toBe(nodesBefore);
    // 0006's hardening survives: browsers still cannot write library tables directly.
    await expect(h.as('authenticated', owner).sql(`update public.documents set title = 'x'`)).rejects.toThrow(/permission denied/);
    expect((await h.as('authenticated', owner).sql('select title from public.documents')).map((row) => row.title)).toEqual(['Mi canción']);
  });

  it('the private sync still round-trips for the owner, and a collaborator\'s edit reaches the owner through the same change log', async () => {
    const doc = (await h.admin.sql('select id, rev from public.documents limit 1'))[0];
    const op = crypto.randomUUID();
    const pushed = await h.as('authenticated', owner).rpc<{ documents: unknown[]; conflicts: unknown[] }>('sync_library', {
      p_owner_id: owner,
      p_op_id: op,
      p_snapshot: { documents: [], nodes: [], versions: [] },
    });
    expect(pushed.conflicts).toEqual([]);

    const invite = await h.as('authenticated', owner).rpc<{ token: string }>('share_create_invite', { p_kind: 'document', p_id: doc.id, p_role: 'editor' });
    await h.as('authenticated', bob).rpc('share_accept_invite', { p_token: invite.token, p_label: 'Bob' });
    await h.as('authenticated', bob).rpc('collab_save_document', {
      p_doc: doc.id, p_base_rev: doc.rev, p_title: 'Mi canción', p_content: notebook(lyricsBlock('l1', 'editado por Bob')), p_op_id: crypto.randomUUID(),
    });
    const page = await h.as('authenticated', owner).rpc<{ changes: Array<{ kind: string; record: { id: string; rev: number; content: { blocks: Array<{ content: { text: string } }> } } }> }>('pull_library', { p_owner_id: owner, p_after: '0', p_limit: 50 });
    const change = page.changes.find((item) => item.kind === 'document' && item.record.id === doc.id)!;
    expect(change.record.rev).toBe(Number(doc.rev) + 1);
    expect(change.record.content.blocks[0].content.text).toBe('editado por Bob');
  });

  it('the rollback removes only what 0007 added and leaves the library untouched', async () => {
    const before = await snapshot();
    await h.db.exec(sql('0007_sharing_rollback.sql'));
    expect(await snapshot()).toBe(before);
    const tables = (await h.admin.sql(`select table_name from information_schema.tables where table_schema = 'public'`)).map((row) => row.table_name);
    for (const gone of ['share_members', 'share_invites', 'share_links', 'share_sessions', 'share_activity', 'collab_ops']) expect(tables).not.toContain(gone);
    await expect(h.as('anon', null).rpc('collab_capabilities')).rejects.toThrow();
    // The private library API is intact.
    const pulled = await h.as('authenticated', owner).rpc<{ changes: unknown[] }>('pull_library', { p_owner_id: owner, p_after: '0', p_limit: 10 });
    expect(Array.isArray(pulled.changes)).toBe(true);
    // And 0007 can be applied again after a rollback.
    await h.db.exec(sql('0007_sharing.sql'));
    expect(await h.as('anon', null).rpc('collab_capabilities')).toEqual({ sharing: 1 });
  });
});
