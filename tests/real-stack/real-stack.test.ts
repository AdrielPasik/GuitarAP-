// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Validates the sharing migration against the REAL components of a Supabase project, in throw-away containers
 * (tests/real-stack/docker-compose.yml): Supabase's Postgres image, GoTrue (accounts and JWTs) and PostgREST (HTTP, role
 * switching from the JWT, request headers). Run with `npm run test:real-stack`; it is skipped otherwise.
 *
 * Everything here is test data created for this run. It never talks to a real Supabase project.
 */
const enabled = Boolean(process.env.REAL_STACK);
const AUTH = 'http://127.0.0.1:4321';
const REST = 'http://127.0.0.1:4322/';
const DB_CONTAINER = 'guitarap-real-stack-db-1';
const migrations = (name: string) => readFileSync(path.resolve('supabase/migrations', name), 'utf8');

const psql = (sql: string) =>
  execFileSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-q'], { input: sql, encoding: 'utf8' }).trim();

type Account = { id: string; token: string };
async function signUp(label: string): Promise<Account> {
  const email = `${label}-${crypto.randomUUID().slice(0, 8)}@guitarap-test.invalid`;
  const response = await fetch(`${AUTH}/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'una-clave-larga-de-prueba' }) });
  const body = (await response.json()) as { access_token?: string; user?: { id: string } };
  if (!body.access_token || !body.user) throw new Error(`sign-up failed: ${JSON.stringify(body)}`);
  return { id: body.user.id, token: body.access_token };
}

type Call = { status: number; body: ReturnType<typeof JSON.parse> };
async function rpc(name: string, args: Record<string, unknown> = {}, who?: Account | null, headers: Record<string, string> = {}): Promise<Call> {
  const response = await fetch(`${REST}rpc/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: 'anon-key-is-not-checked-by-postgrest', ...(who ? { authorization: `Bearer ${who.token}` } : {}), ...headers },
    body: JSON.stringify(args),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
async function get(pathAndQuery: string, who?: Account | null, headers: Record<string, string> = {}): Promise<Call> {
  const response = await fetch(`${REST}${pathAndQuery}`, { headers: { ...(who ? { authorization: `Bearer ${who.token}` } : {}), ...headers } });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const nb = (text: string) => ({ kind: 'notebook', version: 1, blocks: [{ id: 'l1', kind: 'lyrics', content: { text } }], comments: [{ id: 'c1', text: 'COMENTARIO-PERSONAL', createdAt: 1, updatedAt: 1 }] });
const insertDoc = (id: string, owner: string, title: string, payload: unknown, node: string | null) =>
  `insert into public.documents(id, owner_id, node_id, type, title, payload, rev) values ('${id}', '${owner}', ${node ? `'${node}'` : 'null'}, 'tablature', $t$${title}$t$, $j$${JSON.stringify(payload)}$j$::jsonb, 1);`;
const insertNode = (id: string, owner: string, name: string) =>
  `insert into public.library_nodes(id, owner_id, parent_id, kind, name, sort_order, rev, created_at, updated_at) values ('${id}', '${owner}', null, 'folder', $t$${name}$t$, 1, 1, now(), now());`;

describe.skipIf(!enabled)('sharing against real Postgres + GoTrue + PostgREST', () => {
  let owner: Account, bob: Account, carol: Account, eve: Account;
  const ids = { shared: crypto.randomUUID(), privateDoc: crypto.randomUUID(), loose: crypto.randomUUID(), folder: crypto.randomUUID(), privateFolder: crypto.randomUUID() };
  let before = '';
  const fingerprint = () => psql(`select md5(string_agg(id::text || title || payload::text || rev::text, '|' order by id)) from public.documents where owner_id = '${owner.id}'`);

  beforeAll(async () => {
    [owner, bob, carol, eve] = await Promise.all(['owner', 'bob', 'carol', 'eve'].map(signUp));
    psql([
      insertNode(ids.folder, owner.id, 'Tema de prueba (carpeta compartida)'),
      insertNode(ids.privateFolder, owner.id, 'Privado'),
      insertDoc(ids.shared, owner.id, 'Tema de prueba', nb('Hoy vuelvo a empezar'), ids.folder),
      insertDoc(ids.privateDoc, owner.id, 'Diario', nb('SECRETO-NO-COMPARTIR'), ids.privateFolder),
      insertDoc(ids.loose, owner.id, 'Suelto', nb('SECRETO-SUELTO'), null),
    ].join('\n'));
    before = fingerprint();
  }, 120_000);

  afterAll(() => {
    // Test data only: remove the accounts and rows this run created.
    try {
      psql(`delete from auth.users where id in ('${owner.id}', '${bob.id}', '${carol.id}', '${eve.id}')`);
    } catch {
      /* the stack is thrown away anyway */
    }
  });

  it('GoTrue issues real JWTs and PostgREST maps them to roles; the capability probe works for anonymous callers', async () => {
    expect((await rpc('collab_capabilities')).body).toEqual({ sharing: 1 });
    expect((await rpc('collab_capabilities', {}, owner)).body).toEqual({ sharing: 1 });
    expect((await rpc('shared_with_me')).status).toBeGreaterThanOrEqual(400); // anonymous cannot call authenticated functions
    expect((await rpc('shared_with_me', {}, owner)).status).toBe(200);
  });

  it('the browser keys cannot read or write the sharing tables, the private schema, or other people\'s documents', async () => {
    for (const table of ['share_links', 'share_members', 'share_invites', 'share_sessions', 'share_activity', 'collab_ops', 'share_unlock_ip']) {
      const anon = await get(`${table}?select=*`, null);
      const own = await get(`${table}?select=*`, owner);
      for (const call of [anon, own]) expect(call.status === 200 ? call.body : []).toEqual([]);
      expect(anon.status === 200 || [401, 403].includes(anon.status)).toBe(true);
    }
    expect((await get('documents?select=id', null)).body === null || (await get('documents?select=id', null)).status >= 400 || (await get('documents?select=id', null)).body.length === 0).toBe(true);
    expect((await get('documents?select=id', eve)).body).toEqual([]); // RLS: a stranger sees none of the owner's documents
    const privateSchema = await get('share_links?select=*', owner, { 'Accept-Profile': 'private' });
    expect(privateSchema.status).toBeGreaterThanOrEqual(400); // `private` is not an exposed schema
    const direct = await fetch(`${REST}documents?id=eq.${ids.shared}`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${owner.token}` }, body: JSON.stringify({ title: 'x' }) });
    expect(direct.status).toBeGreaterThanOrEqual(400); // writes to library tables stay RPC-only (0006)
  });

  it('a read-only link exposes one song, no comments, nothing else; a password link hides even the title', async () => {
    const open = (await rpc('share_create_link', { p_kind: 'document', p_id: ids.shared }, owner)).body as { id: string; token: string };
    const read = (await rpc('share_read', { p_token: open.token })).body;
    expect(read.ok).toBe(true);
    const text = JSON.stringify(read);
    expect(text).toContain('Hoy vuelvo a empezar');
    for (const leaked of ['COMENTARIO-PERSONAL', 'SECRETO', 'Diario', 'Suelto', 'owner_id', owner.id]) expect(text).not.toContain(leaked);

    const protectedLink = (await rpc('share_create_link', { p_kind: 'document', p_id: ids.shared, p_password: 'clave-de-prueba-1' }, owner)).body as { token: string };
    const info = (await rpc('share_link_info', { p_token: protectedLink.token })).body;
    expect(info).toMatchObject({ valid: true, requiresPassword: true, title: null });
    expect((await rpc('share_read', { p_token: protectedLink.token })).body).toMatchObject({ ok: false, reason: 'password_required' });
    expect((await rpc('share_unlock', { p_token: protectedLink.token, p_password: 'mal' })).body).toMatchObject({ ok: false, reason: 'wrong_password' });
    const unlocked = (await rpc('share_unlock', { p_token: protectedLink.token, p_password: 'clave-de-prueba-1' })).body;
    expect(unlocked.ok).toBe(true);
    expect(JSON.stringify((await rpc('share_read', { p_token: protectedLink.token, p_session: unlocked.session })).body)).toContain('Hoy vuelvo a empezar');
    expect((await rpc('share_read', { p_token: 'x'.repeat(43) })).body).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('rate limiting works through PostgREST: the per-address counter reads the real request headers', async () => {
    const link = (await rpc('share_create_link', { p_kind: 'document', p_id: ids.shared, p_password: 'clave-de-prueba-2' }, owner)).body as { token: string };
    const from = (ip: string) => ({ 'cf-connecting-ip': ip });
    for (let i = 0; i < 20; i += 1) await rpc('share_unlock', { p_token: `inventado-${i}-${'z'.repeat(30)}`, p_password: 'x' }, null, from('198.51.100.20'));
    const blocked = await rpc('share_unlock', { p_token: link.token, p_password: 'clave-de-prueba-2' }, null, from('198.51.100.20'));
    expect(blocked.body).toMatchObject({ ok: false, reason: 'locked', scope: 'network' });
    expect((await rpc('share_unlock', { p_token: link.token, p_password: 'clave-de-prueba-2' }, null, from('198.51.100.21'))).body.ok).toBe(true);
    // x-forwarded-for fallback: the last hop (added by the closest proxy) is the one that counts.
    for (let i = 0; i < 20; i += 1) await rpc('share_unlock', { p_token: `otro-${i}-${'z'.repeat(30)}`, p_password: 'x' }, null, { 'x-forwarded-for': '10.9.9.9, 198.51.100.30' });
    expect((await rpc('share_unlock', { p_token: link.token, p_password: 'clave-de-prueba-2' }, null, { 'x-forwarded-for': '1.1.1.1, 198.51.100.30' })).body.reason).toBe('locked');
    // Five wrong passwords on one link lock that link, independently of the address.
    const solo = (await rpc('share_create_link', { p_kind: 'document', p_id: ids.shared, p_password: 'clave-de-prueba-3' }, owner)).body as { token: string };
    for (let i = 0; i < 5; i += 1) await rpc('share_unlock', { p_token: solo.token, p_password: 'mal-mal-mal' }, null, from(`198.51.100.${40 + i}`));
    expect((await rpc('share_unlock', { p_token: solo.token, p_password: 'clave-de-prueba-3' }, null, from('198.51.100.99'))).body).toMatchObject({ ok: false, reason: 'locked' });
  });

  it('sharing one folder exposes only what is inside it; roles are enforced; every other document stays closed', async () => {
    const invite = async (role: string) => (await rpc('share_create_invite', { p_kind: 'node', p_id: ids.folder, p_role: role }, owner)).body as { token: string };
    expect((await rpc('share_accept_invite', { p_token: (await invite('editor')).token, p_label: 'Goti' }, bob)).body).toMatchObject({ ok: true, role: 'editor' });
    expect((await rpc('share_accept_invite', { p_token: (await invite('commenter')).token, p_label: 'Carol' }, carol)).body).toMatchObject({ ok: true, role: 'commenter' });

    const listed = (await rpc('shared_with_me', {}, bob)).body;
    expect(listed.documents.map((doc: { title: string }) => doc.title)).toEqual(['Tema de prueba']);
    expect(JSON.stringify(listed)).not.toMatch(/Diario|Suelto|SECRETO/);
    for (const closed of [ids.privateDoc, ids.loose]) {
      expect((await rpc('collab_pull_document', { p_doc: closed }, bob)).status).toBe(403);
      expect((await rpc('collab_save_document', { p_doc: closed, p_base_rev: 1, p_title: 'x', p_content: nb('hack'), p_op_id: crypto.randomUUID() }, bob)).status).toBe(403);
      expect((await rpc('collab_pull_document', { p_doc: closed }, eve)).status).toBe(403);
    }
    expect((await rpc('collab_pull_document', { p_doc: ids.shared }, eve)).status).toBe(403);
    expect((await rpc('share_create_link', { p_kind: 'document', p_id: ids.shared }, bob)).status).toBe(403); // an editor cannot share further
    expect((await rpc('share_overview', { p_kind: 'node', p_id: ids.folder }, bob)).status).toBe(403);

    // Editor: compare-and-swap save.
    const pulled = (await rpc('collab_pull_document', { p_doc: ids.shared }, bob)).body;
    const op = crypto.randomUUID();
    const saved = await rpc('collab_save_document', { p_doc: ids.shared, p_base_rev: pulled.rev, p_title: 'Tema de prueba', p_content: nb('Editado por Goti'), p_op_id: op }, bob);
    expect(saved.body).toMatchObject({ conflict: false, rev: pulled.rev + 1 });
    expect((await rpc('collab_save_document', { p_doc: ids.shared, p_base_rev: pulled.rev, p_title: 'Tema de prueba', p_content: nb('Editado por Goti'), p_op_id: op }, bob)).body).toEqual(saved.body); // idempotent
    const stale = await rpc('collab_save_document', { p_doc: ids.shared, p_base_rev: pulled.rev, p_title: 'x', p_content: nb('pisada'), p_op_id: crypto.randomUUID() }, bob);
    expect(stale.body.conflict).toBe(true);
    expect(JSON.stringify(stale.body)).toContain('Editado por Goti'); // the current version comes back, nothing was overwritten

    // Commenter: may comment, nothing else.
    expect((await rpc('collab_save_document', { p_doc: ids.shared, p_base_rev: pulled.rev + 1, p_title: 'x', p_content: nb('no'), p_op_id: crypto.randomUUID() }, carol)).status).toBe(403);
    expect((await rpc('collab_add_comment', { p_doc: ids.shared, p_comment: { text: 'Probar en Sol', blockId: 'l1' } }, carol)).status).toBe(200);

    // The owner's private sync receives the collaborator's changes through the ordinary change log.
    const page = (await rpc('pull_library', { p_owner_id: owner.id, p_after: '0', p_limit: 100 }, owner)).body;
    const change = page.changes.filter((item: { kind: string; record: { id: string } }) => item.kind === 'document' && item.record.id === ids.shared).at(-1);
    expect(JSON.stringify(change.record.content)).toContain('Probar en Sol');
    expect((await rpc('pull_library', { p_owner_id: owner.id, p_after: '0', p_limit: 10 }, bob)).status).toBeGreaterThanOrEqual(400); // not someone else's log
    expect((await rpc('sync_library', { p_owner_id: owner.id, p_op_id: crypto.randomUUID(), p_snapshot: { documents: [], nodes: [], versions: [] } }, owner)).status).toBe(200);
  });

  it('revoking stops new reads and writes at once, even with a still-valid JWT', async () => {
    const members = (await rpc('share_overview', { p_kind: 'node', p_id: ids.folder }, owner)).body.members as Array<{ id: string; label: string }>;
    const goti = members.find((member) => member.label === 'Goti')!;
    const rev = (await rpc('collab_pull_document', { p_doc: ids.shared }, bob)).body.rev;
    expect((await rpc('share_revoke_member', { p_member_id: goti.id }, owner)).status).toBe(204);
    expect((await rpc('collab_pull_document', { p_doc: ids.shared }, bob)).status).toBe(403);
    expect((await rpc('collab_save_document', { p_doc: ids.shared, p_base_rev: rev, p_title: 'x', p_content: nb('tarde'), p_op_id: crypto.randomUUID() }, bob)).status).toBe(403);
    expect((await rpc('shared_with_me', {}, bob)).body.documents).toEqual([]);
    // A revoked link answers the same way for everyone.
    const link = (await rpc('share_create_link', { p_kind: 'document', p_id: ids.shared }, owner)).body as { id: string; token: string };
    expect((await rpc('share_read', { p_token: link.token })).body.ok).toBe(true);
    await rpc('share_revoke_link', { p_link_id: link.id }, owner);
    expect((await rpc('share_read', { p_token: link.token })).body).toMatchObject({ ok: false, reason: 'invalid' });
    expect((await rpc('share_link_info', { p_token: link.token })).body).toMatchObject({ valid: false, reason: 'revoked' });
  });

  it('the owner\'s other documents were never touched, and the rollback / re-apply cycle leaves the library intact', async () => {
    const privateAfter = psql(`select payload::text from public.documents where id = '${ids.privateDoc}'`);
    expect(privateAfter).toContain('SECRETO-NO-COMPARTIR');
    expect(psql(`select rev from public.documents where id in ('${ids.privateDoc}', '${ids.loose}') order by id`).split('\n').every((rev) => rev === '1')).toBe(true);
    const mid = fingerprint();
    expect(mid).not.toBe(before); // only the shared song changed (the collaborator's edit), by design
    psql(migrations('0007_sharing_rollback.sql'));
    expect(fingerprint()).toBe(mid);
    expect((await rpc('collab_capabilities')).status).toBeGreaterThanOrEqual(400); // sharing is gone, and PostgREST noticed
    psql(migrations('0007_sharing.sql'));
    await new Promise((resolve) => setTimeout(resolve, 1500)); // PostgREST reloads its schema cache on NOTIFY
    expect(fingerprint()).toBe(mid);
    expect((await rpc('collab_capabilities')).body).toEqual({ sharing: 1 });
  }, 60_000);
});
