import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { audioProbe, createFromMenu, openLibrary, settleSave, storedDocuments } from './helpers';

const notes = (page: Page) => page.getByRole('listbox', { name: 'Notas de la melodía' }).getByRole('option');

/** A notebook as v0.3 stored it: a map with reading preferences, no meta, no comments. */
const v03Notebook = () => ({
  id: 'v03-notebook',
  nodeId: null,
  type: 'tablature',
  title: 'Cuaderno v0.3',
  rev: 7,
  createdAt: 1000,
  updatedAt: 5000,
  content: {
    kind: 'notebook',
    version: 1,
    blocks: [
      {
        id: 'b-map',
        kind: 'map',
        title: 'Do jónico',
        content: {
          tuning: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'],
          maxFret: 12,
          root: 0,
          notation: 'notes',
          latin: true,
          selectedPositionId: 'p1',
          positions: [{ id: 'p1', name: 'Posición 1', notes: [{ string: 5, fret: 8 }, { string: 5, fret: 10 }] }],
          baseNotes: [{ string: 5, fret: 8 }, { string: 5, fret: 10 }],
          view: { labels: 'both', guide: true },
        },
      },
      { id: 'b-text', kind: 'text', style: 'note', text: 'Empezar lento' },
      // A block type from a future version: it must be shown as a placeholder and stay exactly as it is.
      { id: 'b-future', kind: 'hologram', title: 'Del futuro', content: { anything: [1, 2, 3] } },
    ],
  },
});

async function seed(page: Page, documents: object[]) {
  await openLibrary(page);
  await page.evaluate(
    (items) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('guitarap');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const tx = request.result.transaction('documents', 'readwrite');
          items.forEach((item) => tx.objectStore('documents').put(item));
          tx.oncomplete = () => {
            request.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    documents,
  );
}

test('Escenario I — un cuaderno de v0.3 (y un bloque de una versión futura) abre sin cambios: solo mirar no escribe nada', async ({ page }) => {
  const doc = v03Notebook();
  await seed(page, [doc]);
  const before = JSON.stringify((await storedDocuments(page)).find((item) => item.id === doc.id));
  await page.goto(`/material/${doc.id}`);
  await expect(page.getByLabel('Título del material')).toHaveValue('Cuaderno v0.3');
  await expect(page.getByTestId('marker-5-8')).toBeVisible();
  await expect(page.getByText('Este bloque viene de una versión más nueva')).toBeVisible();
  await expect(page.getByLabel('Nota de estudio')).toHaveValue('Empezar lento');
  // Practice reads the same notebook without crashing on the unknown block, and exporting skips it safely.
  await page.goto(`/practica/${doc.id}`);
  await expect(page.getByText('Este bloque viene de una versión más nueva')).toBeVisible();
  await page.waitForTimeout(1500);
  expect(JSON.stringify((await storedDocuments(page)).find((item) => item.id === doc.id))).toBe(before);

  // Editing the known blocks keeps the unknown one intact.
  await page.goto(`/material/${doc.id}`);
  await page.getByLabel('Nota de estudio').fill('Empezar muy lento');
  await settleSave(page);
  const after = (await storedDocuments(page)).find((item) => item.id === doc.id)!;
  const blocks = after.content.blocks as Array<{ kind: string; content?: unknown; text?: string }>;
  expect(blocks.map((block) => block.kind)).toEqual(['map', 'text', 'hologram']);
  expect(blocks[2].content).toEqual({ anything: [1, 2, 3] });
  expect(blocks[1].text).toBe('Empezar muy lento');
});

test('Escenario L — la copia de seguridad lleva letra, melodía, acordes, comentarios y datos de la canción, y se restaura aislada', async ({ page, browser }) => {
  await openLibrary(page);
  await createFromMenu(page, 'Canción con letra', 'Para respaldar');
  await page.getByLabel('Letra', { exact: true }).fill('# Verso 1\n[C]Hoy vuelvo');
  await page.getByRole('button', { name: 'Agregar bloque', exact: true }).first().click();
  await page.getByRole('menuitem', { name: /^Melodía/ }).click();
  await page.getByLabel('Escribir notas').fill('Do4 Re4 Mi4');
  await page.getByLabel('Escribir notas').press('Enter');
  await page.getByRole('button', { name: 'Agregar bloque', exact: true }).first().click();
  await page.getByRole('menuitem', { name: /^Acordes/ }).click();
  await page.getByLabel('Escribir acordes').fill('C G Am F');
  await page.getByLabel('Escribir acordes').press('Enter');
  await page.getByRole('button', { name: 'Tonalidad del cuaderno', exact: true }).click();
  await page.getByLabel('Tonalidad principal').selectOption('C:major');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Comentarios de la nota seleccionada' }).click().catch(() => undefined);
  await page.getByRole('button', { name: 'Comentarios de el cuaderno' }).click();
  await page.getByLabel('Nuevo comentario sobre el cuaderno').fill('Falta resolver el puente');
  await page.getByRole('button', { name: 'Agregar comentario' }).click();
  await page.keyboard.press('Escape');
  await settleSave(page);

  await page.goto('/configuracion/copias');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar copia de seguridad' }).click();
  const file = await (await download).path();
  const backup = JSON.parse(await readFile(file!, 'utf8')) as {
    documents: Array<{ content: { blocks: Array<{ kind: string; content: Record<string, unknown> }>; meta?: { key?: unknown }; comments?: Array<{ text: string }> } }>;
    versions: unknown[];
  };
  const content = backup.documents[0].content;
  expect(content.blocks.map((block) => block.kind)).toEqual(['lyrics', 'melody', 'chords']);
  expect((content.blocks[1].content as { events: Array<{ midi: number }> }).events.map((event) => event.midi)).toEqual([60, 62, 64]);
  expect((content.blocks[2].content as { items: Array<{ symbol: string }> }).items.map((item) => item.symbol)).toEqual(['C', 'G', 'Am', 'F']);
  expect(content.meta?.key).toEqual({ tonic: 'C', mode: 'major' });
  expect(content.comments?.map((comment) => comment.text)).toEqual(['Falta resolver el puente']);
  expect(backup.versions.length).toBeGreaterThanOrEqual(1);

  const isolated = await browser.newContext();
  const other = await isolated.newPage();
  await other.goto('/configuracion/copias');
  await other.getByLabel('Archivo de copia de seguridad').setInputFiles(file!);
  await other.getByRole('button', { name: 'Importar', exact: true }).click();
  await expect(other.getByText('La copia se importó.')).toBeVisible();
  await other.goto('/biblioteca');
  await other.locator('.lib-open', { hasText: 'Para respaldar' }).click();
  await expect(notes(other)).toHaveCount(3);
  await expect(other.getByLabel('Letra', { exact: true })).toHaveValue(/Hoy vuelvo/);
  await other.getByRole('button', { name: 'Comentarios de el cuaderno' }).click();
  await expect(other.getByText('Falta resolver el puente')).toBeVisible();
  await isolated.close();
});

test('el historial no se llena de versiones al escribir una letra larga', async ({ page }) => {
  await openLibrary(page);
  await createFromMenu(page, 'Canción con letra', 'Letra larga');
  const letter = page.getByLabel('Letra', { exact: true });
  for (let line = 0; line < 12; line += 1) {
    await letter.press('End');
    await letter.pressSequentially(`Línea ${line} de la letra\n`, { delay: 5 });
    await page.waitForTimeout(250);
  }
  await settleSave(page);
  const versions = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const request = indexedDB.open('guitarap');
        request.onsuccess = () => {
          const count = request.result.transaction('versions').objectStore('versions').count();
          count.onsuccess = () => resolve(count.result);
        };
      }),
  );
  expect(versions).toBeLessThanOrEqual(3);
});

