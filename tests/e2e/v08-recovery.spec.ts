import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createFolder, createFromMenu, createMaterial, openLibrary, settleSave, storedDocuments } from './helpers';
import { admin, newAccount } from './sharing-helpers';

/**
 * v0.8 phase 1.3 — recovering an account's library on another device, with the autoRecovery flag ON (it is off by
 * default and in production). Two independent browser contexts play "the computer" and "the phone"; the accounts are
 * made up and live in the LOCAL test database (real SQL, real functions, real permissions) behind the test gateway:
 * nothing reaches a hosted project. The sign-in service is answered by the test.
 */
test.setTimeout(180_000);

const topbar = (page: Page) => page.getByRole('banner');
type Ids = Record<string, string>;

async function gatewayAuth(context: BrowserContext, ids: Ids) {
  await context.route('**/auth/v1/**', async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as { email?: string; refresh_token?: string };
    const refresh = request.url().includes('grant_type=refresh_token');
    const id = refresh ? String(body.refresh_token).replace('refresh-', '') : ids[String(body.email).split('@')[0]];
    if (!id) return route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"invalid_grant"}' });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ access_token: `test-user:${id}`, refresh_token: `refresh-${id}`, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id, email: `${id.slice(0, 4)}@guitarap.test` } }),
    });
  });
}
/** A device: its own storage, the flag on, the sign-in service answering for the made-up accounts. */
async function device(browser: Browser, ids: Ids, options: { phone?: boolean; pullPage?: number } = {}) {
  const context = await browser.newContext({ viewport: options.phone ? { width: 390, height: 844 } : { width: 1280, height: 800 } });
  await context.addInitScript((pullPage) => {
    window.localStorage.setItem('guitarap.flag.autoRecovery', 'on');
    if (pullPage) (window as unknown as { __GUITARAP_PULL_PAGE: number }).__GUITARAP_PULL_PAGE = pullPage;
  }, options.pullPage);
  await gatewayAuth(context, ids);
  const page = await context.newPage();
  return { context, page };
}
async function signIn(page: Page, who: string) {
  await topbar(page).getByRole('button', { name: 'Iniciar sesión' }).click();
  const dialog = page.getByRole('dialog', { name: 'Iniciar sesión' });
  await dialog.getByLabel('Correo').fill(`${who}@guitarap.test`);
  await dialog.getByLabel('Contraseña', { exact: true }).fill('secreto');
  await dialog.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(topbar(page).getByRole('button', { name: 'Cuenta y sincronización' })).toBeVisible();
}
async function signOut(page: Page) {
  await topbar(page).getByRole('button', { name: 'Cuenta y sincronización' }).click();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(topbar(page).getByRole('button', { name: 'Iniciar sesión' })).toBeVisible();
}
/** The person presses «Sincronizar ahora» and waits for the server's confirmation. */
async function syncNow(page: Page) {
  await topbar(page).getByRole('button', { name: 'Cuenta y sincronización' }).click();
  await page.getByRole('button', { name: 'Sincronizar ahora' }).click();
  await page.keyboard.press('Escape');
  await expect.poll(() => statusText(page), { timeout: 30_000 }).toContain('Guardado en tu cuenta');
}
/** The status as the account menu says it (the compact top bar of a phone hides the label). */
async function statusText(page: Page) {
  await topbar(page).getByRole('button', { name: 'Cuenta y sincronización' }).click();
  const text = (await page.locator('.account-panel .status-line').innerText()).trim();
  await page.keyboard.press('Escape');
  return text;
}
const row = (page: Page, title: string) => page.locator('.lib-open', { hasText: title });
const banner = (page: Page, name: string) => page.getByRole('status', { name });
const serverTitles = async (owner: string) => ((await admin(`select title from public.documents where owner_id = $1 and deleted_at is null order by title`, [owner])) as Array<{ title: string }>).map((item) => item.title);
const titlesOwnedBy = async (page: Page, owner: string) => (await storedDocuments(page)).filter((doc) => (doc as unknown as { ownerId?: string }).ownerId === owner).map((doc) => doc.title).sort();

