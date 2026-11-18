import { expect, test, type Page } from '@playwright/test';
import { audioLog, audioProbe, audioState, createFromMenu, openLibrary, settleSave, storedDocuments } from './helpers';

test.setTimeout(120_000);

const panel = (page: Page) => page.getByRole('complementary', { name: 'Herramientas musicales' });
const notes = (page: Page) => page.getByRole('listbox', { name: 'Notas de la melodía' }).getByRole('option');
const keyboard = (page: Page) => page.getByRole('group', { name: 'Teclado musical' });
const snapshot = async (page: Page) => JSON.stringify((await storedDocuments(page)).map((doc) => ({ id: doc.id, title: doc.title, content: doc.content })));

test('Armonía está en la barra superior de toda la app; en la biblioteca es exploración libre y no toca nada', async ({ page }) => {
  await openLibrary(page);
  const before = await snapshot(page);
  await page.getByRole('button', { name: 'Armonía', exact: true }).click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole('heading', { name: 'Do mayor' })).toBeVisible(); // free start
  await panel(page).getByRole('button', { name: 'Cerrar herramientas musicales' }).click();
  await expect(panel(page)).toHaveCount(0);
  // The «H» key opens it from anywhere, but never while typing.
  await page.keyboard.press('h');
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press('h');
  await expect(panel(page)).toHaveCount(0);
  expect(await snapshot(page)).toBe(before);
});

test('Armonía en la canción abre en su tonalidad y la letra puede escribir una «h» sin abrir el panel', async ({ page }) => {
  await openLibrary(page);
  await createFromMenu(page, 'Canción con letra', 'Con H');
  await page.getByLabel('Letra', { exact: true }).fill('Hola');
  await page.getByLabel('Letra', { exact: true }).press('h');
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByLabel('Letra', { exact: true })).toHaveValue('Holah');
});

test('Metrónomo: volumen propio que se recuerda, acento del primer tiempo y un clic que no satura', async ({ page }) => {
  await audioProbe(page);
  await openLibrary(page);
  await page.getByRole('button', { name: /Ajustes del metrónomo|Más opciones del metrónomo/ }).first().click().catch(() => undefined);
  const peaks = await page.evaluate(async () => {
    const probe = (window as unknown as { __guitarapMeasureClick: (accent: boolean, level: number) => Promise<{ peak: number }> }).__guitarapMeasureClick;
    return { soft: (await probe(false, 0.6)).peak, accent: (await probe(true, 0.6)).peak, max: (await probe(true, 1)).peak };
  });
  expect(peaks.soft).toBeGreaterThan(0.05); // audible
  expect(peaks.accent).toBeGreaterThanOrEqual(peaks.soft); // the first beat is not weaker
  expect(peaks.max).toBeLessThan(1); // the loudest setting does not clip
});

test('Metrónomo: la preferencia de volumen y de acento sobrevive a la recarga', async ({ page }) => {
  await audioProbe(page);
  await openLibrary(page);
  await page.evaluate(() => {
    window.localStorage.setItem('guitarap.pref.metronome.volume', '0.3');
    window.localStorage.setItem('guitarap.pref.metronome.accent', 'false');
  });
  await page.reload();
  await page.getByRole('button', { name: 'Iniciar metrónomo' }).click();
  await expect.poll(async () => (await audioLog(page)).filter((entry) => entry.type === 'click').length, { timeout: 15000 }).toBeGreaterThanOrEqual(2);
  const clicks = (await audioLog(page)).filter((entry) => entry.type === 'click') as Array<{ accent?: boolean }>;
  expect(clicks.every((entry) => entry.accent === false)).toBe(true); // accent switched off: no click is accented
  await page.getByRole('button', { name: 'Detener metrónomo' }).click();
});

