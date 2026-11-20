import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { createFromMenu, openLibrary, settleSave, storedDocuments } from './helpers';

/**
 * v0.8 phase 1.2 — two people, one browser profile. Accounts are made up (the sign-in service is answered by the test,
 * nothing reaches a real project) and every check reads what the person would see AND what is really stored.
 */
test.setTimeout(120_000);

const topbar = (page: Page) => page.getByRole('banner');
const SESSION = 'guitarap:supabase-session';

type Auth = { mode: 'ok' | 'refuse' | 'offline'; requests: string[] };
/** Answers the account service for any e-mail: «ana@…» is user-ana, «beto@…» is user-beto. */
async function mockAccounts(page: Page): Promise<Auth> {
  const auth: Auth = { mode: 'ok', requests: [] };
  page.on('request', (request) => {
    if (/\/rest\/v1\/rpc\/(sync_library|pull_library)/.test(request.url())) auth.requests.push(request.url());
  });
  await page.route('**/auth/v1/**', async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as { email?: string; refresh_token?: string };
    const refresh = request.url().includes('grant_type=refresh_token');
    if (refresh && auth.mode === 'refuse') return route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"invalid_grant"}' });
    if (refresh && auth.mode === 'offline') return route.abort('connectionrefused');
    const id = refresh ? String(body.refresh_token).replace('refresh-', '') : `user-${String(body.email).split('@')[0]}`;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ access_token: `tok-${id}`, refresh_token: `refresh-${id}`, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id, email: `${id.replace('user-', '')}@guitarap.test` } }),
    });
  });
  await page.route('**/rest/v1/rpc/pull_library', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cursor: '0', changes: [], hasMore: false }) }));
  return auth;
}

