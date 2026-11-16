import { expect, test } from '@playwright/test';
import { createFolder, neck, openLibrary, settleSave } from './helpers';

const row = (page: import('@playwright/test').Page, text: string) => page.locator('.lib-row', { hasText: text });

test('Escenario G — Escalas / Modos / Do jónico: navegar, renombrar, recargar y mover sin romper la jerarquía', async ({ page }) => {
  await openLibrary(page);
  await createFolder(page, 'Escalas');
  await row(page, 'Escalas').locator('.lib-open').click();
  await createFolder(page, 'Modos');
  await row(page, 'Modos').locator('.lib-open').click();

  // New material lands in the open folder, and the path is always visible.
  await page.getByRole('button', { name: 'Nuevo', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Mapa de escala' }).click();
  await page.waitForURL(/\/material\//);
  await page.getByLabel('Título del material').fill('Do jónico');
  await neck(page).pick(5, 8);
  await settleSave(page);
  await expect(page.getByRole('link', { name: /Volver a la biblioteca, Escalas \/ Modos/ })).toBeVisible();
  await page.getByRole('link', { name: /Volver a la biblioteca/ }).click();
  const crumbs = page.getByRole('navigation', { name: 'Ubicación' });
  await expect(crumbs).toContainText('Biblioteca');
  await expect(crumbs).toContainText('Escalas');
  await expect(crumbs).toContainText('Modos');
  await expect(row(page, 'Do jónico')).toBeVisible();

  // Go up one level through the breadcrumb, rename the folder, and the location survives a reload.
  await crumbs.getByRole('button', { name: 'Escalas' }).click();
  await row(page, 'Modos').getByRole('button', { name: /Opciones de Modos/ }).click();
  await page.getByRole('menuitem', { name: 'Renombrar' }).click();
  await page.getByRole('dialog').getByLabel('Nombre').fill('Modos griegos');
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
  await expect(row(page, 'Modos griegos')).toBeVisible();
  await row(page, 'Modos griegos').locator('.lib-open').click();
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Ubicación' })).toContainText('Modos griegos');
  await expect(row(page, 'Do jónico')).toBeVisible();

  // A folder can be moved, but never into itself or one of its own subfolders.
  await page.getByRole('navigation', { name: 'Ubicación' }).getByRole('button', { name: 'Escalas' }).click();
  await row(page, 'Modos griegos').getByRole('button', { name: /Opciones de Modos griegos/ }).click();
  await page.getByRole('menuitem', { name: 'Mover a…' }).click();
  const options = await page.getByRole('dialog').getByLabel('Carpeta de destino').locator('option').allInnerTexts();
  expect(options).not.toContain('Escalas / Modos griegos');
  expect(options).toContain('Escalas');
  await page.getByRole('dialog').getByLabel('Carpeta de destino').selectOption('');
  await page.getByRole('dialog').getByRole('button', { name: 'Mover aquí' }).click();
  await expect(row(page, 'Modos griegos')).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Ubicación' }).getByRole('button', { name: 'Biblioteca' }).click();
  await expect(row(page, 'Modos griegos')).toBeVisible();
  await row(page, 'Escalas').getByRole('button', { name: /Opciones de Escalas/ }).click();
  await page.getByRole('menuitem', { name: 'Mover a…' }).click();
  const forEscalas = await page.getByRole('dialog').getByLabel('Carpeta de destino').locator('option').allInnerTexts();
  expect(forEscalas).not.toContain('Escalas');
});

test('la biblioteca ofrece plantillas compactas y crea cada una con lo que promete', async ({ page }) => {
  await openLibrary(page);
  await page.getByRole('button', { name: 'Nuevo', exact: true }).click();
  const names = await page.getByRole('menuitem').allInnerTexts();
  expect(names.join('|')).toMatch(/Mapa de escala.*Acorde o tríada.*Riff o tablatura.*Cuaderno vacío.*Escala y frase.*Canción.*Carpeta/s);
  await page.getByRole('menuitem', { name: 'Acorde o tríada' }).click();
  await page.waitForURL(/\/material\//);
  await expect(page.locator('.block.kind-map')).toHaveCount(1);
  await expect(page.locator('.block.kind-tablature')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Tríada', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Ambos' })).toHaveAttribute('aria-pressed', 'true');
});