/** The computer builds a small library (a folder, a notebook, a riff sent to the trash) and uploads it. */
async function computerWithLibrary(browser: Browser, ids: Ids, who: string) {
  const computer = await device(browser, ids);
  await openLibrary(computer.page);
  await signIn(computer.page, who);
  await createFolder(computer.page, 'Escalas');
  await createFromMenu(computer.page, 'Cuaderno de composición', 'Canción A');
  await settleSave(computer.page);
  await computer.page.goto('/biblioteca');
  await createMaterial(computer.page, 'Tablatura', 'Riff descartado');
  await settleSave(computer.page);
  await computer.page.goto('/biblioteca');
  await computer.page.locator('.lib-row', { hasText: 'Riff descartado' }).getByRole('button', { name: /Opciones de/ }).click();
  await computer.page.getByRole('menuitem', { name: 'Enviar a la papelera' }).click();
  await expect(row(computer.page, 'Riff descartado')).toHaveCount(0);
  await syncNow(computer.page);
  return computer;
}

test('la computadora crea la biblioteca y el celular la recupera sin asistente ni copia: papelera e historial incluidos, con los cambios del celular de vuelta en la computadora', async ({ browser }) => {
  const ana = await newAccount('ana');
  const ids = { ana };
  const computer = await computerWithLibrary(browser, ids, 'ana');
  const serverBefore = await serverTitles(ana);
  expect(serverBefore).toEqual(['Canción A']); // the trashed riff is stored but not live

  const phone = await device(browser, ids, { phone: true });
  await openLibrary(phone.page);
  await signIn(phone.page, 'ana');
  // No protect-your-library wizard, no backup to download, no manual link.
  await expect(phone.page.getByRole('dialog', { name: /Protegé tu biblioteca/ })).toHaveCount(0);
  await expect(banner(phone.page, 'Biblioteca recuperada')).toContainText(/Biblioteca recuperada: 1 carpeta, 0 canciones, 1 material \(y 1 en la papelera\)/, { timeout: 30_000 });
  await expect(banner(phone.page, 'Biblioteca recuperada')).toContainText(/versi/);
  await expect(row(phone.page, 'Escalas')).toBeVisible();
  await expect(row(phone.page, 'Canción A')).toBeVisible();
  expect(await statusText(phone.page)).toContain('Guardado en tu cuenta');
  // The trash came along.
  await phone.page.goto('/configuracion/recuperacion');
  await expect(phone.page.getByText('Riff descartado')).toBeVisible();
  // Exactly what the computer has, no more (no duplicates), all owned by the account.
  expect(await titlesOwnedBy(phone.page, ana)).toEqual(await titlesOwnedBy(computer.page, ana));

  // The phone edits a song; the computer receives it.
  await phone.page.goto('/biblioteca');
  await row(phone.page, 'Canción A').click();
  await phone.page.getByLabel('Título del material').fill('Canción A (desde el celular)');
  await settleSave(phone.page);
  await phone.page.goto('/biblioteca');
  await syncNow(phone.page);
  await computer.page.goto('/biblioteca');
  await syncNow(computer.page);
  await expect(row(computer.page, 'Canción A (desde el celular)')).toBeVisible();
  expect(await serverTitles(ana)).toEqual(['Canción A (desde el celular)']);

  // "Reconstruir desde la nube" is safe and idempotent: damage one record on the phone, rebuild, nothing else changes.
  await phone.page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const open = indexedDB.open('guitarap');
      open.onsuccess = () => {
        const tx = open.result.transaction('documents', 'readwrite');
        const all = tx.objectStore('documents').getAll();
        all.onsuccess = () => {
          const target = (all.result as Array<{ id: string; title: string }>).find((doc) => doc.title.startsWith('Canción A'));
          if (target) tx.objectStore('documents').delete(target.id);
        };
        tx.oncomplete = () => resolve();
      };
    });
  });
  await phone.page.goto('/configuracion/datos');
  await phone.page.getByRole('button', { name: 'Solo descargar de la nube' }).click();
  await expect(phone.page.getByText(/se recuperaron 1 elementos que faltaban. No se subió nada/)).toBeVisible({ timeout: 30_000 });
  await phone.page.goto('/biblioteca');
  await expect(row(phone.page, 'Canción A (desde el celular)')).toBeVisible();
  await phone.page.goto('/configuracion/datos');
  await phone.page.getByRole('button', { name: 'Solo descargar de la nube' }).click();
  await expect(phone.page.getByText('Listo: tu biblioteca ya estaba completa.')).toBeVisible({ timeout: 30_000 });
  expect(await titlesOwnedBy(phone.page, ana)).toEqual(await titlesOwnedBy(computer.page, ana));
  await computer.context.close();
  await phone.context.close();
});

