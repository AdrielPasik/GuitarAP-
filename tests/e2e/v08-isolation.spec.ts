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
const draftCount = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const open = indexedDB.open('guitarap');
        open.onsuccess = () => {
          const all = open.result.transaction('settings').objectStore('settings').getAll();
          all.onsuccess = () => resolve((all.result as Array<{ key: string }>).filter((row) => row.key.startsWith('draft:user-ana:')).length);
        };
      }),
  );
const draftTitle = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string | null>((resolve) => {
        const open = indexedDB.open('guitarap');
        open.onsuccess = () => {
          const all = open.result.transaction('settings').objectStore('settings').getAll();
          all.onsuccess = () => resolve((all.result as Array<{ key: string; value: { title: string } }>).find((row) => row.key.startsWith('draft:user-ana:'))?.value.title ?? null);
        };
      }),
  );
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

/**
 * The original defect: tab 2 holds the last moments of typing (its autosave timer is made so long that ONLY the
 * lifecycle can save it) while tab 1 signs out. The edit used to be refused and lost.
 */
test.describe('lo último que escribí no se pierde cuando otra pestaña cierra sesión', () => {
  async function twoTabs(page: Page, context: import('@playwright/test').BrowserContext) {
    await mockAccounts(page);
    await openLibrary(page);
    await signIn(page, 'ana');
    await page.goto('/biblioteca');
    const id = await newSong(page, 'Canción de Ana');
    await page.goto('/biblioteca');
    const editor = await context.newPage();
    // Only THIS tab never saves by timer: whatever it holds can reach the disk only through the lifecycle and the journal.
    await editor.addInitScript(() => {
      (window as unknown as { __GUITARAP_AUTOSAVE_DELAY: number }).__GUITARAP_AUTOSAVE_DELAY = 600_000;
    });
    await editor.goto(`/material/${id}`);
    await editor.getByLabel('Título del material').fill('Lo último que escribí');
    return { id, editor };
  }

  test('cerrar sesión en la otra pestaña: la edición queda guardada para su dueña y reaparece al volver', async ({ page, context }) => {
    const { editor } = await twoTabs(page, context);
    await signOut(page);
    await expect(editor.getByRole('heading', { name: 'No encontramos este material' })).toBeVisible({ timeout: 15000 }); // hidden at once
    expect(await owners(page)).toEqual({ 'Lo último que escribí': 'user-ana' }); // finished, for the right owner
    await signIn(page, 'ana');
    await page.goto('/biblioteca');
    await expect(row(page, 'Lo último que escribí')).toBeVisible();
  });

  test('cambiar de cuenta en la otra pestaña: la edición va a su dueña, B no la ve y no se sube nada de A', async ({ page, context }) => {
    const { editor } = await twoTabs(page, context);
    const auth = await mockAccounts(editor); // watches this tab's requests too
    await signOut(page);
    await signIn(page, 'beto');
    await page.goto('/biblioteca');
    await expect(editor.getByRole('heading', { name: 'No encontramos este material' })).toBeVisible({ timeout: 15000 });
    await expect(row(page, 'Lo último que escribí')).toHaveCount(0);
    expect(await owners(page)).toEqual({ 'Lo último que escribí': 'user-ana' });
    expect(auth.requests).toEqual([]); // nothing of Ana's went anywhere while Beto was signed in
    await signOut(page);
    await signIn(page, 'ana');
    await page.goto('/biblioteca');
    await expect(row(page, 'Lo último que escribí')).toBeVisible();
  });

  test('con la sesión vencida la edición pendiente también se guarda', async ({ page, context }) => {
    const { id, editor } = await twoTabs(page, context);
    await editor.getByLabel('Título del material').fill('Editado y vencida');
    await page.evaluate((key) => window.localStorage.removeItem(key), SESSION); // the session is gone, nobody signed out
    await expect.poll(() => draftTitle(page)).toBe('Editado y vencida'); // the journal has the latest on disk (a person takes longer than that to leave)
    await editor.goto('/biblioteca'); // the tab is gone before any timer: only the lifecycle and the journal can keep the typing
    await editor.goto(`/material/${id}`);
    // Either the save finished while the page was leaving, or the journal kept it and offers it back: it is never lost.
    const recover = editor.getByRole('button', { name: 'Recuperar los cambios' });
    await expect(editor.getByLabel('Título del material').or(recover).first()).toBeVisible();
    if (await recover.isVisible()) await recover.click();
    await expect(editor.getByLabel('Título del material')).toHaveValue('Editado y vencida');
  });

  test('si la pestaña se cierra antes de guardar, lo escrito queda como borrador de su cuenta y no lo ve otra', async ({ page, context }) => {
    const { id, editor } = await twoTabs(page, context);
    await expect.poll(() => draftCount(page)).toBeGreaterThanOrEqual(1);
    await editor.close(); // gone without any save or flush
    await signOut(page);
    await signIn(page, 'beto');
    await page.goto(`/material/${id}`);
    await expect(page.getByRole('button', { name: 'Recuperar los cambios' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'No encontramos este material' })).toBeVisible();
    await signOut(page);
    await signIn(page, 'ana');
    await page.goto(`/material/${id}`);
    const recover = page.getByRole('button', { name: 'Recuperar los cambios' });
    await expect(page.getByLabel('Título del material')).toBeVisible();
    if (await recover.isVisible()) await recover.click(); // the banner renders together with the editor
    await expect(page.getByLabel('Título del material')).toHaveValue('Lo último que escribí');
  });
});

