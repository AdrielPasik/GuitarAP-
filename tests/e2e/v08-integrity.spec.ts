import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createFolder, createFromMenu, createMaterial, cell, openLibrary, settleSave } from './helpers';
import { admin, newAccount } from './sharing-helpers';

/**
 * v0.8 phase 1.6 — the integrity of a library across two devices, compared by CONTENT, RELATIONS and STATE (what is in each
 * document, where it lives, whether it is in the trash, what its history holds), not by how many things there are. Two
 * independent browser contexts play the computer and the phone against the local test gateway (real SQL, made-up account).
 */
test.setTimeout(240_000);

const topbar = (page: Page) => page.getByRole('banner');
const SAVED = 'Guardado en tu cuenta';
type Ids = Record<string, string>;

async function auth(context: BrowserContext, ids: Ids) {
  await context.route('**/auth/v1/**', async (route) => {
    const request = route.request();
    if (request.url().includes('/auth/v1/health')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' });
    const body = request.postDataJSON() as { email?: string; refresh_token?: string };
    const refresh = request.url().includes('grant_type=refresh_token');
    const id = refresh ? String(body.refresh_token).replace('refresh-', '') : ids[String(body.email).split('@')[0]];
    if (!id) return route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"invalid_grant"}' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: `test-user:${id}`, refresh_token: `refresh-${id}`, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id, email: `${id.slice(0, 4)}@guitarap.test` } }) });
  });
}
async function device(browser: Browser, ids: Ids, options: { phone?: boolean; flag?: boolean } = {}) {
  const context = await browser.newContext({ viewport: options.phone ? { width: 390, height: 844 } : { width: 1280, height: 800 } });
  if (options.flag !== false) await context.addInitScript(() => window.localStorage.setItem('guitarap.flag.autoRecovery', 'on'));
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
async function statusText(page: Page) {
  await topbar(page).getByRole('button', { name: 'Cuenta y sincronización' }).click();
  const text = (await page.locator('.account-panel').innerText()).replace(/\s+/g, ' ');
  await page.keyboard.press('Escape');
  return text;
}
/** «Sincronizar ahora» and wait for the server's own confirmation. */
async function sync(page: Page) {
  await topbar(page).getByRole('button', { name: 'Cuenta y sincronización' }).click();
  await page.getByRole('button', { name: 'Sincronizar ahora' }).click();
  await page.keyboard.press('Escape');
  await expect.poll(() => statusText(page), { timeout: 40_000 }).toContain(SAVED);
}
const row = (page: Page, title: string) => page.locator('.lib-row', { hasText: title });

type Rec = Record<string, unknown>;
const canon = (value: unknown): unknown => (Array.isArray(value) ? value.map(canon) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value as Rec).sort().map((key) => [key, canon((value as Rec)[key])])) : value);
/** Identity, relations, state and content of every record: what "the same library" means. */
async function snapshot(page: Page) {
  const raw = await page.evaluate(
    () =>
      new Promise<{ nodes: Rec[]; documents: Rec[]; versions: Rec[] }>((resolve) => {
        const open = indexedDB.open('guitarap');
        open.onsuccess = () => {
          const read = (store: string) => new Promise<Rec[]>((done) => { const all = open.result.transaction(store).objectStore(store).getAll(); all.onsuccess = () => done(all.result as Rec[]); });
          void Promise.all([read('nodes'), read('documents'), read('versions')]).then(([nodes, documents, versions]) => resolve({ nodes, documents, versions }));
        };
      }),
  );
  const sort = (items: Rec[]) => items.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return canon({
    nodes: sort(raw.nodes.map((n) => ({ id: n.id, name: n.name, parentId: n.parentId, kind: n.kind, trashed: Boolean(n.deletedAt), owner: n.ownerId }))),
    documents: sort(raw.documents.map((d) => ({ id: d.id, title: d.title, type: d.type, nodeId: d.nodeId, songId: d.songId, trashed: Boolean(d.deletedAt), content: d.content, owner: d.ownerId }))),
    versions: sort(raw.versions.map((v) => ({ id: v.id, documentId: v.documentId, reason: v.reason, title: v.title, content: v.content, owner: v.ownerId }))),
  });
}

