import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { cell, createMaterial, neck, openLibrary, settleSave } from './helpers';

test('Test 9 — a backup holds the notebook structure and restores into an isolated, empty browser', async ({ page, browser }, testInfo) => {
  await openLibrary(page);
  await createMaterial(page, 'Material de estudio', 'Para respaldar');
  await page.getByRole('button', { name: 'Agregar mapa' }).click();
  await neck(page).pick(5, 3);
  await neck(page).pick(5, 5);
  await page.getByRole('button', { name: 'Agregar bloque', exact: true }).first().click();
  await page.getByRole('menuitem', { name: 'Tablatura' }).click();
  await cell(page, 1, 1).click();
  await page.keyboard.press('7');
  await settleSave(page);

  await page.goto('/configuracion/copias');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar copia de seguridad' }).click();
  const file = await (await download).path();
  const raw = await readFile(file!, 'utf8');
  const backup = JSON.parse(raw) as {
    schema: number;
    documents: Array<{ title: string; content: { kind?: string; blocks?: Array<{ kind: string }> } }>;
    versions: unknown[];
  };
  expect(backup.schema).toBe(1);
  expect(backup.documents).toHaveLength(1);
  expect(backup.documents[0].content.kind).toBe('notebook');
  expect(backup.documents[0].content.blocks?.map((block) => block.kind)).toEqual(['map', 'tablature']);
  expect(backup.versions.length).toBeGreaterThanOrEqual(1);
  await expect(page.getByRole('status').filter({ hasText: 'Se descargó una copia' })).toBeVisible();

  // An empty, isolated browser context stands in for a clean database.
  const isolated = await browser.newContext();
  const other = await isolated.newPage();
  await other.goto('/configuracion/copias');
  await other.getByLabel('Archivo de copia de seguridad').setInputFiles(file!);
  await expect(other.getByRole('dialog', { name: 'Importar copia de seguridad' })).toContainText('1 documento');
  await other.getByRole('button', { name: 'Combinar', exact: true }).click();
  await expect(other.getByText('La copia se combinó con tu biblioteca.')).toBeVisible();
  await other.goto('/biblioteca');
  await other.locator('.lib-open', { hasText: 'Para respaldar' }).click();
  await expect(neck(other).marker(5, 3)).toBeVisible();
  await expect(neck(other).marker(5, 5)).toBeVisible();
  await expect(cell(other, 1, 1)).toHaveValue('7');
  await other.screenshot({ path: testInfo.outputPath('restaurado.png') });
  await isolated.close();
});

test('replacing a library needs an explicit confirmation and a broken file never touches the data', async ({ page }) => {
  await openLibrary(page);
  await createMaterial(page, 'Tablatura', 'No me borres');
  await settleSave(page);
  await page.goto('/configuracion/copias');

  await page.getByLabel('Archivo de copia de seguridad').setInputFiles({
    name: 'roto.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"schema":2}'),
  });
  await expect(page.getByRole('alert')).toBeVisible();

  const valid = JSON.stringify({ schema: 1, nodes: [], documents: [], versions: [] });
  await page.getByLabel('Archivo de copia de seguridad').setInputFiles({ name: 'vacio.json', mimeType: 'application/json', buffer: Buffer.from(valid) });
  const dialog = page.getByRole('dialog', { name: 'Importar copia de seguridad' });
  await dialog.getByLabel(/Reemplazar toda la biblioteca/).check();
  await expect(dialog.getByRole('button', { name: 'Reemplazar', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancelar' }).click();

  await page.goto('/biblioteca');
  await expect(page.locator('.lib-open', { hasText: 'No me borres' })).toBeVisible();
});

test('history restores an earlier state and keeps the one it replaced', async ({ page }) => {
  await openLibrary(page);
  await createMaterial(page, 'Tablatura', 'Con historial');
  await cell(page, 1, 1).click();
  await page.keyboard.press('3');
  await settleSave(page);
  await page.getByRole('button', { name: 'Más acciones del material' }).click();
  await page.getByRole('menuitem', { name: 'Historial de versiones…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Historial de versiones' });
  await expect(dialog.getByRole('button', { name: 'Restaurar' }).first()).toBeVisible();
  await dialog.getByRole('button', { name: 'Restaurar' }).last().click();
  await expect(cell(page, 1, 1)).toHaveValue('');
  await page.getByRole('button', { name: 'Más acciones del material' }).click();
  await page.getByRole('menuitem', { name: 'Historial de versiones…' }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Restaurar' })).not.toHaveCount(0);
  await expect.poll(() => page.getByRole('dialog').getByRole('button', { name: 'Restaurar' }).count()).toBeGreaterThanOrEqual(2);
});
