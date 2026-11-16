import { expect, test, type Page } from '@playwright/test';
import { createMaterial, neck, openLibrary, settleSave } from './helpers';

const highlight = (page: Page, name: string) => page.getByRole('group', { name: 'Resaltar' }).getByRole('button', { name, exact: true });
const markerDot = (page: Page, string: number, fret: number) => neck(page).marker(string, fret).locator('.dot');
const fillOf = (page: Page, string: number, fret: number) => markerDot(page, string, fret).evaluate((element) => getComputedStyle(element).fill);

async function cMajorTetrad(page: Page) {
  await openLibrary(page);
  await createMaterial(page, 'Mapa de escala', 'Do mayor');
  // Low E string: C(8) E(12) G(3) B(7), plus D(10) and F(1) to leave neutral degrees on the neck.
  for (const fret of [8, 12, 3, 7, 10, 1]) await neck(page).pick(5, fret);
}

test('Escenario C — notas, intervalos y ambos, con un color por función armónica', async ({ page }) => {
  await cMajorTetrad(page);

  await expect(neck(page).marker(5, 8)).toContainText('Do');
  await expect(neck(page).marker(5, 12)).toContainText('Mi');
  await expect(neck(page).marker(5, 3)).toContainText('Sol');
  await expect(neck(page).marker(5, 7)).toContainText('Si');

  await page.getByRole('button', { name: 'Intervalos', exact: true }).click();
  const expected = { 8: '1', 12: '3', 3: '5', 7: '7', 10: '2', 1: '4' } as const;
  for (const [fret, label] of Object.entries(expected)) await expect(neck(page).marker(5, Number(fret))).toContainText(label);

  await page.getByRole('button', { name: 'Ambos' }).click();
  await expect(neck(page).marker(5, 12)).toHaveAttribute('data-label', 'Mi');
  await expect(neck(page).marker(5, 12)).toHaveAttribute('data-sub', '3');
  await expect(neck(page).marker(5, 7)).toHaveAttribute('data-sub', '7');

  // Roles, and four different colors that match the legend swatches.
  for (const [fret, role] of [[8, 'root'], [12, 'third'], [3, 'fifth'], [7, 'seventh'], [10, 'other']] as const) {
    await expect(neck(page).marker(5, fret)).toHaveAttribute('data-role', role);
  }
  const fills = await Promise.all([8, 12, 3, 7].map((fret) => fillOf(page, 5, fret)));
  expect(new Set(fills).size).toBe(4);
  const swatches = await page.locator('.harmony-legend .legend-dot').evaluateAll((items) => items.map((item) => getComputedStyle(item).backgroundColor));
  expect(swatches).toEqual(fills);
  expect(await fillOf(page, 5, 10)).not.toBe(fills[0]); // neutral degrees stay neutral

  // Triad: the seventh and the neutral degrees soften, but every saved note stays.
  await highlight(page, 'Tríada').click();
  for (const fret of [8, 12, 3]) await expect(neck(page).marker(5, fret)).not.toHaveClass(/dim/);
  for (const fret of [7, 10, 1]) await expect(neck(page).marker(5, fret)).toHaveClass(/dim/);
  await expect(page.locator('[data-testid^="marker-"]:not([data-tone="ghost"])')).toHaveCount(6);

  await highlight(page, 'Séptima').click();
  await expect(neck(page).marker(5, 7)).not.toHaveClass(/dim/);
  await expect(neck(page).marker(5, 10)).toHaveClass(/dim/);

  // Reading choices persist; the notes are untouched.
  await settleSave(page);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Ambos' })).toHaveAttribute('aria-pressed', 'true');
  await expect(highlight(page, 'Séptima')).toHaveAttribute('aria-pressed', 'true');
  await expect(neck(page).marker(5, 7)).not.toHaveClass(/dim/);
  await expect(neck(page).marker(5, 10)).toHaveClass(/dim/);
  await expect(page.locator('[data-testid^="marker-"]:not([data-tone="ghost"])')).toHaveCount(6);
});