/** The computer builds a library with depth, text, a tablature, edits (history) and a trashed riff, and uploads it. */
async function computerWithRichLibrary(browser: Browser, ids: Ids, who: string) {
  const computer = await device(browser, ids);
  const { page } = computer;
  await openLibrary(page);
  await signIn(page, who);
  await createFolder(page, 'Escalas');
  await row(page, 'Escalas').locator('.lib-open').click();
  await createFolder(page, 'Menores');
  await row(page, 'Menores').locator('.lib-open').click();
  await createFromMenu(page, 'Canción con letra', 'Letra en menor');
  await page.getByLabel('Letra', { exact: true }).fill('# Verso 1\nHoy vuelvo a casa\n# Estribillo\nY sigo cantando');
  await settleSave(page);
  await page.getByLabel('Letra', { exact: true }).fill('# Verso 1\nHoy vuelvo a casa otra vez\n# Estribillo\nY sigo cantando');
  await settleSave(page);
  await page.goto('/biblioteca');
  await createMaterial(page, 'Tablatura', 'Riff descartado');
  await cell(page, 1, 1).click();
  await page.keyboard.press('7');
  await settleSave(page);
  await page.goto('/biblioteca');
  await createMaterial(page, 'Tablatura', 'Riff principal');
  await cell(page, 1, 1).click();
  await page.keyboard.press('5');
  await page.keyboard.press('7');
  await settleSave(page);
  await page.goto('/biblioteca');
  await row(page, 'Riff descartado').getByRole('button', { name: /Opciones de/ }).click();
  await page.getByRole('menuitem', { name: 'Enviar a la papelera' }).click();
  await expect(row(page, 'Riff descartado')).toHaveCount(0);
  await sync(page);
  return computer;
}

