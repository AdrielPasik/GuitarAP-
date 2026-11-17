import { expect, test, type Page } from '@playwright/test';
import { audioLog, audioProbe, audioState, cell, createFromMenu, openLibrary, settleSave, storedDocuments } from './helpers';

const addBlock = async (page: Page, entry: string) => {
  await page.getByRole('button', { name: 'Agregar bloque', exact: true }).first().click();
  await page.getByRole('menuitem', { name: new RegExp(`^${entry}`) }).click();
};
const notes = (page: Page) => page.getByRole('listbox', { name: 'Notas de la melodía' }).getByRole('option');
const typeNotes = async (page: Page, text: string) => {
  await page.getByLabel('Escribir notas').fill(text);
  await page.getByLabel('Escribir notas').press('Enter');
};
const library = (page: Page) => page.getByRole('link', { name: /Volver a la biblioteca/ }).click();
const openDoc = async (page: Page, title: string) => {
  await page.goto('/biblioteca');
  await page.locator('.lib-open', { hasText: title }).first().click();
  await expect(page.getByLabel('Título del material')).toHaveValue(title);
};
type Stored = { blocks: Array<{ id: string; kind: string; title?: string; text?: string; content?: Record<string, unknown> }>; comments?: Array<{ text: string; blockId?: string; eventId?: string }> };
const stored = async (page: Page, title: string) => {
  const doc = (await storedDocuments(page)).find((item) => item.title === title)!;
  return doc.content as unknown as Stored;
};
const blockMenu = (page: Page, label: string) => page.getByRole('button', { name: `Acciones de ${label}` });
const toastAction = (page: Page, name: string) => page.locator('.toast').getByRole('button', { name });

async function emptySong(page: Page, title: string) {
  await createFromMenu(page, 'Cuaderno de composición', title);
}

