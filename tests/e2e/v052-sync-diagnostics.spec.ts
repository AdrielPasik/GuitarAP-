import { expect, test, type Page } from '@playwright/test';
import { createMaterial, openLibrary, settleSave, storedDocuments } from './helpers';
import { createSongProject, addPart } from './project-helpers';
import { admin, newAccount, newPerson } from './sharing-helpers';

/**
 * What the person sees when the first sync fails, and that nothing is lost while it does. The server's answers are
 * injected at the HTTP layer; the library, the sync engine and the interface are the real ones.
 */
test.setTimeout(120_000);

async function localLibrary(page: Page) {
  await openLibrary(page);
  await createSongProject(page, 'Tema 1 ft Gottya');
  await addPart(page, 'Letra y melodía', 'texto-de-prueba-privado');
  await addPart(page, 'Arreglos', 'otro texto privado');
  await page.goto('/biblioteca');
  await createMaterial(page, 'Tablatura', 'Riff suelto');
  await settleSave(page);
}

async function startLinking(page: Page) {
  await page.goto('/configuracion/sincronizacion');
  await page.getByRole('button', { name: 'Descargar copia de seguridad' }).click();
  await page.getByLabel(/Confirmo que el archivo se guardó/).check();
  await page.getByRole('button', { name: 'Vincular y sincronizar' }).click();
  await expect(page.locator('.topbar').getByText('Falta activar la sincronización')).toHaveCount(0);
}

const snapshotOfLibrary = async (page: Page) => JSON.stringify((await storedDocuments(page)).map((doc) => [doc.id, doc.title, doc.rev]).sort());

test('un error 42702 de sync_library se explica con su causa, su código y la acción, sin datos privados; y al repararlo todo sube', async ({ browser }) => {
  const owner = await newAccount('owner');
  const { page } = await newPerson(browser, owner);
  await localLibrary(page);
  const before = await snapshotOfLibrary(page);

  let broken = true;
  await page.route('**/rest/v1/rpc/sync_library', (route) =>
    broken
      ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: '42702', message: 'column reference "parent_id" is ambiguous', details: 'It could refer to either a PL/pgSQL variable or a table column.' }) })
      : route.continue(),
  );
  await startLinking(page);

  // The chip and the menu name the problem instead of the old generic sentence.
  await expect(page.locator('.topbar').getByText('Falta aplicar una reparación en Supabase')).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Cuenta y sincronización' }).click();
  await expect(page.getByText(/0008_sync_library_fix\.sql/).first()).toBeVisible();
  await page.keyboard.press('Escape');

  // Settings → Sincronización: the exact error, the one action, and a technical detail that is safe to paste.
  await page.goto('/configuracion/sincronizacion');
  await expect(page.getByRole('button', { name: 'Copiar la migración 0008' })).toBeVisible();
  await page.getByText('Detalle técnico del último intento').click();
  const detail = page.getByLabel('Diagnóstico de sincronización');
  await expect(detail).toContainText('Operación: subida de cambios');
  await expect(detail).toContainText('Función: sync_library');
  await expect(detail).toContainText('HTTP: 400');
  await expect(detail).toContainText('Código: 42702');
  const text = (await detail.textContent()) ?? '';
  for (const secret of ['test-user:', owner, 'texto-de-prueba-privado', 'otro texto privado', 'Tema 1 ft Gottya', '@example.com']) expect(text).not.toContain(secret);

  // Nothing local was touched, and nothing reached the server.
  expect(await snapshotOfLibrary(page)).toBe(before);
  expect((await admin<Array<{ n: number }>>(`select count(*)::int as n from public.documents where owner_id = $1`, [owner]))[0].n).toBe(0);

  // Once the server is repaired, the very next sync uploads everything (the refused batch is not replayed forever).
  broken = false;
  await page.getByRole('button', { name: 'Sincronizar ahora' }).click();
  await expect(page.locator('.topbar').getByText('Todo sincronizado')).toBeVisible({ timeout: 30000 });
  const remote = await admin<Array<{ title: string }>>(`select title from public.documents where owner_id = $1 order by title`, [owner]);
  expect(remote.map((row) => row.title)).toEqual(['Arreglos', 'Letra y melodía', 'Riff suelto']);
  expect((await admin<Array<{ n: number }>>(`select count(*)::int as n from public.library_nodes where owner_id = $1`, [owner]))[0].n).toBe(1);
  expect(await snapshotOfLibrary(page)).toBe(before.replace(/,\d+\]/g, (m) => m)); // titles and ids unchanged locally
});

test('cada tipo de fallo dice lo suyo: sesión vencida, servidor caído y conexión perdida', async ({ browser }) => {
  const owner = await newAccount('owner');
  const { page } = await newPerson(browser, owner);
  await localLibrary(page);

  let mode: 'auth' | 'server' | 'network' | 'ok' = 'auth';
  await page.route('**/rest/v1/rpc/sync_library', (route) => {
    if (mode === 'auth') return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST301', message: 'JWT expired' }) });
    if (mode === 'server') return route.fulfill({ status: 503, contentType: 'text/html', body: '<html>upstream</html>' });
    if (mode === 'network') return route.abort('failed');
    return route.continue();
  });
  await startLinking(page);
  await expect(page.locator('.topbar').getByText('Tu sesión venció')).toBeVisible({ timeout: 30000 });

  mode = 'server';
  await page.getByRole('button', { name: 'Cuenta y sincronización' }).click();
  await page.locator('.account-panel').getByRole('button', { name: 'Sincronizar ahora' }).click();
  await expect(page.locator('.topbar').getByText(/Sin conexión|Supabase no responde/).first()).toBeVisible({ timeout: 30000 });

  mode = 'network';
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Cuenta y sincronización' }).click();
  await page.locator('.account-panel').getByRole('button', { name: 'Sincronizar ahora' }).click();
  await expect(page.locator('.topbar').getByText(/Sin conexión/).first()).toBeVisible({ timeout: 30000 });

  mode = 'ok';
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Cuenta y sincronización' }).click();
  await page.locator('.account-panel').getByRole('button', { name: 'Sincronizar ahora' }).click();
  await expect(page.locator('.topbar').getByText('Todo sincronizado').first()).toBeVisible({ timeout: 40000 });
  expect((await admin<Array<{ n: number }>>(`select count(*)::int as n from public.documents where owner_id = $1`, [owner]))[0].n).toBe(3);
});