test('un navegador con IndexedDB vacío reconstruye todo desde la cuenta', async ({ browser }) => {
  const ana = await newAccount('ana');
  const ids = { ana };
  const computer = await computerWithLibrary(browser, ids, 'ana');
  const before = await titlesOwnedBy(computer.page, ana);
  // Same browser profile (the session is still stored), the library database is gone.
  await computer.page.evaluate(
    () => new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase('guitarap');
      request.onsuccess = () => resolve();
      request.onblocked = () => resolve();
    }),
  );
  await computer.page.goto('/biblioteca');
  await expect(banner(computer.page, 'Biblioteca recuperada')).toBeVisible({ timeout: 30_000 });
  await expect(row(computer.page, 'Canción A')).toBeVisible();
  expect(await titlesOwnedBy(computer.page, ana)).toEqual(before);
  await computer.context.close();
});

test('dos cuentas, mismo celular: cada una recupera solo lo suyo y lo de la otra queda oculto', async ({ browser }) => {
  const ana = await newAccount('ana');
  const beto = await newAccount('beto');
  const ids = { ana, beto };
  const pcAna = await computerWithLibrary(browser, ids, 'ana');
  const pcBeto = await device(browser, ids);
  await openLibrary(pcBeto.page);
  await signIn(pcBeto.page, 'beto');
  await createFromMenu(pcBeto.page, 'Cuaderno de composición', 'Canción de Beto');
  await settleSave(pcBeto.page);
  await pcBeto.page.goto('/biblioteca');
  await syncNow(pcBeto.page);

  const phone = await device(browser, ids, { phone: true });
  await openLibrary(phone.page);
  await signIn(phone.page, 'ana');
  await expect(banner(phone.page, 'Biblioteca recuperada')).toBeVisible({ timeout: 30_000 });
  await signOut(phone.page);
  await expect(row(phone.page, 'Canción A')).toHaveCount(0);
  await signIn(phone.page, 'beto');
  await expect(banner(phone.page, 'Biblioteca recuperada')).toContainText(/0 carpetas, 0 canciones, 1 material/, { timeout: 30_000 });
  await expect(row(phone.page, 'Canción de Beto')).toBeVisible();
  await expect(row(phone.page, 'Canción A')).toHaveCount(0);
  await expect(row(phone.page, 'Escalas')).toHaveCount(0);
  // Both libraries sit in the same browser, each under its own owner, nothing mixed.
  expect(await titlesOwnedBy(phone.page, ana)).toEqual(await titlesOwnedBy(pcAna.page, ana));
  expect(await titlesOwnedBy(phone.page, beto)).toEqual(['Canción de Beto']);
  // And nothing of Ana's travelled to Beto's account or the other way round.
  expect(await serverTitles(beto)).toEqual(['Canción de Beto']);
  expect(await serverTitles(ana)).toEqual(['Canción A']);
  for (const item of [pcAna, pcBeto, phone]) await item.context.close();
});

