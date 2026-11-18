import { expect, test, type Page } from '@playwright/test';
import { audioLog, audioProbe, cell, createFromMenu, createMaterial, neck, openLibrary, settleSave, storedDocuments, silentWriting } from './helpers';

const panel = (page: Page) => page.getByRole('complementary', { name: 'Herramientas musicales' });
const openTools = async (page: Page) => {
  await page.getByRole('button', { name: 'Armonía', exact: true }).click();
  await expect(panel(page)).toBeVisible();
};
const closeTools = async (page: Page) => {
  await panel(page).getByRole('button', { name: 'Cerrar herramientas musicales' }).click();
  await expect(panel(page)).toHaveCount(0);
};
const chordTable = async (page: Page) => {
  const rows = panel(page).locator('table.tool-table').first().locator('tbody tr');
  return rows.evaluateAll((items) => items.map((row) => [row.querySelector('th')!.textContent, row.querySelector('td button')!.textContent]));
};
const snapshot = async (page: Page) => JSON.stringify((await storedDocuments(page)).map((doc) => ({ id: doc.id, title: doc.title, content: doc.content })));

test('Test A — el círculo de quintas: Do mayor, Sol mayor y La menor, con escala, acordes y relaciones correctas; explorar no toca la canción', async ({ page }) => {
  await openLibrary(page);
  await createFromMenu(page, 'Canción con letra', 'Explorando');
  await page.getByLabel('Letra', { exact: true }).fill('# Verso 1\nHoy vuelvo a casa');
  await settleSave(page);
  const before = await snapshot(page);

  await openTools(page);
  await expect(panel(page).getByRole('heading', { name: 'Do mayor' })).toBeVisible();
  await expect(panel(page).getByLabel('Notas de la escala')).toHaveText('DoReMiFaSolLaSi');
  expect(await chordTable(page)).toEqual([['I', 'C'], ['ii', 'Dm'], ['iii', 'Em'], ['IV', 'F'], ['V', 'G'], ['vi', 'Am'], ['vii°', 'Bdim']]);
  await expect(panel(page).getByText('Sin alteraciones.')).toBeVisible();

  await panel(page).locator('svg.cof').getByRole('button', { name: /^Sol mayor/ }).click();
  await expect(panel(page).getByRole('heading', { name: 'Sol mayor' })).toBeVisible();
  await expect(panel(page).getByLabel('Notas de la escala')).toHaveText('SolLaSiDoReMiFa♯');
  expect(await chordTable(page)).toEqual([['I', 'G'], ['ii', 'Am'], ['iii', 'Bm'], ['IV', 'C'], ['V', 'D'], ['vi', 'Em'], ['vii°', 'F♯dim']]);
  await expect(panel(page).getByText(/1 sostenido: Fa♯/)).toBeVisible();

  await panel(page).locator('svg.cof').getByRole('button', { name: /^La menor/ }).click();
  await expect(panel(page).getByRole('heading', { name: 'La menor' })).toBeVisible();
  expect(await chordTable(page)).toEqual([['i', 'Am'], ['ii°', 'Bdim'], ['III', 'C'], ['iv', 'Dm'], ['v', 'Em'], ['VI', 'F'], ['VII', 'G']]);
  // Its relative is Do mayor, one click away.
  await panel(page).locator('p .btn-link', { hasText: 'Do mayor' }).click();
  await expect(panel(page).getByRole('heading', { name: 'Do mayor' })).toBeVisible();

  await closeTools(page);
  await page.waitForTimeout(1200);
  expect(await snapshot(page)).toBe(before);
});

test('Test B — modulación de Do mayor a Sol mayor: notas y acordes comunes, caminos posibles y audio, sin modificar la canción', async ({ page }) => {
  await audioProbe(page);
  await silentWriting(page);
  await openLibrary(page);
  await createFromMenu(page, 'Cuaderno de composición', 'Modulando');
  await page.getByRole('button', { name: 'Agregar melodía' }).click();
  await page.getByLabel('Escribir notas').fill('Do4 Re4 Mi4');
  await page.getByLabel('Escribir notas').press('Enter');
  await settleSave(page);
  const before = await snapshot(page);

  await openTools(page);
  await panel(page).getByRole('button', { name: 'Modulación' }).click();
  await panel(page).getByLabel('Destino').selectOption('G:major');
  await expect(panel(page).getByText('6 de 7')).toBeVisible();
  await expect(panel(page).getByText('Fa → Fa♯')).toBeVisible();
  await expect(panel(page).locator('.mod-facts')).toContainText('Am');
  await expect(panel(page).locator('.paths li')).not.toHaveCount(0);
  await expect(panel(page).getByText('Hay muchas formas de modular')).toBeVisible();

  expect(await audioLog(page)).toHaveLength(0);
  await panel(page).locator('.paths li').first().getByRole('button', { name: 'Escuchar' }).click();
  await expect.poll(async () => (await audioLog(page)).filter((entry) => entry.type === 'note').length, { timeout: 15000 }).toBeGreaterThan(8);
  await panel(page).getByRole('button', { name: 'Cerrar herramientas musicales' }).click();
  // Closing the panel silences what it started.
  await expect.poll(async () => (await page.evaluate(() => (window as unknown as { __guitarapAudio: { state: string } }).__guitarapAudio.state))).toBe('idle');
  await page.waitForTimeout(1200);
  expect(await snapshot(page)).toBe(before);
});

