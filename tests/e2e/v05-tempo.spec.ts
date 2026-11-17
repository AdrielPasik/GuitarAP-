import { expect, test, type Page } from '@playwright/test';
import { audioLog, audioProbe, audioState, cell, createFromMenu, openLibrary, settleSave, storedDocuments } from './helpers';

const songBpm = (page: Page) => page.getByRole('spinbutton', { name: 'Tempo del cuaderno' });
const setSongBpm = async (page: Page, value: string) => {
  await songBpm(page).fill(value);
  await songBpm(page).press('Enter');
};
const bpmOf = (page: Page, label: string) => page.getByRole('spinbutton', { name: `BPM de ${label}`, exact: true });
const addBlock = async (page: Page, entry: string) => {
  await page.getByRole('button', { name: 'Agregar bloque', exact: true }).first().click();
  await page.getByRole('menuitem', { name: new RegExp(`^${entry}`) }).click();
};
const notes = async (page: Page) => (await audioLog(page)).filter((entry) => entry.type === 'note');
const notebookOf = async (page: Page, title?: string) => {
  const docs = await storedDocuments(page);
  const doc = docs.find((item) => item.content?.kind === 'notebook' && (!title || item.title === title))!;
  return doc.content as unknown as { meta?: { bpm?: number }; blocks: Array<{ kind: string; content: { bpm?: number; events?: Array<{ midi: number; beats: number }> } }> };
};

async function threeBlockSong(page: Page, title: string) {
  await createFromMenu(page, 'Cuaderno de composición', title);
  await setSongBpm(page, '92');
  await page.getByRole('button', { name: 'Agregar melodía' }).click();
  await page.getByLabel('Escribir notas').fill('Do4 Re4 Mi4 Sol4');
  await page.getByLabel('Escribir notas').press('Enter');
  await addBlock(page, 'Tablatura');
  await cell(page, 1, 1).click();
  for (const key of '578') await page.keyboard.press(key);
  await addBlock(page, 'Acordes');
  await page.getByLabel('Escribir acordes').fill('C G Am F');
  await page.getByLabel('Escribir acordes').press('Enter');
}

test('Escenario A — la canción define 92 BPM y todos sus bloques lo heredan, sin copiar el valor a cada bloque', async ({ page }) => {
  await openLibrary(page);
  await threeBlockSong(page, 'Tema 1');
  for (const label of ['melodía', 'tablatura', 'progresión']) {
    await expect(bpmOf(page, label)).toHaveValue('92');
  }
  await expect(page.getByText('tempo de la canción')).toHaveCount(3);
  await settleSave(page);
  const saved = await notebookOf(page);
  expect(saved.meta?.bpm).toBe(92);
  // Inheritance, not duplication: no block stores a tempo of its own.
  expect(saved.blocks.map((block) => block.content.bpm)).toEqual([undefined, undefined, undefined]);
  await page.reload();
  await expect(songBpm(page)).toHaveValue('92');
  await expect(bpmOf(page, 'melodía')).toHaveValue('92');
});

test('Escenario B — cambiar el BPM de la canción cambia la reproducción de todos los bloques, y la música no cambia', async ({ page }) => {
  await audioProbe(page);
  await openLibrary(page);
  await threeBlockSong(page, 'Tema B');
  await settleSave(page);
  const before = await notebookOf(page);
  await setSongBpm(page, '105');
  for (const label of ['melodía', 'tablatura', 'progresión']) await expect(bpmOf(page, label)).toHaveValue('105');
  await page.getByRole('button', { name: 'Reproducir melodía' }).click();
  await expect.poll(async () => (await notes(page)).length).toBe(4);
  const played = await notes(page);
  expect(played.map((entry) => entry.midi)).toEqual([60, 62, 64, 67]);
  for (const [index, entry] of played.slice(1).entries()) expect((entry.when ?? 0) - (played[index].when ?? 0)).toBeCloseTo(60 / 105, 1);
  await settleSave(page);
  const after = await notebookOf(page);
  expect(after.meta?.bpm).toBe(105);
  expect(after.blocks.map((block) => block.content.events)).toEqual(before.blocks.map((block) => block.content.events));
});