test('computadora → servidor local → celular: contenido, relaciones, papelera e historial idénticos; y cada paso posterior converge', async ({ browser }) => {
  const ana = await newAccount('ana');
  const ids = { ana };
  const pc = await computerWithRichLibrary(browser, ids, 'ana');
  const fromPc = (await snapshot(pc.page)) as { nodes: Rec[]; documents: Rec[]; versions: Rec[] };
  expect(fromPc.nodes.map((n) => n.name)).toEqual(expect.arrayContaining(['Escalas', 'Menores']));
  expect(fromPc.nodes.find((n) => n.name === 'Menores')?.parentId).toBe(fromPc.nodes.find((n) => n.name === 'Escalas')?.id); // depth
  expect(fromPc.documents.find((d) => d.title === 'Riff descartado')?.trashed).toBe(true);
  expect(fromPc.versions.length).toBeGreaterThanOrEqual(2); // history exists to be compared

  // The phone recovers everything on its own.
  const phone = await device(browser, ids, { phone: true });
  await openLibrary(phone.page);
  await signIn(phone.page, 'ana');
  await expect(phone.page.getByRole('status', { name: 'Biblioteca recuperada' })).toBeVisible({ timeout: 40_000 });
  expect(await snapshot(phone.page)).toEqual(fromPc);

  // The phone edits the lyrics and writes a new tablature; the computer receives both, exactly.
  await phone.page.goto('/biblioteca');
  await row(phone.page, 'Escalas').locator('.lib-open').click();
  await row(phone.page, 'Menores').locator('.lib-open').click();
  await row(phone.page, 'Letra en menor').locator('.lib-open').click();
  await phone.page.getByLabel('Letra', { exact: true }).fill('# Verso 1\nHoy vuelvo a casa otra vez, desde el celular\n# Estribillo\nY sigo cantando');
  await settleSave(phone.page);
  await phone.page.goto('/biblioteca');
  await createMaterial(phone.page, 'Tablatura', 'Hecha en el celular');
  await cell(phone.page, 1, 1).click();
  await phone.page.keyboard.press('3');
  await settleSave(phone.page);
  await phone.page.goto('/biblioteca');
  await sync(phone.page);
  await pc.page.goto('/biblioteca');
  await sync(pc.page);
  const converged = await snapshot(phone.page);
  expect(await snapshot(pc.page)).toEqual(converged);

  // Losing the computer's local database changes nothing about the library once it recovers.
  await pc.page.evaluate(() => new Promise<void>((resolve) => { const request = indexedDB.deleteDatabase('guitarap'); request.onsuccess = () => resolve(); request.onblocked = () => resolve(); }));
  await pc.page.goto('/biblioteca');
  await expect(pc.page.getByRole('status', { name: 'Biblioteca recuperada' })).toBeVisible({ timeout: 40_000 });
  expect(await snapshot(pc.page)).toEqual(converged);

  // "Reconstruir desde la nube" (both ways) and a JSON of the library imported back: nothing moves.
  await pc.page.goto('/configuracion/datos');
  await pc.page.getByRole('button', { name: 'Solo descargar de la nube' }).click();
  await expect(pc.page.getByText(/No se subió nada/)).toBeVisible({ timeout: 40_000 });
  expect(await snapshot(pc.page)).toEqual(converged);
  await pc.page.goto('/configuracion/copias');
  const download = pc.page.waitForEvent('download');
  await pc.page.getByRole('button', { name: 'Descargar copia de seguridad' }).click();
  const copy = await (await download).path();
  await pc.page.getByLabel('Archivo de copia de seguridad').setInputFiles(copy!);
  await expect(pc.page.getByRole('dialog', { name: 'Importar copia de seguridad' }).getByText(/No hay nada para importar/)).toBeVisible();
  await pc.page.getByRole('dialog', { name: 'Importar copia de seguridad' }).getByRole('button', { name: 'Cancelar' }).click();
  expect(await snapshot(pc.page)).toEqual(converged);

  // And the server holds what both screens show.
  const server = (await admin(`select title, deleted_at is not null as trashed from public.documents where owner_id = $1 order by title`, [ana])) as Array<{ title: string; trashed: boolean }>;
  expect(server).toEqual((converged as { documents: Rec[] }).documents.map((d) => ({ title: d.title, trashed: d.trashed })).sort((a, b) => String(a.title).localeCompare(String(b.title))));
  await pc.context.close();
  await phone.context.close();
});

test('dos dispositivos editan sin conexión el mismo material: ninguna versión se pierde en ninguno de los dos', async ({ browser }) => {
  const ana = await newAccount('ana');
  const ids = { ana };
  const pc = await computerWithRichLibrary(browser, ids, 'ana');
  const phone = await device(browser, ids, { phone: true });
  await openLibrary(phone.page);
  await signIn(phone.page, 'ana');
  await expect(phone.page.getByRole('status', { name: 'Biblioteca recuperada' })).toBeVisible({ timeout: 40_000 });
  const open = async (page: Page) => {
    await page.goto('/biblioteca');
    await row(page, 'Escalas').locator('.lib-open').click();
    await row(page, 'Menores').locator('.lib-open').click();
    await row(page, 'Letra en menor').locator('.lib-open').click();
  };
  // Warm the editor's code while online, then both go offline and write different things.
  await open(phone.page);
  await open(pc.page);
  await phone.context.setOffline(true);
  await pc.context.setOffline(true);
  await phone.page.getByLabel('Letra', { exact: true }).fill('# Verso 1\nVersión del celular\n# Estribillo\nY sigo cantando');
  await settleSave(phone.page);
  await pc.page.getByLabel('Letra', { exact: true }).fill('# Verso 1\nVersión de la computadora\n# Estribillo\nY sigo cantando');
  await settleSave(pc.page);
  await pc.context.setOffline(false);
  await pc.page.goto('/biblioteca');
  await sync(pc.page);
  await phone.context.setOffline(false);
  await phone.page.goto('/biblioteca');
  await sync(phone.page).catch(() => undefined);
  await expect.poll(async () => JSON.stringify(await snapshot(phone.page)).includes('Versión de la computadora'), { timeout: 40_000 }).toBe(true);
  for (const page of [phone.page, pc.page]) {
    await page.goto('/biblioteca');
    await sync(page).catch(() => undefined);
  }
  const everything = async (page: Page) => JSON.stringify(await snapshot(page));
  for (const page of [phone.page, pc.page]) {
    const text = await everything(page);
    expect(text).toContain('Versión del celular'); // the phone's own text is somewhere (document, copy or history) on both devices
    expect(text).toContain('Versión de la computadora');
  }
  expect(await snapshot(phone.page)).toEqual(await snapshot(pc.page));
  await pc.context.close();
  await phone.context.close();
});