test('Test C — progresión C G Am F: se guarda, se transpone a propósito, se deshace y vuelve idéntica', async ({ page }) => {
  await openLibrary(page);
  await createFromMenu(page, 'Progresión de acordes', 'Progresión');
  await page.getByLabel('Escribir acordes').fill('C - G - Am - F');
  await page.getByLabel('Escribir acordes').press('Enter');
  const chips = page.getByRole('list', { name: 'Acordes de la progresión' }).locator('.chord-btn b');
  await expect(chips).toHaveText(['C', 'G', 'Am', 'F']);
  await settleSave(page);
  await page.reload();
  await expect(chips).toHaveText(['C', 'G', 'Am', 'F']);
  const stored = async () => {
    const doc = (await storedDocuments(page)).find((item) => item.content?.kind === 'notebook')!;
    return (doc.content.blocks[0].content as { items: Array<{ id: string; symbol: string }> }).items;
  };
  const original = await stored();

  await page.getByRole('button', { name: 'Transponer la progresión' }).click();
  await page.getByLabel('Semitonos a transponer').selectOption('2');
  await page.getByRole('button', { name: 'Transponer', exact: true }).click();
  await expect(chips).toHaveText(['D', 'A', 'Bm', 'G']);
  await settleSave(page);
  expect((await stored()).map((item) => item.symbol)).toEqual(['D', 'A', 'Bm', 'G']);

  await page.getByRole('button', { name: 'Deshacer', exact: true }).click();
  await expect(chips).toHaveText(['C', 'G', 'Am', 'F']);
  await settleSave(page);
  expect(await stored()).toEqual(original); // same ids, same symbols, same lengths

  // Notes are not chords: a pitch written C4 is refused here, with a reason.
  await page.getByLabel('Escribir acordes').fill('C4');
  await page.getByLabel('Escribir acordes').press('Enter');
  await expect(page.getByRole('alert')).toContainText('nota con octava');
  await expect(chips).toHaveText(['C', 'G', 'Am', 'F']);
});

test('la tonalidad del cuaderno da grados a los acordes y no transpone nada al cambiarla', async ({ page }) => {
  await openLibrary(page);
  await createFromMenu(page, 'Progresión de acordes', 'Grados');
  await page.getByLabel('Escribir acordes').fill('C G Am F E7');
  await page.getByLabel('Escribir acordes').press('Enter');
  await page.getByRole('button', { name: 'Tonalidad del cuaderno', exact: true }).click();
  await page.getByLabel('Tonalidad principal').selectOption('C:major');
  await page.keyboard.press('Escape');
  const chip = (name: string) => page.getByRole('button', { name: new RegExp(`^Acorde ${name},`) });
  await expect(chip('G')).toHaveAccessibleName(/grado V/);
  await expect(chip('Am')).toHaveAccessibleName(/grado vi/);
  await expect(chip('E7')).toHaveAccessibleName(/fuera de la tonalidad/);
  // Changing the key leaves the chords untouched (context is not transposition).
  await page.getByRole('button', { name: 'Tonalidad del cuaderno', exact: true }).click();
  await page.getByLabel('Tonalidad principal').selectOption('G:major');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('list', { name: 'Acordes de la progresión' }).locator('.chord-btn b')).toHaveText(['C', 'G', 'Am', 'F', 'E7']);
  await expect(chip('G')).toHaveAccessibleName(/grado I/);
});

test('Test D — consultar el círculo desde un mapa existente no toca posiciones, notas ni la ayuda de escala', async ({ page }) => {
  await openLibrary(page);
  await createMaterial(page, 'Mapa de escala', 'Do jónico');
  for (const [string, fret] of [[5, 0], [5, 1], [5, 3], [4, 3]]) await neck(page).pick(string, fret);
  await page.getByRole('button', { name: 'Agregar posición' }).click();
  await neck(page).pick(3, 2);
  await page.getByRole('tab', { name: 'Posición 1' }).click();
  await page.getByRole('switch', { name: 'Ayuda de escala' }).click();
  await expect(page.getByRole('switch', { name: 'Ayuda de escala' })).toHaveAttribute('aria-checked', 'true');
  await settleSave(page);
  const before = await snapshot(page);

  await openTools(page);
  await panel(page).getByRole('button', { name: 'Acordes', exact: true }).click();
  await panel(page).getByLabel('Símbolo de acorde').fill('Cmaj7');
  await panel(page).getByLabel('Símbolo de acorde').press('Enter');
  await expect(panel(page).getByLabel('Notas del acorde')).toContainText('Si');
  await closeTools(page);

  await expect(page.getByRole('switch', { name: 'Ayuda de escala' })).toHaveAttribute('aria-checked', 'true');
  await expect(neck(page).marker(5, 3)).toBeVisible();
  await page.waitForTimeout(1200);
  expect(await snapshot(page)).toBe(before);
});

