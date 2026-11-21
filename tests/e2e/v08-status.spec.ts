import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createFromMenu, openLibrary, settleSave } from './helpers';
import { admin, newAccount } from './sharing-helpers';

/**
 * v0.8 phase 1.5 — what the screen says about saving and syncing, and when. A device plays against the LOCAL test gateway
 * (real SQL, made-up accounts); the connection is cut, slowed, refused or throttled with route rules, and every claim of
 * «Guardado en tu cuenta» is checked against what the server really holds. The recovery flag is ON here (the unit tests
 * cover the same status rules for both settings).
 */
test.setTimeout(180_000);

const topbar = (page: Page) => page.getByRole('banner');
type Ids = Record<string, string>;
const SAVED = 'Guardado en tu cuenta';

async function auth(context: BrowserContext, ids: Ids) {
  await context.route('**/auth/v1/**', async (route) => {
    const request = route.request();
    if (request.url().includes('/auth/v1/health')) return route.fallback();
    const body = request.postDataJSON() as { email?: string; refresh_token?: string };
    const refresh = request.url().includes('grant_type=refresh_token');
    const id = refresh ? String(body.refresh_token).replace('refresh-', '') : ids[String(body.email).split('@')[0]];
    if (!id) return route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"invalid_grant"}' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: `test-user:${id}`, refresh_token: `refresh-${id}`, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id, email: `${id.slice(0, 4)}@guitarap.test` } }) });
  });
  await context.route('**/auth/v1/health', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' }));
}
async function device(browser: Browser, ids: Ids, options: { phone?: boolean } = {}) {
  const context = await browser.newContext({ viewport: options.phone ? { width: 390, height: 844 } : { width: 1280, height: 800 } });
  await context.addInitScript(() => window.localStorage.setItem('guitarap.flag.autoRecovery', 'on'));
  await auth(context, ids);
  return { context, page: await context.newPage() };
}
async function signIn(page: Page, who: string) {
  await topbar(page).getByRole('button', { name: 'Iniciar sesión' }).click();
  const dialog = page.getByRole('dialog', { name: 'Iniciar sesión' });
  await dialog.getByLabel('Correo').fill(`${who}@guitarap.test`);
  await dialog.getByLabel('Contraseña', { exact: true }).fill('secreto');
  await dialog.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(topbar(page).getByRole('button', { name: 'Cuenta y sincronización' })).toBeVisible();
}
/** The status as the account menu says it (it is reachable on a phone, where the bar shows no label). */
async function menu(page: Page) {
  await topbar(page).getByRole('button', { name: 'Cuenta y sincronización' }).click();
  const text = (await page.locator('.account-panel').innerText()).replace(/\s+/g, ' ');
  await page.keyboard.press('Escape');
  return text;
}
const label = async (page: Page) => (await menu(page));
const serverTitles = async (owner: string) => ((await admin(`select title from public.documents where owner_id = $1 and deleted_at is null order by title`, [owner])) as Array<{ title: string }>).map((item) => item.title);
const openDiagnostics = async (page: Page) => {
  await page.goto('/configuracion/sincronizacion');
  await expect(page.getByRole('region', { name: 'Qué se sabe de la sincronización' })).toBeVisible();
};
const diag = (page: Page) => page.getByRole('region', { name: 'Qué se sabe de la sincronización' });

async function signedInWithSong(browser: Browser, who = 'ana') {
  const owner = await newAccount(who);
  const ids = { [who]: owner };
  const d = await device(browser, ids);
  await openLibrary(d.page);
  await signIn(d.page, who);
  await createFromMenu(d.page, 'Cuaderno de composición', 'Canción A');
  await settleSave(d.page);
  await d.page.goto('/biblioteca');
  await expect.poll(() => label(d.page), { timeout: 40_000 }).toContain(SAVED);
  return { ...d, owner, ids };
}

