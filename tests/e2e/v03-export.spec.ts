import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { cell, neck, openLibrary, settleSave } from './helpers';

async function mixedNotebook(page: Page) {
  await openLibrary(page);
  await page.getByRole('button', { name: 'Nuevo', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Escala y frase' }).click();
  await page.waitForURL(/\/material\//);
  await page.getByLabel('Título del material').fill('Do jónico');
  for (const fret of [8, 12, 3, 7]) await neck(page).pick(5, fret);
  await page.getByRole('button', { name: 'Agregar posición' }).click();
  for (const fret of [10, 1]) await neck(page).pick(5, fret);
  await cell(page, 1, 1).click();
  for (const key of '5787') await page.keyboard.press(key);
  await page.getByRole('button', { name: 'Agregar bloque', exact: true }).first().click();
  await page.getByRole('menuitem', { name: 'Nota de estudio' }).click();
  await page.getByLabel('Nota de estudio').fill('Alternate picking a 60 BPM');
  await settleSave(page);
}

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Exportar' });
const preview = (page: Page) => dialog(page).locator('.export-sheet');

/** Inspects a downloaded PNG in the browser: size, how much is near-black, and whether a color is present. */
async function inspectPng(page: Page, path: string, rgb: [number, number, number]) {
  const base64 = (await readFile(path)).toString('base64');
  return page.evaluate(
    async ({ data, target }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, image.width, image.height).data;
      let dark = 0;
      let match = 0;
      let transparent = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        const [r, g, b, a] = [pixels[index], pixels[index + 1], pixels[index + 2], pixels[index + 3]];
        if (a === 0) transparent += 1;
        if (a > 200 && r < 40 && g < 40 && b < 40) dark += 1;
        if (a > 200 && Math.abs(r - target[0]) < 14 && Math.abs(g - target[1]) < 14 && Math.abs(b - target[2]) < 14) match += 1;
      }
      const total = pixels.length / 4;
      return { width: image.width, height: image.height, darkShare: dark / total, matchPixels: match, transparentShare: transparent / total };
    },
    { data: base64, target: rgb },
  );
}

test('Escenario E — se exporta solo el mapa elegido, con vista previa y sin controles', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mixedNotebook(page);
  await page.getByTestId('map-canvas').click({ position: { x: 4, y: 4 }, force: true }).catch(() => undefined);
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await expect(dialog(page)).toBeVisible();

  // Everything by default; narrow it to the first map only.
  await expect(preview(page).locator('.fb-svg')).toHaveCount(2); // two positions of the map
  await expect(preview(page).locator('.tb-system')).toHaveCount(1);
  await dialog(page).getByRole('checkbox', { name: /Tablatura/ }).uncheck();
  await dialog(page).getByRole('checkbox', { name: /Nota|Alternate/ }).uncheck();
  await dialog(page).getByLabel(/Qué exportar de Mapa/).selectOption({ label: 'Mapa completo (todas las notas)' });
  await expect(preview(page).locator('.tb-system')).toHaveCount(0);
  await expect(preview(page).locator('.fb-svg')).toHaveCount(1);
  await expect(preview(page).locator('button, input, select, [role="menu"]')).toHaveCount(0); // no interface in the sheet
  await expect(preview(page).getByText('Alternate picking')).toHaveCount(0);
  await expect(preview(page).getByText('Tónica')).toBeVisible(); // the legend travels with the figure
  await expect(preview(page).locator('[data-testid^="marker-"][data-role="third"]')).toHaveCount(1);
  await expect(dialog(page).getByText('do-jonico-escala-completa.png')).toBeVisible();
  await dialog(page).screenshot({ path: test.info().outputPath('dialogo-exportar.png') });

  const download = page.waitForEvent('download');
  await dialog(page).getByRole('button', { name: 'Descargar PNG' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('do-jonico-escala-completa.png');
  const path = (await file.path())!;
  // Pixel truth: the root color (#1d5fd1) is in the image, nothing is a black block, and it is a single wide figure.
  const png = await inspectPng(page, path, [0x1d, 0x5f, 0xd1]);
  expect(png.matchPixels).toBeGreaterThan(200);
  expect(png.darkShare).toBeLessThan(0.08);
  expect(png.width).toBeGreaterThanOrEqual(1900);
  expect(png.height / png.width).toBeLessThan(0.6); // a lone map: the tablature would make it much taller
  await expect(page.getByRole('status').filter({ hasText: 'Se descargó do-jonico-escala-completa.png' })).toBeVisible();
});

test('PNG transparente y tema oscuro se respetan en el archivo', async ({ page }) => {
  await mixedNotebook(page);
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await dialog(page).getByRole('checkbox', { name: /Tablatura/ }).uncheck();
  await dialog(page).getByRole('checkbox', { name: /Nota|Alternate/ }).uncheck();
  await dialog(page).getByRole('button', { name: /Presentación/ }).click();
  await dialog(page).getByRole('button', { name: 'Transparente' }).click();
  const download = page.waitForEvent('download');
  await dialog(page).getByRole('button', { name: 'Descargar PNG' }).click();
  const transparent = await inspectPng(page, (await (await download).path())!, [0x1d, 0x5f, 0xd1]);
  expect(transparent.transparentShare).toBeGreaterThan(0.05);

  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await dialog(page).getByRole('checkbox', { name: /Tablatura/ }).uncheck();
  await dialog(page).getByRole('button', { name: /Presentación/ }).click();
  await dialog(page).getByRole('button', { name: 'Oscuro' }).click();
  await expect(preview(page)).toHaveAttribute('data-theme', 'dark');
  const darkDownload = page.waitForEvent('download');
  await dialog(page).getByRole('button', { name: 'Descargar PNG' }).click();
  const dark = await inspectPng(page, (await (await darkDownload).path())!, [0x7a, 0xa8, 0xff]); // dark theme root blue
  expect(dark.matchPixels).toBeGreaterThan(100);
});

test('Escenario F — el PDF elige su contenido, reparte en páginas y exporta una sola posición', async ({ page }) => {
  await mixedNotebook(page);
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Documento PDF' }).click();
  await expect(dialog(page).getByText('do-jonico-cuaderno.pdf')).toBeVisible();
  // The whole document: both positions, the tablature and the note.
  await expect(preview(page).locator('.fb-svg')).toHaveCount(2);
  await expect(preview(page).locator('.tb-system')).toHaveCount(1);
  await expect(preview(page).getByText('Alternate picking a 60 BPM')).toBeVisible();
  await expect(preview(page).locator('.harmony-legend')).toHaveCount(2);
  const full = page.waitForEvent('download');
  await dialog(page).getByRole('button', { name: 'Descargar PDF' }).click();
  const fullFile = await full;
  expect(fullFile.suggestedFilename()).toBe('do-jonico-cuaderno.pdf');
  const bytes = (await readFile((await fullFile.path())!)).toString('latin1');
  expect(bytes.startsWith('%PDF-')).toBe(true);
  const pages = (bytes.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
  expect(pages).toBeGreaterThanOrEqual(1);
  expect(bytes).toContain('/Title');

  // A single position: only that figure, and a file named after it.
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Documento PDF' }).click();
  await dialog(page).getByRole('checkbox', { name: /Tablatura/ }).uncheck();
  await dialog(page).getByRole('checkbox', { name: /Nota|Alternate/ }).uncheck();
  await dialog(page).getByLabel(/Qué exportar de Mapa/).selectOption({ label: 'Solo «Posición 2»' });
  await expect(preview(page).locator('.fb-svg')).toHaveCount(1);
  await expect(preview(page).locator('[data-testid^="marker-"]')).toHaveCount(2); // frets 10 and 1 only
  await expect(preview(page).locator('[data-testid="marker-5-8"]')).toHaveCount(0);
  const single = page.waitForEvent('download');
  await dialog(page).getByRole('button', { name: 'Descargar PDF' }).click();
  expect((await single).suggestedFilename()).toBe('do-jonico-mapa-posicion-2.pdf');
});

test('el aviso de contenido muy alto aparece solo para PNG y no bloquea la exportación', async ({ page }) => {
  await mixedNotebook(page);
  for (let index = 0; index < 8; index += 1) {
    await page.getByRole('button', { name: 'Agregar bloque', exact: true }).first().click();
    await page.getByRole('menuitem', { name: 'Mapa del mástil' }).click();
  }
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await expect(dialog(page).getByText(/muy alto para una sola imagen/)).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Documento PDF' }).click();
  await expect(dialog(page).getByText(/muy alto para una sola imagen/)).toHaveCount(0);
  await expect(dialog(page).getByRole('button', { name: 'Descargar PDF' })).toBeEnabled();
});

test('Escenario H — Práctica: intervalos locales, foco, zoom y exportación sin modificar el documento', async ({ page }) => {
  await mixedNotebook(page);
  const revision = () =>
    page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const request = indexedDB.open('guitarap');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const read = request.result.transaction('documents').objectStore('documents').getAll();
            read.onsuccess = () => {
              request.result.close();
              resolve(Math.max(...read.result.map((item: { rev: number }) => item.rev)));
            };
          };
        }),
    );
  const before = await revision();
  await page.getByRole('link', { name: 'Practicar' }).click();
  await page.waitForURL(/\/practica\//);
  await page.getByRole('tab', { name: 'Posición 1' }).click();
  await expect(page.getByTestId('map-canvas').getByTestId('marker-5-8')).toBeVisible();

  await page.getByRole('button', { name: 'Intervalos', exact: true }).first().click();
  await expect(page.getByTestId('map-canvas').getByTestId('marker-5-12')).toContainText('3');
  await page.getByRole('group', { name: 'Resaltar' }).getByRole('button', { name: 'Tríada' }).first().click();
  await expect(page.getByTestId('map-canvas').getByTestId('marker-5-7')).toHaveClass(/dim/);
  await page.getByRole('button', { name: 'Aumentar tamaño' }).click();

  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(preview(page).locator('.fb-svg').first()).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Modo foco' }).click();
  await expect(page.getByRole('banner')).toBeHidden();
  await expect(page.getByTestId('map-canvas').getByTestId('marker-5-12')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('banner')).toBeVisible();
  expect(await revision()).toBe(before); // reading changed nothing

  // Back in the editor the saved reading is still the original one: the practice choices were local.
  await page.getByRole('link', { name: 'Editar' }).click();
  await expect(page.getByRole('button', { name: 'Notas', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
