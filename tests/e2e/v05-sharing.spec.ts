import { expect, test, type Page } from '@playwright/test';
import { createFromMenu, openLibrary, settleSave } from './helpers';
import { admin, documentId, mirror, newAccount, newPerson, openShare, serverDocument } from './sharing-helpers';

test.describe.configure({ mode: 'serial', timeout: 120_000 }); // one PostgreSQL engine behind the gateway: no parallel pressure

/** Creates an invitation and returns ITS link (waits until the displayed link is the new one). */
async function freshInvite(dialog: ReturnType<Page['getByRole']>, role?: string) {
  const field = dialog.getByLabel('Enlace para copiar');
  const previous = (await field.count()) ? await field.inputValue() : '';
  if (role) await dialog.getByLabel('Rol de la invitación').selectOption(role);
  await dialog.getByRole('button', { name: 'Crear invitación' }).click();
  if (previous) await expect(field).not.toHaveValue(previous);
  else await expect(field).toBeVisible();
  return field.inputValue();
}

const typeLyrics = async (page: Page, text: string) => {
  await page.getByLabel('Letra', { exact: true }).fill(text);
};
/** The owner's side: a song written through the interface and mirrored to the test database as sync would. */
async function ownerSong(page: Page, owner: string, title: string, lyrics = '# Verso 1\nHoy vuelvo a empezar') {
  await openLibrary(page);
  await createFromMenu(page, 'Canción con letra', title);
  await typeLyrics(page, lyrics);
  await page.getByRole('button', { name: 'Agregar bloque', exact: true }).first().click();
  await page.getByRole('menuitem', { name: /^Melodía/ }).click();
  await page.getByLabel('Escribir notas').fill('Do4 Mi4 Sol4');
  await page.getByLabel('Escribir notas').press('Enter');
  await settleSave(page);
  const id = await mirror(page, owner, title);
  return id;
}

test('Escenario A — un enlace de lectura abre solo esa canción, sin cuenta, sin poder editar', async ({ browser }) => {
  const owner = await newAccount('owner');
  const { page: ownerPage } = await newPerson(browser, owner);
  await ownerSong(ownerPage, owner, 'Tema 1 FT Goti');
  await ownerPage.reload();
  const dialog = await openShare(ownerPage);
  await expect(dialog.getByText('Privado')).toBeVisible();
  await dialog.getByRole('button', { name: 'Crear enlace de lectura' }).click();
  const url = await dialog.getByLabel('Enlace para copiar').inputValue();
  expect(url).toMatch(/\/c\/[A-Za-z0-9_-]{40,}$/);
  await expect(dialog.getByText('Compartido mediante enlace')).toBeVisible();

  const { page: guest, context } = await newPerson(browser, null);
  const responses: string[] = [];
  guest.on('response', async (response) => {
    if (response.url().includes('/rest/v1/rpc/')) responses.push(await response.text().catch(() => ''));
  });
  await guest.goto(url);
  await expect(guest.getByRole('heading', { name: 'Tema 1 FT Goti', level: 1 })).toBeVisible();
  await expect(guest.getByText('Hoy vuelvo a empezar')).toBeVisible();
  await expect(guest.getByRole('button', { name: 'Reproducir melodía' })).toBeVisible();
  // Nothing editable, no app navigation, no way to add or change anything.
  await expect(guest.locator('textarea')).toHaveCount(0);
  await expect(guest.getByRole('button', { name: 'Agregar bloque' })).toHaveCount(0);
  await expect(guest.getByRole('navigation', { name: 'Secciones principales' })).toHaveCount(0);
  await expect(guest.getByLabel('Escribir notas')).toHaveCount(0);

  // Trying to write through the API with the public key and the link token is refused.
  const direct = await context.request.post('http://127.0.0.1:4310/rest/v1/rpc/collab_save_document', {
    data: { p_doc: documentId(ownerPage), p_base_rev: 1, p_title: 'hackeado', p_content: { kind: 'notebook', version: 1, blocks: [] }, p_op_id: crypto.randomUUID() },
  });
  expect(direct.status()).toBe(403);
  expect((await serverDocument(documentId(ownerPage))).title).toBe('Tema 1 FT Goti');
  expect(responses.join('')).not.toContain('"comments"');
});

