import { expect, test } from '@playwright/test';
import { cell, createMaterial, neck, openLibrary, settleSave } from './helpers';

test('Test 1 — marks six notes on one string, keeps them when marking others, and persists', async ({ page }) => {
  await openLibrary(page);
  await createMaterial(page, 'Mapa de escala', 'Do mayor');
  const board = neck(page);

  for (const fret of [0, 1, 3, 5, 7, 8]) await board.pick(5, fret);
  for (const fret of [0, 1, 3, 5, 7, 8]) await expect(board.marker(5, fret)).toBeVisible();

  for (const [string, fret] of [[4, 3], [4, 5], [3, 2], [3, 3], [2, 5]]) await board.pick(string, fret);
  for (const fret of [0, 1, 3, 5, 7, 8]) await expect(board.marker(5, fret)).toBeVisible();
  await expect(board.marker(4, 3)).toBeVisible();
  await expect(board.marker(2, 5)).toBeVisible();
  await expect(page.locator('[data-testid^="marker-"]:not([data-tone="ghost"])')).toHaveCount(11);

  await settleSave(page);
  await page.reload();
  await expect(page.locator('[data-testid^="marker-"]:not([data-tone="ghost"])')).toHaveCount(11);

  // Removing one point leaves the rest untouched.
  await board.pick(5, 3);
  await expect(board.marker(5, 3)).toHaveCount(0);
  for (const fret of [0, 1, 5, 7, 8]) await expect(board.marker(5, fret)).toBeVisible();
  await expect(page.locator('[data-testid^="marker-"]:not([data-tone="ghost"])')).toHaveCount(10);
});

test('latin note names are right, including Do, and the tonic is distinguished beyond color', async ({ page }) => {
  await openLibrary(page);
  await createMaterial(page, 'Mapa de escala', 'Nombres');
  const board = neck(page);
  await board.pick(5, 8); // C on the low E string
  await expect(board.marker(5, 8)).toContainText('Do');
  await expect(board.marker(5, 8)).toHaveAttribute('data-tone', 'root');
  await board.pick(5, 3);
  await expect(board.marker(5, 3)).toContainText('Sol');
  await expect(board.marker(5, 3)).toHaveAttribute('data-tone', 'note');
  await page.getByRole('button', { name: 'Intervalos' }).click();
  await expect(board.marker(5, 8)).toContainText('1');
  await expect(board.marker(5, 3)).toContainText('5');
});

test('Test 2 — one study material holds a scale map, a phrase and a note, and reopens intact', async ({ page }) => {
  await openLibrary(page);
  await createMaterial(page, 'Material de estudio', 'Pentatónica menor de La');
  await expect(page.getByRole('heading', { name: 'Este material está vacío' })).toBeVisible();

  await page.getByRole('button', { name: 'Mapa del mástil' }).click();
  const board = neck(page);
  for (const fret of [5, 8, 10, 12]) await board.pick(5, fret);

  await page.getByRole('button', { name: 'Agregar bloque', exact: true }).first().click();
  await page.getByRole('menuitem', { name: 'Tablatura' }).click();
  await cell(page, 1, 1).click();
  for (const key of ['5', '8', '5', '1', '2']) await page.keyboard.press(key);

  await page.getByRole('button', { name: 'Agregar bloque', exact: true }).first().click();
  await page.getByRole('menuitem', { name: 'Nota de estudio' }).click();
  await page.getByLabel('Nota de estudio').fill('Alternate picking a 60 BPM');
  await settleSave(page);

  // Same material, same URL: no extra document was created for the scale.
  const url = page.url();
  await page.goto('/biblioteca');
  await expect(page.getByRole('button', { name: /Pentatónica menor de La/ }).first()).toBeVisible();
  await expect(page.locator('.lib-row')).toHaveCount(1);
  await page.goto(url);
  for (const fret of [5, 8, 10, 12]) await expect(board.marker(5, fret)).toBeVisible();
  await expect(cell(page, 1, 1)).toHaveValue('5');
  await expect(cell(page, 1, 4)).toHaveValue('12');
  await expect(page.getByLabel('Nota de estudio')).toHaveValue('Alternate picking a 60 BPM');
});

test('several positions of one scale live in one document and can be compared', async ({ page }) => {
  await openLibrary(page);
  await createMaterial(page, 'Mapa de escala', 'Re mayor');
  const board = neck(page);
  await board.pick(5, 10);
  await board.pick(5, 12);
  await page.getByRole('button', { name: 'Agregar posición' }).click();
  await expect(page.getByRole('tab', { name: 'Posición 2' })).toHaveAttribute('aria-selected', 'true');
  await board.pick(4, 5);
  await board.pick(4, 7);

  await page.getByRole('button', { name: 'Conjunta' }).click();
  await expect(page.getByTestId('map-compare').getByRole('region')).toHaveCount(2);
  await expect(page.getByTestId('compare-0').getByTestId('marker-5-10')).toBeVisible();
  await expect(page.getByTestId('compare-1').getByTestId('marker-4-5')).toBeVisible();
  await expect(page.getByTestId('compare-1').getByTestId('marker-5-10')).toHaveCount(0);

  await page.getByRole('button', { name: 'Completa' }).click();
  for (const [string, fret] of [[5, 10], [5, 12], [4, 5], [4, 7]]) {
    await expect(page.getByTestId('map-all').getByTestId(`marker-${string}-${fret}`)).toBeVisible();
  }

  // Removing a point from one position never removes it from another.
  await page.getByRole('button', { name: 'Individual' }).click();
  await page.getByRole('tab', { name: 'Posición 1' }).click();
  await board.pick(5, 10);
  await page.getByRole('tab', { name: 'Posición 2' }).click();
  await expect(board.marker(4, 5)).toBeVisible();
});

test('a scale can be proposed without wiping manual marks', async ({ page }) => {
  await openLibrary(page);
  await createMaterial(page, 'Mapa de escala', 'Pentatónica');
  const board = neck(page);
  await board.pick(0, 2); // F♯ on the first string: not part of C minor pentatonic
  await page.getByRole('button', { name: 'Generar escala' }).click();
  await page.getByLabel('Tipo de escala').selectOption('Pentatónica menor');
  await page.getByRole('button', { name: 'Agregar a la posición' }).click();
  await expect(board.marker(0, 2)).toBeVisible();
  await expect(board.marker(5, 8)).toBeVisible();
});

test('the neck can be marked from the keyboard', async ({ page }) => {
  await openLibrary(page);
  await createMaterial(page, 'Mapa de escala', 'Teclado');
  await page.getByTestId('map-canvas').focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press(' ');
  await expect(neck(page).marker(1, 1)).toBeVisible();
  await page.keyboard.press(' ');
  await expect(neck(page).marker(1, 1)).toHaveCount(0);
});
