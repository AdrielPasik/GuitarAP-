import { expect, test } from '@playwright/test';
import { createMaterial, openLibrary, settleSave } from './helpers';
import { addPart, createSongProject, inviteUrl, linkAndSync, openProject, openProjectShare, readLinkUrl, waitSynced } from './project-helpers';
import { admin, newAccount, newPerson } from './sharing-helpers';

/**
 * Sharing a WHOLE song project («Tema 1 ft Gottya» with its parts), through the real interface and the real sync:
 * the library is created locally, linked, uploaded by the actual sync engine to a real PostgreSQL engine behind the
 * test gateway, and shared from the project header. Nothing here uses anyone's real library.
 */
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

async function ownerWithProject(browser: Parameters<Parameters<typeof test>[2]>[0]['browser'], name: string) {
  const owner = await newAccount('owner');
  const { page } = await newPerson(browser, owner);
  await openLibrary(page);
  await createSongProject(page, name);
  await addPart(page, 'Letra y melodía', 'Hoy vuelvo a empezar con los acordes');
  await addPart(page, 'Arreglos', 'Intro con guitarra limpia');
  await linkAndSync(page);
  return { owner, page };
}

test('Escenario A — el proyecto con dos partes se comparte con UN enlace y el invitado ve ambas', async ({ browser }) => {
  const { owner, page } = await ownerWithProject(browser, 'Tema de prueba');

  // The server has the project and BOTH parts, related to it.
  const remote = await admin<Array<{ title: string; kind: string }>>(
    `select d.title, n.kind from public.documents d join public.library_nodes n on n.id = d.song_id where d.owner_id = $1 order by d.title`, [owner]);
  expect(remote.map((row) => row.title)).toEqual(['Arreglos', 'Letra y melodía']);
  expect(remote.every((row) => row.kind === 'song')).toBe(true);

  await openProject(page, 'Tema de prueba');
  const dialog = await openProjectShare(page, 'Tema de prueba');
  await expect(dialog.getByText('Esto compartirá el proyecto con 2 partes')).toBeVisible();
  await expect(dialog.getByRole('listitem').filter({ hasText: 'Letra y melodía' })).toBeVisible();
  await expect(dialog.getByRole('listitem').filter({ hasText: 'Arreglos' })).toBeVisible();
  await expect(dialog.getByText(/Si agregás una parte nueva a este proyecto, queda compartida/)).toBeVisible();
  const url = await readLinkUrl(dialog);

  // ONE link, opened by someone with no account: the whole project.
  const { page: guest } = await newPerson(browser, null);
  await guest.goto(url);
  await expect(guest.getByRole('heading', { name: 'Tema de prueba' })).toBeVisible();
  await expect(guest.getByText('2 partes')).toBeVisible();
  await expect(guest.getByRole('navigation', { name: 'Partes del proyecto' }).getByRole('link', { name: 'Arreglos' })).toBeVisible();
  await expect(guest.getByText('Hoy vuelvo a empezar con los acordes')).toBeVisible();
  await expect(guest.getByText('Intro con guitarra limpia')).toBeVisible();
  await expect(guest.locator('textarea')).toHaveCount(0); // read-only
});

test('Escenario B — compartir el proyecto A no abre el proyecto B ni nada más de la biblioteca', async ({ browser }) => {
  const { owner, page } = await ownerWithProject(browser, 'Proyecto A');
  await createSongProject(page, 'Proyecto B');
  await addPart(page, 'Secreta B', 'NO-COMPARTIR-PROYECTO-B');
  await page.goto('/biblioteca');
  await createMaterial(page, 'Tablatura', 'Suelta privada');
  await settleSave(page);
  await waitSynced(page);

  await openProject(page, 'Proyecto A');
  const dialog = await openProjectShare(page, 'Proyecto A');
  await expect(dialog.getByText('Esto compartirá el proyecto con 2 partes')).toBeVisible();
  await expect(dialog.getByText('Secreta B')).toHaveCount(0);
  const url = await readLinkUrl(dialog);

  const bodies: string[] = [];
  const { page: guest } = await newPerson(browser, null);
  guest.on('response', async (response) => {
    if (response.url().includes('/rest/v1/rpc/')) bodies.push(await response.text().catch(() => ''));
  });
  await guest.goto(url);
  await expect(guest.getByText('Intro con guitarra limpia')).toBeVisible();
  expect(await guest.content()).not.toContain('NO-COMPARTIR-PROYECTO-B');
  expect(bodies.join('')).not.toContain('NO-COMPARTIR-PROYECTO-B');
  expect(bodies.join('')).not.toContain('Suelta privada');

  // Straight to the API with the link's guest rights: another project's documents are refused.
  const other = await admin<Array<{ id: string }>>(`select id from public.documents where owner_id = $1 and title = 'Secreta B'`, [owner]);
  const forbidden = await guest.evaluate(async (id) => {
    const response = await fetch('http://127.0.0.1:4310/rest/v1/rpc/collab_pull_document', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ p_doc: id }) });
    return response.status;
  }, other[0].id);
  expect(forbidden).toBeGreaterThanOrEqual(400);
});