test('conectividad normal: «Guardado en tu cuenta» solo con la confirmación del servidor, y «Probar conexión» es de solo lectura', async ({ browser }) => {
  const { page, context, owner } = await signedInWithSong(browser);
  expect(await serverTitles(owner)).toEqual(['Canción A']);
  await openDiagnostics(page);
  await expect(diag(page)).toContainText('Última sincronización confirmada');
  await expect(diag(page).getByText('Pendiente de subir').locator('xpath=..')).toContainText('0 materiales');

  const seen: Array<{ method: string; authorization: string | undefined; hasBody: boolean }> = [];
  await context.route('**/auth/v1/health', (route) => {
    const request = route.request();
    seen.push({ method: request.method(), authorization: request.headers()['authorization'], hasBody: Boolean(request.postData()) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' });
  });
  await diag(page).getByRole('button', { name: 'Probar conexión (solo lectura)' }).click();
  await expect(diag(page).getByText(/Se llega al servidor de GuitarAP/)).toBeVisible();
  expect(seen).toEqual([{ method: 'GET', authorization: undefined, hasBody: false }]); // nothing of the person's travelled
  expect(await serverTitles(owner)).toEqual(['Canción A']); // and nothing was written
  await context.close();
});

test('desconexión durante la subida: lo escrito está guardado en este dispositivo, nunca «en tu cuenta», y al volver sube una sola vez', async ({ browser }) => {
  const { page, context, owner } = await signedInWithSong(browser);
  let down = true;
  await context.route('**/rest/v1/rpc/**', (route) => (down ? route.abort('connectionrefused') : route.fallback()));
  await page.goto('/biblioteca');
  await page.locator('.lib-open', { hasText: 'Canción A' }).click();
  await page.getByLabel('Título del material').fill('Cambiada sin conexión');
  await settleSave(page); // the editor's own word: saved on THIS device
  await expect(page.getByRole('status').filter({ hasText: 'Guardado en este dispositivo' })).toBeVisible();
  await page.goto('/biblioteca');
  // (a retry in progress shows "Sincronizando…" for a moment; the state that must hold is the settled one)
  await expect.poll(() => label(page), { timeout: 60_000 }).toMatch(/Sin conexión[\s\S]*guardados? en este dispositivo/);
  expect(await label(page)).not.toContain(SAVED);
  expect(await serverTitles(owner)).toEqual(['Canción A']); // the cloud has the OLD title: nothing was claimed
  await expect(page.locator('.lib-open', { hasText: 'Cambiada sin conexión' })).toBeVisible(); // and the local work is all there

  down = false;
  await openDiagnostics(page);
  await diag(page).getByRole('button', { name: /Reintentar ahora \(sube y baja\)|Sincronizar ahora \(sube y baja\)/ }).click();
  await expect.poll(() => label(page), { timeout: 30_000 }).toContain(SAVED);
  expect(await serverTitles(owner)).toEqual(['Cambiada sin conexión']);
  const count = (await admin(`select count(*)::int as n from public.documents where owner_id = $1`, [owner]))[0] as { n: number };
  expect(count.n).toBe(1); // no duplicate
  await context.close();
});

test('cada tipo de fallo dice lo suyo y ninguno se presenta como «Guardado en tu cuenta»', async ({ browser }) => {
  const { page, context } = await signedInWithSong(browser);
  const edit = async (title: string) => {
    await page.goto('/biblioteca');
    await page.locator('.lib-open').first().click();
    await page.getByLabel('Título del material').fill(title);
    await settleSave(page);
    await page.goto('/biblioteca');
  };
  const cases: Array<[string, (route: import('@playwright/test').Route) => unknown, RegExp, string]> = [
    ['DNS sin respuesta', (route) => route.abort('namenotresolved'), /Sin conexión con el servidor/, 'el navegador no dice por qué'],
    ['servidor 500', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' }), /Error temporal del servidor/, '500'],
    ['timeout del servidor (504)', (route) => route.fulfill({ status: 504, contentType: 'application/json', body: '{}' }), /El servidor no responde/, 'tardó demasiado'],
    ['límite de peticiones (429)', (route) => route.fulfill({ status: 429, headers: { 'retry-after': '300' }, contentType: 'application/json', body: '{}' }), /Sincronización en pausa/, 'pidió esperar'],
  ];
  let n = 0;
  for (const [name, handler, expected, detail] of cases) {
    n += 1;
    const rule = '**/rest/v1/rpc/**';
    await context.unroute(rule).catch(() => undefined);
    await context.route(rule, (route) => handler(route));
    await edit(`Cambio ${n}`);
    await expect.poll(() => label(page), { timeout: 60_000, message: name }).toMatch(expected);
    const text = await label(page);
    expect(text, name).not.toContain(SAVED);
    expect(text, name).toContain(detail);
    expect(text, name).not.toMatch(/Error:|TypeError|PGRST|Failed to fetch/); // never the raw error
    // The list of attempts says the same, in plain words, and keeps the decision about retrying.
    await openDiagnostics(page);
    await expect(diag(page).getByRole('list', { name: 'Historial de intentos' })).toHaveCount(0); // closed by default
    await diag(page).getByText(/Últimos intentos/).click();
    await expect(diag(page).getByRole('list', { name: 'Historial de intentos' })).toContainText(/se reintenta solo/);
  }
  await context.close();
});

test('«Probar conexión» ante un fallo de red genérico no inventa la causa', async ({ browser }) => {
  const { page, context } = await signedInWithSong(browser);
  await context.route('**/auth/v1/health', (route) => route.abort('namenotresolved'));
  await openDiagnostics(page);
  await diag(page).getByRole('button', { name: 'Probar conexión (solo lectura)' }).click();
  const verdict = diag(page).getByText(/El navegador no pudo llegar al servidor/);
  await expect(verdict).toBeVisible();
  await expect(verdict).toContainText('no deja distinguirlo');
  await expect(verdict).not.toContainText(/el DNS (falló|no resuelve)/i);
  await context.close();
});

test('el estado no engaña: cambios sin guardar en el editor, y una última confirmación antigua', async ({ browser }) => {
  const { page, context } = await signedInWithSong(browser);
  // (1) Typing, with the autosave far away and a slow journal: the account must not say it is saved.
  await page.goto('/biblioteca');
  await page.evaluate(() => {
    (window as unknown as { __GUITARAP_AUTOSAVE_DELAY: number }).__GUITARAP_AUTOSAVE_DELAY = 600_000;
    (window as unknown as { __GUITARAP_JOURNAL_DELAY: number }).__GUITARAP_JOURNAL_DELAY = 8_000;
  });
  await page.locator('.lib-open', { hasText: 'Canción A' }).click();
  await page.getByLabel('Título del material').fill('Todavía escribiendo');
  expect(await label(page)).not.toContain(SAVED);
  expect(await label(page)).toMatch(/Cambios sin guardar aún/);
  await context.close();
});

test('una confirmación antigua se dice como antigua', async ({ browser }) => {
  const { page, context, owner } = await signedInWithSong(browser);
  await page.goto('/configuracion/sincronizacion');
  await page.getByLabel('Sincronizar automáticamente').uncheck();
  await expect.poll(() => page.evaluate(() => new Promise<unknown>((resolve) => {
    const open = indexedDB.open('guitarap');
    open.onsuccess = () => {
      const get = open.result.transaction('settings').objectStore('settings').get('account-auto-sync');
      get.onsuccess = () => resolve((get.result as { value?: boolean } | undefined)?.value);
    };
  }))).toBe(false);
  // The last confirmation was three hours ago.
  await page.evaluate(
    (key) =>
      new Promise<void>((resolve) => {
        const open = indexedDB.open('guitarap');
        open.onsuccess = () => {
          const tx = open.result.transaction('settings', 'readwrite');
          const store = tx.objectStore('settings');
          const get = store.get(key);
          get.onsuccess = () => store.put({ ...get.result, value: { ...get.result.value, lastConfirmedAt: Date.now() - 3 * 3_600_000 } });
          tx.oncomplete = () => resolve();
        };
      }),
    `sync-facts:${owner}`,
  );
  await page.goto('/biblioteca');
  const text = await label(page);
  expect(text).toMatch(/Guardado en tu cuenta · hace 3 h/);
  expect(text).toMatch(/no se pudo comprobar si hay novedades/);
  await context.close();
});

test('dos pestañas cuentan la misma historia y cada cuenta ve solo la suya', async ({ browser }) => {
  const { page, context, owner } = await signedInWithSong(browser);
  const other = await context.newPage();
  await other.goto('/biblioteca');
  await expect.poll(() => label(other), { timeout: 30_000 }).toContain(SAVED);
  await context.route('**/rest/v1/rpc/**', (route) => route.abort('connectionrefused'));
  await page.goto('/biblioteca');
  await page.locator('.lib-open', { hasText: 'Canción A' }).click();
  await page.getByLabel('Título del material').fill('Con la red caída');
  await settleSave(page);
  await page.goto('/biblioteca');
  await expect.poll(() => label(page), { timeout: 60_000 }).not.toContain(SAVED);
  // The other tab learns it from the shared facts, without having tried anything itself.
  await expect.poll(() => label(other), { timeout: 60_000 }).not.toContain(SAVED);
  // Another account on this browser never reads this account's facts or attempts.
  const beto = await newAccount('beto');
  await context.unroute('**/rest/v1/rpc/**');
  await auth(context, { ana: owner, beto });
  const own = await page.evaluate(() => new Promise<string[]>((resolve) => {
    const open = indexedDB.open('guitarap');
    open.onsuccess = () => {
      const all = open.result.transaction('settings').objectStore('settings').getAllKeys();
      all.onsuccess = () => resolve((all.result as string[]).filter((key) => key.startsWith('sync-facts:') || key.startsWith('sync-history:')));
    };
  }));
  expect(own.every((key) => key.endsWith(owner))).toBe(true); // keyed by account
  await context.close();
});

test('una sesión vencida no es un cierre, no sube nada y se dice con claridad', async ({ browser }) => {
  const { page, context } = await signedInWithSong(browser);
  const sent: string[] = [];
  page.on('request', (request) => {
    if (/rpc\/(sync|pull)_library/.test(request.url())) sent.push(request.url());
  });
  await context.route('**/auth/v1/**', (route) => (route.request().url().includes('grant_type=refresh_token') ? route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"invalid_grant"}' }) : route.fallback()));
  await page.evaluate(() => {
    const key = 'guitarap:supabase-session';
    const session = JSON.parse(window.localStorage.getItem(key)!);
    window.localStorage.setItem(key, JSON.stringify({ ...session, expiresAt: Date.now() - 60_000 }));
  });
  await page.goto('/biblioteca');
  await expect(topbar(page).getByText('Sesión vencida')).toBeVisible();
  await expect(page.locator('.lib-open', { hasText: 'Canción A' })).toBeVisible(); // the library is still hers
  expect(sent).toEqual([]);
  await page.goto('/configuracion/sincronizacion');
  await expect(page.getByText(/Sesión vencida/).first()).toBeVisible();
  await context.close();
});

test('al volver a primer plano después de una suspensión, la app se pone al día sola', async ({ browser }) => {
  const { page, context, owner, ids } = await signedInWithSong(browser);
  // Another device uploads a new song while this one "sleeps".
  const other = await device(browser, ids, { phone: true });
  await openLibrary(other.page);
  await signIn(other.page, 'ana');
  await expect.poll(() => label(other.page), { timeout: 40_000 }).toContain(SAVED);
  await createFromMenu(other.page, 'Cuaderno de composición', 'Creada en el celular');
  // (patient: this second device shares a busy machine with the first)
  await expect(other.page.getByRole('status').filter({ hasText: 'Guardado en este dispositivo' })).toBeVisible({ timeout: 30_000 });
  await other.page.goto('/biblioteca');
  await expect.poll(() => serverTitles(owner), { timeout: 40_000 }).toContain('Creada en el celular');
  // The sleeping tab was last in touch more than the minimum gap ago (real time: an attempt closer than that is never made).
  await page.waitForTimeout(22_000);
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await expect(page.locator('.lib-open', { hasText: 'Creada en el celular' })).toBeVisible({ timeout: 30_000 });
  await other.context.close();
  await context.close();
});

test('el historial de intentos no guarda contenido', async ({ browser }) => {
  const owner = await newAccount('ana');
  const d = await device(browser, { ana: owner });
  await openLibrary(d.page);
  await signIn(d.page, 'ana');
  await createFromMenu(d.page, 'Cuaderno de composición', 'Letra secreta zzz-123');
  await settleSave(d.page);
  await d.page.goto('/biblioteca');
  await expect.poll(() => label(d.page), { timeout: 40_000 }).toContain(SAVED);
  await openDiagnostics(d.page);
  await diag(d.page).getByText(/Últimos intentos/).click();
  const history = await diag(d.page).getByRole('list', { name: 'Historial de intentos' }).innerText();
  expect(history).not.toContain('zzz-123');
  expect(history).not.toMatch(/Bearer|test-user|eyJ/);
  const stored = await d.page.evaluate(() => new Promise<string>((resolve) => {
    const open = indexedDB.open('guitarap');
    open.onsuccess = () => {
      const all = open.result.transaction('settings').objectStore('settings').getAll();
      all.onsuccess = () => resolve(JSON.stringify((all.result as Array<{ key: string; value: unknown }>).filter((row) => row.key.startsWith('sync-history:') || row.key.startsWith('sync-facts:'))));
    };
  }));
  expect(stored).not.toContain('zzz-123');
  expect(stored).not.toMatch(/test-user|Bearer/);
  await d.context.close();
});
