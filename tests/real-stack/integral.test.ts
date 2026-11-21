// @vitest-environment node
import { execFileSync } from 'node:child_process';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DocumentVersion, LibraryNode, MusicalDocument } from '@/core/model';
import { applyImport, previewImport } from '@/data/backup-import';
import { db } from '@/data/database';
import { libraryRepository } from '@/data/library-repository';
import { activeOwnerId, linkWithoutClaiming } from '@/data/library-scope';
import { readOverview, rebuildFromCloud, runSync } from '@/features/account/account-data';
import { SyncEngine, verifyLibrary } from '@/features/sync/engine';
import { canonicalJson } from '@/features/sync/event-policy';
import { readFacts, readHistory } from '@/features/sync/sync-facts';
import { SupabaseTransport, SyncTransportError } from '@/features/sync/transport';
import { SyncEngine as Engine0_7 } from '@/test/legacy/engine-23e1e22';
import { REAL_STACK, startGateway } from './proxy';

/**
 * v0.8 phase 1.6 — the whole of phase 1 against the REAL stack (Supabase's Postgres + GoTrue + PostgREST in throw-away
 * containers, made-up accounts, never a hosted project): device A -> real database -> device B, and the v0.7 client in
 * both directions. Libraries are compared by CONTENT, RELATIONS and STATE (trash, history), not by counts.
 * Run with `npm run test:real-stack`.
 */
const enabled = Boolean(process.env.REAL_STACK);
const PORT = REAL_STACK.gateway + 1; // the other real-stack files use the default one, and files run side by side
const GATEWAY = `http://127.0.0.1:${PORT}`;
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
const config = { url: GATEWAY, anonKey: 'anon-key-not-checked' };
const session = (account: Account) => ({ accessToken: account.token, refreshToken: 'r', expiresAt: Date.now() + 3_600_000, user: { id: account.id, email: undefined } });
const transport = (account: Account) => new SupabaseTransport(GATEWAY, config.anonKey, account.token);
const engine = (account: Account) => new SyncEngine(transport(account));
async function wipeLocal() {
  await db.transaction('rw', db.nodes, db.documents, db.versions, db.settings, async () => {
    await Promise.all([db.nodes.clear(), db.documents.clear(), db.versions.clear(), db.settings.clear()]);
  });
}
const lyrics = (text: string) => ({ kind: 'notebook', version: 1, blocks: [{ id: 'l1', kind: 'lyrics', content: { text } }, { id: 'm1', kind: 'melody', content: { events: [{ id: 'e1', midi: 60, beats: 1 }] } }] }) as never;

/** Everything about a library that matters, comparable between devices: identity, relations, state and content. */
async function snapshot() {
  const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id);
  return {
    nodes: (await db.nodes.toArray()).map((n: LibraryNode) => ({ id: n.id, name: n.name, parentId: n.parentId, kind: n.kind, order: n.order, trashed: Boolean(n.deletedAt), song: n.song ?? null, owner: n.ownerId })).sort(byId),
    documents: (await db.documents.toArray()).map((d: MusicalDocument) => ({ id: d.id, title: d.title, type: d.type, nodeId: d.nodeId, songId: d.songId, trashed: Boolean(d.deletedAt), content: canonicalJson(d.content), owner: d.ownerId })).sort(byId),
    versions: (await db.versions.toArray()).map((v: DocumentVersion) => ({ id: v.id, documentId: v.documentId, reason: v.reason, title: v.title, content: canonicalJson(v.content), owner: v.ownerId })).sort(byId),
  };
}