test('edición sin conexión: queda pendiente, y al volver la conexión sube sin duplicar', async ({ browser }) => {
  const ana = await newAccount('ana');
  const ids = { ana };
  const computer = await computerWithLibrary(browser, ids, 'ana');
  await computer.page.goto('/biblioteca');
  await row(computer.page, 'Canción A').click();
  await computer.context.setOffline(true);
  await computer.page.getByLabel('Título del material').fill('Escrita sin conexión');
  await settleSave(computer.page);
  await computer.page.goto('/biblioteca').catch(() => undefined);
  await computer.context.setOffline(false);
  await computer.page.goto('/biblioteca');
  await syncNow(computer.page);
  expect(await serverTitles(ana)).toEqual(['Escrita sin conexión']);
  expect((await admin(`select count(*)::int as n from public.documents where owner_id = $1`, [ana]))[0]).toMatchObject({ n: 2 }); // the notebook and the trashed riff: no duplicates
  await computer.context.close();
});

test('una descarga interrumpida se reanuda sola, sin duplicados ni faltantes', async ({ browser }) => {
  const ana = await newAccount('ana');
  const ids = { ana };
  const computer = await computerWithLibrary(browser, ids, 'ana');
  for (const title of ['Uno', 'Dos', 'Tres', 'Cuatro']) {
    await computer.page.goto('/biblioteca');
    await createFromMenu(computer.page, 'Cuaderno de composición', title);
    await settleSave(computer.page);
  }
  await computer.page.goto('/biblioteca');
  await syncNow(computer.page);

  const phone = await device(browser, ids, { phone: true, pullPage: 2 });
  let pulls = 0;
  let cut = true;
  await phone.context.route('**/rest/v1/rpc/pull_library', async (route) => {
    pulls += 1;
    if (cut && pulls === 2) return route.abort('connectionreset'); // the connection dies in the middle of the download
    return route.fallback();
  });
  await openLibrary(phone.page);
  await signIn(phone.page, 'ana');
  await expect(banner(phone.page, 'Recuperación pendiente')).toBeVisible({ timeout: 30_000 });
  expect(await statusText(phone.page)).toMatch(/ecuperación pendiente/);
  const partial = (await storedDocuments(phone.page)).length;
  expect(partial).toBeGreaterThan(0); // what had arrived stays
  cut = false;
  await phone.page.getByRole('button', { name: 'Reintentar ahora' }).click();
  await expect(banner(phone.page, 'Biblioteca recuperada')).toBeVisible({ timeout: 30_000 });
  const ours = await titlesOwnedBy(phone.page, ana);
  expect(ours).toEqual(await titlesOwnedBy(computer.page, ana));
  expect(new Set(ours).size).toBe(ours.length); // no duplicates
  await computer.context.close();
  await phone.context.close();
});

test('una respuesta perdida se reintenta con la misma operación: el servidor aplica el cambio una sola vez', async ({ browser }) => {
  const ana = await newAccount('ana');
  const computer = await device(browser, { ana });
  let lost = 0;
  await computer.context.route('**/rest/v1/rpc/sync_library', async (route) => {
    const body = route.request().postDataJSON() as { p_snapshot?: { documents?: unknown[] } };
    if (lost === 0 && body.p_snapshot?.documents?.length) {
      lost += 1;
      await route.fetch(); // the server receives and APPLIES it...
      return route.abort('connectionreset'); // ...but the answer never reaches the app
    }
    return route.fallback();
  });
  await openLibrary(computer.page);
  await signIn(computer.page, 'ana');
  await createFromMenu(computer.page, 'Cuaderno de composición', 'Una sola vez');
  await settleSave(computer.page);
  await computer.page.goto('/biblioteca');
  await syncNow(computer.page);
  expect(lost).toBe(1);
  expect(await serverTitles(ana)).toEqual(['Una sola vez']);
  const events = (await admin(`select count(*)::int as n from public.sync_changes where owner_id = $1 and kind = 'document'`, [ana]))[0] as { n: number };
  expect(events.n).toBeLessThanOrEqual(2); // never one event per attempt
  await computer.context.close();
});

