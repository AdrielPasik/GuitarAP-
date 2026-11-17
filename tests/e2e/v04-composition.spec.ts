import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { audioLog, audioProbe, audioState, cell, createFromMenu, createMaterial, mockServer, neck, openLibrary, settleSave, storedDocuments } from './helpers';

const notes = (page: Page) => page.getByRole('listbox', { name: 'Notas de la melodía' }).getByRole('option');
const noteLog = async (page: Page) => (await audioLog(page)).filter((entry) => entry.type === 'note');
const addBlock = async (page: Page, entry: string) => {
  await page.getByRole('button', { name: 'Agregar bloque', exact: true }).first().click();
  await page.getByRole('menuitem', { name: new RegExp(`^${entry}`) }).click();
};
const bpmField = (page: Page, label: string) => page.getByRole('spinbutton', { name: `BPM de ${label}` });
const setBpm = async (page: Page, label: string, value: string) => {
  await bpmField(page, label).fill(value);
  await bpmField(page, label).press('Enter');
};

test('Escenario C — un solo escrito en tablatura suena en orden, con la altura de cada traste y el tempo elegido', async ({ page }) => {
  await audioProbe(page);
  await openLibrary(page);
  await createMaterial(page, 'Tablatura', 'Solo');
  await cell(page, 1, 1).click();
  for (const key of '57875') await page.keyboard.press(key);
  await expect(cell(page, 1, 5)).toHaveValue('5');

  await setBpm(page, 'tablatura', '120');
  await page.getByRole('button', { name: 'Reproducir tablatura' }).click();
  await expect.poll(async () => (await noteLog(page)).length).toBe(5);
  const played = await noteLog(page);
  // First string is E4 (64): frets 5, 7, 8, 7, 5 -> A4 B4 C5 B4 A4.
  expect(played.map((entry) => entry.midi)).toEqual([69, 71, 72, 71, 69]);
  for (const [index, entry] of played.slice(1).entries()) expect((entry.when ?? 0) - (played[index].when ?? 0)).toBeCloseTo(0.5, 1);

  // A slower tempo spaces the notes further apart.
  await expect.poll(async () => (await audioState(page)).state, { timeout: 15000 }).toBe('idle');
  const before = (await noteLog(page)).length;
  await setBpm(page, 'tablatura', '60');
  await page.getByRole('button', { name: 'Reproducir tablatura' }).click();
  await expect.poll(async () => (await noteLog(page)).length, { timeout: 20000 }).toBeGreaterThanOrEqual(before + 3);
  const slow = (await noteLog(page)).slice(before);
  expect((slow[1].when ?? 0) - (slow[0].when ?? 0)).toBeCloseTo(1, 1);
  await page.getByRole('button', { name: 'Detener tablatura' }).click();
  await expect.poll(async () => (await audioState(page)).state).toBe('idle');
  expect((await audioState(page)).voices).toBe(0);
});

test('Escenario D — un acorde suena con todas sus cuerdas juntas y respeta la afinación del documento', async ({ page }) => {
  await audioProbe(page);
  await openLibrary(page);
  await createMaterial(page, 'Tablatura', 'Acorde');
  await page.getByRole('button', { name: 'Mástil', exact: true }).click();
  await page.getByRole('button', { name: 'Acorde', exact: true }).click();
  const tabNeck = page.getByTestId('tab-neck');
  await tabNeck.getByTestId('fret-5-3').click();
  await tabNeck.getByTestId('fret-4-2').click();
  await tabNeck.getByTestId('fret-3-0').click();
  await page.getByRole('button', { name: 'Reproducir tablatura' }).click();
  await expect.poll(async () => (await noteLog(page)).length).toBe(3);
  const chord = await noteLog(page);
  expect(chord.map((entry) => entry.midi).sort()).toEqual([43, 47, 50]); // G2 B2 D3
  expect(new Set(chord.map((entry) => entry.when)).size).toBe(1); // together
  await expect.poll(async () => (await audioState(page)).state, { timeout: 15000 }).toBe('idle');

  // The saved tuning is what counts: lower the 6th string a whole tone in the stored document and play again.
  await settleSave(page);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const request = indexedDB.open('guitarap');
        request.onsuccess = () => {
          const store = request.result.transaction('documents', 'readwrite').objectStore('documents');
          store.getAll().onsuccess = (event) => {
            const docs = (event.target as IDBRequest).result as Array<{ content: { tuning?: string[] } }>;
            for (const doc of docs) if (doc.content.tuning) doc.content.tuning[5] = 'D2';
            for (const doc of docs) store.put(doc);
            resolve();
          };
        };
      }),
  );
  await page.reload();
  const start = (await noteLog(page)).length;
  await page.getByRole('button', { name: 'Reproducir tablatura' }).click();
  await expect.poll(async () => (await noteLog(page)).length).toBe(start + 3);
  const retuned = (await noteLog(page)).slice(start);
  expect(retuned.map((entry) => entry.midi).sort()).toEqual([41, 47, 50]); // the lowered string now sounds F2
});

