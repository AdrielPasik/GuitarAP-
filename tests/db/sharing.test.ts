// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, lyricsBlock, melodyBlock, notebook, type Harness } from './harness';

/**
 * Security and behaviour of 0007_sharing.sql, executed by a real PostgreSQL engine with the project's migrations.
 * Every negative case is an attempt that must fail. Nothing here touches a real Supabase project.
 */
let h: Harness;
let owner: string, bob: string, carol: string, dave: string, eve: string;
let temaFolder: string, subFolder: string, privateFolder: string;
let letra: string, solo: string, nested: string, secret: string, loose: string;

const as = (who: string | null) => (who ? h.as('authenticated', who) : h.as('anon', null));
const fresh = () => crypto.randomUUID();
const content = (text: string) => notebook(lyricsBlock('l1', text), melodyBlock('m1', [60, 62, 64]));
type Link = { id: string; token: string };
const shareLink = (target: string, options: Record<string, unknown> = {}) =>
  as(owner).rpc<Link>('share_create_link', { p_kind: 'document', p_id: target, ...options });
const invite = (target: string, role: string, kind = 'document') => as(owner).rpc<Link>('share_create_invite', { p_kind: kind, p_id: target, p_role: role });
const accept = (who: string, token: string, label = 'Goti') => as(who).rpc<{ ok: boolean; reason?: string; role?: string }>('share_accept_invite', { p_token: token, p_label: label });

beforeAll(async () => {
  h = await createHarness();
  [owner, bob, carol, dave, eve] = await Promise.all(['owner', 'bob', 'carol', 'dave', 'eve'].map((name) => h.newUser(`${name}@example.com`)));
  temaFolder = await h.newNode(owner, 'Tema 1 FT Goti');
  subFolder = await h.newNode(owner, 'Ideas', temaFolder);
  privateFolder = await h.newNode(owner, 'Personal');
  letra = await h.newDocument(owner, 'Letra', content('Hoy vuelvo a empezar'), temaFolder);
  solo = await h.newDocument(owner, 'Solo', content('solo'), temaFolder);
  nested = await h.newDocument(owner, 'Idea suelta', content('idea'), subFolder);
  secret = await h.newDocument(owner, 'Diario privado', content('SECRETO-NO-COMPARTIR'), privateFolder);
  loose = await h.newDocument(owner, 'Fuera de carpetas', content('fuera'));
}, 180_000);
afterAll(async () => {
  await h.close();
});

describe('A — a read-only link exposes exactly one project, to anyone', () => {
  it('stores only a hash of the token, returns the token once, and the anonymous reader gets the content without comments', async () => {
    await h.admin.sql(`update public.documents set payload = payload || '{"comments":[{"id":"c1","text":"nota personal","createdAt":1,"updatedAt":1}]}'::jsonb where id = $1`, [letra]);
    const link = await shareLink(letra);
    expect(link.token.length).toBeGreaterThanOrEqual(40);
    const stored = await h.admin.sql(`select encode(token_hash, 'hex') as hash, password_hash from public.share_links where id = $1`, [link.id]);
    expect(stored[0].hash).not.toBe(link.token);
    expect(JSON.stringify(stored)).not.toContain(link.token);
    expect(stored[0].password_hash).toBeNull();

    const info = await as(null).rpc<{ valid: boolean; requiresPassword: boolean; title: string }>('share_link_info', { p_token: link.token });
    expect(info).toMatchObject({ valid: true, requiresPassword: false, title: 'Letra' });
    const read = await as(null).rpc<{ ok: boolean; documents: Array<{ id: string; title: string; content: Record<string, unknown> }> }>('share_read', { p_token: link.token });
    expect(read.ok).toBe(true);
    expect(read.documents.map((doc) => doc.title)).toEqual(['Letra']);
    expect(JSON.stringify(read)).toContain('Hoy vuelvo a empezar');
    expect(JSON.stringify(read)).not.toContain('nota personal');
    expect(JSON.stringify(read)).not.toContain('SECRETO');
    expect(read.documents[0].content.comments).toBeUndefined();
  });

  it('an anonymous visitor cannot read tables, write anything, share, or call any authenticated function', async () => {
    const link = await shareLink(letra);
    const anon = as(null);
    expect(await anon.sql('select * from public.documents')).toEqual([]); // RLS: an anonymous visitor sees no rows at all
    await expect(anon.sql('select * from public.share_links')).rejects.toThrow(/permission denied/);
    await expect(anon.sql(`update public.documents set title = 'x'`)).rejects.toThrow(/permission denied/);
    await expect(anon.rpc('collab_save_document', { p_doc: letra, p_base_rev: 1, p_title: 'x', p_content: {}, p_op_id: fresh() })).rejects.toThrow(/permission denied/);
    await expect(anon.rpc('share_create_link', { p_kind: 'document', p_id: letra })).rejects.toThrow(/permission denied/);
    await expect(anon.rpc('shared_with_me')).rejects.toThrow(/permission denied/);
    await expect(anon.rpc('collab_pull_document', { p_doc: letra })).rejects.toThrow(/permission denied/);
    // Having the link grants reading, not writing: the link functions have no write path.
    const rev = (await h.admin.sql('select rev from public.documents where id = $1', [letra]))[0].rev;
    await as(null).rpc('share_read', { p_token: link.token });
    expect((await h.admin.sql('select rev from public.documents where id = $1', [letra]))[0].rev).toBe(rev);
  });

  it('a link to one document does not reach its siblings, other folders, or the private library', async () => {
    const link = await shareLink(letra);
    const read = await as(null).rpc<{ documents: Array<{ title: string }> }>('share_read', { p_token: link.token });
    expect(read.documents).toHaveLength(1);
    const text = JSON.stringify(read);
    for (const hidden of ['Solo', 'Idea suelta', 'Diario privado', 'Fuera de carpetas', 'Personal']) expect(text).not.toContain(hidden);
  });
});

