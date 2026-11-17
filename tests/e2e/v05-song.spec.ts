import { expect, test } from '@playwright/test';
import { openLibrary, settleSave, storedDocuments } from './helpers';

test('crear una canción con el formulario mínimo: BPM y tonalidad se heredan en bloques, círculo y progresiones', async ({ page }) => {
  await openLibrary(page);
  await page.getByRole('button', { name: 'Nueva canción' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Nueva canción' });
  await dialog.getByLabel('Nombre de la canción').fill('Tema 1 FT Goti');
  await dialog.getByLabel('BPM de la canción').fill('92');
  await dialog.getByLabel('Tonalidad de la canción').selectOption('F:major');
  await dialog.getByRole('radio', { name: /Con estructura inicial/ }).check();
  await dialog.getByRole('button', { name: 'Crear canción' }).click();
  await page.waitForURL(/\/material\//);

  await expect(page.getByLabel('Título del material')).toHaveValue('Tema 1 FT Goti');
  await expect(page.getByRole('spinbutton', { name: 'Tempo del cuaderno' })).toHaveValue('92');
  await expect(page.getByRole('button', { name: 'Tonalidad del cuaderno', exact: true })).toContainText('Fa mayor');
  await expect(page.locator('.section-title')).toHaveCount(2);
  await expect(page.getByRole('spinbutton', { name: 'BPM de melodía' })).toHaveCount(2);
  for (const field of await page.getByRole('spinbutton', { name: 'BPM de melodía' }).all()) await expect(field).toHaveValue('92');

  // Verso 1 and Estribillo each carry their own lyrics and a melody linked to it by reference.
  await settleSave(page);
  const doc = (await storedDocuments(page)).find((item) => item.title === 'Tema 1 FT Goti')!;
  const content = doc.content as unknown as { meta: { bpm: number; key: { tonic: string; mode: string }; status: string }; blocks: Array<{ id: string; kind: string; title?: string; content?: { lyricsBlockId?: string } }> };
  expect(content.meta).toEqual({ status: 'idea', bpm: 92, key: { tonic: 'F', mode: 'major' } });
  expect(content.blocks.map((block) => block.kind)).toEqual(['section', 'lyrics', 'melody', 'section', 'lyrics', 'melody']);
  expect(content.blocks[2].content?.lyricsBlockId).toBe(content.blocks[1].id);
  expect(content.blocks[5].content?.lyricsBlockId).toBe(content.blocks[4].id);

  // The circle of fifths opens on the song's key, with no extra setup.
  await page.getByRole('button', { name: 'Armonía', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Herramientas musicales' }).getByRole('heading', { name: 'Fa mayor' })).toBeVisible();
});

test('el formulario de canción pide solo un nombre: todo lo demás es opcional y se puede borrar', async ({ page }) => {
  await openLibrary(page);
  await page.getByRole('button', { name: 'Nueva canción' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Nueva canción' });
  await dialog.getByLabel('BPM de la canción').fill('');
  await dialog.getByRole('button', { name: 'Crear canción' }).click();
  await page.waitForURL(/\/material\//);
  await expect(page.getByLabel('Título del material')).toHaveValue('Nueva canción');
  await expect(page.getByRole('spinbutton', { name: 'Tempo del cuaderno' })).toHaveValue('');
  await expect(page.getByRole('heading', { name: 'Empezá tu material' })).toBeVisible();
  await settleSave(page);
  const doc = (await storedDocuments(page)).find((item) => item.title === 'Nueva canción')!;
  expect((doc.content as unknown as { meta: object }).meta).toEqual({ status: 'idea' });
});