test('dos dispositivos editan el mismo material: ninguna versión se pierde y nada se resuelve solo', async ({ browser }) => {
  const ana = await newAccount('ana');
  const ids = { ana };
  const computer = await computerWithLibrary(browser, ids, 'ana');
  const phone = await device(browser, ids, { phone: true });
  await openLibrary(phone.page);
  await signIn(phone.page, 'ana');
  await expect(banner(phone.page, 'Biblioteca recuperada')).toBeVisible({ timeout: 30_000 });

  // Open the editor once while online (its code is then in memory), as account.spec does, and only then cut the network.
  await row(phone.page, 'Canción A').click();
  await expect(phone.page.getByLabel('Título del material')).toBeVisible();
  await phone.page.getByRole('link', { name: /Volver a la biblioteca/ }).click();
  await phone.context.setOffline(true);
  await row(phone.page, 'Canción A').click();
  await phone.page.getByLabel('Título del material').fill('Versión del celular');
  await settleSave(phone.page);
  await computer.page.goto('/biblioteca');
  await row(computer.page, 'Canción A').click();
  await computer.page.getByLabel('Título del material').fill('Versión de la computadora');
  await settleSave(computer.page);
  await computer.page.goto('/biblioteca');
  await syncNow(computer.page);

  await phone.context.setOffline(false);
  await phone.page.goto('/biblioteca');
  await syncNow(phone.page).catch(() => undefined);
  await expect.poll(async () => (await titlesOwnedBy(phone.page, ana)).join('|'), { timeout: 30_000 }).toContain('Versión de la computadora');
  const titles = await titlesOwnedBy(phone.page, ana);
  expect(titles.join('|')).toContain('Versión del celular'); // the phone's own edit is still there (as a visible copy)
  await computer.context.close();
  await phone.context.close();
});

test('un servidor inaccesible nunca se confunde con una cuenta vacía, y la recuperación termina cuando vuelve', async ({ browser }) => {
  const ana = await newAccount('ana');
  const ids = { ana };
  const computer = await computerWithLibrary(browser, ids, 'ana');
  const phone = await device(browser, ids, { phone: true });
  let down = true;
  await phone.context.route('**/rest/v1/rpc/**', (route) => (down ? route.abort('connectionrefused') : route.fallback()));
  await openLibrary(phone.page);
  await signIn(phone.page, 'ana');
  await expect(banner(phone.page, 'Recuperación pendiente')).toBeVisible({ timeout: 30_000 });
  await expect(phone.page.getByText('Tu cuenta todavía no tiene materiales en la nube.')).toHaveCount(0);
  expect(await statusText(phone.page)).not.toContain('Guardado en tu cuenta');
  down = false;
  await phone.page.getByRole('button', { name: 'Reintentar ahora' }).click();
  await expect(banner(phone.page, 'Biblioteca recuperada')).toContainText(/1 carpeta/, { timeout: 30_000 });
  await expect(row(phone.page, 'Canción A')).toBeVisible();
  await computer.context.close();
  await phone.context.close();
});

