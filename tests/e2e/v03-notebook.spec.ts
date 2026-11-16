import { expect, test, type Page } from '@playwright/test';
import { cell, createFolder, neck, openLibrary, settleSave } from './helpers';

/** Reads the stored documents straight from IndexedDB: what is really saved, not what is drawn. */
const stored = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<Array<{ title: string; type: string; content: { kind?: string; blocks?: Array<{ kind: string }> } }>>((resolve, reject) => {
        const request = indexedDB.open('guitarap');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const read = request.result.transaction('documents').objectStore('documents').getAll();
          read.onsuccess = () => {
            request.result.close();
            resolve(read.result);
          };
        };
      }),
  );
const kindsOf = async (page: Page, title: string) => {
  const doc = (await stored(page)).find((item) => item.title === title);
  if (!doc) return null;
  if (doc.content.kind === 'notebook') return doc.content.blocks!.map((block) => block.kind);
  return [doc.type === 'fretboard' ? 'map' : 'tablature'];
};
const newMenu = async (page: Page, item: string | RegExp) => {
  await page.getByRole('button', { name: 'Nuevo', exact: true }).click();
  await page.getByRole('menuitem', { name: item }).click();
  await page.waitForURL(/\/material\//);
};
const blockMenu = (page: Page, label: RegExp) => page.getByRole('button', { name: label });

test('Escenario A — Do jónico en Escalas es un cuaderno con SOLO un mapa, y sigue así al recargar', async ({ page }) => {
  await openLibrary(page);
  await createFolder(page, 'Escalas');
  await page.locator('.lib-open', { hasText: 'Escalas' }).click();
  await newMenu(page, 'Mapa de escala');
  await page.getByLabel('Título del material').fill('Do jónico');
  await expect(page.locator('.block')).toHaveCount(1);
  await expect(page.locator('.block.kind-map')).toHaveCount(1);
  await expect(page.locator('.block.kind-tablature')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Tablatura', exact: true })).toHaveCount(0);
  await neck(page).pick(5, 8);
  await settleSave(page);
  expect(await kindsOf(page, 'Do jónico')).toEqual(['map']);
  await page.reload();
  await expect(page.locator('.block')).toHaveCount(1);
  await expect(page.locator('.block.kind-tablature')).toHaveCount(0);
  await expect(neck(page).marker(5, 8)).toBeVisible();
  // Created where the person was: inside Escalas.
  await expect(page.getByRole('link', { name: /Volver a la biblioteca, Escalas/ })).toBeVisible();
});

test('un cuaderno puede empezar vacío y recibir mapa, tablatura o nota cuando se necesitan', async ({ page }) => {
  await openLibrary(page);
  await newMenu(page, 'Cuaderno vacío');
  await expect(page.locator('.block')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Empezá tu material' })).toBeVisible();
  await page.getByRole('button', { name: 'Agregar nota' }).click();
  await expect(page.locator('.block.kind-text')).toHaveCount(1);
  await page.getByRole('button', { name: 'Agregar bloque', exact: true }).first().click();
  await page.getByRole('menuitem', { name: 'Mapa del mástil' }).click();
  await expect(page.locator('.block')).toHaveCount(2);
  await page.getByRole('button', { name: 'Agregar bloque', exact: true }).first().click();
  await page.getByRole('menuitem', { name: 'Tablatura' }).click();
  await expect(page.locator('.block')).toHaveCount(3);
  await settleSave(page);
  expect(await kindsOf(page, 'Nuevo cuaderno')).toEqual(['text', 'map', 'tablature']);
});

test('Escenario B — eliminar cualquier bloque, deshacer, y dejar un cuaderno vacío que no reaparece al recargar', async ({ page }) => {
  await openLibrary(page);
  await newMenu(page, 'Escala y frase');
  await page.getByLabel('Título del material').fill('Con tablatura');
  await expect(page.locator('.block.kind-tablature')).toHaveCount(1);
  await settleSave(page);
  expect(await kindsOf(page, 'Con tablatura')).toEqual(['map', 'tablature']);

  // 1. Delete the tablature from the interface: gone from the page and from the saved document.
  await blockMenu(page, /Acciones de tablatura/).click();
  await page.getByRole('menuitem', { name: 'Eliminar bloque' }).click();
  await expect(page.locator('.block.kind-tablature')).toHaveCount(0);
  await settleSave(page);
  expect(await kindsOf(page, 'Con tablatura')).toEqual(['map']);
  await page.reload();
  await expect(page.locator('.block.kind-tablature')).toHaveCount(0);
  await expect(page.locator('.block.kind-map')).toHaveCount(1);

  // 2. An accidental deletion can be undone from the toast.
  await blockMenu(page, /Acciones de mapa/).click();
  await page.getByRole('menuitem', { name: 'Eliminar bloque' }).click();
  await expect(page.locator('.block')).toHaveCount(0);
  await page.getByRole('button', { name: 'Deshacer' }).first().click();
  await expect(page.locator('.block.kind-map')).toHaveCount(1);

  // 3. Delete everything: an empty notebook is valid, saved, and stays empty.
  await blockMenu(page, /Acciones de mapa/).click();
  await page.getByRole('menuitem', { name: 'Eliminar bloque' }).click();
  await expect(page.getByRole('heading', { name: 'Empezá tu material' })).toBeVisible();
  await settleSave(page);
  expect(await kindsOf(page, 'Con tablatura')).toEqual([]);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Empezá tu material' })).toBeVisible();
  await expect(page.locator('.block')).toHaveCount(0);
  await page.getByRole('button', { name: 'Agregar mapa' }).click();
  await expect(page.locator('.block.kind-map')).toHaveCount(1);
});

test('el primer bloque se elimina; reordenar, duplicar y plegar no tocan los datos', async ({ page }) => {
  await openLibrary(page);
  await newMenu(page, 'Escala y frase');
  await page.getByLabel('Título del material').fill('Orden');
  await cell(page, 1, 1).click();
  await page.keyboard.press('7');

  await blockMenu(page, /Acciones de mapa/).click();
  await page.getByRole('menuitem', { name: 'Bajar' }).click();
  await expect(page.locator('.block').first()).toHaveClass(/kind-tablature/);
  await blockMenu(page, /Acciones de tablatura/).click();
  await page.getByRole('menuitem', { name: 'Duplicar' }).click();
  await expect(page.locator('.block.kind-tablature')).toHaveCount(2);
  await expect(page.getByRole('textbox', { name: 'Cuerda 1, columna 1', exact: true }).first()).toHaveValue('7');

  await page.getByRole('button', { name: /Plegar mapa/ }).click();
  await expect(page.getByTestId('map-canvas')).toHaveCount(0);
  await expect(page.locator('.block.kind-map .block-summary')).toContainText('posición');
  await page.getByRole('button', { name: /Expandir mapa/ }).click();
  await expect(page.getByTestId('map-canvas')).toBeVisible();

  // Delete the first block (a tablature).
  await blockMenu(page, /Acciones de tablatura 1/).click();
  await page.getByRole('menuitem', { name: 'Eliminar bloque' }).click();
  await settleSave(page);
  expect(await kindsOf(page, 'Orden')).toEqual(['tablature', 'map']);
});