test.describe('integridad de los borradores: la ventana entre escribir y el disco', () => {
  test('con un disco lento el editor no dice «Guardado» y el navegador avisa antes de dejar la página; al confirmarse deja de avisar', async ({ page, context }) => {
    await mockAccounts(page);
    await openLibrary(page);
    await signIn(page, 'ana');
    await page.goto('/biblioteca');
    const id = await newSong(page, 'Canción de Ana');
    const editor = await context.newPage();
    await editor.addInitScript(() => {
      const w = window as unknown as { __GUITARAP_AUTOSAVE_DELAY: number; __GUITARAP_JOURNAL_DELAY: number };
      w.__GUITARAP_AUTOSAVE_DELAY = 600_000;
      w.__GUITARAP_JOURNAL_DELAY = 1500; // a slow disk
    });
    await editor.goto(`/material/${id}`);
    await editor.getByLabel('Título del material').fill('Escrito justo antes de irme');
    await expect(editor.getByRole('status').filter({ hasText: 'Guardando' })).toBeVisible(); // typed, not on disk: not "Guardado"
    await expect(editor.getByRole('status').filter({ hasText: /^Guardado$/ })).toHaveCount(0);
    let asked = '';
    editor.once('dialog', (dialog) => {
      asked = dialog.type();
      void dialog.dismiss(); // the person decides to stay
    });
    await editor.close({ runBeforeUnload: true });
    await expect.poll(() => asked).toBe('beforeunload'); // the browser was asked to warn
    await expect.poll(() => draftTitle(page)).toBe('Escrito justo antes de irme'); // and the write completes
    // Once it is on disk the warning is no longer needed.
    let askedAgain = false;
    editor.once('dialog', (dialog) => {
      askedAgain = true;
      void dialog.dismiss();
    });
    await editor.close({ runBeforeUnload: true }).catch(() => undefined);
    expect(askedAgain).toBe(false);
  });

  test('dos pestañas con ediciones distintas del mismo material: cada una deja su borrador, y al recuperar nada se pierde', async ({ page, context }) => {
    await mockAccounts(page);
    await openLibrary(page);
    await signIn(page, 'ana');
    await page.goto('/biblioteca');
    const id = await newSong(page, 'Canción de Ana');
    const slow = async () => {
      const tab = await context.newPage();
      await tab.addInitScript(() => {
        (window as unknown as { __GUITARAP_AUTOSAVE_DELAY: number }).__GUITARAP_AUTOSAVE_DELAY = 600_000;
      });
      await tab.goto(`/material/${id}`);
      return tab;
    };
    const one = await slow();
    const two = await slow();
    await one.getByLabel('Título del material').fill('Pestaña uno');
    await two.getByLabel('Título del material').fill('Pestaña dos');
    await expect.poll(() => draftCount(page)).toBe(2);
    await one.close();
    await two.close();
    await page.goto(`/material/${id}`);
    await expect(page.getByRole('button', { name: 'Recuperar los cambios' })).toBeVisible();
    await page.getByRole('button', { name: 'Recuperar los cambios' }).click();
    await expect(page.getByLabel('Título del material')).toHaveValue(/Pestaña (uno|dos)/);
    const versions = await page.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const open = indexedDB.open('guitarap');
          open.onsuccess = () => {
            const all = open.result.transaction('versions').objectStore('versions').getAll();
            all.onsuccess = () => resolve((all.result as Array<{ title: string }>).map((version) => version.title));
          };
        }),
    );
    // Whatever the order in which the two tabs finished, both texts are still somewhere: in the document or in its history.
    const everywhere = [...versions, await page.getByLabel('Título del material').inputValue()];
    expect(everywhere.some((title) => title.startsWith('Pestaña uno'))).toBe(true);
    expect(everywhere.some((title) => title.startsWith('Pestaña dos'))).toBe(true);
    expect(await draftCount(page)).toBe(0);
  });
});