test('el color de cada función es el mismo en las vistas individual, conjunta, completa y en Práctica', async ({ page }) => {
  await cMajorTetrad(page);
  const fills = await Promise.all([8, 12, 3, 7].map((fret) => fillOf(page, 5, fret)));
  await page.getByRole('button', { name: 'Conjunta' }).click();
  const compare = await Promise.all([8, 12, 3, 7].map((fret) => page.getByTestId('compare-0').getByTestId(`marker-5-${fret}`).locator('.dot').evaluate((element) => getComputedStyle(element).fill)));
  expect(compare).toEqual(fills);
  await page.getByRole('button', { name: 'Completa' }).click();
  const all = await Promise.all([8, 12, 3, 7].map((fret) => page.getByTestId('map-all').getByTestId(`marker-5-${fret}`).locator('.dot').evaluate((element) => getComputedStyle(element).fill)));
  expect(all).toEqual(fills);
  await settleSave(page);
  await page.getByRole('link', { name: 'Practicar' }).click();
  await page.waitForURL(/\/practica\//);
  const practice = await Promise.all([8, 12, 3, 7].map((fret) => page.getByTestId('map-canvas').getByTestId(`marker-5-${fret}`).locator('.dot').evaluate((element) => getComputedStyle(element).fill)));
  expect(practice).toEqual(fills);
});

test('el modo oscuro usa la misma gramática con colores legibles', async ({ page }) => {
  await cMajorTetrad(page);
  const light = await fillOf(page, 5, 12);
  await page.getByRole('button', { name: 'Activar modo oscuro' }).click();
  await expect.poll(() => fillOf(page, 5, 12)).not.toBe(light); // colors change with the theme (after the short fade)
  await expect(neck(page).marker(5, 12)).toHaveAttribute('data-role', 'third');
});

test('Escenario D — varias notas en la sexta cuerda sobreviven a cambiar de vista y de cantidad de trastes', async ({ page }) => {
  await openLibrary(page);
  await createMaterial(page, 'Mapa de escala', 'Sexta cuerda');
  for (const fret of [0, 1, 3, 5, 7, 8]) await neck(page).pick(5, fret);
  const count = () => page.locator('[data-testid^="marker-"]:not([data-tone="ghost"])').count();
  await expect.poll(count).toBe(6);

  for (const name of ['Intervalos', 'Ambos', 'Notas']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect.poll(count).toBe(6);
  }
  await highlight(page, 'Tríada').click();
  await expect.poll(count).toBe(6);

  await page.getByRole('button', { name: 'Trastes visibles' }).click();
  await page.getByRole('group', { name: 'Cantidad de trastes' }).getByRole('button', { name: '5', exact: true }).click();
  await expect.poll(count).toBe(4); // frets 7 and 8 are outside the visible range, but still saved
  await page.getByRole('group', { name: 'Cantidad de trastes' }).getByRole('button', { name: '15', exact: true }).click();
  await expect.poll(count).toBe(6);
  await settleSave(page);
  await page.reload();
  await expect.poll(count).toBe(6);
});

test('Escenario J — los grados se distinguen sin color, con teclado, y los diálogos devuelven el foco', async ({ page }) => {
  await cMajorTetrad(page);
  await page.getByRole('button', { name: 'Intervalos', exact: true }).click();
  // Every colored point also carries its number; altered degrees get a dashed outline besides the ♭.
  for (const marker of await page.locator('[data-testid^="marker-"][data-role]').all()) {
    await expect(marker.locator('text')).not.toHaveText('');
  }
  await neck(page).pick(5, 11); // E♭ on the low string: a flat third
  await expect(neck(page).marker(5, 11)).toContainText('♭3');
  await expect(neck(page).marker(5, 11).locator('.alt')).toHaveCount(1);
  await expect(neck(page).marker(5, 12).locator('.alt')).toHaveCount(0);

  // The legend is operable and exposes its state.
  const legend = page.getByRole('list', { name: /Leyenda armónica/ });
  await legend.getByRole('button', { name: /Quinta/ }).click();
  await expect(legend.getByRole('button', { name: /Quinta/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(legend.getByRole('button', { name: /Séptima/ })).toHaveAttribute('aria-pressed', 'false');
  await expect(neck(page).marker(5, 3)).not.toHaveClass(/dim/);
  await expect(neck(page).marker(5, 8)).toHaveClass(/dim/);

  // Marking from the keyboard.
  await page.getByTestId('map-canvas').focus();
  await page.keyboard.press('ArrowRight'); // the cursor starts where the last click was: low E, fret 11 → 12
  await page.keyboard.press(' ');
  await expect(neck(page).marker(5, 12)).toHaveCount(0);
  await page.keyboard.press(' ');
  await expect(neck(page).marker(5, 12)).toBeVisible();

  // The export dialog opens, traps focus, closes with Escape and gives focus back.
  const exportButton = page.getByRole('button', { name: 'Exportar', exact: true });
  await exportButton.click();
  await expect(page.getByRole('dialog', { name: 'Exportar' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(exportButton).toBeFocused();
});