test('Escenario B — la contraseña se valida en el servidor: sin ella no viaja ningún contenido, y revocar corta el acceso', async ({ browser }) => {
  const owner = await newAccount('owner');
  const { page: ownerPage } = await newPerson(browser, owner);
  await ownerSong(ownerPage, owner, 'Protegida', '# Verso 1\nTEXTO-QUE-NO-DEBE-FILTRARSE');
  await ownerPage.reload();
  const dialog = await openShare(ownerPage);
  await dialog.getByLabel('Proteger con contraseña').check();
  await dialog.getByLabel('Contraseña del enlace').fill('cancion-123');
  await dialog.getByRole('button', { name: 'Crear enlace de lectura' }).click();
  const url = await dialog.getByLabel('Enlace para copiar').inputValue();

  const { page: guest } = await newPerson(browser, null);
  const bodies: string[] = [];
  guest.on('response', async (response) => {
    if (response.url().includes('/rest/v1/rpc/')) bodies.push(await response.text().catch(() => ''));
  });
  await guest.goto(url);
  // Before the password even the project's title stays on the server.
  await expect(guest.getByRole('heading', { name: 'Proyecto protegido' })).toBeVisible();
  await expect(guest.getByText('Este proyecto está protegido')).toBeVisible();
  await expect(guest.getByText('Protegida', { exact: true })).toHaveCount(0);
  await expect(guest.getByText('TEXTO-QUE-NO-DEBE-FILTRARSE')).toHaveCount(0);
  expect(await guest.content()).not.toContain('TEXTO-QUE-NO-DEBE-FILTRARSE');
  expect(bodies.join('')).not.toContain('TEXTO-QUE-NO-DEBE-FILTRARSE');

  await guest.getByLabel('Contraseña').fill('incorrecta');
  await guest.getByRole('button', { name: 'Entrar' }).click();
  await expect(guest.getByRole('alert')).toContainText('no es correcta');
  await expect(guest.getByText('TEXTO-QUE-NO-DEBE-FILTRARSE')).toHaveCount(0);
  expect(bodies.join('')).not.toContain('TEXTO-QUE-NO-DEBE-FILTRARSE');

  await guest.getByLabel('Contraseña').fill('cancion-123');
  await guest.getByRole('button', { name: 'Entrar' }).click();
  await expect(guest.getByText('TEXTO-QUE-NO-DEBE-FILTRARSE')).toBeVisible();

  // The owner revokes: the same link now explains it, and the session no longer opens anything.
  await dialog.getByRole('button', { name: 'Revocar' }).click();
  await expect(dialog.getByText('Enlace revocado: ya no funciona.').or(ownerPage.locator('.toast'))).toBeVisible();
  await guest.reload();
  await expect(guest.getByRole('heading', { name: 'Este enlace fue desactivado' })).toBeVisible();
  await expect(guest.getByText('TEXTO-QUE-NO-DEBE-FILTRARSE')).toHaveCount(0);
});

test('un enlace inventado o vencido muestra una pantalla clara y no entrega nada', async ({ browser }) => {
  const { page } = await newPerson(browser, null);
  await page.goto('/c/token-que-no-existe-0123456789abcdefghij');
  await expect(page.getByRole('heading', { name: 'Este enlace no funciona' })).toBeVisible();
  const owner = await newAccount('owner');
  const { page: ownerPage } = await newPerson(browser, owner);
  await ownerSong(ownerPage, owner, 'Por vencer');
  await ownerPage.reload();
  const dialog = await openShare(ownerPage);
  await dialog.getByRole('button', { name: /Más opciones/ }).click();
  await dialog.getByLabel('Vencimiento del enlace').selectOption('1');
  await dialog.getByRole('button', { name: 'Crear enlace de lectura' }).click();
  const url = await dialog.getByLabel('Enlace para copiar').inputValue();
  await admin(`update public.share_links set expires_at = now() - interval '1 minute'`);
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'Este enlace venció' })).toBeVisible();
});