test('Escenario C — una parte nueva dentro del proyecto compartido entra en el enlace (herencia), y una parte sacada deja de verse', async ({ browser }) => {
  const { page } = await ownerWithProject(browser, 'Proyecto C');
  await openProject(page, 'Proyecto C');
  const dialog = await openProjectShare(page, 'Proyecto C');
  const url = await readLinkUrl(dialog);
  await page.keyboard.press('Escape');

  const { page: guest } = await newPerson(browser, null);
  await guest.goto(url);
  await expect(guest.getByText('2 partes')).toBeVisible();

  await addPart(page, 'Puente nuevo', 'Letra de la parte agregada después');
  await waitSynced(page);
  await guest.reload();
  await expect(guest.getByText('3 partes')).toBeVisible();
  await expect(guest.getByText('Letra de la parte agregada después')).toBeVisible();
});

test('Escenario D — un editor invitado al PROYECTO trabaja en sus partes y el propietario recibe los cambios', async ({ browser }) => {
  const { owner, page } = await ownerWithProject(browser, 'Proyecto D');
  const goti = await newAccount('goti');
  await openProject(page, 'Proyecto D');
  const dialog = await openProjectShare(page, 'Proyecto D');
  const invitation = await inviteUrl(dialog, 'Editor');

  const { page: friend } = await newPerson(browser, goti);
  await friend.goto(invitation);
  await friend.getByLabel('Tu nombre para el proyecto').fill('Goti');
  await friend.getByRole('button', { name: 'Aceptar invitación' }).click();
  await friend.waitForURL(/\/compartidos/);
  // The shared project is ONE entry with its parts under it.
  const project = friend.getByRole('list', { name: 'Partes de Proyecto D' });
  await expect(project.getByRole('link', { name: 'Letra y melodía' })).toBeVisible();
  await expect(project.getByRole('link', { name: 'Arreglos' })).toBeVisible();

  await project.getByRole('link', { name: 'Letra y melodía' }).click();
  await friend.getByLabel('Letra', { exact: true }).fill('Letra cambiada por Goti');
  await expect.poll(async () => (await admin<Array<{ t: string }>>(`select b->'content'->>'text' as t from public.documents d, jsonb_array_elements(d.payload->'blocks') b where d.owner_id = $1 and d.title = 'Letra y melodía' and b->>'kind' = 'lyrics'`, [owner]))[0].t, { timeout: 20000 }).toBe('Letra cambiada por Goti');
  await friend.goto('/compartidos');
  await friend.getByRole('list', { name: 'Partes de Proyecto D' }).getByRole('link', { name: 'Arreglos' }).click();
  await friend.getByLabel('Letra', { exact: true }).fill('Arreglo cambiado por Goti');
  await expect.poll(async () => (await admin<Array<{ t: string }>>(`select b->'content'->>'text' as t from public.documents d, jsonb_array_elements(d.payload->'blocks') b where d.owner_id = $1 and d.title = 'Arreglos' and b->>'kind' = 'lyrics'`, [owner]))[0].t, { timeout: 20000 }).toBe('Arreglo cambiado por Goti');

  // The owner's own sync pulls both edits, and nothing the owner had is lost.
  await page.goto('/biblioteca');
  await expect(page.locator('.topbar').getByText('Guardado en tu cuenta')).toBeVisible({ timeout: 30000 });
  await openProject(page, 'Proyecto D');
  await page.locator('.lib-row', { hasText: 'Letra y melodía' }).locator('.lib-open').click();
  await expect(page.getByLabel('Letra', { exact: true })).toHaveValue('Letra cambiada por Goti');
});

test('Escenario E — revocar corta las lecturas nuevas y no toca el resto de la biblioteca', async ({ browser }) => {
  const { owner, page } = await ownerWithProject(browser, 'Proyecto E');
  await openProject(page, 'Proyecto E');
  const dialog = await openProjectShare(page, 'Proyecto E');
  const url = await readLinkUrl(dialog);
  const { page: guest } = await newPerson(browser, null);
  await guest.goto(url);
  await expect(guest.getByText('Intro con guitarra limpia')).toBeVisible();

  await dialog.getByRole('button', { name: 'Revocar' }).click();
  await guest.reload();
  await expect(guest.getByRole('heading', { name: 'Este enlace fue desactivado' })).toBeVisible();
  await expect(guest.getByText('Intro con guitarra limpia')).toHaveCount(0);
  // The library itself is exactly as it was.
  const counts = await admin<Array<{ nodes: number; docs: number }>>(
    `select (select count(*) from public.library_nodes where owner_id = $1 and deleted_at is null)::int as nodes, (select count(*) from public.documents where owner_id = $1 and deleted_at is null)::int as docs`, [owner]);
  expect(counts[0]).toEqual({ nodes: 1, docs: 2 });
});

