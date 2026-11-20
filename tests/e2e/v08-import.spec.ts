import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { createMaterial, openLibrary, settleSave, storedDocuments } from './helpers';

/**
 * v0.8 phase 1.4 — importing a backup through the screen: read it, see what would happen, confirm, see the result, and
 * be able to undo it. Nothing is ever replaced. Everything here is made-up data in a throwaway browser profile.
 */
test.setTimeout(120_000);

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Importar copia de seguridad' });
const choose = (page: Page, name: string, raw: string) => page.getByLabel('Archivo de copia de seguridad').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(raw) });
async function exportCopy(page: Page) {
  await page.goto('/configuracion/copias');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar copia de seguridad' }).click();
  return readFile((await (await download).path())!, 'utf8');
}
const titles = async (page: Page) => (await storedDocuments(page)).map((doc) => doc.title).sort();

test('el mismo archivo dos veces: la segunda no hay nada para importar, y la primera no cambia lo que ya está', async ({ page }) => {
  await openLibrary(page);
  await createMaterial(page, 'Tablatura', 'Riff de prueba');
  await settleSave(page);
  const raw = await exportCopy(page);
  await choose(page, 'copia.json', raw);
  await expect(dialog(page)).toContainText('copia.json');
  await expect(dialog(page)).toContainText('Todavía no se escribió nada');
  await expect(dialog(page)).toContainText(/Ya existe y es idéntico/);
  await expect(dialog(page).getByText(/No hay nada para importar/)).toBeVisible();
  await expect(dialog(page).getByRole('button', { name: 'Importar', exact: true })).toBeDisabled();
  await dialog(page).getByRole('button', { name: 'Cancelar' }).click();
  expect(await titles(page)).toEqual(['Riff de prueba']);
});