test('el explorador de acordes muestra notas, intervalos y compara tríadas y séptimas con el mismo lenguaje de color', async ({ page }) => {
  await openLibrary(page);
  await createFromMenu(page, 'Cuaderno de composición', 'Acordes');
  await openTools(page);
  await panel(page).getByRole('button', { name: 'Acordes', exact: true }).click();
  await panel(page).getByLabel('Símbolo de acorde').fill('Bbmaj7');
  await panel(page).getByLabel('Símbolo de acorde').press('Enter');
  await expect(panel(page).getByLabel('Notas del acorde').locator('li b')).toHaveText(['Si♭', 'Re', 'Fa', 'La']);
  await expect(panel(page).getByLabel('Notas del acorde').locator('li.role-root')).toHaveCount(1);
  await expect(panel(page).getByLabel('Notas del acorde').locator('li.role-seventh')).toHaveCount(1);
  await expect(panel(page).getByRole('cell', { name: '1 · ♭3 · ♭5', exact: true })).toBeVisible(); // the diminished triad's intervals
  await expect(panel(page).getByRole('cell', { name: '1 · 3 · ♯5', exact: true })).toBeVisible(); // the augmented one
  await expect(panel(page).getByLabel(/Notas de B♭maj7 en el mástil/)).toBeVisible();
});

test('Test E — una canción completa conserva todo tras explorar una modulación y cerrar las herramientas', async ({ page }) => {
  await openLibrary(page);
  await createFromMenu(page, 'Canción con letra', 'Canción E');
  await page.getByLabel('Letra', { exact: true }).fill('# Verso 1\n[C]Hoy vuelvo');
  const add = async (entry: string) => {
    await page.getByRole('button', { name: 'Agregar bloque', exact: true }).first().click();
    await page.getByRole('menuitem', { name: new RegExp(`^${entry}`) }).click();
  };
  await add('Melodía');
  await page.getByLabel('Escribir notas').fill('Do4 Mi4 Sol4');
  await page.getByLabel('Escribir notas').press('Enter');
  await add('Acordes');
  await page.getByLabel('Escribir acordes').fill('C G');
  await page.getByLabel('Escribir acordes').press('Enter');
  await add('Tablatura');
  await cell(page, 1, 1).click();
  await page.keyboard.press('5');
  await add('Mapa del mástil');
  await neck(page).pick(5, 3);
  await page.getByRole('button', { name: 'Comentarios de el cuaderno' }).click();
  await page.getByLabel('Nuevo comentario sobre el cuaderno').fill('Probar el estribillo en Sol');
  await page.getByRole('button', { name: 'Agregar comentario' }).click();
  await page.keyboard.press('Escape');
  await settleSave(page);
  const before = await snapshot(page);

  await openTools(page);
  await panel(page).getByRole('button', { name: 'Modulación' }).click();
  await panel(page).getByLabel('Destino').selectOption('D:major');
  await expect(panel(page).getByText('Caminos posibles')).toBeVisible();
  // "Agregar al cuaderno" is a named, explicit action; nothing is added by only looking.
  await closeTools(page);
  await page.waitForTimeout(1200);
  expect(await snapshot(page)).toBe(before);
  await expect(page.getByLabel('Letra', { exact: true })).toHaveValue(/Hoy vuelvo/);
});

test('"Agregar a la progresión" y "Usar como tonalidad" son acciones explícitas y se deshacen', async ({ page }) => {
  await openLibrary(page);
  await createFromMenu(page, 'Progresión de acordes', 'Explícito');
  await page.getByLabel('Escribir acordes').fill('C G');
  await page.getByLabel('Escribir acordes').press('Enter');
  const chips = page.getByRole('list', { name: 'Acordes de la progresión' }).locator('.chord-btn b');
  await openTools(page);
  await panel(page).getByRole('button', { name: 'Acordes', exact: true }).click();
  await panel(page).getByLabel('Símbolo de acorde').fill('Dm7');
  await panel(page).getByLabel('Símbolo de acorde').press('Enter');
  await expect(chips).toHaveText(['C', 'G']); // looking does not add
  await panel(page).getByRole('button', { name: 'Agregar a la progresión' }).click();
  await expect(chips).toHaveText(['C', 'G', 'Dm7']);
  await panel(page).getByRole('button', { name: 'Círculo' }).click();
  await panel(page).getByRole('button', { name: /^Usar Do mayor como tonalidad del cuaderno/ }).click();
  await expect(page.getByRole('button', { name: 'Tonalidad del cuaderno', exact: true })).toContainText('Do mayor');
  await page.getByRole('button', { name: 'Deshacer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Tonalidad del cuaderno', exact: true })).toContainText('—');
});