async function signIn(page: Page, who: 'ana' | 'beto') {
  await topbar(page).getByRole('button', { name: 'Iniciar sesión' }).click();
  const dialog = page.getByRole('dialog', { name: 'Iniciar sesión' });
  await dialog.getByLabel('Correo').fill(`${who}@guitarap.test`);
  await dialog.getByLabel('Contraseña', { exact: true }).fill('secreto');
  await dialog.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(topbar(page).getByRole('button', { name: 'Cuenta y sincronización' })).toBeVisible();
  if (await page.getByRole('dialog', { name: /Protegé tu biblioteca/ }).isVisible()) await page.keyboard.press('Escape');
}
async function signOut(page: Page) {
  await topbar(page).getByRole('button', { name: 'Cuenta y sincronización' }).click();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(topbar(page).getByRole('button', { name: 'Iniciar sesión' })).toBeVisible();
}
const row = (page: Page, title: string) => page.locator('.lib-open', { hasText: title });
const idOf = (page: Page) => page.url().split('/material/')[1].split(/[?#]/)[0];
async function newSong(page: Page, title: string) {
  await createFromMenu(page, 'Cuaderno de composición', title);
  await settleSave(page);
  return idOf(page);
}
async function backupOf(page: Page) {
  await page.goto('/configuracion/copias');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar copia de seguridad' }).click();
  return readFile((await (await download).path())!, 'utf8');
}
const owners = async (page: Page) => Object.fromEntries((await storedDocuments(page)).map((doc) => [doc.title, (doc as unknown as { ownerId?: string }).ownerId ?? null]));

test('dos cuentas en el mismo navegador: cada una ve, abre, busca y exporta solo lo suyo, y nada se mezcla ni se sube', async ({ page }) => {
  const auth = await mockAccounts(page);
  await openLibrary(page);

  await signIn(page, 'ana');
  await page.goto('/biblioteca');
  const ana = await newSong(page, 'Canción de Ana');
  await page.goto('/biblioteca');
  await expect(row(page, 'Canción de Ana')).toBeVisible();

  // Ana signs out: her library disappears at once, with an invitation to sign in. Nothing is deleted.
  await signOut(page);
  await expect(row(page, 'Canción de Ana')).toHaveCount(0);
  await expect(page.getByText(/Cerraste sesión/)).toBeVisible();
  await page.goto(`/material/${ana}`);
  await expect(page.getByRole('heading', { name: 'No encontramos este material' })).toBeVisible(); // direct URL
  expect(await backupOf(page)).not.toContain('Canción de Ana'); // export
  expect(JSON.parse(await backupOf(page)).documents).toHaveLength(0);

  // Beto signs in: none of Ana's work is visible, searchable, openable or exportable.
  await openLibrary(page);
  await signIn(page, 'beto');
  await page.goto('/biblioteca');
  await expect(row(page, 'Canción de Ana')).toHaveCount(0);
  await page.getByLabel('Buscar en la biblioteca').fill('Ana');
  await expect(row(page, 'Canción de Ana')).toHaveCount(0);
  await page.getByLabel('Buscar en la biblioteca').fill('');
  await page.goto(`/material/${ana}`);
  await expect(page.getByRole('heading', { name: 'No encontramos este material' })).toBeVisible();
  await page.goto(`/practica/${ana}`);
  await expect(page.getByText('Canción de Ana')).toHaveCount(0);
  expect(await backupOf(page)).not.toContain('Ana');
  await page.goto('/configuracion/papelera');
  await expect(page.getByText('Canción de Ana')).toHaveCount(0);

  // Beto writes his own.
  await page.goto('/biblioteca');
  const beto = await newSong(page, 'Canción de Beto');
  await signOut(page);

  // Ana is back: exactly her library, none of Beto's.
  await signIn(page, 'ana');
  await page.goto('/biblioteca');
  await expect(row(page, 'Canción de Ana')).toBeVisible();
  await expect(row(page, 'Canción de Beto')).toHaveCount(0);
  await page.goto(`/material/${beto}`);
  await expect(page.getByRole('heading', { name: 'No encontramos este material' })).toBeVisible();

  // What is really stored: both libraries, intact, each with its owner; and nothing was sent to any server's sync.
  expect(await owners(page)).toEqual({ 'Canción de Ana': 'user-ana', 'Canción de Beto': 'user-beto' });
  expect(auth.requests).toEqual([]);
});

test('sesión vencida: la biblioteca de la cuenta sigue disponible sin conexión, no se sube nada y no aparece nada de otra cuenta', async ({ page }) => {
  const auth = await mockAccounts(page);
  await openLibrary(page);
  await signIn(page, 'ana');
  await page.goto('/biblioteca');
  await newSong(page, 'Canción de Ana');

  // The session expires and the service refuses to renew it.
  auth.mode = 'refuse';
  await page.evaluate((key) => {
    const session = JSON.parse(window.localStorage.getItem(key)!);
    window.localStorage.setItem(key, JSON.stringify({ ...session, expiresAt: Date.now() - 60_000 }));
  }, SESSION);
  await page.goto('/biblioteca');
  await expect(topbar(page).getByText('Sesión vencida')).toBeVisible();
  await expect(row(page, 'Canción de Ana')).toBeVisible(); // still hers, and still hers to edit offline
  await page.locator('.lib-open', { hasText: 'Canción de Ana' }).click();
  await page.getByLabel('Título del material').fill('Canción de Ana (editada sin sesión)');
  await settleSave(page);
  expect(auth.requests).toEqual([]); // nothing is uploaded without a valid session

  // Someone else signs in on this profile: Ana's work is not theirs to see.
  await page.goto('/biblioteca');
  auth.mode = 'ok';
  await signIn(page, 'beto');
  await page.goto('/biblioteca');
  await expect(row(page, 'Canción de Ana')).toHaveCount(0);

  // Ana signs in again: her edits made while the session was expired are all there.
  await signOut(page);
  await signIn(page, 'ana');
  await page.goto('/biblioteca');
  await expect(row(page, 'Canción de Ana (editada sin sesión)')).toBeVisible();
  expect(auth.requests).toEqual([]);
});

test('sin conexión con el servicio de cuentas: la sesión guardada se conserva y la biblioteca sigue siendo de la misma persona', async ({ page }) => {
  const auth = await mockAccounts(page);
  await openLibrary(page);
  await signIn(page, 'ana');
  await page.goto('/biblioteca');
  await newSong(page, 'Canción de Ana');
  auth.mode = 'offline';
  await page.evaluate((key) => {
    const session = JSON.parse(window.localStorage.getItem(key)!);
    window.localStorage.setItem(key, JSON.stringify({ ...session, expiresAt: Date.now() - 60_000 }));
  }, SESSION);
  await page.goto('/biblioteca'); // a full load of the app, with the account service unreachable
  await expect(row(page, 'Canción de Ana')).toBeVisible();
  await expect(topbar(page).getByRole('button', { name: 'Cuenta y sincronización' })).toBeVisible();
});

test('cerrar sesión con un material abierto lo oculta al instante, sin recargar, y sus últimos cambios quedan guardados', async ({ page }) => {
  await mockAccounts(page);
  await openLibrary(page);
  await signIn(page, 'ana');
  await page.goto('/biblioteca');
  await newSong(page, 'Canción de Ana');
  await page.getByLabel('Título del material').fill('Último cambio de Ana');
  await signOut(page); // right after typing: the last edit must not be lost nor written afterwards
  await expect(page.getByRole('heading', { name: 'No encontramos este material' })).toBeVisible();
  await expect(page.getByLabel('Título del material')).toHaveCount(0);
  expect(await owners(page)).toEqual({ 'Último cambio de Ana': 'user-ana' });
  await signIn(page, 'ana');
  await page.goto('/biblioteca');
  await expect(row(page, 'Último cambio de Ana')).toBeVisible();
});

test('dos pestañas: cerrar sesión en una oculta la biblioteca en la otra', async ({ page, context }) => {
  await mockAccounts(page);
  await openLibrary(page);
  await signIn(page, 'ana');
  await page.goto('/biblioteca');
  await newSong(page, 'Canción de Ana');
  await page.goto('/biblioteca');
  const other = await context.newPage();
  await other.goto('/biblioteca');
  await expect(row(other, 'Canción de Ana')).toBeVisible();
  await signOut(page);
  await expect(row(other, 'Canción de Ana')).toHaveCount(0, { timeout: 15000 });
  await expect(topbar(other).getByRole('button', { name: 'Iniciar sesión' })).toBeVisible({ timeout: 15000 });
});

test('las preferencias personales (el universo visual) siguen a la cuenta y no pasan a otra; las anteriores no se borran', async ({ page }) => {
  await mockAccounts(page);
  await openLibrary(page);
  // A value saved before accounts kept their own: it must survive untouched.
  await page.evaluate(() => window.localStorage.setItem('guitarap.pref.appearance.skin', JSON.stringify('psicodelico')));
  await signIn(page, 'ana');
  await page.goto('/configuracion/apariencia');
  const group = page.getByRole('group', { name: 'Universo visual' });
  await group.getByRole('button', { name: /Rock británico/ }).click();
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'britanico');
  await signOut(page);
  await expect(page.locator('html')).not.toHaveAttribute('data-skin', 'britanico'); // nobody's look is on screen
  await signIn(page, 'beto');
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'estudio'); // a new account starts from the defaults
  await signOut(page);
  await signIn(page, 'ana');
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'britanico'); // hers again
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'britanico');
  expect(await page.evaluate(() => window.localStorage.getItem('guitarap.pref.appearance.skin'))).toBe('"psicodelico"'); // the old value is still there
});