describe('B — password-protected links', () => {
  it('stores a bcrypt verifier, never the password, and sends no content before the password is proven', async () => {
    const link = await shareLink(letra, { p_password: 'cancion-secreta' });
    const stored = await h.admin.sql(`select password_hash from public.share_links where id = $1`, [link.id]);
    expect(String(stored[0].password_hash)).toMatch(/^\$2[aby]\$10\$/);
    expect(String(stored[0].password_hash)).not.toContain('cancion-secreta');

    const info = await as(null).rpc<{ valid: boolean; requiresPassword: boolean }>('share_link_info', { p_token: link.token });
    expect(info).toMatchObject({ valid: true, requiresPassword: true });
    const denied = await as(null).rpc('share_read', { p_token: link.token });
    expect(denied).toEqual({ ok: false, reason: 'password_required' });
    expect(JSON.stringify(denied)).not.toContain('Hoy vuelvo');
    expect(await as(null).rpc('share_read', { p_token: link.token, p_session: 'inventada' })).toEqual({ ok: false, reason: 'password_required' });
  });

  it('a wrong password is refused; five wrong ones lock the link; the right password is refused while locked; then it opens', async () => {
    const link = await shareLink(letra, { p_password: 'cancion-secreta' });
    const unlock = (password: string) => as(null).rpc<{ ok: boolean; reason?: string; session?: string; retryAfterSeconds?: number }>('share_unlock', { p_token: link.token, p_password: password });
    expect(await unlock('incorrecta')).toEqual({ ok: false, reason: 'wrong_password' });
    for (let attempt = 0; attempt < 4; attempt += 1) expect((await unlock('otra-mal')).ok).toBe(false);
    const locked = await unlock('cancion-secreta');
    expect(locked).toMatchObject({ ok: false, reason: 'locked' });
    expect(locked.retryAfterSeconds).toBeGreaterThan(0);
    expect(await as(null).rpc('share_link_info', { p_token: link.token })).toMatchObject({ locked: true });
    await h.admin.sql(`update public.share_links set locked_until = now() - interval '1 second' where id = $1`, [link.id]);
    const ok = await unlock('cancion-secreta');
    expect(ok.ok).toBe(true);
    expect(ok.session).toBeTruthy();
    const read = await as(null).rpc<{ ok: boolean; documents: unknown[] }>('share_read', { p_token: link.token, p_session: ok.session });
    expect(read.ok).toBe(true);
    expect(JSON.stringify(read)).toContain('Hoy vuelvo a empezar');
    const sessions = await h.admin.sql(`select encode(token_hash, 'hex') as hash from public.share_sessions`);
    expect(JSON.stringify(sessions)).not.toContain(String(ok.session)); // sessions are stored hashed too
  });

  it('a session belongs to one link, dies with a password change, and dies with revocation', async () => {
    const a = await shareLink(letra, { p_password: 'password-uno' });
    const b = await shareLink(solo, { p_password: 'password-dos' });
    const session = (await as(null).rpc<{ session: string }>('share_unlock', { p_token: a.token, p_password: 'password-uno' })).session;
    expect(await as(null).rpc('share_read', { p_token: b.token, p_session: session })).toEqual({ ok: false, reason: 'password_required' });
    expect((await as(null).rpc<{ ok: boolean }>('share_read', { p_token: a.token, p_session: session })).ok).toBe(true);
    await as(owner).rpc('share_update_link', { p_link_id: a.id, p_password: 'password-nuevo' });
    expect(await as(null).rpc('share_read', { p_token: a.token, p_session: session })).toEqual({ ok: false, reason: 'password_required' });
    const fresh2 = (await as(null).rpc<{ session: string }>('share_unlock', { p_token: a.token, p_password: 'password-nuevo' })).session;
    await as(owner).rpc('share_revoke_link', { p_link_id: a.id });
    expect(await as(null).rpc('share_read', { p_token: a.token, p_session: fresh2 })).toEqual({ ok: false, reason: 'invalid' });
    expect(await as(null).rpc('share_link_info', { p_token: a.token })).toEqual({ valid: false, reason: 'revoked' });
    expect(await as(null).rpc('share_unlock', { p_token: a.token, p_password: 'password-nuevo' })).toEqual({ ok: false, reason: 'invalid' });
  });

  it('refuses weak passwords and past expiries, and an expired link says so', async () => {
    await expect(shareLink(letra, { p_password: 'corta' })).rejects.toThrow(/password too short/);
    await expect(shareLink(letra, { p_expires: '2001-01-01T00:00:00Z' })).rejects.toThrow(/expiry must be in the future/);
    const link = await shareLink(letra, { p_expires: new Date(Date.now() + 3_600_000).toISOString() });
    expect((await as(null).rpc<{ valid: boolean }>('share_link_info', { p_token: link.token })).valid).toBe(true);
    await h.admin.sql(`update public.share_links set expires_at = now() - interval '1 minute' where id = $1`, [link.id]);
    expect(await as(null).rpc('share_link_info', { p_token: link.token })).toEqual({ valid: false, reason: 'expired' });
    expect(await as(null).rpc('share_read', { p_token: link.token })).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('C — inviting an editor', () => {
  it('an invitation is one-time, expires, can be revoked, and cannot be used by its own author', async () => {
    const one = await invite(letra, 'editor');
    expect(await accept(bob, one.token)).toMatchObject({ ok: true, role: 'editor' });
    expect(await accept(carol, one.token)).toEqual({ ok: false, reason: 'invalid_or_used' });
    const expired = await invite(letra, 'viewer');
    await h.admin.sql(`update public.share_invites set expires_at = now() - interval '1 second' where id = $1`, [expired.id]);
    expect(await accept(dave, expired.token)).toEqual({ ok: false, reason: 'invalid_or_used' });
    const revoked = await invite(letra, 'viewer');
    await as(owner).rpc('share_revoke_invite', { p_invite_id: revoked.id });
    expect(await accept(dave, revoked.token)).toEqual({ ok: false, reason: 'invalid_or_used' });
    const own = await invite(letra, 'viewer');
    expect(await accept(owner, own.token)).toEqual({ ok: false, reason: 'own_project' });
    expect(await accept(eve, 'token-inventado')).toEqual({ ok: false, reason: 'invalid_or_used' });
    await expect(as(null).rpc('share_accept_invite', { p_token: one.token })).rejects.toThrow(/permission denied|not authenticated/);
  });

  it('the editor reads and edits only that project; the owner sees the edit; revisions guard against overwriting', async () => {
    const pulled = await as(bob).rpc<{ role: string; rev: number; content: { blocks: unknown[] } }>('collab_pull_document', { p_doc: letra });
    expect(pulled.role).toBe('editor');
    const edited = notebook(lyricsBlock('l1', 'Hoy vuelvo a empezar de nuevo'), melodyBlock('m1', [60, 62, 64]));
    const op = fresh();
    const saved = await as(bob).rpc<{ conflict: boolean; rev: number }>('collab_save_document', { p_doc: letra, p_base_rev: pulled.rev, p_title: 'Letra', p_content: edited, p_op_id: op });
    expect(saved).toMatchObject({ conflict: false, rev: pulled.rev + 1 });
    // Retrying the same operation changes nothing (idempotent).
    expect(await as(bob).rpc('collab_save_document', { p_doc: letra, p_base_rev: pulled.rev, p_title: 'Letra', p_content: edited, p_op_id: op })).toEqual(saved);
    const row = (await h.admin.sql('select rev, payload from public.documents where id = $1', [letra]))[0];
    expect(row.rev).toBe(pulled.rev + 1);
    expect(JSON.stringify(row.payload)).toContain('de nuevo');
    // The owner's private sync log learns about it, and a recovery version records who saved.
    const logged = await h.admin.sql(`select cursor, record->>'rev' as rev from public.sync_changes where owner_id = $1 order by cursor desc limit 1`, [owner]);
    expect(Number(logged[0].rev)).toBe(pulled.rev + 1);
    const versions = await h.admin.sql(`select author_id from public.document_versions where document_id = $1 and reason = 'collab'`, [letra]);
    expect(versions.map((version) => version.author_id)).toContain(bob);

    // A second editor working from the old revision is told, and nothing is overwritten.
    const stale = await as(bob).rpc<{ conflict: boolean; current: { rev: number; content: unknown } }>('collab_save_document', {
      p_doc: letra, p_base_rev: pulled.rev, p_title: 'Letra', p_content: notebook(lyricsBlock('l1', 'pisando')), p_op_id: fresh(),
    });
    expect(stale.conflict).toBe(true);
    expect(stale.current.rev).toBe(pulled.rev + 1);
    expect(JSON.stringify((await h.admin.sql('select payload from public.documents where id = $1', [letra]))[0].payload)).not.toContain('pisando');
  });

  it('the editor cannot reach anything else of the owner', async () => {
    for (const other of [solo, nested, secret, loose]) {
      await expect(as(bob).rpc('collab_pull_document', { p_doc: other })).rejects.toThrow(/forbidden/);
      await expect(as(bob).rpc('collab_save_document', { p_doc: other, p_base_rev: 1, p_title: 'x', p_content: notebook(), p_op_id: fresh() })).rejects.toThrow(/forbidden/);
    }
    const mine = await as(bob).sql('select id from public.documents');
    expect(mine).toEqual([]); // RLS: the table still shows a user only their own rows
    const listed = await as(bob).rpc<{ documents: Array<{ id: string }>; folders: unknown[] }>('shared_with_me');
    expect(listed.documents.map((doc) => doc.id)).toEqual([letra]);
    expect(listed.folders).toEqual([]);
  });
});

describe('D — roles are enforced by the database', () => {
  let doc: string;
  beforeAll(async () => {
    doc = await h.newDocument(owner, 'Roles', content('roles'));
    await accept(carol, (await invite(doc, 'commenter')).token, 'Carol');
    await accept(dave, (await invite(doc, 'viewer')).token, 'Dave');
    await accept(bob, (await invite(doc, 'editor')).token, 'Bob');
  });

  it('a viewer reads but cannot write or comment; a commenter can only add a comment; an editor writes', async () => {
    expect((await as(dave).rpc<{ role: string }>('collab_pull_document', { p_doc: doc })).role).toBe('viewer');
    await expect(as(dave).rpc('collab_save_document', { p_doc: doc, p_base_rev: 1, p_title: 'x', p_content: notebook(), p_op_id: fresh() })).rejects.toThrow(/forbidden/);
    await expect(as(dave).rpc('collab_add_comment', { p_doc: doc, p_comment: { text: 'hola' } })).rejects.toThrow(/forbidden/);

    await expect(as(carol).rpc('collab_save_document', { p_doc: doc, p_base_rev: 1, p_title: 'x', p_content: notebook(melodyBlock('m', [1])), p_op_id: fresh() })).rejects.toThrow(/forbidden/);
    const before = (await h.admin.sql('select payload from public.documents where id = $1', [doc]))[0].payload as { blocks: unknown[] };
    const commented = await as(carol).rpc<{ rev: number }>('collab_add_comment', { p_doc: doc, p_comment: { id: 'c-carol', text: 'Probar el puente en Sol', blockId: 'm1', eventId: 'm1-1' } });
    expect(commented.rev).toBe(2);
    const after = (await h.admin.sql('select payload from public.documents where id = $1', [doc]))[0].payload as { blocks: unknown[]; comments: Array<{ id: string; text: string }> };
    expect(after.blocks).toEqual(before.blocks); // the music is untouched
    expect(after.comments.map((comment) => comment.text)).toEqual(['Probar el puente en Sol']);
    await expect(as(carol).rpc('collab_add_comment', { p_doc: doc, p_comment: { text: '' } })).rejects.toThrow(/invalid comment/);
    await expect(as(carol).rpc('collab_add_comment', { p_doc: doc, p_comment: { text: 'x'.repeat(4001) } })).rejects.toThrow(/invalid comment/);

    const current = await as(bob).rpc<{ rev: number }>('collab_pull_document', { p_doc: doc });
    expect((await as(bob).rpc<{ conflict: boolean }>('collab_save_document', { p_doc: doc, p_base_rev: current.rev, p_title: 'Roles', p_content: notebook(melodyBlock('m1', [67])), p_op_id: fresh() })).conflict).toBe(false);
  });

  it('nobody but the owner can share, invite, change roles or revoke; strangers get nothing', async () => {
    for (const who of [bob, carol, dave, eve]) {
      await expect(as(who).rpc('share_create_link', { p_kind: 'document', p_id: doc })).rejects.toThrow(/forbidden/);
      await expect(as(who).rpc('share_create_invite', { p_kind: 'document', p_id: doc, p_role: 'editor' })).rejects.toThrow(/forbidden/);
      await expect(as(who).rpc('share_overview', { p_kind: 'document', p_id: doc })).rejects.toThrow(/forbidden/);
      await expect(as(who).rpc('share_preview_scope', { p_kind: 'document', p_id: doc })).rejects.toThrow(/forbidden/);
    }
    const members = (await as(owner).rpc<{ members: Array<{ id: string; label: string }> }>('share_overview', { p_kind: 'document', p_id: doc })).members;
    const bobMember = members.find((member) => member.label === 'Bob')!;
    await expect(as(bob).rpc('share_set_role', { p_member_id: bobMember.id, p_role: 'editor' })).rejects.toThrow(/forbidden/);
    await expect(as(dave).rpc('share_revoke_member', { p_member_id: bobMember.id })).rejects.toThrow(/forbidden/);
    await expect(as(eve).rpc('collab_pull_document', { p_doc: doc })).rejects.toThrow(/forbidden/);
    expect((await as(eve).rpc<{ documents: unknown[] }>('shared_with_me')).documents).toEqual([]);
    await expect(as(owner).rpc('share_set_role', { p_member_id: bobMember.id, p_role: 'admin' })).rejects.toThrow(/invalid role/);
  });

  it('the owner changes a role and it applies immediately', async () => {
    const members = (await as(owner).rpc<{ members: Array<{ id: string; label: string }> }>('share_overview', { p_kind: 'document', p_id: doc })).members;
    const carolMember = members.find((member) => member.label === 'Carol')!;
    await as(owner).rpc('share_set_role', { p_member_id: carolMember.id, p_role: 'editor' });
    const current = await as(carol).rpc<{ rev: number; role: string }>('collab_pull_document', { p_doc: doc });
    expect(current.role).toBe('editor');
    expect((await as(carol).rpc<{ conflict: boolean }>('collab_save_document', { p_doc: doc, p_base_rev: current.rev, p_title: 'Roles', p_content: notebook(), p_op_id: fresh() })).conflict).toBe(false);
    await as(owner).rpc('share_set_role', { p_member_id: carolMember.id, p_role: 'viewer' });
    await expect(as(carol).rpc('collab_save_document', { p_doc: doc, p_base_rev: current.rev + 1, p_title: 'Roles', p_content: notebook(), p_op_id: fresh() })).rejects.toThrow(/forbidden/);
  });
});

describe('E — revocation', () => {
  it('a revoked collaborator can neither read nor write, even with an old operation id, and the project vanishes from their list', async () => {
    const doc = await h.newDocument(owner, 'Para revocar', content('x'));
    await accept(bob, (await invite(doc, 'editor')).token, 'Bob');
    const pulled = await as(bob).rpc<{ rev: number }>('collab_pull_document', { p_doc: doc });
    const members = (await as(owner).rpc<{ members: Array<{ id: string; label: string }> }>('share_overview', { p_kind: 'document', p_id: doc })).members;
    await as(owner).rpc('share_revoke_member', { p_member_id: members[0].id });
    await expect(as(bob).rpc('collab_pull_document', { p_doc: doc })).rejects.toThrow(/forbidden/);
    // Offline edits made before the revocation cannot be pushed with the old authorisation.
    await expect(as(bob).rpc('collab_save_document', { p_doc: doc, p_base_rev: pulled.rev, p_title: 'x', p_content: notebook(lyricsBlock('l', 'tarde')), p_op_id: fresh() })).rejects.toThrow(/forbidden/);
    await expect(as(bob).rpc('collab_add_comment', { p_doc: doc, p_comment: { text: 'tarde' } })).rejects.toThrow(/forbidden/);
    expect((await as(bob).rpc<{ documents: Array<{ id: string }> }>('shared_with_me')).documents.map((item) => item.id)).not.toContain(doc);
    expect(JSON.stringify((await h.admin.sql('select payload from public.documents where id = $1', [doc]))[0].payload)).not.toContain('tarde');
    // Re-inviting restores access with a new invitation.
    expect((await accept(bob, (await invite(doc, 'viewer')).token, 'Bob')).ok).toBe(true);
    expect((await as(bob).rpc<{ role: string }>('collab_pull_document', { p_doc: doc })).role).toBe('viewer');
  });
});

describe('markers — which projects are shared', () => {
  it('counts active links, members and pending invitations for the owner only', async () => {
    const doc = await h.newDocument(owner, 'Marcada', content('m'));
    expect((await as(owner).rpc<Array<{ id: string }>>('shared_by_me')).map((item) => item.id)).not.toContain(doc);
    const link = await shareLink(doc);
    await invite(doc, 'viewer');
    const mine = await as(owner).rpc<Array<{ id: string; links: number; members: number; invites: number }>>('shared_by_me');
    expect(mine.find((item) => item.id === doc)).toMatchObject({ links: 1, members: 0, invites: 1 });
    await as(owner).rpc('share_revoke_link', { p_link_id: link.id });
    expect(((await as(owner).rpc<Array<{ id: string; links: number }>>('shared_by_me')).find((item) => item.id === doc))?.links).toBe(0);
    expect(await as(eve).rpc('shared_by_me')).toEqual([]); // nobody sees another person's sharing
    await expect(as(null).rpc('shared_by_me')).rejects.toThrow(/permission denied|not authenticated/);
  });
});

describe('G — sharing a folder', () => {
  it('shows the exact scope first, reaches everything inside (including subfolders), and nothing else', async () => {
    const scope = await as(owner).rpc<{ documents: Array<{ title: string }> }>('share_preview_scope', { p_kind: 'node', p_id: temaFolder });
    expect(scope.documents.map((doc) => doc.title).sort()).toEqual(['Idea suelta', 'Letra', 'Solo']);
    await accept(eve, (await invite(temaFolder, 'editor', 'node')).token, 'Eve');
    const listed = await as(eve).rpc<{ documents: Array<{ title: string; role: string }>; folders: Array<{ name: string }> }>('shared_with_me');
    expect(listed.documents.map((doc) => doc.title).sort()).toEqual(['Idea suelta', 'Letra', 'Solo']);
    expect(listed.folders.map((folder) => folder.name)).toEqual(['Tema 1 FT Goti']);
    for (const hidden of [secret, loose]) await expect(as(eve).rpc('collab_pull_document', { p_doc: hidden })).rejects.toThrow(/forbidden/);
    expect((await as(eve).rpc<{ role: string }>('collab_pull_document', { p_doc: nested })).role).toBe('editor');
  });

  it('follows containment: a new document appears, one moved out disappears, one moved in appears, a trashed folder suspends access', async () => {
    const added = await h.newDocument(owner, 'Nueva en la carpeta', content('n'), temaFolder);
    expect((await as(eve).rpc<{ role: string }>('collab_pull_document', { p_doc: added })).role).toBe('editor');
    await h.admin.sql('update public.documents set node_id = $1 where id = $2', [privateFolder, added]); // moved out
    await expect(as(eve).rpc('collab_pull_document', { p_doc: added })).rejects.toThrow(/forbidden/);
    await h.admin.sql('update public.documents set node_id = $1 where id = $2', [subFolder, loose]); // moved in (deep)
    expect((await as(eve).rpc<{ role: string }>('collab_pull_document', { p_doc: loose })).role).toBe('editor');
    await h.admin.sql('update public.documents set node_id = null where id = $1', [loose]);
    await expect(as(eve).rpc('collab_pull_document', { p_doc: loose })).rejects.toThrow(/forbidden/);
    await h.admin.sql('update public.library_nodes set deleted_at = now() where id = $1', [temaFolder]);
    await expect(as(eve).rpc('collab_pull_document', { p_doc: letra })).rejects.toThrow(/forbidden/);
    await h.admin.sql('update public.library_nodes set deleted_at = null where id = $1', [temaFolder]);
    expect((await as(eve).rpc<{ role: string }>('collab_pull_document', { p_doc: letra })).role).toBe('editor');
  });

  it('a folder link reads the whole folder anonymously and nothing outside it; revoking ends it; another owner cannot share my folder', async () => {
    const link = await as(owner).rpc<Link>('share_create_link', { p_kind: 'node', p_id: temaFolder });
    const read = await as(null).rpc<{ ok: boolean; kind: string; title: string; documents: Array<{ title: string }> }>('share_read', { p_token: link.token });
    expect(read).toMatchObject({ ok: true, kind: 'node', title: 'Tema 1 FT Goti' });
    expect(read.documents.map((doc) => doc.title).sort()).toEqual(['Idea suelta', 'Letra', 'Solo']);
    expect(JSON.stringify(read)).not.toContain('SECRETO');
    await expect(as(eve).rpc('share_create_link', { p_kind: 'node', p_id: temaFolder })).rejects.toThrow(/forbidden/);
    await as(owner).rpc('share_revoke_link', { p_link_id: link.id });
    expect(await as(null).rpc('share_read', { p_token: link.token })).toEqual({ ok: false, reason: 'invalid' });
  });

  it('revoking the folder member ends access to every document in it at once', async () => {
    const members = (await as(owner).rpc<{ members: Array<{ id: string; label: string }> }>('share_overview', { p_kind: 'node', p_id: temaFolder })).members;
    await as(owner).rpc('share_revoke_member', { p_member_id: members[0].id });
    for (const doc of [letra, solo, nested]) await expect(as(eve).rpc('collab_pull_document', { p_doc: doc })).rejects.toThrow(/forbidden/);
  });
});

describe('H — adversarial checks', () => {
  it('invented, malformed and empty tokens never reveal anything', async () => {
    for (const token of ['', 'a', 'x'.repeat(200), "' or 1=1 --", '../../etc/passwd']) {
      expect(await as(null).rpc('share_link_info', { p_token: token })).toEqual({ valid: false, reason: 'invalid' });
      expect(await as(null).rpc('share_read', { p_token: token })).toEqual({ ok: false, reason: 'invalid' });
      expect(await as(null).rpc('share_unlock', { p_token: token, p_password: 'whatever12' })).toEqual({ ok: false, reason: 'invalid' });
    }
  });

  it('no role can read or write the sharing tables, the private schema, or other people\'s rows directly', async () => {
    for (const who of [null, eve, bob]) {
      const asWho = as(who);
      for (const table of ['share_members', 'share_invites', 'share_links', 'share_sessions', 'share_activity', 'collab_ops']) {
        await expect(asWho.sql(`select * from public.${table}`)).rejects.toThrow(/permission denied/);
        await expect(asWho.sql(`delete from public.${table}`)).rejects.toThrow(/permission denied/);
      }
      await expect(asWho.sql('select private.new_token()')).rejects.toThrow(/permission denied/);
    }
    await expect(as(eve).sql(`insert into public.share_members(owner_id, resource_kind, resource_id, user_id, role) values ($1, 'document', $2, $1, 'editor')`, [eve, secret])).rejects.toThrow(/permission denied/);
    expect(await as(eve).sql('select * from public.document_versions')).toEqual([]); // private history stays private
    expect(await as(eve).sql('select * from public.library_nodes')).toEqual([]);
  });

  it('existence is not an oracle: a missing document and a forbidden one answer the same way', async () => {
    const missing = await as(eve).rpc('collab_pull_document', { p_doc: fresh() }).catch((error: Error) => error.message);
    const forbidden = await as(eve).rpc('collab_pull_document', { p_doc: secret }).catch((error: Error) => error.message);
    expect(missing).toMatch(/forbidden/);
    expect(forbidden).toBe(missing);
  });

  it('the overview and the activity feed never contain tokens, hashes, passwords or e-mail addresses', async () => {
    const doc = await h.newDocument(owner, 'Privacidad', content('p'));
    const link = await shareLink(doc, { p_password: 'clave-segura-1' });
    const inv = await invite(doc, 'editor');
    await accept(bob, inv.token, 'Goti');
    const overview = JSON.stringify(await as(owner).rpc('share_overview', { p_kind: 'document', p_id: doc }));
    const activity = JSON.stringify(await as(owner).rpc('collab_activity', { p_kind: 'document', p_id: doc }));
    for (const text of [overview, activity]) {
      expect(text).not.toContain(link.token);
      expect(text).not.toContain(inv.token);
      expect(text).not.toContain('clave-segura-1');
      expect(text).not.toContain('$2a$');
      expect(text).not.toContain('example.com');
      expect(text).not.toContain('token_hash');
    }
    expect(overview).toContain('"hasPassword": true'.replace(': ', ':'));
    const feed = await as(owner).rpc<Array<{ action: string; actor: string | null }>>('collab_activity', { p_kind: 'document', p_id: doc });
    expect(feed.map((entry) => entry.action)).toEqual(expect.arrayContaining(['link_created', 'invite_created', 'invite_accepted']));
    // An editor reads the feed (with names, not e-mails); a viewer and a stranger cannot.
    expect(Array.isArray(await as(bob).rpc('collab_activity', { p_kind: 'document', p_id: doc }))).toBe(true);
    await expect(as(eve).rpc('collab_activity', { p_kind: 'document', p_id: doc })).rejects.toThrow(/forbidden/);
  });

  it('collab_save refuses non-object content and unreasonably large payloads, and cannot be used to write another account\'s document', async () => {
    const doc = await h.newDocument(owner, 'Validación', content('v'));
    await accept(bob, (await invite(doc, 'editor')).token, 'Bob');
    await expect(as(bob).rpc('collab_save_document', { p_doc: doc, p_base_rev: 1, p_title: 'x', p_content: [1, 2], p_op_id: fresh() })).rejects.toThrow(/invalid content/);
    await expect(as(bob).rpc('collab_save_document', { p_doc: doc, p_base_rev: 1, p_title: 'x', p_content: { blob: 'x'.repeat(4_100_000) }, p_op_id: fresh() })).rejects.toThrow(/invalid content/);
    // Sharing a document never lets the editor change who owns it or where it lives.
    const before = (await h.admin.sql('select owner_id, node_id, song_id from public.documents where id = $1', [doc]))[0];
    await as(bob).rpc('collab_save_document', { p_doc: doc, p_base_rev: 1, p_title: 'Nuevo título', p_content: notebook(lyricsBlock('l', 'x')), p_op_id: fresh() });
    expect((await h.admin.sql('select owner_id, node_id, song_id from public.documents where id = $1', [doc]))[0]).toEqual(before);
  });

  it('the existing private-library security is unchanged: owners still cannot see each other\'s rows or use the legacy RPCs', async () => {
    expect((await as(owner).sql('select id from public.documents')).length).toBeGreaterThan(0);
    expect(await as(bob).sql('select id from public.documents')).toEqual([]);
    await expect(as(bob).rpc('update_document', { p_id: letra, p_base_rev: 1, p_payload: {}, p_title: 'x' })).rejects.toThrow(/permission denied/);
    await expect(as(bob).rpc('sync_library', { p_owner_id: owner, p_op_id: fresh(), p_snapshot: { documents: [], nodes: [], versions: [] } })).rejects.toThrow(/owner mismatch/);
  });
});

describe('Q — hardening found in the final audit (rate limiting, titles, comments, expiry)', () => {
  type Unlock = { ok: boolean; reason?: string; scope?: string; retryAfterSeconds?: number; session?: string };
  const unlockFrom = (ip: string | null, token: string, password: string) =>
    h.as('anon', null, ip ? { 'cf-connecting-ip': ip } : undefined).rpc<Unlock>('share_unlock', { p_token: token, p_password: password });

  it('every lock-out on a link lasts twice as long as the previous one, and a correct password resets it', async () => {
    const link = await shareLink(letra, { p_password: 'cancion-escalada' });
    const fail = async () => { for (let i = 0; i < 5; i += 1) await unlockFrom(null, link.token, 'mal-mal-mal'); };
    await fail();
    const first = await unlockFrom(null, link.token, 'cancion-escalada');
    expect(first.reason).toBe('locked');
    expect(first.retryAfterSeconds).toBeGreaterThan(800);
    expect(first.retryAfterSeconds).toBeLessThanOrEqual(900);
    await h.admin.sql(`update public.share_links set locked_until = now() - interval '1 second' where id = $1`, [link.id]);
    await fail();
    const second = await unlockFrom(null, link.token, 'cancion-escalada');
    expect(second.retryAfterSeconds).toBeGreaterThan(1700);
    expect(second.retryAfterSeconds).toBeLessThanOrEqual(1800);
    await h.admin.sql(`update public.share_links set locked_until = now() - interval '1 second' where id = $1`, [link.id]);
    expect((await unlockFrom(null, link.token, 'cancion-escalada')).ok).toBe(true);
    expect((await h.admin.sql('select lockouts from public.share_links where id = $1', [link.id]))[0].lockouts).toBe(0);
  });

  it('one network address is stopped after 20 failures, on any link; others and the right password elsewhere are unaffected', async () => {
    const a = await shareLink(letra, { p_password: 'password-link-a' });
    const b = await shareLink(solo, { p_password: 'password-link-b' });
    // 20 failures spread over unknown tokens (token guessing counts too) and a known link.
    for (let i = 0; i < 15; i += 1) await unlockFrom('203.0.113.9', `token-inventado-${i}`, 'x');
    for (let i = 0; i < 4; i += 1) await unlockFrom('203.0.113.9', a.token, 'mal-mal-mal');
    expect((await unlockFrom('203.0.113.9', b.token, 'mal-mal-mal')).reason).toBe('wrong_password'); // the 20th
    const blocked = await unlockFrom('203.0.113.9', b.token, 'password-link-b'); // even the right password
    expect(blocked).toMatchObject({ ok: false, reason: 'locked', scope: 'network' });
    expect(blocked.retryAfterSeconds).toBeGreaterThan(3000);
    // Another address is not affected, and neither is a request that carries no address.
    expect((await unlockFrom('203.0.113.10', b.token, 'password-link-b')).ok).toBe(true);
    expect((await unlockFrom(null, b.token, 'password-link-b')).ok).toBe(true);
    // The address is stored only as a hash.
    const rows = await h.admin.sql(`select encode(ip_hash, 'hex') as ip from public.share_unlock_ip`);
    expect(JSON.stringify(rows)).not.toContain('203.0.113');
    // The window ends: the address can try again.
    await h.admin.sql(`update public.share_unlock_ip set window_start = now() - interval '61 minutes'`);
    expect((await unlockFrom('203.0.113.9', b.token, 'password-link-b')).ok).toBe(true);
  });

  it('a password-protected link does not even reveal the project title before the password', async () => {
    const link = await shareLink(letra, { p_password: 'password-titulo' });
    const info = await as(null).rpc<Record<string, unknown>>('share_link_info', { p_token: link.token });
    expect(info).toMatchObject({ valid: true, requiresPassword: true, title: null });
    expect(JSON.stringify(info)).not.toContain('Letra');
  });

  it('an invited viewer receives the music without the personal comments; a commenter still sees them', async () => {
    const target = await h.newDocument(owner, 'Con notas', { ...content('con notas'), comments: [{ id: 'c9', text: 'NOTA-PERSONAL', createdAt: 1, updatedAt: 1 }] });
    await accept(dave, (await invite(target, 'viewer')).token, 'Dave');
    await accept(carol, (await invite(target, 'commenter')).token, 'Carol');
    const viewer = await as(dave).rpc<{ content: Record<string, unknown> }>('collab_pull_document', { p_doc: target });
    expect(JSON.stringify(viewer)).toContain('con notas');
    expect(JSON.stringify(viewer)).not.toContain('NOTA-PERSONAL');
    const commenter = await as(carol).rpc('collab_pull_document', { p_doc: target });
    expect(JSON.stringify(commenter)).toContain('NOTA-PERSONAL');
  });

  it('an invitation cannot be created already expired or valid for more than 90 days', async () => {
    const make = (when: string) => as(owner).rpc('share_create_invite', { p_kind: 'document', p_id: letra, p_role: 'viewer', p_expires: when });
    await expect(make(new Date(Date.now() - 1000).toISOString())).rejects.toThrow(/expiry/);
    await expect(make(new Date(Date.now() + 120 * 86400_000).toISOString())).rejects.toThrow(/expiry/);
    await expect(make(new Date(Date.now() + 30 * 86400_000).toISOString())).resolves.toBeTruthy();
  });
});