test('material creado sin cuenta: se muestra, no se adopta solo, pide confirmación y se puede dejar en el dispositivo', async ({ browser }) => {
  const ana = await newAccount('ana');
  const ids = { ana };
  // (a) adopt: after a copy was offered and the person confirmed.
  const device1 = await device(browser, ids);
  await openLibrary(device1.page);
  await createFromMenu(device1.page, 'Cuaderno de composición', 'Hecha sin cuenta');
  await settleSave(device1.page);
  await device1.page.goto('/biblioteca');
  await signIn(device1.page, 'ana');
  await expect(banner(device1.page, 'Biblioteca recuperada')).toContainText(/Tu cuenta todavía no tiene materiales/, { timeout: 30_000 });
  const prompt = device1.page.getByRole('region', { name: 'Material de este dispositivo sin cuenta' });
  await expect(prompt).toContainText('Hecha sin cuenta');
  await expect(row(device1.page, 'Hecha sin cuenta')).toHaveCount(0); // not part of the account's library
  expect(await serverTitles(ana)).toEqual([]); // and not uploaded
  await expect(prompt.getByRole('button', { name: /Descargar una copia/ })).toBeVisible();
  await prompt.getByRole('button', { name: /Incorporarlos a mi cuenta/ }).click();
  await prompt.getByRole('button', { name: 'Sí, incorporarlos' }).click();
  await expect(row(device1.page, 'Hecha sin cuenta')).toBeVisible();
  await expect.poll(() => serverTitles(ana), { timeout: 30_000 }).toEqual(['Hecha sin cuenta']);
  await device1.context.close();

  // (b) keep: it stays on the device, unowned, never uploaded, visible again when signed out.
  const beto = await newAccount('beto');
  const device2 = await device(browser, { beto });
  await openLibrary(device2.page);
  await createFromMenu(device2.page, 'Cuaderno de composición', 'Solo en este dispositivo');
  await settleSave(device2.page);
  await device2.page.goto('/biblioteca');
  await signIn(device2.page, 'beto');
  const prompt2 = device2.page.getByRole('region', { name: 'Material de este dispositivo sin cuenta' });
  await prompt2.getByRole('button', { name: 'Dejarlos solo en este dispositivo' }).click();
  await expect(prompt2).toHaveCount(0);
  expect(await serverTitles(beto)).toEqual([]);
  await signOut(device2.page);
  await expect(row(device2.page, 'Solo en este dispositivo')).toBeVisible();
  await device2.context.close();
});

test('«Reconstruir desde la nube»: solo descargar no escribe en la nube; subir y descargar lo dice y pide confirmación', async ({ browser }) => {
  const ana = await newAccount('ana');
  const ids = { ana };
  const computer = await computerWithLibrary(browser, ids, 'ana');
  // Automatic sync off, so the only thing that can write to the cloud is what the person asks for.
  await computer.page.goto('/configuracion/sincronizacion');
  await computer.page.getByLabel('Sincronizar automáticamente').uncheck();
  // The choice is written to the local database a moment later: wait for it before leaving the page.
  await expect.poll(() => computer.page.evaluate(() => new Promise<unknown>((resolve) => {
    const open = indexedDB.open('guitarap');
    open.onsuccess = () => {
      const get = open.result.transaction('settings').objectStore('settings').get('account-auto-sync');
      get.onsuccess = () => resolve((get.result as { value?: boolean } | undefined)?.value);
    };
  }))).toBe(false);
  // A change that has not been uploaded yet (made offline).
  await computer.page.goto('/biblioteca');
  await row(computer.page, 'Canción A').click();
  await expect(computer.page.getByLabel('Título del material')).toBeVisible();
  await computer.page.getByRole('link', { name: /Volver a la biblioteca/ }).click();
  await computer.context.setOffline(true);
  await row(computer.page, 'Canción A').click();
  await computer.page.getByLabel('Título del material').fill('Cambio sin subir');
  await settleSave(computer.page);
  await computer.context.setOffline(false);
  await computer.page.goto('/configuracion/datos');

  await computer.page.getByRole('button', { name: 'Solo descargar de la nube' }).click();
  await expect(computer.page.getByText(/No se subió nada/)).toBeVisible({ timeout: 30_000 });
  expect(await serverTitles(ana)).toEqual(['Canción A']); // the cloud was not written to
  expect(await titlesOwnedBy(computer.page, ana)).toContain('Cambio sin subir'); // and the local edit is exactly as it was

  // The other action says that it uploads, and asks first.
  await expect(computer.page.getByText(/SÍ escribe en tu cuenta/)).toBeVisible();
  await computer.page.getByRole('button', { name: 'Subir y descargar…' }).click();
  expect(await serverTitles(ana)).toEqual(['Canción A']); // asking is not doing
  await computer.page.getByRole('button', { name: 'Sí, subir y descargar' }).click();
  await expect(computer.page.getByText(/Se subieron \d+ elementos a tu cuenta/)).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => serverTitles(ana)).toEqual(['Cambio sin subir']);
  await computer.context.close();
});