test('Escenario C — un bloque con tempo propio ignora a la canción hasta que vuelve a «Usar BPM de la canción»', async ({ page }) => {
  await openLibrary(page);
  await createFromMenu(page, 'Cuaderno de composición', 'Tema C');
  await setSongBpm(page, '92');
  await page.getByRole('button', { name: 'Agregar melodía' }).click();
  await page.getByLabel('Escribir notas').fill('Do4 Re4');
  await page.getByLabel('Escribir notas').press('Enter');
  await addBlock(page, 'Acordes');

  await page.getByRole('button', { name: 'Sonido y tempo de melodía' }).click();
  await page.getByRole('radio', { name: 'BPM propio' }).check();
  await page.getByLabel('BPM propio de melodía').fill('70');
  await page.getByLabel('BPM propio de melodía').press('Enter');
  await expect(bpmOf(page, 'melodía')).toHaveValue('70');
  await expect(page.getByText('tempo propio')).toBeVisible();
  await page.keyboard.press('Escape');

  await setSongBpm(page, '110');
  await expect(bpmOf(page, 'melodía')).toHaveValue('70');
  await expect(bpmOf(page, 'progresión')).toHaveValue('110');
  await settleSave(page);
  expect((await notebookOf(page)).blocks[0].content.bpm).toBe(70);

  await page.getByRole('button', { name: 'Sonido y tempo de melodía' }).click();
  await page.getByRole('radio', { name: /Usar BPM de la canción/ }).check();
  await page.keyboard.press('Escape');
  await expect(bpmOf(page, 'melodía')).toHaveValue('110');
  await settleSave(page);
  // The exception is gone from the data, not stored as "undefined".
  const saved = await notebookOf(page);
  expect('bpm' in saved.blocks[0].content).toBe(false);
});

test('Escenario D — bajar el tempo para practicar no cambia la canción, y se puede volver al original', async ({ page }) => {
  await audioProbe(page);
  await openLibrary(page);
  await createFromMenu(page, 'Cuaderno de composición', 'Tema D');
  await setSongBpm(page, '120');
  await page.getByRole('button', { name: 'Agregar melodía' }).click();
  await page.getByLabel('Escribir notas').fill('Do4 Re4 Mi4');
  await page.getByLabel('Escribir notas').press('Enter');
  await settleSave(page);

  await page.getByRole('link', { name: 'Practicar' }).click();
  await expect(page.getByRole('region', { name: 'Modo Práctica' })).toBeVisible(); // the route loads on demand
  await expect(bpmOf(page, 'melodía')).toHaveValue('120');
  await bpmOf(page, 'melodía').fill('80');
  await bpmOf(page, 'melodía').press('Enter');
  await expect(bpmOf(page, 'melodía')).toHaveValue('80');
  await expect(page.getByText('tempo de práctica').first()).toBeVisible();
  await page.getByRole('button', { name: 'Reproducir melodía' }).click();
  await expect.poll(async () => (await notes(page)).length).toBe(3);
  const played = await notes(page);
  expect((played[1].when ?? 0) - (played[0].when ?? 0)).toBeCloseTo(0.75, 1);

  // Leaving practice: the song still says 120, nothing was written.
  await page.getByRole('link', { name: 'Editar' }).click();
  await expect(songBpm(page)).toHaveValue('120');
  await expect(page.getByRole('status').filter({ hasText: 'Práctica a 80 BPM' })).toBeVisible();
  await page.waitForTimeout(1200);
  expect((await notebookOf(page)).meta?.bpm).toBe(120);
  await page.getByRole('button', { name: 'Volver a 120', exact: true }).click();
  await expect(bpmOf(page, 'melodía')).toHaveValue('120');
  expect((await notebookOf(page)).meta?.bpm).toBe(120);
});