test('Escenario K — tema oscuro, movimiento reducido y efectos apagados: las ilustraciones no bloquean ni se mueven', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openLibrary(page);
  const hero = page.locator('.lib-hero');
  await expect(hero).toBeVisible();
  // Decoration never intercepts a click.
  expect(await page.locator('.studio-scene').first().evaluate((node) => getComputedStyle(node).pointerEvents)).toBe('none');
  // With reduced motion nothing animates.
  const animations = await page.locator('.art-float').first().evaluate((node) => getComputedStyle(node).animationName);
  expect(animations).toBe('none');

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.reload();
  expect(await page.locator('.art-float').first().evaluate((node) => getComputedStyle(node).animationName)).toBe('float');
  // Turning the decorative effects off hides them completely.
  await page.goto('/configuracion/apariencia');
  await page.getByLabel(/Ilustraciones decorativas/).uncheck();
  await page.goto('/biblioteca');
  await expect(page.locator('.studio-scene').first()).toBeHidden();
  await page.goto('/configuracion/apariencia');
  await page.getByLabel(/Ilustraciones decorativas/).check();
  await page.getByLabel(/Movimiento suave/).uncheck();
  await page.goto('/biblioteca');
  expect(await page.locator('.art-float').first().evaluate((node) => getComputedStyle(node).animationName)).toBe('none');

  // The writing surface stays calm: no scene behind a melody.
  await page.getByRole('button', { name: 'Nueva melodía' }).click();
  await expect(page.getByLabel('Escribir notas')).toBeVisible();
  // The song header may carry the scene (it sits behind the title, never behind the music): the writing area stays calm.
  await expect(page.locator('.studio-scene:visible:not(.doc-head .studio-scene)')).toHaveCount(0);

  // Dark theme keeps the music readable.
  await page.getByRole('button', { name: 'Activar modo oscuro' }).click();
  await page.getByLabel('Escribir notas').fill('Do4 Re4');
  await page.getByLabel('Escribir notas').press('Enter');
  const chip = notes(page).first();
  const [background, color] = await chip.evaluate((node) => [getComputedStyle(node).backgroundColor, getComputedStyle(node).color]);
  expect(background).not.toBe(color);
});

test('el sonido y la reproducción no se activan solos al abrir un documento ni al navegar', async ({ page }) => {
  await audioProbe(page);
  await openLibrary(page);
  await createFromMenu(page, 'Canción con melodía', 'Silencio');
  await page.getByLabel('Escribir notas').fill('Do4 Re4 Mi4');
  await page.getByLabel('Escribir notas').press('Enter');
  await settleSave(page);
  await page.reload();
  await page.getByRole('link', { name: 'Practicar' }).click();
  await page.waitForTimeout(800);
  const log = await page.evaluate(() => (window as unknown as { __guitarapAudioLog?: unknown[] }).__guitarapAudioLog ?? []);
  expect(log).toHaveLength(0);
  const audio = await page.evaluate(() => (window as unknown as { __guitarapAudio: { state: string } }).__guitarapAudio.state);
  expect(audio).toBe('idle');
});
