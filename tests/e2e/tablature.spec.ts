import { expect, test, type Page } from '@playwright/test';
import { cell, createMaterial, openLibrary, settleSave } from './helpers';

const tabNeck = (page: Page) => page.getByTestId('tab-neck');

test('Test 3 — writes a solo from the neck: five consecutive events, no "next step" clicks', async ({ page }) => {
  await openLibrary(page);
  await createMaterial(page, 'Tablatura', 'Solo desde el mástil');
  await page.getByRole('button', { name: 'Mástil', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Melodía' })).toHaveAttribute('aria-pressed', 'true');

  for (const fret of [5, 7, 8, 7, 5]) await tabNeck(page).getByTestId(`fret-0-${fret}`).click();

  const expected = ['5', '7', '8', '7', '5'];
  for (const [index, value] of expected.entries()) await expect(cell(page, 1, index + 1)).toHaveValue(value);
  await expect(cell(page, 1, 6)).toHaveValue('');
  await expect(page.getByRole('button', { name: /Paso siguiente/ })).toHaveCount(0);

  // Back to the keyboard: the same sequence, nothing lost.
  await page.getByRole('button', { name: 'Teclado', exact: true }).click();
  for (const [index, value] of expected.entries()) await expect(cell(page, 1, index + 1)).toHaveValue(value);

  await settleSave(page);
  await page.reload();
  for (const [index, value] of expected.entries()) await expect(cell(page, 1, index + 1)).toHaveValue(value);
});

test('Test 4 — chords: several strings in one event, edit one string, then the next chord', async ({ page }) => {
  await openLibrary(page);
  await createMaterial(page, 'Tablatura', 'Acordes');
  await page.getByRole('button', { name: 'Mástil', exact: true }).click();
  await page.getByRole('button', { name: 'Acorde', exact: true }).click();

  // Strings are 0 = high E … 5 = low E; the tablature labels them "Cuerda 1…6".
  await tabNeck(page).getByTestId('fret-5-3').click();
  await tabNeck(page).getByTestId('fret-4-2').click();
  await tabNeck(page).getByTestId('fret-3-0').click();
  await expect(cell(page, 6, 1)).toHaveValue('3');
  await expect(cell(page, 5, 1)).toHaveValue('2');
  await expect(cell(page, 4, 1)).toHaveValue('0');

  // Editing one string replaces only that string.
  await tabNeck(page).getByTestId('fret-4-5').click();
  await expect(cell(page, 5, 1)).toHaveValue('5');
  await expect(cell(page, 6, 1)).toHaveValue('3');
  await expect(cell(page, 4, 1)).toHaveValue('0');
  await expect(cell(page, 6, 2)).toHaveValue('');

  await page.getByRole('button', { name: /Siguiente evento/ }).click();
  await tabNeck(page).getByTestId('fret-5-5').click();
  await tabNeck(page).getByTestId('fret-4-7').click();
  await expect(cell(page, 6, 2)).toHaveValue('5');
  await expect(cell(page, 5, 2)).toHaveValue('7');
  await expect(cell(page, 6, 1)).toHaveValue('3');
});

test('Test 5 — combined: neck and tablature stay in sync without scroll jumps', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openLibrary(page);
  await createMaterial(page, 'Tablatura', 'Combinada');
  await page.getByRole('button', { name: 'Mástil', exact: true }).click();
  for (const fret of [5, 7, 8]) await tabNeck(page).getByTestId(`fret-0-${fret}`).click();
  const before = await page.evaluate(() => window.scrollY);

  await cell(page, 1, 2).click();
  await expect(tabNeck(page).getByTestId('marker-0-7')).toHaveAttribute('data-tone', 'active');
  await expect(tabNeck(page).getByTestId('marker-0-5')).toHaveCount(0);
  await cell(page, 1, 3).click();
  await expect(tabNeck(page).getByTestId('marker-0-8')).toHaveAttribute('data-tone', 'active');
  expect(await page.evaluate(() => window.scrollY)).toBe(before);

  // The neck is docked inside the viewport while the music stays visible.
  const neckBox = await tabNeck(page).boundingBox();
  const sheetBox = await page.getByRole('group', { name: 'Tablatura', exact: true }).boundingBox();
  expect(neckBox!.y + neckBox!.height).toBeLessThanOrEqual(769);
  expect(sheetBox!.y).toBeGreaterThanOrEqual(0);
});

test('two digit frets are one event and 25 is rejected without touching another cell', async ({ page }) => {
  await openLibrary(page);
  await createMaterial(page, 'Tablatura', 'Dígitos');
  await cell(page, 1, 1).click();
  await page.keyboard.press('1');
  await page.keyboard.press('2');
  await expect(cell(page, 1, 1)).toHaveValue('12');
  await expect(cell(page, 1, 2)).toHaveValue('');

  await page.keyboard.press('3');
  await expect(cell(page, 1, 2)).toHaveValue('3');
  await page.keyboard.press('2');
  await page.keyboard.press('5');
  await expect(cell(page, 1, 3)).toHaveValue('2');
  await expect(cell(page, 1, 4)).toHaveValue('');
  await page.keyboard.press('Enter');
  await page.keyboard.press('2');
  await page.keyboard.press('4');
  await expect(cell(page, 1, 4)).toHaveValue('24');
  await expect(cell(page, 1, 3)).toHaveValue('2');
});

test('delete clears one note and never a column; undo, redo, copy and paste work', async ({ page }) => {
  await openLibrary(page);
  await createMaterial(page, 'Tablatura', 'Edición');
  await cell(page, 1, 1).click();
  for (const key of ['5', '7', '8']) await page.keyboard.press(key);
  await cell(page, 1, 2).click();
  await page.keyboard.press('Backspace');
  await expect(cell(page, 1, 2)).toHaveValue('');
  await expect(cell(page, 1, 1)).toHaveValue('5');
  await expect(cell(page, 1, 3)).toHaveValue('8');

  await page.getByRole('button', { name: 'Deshacer' }).click();
  await expect(cell(page, 1, 2)).toHaveValue('7');
  await page.getByRole('button', { name: 'Rehacer' }).click();
  await expect(cell(page, 1, 2)).toHaveValue('');

  await cell(page, 1, 1).click();
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await expect(cell(page, 1, 4)).toHaveValue('5');
  await expect(cell(page, 1, 6)).toHaveValue('8');
});

test('links techniques to the next note on the string and keeps them structured', async ({ page }) => {
  await openLibrary(page);
  await createMaterial(page, 'Tablatura', 'Técnicas');
  await cell(page, 1, 1).click();
  for (const key of ['5', '7', '5']) await page.keyboard.press(key);

  await cell(page, 1, 1).click();
  await page.keyboard.press('h');
  await expect(page.locator('.tb-link').first()).toHaveText('h');
  await cell(page, 1, 2).click();
  await page.keyboard.press('h'); // 7 → 5 reads as a pull-off
  await expect(page.locator('.tb-link').nth(1)).toHaveText('p');
  await cell(page, 1, 1).click();
  await page.keyboard.press('/');
  await expect(page.locator('.tb-link')).toHaveCount(3);

  await cell(page, 1, 3).click();
  await page.keyboard.press('b');
  await expect(page.locator('.tb-mark').first()).toContainText('↑½');
  await page.keyboard.press('~');
  await expect(page.locator('.tb-mark').first()).toContainText('~');

  // Deleting a linked note removes its links: nothing is left dangling.
  await cell(page, 1, 2).click();
  await page.keyboard.press('Delete');
  await expect(page.locator('.tb-link')).toHaveCount(0);
});

test('keyboard writing advances automatically and grows the tablature', async ({ page }) => {
  await openLibrary(page);
  await createMaterial(page, 'Tablatura', 'Frase larga');
  await cell(page, 1, 1).click();
  for (const key of '5787537535'.split('')) await page.keyboard.press(key);
  await expect(cell(page, 1, 10)).toHaveValue('5');
  for (const key of '5787537535'.split('')) await page.keyboard.press(key);
  await expect(cell(page, 1, 20)).toHaveValue('5');
});