test('Escenario I — el texto escrito en Arreglos se mueve a Letra con un gesto, persiste y se deshace', async ({ page }) => {
  await openLibrary(page);
  await emptySong(page, 'Tema 1 FT Goti');
  await addBlock(page, 'Nota de estudio');
  await page.getByLabel('Nota de estudio').fill('Hoy vuelvo a empezar');
  await addBlock(page, 'Letra');
  await page.getByLabel('Nota de estudio').evaluate((node) => {
    const area = node as HTMLTextAreaElement;
    area.focus();
    area.setSelectionRange(0, area.value.length);
  });
  await blockMenu(page, 'texto 1').click();
  await page.getByRole('menuitem', { name: /^Mover el texto seleccionado a…/ }).click();
  await expect(page.getByRole('dialog', { name: 'Mover el texto seleccionado a…' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: /^Letra \(vacía\)/ }).click();

  await expect(page.getByLabel('Letra', { exact: true })).toHaveValue('Hoy vuelvo a empezar');
  await expect(page.getByLabel('Nota de estudio')).toHaveValue('');
  await settleSave(page);
  await page.reload();
  await expect(page.getByLabel('Letra', { exact: true })).toHaveValue('Hoy vuelvo a empezar');
  await expect(page.getByLabel('Nota de estudio')).toHaveValue('');

  // Moving it back is one step too: Ctrl+Z-style undo restores the lyrics exactly (the history lives while the song is open).
  await page.getByLabel('Letra', { exact: true }).evaluate((node) => {
    const area = node as HTMLTextAreaElement;
    area.focus();
    area.setSelectionRange(0, area.value.length);
  });
  await blockMenu(page, 'letra 2').click();
  await page.getByRole('menuitem', { name: /^Mover el texto seleccionado a…/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^Nota/ }).click();
  await expect(page.getByLabel('Letra', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Nota de estudio')).toHaveValue('Hoy vuelvo a empezar');
  await page.getByRole('button', { name: 'Deshacer', exact: true }).first().click();
  await expect(page.getByLabel('Letra', { exact: true })).toHaveValue('Hoy vuelvo a empezar');
  await expect(page.getByLabel('Nota de estudio')).toHaveValue('');
});

test('mover texto sin selección avisa en vez de adivinar', async ({ page }) => {
  await openLibrary(page);
  await emptySong(page, 'Sin selección');
  await addBlock(page, 'Nota de estudio');
  await addBlock(page, 'Letra');
  await page.getByLabel('Nota de estudio').fill('algo');
  await page.getByLabel('Nota de estudio').evaluate((node) => (node as HTMLTextAreaElement).setSelectionRange(2, 2));
  await blockMenu(page, 'texto 1').click();
  await page.getByRole('menuitem', { name: /^Copiar el texto seleccionado a…/ }).click();
  await expect(page.locator('.toast')).toContainText('Primero seleccioná');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('Escenario J — una melodía con comentarios se mueve a otra canción y llega completa; deshacer la devuelve', async ({ page }) => {
  await audioProbe(page);
  await openLibrary(page);
  await emptySong(page, 'Destino');
  await library(page);
  await emptySong(page, 'Origen');
  await page.getByRole('button', { name: 'Agregar melodía' }).click();
  await typeNotes(page, 'Do4 Re4:2 Mi4');
  await page.getByLabel('BPM propio de melodía').count();
  await page.getByRole('button', { name: 'Comentarios de melodía 1' }).click();
  await page.getByLabel('Nuevo comentario sobre melodía 1').fill('Cantarla suave');
  await page.getByRole('button', { name: 'Agregar comentario' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Comentarios de la nota seleccionada' }).click();
  await page.getByLabel('Nuevo comentario sobre la nota seleccionada').fill('Probar más abajo');
  await page.getByRole('button', { name: 'Agregar comentario' }).click();
  await page.keyboard.press('Escape');
  await settleSave(page);

  await blockMenu(page, 'melodía 1').click();
  await page.getByRole('menuitem', { name: /^Mover a otra canción…/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^Destino/ }).click();
  await expect(page.locator('.toast')).toContainText('Se movió a «Destino»');
  await expect(page.getByRole('heading', { name: 'Empezá tu material' })).toBeVisible();
  await settleSave(page);

  const destination = await stored(page, 'Destino');
  expect(destination.blocks.map((block) => block.kind)).toEqual(['melody']);
  const melody = destination.blocks[0].content as { events: Array<{ id: string; midi: number; beats: number }> };
  expect(melody.events.map((event) => [event.midi, event.beats])).toEqual([[60, 1], [62, 2], [64, 1]]);
  expect(destination.comments?.map((comment) => comment.text).sort()).toEqual(['Cantarla suave', 'Probar más abajo']);
  for (const comment of destination.comments ?? []) {
    expect(comment.blockId).toBe(destination.blocks[0].id);
    if (comment.eventId) expect(melody.events.some((event) => event.id === comment.eventId)).toBe(true);
  }
  expect((await stored(page, 'Origen')).blocks).toHaveLength(0);
  expect((await stored(page, 'Origen')).comments ?? []).toHaveLength(0); // no references left behind

  // Undo the move from the notice: it goes back, and the destination is clean again.
  await toastAction(page, 'Deshacer movimiento').click();
  await expect(page.getByRole('option').first()).toBeVisible();
  await settleSave(page);
  expect((await stored(page, 'Destino')).blocks).toHaveLength(0);
  expect((await stored(page, 'Origen')).blocks.map((block) => block.kind)).toEqual(['melody']);
  expect((await stored(page, 'Origen')).comments).toHaveLength(2);

  // Move it again and play it in its new home.
  await blockMenu(page, 'melodía 1').click();
  await page.getByRole('menuitem', { name: /^Mover a otra canción…/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^Destino/ }).click();
  await settleSave(page);
  await openDoc(page, 'Destino');
  await expect(notes(page)).toHaveCount(3);
  await page.getByRole('button', { name: 'Reproducir melodía' }).click();
  await expect.poll(async () => (await audioLog(page)).filter((entry) => entry.type === 'note').length).toBe(3);
  await expect.poll(async () => (await audioState(page)).state, { timeout: 8000 }).toBe('idle');
});

test('Escenario K — copiar una tablatura a otra canción deja el original intacto y la copia independiente', async ({ page }) => {
  await openLibrary(page);
  await emptySong(page, 'Otra canción');
  await library(page);
  await emptySong(page, 'Con el riff');
  await addBlock(page, 'Tablatura');
  await cell(page, 1, 1).click();
  for (const key of '578') await page.keyboard.press(key);
  await settleSave(page);
  await blockMenu(page, 'tablatura 1').click();
  await page.getByRole('menuitem', { name: /^Copiar a otra canción…/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^Otra canción/ }).click();
  await expect(page.locator('.toast')).toContainText('Se copió a «Otra canción»');
  await expect(cell(page, 1, 1)).toHaveValue('5'); // still here
  await settleSave(page);
  const original = await stored(page, 'Con el riff');
  expect(original.blocks).toHaveLength(1);

  await openDoc(page, 'Otra canción');
  await expect(cell(page, 1, 2)).toHaveValue('7');
  await cell(page, 1, 2).click();
  await page.keyboard.press('9');
  await settleSave(page);
  const copy = await stored(page, 'Otra canción');
  expect(copy.blocks[0].id).not.toBe(original.blocks[0].id);

  await openDoc(page, 'Con el riff');
  await expect(cell(page, 1, 2)).toHaveValue('7'); // the original never changed
});

test('Escenario L — si falla el guardado del destino, el bloque sigue en su lugar y nada queda a medias', async ({ page }) => {
  await openLibrary(page);
  await emptySong(page, 'Destino frágil');
  await library(page);
  await emptySong(page, 'Origen seguro');
  await page.getByRole('button', { name: 'Agregar melodía' }).click();
  await typeNotes(page, 'Do4 Mi4 Sol4');
  await settleSave(page);
  const before = JSON.stringify((await storedDocuments(page)).find((doc) => doc.title === 'Destino frágil'));

  await page.evaluate(() => {
    (window as unknown as { __GUITARAP_FAIL_TRANSFER: boolean }).__GUITARAP_FAIL_TRANSFER = true;
  });
  await blockMenu(page, 'melodía 1').click();
  await page.getByRole('menuitem', { name: /^Mover a otra canción…/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^Destino frágil/ }).click();
  await expect(page.locator('.toast')).toContainText('No se pudo mover');
  await expect(page.locator('.toast')).toContainText('sigue en esta canción');
  await expect(notes(page)).toHaveCount(3);
  await expect(page.locator('.save-state.saved')).toBeVisible();
  await page.waitForTimeout(1200);
  expect((await stored(page, 'Origen seguro')).blocks.map((block) => block.kind)).toEqual(['melody']);
  expect(JSON.stringify((await storedDocuments(page)).find((doc) => doc.title === 'Destino frágil'))).toBe(before);
});

test('reordenar: arrastrando, con Alt+flechas y desde el menú, sin perder datos', async ({ page }) => {
  await openLibrary(page);
  await emptySong(page, 'Orden');
  await page.getByRole('button', { name: 'Agregar nota' }).click();
  await page.getByLabel('Nota de estudio').fill('primero');
  await addBlock(page, 'Letra');
  await page.getByLabel('Letra', { exact: true }).fill('segundo');
  await addBlock(page, 'Acordes');
  await page.getByLabel('Escribir acordes').fill('C G');
  await page.getByLabel('Escribir acordes').press('Enter');
  const kinds = async () => (await page.locator('.blocks > .block-slot > .block').evaluateAll((nodes) => nodes.map((node) => node.className.match(/kind-(\w+)/)![1])));
  expect(await kinds()).toEqual(['text', 'lyrics', 'chords']);

  // Drag the chords above the note.
  await page.getByRole('button', { name: 'Reordenar acordes 3' }).dragTo(page.locator('#blocks-first, .block.kind-text').first(), { targetPosition: { x: 40, y: 4 } });
  await expect.poll(kinds).toEqual(['chords', 'text', 'lyrics']);

  // Keyboard: Alt+ArrowDown on the grip moves the block down one place.
  await page.getByRole('button', { name: 'Reordenar acordes 1' }).focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect.poll(kinds).toEqual(['text', 'chords', 'lyrics']);

  await settleSave(page);
  const saved = await stored(page, 'Orden');
  expect(saved.blocks.map((block) => block.kind)).toEqual(['text', 'chords', 'lyrics']);
  await page.reload();
  await expect.poll(kinds).toEqual(['text', 'chords', 'lyrics']);
  await expect(page.getByLabel('Letra', { exact: true })).toHaveValue('segundo');
});

test('secciones: crear, nombrar, mover con su contenido, duplicar, plegar, mover un bloque entre secciones e índice', async ({ page }) => {
  await openLibrary(page);
  await emptySong(page, 'Estructura');
  await page.getByRole('button', { name: 'Agregar sección' }).click();
  await page.getByLabel('Nombre de la sección 1').fill('Verso 1');
  await addBlock(page, 'Letra');
  await page.getByLabel('Letra', { exact: true }).fill('versos');
  await addBlock(page, 'Sección');
  await page.getByLabel('Nombre de la sección 3').fill('Estribillo');
  await addBlock(page, 'Melodía');
  await typeNotes(page, 'Do4 Mi4');
  await settleSave(page);
  const titles = () => page.locator('.section-title').evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value));
  expect(await titles()).toEqual(['Verso 1', 'Estribillo']);

  // Index: both sections and what is inside.
  await page.getByRole('button', { name: 'Índice' }).click();
  const outline = page.getByRole('navigation', { name: 'Índice de la canción' });
  await expect(outline.getByRole('button', { name: 'Estribillo' })).toBeVisible();
  await expect(outline.getByRole('button', { name: 'Letra' })).toBeVisible();

  // Move the whole second section up: its melody travels with it.
  await page.getByRole('button', { name: 'Acciones de la sección Estribillo' }).click();
  await page.getByRole('menuitem', { name: 'Subir la sección' }).click();
  expect(await titles()).toEqual(['Estribillo', 'Verso 1']);
  await settleSave(page);
  expect((await stored(page, 'Estructura')).blocks.map((block) => block.kind)).toEqual(['section', 'melody', 'section', 'lyrics']);

  // Fold it: its blocks are hidden but not deleted.
  await page.getByRole('button', { name: 'Plegar la sección Estribillo' }).click();
  await expect(page.getByRole('listbox', { name: 'Notas de la melodía' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Expandir la sección Estribillo' }).click();
  await expect(notes(page)).toHaveCount(2);

  // Move a block to another section from its menu.
  await blockMenu(page, 'melodía 2').click();
  await page.getByRole('menuitem', { name: /^Mover a otra sección…/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^Verso 1/ }).click();
  await settleSave(page);
  expect((await stored(page, 'Estructura')).blocks.map((block) => block.kind)).toEqual(['section', 'section', 'lyrics', 'melody']);

  // Duplicate the section with its content: new ids, same music.
  await page.getByRole('button', { name: 'Acciones de la sección Verso 1' }).click();
  await page.getByRole('menuitem', { name: 'Duplicar la sección' }).click();
  await settleSave(page);
  const copy = await stored(page, 'Estructura');
  expect(copy.blocks.map((block) => block.kind)).toEqual(['section', 'section', 'lyrics', 'melody', 'section', 'lyrics', 'melody']);
  expect(new Set(copy.blocks.map((block) => block.id)).size).toBe(7);
  expect((copy.blocks[4] as { title: string }).title).toBe('Verso 1 (copia)');
});

test('Escenario M y N — Letra + melodía: bloques vinculados por referencia, editables juntos, con la nota que suena resaltada', async ({ page }) => {
  await audioProbe(page);
  await openLibrary(page);
  await createFromMenu(page, 'Canción con letra', 'Hoy vuelvo');
  await page.getByLabel('Letra', { exact: true }).fill('# Verso 1\nHoy vuelvo a empezar');
  await addBlock(page, 'Melodía');
  await typeNotes(page, 'Do4 Mi4 Sol4 Fa4');

  // Link the melody with the lyrics: both stay separate blocks, the view just shows them together.
  await blockMenu(page, 'melodía 2').click();
  await page.getByRole('menuitem', { name: /^Vincular con una letra…/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Hoy vuelvo a empezar/ }).click();
  const vocal = page.getByRole('region', { name: /^Letra \+ melodía/ });
  await expect(vocal).toBeVisible();
  await settleSave(page);
  const linked = await stored(page, 'Hoy vuelvo');
  expect(linked.blocks.map((block) => block.kind)).toEqual(['lyrics', 'melody']); // nothing was duplicated
  expect((linked.blocks[1].content as { lyricsBlockId?: string }).lyricsBlockId).toBe(linked.blocks[0].id);

  // Edit both sides without leaving the view.
  await vocal.getByLabel('Letra', { exact: true }).fill('# Verso 1\nHoy vuelvo a empezar de nuevo');
  await vocal.getByLabel('Escribir notas').fill('Re4');
  await vocal.getByLabel('Escribir notas').press('Enter');
  await expect(vocal.locator('.mel-chip')).toHaveCount(5);

  // Playback inside the view: the active note is highlighted, pause/resume/stop keep the data.
  await vocal.getByRole('spinbutton', { name: 'BPM de melodía' }).fill('40');
  await vocal.getByRole('spinbutton', { name: 'BPM de melodía' }).press('Enter');
  await vocal.getByRole('button', { name: 'Reproducir melodía' }).click();
  await expect(vocal.locator('.mel-chip.playing')).toHaveCount(1);
  await vocal.getByRole('button', { name: 'Pausar melodía' }).click();
  await expect.poll(async () => (await audioState(page)).state).toBe('paused');
  await vocal.getByRole('button', { name: 'Continuar melodía' }).click();
  await expect.poll(async () => (await audioState(page)).state).toBe('playing');
  await vocal.getByRole('button', { name: 'Detener melodía' }).click();
  await expect.poll(async () => (await audioState(page)).state).toBe('idle');
  expect((await audioState(page)).voices).toBe(0);

  await settleSave(page);
  await page.reload();
  const after = await stored(page, 'Hoy vuelvo');
  expect((after.blocks[0].content as { text: string }).text).toContain('de nuevo');
  expect((after.blocks[1].content as { events: unknown[] }).events).toHaveLength(5);
  await expect(page.getByRole('region', { name: /^Letra \+ melodía/ })).toHaveCount(0); // a view, not data: closed after a reload

  // Reopen it from either block, then unlink: both blocks survive independently.
  await blockMenu(page, 'letra 1').click();
  await page.getByRole('menuitem', { name: /^Ver con su melodía/ }).click();
  await expect(page.getByRole('region', { name: /^Letra \+ melodía/ })).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar esta vista' }).click();
  await blockMenu(page, 'melodía 2').click();
  await page.getByRole('menuitem', { name: /^Quitar el vínculo con la letra/ }).click();
  await settleSave(page);
  const unlinked = await stored(page, 'Hoy vuelvo');
  expect(unlinked.blocks.map((block) => block.kind)).toEqual(['lyrics', 'melody']);
  expect('lyricsBlockId' in (unlinked.blocks[1].content as object)).toBe(false);
  expect((unlinked.blocks[1].content as { events: unknown[] }).events).toHaveLength(5);
});

test('en Práctica, la letra y su melodía vinculada se leen juntas', async ({ page }) => {
  await openLibrary(page);
  await createFromMenu(page, 'Canción con letra', 'Para leer');
  await page.getByLabel('Letra', { exact: true }).fill('Hoy vuelvo');
  await addBlock(page, 'Melodía');
  await typeNotes(page, 'Do4 Mi4');
  await blockMenu(page, 'melodía 2').click();
  await page.getByRole('menuitem', { name: /^Vincular con una letra…/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Hoy vuelvo/ }).click();
  await settleSave(page);
  await page.getByRole('link', { name: 'Practicar' }).click();
  const vocal = page.getByRole('region', { name: /^Letra \+ melodía/ });
  await expect(vocal).toBeVisible();
  await expect(vocal.locator('.mel-chip')).toHaveCount(2);
  await expect(vocal.getByRole('button', { name: 'Cerrar esta vista' })).toHaveCount(0);
});