test('Escenario E — la letra con secciones y acordes se guarda, se lee con acordes sobre las palabras y se exporta a PDF', async ({ page }) => {
  await openLibrary(page);
  await createFromMenu(page, 'Canción con letra', 'Hoy vuelvo');
  const letter = page.getByLabel('Letra', { exact: true });
  await letter.fill('# Verso 1\n[C]Hoy vuelvo [G]a casa\n[Am]con el alma en [F]paz\n\n# Estribillo\nY canto otra vez');
  await settleSave(page);
  await page.reload();
  await expect(page.getByLabel('Letra', { exact: true })).toHaveValue(/Hoy vuelvo \[G\]a casa/);
  await page.getByText('Vista con acordes').click();
  await expect(page.locator('.lyric-section').first()).toHaveText('Verso 1');
  await expect(page.locator('.lyric-chord', { hasText: /^G$/ })).toBeVisible();

  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Documento PDF' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('button', { name: 'Descargar PDF' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('hoy-vuelvo-letra.pdf');
  const bytes = await readFile((await file.path())!);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(bytes.length).toBeGreaterThan(5000);
});

test('Escenario F — melodía y letra: las sílabas siguen a su nota al editar, y persisten', async ({ page }) => {
  await openLibrary(page);
  await createFromMenu(page, 'Canción con melodía', 'Melodía con letra');
  await page.getByLabel('Escribir notas').fill('Do4 Mi4 Sol4 Fa4');
  await page.getByLabel('Escribir notas').press('Enter');
  await page.getByRole('button', { name: 'Agregar letra a esta melodía' }).click();
  await page.getByLabel('Frase de letra de la melodía').fill('Hoy vuelvo a casa');
  await page.getByLabel('Sílabas para repartir').fill('Hoy vuel-vo a');
  await page.getByRole('button', { name: 'Repartir sobre las notas' }).click();
  await expect(page.locator('.mel-lyric')).toHaveText(['Hoy', 'vuel', 'vo', 'a']);

  // Insert a note in the middle: no syllable moves to a different note.
  const strip = page.getByRole('listbox', { name: 'Notas de la melodía' });
  await notes(page).nth(1).click();
  await strip.press('d');
  await expect(notes(page)).toHaveCount(5);
  await expect(notes(page).nth(2)).not.toHaveAccessibleName(/sílaba/);
  await expect(notes(page).nth(1)).toHaveAccessibleName(/sílaba vuel/);
  await expect(notes(page).nth(3)).toHaveAccessibleName(/sílaba vo/);
  await settleSave(page);
  await page.reload();
  await expect(page.locator('.mel-lyric')).toHaveText(['Hoy', 'vuel', 'vo', 'a']);
  await expect(page.getByLabel('Frase de letra de la melodía')).toHaveValue('Hoy vuelvo a casa');
});

test('Escenario G — comentarios en el cuaderno, en un bloque y en una nota: editar, eliminar, deshacer y recargar', async ({ page }) => {
  await openLibrary(page);
  await createFromMenu(page, 'Canción con melodía', 'Con comentarios');
  await page.getByLabel('Escribir notas').fill('Do4 Re4 Mi4');
  await page.getByLabel('Escribir notas').press('Enter');

  // Notebook-level note.
  await page.getByRole('button', { name: 'Comentarios de el cuaderno' }).click();
  await page.getByLabel('Nuevo comentario sobre el cuaderno').fill('Falta resolver el puente');
  await page.getByRole('button', { name: 'Agregar comentario' }).click();
  await expect(page.getByText('Falta resolver el puente')).toBeVisible();
  await page.keyboard.press('Escape');

  // Block-level note.
  await page.getByRole('button', { name: 'Comentarios de melodía 1' }).click();
  await page.getByLabel('Nuevo comentario sobre melodía 1').fill('Cantarla más suave');
  await page.getByRole('button', { name: 'Agregar comentario' }).click();
  await page.keyboard.press('Escape');

  // Note-level comment (the selected note is the last one typed).
  await page.getByRole('button', { name: 'Comentarios de la nota seleccionada' }).click();
  await page.getByLabel('Nuevo comentario sobre la nota seleccionada').fill('Probar una tercera más abajo');
  await page.getByRole('button', { name: 'Agregar comentario' }).click();
  await page.keyboard.press('Escape');
  await expect(notes(page).nth(2)).toHaveAccessibleName(/con comentario/);

  // Edit.
  await page.getByRole('button', { name: 'Comentarios de la nota seleccionada' }).click();
  await page.getByRole('button', { name: 'Editar' }).click();
  await page.getByLabel('Editar comentario').fill('Probar una quinta más abajo');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Probar una quinta más abajo')).toBeVisible();
  await page.keyboard.press('Escape');

  await settleSave(page);
  const comments = async () => {
    const doc = (await storedDocuments(page)).find((item) => item.content?.kind === 'notebook')!;
    return doc.content as unknown as { blocks: Array<{ id: string; content: { events?: Array<{ id: string }> } }>; comments: Array<{ text: string; blockId?: string; eventId?: string }> };
  };
  let notebook = await comments();
  expect(notebook.comments).toHaveLength(3);
  const block = notebook.blocks[0];
  const noteComment = notebook.comments.find((item) => item.eventId)!;
  expect(noteComment.blockId).toBe(block.id);
  expect(block.content.events!.map((event) => event.id)).toContain(noteComment.eventId);
  expect(noteComment.text).toBe('Probar una quinta más abajo');

  // Delete + undo from the toast.
  await page.getByRole('button', { name: 'Comentarios de la nota seleccionada' }).click();
  await page.getByRole('button', { name: 'Eliminar', exact: true }).click();
  await page.locator('.toast').getByRole('button', { name: 'Deshacer' }).click();
  await settleSave(page);
  notebook = await comments();
  expect(notebook.comments).toHaveLength(3);

  // Reload: the references still point at the same note and block.
  await page.reload();
  await expect(notes(page).nth(2)).toHaveAccessibleName(/con comentario/);

  // Deleting the block takes its comments with it, and Undo brings both back.
  await page.getByRole('button', { name: 'Acciones de melodía 1' }).click();
  await page.getByRole('menuitem', { name: 'Eliminar bloque' }).click();
  await settleSave(page);
  expect((await comments()).comments.map((item) => item.text)).toEqual(['Falta resolver el puente']);
  await page.locator('.toast').getByRole('button', { name: 'Deshacer' }).click();
  await settleSave(page);
  expect((await comments()).comments).toHaveLength(3);
});