test('Escenario C y D — invitar a un editor: acepta, edita la letra; el comentarista solo comenta; el lector solo lee; los roles cambian', async ({ browser }) => {
  const owner = await newAccount('owner');
  const goti = await newAccount('goti');
  const carla = await newAccount('carla');
  const lector = await newAccount('lector');
  const { page: ownerPage } = await newPerson(browser, owner);
  const id = await ownerSong(ownerPage, owner, 'Tema compartido');
  await ownerPage.reload();
  const dialog = await openShare(ownerPage);

  const invite = (role: string) => freshInvite(dialog, role);

  // The editor accepts and writes.
  const editorUrl = await invite('editor');
  const { page: betoPage } = await newPerson(browser, goti);
  await betoPage.goto(editorUrl);
  await betoPage.getByLabel('Tu nombre para el proyecto').fill('Goti');
  await betoPage.getByRole('button', { name: 'Aceptar invitación' }).click();
  await betoPage.waitForURL(/\/compartido\//);
  await expect(betoPage.getByText('Editor', { exact: true })).toBeVisible();
  await betoPage.getByLabel('Letra', { exact: true }).fill('# Verso 1\nHoy vuelvo a empezar, escrito por Goti');
  await expect.poll(async () => JSON.stringify((await serverDocument(id)).payload), { timeout: 15000 }).toContain('escrito por Goti');
  const edited = await serverDocument(id);
  expect(edited.rev).toBe(2);
  expect(edited.payload.blocks.map((block) => block.kind)).toEqual(['lyrics', 'melody']); // the melody is untouched

  // The owner sees who did what.
  await dialog.getByRole('button', { name: 'Actualizar' }).click();
  await dialog.getByText('Actividad').click();
  await expect(dialog.getByRole('list', { name: 'Actividad del proyecto' })).toContainText('Goti editó el proyecto');

  // A viewer cannot write; a commenter can only comment.
  const viewerUrl = await invite('viewer');
  const { page: viewerPage } = await newPerson(browser, lector);
  await viewerPage.goto(viewerUrl);
  await viewerPage.getByRole('button', { name: 'Aceptar invitación' }).click();
  await viewerPage.waitForURL(/\/compartido\//);
  await expect(viewerPage.getByText('Tenés acceso de lectura')).toBeVisible();
  await expect(viewerPage.locator('textarea')).toHaveCount(0);
  await expect(viewerPage.getByText('escrito por Goti')).toBeVisible();

  const commenterUrl = await invite('commenter');
  const { page: carlaPage } = await newPerson(browser, carla);
  await carlaPage.goto(commenterUrl);
  await carlaPage.getByLabel('Tu nombre para el proyecto').fill('Carla');
  await carlaPage.getByRole('button', { name: 'Aceptar invitación' }).click();
  await carlaPage.waitForURL(/\/compartido\//);
  await expect(carlaPage.locator('textarea:not([aria-label^="Nuevo comentario"])')).toHaveCount(0);
  await carlaPage.getByRole('button', { name: 'Comentarios de letra 1' }).click();
  await carlaPage.getByLabel('Nuevo comentario sobre letra 1').fill('Me encanta el verso');
  await carlaPage.getByRole('button', { name: 'Agregar comentario' }).click();
  await expect.poll(async () => JSON.stringify((await serverDocument(id)).payload.comments ?? []), { timeout: 15000 }).toContain('Me encanta el verso');
  await expect(carlaPage.getByRole('button', { name: 'Editar' })).toHaveCount(0); // a commenter cannot edit or delete comments

  // The owner promotes the commenter: the new role applies.
  await dialog.getByRole('button', { name: 'Actualizar' }).click();
  await dialog.getByLabel('Rol de Carla').selectOption('editor');
  // selectOption sets the DOM value at once; the server has the new role only when the dialog finished saving.
  await expect(ownerPage.locator('.toast', { hasText: 'Rol actualizado.' })).toBeVisible();
  await expect(dialog.getByLabel('Rol de Carla')).toBeEnabled();
  await expect(dialog.getByLabel('Rol de Carla')).toHaveValue('editor');
  await carlaPage.reload();
  await expect(carlaPage.getByText('Editor', { exact: true })).toBeVisible();
  await expect(carlaPage.getByLabel('Letra', { exact: true })).toBeVisible();
});

test('Escenario E — al revocar, el colaborador pierde el acceso, sus cambios pendientes no se suben y puede guardar su copia', async ({ browser }) => {
  const owner = await newAccount('owner');
  const goti = await newAccount('goti');
  const { page: ownerPage } = await newPerson(browser, owner);
  const id = await ownerSong(ownerPage, owner, 'A revocar');
  await ownerPage.reload();
  const dialog = await openShare(ownerPage);
  const url = await freshInvite(dialog);
  const { page: betoPage } = await newPerson(browser, goti);
  await betoPage.goto(url);
  await betoPage.getByRole('button', { name: 'Aceptar invitación' }).click();
  await betoPage.waitForURL(/\/compartido\//);
  await expect(betoPage.getByLabel('Letra', { exact: true })).toBeVisible();

  await dialog.getByRole('button', { name: 'Actualizar' }).click();
  await dialog.getByRole('button', { name: 'Quitar acceso' }).click();
  await expect(dialog.getByText('ya no tiene acceso').or(ownerPage.locator('.toast'))).toBeVisible();

  await betoPage.getByLabel('Letra', { exact: true }).fill('escrito después de la revocación');
  await betoPage.getByRole('button', { name: 'Actualizar' }).click();
  await expect(betoPage.getByRole('alert')).toContainText(/Ya no tenés|Se quitó|acceso/);
  expect(JSON.stringify((await serverDocument(id)).payload)).not.toContain('después de la revocación');

  await betoPage.getByRole('button', { name: 'Guardar mi copia en mi biblioteca' }).click();
  await betoPage.waitForURL(/\/material\//);
  await expect(betoPage.getByLabel('Letra', { exact: true })).toHaveValue(/después de la revocación/);
});

test('Escenario F — dos editores cambian bloques distintos y se conservan ambos; si tocan lo mismo, nada se pisa en silencio', async ({ browser }) => {
  const owner = await newAccount('owner');
  const ana = await newAccount('ana');
  const beto = await newAccount('beto');
  const { page: ownerPage } = await newPerson(browser, owner);
  const id = await ownerSong(ownerPage, owner, 'Dos manos');
  await ownerPage.reload();
  const dialog = await openShare(ownerPage);
  const urls: string[] = [];
  for (let index = 0; index < 2; index += 1) urls.push(await freshInvite(dialog));
  const { page: anaPage } = await newPerson(browser, ana);
  const { page: betoPage } = await newPerson(browser, beto);
  for (const [page, url] of [[anaPage, urls[0]], [betoPage, urls[1]]] as const) {
    await page.goto(url);
    await page.getByRole('button', { name: 'Aceptar invitación' }).click();
    await page.waitForURL(/\/compartido\//);
    await expect(page.getByLabel('Letra', { exact: true })).toBeVisible();
  }

  // Ana edits the lyrics, Beto the melody (his page still has the old revision).
  await anaPage.getByLabel('Letra', { exact: true }).fill('# Verso 1\nLetra de Ana');
  await expect.poll(async () => JSON.stringify((await serverDocument(id)).payload), { timeout: 15000 }).toContain('Letra de Ana');
  await betoPage.getByLabel('Escribir notas').fill('Re4');
  await betoPage.getByLabel('Escribir notas').press('Enter');
  await expect.poll(async () => JSON.stringify((await serverDocument(id)).payload), { timeout: 20000 }).toContain('"midi":62');
  const merged = await serverDocument(id);
  expect(JSON.stringify(merged.payload)).toContain('Letra de Ana');
  expect((merged.payload.blocks[1].content as { events: unknown[] }).events).toHaveLength(4);

  // Now both touch the SAME lyrics block from the same starting point.
  await anaPage.getByRole('button', { name: 'Actualizar' }).click();
  await betoPage.getByRole('button', { name: 'Actualizar' }).click();
  await anaPage.getByLabel('Letra', { exact: true }).fill('# Verso 1\nVersión de Ana 2');
  await expect.poll(async () => JSON.stringify((await serverDocument(id)).payload), { timeout: 15000 }).toContain('Versión de Ana 2');
  await betoPage.getByLabel('Letra', { exact: true }).fill('# Verso 1\nVersión de Beto 2');
  await expect(betoPage.getByText('Se combinaron tus cambios')).toBeVisible({ timeout: 20000 });
  await expect.poll(async () => JSON.stringify((await serverDocument(id)).payload), { timeout: 20000 }).toContain('Versión de Beto 2');
  const final = JSON.stringify((await serverDocument(id)).payload);
  expect(final).toContain('Versión de Ana 2'); // her version was not overwritten
  expect(final).toContain('(tu versión)'); // his is kept as a labelled copy
});

test('Escenario G — compartir una carpeta muestra qué se comparte, alcanza solo su contenido y se corta al mover o revocar', async ({ browser }) => {
  const owner = await newAccount('owner');
  const goti = await newAccount('goti');
  const { page: ownerPage } = await newPerson(browser, owner);
  await openLibrary(ownerPage);
  await ownerPage.getByRole('button', { name: 'Nuevo', exact: true }).click();
  await ownerPage.getByRole('menuitem', { name: 'Carpeta' }).click();
  await ownerPage.getByRole('dialog').getByLabel('Nombre').fill('Colaboraciones');
  await ownerPage.getByRole('dialog').getByRole('button', { name: 'Crear' }).click();
  await ownerPage.locator('.lib-row', { hasText: 'Colaboraciones' }).locator('.lib-open').click();
  await createFromMenu(ownerPage, 'Canción con letra', 'Dentro');
  await typeLyrics(ownerPage, 'letra de adentro');
  await settleSave(ownerPage);
  await mirror(ownerPage, owner, 'Dentro');
  await ownerPage.goto('/biblioteca');
  await createFromMenu(ownerPage, 'Canción con letra', 'Privada afuera');
  await typeLyrics(ownerPage, 'NO COMPARTIR');
  await settleSave(ownerPage);
  await mirror(ownerPage, owner, 'Privada afuera');

  await ownerPage.goto('/biblioteca');
  await ownerPage.locator('.lib-row', { hasText: 'Colaboraciones' }).getByRole('button', { name: /Opciones de Colaboraciones/ }).click();
  await ownerPage.getByRole('menuitem', { name: 'Compartir carpeta…' }).click();
  const dialog = ownerPage.getByRole('dialog', { name: /^Compartir «Colaboraciones»/ });
  await expect(dialog.getByText('Esto compartirá 1 material')).toBeVisible();
  await expect(dialog.getByRole('listitem').filter({ hasText: 'Dentro' })).toBeVisible();
  await expect(dialog.getByText('Privada afuera')).toHaveCount(0);
  const url = await freshInvite(dialog);

  const { page: betoPage } = await newPerson(browser, goti);
  await betoPage.goto(url);
  await betoPage.getByRole('button', { name: 'Aceptar invitación' }).click();
  await betoPage.waitForURL(/\/compartidos/);
  await expect(betoPage.getByRole('link', { name: /Dentro/ })).toBeVisible();
  await expect(betoPage.getByText('Privada afuera')).toHaveCount(0);
  await betoPage.getByRole('link', { name: /Dentro/ }).click();
  await expect(betoPage.getByLabel('Letra', { exact: true })).toHaveValue('letra de adentro');

  // Moving the document out of the folder ends the access; revoking the folder ends all of it.
  await admin(`update public.documents set node_id = null where title = 'Dentro' and owner_id = $1`, [owner]);
  await betoPage.goto('/compartidos');
  await expect(betoPage.getByRole('link', { name: /Dentro/ })).toHaveCount(0);
  await admin(`update public.documents set node_id = (select id from public.library_nodes where name = 'Colaboraciones' and owner_id = $1) where title = 'Dentro' and owner_id = $1`, [owner]);
  await betoPage.reload();
  await expect(betoPage.getByRole('link', { name: /Dentro/ })).toBeVisible();
  await dialog.getByRole('button', { name: 'Actualizar' }).click();
  await dialog.getByRole('button', { name: 'Quitar acceso' }).click();
  await betoPage.reload();
  await expect(betoPage.getByRole('link', { name: /Dentro/ })).toHaveCount(0);
});

test('si el proyecto de Supabase no tiene la migración, Compartir lo dice y no ofrece nada que no pueda funcionar', async ({ browser }) => {
  const owner = await newAccount('owner');
  const context = await browser.newContext();
  await context.addInitScript(({ id }) => {
    window.localStorage.setItem('guitarap:supabase-session', JSON.stringify({ accessToken: `test-user:${id}`, refreshToken: 'r', expiresAt: Date.now() + 86_400_000, user: { id, email: 'a@b.c' } }));
  }, { id: owner });
  await context.route('**/rest/v1/rpc/collab_capabilities', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{"code":"PGRST202","message":"not found"}' }));
  const page = await context.newPage();
  await openLibrary(page);
  await createFromMenu(page, 'Canción con letra', 'Sin backend');
  await page.getByRole('button', { name: 'Compartir', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /^Compartir «/ });
  await expect(dialog.getByText('Compartir todavía no está activado.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Crear enlace de lectura' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Crear invitación' })).toHaveCount(0);
});
