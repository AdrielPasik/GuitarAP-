// @vitest-environment node
import { execFileSync } from 'node:child_process';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/data/database';
import { libraryRepository } from '@/data/library-repository';
import { activeOwnerId } from '@/data/library-scope';
import { linkLibrary } from '@/features/account/account-data';
import { SyncEngine } from '@/features/sync/engine';
import { SupabaseTransport, SyncTransportError } from '@/features/sync/transport';
import { REAL_STACK, startGateway } from './proxy';

/**
 * The client's REAL sync engine and transport against the real stack (Supabase Postgres + GoTrue + PostgREST in
 * containers, tests/real-stack/docker-compose.yml). The local library lives in fake-indexeddb: it is a test database,
 * never anyone's real IndexedDB. Run with `npm run test:real-stack`.
 */
const enabled = Boolean(process.env.REAL_STACK);
const GATEWAY = `http://127.0.0.1:${REAL_STACK.gateway}`;
const psql = (sql: string) =>
  execFileSync('docker', ['exec', '-i', 'guitarap-real-stack-db-1', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-q'], { input: sql, encoding: 'utf8' }).trim();

type Account = { id: string; token: string };
async function signUp(label: string): Promise<Account> {
  const email = `${label}-${crypto.randomUUID().slice(0, 8)}@guitarap-test.invalid`;
  const response = await fetch(`${GATEWAY}/auth/v1/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'una-clave-larga-de-prueba' }) });
  const body = (await response.json()) as { access_token?: string; user?: { id: string } };
  if (!body.access_token || !body.user) throw new Error(`sign-up failed: ${JSON.stringify(body)}`);
  return { id: body.user.id, token: body.access_token };
}
const engineFor = (account: Account) => new SyncEngine(new SupabaseTransport(GATEWAY, 'anon-key-not-checked', account.token));
async function wipeLocal() {
  await db.transaction('rw', db.nodes, db.documents, db.versions, db.settings, async () => {
    await Promise.all([db.nodes.clear(), db.documents.clear(), db.versions.clear(), db.settings.clear()]);
  });
}

/**
 * A library shaped like a real one, with ids chosen so that, in IndexedDB's key order, every CHILD folder comes before
 * its PARENT. The old client sent nodes in that order and the server (0006) rejects a child whose parent it has not
 * stored yet.
 */
async function buildLibrary() {
  const now = Date.now();
  const ownerId = (await activeOwnerId()) ?? undefined;
  const node = (id: string, name: string, kind: 'folder' | 'song', parentId: string | null, order: number) => ({ id, name, kind, parentId, order, createdAt: now, updatedAt: now, rev: 1, ownerId });
  // The first group fixes the key order (children before parents); the rest is random so every run uses its own ids.
  const id = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(9)}`;
  const ids = {
    escalas: id('ffffffff'),
    modos: id('00000000'),
    proyectos: id('eeeeeeee'),
    tema: id('11111111'),
    otro: id('22222222'),
  };
  await db.nodes.bulkPut([
    node(ids.escalas, 'ESCALAS', 'folder', null, 1),
    node(ids.modos, 'Modos', 'folder', ids.escalas, 1),
    node(ids.proyectos, 'Proyectos', 'folder', null, 2),
    node(ids.tema, 'Tema 1 ft Gottya', 'song', ids.proyectos, 1),
    node(ids.otro, 'Otro tema', 'song', ids.proyectos, 2),
  ]);
  const letra = await libraryRepository.createDocument('tablature', 'Letra y melodía', ids.proyectos, ids.tema);
  const arreglos = await libraryRepository.createDocument('tablature', 'Arreglos', ids.proyectos, ids.tema);
  const mapa = await libraryRepository.createDocument('tablature', 'Do jónico', ids.modos);
  const otro = await libraryRepository.createDocument('tablature', 'Parte del otro tema', ids.proyectos, ids.otro);
  const content = (text: string) => ({ kind: 'notebook', version: 1, blocks: [{ id: 'l1', kind: 'lyrics', content: { text } }] });
  for (const [doc, text] of [[letra, 'Hoy vuelvo a empezar'], [arreglos, 'Intro: Fa Sib Do'], [mapa, 'mapa'], [otro, 'otro']] as const) {
    await libraryRepository.saveDocument({ ...(await db.documents.get(doc.id))!, content: content(text) as never, rev: doc.rev + 1 }, 'manual');
  }
  return { ids, docs: { letra: letra.id, arreglos: arreglos.id, mapa: mapa.id, otro: otro.id } };
}

describe.skipIf(!enabled)('the client sync engine against the real stack', () => {
  let server: Server;
  let owner: Account;
  beforeAll(async () => {
    server = await startGateway();
  });
  afterAll(() => {
    server.close();
  });
  beforeEach(async () => {
    await wipeLocal();
    owner = await signUp('sync');
    await linkLibrary(owner.id);
    expect(await activeOwnerId()).toBe(owner.id);
  });

  it('uploads a hierarchical library whose children sort before their parents (the first sync)', async () => {
    const { ids, docs } = await buildLibrary();
    const keyOrder = (await db.nodes.where('ownerId').equals(owner.id).toArray()).map((n) => n.name);
    expect(keyOrder.indexOf('Modos')).toBeLessThan(keyOrder.indexOf('ESCALAS')); // the adverse order is really present

    const report = await engineFor(owner).sync(owner.id).catch((error: unknown) => {
      if (error instanceof SyncTransportError) console.log('SYNC-ERROR', JSON.stringify(error.detail));
      throw error;
    });
    expect(report.offline).toBe(false);
    expect(report.conflicts).toBe(0);

    expect(psql(`select count(*) from public.library_nodes where owner_id = '${owner.id}'`)).toBe('5');
    expect(psql(`select count(*) from public.documents where owner_id = '${owner.id}'`)).toBe('4');
    // The project and its two parts keep their identity and relationships.
    expect(psql(`select name || ':' || kind || ':' || coalesce(parent_id::text, '') from public.library_nodes where id = '${ids.tema}'`)).toBe(`Tema 1 ft Gottya:song:${ids.proyectos}`);
    expect(psql(`select string_agg(title, ',' order by title) from public.documents where song_id = '${ids.tema}'`)).toBe('Arreglos,Letra y melodía');
    expect(psql(`select song_id::text from public.documents where id = '${docs.otro}'`)).toBe(ids.otro);
    expect(psql(`select parent_id::text from public.library_nodes where id = '${ids.modos}'`)).toBe(ids.escalas);
  });

  it('a document edited several times between two syncs is accepted, not reported as a conflict', async () => {
    const { docs } = await buildLibrary();
    await engineFor(owner).sync(owner.id);
    // Three autosaves in a row: the local revision jumps by three while the server still has the old one.
    for (const text of ['uno', 'dos', 'tres']) {
      const current = (await db.documents.get(docs.letra))!;
      await libraryRepository.saveDocument({ ...current, content: { kind: 'notebook', version: 1, blocks: [{ id: 'l1', kind: 'lyrics', content: { text } }] } as never });
    }
    const report = await engineFor(owner).sync(owner.id);
    expect(report.conflicts).toBe(0);
    expect(psql(`select payload->'blocks'->0->'content'->>'text' from public.documents where id = '${docs.letra}'`)).toBe('tres');
  });

  const rpc = async (name: string, args: Record<string, unknown>, token?: string) => {
    const response = await fetch(`${GATEWAY}/rest/v1/rpc/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(args) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  const text = (value: string) => ({ kind: 'notebook', version: 1, blocks: [{ id: 'l1', kind: 'lyrics', content: { text: value } }] }) as never;
  const edit = async (id: string, value: string) => {
    const current = (await db.documents.get(id))!;
    await libraryRepository.saveDocument({ ...current, content: text(value) });
  };
  const lyricsOf = async (id: string) => ((await db.documents.get(id))!.content as unknown as { blocks: Array<{ content: { text: string } }> }).blocks[0].content.text;
  const titles = (items: Array<{ title: string }>) => items.map((d) => d.title).sort();

  it('a second clean device downloads the whole library; edits cross both ways; repeating creates no duplicates', async () => {
    const { ids, docs } = await buildLibrary();
    await engineFor(owner).sync(owner.id);
    const snapshotA = {
      nodes: (await db.nodes.toArray()).map((n) => [n.id, n.name, n.parentId, n.kind]).sort(),
      docs: (await db.documents.toArray()).map((d) => [d.id, d.title, d.nodeId, d.songId]).sort(),
    };

    // Device B: nothing local, same account.
    await wipeLocal();
    await linkLibrary(owner.id);
    const second = engineFor(owner);
    const pulled = await second.sync(owner.id);
    expect(pulled.pulled).toBeGreaterThanOrEqual(9);
    expect({
      nodes: (await db.nodes.toArray()).map((n) => [n.id, n.name, n.parentId, n.kind]).sort(),
      docs: (await db.documents.toArray()).map((d) => [d.id, d.title, d.nodeId, d.songId]).sort(),
    }).toEqual(snapshotA);
    expect((await db.documents.get(docs.letra))!.songId).toBe(ids.tema); // the part still belongs to the project

    // B edits twice; the server takes it as ONE update.
    await edit(docs.letra, 'B uno');
    await edit(docs.letra, 'B dos');
    const pushedB = await second.sync(owner.id);
    expect(pushedB.conflicts).toBe(0);
    expect(psql(`select payload->'blocks'->0->'content'->>'text' from public.documents where id = '${docs.letra}'`)).toBe('B dos');

    // A third clean device receives B's edit.
    await wipeLocal();
    await linkLibrary(owner.id);
    await engineFor(owner).sync(owner.id);
    expect(await lyricsOf(docs.letra)).toBe('B dos');

    // Repeating changes nothing: no duplicates anywhere.
    for (let i = 0; i < 3; i += 1) await engineFor(owner).sync(owner.id);
    expect(psql(`select count(*) from public.library_nodes where owner_id = '${owner.id}'`)).toBe('5');
    expect(psql(`select count(*) from public.documents where owner_id = '${owner.id}'`)).toBe('4');
    expect(await db.nodes.count()).toBe(5);
    expect(await db.documents.count()).toBe(4);
  });

  it('both devices edit the same document: the server version stays, the version on this device is kept as a copy, nothing is lost', async () => {
    const { docs } = await buildLibrary();
    await engineFor(owner).sync(owner.id);
    const deviceA = await db.documents.toArray();
    const nodesA = await db.nodes.toArray();
    // Device B edits and uploads.
    await wipeLocal();
    await linkLibrary(owner.id);
    await engineFor(owner).sync(owner.id);
    await edit(docs.letra, 'cambio de B');
    await engineFor(owner).sync(owner.id);
    // Device A comes back (it still has its old copy) with its own edit of the same document.
    await wipeLocal();
    await linkLibrary(owner.id);
    await db.nodes.bulkPut(nodesA);
    await db.documents.bulkPut(deviceA);
    await edit(docs.letra, 'cambio de A sin conexion'); // same revision NUMBER as B's edit: the numbers coincide by chance
    const report = await engineFor(owner).sync(owner.id);
    // The server's version is the document now; this device's version was kept as a visible copy; both are on the server.
    expect(report.copies).toHaveLength(1);
    expect(await lyricsOf(docs.letra)).toBe('cambio de B');
    const copy = (await db.documents.toArray()).find((d) => d.title.includes('(copia de este dispositivo)'))!;
    expect(copy.title).toBe('Letra y melodía (copia de este dispositivo)');
    expect((copy.content as unknown as { blocks: Array<{ content: { text: string } }> }).blocks[0].content.text).toBe('cambio de A sin conexion');
    expect(psql(`select payload->'blocks'->0->'content'->>'text' from public.documents where id = '${docs.letra}'`)).toBe('cambio de B');
    expect(psql(`select payload->'blocks'->0->'content'->>'text' from public.documents where id = '${copy.id}'`)).toBe('cambio de A sin conexion');
    expect(psql(`select count(*) from public.documents where owner_id = '${owner.id}'`)).toBe('5');
    // Syncing again changes nothing (no endless conflicts, no more copies).
    const again = await engineFor(owner).sync(owner.id);
    expect(again.copies).toHaveLength(0);
    expect(psql(`select count(*) from public.documents where owner_id = '${owner.id}'`)).toBe('5');
  });

  it('error cases lose nothing: an invalid session, a lost connection and a transient server error', async () => {
    await buildLibrary();
    const before = JSON.stringify((await db.documents.toArray()).map((d) => [d.id, d.rev, d.title]).sort());

    // 1. A session the server does not accept.
    const bad = new SyncEngine(new SupabaseTransport(GATEWAY, 'anon-key-not-checked', 'not-a-valid-jwt'));
    const failure = (await bad.sync(owner.id).catch((e: unknown) => e)) as SyncTransportError;
    expect(failure).toBeInstanceOf(SyncTransportError);
    expect(failure.detail?.kind).toBe('auth');
    expect(failure.retryable).toBe(false);
    expect(JSON.stringify((await db.documents.toArray()).map((d) => [d.id, d.rev, d.title]).sort())).toBe(before);
    expect(psql(`select count(*) from public.documents where owner_id = '${owner.id}'`)).toBe('0');

    // 2. No connection at all (nothing listens there): the engine reports "offline" and keeps everything.
    const offline = await new SyncEngine(new SupabaseTransport('http://127.0.0.1:1', 'x', owner.token), 1).sync(owner.id);
    expect(offline.offline).toBe(true);
    expect(JSON.stringify((await db.documents.toArray()).map((d) => [d.id, d.rev, d.title]).sort())).toBe(before);

    // 3. The server applies the batch but the answer is lost: the replay is answered from the server's record.
    let first = true;
    const real = new SupabaseTransport(GATEWAY, 'x', owner.token);
    const flaky = {
      pull: (o: string, c: string, l: number) => real.pull(o, c, l),
      async push(o: string, op: string, snapshot: Parameters<SupabaseTransport['push']>[2]) {
        if (first) {
          first = false;
          await real.push(o, op, snapshot);
          throw new SyncTransportError('503', true, 503);
        }
        return real.push(o, op, snapshot);
      },
    };
    const report = await new SyncEngine(flaky).sync(owner.id);
    expect(report.offline).toBe(false);
    expect(psql(`select count(*) from public.documents where owner_id = '${owner.id}'`)).toBe('4');
    expect(psql(`select count(*) from public.sync_operations where owner_id = '${owner.id}'`)).toBe(String(report.requests));
  });

  it('the whole song project is shareable: scope, link, invitation, editor, and no other project is reachable', async () => {
    const { ids, docs } = await buildLibrary();
    await engineFor(owner).sync(owner.id);
    const friend = await signUp('friend');

    const scope = await rpc('share_preview_scope', { p_kind: 'node', p_id: ids.tema }, owner.token);
    expect(scope.status).toBe(200);
    expect(titles(scope.body.documents)).toEqual(['Arreglos', 'Letra y melodía']);

    const link = (await rpc('share_create_link', { p_kind: 'node', p_id: ids.tema }, owner.token)).body as { token: string };
    const read = (await rpc('share_read', { p_token: link.token })).body;
    expect(read.ok).toBe(true);
    expect(read.kind).toBe('node');
    expect(read.title).toBe('Tema 1 ft Gottya');
    expect(titles(read.documents)).toEqual(['Arreglos', 'Letra y melodía']);
    expect(JSON.stringify(read)).not.toMatch(/otro tema|Do jónico/i);

    // One invitation to the project: the friend is an editor of both parts and of nothing else.
    const invite = (await rpc('share_create_invite', { p_kind: 'node', p_id: ids.tema, p_role: 'editor' }, owner.token)).body as { token: string };
    expect((await rpc('share_accept_invite', { p_token: invite.token, p_label: 'Goti' }, friend.token)).body).toMatchObject({ ok: true, role: 'editor' });
    const mine = (await rpc('shared_with_me', {}, friend.token)).body;
    expect(titles(mine.documents)).toEqual(['Arreglos', 'Letra y melodía']);
    expect(mine.documents.every((d: { project: { name: string } }) => d.project.name === 'Tema 1 ft Gottya')).toBe(true);
    for (const closed of [docs.otro, docs.mapa]) expect((await rpc('collab_pull_document', { p_doc: closed }, friend.token)).status).toBe(403);
    const pulled = (await rpc('collab_pull_document', { p_doc: docs.arreglos }, friend.token)).body;
    const saved = await rpc('collab_save_document', { p_doc: docs.arreglos, p_base_rev: pulled.rev, p_title: 'Arreglos', p_content: text('editado por el amigo'), p_op_id: crypto.randomUUID() }, friend.token);
    expect(saved.body.conflict).toBe(false);

    // A part added later to the project is covered by the same share (inheritance), once it is synced.
    await libraryRepository.createDocument('tablature', 'Puente', ids.proyectos, ids.tema);
    await engineFor(owner).sync(owner.id);
    expect(titles((await rpc('shared_with_me', {}, friend.token)).body.documents)).toContain('Puente');

    // The owner's sync receives the friend's edit and keeps everything else.
    await engineFor(owner).sync(owner.id);
    expect(await lyricsOf(docs.arreglos)).toBe('editado por el amigo');

    // Revoking stops reads and writes at once.
    const members = (await rpc('share_overview', { p_kind: 'node', p_id: ids.tema }, owner.token)).body.members as Array<{ id: string }>;
    expect((await rpc('share_revoke_member', { p_member_id: members[0].id }, owner.token)).status).toBe(204);
    expect((await rpc('collab_pull_document', { p_doc: docs.arreglos }, friend.token)).status).toBe(403);
    expect((await rpc('shared_with_me', {}, friend.token)).body.documents).toEqual([]);
  });

  it('a normal folder is shareable too and exposes nothing outside it (siblings, other songs, trashed items)', async () => {
    const { ids, docs } = await buildLibrary();
    await libraryRepository.trashDocument(docs.mapa); // a trashed document inside the folder must not be exposed
    await engineFor(owner).sync(owner.id);
    expect((await rpc('share_preview_scope', { p_kind: 'node', p_id: ids.escalas }, owner.token)).body.documents).toEqual([]);
    await libraryRepository.restoreDocument(docs.mapa);
    await engineFor(owner).sync(owner.id);
    expect(titles((await rpc('share_preview_scope', { p_kind: 'node', p_id: ids.escalas }, owner.token)).body.documents)).toEqual(['Do jónico']);
    const link = (await rpc('share_create_link', { p_kind: 'node', p_id: ids.escalas }, owner.token)).body as { token: string };
    expect(JSON.stringify((await rpc('share_read', { p_token: link.token })).body)).not.toMatch(/Letra y melod|Arreglos|otro tema/i);
    // The project's link does not open the folder either.
    const projectLink = (await rpc('share_create_link', { p_kind: 'node', p_id: ids.tema }, owner.token)).body as { token: string };
    expect(JSON.stringify((await rpc('share_read', { p_token: projectLink.token })).body)).not.toContain('Do jónico');
  });
});

void SyncTransportError;