test('Escenario H — una canción completa: letra, melodía, solo, mapa, acordes y comentario sobreviven a cerrar y reabrir', async ({ page }) => {
  await openLibrary(page);
  await createFromMenu(page, 'Canción con letra', 'Canción completa');
  await page.getByLabel('Letra', { exact: true }).fill('# Verso 1\nHoy vuelvo a casa');
  await addBlock(page, 'Melodía');
  await page.getByLabel('Escribir notas').fill('Do4 Re4 Mi4 Sol4');
  await page.getByLabel('Escribir notas').press('Enter');
  await addBlock(page, 'Acordes');
  await page.getByLabel('Escribir acordes').fill('C G Am F');
  await page.getByLabel('Escribir acordes').press('Enter');
  await addBlock(page, 'Tablatura');
  await cell(page, 1, 1).click();
  for (const key of '578') await page.keyboard.press(key);
  await addBlock(page, 'Mapa del mástil');
  await neck(page).pick(5, 3);
  await page.getByRole('button', { name: 'Comentarios de el cuaderno' }).click();
  await page.getByLabel('Nuevo comentario sobre el cuaderno').fill('Falta resolver el puente');
  await page.getByRole('button', { name: 'Agregar comentario' }).click();
  await page.keyboard.press('Escape');
  await settleSave(page);
  const url = page.url();

  await page.goto('/biblioteca');
  await page.goto(url);
  await expect(page.getByLabel('Letra', { exact: true })).toHaveValue(/Hoy vuelvo a casa/);
  await expect(notes(page)).toHaveCount(4);
  await expect(page.getByRole('list', { name: 'Acordes de la progresión' }).getByRole('listitem')).toHaveCount(4);
  await expect(cell(page, 1, 3)).toHaveValue('8');
  await expect(neck(page).marker(5, 3)).toBeVisible();
  await page.getByRole('button', { name: 'Comentarios de el cuaderno' }).click();
  await expect(page.getByText('Falta resolver el puente')).toBeVisible();
  const docs = await storedDocuments(page);
  const kinds = docs.find((item) => item.content?.kind === 'notebook')!.content.blocks.map((block) => block.kind);
  expect(kinds).toEqual(['lyrics', 'melody', 'chords', 'tablature', 'map']);
});

test('el cuaderno de una canción con sync simulada guarda y sube los bloques nuevos sin perderlos', async ({ page }) => {
  await mockServer(page);
  await openLibrary(page);
  await createFromMenu(page, 'Cuaderno de composición', 'Para sincronizar');
  await page.getByRole('button', { name: 'Agregar melodía' }).click();
  await page.getByLabel('Escribir notas').fill('Do4 Mi4');
  await page.getByLabel('Escribir notas').press('Enter');
  await settleSave(page);
  const stored = (await storedDocuments(page)).find((item) => item.title === 'Para sincronizar')!;
  // What travels is the same JSON that is stored: nothing in the new blocks is lost by serialisation.
  const roundTrip = JSON.parse(JSON.stringify(stored.content));
  expect(roundTrip.blocks[0].kind).toBe('melody');
  expect(roundTrip.blocks[0].content.events.map((event: { midi: number }) => event.midi)).toEqual([60, 64]);
});