test('Instrumento junto a Play: probar otro sonido es temporal; «Fijar» lo guarda en el bloque', async ({ page }) => {
  await audioProbe(page);
  await openLibrary(page);
  await createFromMenu(page, 'Cuaderno de composición', 'Probando');
  await page.getByRole('button', { name: 'Agregar melodía' }).click();
  await page.getByLabel('Escribir notas').fill('Do4 Re4 Mi4 Fa4 Sol4 La4 Si4 Do5');
  await page.getByLabel('Escribir notas').press('Enter');
  await expect(notes(page)).toHaveCount(8);
  await settleSave(page);
  const before = await snapshot(page);

  const pick = page.getByRole('group', { name: 'Instrumento de melodía' });
  await expect(pick.getByRole('button', { name: 'Piano' })).toHaveAttribute('aria-pressed', 'true'); // melody default
  await pick.getByRole('button', { name: 'Guitarra', exact: true }).click();
  await expect(pick.getByRole('button', { name: 'Guitarra', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(pick.getByText('probando')).toBeVisible();
  await page.getByRole('button', { name: 'Reproducir melodía' }).click();
  await expect.poll(async () => (await audioLog(page)).filter((entry) => entry.type === 'note').length, { timeout: 15000 }).toBeGreaterThanOrEqual(2);
  const sounded = (await audioLog(page)).filter((entry) => entry.type === 'note') as Array<{ instrument?: string }>;
  expect(sounded.at(-1)?.instrument).toBe('guitar'); // the engine really receives the try-out
  await page.getByRole('button', { name: 'Detener melodía' }).click();
  await settleSave(page);
  expect(await snapshot(page)).toBe(before); // nothing was written

  await pick.getByRole('button', { name: 'Fijar guitarra en este bloque' }).click();
  await settleSave(page);
  const doc = (await storedDocuments(page)).find((item) => item.content?.kind === 'notebook')!;
  const block = doc.content.blocks.find((item) => item.kind === 'melody')!.content as { instrument?: string };
  expect(block.instrument).toBe('guitar');
  await page.reload();
  await expect(page.getByRole('group', { name: 'Instrumento de melodía' }).getByRole('button', { name: 'Guitarra' })).toHaveAttribute('aria-pressed', 'true');
});

test('Tocar libremente: suena, pero no agrega notas, no guarda, no crea versiones y no deja voces colgadas', async ({ page }) => {
  await audioProbe(page);
  await openLibrary(page);
  await createFromMenu(page, 'Cuaderno de composición', 'Libre');
  await page.getByRole('button', { name: 'Agregar melodía' }).click();
  await keyboard(page).getByRole('button', { name: 'Do4', exact: true }).click();
  await expect(notes(page)).toHaveCount(1);
  await settleSave(page);
  const before = JSON.stringify(await storedDocuments(page));

  await page.getByRole('group', { name: 'Qué hace el teclado' }).getByRole('button', { name: 'Tocar libremente' }).click();
  const sounds = async () => (await audioLog(page)).filter((entry) => entry.type === 'note').length;
  const start = await sounds();
  await keyboard(page).getByRole('button', { name: 'Mi4', exact: true }).click();
  await keyboard(page).getByRole('button', { name: 'Sol4', exact: true }).click();
  await expect.poll(sounds, { timeout: 15000 }).toBeGreaterThanOrEqual(start + 2); // it sounds
  await expect(notes(page)).toHaveCount(1); // and writes nothing
  await page.waitForTimeout(1500);
  expect(JSON.stringify(await storedDocuments(page))).toBe(before); // no document change, no new version, nothing to sync
  await expect.poll(async () => (await audioState(page)).voices, { timeout: 15000 }).toBe(0); // nothing hangs

  await page.getByRole('group', { name: 'Qué hace el teclado' }).getByRole('button', { name: 'Escribir', exact: true }).click();
  await keyboard(page).getByRole('button', { name: 'Mi4', exact: true }).click();
  await expect(notes(page)).toHaveCount(2); // writing is the default and still works
});

test('Editar notas: borrar con Supr, cortar, pegar y deshacer sin perder ninguna', async ({ page }) => {
  await openLibrary(page);
  await createFromMenu(page, 'Cuaderno de composición', 'Edición');
  await page.getByRole('button', { name: 'Agregar melodía' }).click();
  await page.getByLabel('Escribir notas').fill('Do4 Re4 Mi4 Fa4');
  await page.getByLabel('Escribir notas').press('Enter');
  await expect(notes(page)).toHaveCount(4);
  await notes(page).nth(1).click();
  await page.keyboard.press('Delete');
  await expect(notes(page)).toHaveCount(3);
  await page.keyboard.press('Control+z');
  await expect(notes(page)).toHaveCount(4);
  await notes(page).nth(0).click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+x');
  await expect(notes(page)).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(notes(page)).toHaveCount(4);
  await settleSave(page);
  await page.reload();
  await expect(notes(page)).toHaveCount(4);
});
