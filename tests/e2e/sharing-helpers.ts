import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { storedDocuments } from './helpers';

/**
 * Helpers for the sharing tests. The app talks to a LOCAL gateway (scripts/test-gateway.mjs): a real PostgreSQL
 * engine running the project's migrations behind the same RPC names. These tests therefore exercise the real SQL
 * permissions through the real interface; they do not touch a hosted Supabase project.
 */
export const GATEWAY = 'http://127.0.0.1:4310';

export async function admin<T = Array<Record<string, unknown>>>(sql: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(`${GATEWAY}/__admin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sql, params }) });
  if (!response.ok) throw new Error(`admin sql failed: ${await response.text()}`);
  return (await response.json()) as T;
}

export async function newAccount(label: string) {
  const rows = await admin(`insert into auth.users(email) values ($1) returning id`, [`${label}-${crypto.randomUUID().slice(0, 8)}@example.com`]);
  return rows[0].id as string;
}

/** Signs a browser context in as a test account (the session the real sign-in would have stored). */
export async function signInAs(context: BrowserContext, userId: string) {
  await context.addInitScript(
    ({ id }) => {
      window.localStorage.setItem(
        'guitarap:supabase-session',
        JSON.stringify({ accessToken: `test-user:${id}`, refreshToken: 'test-refresh', expiresAt: Date.now() + 86_400_000, user: { id, email: 'test@example.com' } }),
      );
    },
    { id: userId },
  );
}

export async function newPerson(browser: Browser, userId: string | null) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  if (userId) await signInAs(context, userId);
  const page = await context.newPage();
  return { context, page };
}

/** Copies a document (and its folders) from this browser's library to the test database, owned by `owner`, exactly as sync would. */
export async function mirror(page: Page, owner: string, title: string) {
  const docs = await storedDocuments(page);
  const doc = docs.find((item) => item.title === title)!;
  const nodes = await page.evaluate(
    () =>
      new Promise<Array<{ id: string; parentId: string | null; kind: string; name: string }>>((resolve) => {
        const request = indexedDB.open('guitarap');
        request.onsuccess = () => {
          const all = request.result.transaction('nodes').objectStore('nodes').getAll();
          all.onsuccess = () => resolve(all.result);
        };
      }),
  );
  // Parents before children.
  const ordered = [...nodes].sort((a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0));
  for (const node of ordered) {
    await admin(
      `insert into public.library_nodes(id, owner_id, parent_id, kind, name, sort_order, rev, created_at, updated_at) values ($1, $2, $3, $4, $5, 1, 1, now(), now()) on conflict (id) do nothing`,
      [node.id, owner, node.parentId, node.kind, node.name],
    );
  }
  const full = (doc as unknown as { nodeId?: string; songId?: string });
  await admin(
    `insert into public.documents(id, owner_id, node_id, song_id, type, title, payload, rev) values ($1, $2, $3, $4, $5, $6, $7::jsonb, 1) on conflict (id) do update set payload = excluded.payload, title = excluded.title, node_id = excluded.node_id`,
    [doc.id, owner, full.nodeId ?? null, full.songId ?? null, 'tablature', doc.title, JSON.stringify(doc.content)],
  );
  return doc.id;
}

export const documentId = (page: Page) => page.url().split('/material/')[1].split(/[?#]/)[0];

export async function serverDocument(id: string) {
  const rows = await admin(`select title, rev, payload from public.documents where id = $1`, [id]);
  return rows[0] as { title: string; rev: number; payload: { blocks: Array<{ id: string; kind: string; content: Record<string, unknown> }>; comments?: Array<{ text: string }> } };
}

export async function openShare(page: Page) {
  await page.getByRole('button', { name: 'Compartir', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /^Compartir «/ });
  await expect(dialog.getByText('Privado').or(dialog.getByText(/Compartido/)).first()).toBeVisible();
  return dialog;
}