test('apagar la recuperación automática no pierde nada y la sincronización clásica sigue funcionando', async ({ browser }) => {
  const ana = await newAccount('ana');
  const ids = { ana };
  const pc = await computerWithRichLibrary(browser, ids, 'ana');
  const phone = await device(browser, ids, { phone: true });
  await openLibrary(phone.page);
  await signIn(phone.page, 'ana');
  await expect(phone.page.getByRole('status', { name: 'Biblioteca recuperada' })).toBeVisible({ timeout: 40_000 });
  const before = await snapshot(phone.page);
  // The flag goes off (rollback of the behaviour): same device, same data, the previous way of working.
  await phone.page.evaluate(() => window.localStorage.removeItem('guitarap.flag.autoRecovery'));
  await phone.context.clearCookies();
  await phone.page.goto('/biblioteca'); // (the init script of this context would set it again: remove it for the reload)
  await phone.page.evaluate(() => window.localStorage.removeItem('guitarap.flag.autoRecovery'));
  expect(await snapshot(phone.page)).toEqual(before); // nothing lost, nothing changed
  await phone.page.goto('/biblioteca');
  await createMaterial(phone.page, 'Tablatura', 'Con la recuperación apagada');
  await cell(phone.page, 1, 1).click();
  await phone.page.keyboard.press('9');
  await settleSave(phone.page);
  await phone.page.goto('/biblioteca');
  await expect.poll(async () => ((await admin(`select title from public.documents where owner_id = $1`, [ana])) as Array<{ title: string }>).map((d) => d.title), { timeout: 60_000 }).toContain('Con la recuperación apagada');
  await pc.context.close();
  await phone.context.close();
});

test('una pestaña con código reemplazado por una actualización lo dice, guarda lo que se escribía y se recarga', async ({ browser }) => {
  const ana = await newAccount('ana');
  const ids = { ana };
  const d = await device(browser, ids);
  await openLibrary(d.page);
  await signIn(d.page, 'ana');
  await createFromMenu(d.page, 'Canción con letra', 'Mientras se actualiza');
  await settleSave(d.page);
  await d.page.evaluate(() => ((window as unknown as { __GUITARAP_AUTOSAVE_DELAY: number }).__GUITARAP_AUTOSAVE_DELAY = 600_000));
  await d.page.getByLabel('Letra', { exact: true }).fill('Escrito justo cuando llega la actualización');
  // Another tab updated the app: the pieces of this one can no longer be fetched.
  await d.page.evaluate(() => window.dispatchEvent(new Event('vite:preloadError', { cancelable: true })));
  const banner = d.page.getByRole('alert').filter({ hasText: 'se actualizó en otra pestaña' });
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: 'Recargar' }).click();
  await d.page.waitForLoadState('load');
  await expect(d.page.getByLabel('Letra', { exact: true })).toHaveValue('Escrito justo cuando llega la actualización'); // nothing typed was lost
  await d.context.close();
});