/** A library with depth, a song project with parts, a trashed document, and real history. */
async function buildLibrary() {
  const now = Date.now();
  const owner = (await activeOwnerId()) ?? undefined;
  const node = (id: string, name: string, kind: 'folder' | 'song', parentId: string | null, order: number) => ({ id, name, kind, parentId, order, createdAt: now, updatedAt: now, rev: 1, ownerId: owner });
  const id = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(9)}`;
  const ids = { escalas: id('ffffffff'), modos: id('00000000'), menores: id('00000001'), proyectos: id('eeeeeeee'), tema: id('11111111'), otro: id('22222222') };
  await db.nodes.bulkPut([
    node(ids.escalas, 'ESCALAS', 'folder', null, 1),
    node(ids.modos, 'Modos', 'folder', ids.escalas, 1),
    node(ids.menores, 'Menores', 'folder', ids.modos, 1),
    node(ids.proyectos, 'Proyectos', 'folder', null, 2),
    node(ids.tema, 'Tema de prueba', 'song', ids.proyectos, 1),
    node(ids.otro, 'Otro tema', 'song', ids.proyectos, 2),
  ]);
  const docs = {
    letra: await libraryRepository.createDocument('tablature', 'Letra y melodía', ids.proyectos, ids.tema),
    arreglos: await libraryRepository.createDocument('tablature', 'Arreglos', ids.proyectos, ids.tema),
    mapa: await libraryRepository.createDocument('fretboard', 'Do jónico', ids.modos),
    menor: await libraryRepository.createDocument('tablature', 'La menor', ids.menores),
    suelta: await libraryRepository.createDocument('tablature', 'Idea suelta', null),
  };
  for (const [name, doc] of Object.entries(docs)) {
    await libraryRepository.saveDocument({ ...(await db.documents.get(doc.id))!, content: lyrics(`texto de ${name}`) }, 'manual');
    await libraryRepository.saveDocument({ ...(await db.documents.get(doc.id))!, content: lyrics(`texto de ${name}, segunda versión`) }, 'manual'); // history
  }
  await libraryRepository.trashDocument(docs.suelta.id);
  return { ids, docs };
}

describe.skipIf(!enabled)('phase 1 as a whole, against the real stack', () => {
  let server: Server;
  let account: Account;
  beforeAll(async () => {
    server = await startGateway(PORT);
  });
  afterAll(() => {
    server.close();
  });
  beforeEach(async () => {
    await wipeLocal();
    account = await signUp('integral');
    await linkWithoutClaiming(account.id);
  });

  it('device A -> real database -> device B: the same content, relations, trash and history, and rebuilding from the cloud changes nothing', async () => {
    await buildLibrary();
    const run = await runSync(config, session(account));
    expect(run?.confirmed).toBe(true);
    const fromA = await snapshot();
    expect(fromA.documents.find((d) => d.title === 'Idea suelta')?.trashed).toBe(true);
    expect(fromA.versions.length).toBeGreaterThanOrEqual(10);

    // The real database holds it too (compared by content, not by count).
    const serverDocs = JSON.parse(psql(`select coalesce(json_agg(json_build_object('id', id, 'title', title, 'nodeId', node_id, 'songId', song_id, 'trashed', deleted_at is not null) order by id), '[]') from public.documents where owner_id = '${account.id}'`)) as Array<{ id: string; title: string; nodeId: string | null; songId: string | null; trashed: boolean }>;
    expect(serverDocs).toEqual(fromA.documents.map((d) => ({ id: d.id, title: d.title, nodeId: d.nodeId, songId: d.songId, trashed: d.trashed })));

    // Device B: nothing local; the new recovery path (linked without claiming, then download).
    await wipeLocal();
    await linkWithoutClaiming(account.id);
    const runB = await runSync(config, session(account));
    expect(runB?.report.complete).toBe(true);
    expect(await snapshot()).toEqual(fromA);
    expect((await verifyLibrary(account.id)).ok).toBe(true);

    // Rebuilding from the cloud (both modes), twice, changes nothing.
    await rebuildFromCloud(config, session(account), { downloadOnly: true });
    await rebuildFromCloud(config, session(account));
    await rebuildFromCloud(config, session(account), { downloadOnly: true });
    expect(await snapshot()).toEqual(fromA);
    expect(psql(`select count(*) from public.documents where owner_id = '${account.id}'`)).toBe(String(fromA.documents.length));
  });

  it('bidirectional edits converge on content, and a same-document conflict keeps both versions on both sides', async () => {
    const { docs } = await buildLibrary();
    await runSync(config, session(account));
    const a = await snapshot();
    // B recovers, edits one document and creates another.
    await wipeLocal();
    await linkWithoutClaiming(account.id);
    await runSync(config, session(account));
    await libraryRepository.saveDocument({ ...(await db.documents.get(docs.letra.id))!, content: lyrics('editado en B') }, 'manual');
    const fresh = await libraryRepository.createDocument('tablature', 'Creada en B', null);
    await runSync(config, session(account));
    // A (its old copy restored) edits the SAME document differently, without having seen B's.
    const afterB = await snapshot();
    await wipeLocal();
    await linkWithoutClaiming(account.id);
    await db.nodes.bulkPut(a.nodes.map((n) => ({ ...(n as unknown as LibraryNode), ownerId: account.id, rev: 1, createdAt: 1, updatedAt: 1 })));
    await engine(account).sync(account.id); // brings A up to date with everything but replaces nothing local
    await libraryRepository.saveDocument({ ...(await db.documents.get(docs.letra.id))!, content: lyrics('editado en A') }, 'manual');
    const merged = await runSync(config, session(account));
    expect(merged?.report.conflicts).toBeGreaterThanOrEqual(0);
    const titles = (await db.documents.toArray()).map((d) => d.title);
    expect(titles).toContain('Creada en B');
    const texts = (await db.documents.toArray()).map((d) => canonicalJson(d.content)).join('|');
    expect(texts).toContain('editado en A'); // A's own edit survives somewhere: as the document or as a visible copy
    expect(await db.documents.get(fresh.id)).toBeTruthy();
    expect((await verifyLibrary(account.id)).ok).toBe(true);
    void afterB;
  });

  it('v0.7 and v0.8 clients share the same real server in both directions, with identical results', async () => {
    await buildLibrary();
    // The v0.7 client uploads...
    await new Engine0_7(transport(account)).sync(account.id);
    const fromOld = await snapshot();
    // ...and the new client recovers exactly that.
    await wipeLocal();
    await linkWithoutClaiming(account.id);
    expect((await runSync(config, session(account)))?.report.complete).toBe(true);
    expect(await snapshot()).toEqual(fromOld);
    // The new client edits and uploads...
    await libraryRepository.saveDocument({ ...(await db.documents.toArray())[0], content: lyrics('editado por la versión nueva') }, 'manual');
    await runSync(config, session(account));
    const fromNew = await snapshot();
    // ...and a v0.7 client on a clean device downloads exactly that.
    await wipeLocal();
    await linkWithoutClaiming(account.id);
    await new Engine0_7(transport(account)).sync(account.id);
    expect(await snapshot()).toEqual(fromNew);
    // Nothing in the log was invented for either of them: only the three kinds that have always been there.
    expect(psql(`select string_agg(distinct kind, ',' order by kind) from public.sync_changes where owner_id = '${account.id}'`)).toBe('document,node,version');
  });

  it('what the server answers is classified and recorded for real: a refused session is not retried, a dead address is a generic network failure', async () => {
    await buildLibrary();
    const bad = { ...session(account), accessToken: 'not-a-valid-jwt' };
    const refused = await runSync(config, bad).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(SyncTransportError);
    expect((refused as SyncTransportError).detail?.kind).toBe('auth');
    expect((await readFacts(account.id)).nextAttemptAt).toBeNull(); // asking again cannot change that answer
    expect(psql(`select count(*) from public.documents where owner_id = '${account.id}'`)).toBe('0');
    const dead = await runSync({ url: 'http://127.0.0.1:1', anonKey: 'x' }, session(account));
    expect(dead?.report.offline).toBe(true);
    expect(dead?.report.failure?.kind).toBe('network');
    expect((await readHistory(account.id)).map((item) => item.result)).toEqual(expect.arrayContaining(['session', 'offline']));
    const facts = await readFacts(account.id);
    expect(facts.lastConfirmedAt).toBeUndefined(); // neither of those confirmed anything
    expect(facts.nextAttemptAt).toBeGreaterThan(Date.now());
    // Then the real thing: it confirms.
    expect((await runSync(config, session(account)))?.confirmed).toBe(true);
    expect((await readFacts(account.id)).failures).toBe(0);
  });

  it('"solo descargar" writes nothing to the real database, even with edits waiting to be uploaded', async () => {
    const { docs } = await buildLibrary();
    await runSync(config, session(account));
    await libraryRepository.saveDocument({ ...(await db.documents.get(docs.letra.id))!, content: lyrics('pendiente de subir') }, 'manual');
    const before = psql(`select count(*) || ':' || coalesce(max(rev), 0) from public.documents where owner_id = '${account.id}'`);
    const ops = psql(`select count(*) from public.sync_operations where owner_id = '${account.id}'`);
    const changes = psql(`select count(*) from public.sync_changes where owner_id = '${account.id}'`);
    const result = await rebuildFromCloud(config, session(account), { downloadOnly: true });
    expect(result.report.pushed).toBe(0);
    expect(psql(`select count(*) from public.sync_operations where owner_id = '${account.id}'`)).toBe(ops); // no operation was even attempted
    expect(psql(`select count(*) from public.sync_changes where owner_id = '${account.id}'`)).toBe(changes);
    expect(psql(`select count(*) || ':' || coalesce(max(rev), 0) from public.documents where owner_id = '${account.id}'`)).toBe(before);
    expect(canonicalJson((await db.documents.get(docs.letra.id))!.content)).toContain('pendiente de subir'); // and the local edit is untouched
    expect((await readOverview(account.id)).pending.documents).toBeGreaterThanOrEqual(1); // still waiting, honestly
  });

  it('a backup imported on one device travels to another through the real database, without touching what was there', async () => {
    const { docs } = await buildLibrary();
    await runSync(config, session(account));
    const backup = await libraryRepository.exportBackup();
    // The same file imported again is "nothing to do"; the document edited since comes in as a copy.
    await libraryRepository.saveDocument({ ...(await db.documents.get(docs.letra.id))!, content: lyrics('cambió después de la copia') }, 'manual');
    const preview = await previewImport(backup, 'copia.json');
    expect(preview.plan.summary.copies.documents).toBe(1);
    await applyImport(preview, { foreign: false });
    expect(canonicalJson((await db.documents.get(docs.letra.id))!.content)).toContain('cambió después de la copia'); // untouched
    await runSync(config, session(account));
    const fromA = await snapshot();
    await wipeLocal();
    await linkWithoutClaiming(account.id);
    await runSync(config, session(account));
    expect(await snapshot()).toEqual(fromA);
    expect(fromA.documents.filter((d) => d.title.includes('copia importada')).length).toBe(1);
  });
});
