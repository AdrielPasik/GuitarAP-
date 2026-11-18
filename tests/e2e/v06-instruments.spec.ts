import { expect, test, type Page } from '@playwright/test';
import { audioLog, audioProbe, cell, createFromMenu, createMaterial, openLibrary, settleSave, silentWriting, storedDocuments } from './helpers';

const notes = (page: Page) => page.getByRole('listbox', { name: 'Notas de la melodía' }).getByRole('option');
const storedBlock = async (page: Page, kind: string) => {
  await settleSave(page);
  const docs = await storedDocuments(page);
  const notebook = docs.find((doc) => doc.content?.kind === 'notebook')!.content;
  return notebook.blocks.find((block: { kind: string }) => block.kind === kind)?.content as { instrument?: string } | undefined;
};

test.setTimeout(120_000); // long, real-time scenarios: the machine running them may be slow

test('Escenario B — melodía en piano y tablatura en guitarra sin tocar Configuración; la excepción de un bloque se guarda y se respeta', async ({ page }) => {
  await audioProbe(page);
  await openLibrary(page);
  await createFromMenu(page, 'Cuaderno de composición', 'Instrumentos');
  await page.getByRole('button', { name: 'Agregar melodía' }).click();

  // The keyboard sounds a piano, and so does Play: nothing was configured.
  await page.getByRole('group', { name: 'Teclado musical' }).getByRole('button', { name: 'Do4', exact: true }).click();
  await page.getByRole('group', { name: 'Teclado musical' }).getByRole('button', { name: 'Mi4', exact: true }).click();
  await expect(notes(page)).toHaveCount(2);
  const count = async () => (await audioLog(page)).filter((entry) => entry.type === 'note').length;
  // The two key presses sound (previews are asynchronous: wait for them rather than assuming they already arrived).
  await expect.poll(count, { timeout: 15000 }).toBeGreaterThanOrEqual(2);
  const previews = await count();
  await page.getByRole('button', { name: 'Reproducir melodía' }).click();
  await expect.poll(count, { timeout: 30000 }).toBeGreaterThanOrEqual(previews + 2); // Play schedules both notes
  const piano = (await audioLog(page)).filter((entry) => entry.type === 'note') as Array<{ instrument?: string }>;
  expect(piano.every((entry) => entry.instrument === 'piano')).toBe(true); // keys and Play, all piano
  // (A two-note melody may already have finished by now: Stop is disabled then, and navigating away stops any sound.)
  expect(await storedBlock(page, 'melody')).not.toHaveProperty('instrument'); // the default was not written into the document

  // A new tablature in a new material sounds a guitar.
  await page.goto('/biblioteca');
  await createMaterial(page, 'Tablatura', 'Riff de prueba');
  await cell(page, 1, 1).click();
  await page.keyboard.press('5');
  await page.keyboard.press('7');
  await page.getByRole('button', { name: 'Reproducir tablatura' }).click();
  await expect.poll(async () => (await audioLog(page)).filter((entry) => entry.type === 'note').length, { timeout: 15000 }).toBeGreaterThanOrEqual(2);
  const sounded = (await audioLog(page)).filter((entry) => entry.type === 'note') as Array<{ instrument?: string }>;
  expect(sounded.every((entry) => entry.instrument === 'guitar')).toBe(true); // every note, previews included
});

test('un instrumento elegido para un bloque se guarda, sobrevive a la recarga y no lo pisa un cambio global; se puede volver al predeterminado', async ({ page }) => {
  await audioProbe(page);
  await silentWriting(page);
  await openLibrary(page);
  await createFromMenu(page, 'Cuaderno de composición', 'Excepción');
  await page.getByRole('button', { name: 'Agregar melodía' }).click();
  await page.getByLabel('Escribir notas').fill('Do4 Re4 Mi4 Fa4 Sol4 La4 Si4 Do5'); // long enough that it is still playing when the test looks
  await page.getByLabel('Escribir notas').press('Enter');
  await expect(notes(page)).toHaveCount(8);

  // This melody is listened to on guitar, explicitly.
  await page.getByRole('button', { name: 'Sonido y tempo de melodía' }).click();
  await page.getByRole('group', { name: 'Instrumento' }).getByRole('button', { name: 'Guitarra' }).click();
  expect((await storedBlock(page, 'melody'))?.instrument).toBe('guitar');
  await page.keyboard.press('Escape');

  // A global change for melodies (piano -> guitar -> piano) must not touch that block's own choice.
  await page.goto('/configuracion/sonido');
  const melodies = page.getByRole('group', { name: 'Instrumento para melodías' });
  await melodies.getByRole('button', { name: 'Guitarra' }).click();
  await melodies.getByRole('button', { name: 'Piano' }).click();
  await page.reload();
  await expect(page.getByRole('group', { name: 'Instrumento para tablaturas' }).getByRole('button', { name: 'Guitarra' })).toHaveAttribute('aria-pressed', 'true'); // tablatures stay on guitar
  await expect(page.getByRole('group', { name: 'Instrumento para melodías' }).getByRole('button', { name: 'Piano' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('link', { name: 'Biblioteca' }).first().click();
  await page.locator('.lib-row', { hasText: 'Excepción' }).locator('.lib-open').click();
  await page.getByRole('button', { name: 'Reproducir melodía' }).click();
  await expect.poll(async () => (await audioLog(page)).filter((entry) => entry.type === 'note').length, { timeout: 15000 }).toBeGreaterThanOrEqual(2);
  const sounded = (await audioLog(page)).filter((entry) => entry.type === 'note') as Array<{ instrument?: string }>;
  expect(sounded.every((entry) => entry.instrument === 'guitar')).toBe(true); // the exception survived the reload and the global change
  await page.getByRole('button', { name: 'Detener melodía' }).click();

  // Back to the default for melodies: the block stops carrying its own instrument.
  await page.getByRole('button', { name: 'Sonido y tempo de melodía' }).click();
  await page.getByRole('button', { name: /Volver al predeterminado/ }).click();
  const after = await storedBlock(page, 'melody');
  expect(after).toBeTruthy();
  expect(after).not.toHaveProperty('instrument');
});