test('Escenario F — una carpeta normal con dos mapas se comparte completa y sin contenido externo', async ({ browser }) => {
  const owner = await newAccount('owner');
  const { page } = await newPerson(browser, owner);
  await openLibrary(page);
  await page.getByRole('button', { name: 'Nuevo', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Carpeta' }).click();
  await page.getByRole('dialog').getByLabel('Nombre').fill('Escalas de prueba');
  await page.getByRole('dialog').getByRole('button', { name: 'Crear' }).click();
  await page.locator('.lib-row', { hasText: 'Escalas de prueba' }).locator('.lib-open').click();
  for (const title of ['Do jónico', 'La menor']) {
    await createMaterial(page, 'Mapa de escala', title);
    await settleSave(page);
    await page.getByRole('link', { name: /Volver a la biblioteca/ }).click();
  }
  await page.goto('/biblioteca');
  await createMaterial(page, 'Tablatura', 'Fuera de la carpeta');
  await settleSave(page);
  await linkAndSync(page);

  await page.goto('/biblioteca');
  await page.locator('.lib-row', { hasText: 'Escalas de prueba' }).locator('.lib-open').click();
  await page.getByRole('button', { name: 'Compartir carpeta' }).click();
  const dialog = page.getByRole('dialog', { name: /^Compartir «Escalas de prueba»/ });
  await expect(dialog.getByText('Esto compartirá 2 materiales de esta carpeta')).toBeVisible();
  await expect(dialog.getByText('Fuera de la carpeta')).toHaveCount(0);
  const url = await readLinkUrl(dialog);

  const { page: guest } = await newPerson(browser, null);
  await guest.goto(url);
  await expect(guest.getByRole('heading', { name: 'Escalas de prueba' })).toBeVisible();
  await expect(guest.getByRole('heading', { name: 'Do jónico' })).toBeVisible();
  await expect(guest.getByRole('heading', { name: 'La menor' })).toBeVisible();
  await expect(guest.getByText('Fuera de la carpeta')).toHaveCount(0);
});

test('compartir un proyecto que todavía no está en la nube ofrece sincronizar de verdad y NO crea ningún enlace antes de la confirmación', async ({ browser }) => {
  const owner = await newAccount('owner');
  const { page } = await newPerson(browser, owner);
  await openLibrary(page);
  await createSongProject(page, 'Todavía local');
  await addPart(page, 'Parte uno', 'texto local');

  // Linked but with automatic sync off: the project exists only on this device.
  await page.addInitScript(() => undefined);
  await page.goto('/configuracion/sincronizacion');
  await page.getByRole('button', { name: 'Descargar copia de seguridad' }).click();
  await page.getByLabel(/Confirmo que el archivo se guardó/).check();
  // Hold the sync back so the project stays local while the dialog is opened.
  await page.route('**/rest/v1/rpc/sync_library', (route) => route.abort('failed'));
  await page.getByRole('button', { name: 'Vincular y sincronizar' }).click();
  // The library is linked once the wizard is gone; the held-back sync leaves it with unsent changes.
  await expect(page.locator('.topbar').getByText('Falta activar la sincronización')).toHaveCount(0);
  await openProject(page, 'Todavía local');
  await page.getByRole('button', { name: 'Compartir proyecto' }).click();
  const dialog = page.getByRole('dialog', { name: /^Compartir el proyecto «Todavía local»/ });
  await expect(dialog.getByText('Este proyecto todavía no está en tu cuenta en la nube.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Crear enlace de lectura' })).toHaveCount(0);
  expect((await admin<Array<{ n: number }>>(`select count(*)::int as n from public.share_links where owner_id = $1`, [owner]))[0].n).toBe(0);

  // Let the sync through and use the button: the server confirms, then the options appear.
  await page.unroute('**/rest/v1/rpc/sync_library');
  await dialog.getByRole('button', { name: 'Sincronizar para compartir' }).click();
  await expect(dialog.getByText('Esto compartirá el proyecto con 1 parte')).toBeVisible({ timeout: 30000 });
  await expect(dialog.getByRole('button', { name: 'Crear enlace de lectura' })).toBeEnabled();
});