test('Escenario E — el metrónomo sigue el tempo de la canción abierta y cambia con ella, sin sonar junto a la música', async ({ page }) => {
  await audioProbe(page);
  await openLibrary(page);
  await createFromMenu(page, 'Cuaderno de composición', 'Primera');
  await setSongBpm(page, '92');
  await page.getByRole('button', { name: 'Agregar melodía' }).click();
  await page.getByLabel('Escribir notas').fill('Do4 Re4 Mi4 Fa4');
  await page.getByLabel('Escribir notas').press('Enter');
  await settleSave(page);
  const metro = page.getByRole('group', { name: 'Metrónomo' }).getByRole('spinbutton', { name: 'BPM', exact: true });
  await expect(metro).toHaveValue('92');
  await page.getByRole('button', { name: 'Iniciar metrónomo' }).click();
  await expect(page.getByRole('button', { name: 'Detener metrónomo' })).toBeVisible();

  await page.getByRole('link', { name: /Volver a la biblioteca/ }).click(); // in-app navigation: the metronome keeps running
  await createFromMenu(page, 'Cuaderno de composición', 'Segunda');
  await setSongBpm(page, '140');
  await expect(metro).toHaveValue('140');
  await expect(page.getByRole('button', { name: 'Detener metrónomo' })).toBeVisible(); // still running, at the new tempo

  // Playing music silences the metronome: one clock.
  await page.getByRole('button', { name: 'Agregar melodía' }).click();
  await page.getByLabel('Escribir notas').fill('Do4 Re4');
  await page.getByLabel('Escribir notas').press('Enter');
  await page.getByRole('button', { name: 'Reproducir melodía' }).click();
  await expect(page.getByRole('button', { name: 'Iniciar metrónomo' })).toBeVisible();
  await page.getByRole('button', { name: 'Detener melodía' }).click();
  expect((await audioState(page)).voices).toBe(0);
});

test('Escenario F — un documento heredado sin BPM usa el predeterminado, y agregarle uno no toca sus notas', async ({ page }) => {
  await openLibrary(page);
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('guitarap');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const tx = request.result.transaction('documents', 'readwrite');
          tx.objectStore('documents').put({
            id: 'legacy-f', nodeId: null, type: 'tablature', title: 'Riff heredado', rev: 3, createdAt: 1000, updatedAt: 2000,
            content: { tuning: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'], zoom: 1, wrapAfter: 16, annotations: [], columns: [0, 1, 2].map((index) => ({ id: `c${index}`, cells: [{ fret: [5, 7, 8][index] }, {}, {}, {}, {}, {}] })) },
          });
          tx.oncomplete = () => resolve();
        };
      }),
  );
  const original = JSON.stringify((await storedDocuments(page)).find((item) => item.id === 'legacy-f'));
  await page.goto('/material/legacy-f');
  await expect(bpmOf(page, 'tablatura')).toHaveValue('96');
  await expect(page.getByText('tempo predeterminado')).toBeVisible();
  await page.waitForTimeout(1200);
  expect(JSON.stringify((await storedDocuments(page)).find((item) => item.id === 'legacy-f'))).toBe(original); // only looking writes nothing

  await setSongBpm(page, '88');
  await settleSave(page);
  const after = (await storedDocuments(page)).find((item) => item.id === 'legacy-f')!;
  const content = after.content as unknown as { meta?: { bpm?: number }; blocks: Array<{ content: { columns: Array<{ id: string; cells: Array<{ fret?: number }> }> } }> };
  expect(content.meta?.bpm).toBe(88);
  expect(content.blocks[0].content.columns.map((column) => column.cells[0].fret)).toEqual([5, 7, 8]);
  await page.reload();
  await expect(bpmOf(page, 'tablatura')).toHaveValue('88');
});