test('un material que cambió desde la copia entra como copia identificada: lo actual no se toca, y se puede deshacer', async ({ page }) => {
  await openLibrary(page);
  await createMaterial(page, 'Tablatura', 'Riff de prueba');
  await settleSave(page);
  const old = await exportCopy(page);
  await page.goto('/biblioteca');
  await page.locator('.lib-open', { hasText: 'Riff de prueba' }).click();
  await page.getByLabel('Título del material').fill('Riff de prueba (editado)');
  await settleSave(page);
  await page.goto('/configuracion/copias');

  await choose(page, 'vieja.json', old);
  await expect(dialog(page)).toContainText(/Ya existe pero es distinto/);
  await expect(dialog(page)).toContainText('entra como una copia identificada');
  await dialog(page).getByLabel(/Descargar antes una copia/).uncheck();
  expect(await titles(page)).toEqual(['Riff de prueba (editado)']); // the simulation wrote nothing
  await dialog(page).getByRole('button', { name: 'Importar', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Resultado de la importación' })).toContainText('La copia se importó');
  const after = await titles(page);
  expect(after).toHaveLength(2);
  expect(after).toContain('Riff de prueba (editado)'); // the current one is exactly as it was
  expect(after.some((title) => /^Riff de prueba \(copia importada/.test(title))).toBe(true);

  // Undo: what the import added goes to the trash; nothing is deleted and the original is untouched.
  await page.getByRole('button', { name: 'Deshacer esta importación' }).click();
  await expect(page.getByText(/Se deshizo la importación/)).toBeVisible();
  const trashed = (await storedDocuments(page)).filter((doc) => doc.deletedAt);
  expect(trashed.map((doc) => doc.title.startsWith('Riff de prueba (copia importada'))).toEqual([true]);
  expect((await storedDocuments(page)).filter((doc) => !doc.deletedAt).map((doc) => doc.title)).toEqual(['Riff de prueba (editado)']);
});

test('una copia de otra cuenta pide confirmación expresa y entra como copias propias, sin nada que apunte a la original', async ({ page }) => {
  await openLibrary(page);
  const foreign = JSON.stringify({
    schema: 1,
    exportedAt: '2026-11-20T10:00:00.000Z',
    nodes: [{ id: 'carpeta-ajena', parentId: null, kind: 'folder', name: 'Escalas de otra persona', order: 1, createdAt: 1, updatedAt: 1, rev: 1, ownerId: 'cuenta-ajena' }],
    documents: [{ id: 'material-ajeno', nodeId: 'carpeta-ajena', songId: null, type: 'tablature', title: 'Material de otra persona', content: { kind: 'notebook', version: 1, blocks: [] }, rev: 1, createdAt: 1, updatedAt: 1, ownerId: 'cuenta-ajena' }],
    versions: [{ id: 'version-ajena', documentId: 'material-ajeno', createdAt: 2, reason: 'manual', title: 'v', content: { kind: 'notebook', version: 1, blocks: [] }, ownerId: 'cuenta-ajena' }],
  });
  await page.goto('/configuracion/copias');
  await choose(page, 'de-otra-cuenta.json', foreign);
  await expect(dialog(page)).toContainText('Esta copia pertenece a otra cuenta');
  const confirm = dialog(page).getByRole('button', { name: 'Importar', exact: true });
  await expect(confirm).toBeDisabled(); // not without saying so
  await dialog(page).getByLabel(/Entiendo: se importa como copias propias/).check();
  await dialog(page).getByLabel(/Descargar antes una copia/).uncheck();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByRole('status', { name: 'Resultado de la importación' })).toBeVisible();
  const stored = JSON.stringify(await storedDocuments(page));
  expect(stored).toContain('Material de otra persona');
  expect(stored).not.toContain('cuenta-ajena'); // nothing points back to the original owner
  expect(stored).not.toContain('material-ajeno'); // nor keeps its identifiers
  // The folder came along and the material is inside it.
  await page.goto('/biblioteca');
  await expect(page.locator('.lib-open', { hasText: 'Escalas de otra persona' })).toBeVisible();
});

test('los archivos inservibles se explican y no tocan nada: vacío, no JSON, de una versión más nueva y registros inválidos', async ({ page }) => {
  await openLibrary(page);
  await createMaterial(page, 'Tablatura', 'Riff de prueba');
  await settleSave(page);
  await page.goto('/configuracion/copias');
  const cases: Array<[string, string, RegExp]> = [
    ['vacio.json', '', /vacío/],
    ['basura.json', '{ no es json', /JSON válido/],
    ['nueva.json', JSON.stringify({ schema: 99, nodes: [], documents: [], versions: [] }), /versión más nueva/],
    ['lista.json', '[1,2]', /no parece una copia/],
  ];
  for (const [name, raw, expected] of cases) {
    await choose(page, name, raw);
    await expect(page.getByRole('alert')).toContainText(expected);
  }
  // Valid but with records that are not: the good ones are offered, the bad ones are counted and explained.
  const mixed = JSON.stringify({
    schema: 2,
    nodes: [],
    documents: [
      { id: 'ok-1', nodeId: null, songId: null, type: 'tablature', title: 'Material bueno', content: { kind: 'notebook', version: 1, blocks: [] }, rev: 1, createdAt: 1, updatedAt: 1 },
      { id: 'ok-1', nodeId: null, songId: null, type: 'tablature', title: 'Repetido', content: { kind: 'notebook', version: 1, blocks: [] } },
      { id: 'mal', type: 'desconocido', title: 'x', content: {} },
    ],
    versions: [],
    preferences: { 'appearance.skin': 'vinilo' },
  });
  await choose(page, 'mixta.json', mixed);
  await expect(dialog(page)).toContainText('Registros inválidos (se omiten)');
  await expect(dialog(page)).toContainText('preferences'); // schema 2 extras are named and not imported
  await dialog(page).getByText('Ver por qué se omiten').click();
  await expect(dialog(page)).toContainText('identificador repetido');
  await dialog(page).getByLabel(/Descargar antes una copia/).uncheck();
  await dialog(page).getByRole('button', { name: 'Importar', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Resultado de la importación' })).toBeVisible();
  expect(await titles(page)).toEqual(['Material bueno', 'Riff de prueba']);
});