/** A profile as v0.7 left it: a library linked to an account, no identity record, preferences saved without an owner. */
async function seedLegacyProfile(page: Page, withSession: boolean) {
  await openLibrary(page);
  await page.evaluate(
    async ({ withSession: keep, key }) => {
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('guitarap');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['settings', 'documents'], 'readwrite');
          tx.objectStore('settings').delete('identity');
          tx.objectStore('settings').put({ key: 'library-scope', value: { ownerId: 'user-ana', locked: true }, updatedAt: 1 });
          tx.objectStore('documents').put({ id: 'legacy-doc', nodeId: null, songId: null, type: 'tablature', title: 'Heredada de v0.7', content: { kind: 'notebook', version: 1, blocks: [] }, rev: 1, createdAt: 1, updatedAt: 1, ownerId: 'user-ana' });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      });
      window.localStorage.setItem('guitarap.pref.appearance.skin', JSON.stringify('vinilo'));
      window.localStorage.removeItem('guitarap.owner-hint');
      for (const stored of Object.keys(window.localStorage)) if (stored.startsWith('guitarap.pref.') && stored.includes('@')) window.localStorage.removeItem(stored); // as if v0.8 had never run here
      if (keep) window.localStorage.setItem(key, JSON.stringify({ accessToken: 'tok-user-ana', refreshToken: 'refresh-user-ana', expiresAt: Date.now() + 3_600_000, user: { id: 'user-ana', email: 'ana@guitarap.test' } }));
      else window.localStorage.removeItem(key);
    },
    { withSession, key: SESSION },
  );
}

test('un perfil de v0.7 con sesión: la biblioteca vinculada sigue a la vista y sus preferencias anteriores se conservan para esa cuenta', async ({ page }) => {
  await mockAccounts(page);
  await seedLegacyProfile(page, true);
  await page.goto('/biblioteca');
  await expect(row(page, 'Heredada de v0.7')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'vinilo');
  await signOut(page);
  await expect(row(page, 'Heredada de v0.7')).toHaveCount(0);
  await signIn(page, 'beto');
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'estudio'); // not handed to the second account
  expect((await storedDocuments(page)).map((doc) => doc.title)).toContain('Heredada de v0.7'); // and nothing deleted
});

test('un perfil de v0.7 sin sesión no se muestra a nadie hasta que la cuenta inicie sesión, y sigue guardado', async ({ page }) => {
  await mockAccounts(page);
  await seedLegacyProfile(page, false);
  await page.goto('/biblioteca');
  await expect(page.getByText(/Cerraste sesión/)).toBeVisible();
  await expect(row(page, 'Heredada de v0.7')).toHaveCount(0);
  expect((await storedDocuments(page)).map((doc) => doc.title)).toContain('Heredada de v0.7');
  await signIn(page, 'ana');
  await page.goto('/biblioteca');
  await expect(row(page, 'Heredada de v0.7')).toBeVisible();
});

test('una sesión editada a mano en el almacenamiento local no abre la biblioteca de otra cuenta', async ({ page }) => {
  await mockAccounts(page);
  await openLibrary(page);
  await signIn(page, 'beto');
  await page.goto('/biblioteca');
  await newSong(page, 'Canción de Beto');
  await signOut(page);
  await signIn(page, 'ana');
  await page.goto('/biblioteca');
  await newSong(page, 'Canción de Ana');
  // Someone edits the stored session to claim to be Beto (a valid-looking one: not expired).
  await page.evaluate((key) => {
    const session = JSON.parse(window.localStorage.getItem(key)!);
    window.localStorage.setItem(key, JSON.stringify({ ...session, accessToken: 'forged', user: { id: 'user-beto', email: 'beto@guitarap.test' } }));
  }, SESSION);
  await page.goto('/biblioteca');
  await expect(row(page, 'Canción de Beto')).toHaveCount(0);
  await expect(row(page, 'Canción de Ana')).toBeVisible(); // the profile still belongs to the person who signed in
});
