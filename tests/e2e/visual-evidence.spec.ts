import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { test, type Page } from '@playwright/test';
import { cell, createFolder, mockServer, neck, openLibrary, settleSave } from './helpers';

/**
 * Visual evidence for design review. It only runs on demand:
 *   CAPTURE_EVIDENCE=1 npx playwright test tests/e2e/visual-evidence.spec.ts
 * Screenshots and the exported files go to docs/evidence/v0.3. No real account is used.
 */
const enabled = Boolean(process.env.CAPTURE_EVIDENCE);
const out = path.resolve('docs/evidence/v0.3');
const shot = async (page: Page, name: string, fullPage = false) => {
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage });
};
const row = (page: Page, text: string) => page.locator('.lib-row', { hasText: text });
const highlight = (page: Page, name: string) => page.getByRole('group', { name: 'Resaltar' }).getByRole('button', { name, exact: true });

async function newMaterial(page: Page, entry: string, title: string) {
  await page.getByRole('button', { name: 'Nuevo', exact: true }).click();
  await page.getByRole('menuitem', { name: entry }).click();
  await page.waitForURL(/\/material\//);
  await page.getByLabel('Título del material').fill(title);
}
async function generateScale(page: Page, scale: string) {
  await page.getByRole('button', { name: 'Generar escala' }).click();
  await page.getByLabel('Tipo de escala').selectOption(scale);
  await page.getByRole('button', { name: 'Agregar a la posición' }).click();
}

test.describe('evidence v0.3', () => {
  test.skip(!enabled, 'set CAPTURE_EVIDENCE=1 to capture');
  test.setTimeout(300_000);

  test('captures the refined product', async ({ page }) => {
    await mkdir(out, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockServer(page);
    await openLibrary(page);

    // Escalas / Modos, with realistic scale materials.
    await createFolder(page, 'Escalas');
    await row(page, 'Escalas').locator('.lib-open').click();
    await createFolder(page, 'Modos');
    await newMaterial(page, 'Mapa de escala', 'Do jónico');
    await generateScale(page, 'Mayor');
    await page.getByRole('button', { name: 'Agregar posición' }).click();
    for (const [s, f] of [[5, 8], [5, 10], [5, 12], [4, 8], [4, 10], [3, 7], [3, 9], [3, 10], [2, 7], [2, 9], [1, 8], [1, 10], [0, 8], [0, 10], [0, 12]]) await neck(page).pick(s, f);
    await page.getByRole('tab', { name: 'Posición 2' }).dblclick();
    await page.getByLabel('Nombre de la posición').fill('Posición 8-12');
    await page.keyboard.press('Enter');
    await page.getByRole('tab', { name: 'Posición 1' }).click();
    await settleSave(page);
    const doJonico = page.url();
    await page.getByRole('link', { name: /Volver a la biblioteca/ }).click();
    await newMaterial(page, 'Mapa de escala', 'Pentatónica menor');
    await page.getByRole('button', { name: /^Tónica: / }).click();
    await page.getByRole('menuitemradio', { name: 'La', exact: true }).click();
    await generateScale(page, 'Pentatónica menor');
    await settleSave(page);
    await page.getByRole('link', { name: /Volver a la biblioteca/ }).click();
    await shot(page, '01-biblioteca-escalas');
    await row(page, 'Modos').locator('.lib-open').click();
    await newMaterial(page, 'Cuaderno vacío', 'Dórico');
    await page.getByRole('button', { name: 'Agregar mapa' }).click();
    await settleSave(page);
    await page.getByRole('link', { name: /Volver a la biblioteca/ }).click();
    await shot(page, '02-carpeta-anidada');

    // The notebook: a single map, and an empty one.
    await page.goto(doJonico);
    await shot(page, '03-cuaderno-do-jonico-un-mapa');
    await page.goto('/biblioteca');
    await newMaterial(page, 'Cuaderno vacío', 'Cuaderno nuevo');
    await shot(page, '04-cuaderno-vacio');
    await page.getByRole('button', { name: 'Agregar mapa' }).click();
    await page.getByRole('button', { name: 'Agregar bloque', exact: true }).first().click();
    await shot(page, '05-menu-agregar-bloques');
    await page.keyboard.press('Escape');

    // Reading the map: notes, intervals, both, colors, triad, seventh.
    await page.goto(doJonico);
    await page.getByRole('button', { name: 'Notas', exact: true }).click();
    await shot(page, '06-mapa-notas');
    await page.getByRole('button', { name: 'Intervalos', exact: true }).click();
    await shot(page, '07-mapa-intervalos');
    await page.getByRole('button', { name: 'Ambos' }).click();
    await shot(page, '08-mapa-notas-e-intervalos');
    await highlight(page, 'Tríada').click();
    await shot(page, '09-mapa-triada-resaltada');
    await highlight(page, 'Séptima').click();
    await shot(page, '10-mapa-septima-resaltada');
    await highlight(page, 'Todo').click();
    await page.getByRole('button', { name: 'Conjunta' }).click();
    await shot(page, '11-posiciones-conjunta');
    await page.getByRole('button', { name: 'Individual' }).click();

    // Export: dialog, preview, files.
    await page.getByRole('button', { name: 'Exportar', exact: true }).click();
    await shot(page, '12-dialogo-exportar');
    await page.getByRole('dialog').locator('.export-preview').screenshot({ path: path.join(out, '13-vista-previa-png.png') });
    const png = page.waitForEvent('download');
    await page.getByRole('dialog').getByRole('button', { name: 'Descargar PNG' }).click();
    const pngFile = await png;
    await copyFile((await pngFile.path())!, path.join(out, `14a-archivo-${pngFile.suggestedFilename()}`));
    await page.getByRole('button', { name: 'Exportar', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Documento PDF' }).click();
    await page.getByRole('dialog').getByLabel(/Qué exportar de/).selectOption({ label: 'Solo «Posición 1»' });
    const pdf = page.waitForEvent('download');
    await page.getByRole('dialog').getByRole('button', { name: 'Descargar PDF' }).click();
    const pdfFile = await pdf;
    await copyFile((await pdfFile.path())!, path.join(out, `14b-archivo-${pdfFile.suggestedFilename()}`));

    // A mixed notebook, practice and settings.
    await page.goto('/biblioteca');
    await newMaterial(page, 'Escala y frase', 'Pentatónica y lick');
    for (const fret of [5, 8, 10, 12]) await neck(page).pick(5, fret);
    await cell(page, 1, 1).click();
    for (const key of '578787') await page.keyboard.press(key);
    await page.getByRole('button', { name: 'Agregar bloque', exact: true }).first().click();
    await page.getByRole('menuitem', { name: 'Nota de estudio' }).click();
    await page.getByLabel('Nota de estudio').fill('Alternate picking a 60 BPM. Subir de a 4 BPM cuando salga limpio.');
    await settleSave(page);
    await page.mouse.move(2, 2);
    await shot(page, '15-cuaderno-mapa-y-tablatura', true);
    await page.goto(doJonico.replace('/material/', '/practica/'));
    await page.getByRole('button', { name: 'Ambos' }).click();
    await highlight(page, 'Tríada').click();
    await shot(page, '16-practica-con-intervalos');
    await page.getByRole('button', { name: 'Modo foco' }).click();
    await shot(page, '17-practica-modo-foco');
    await page.keyboard.press('Escape');
    await page.goto('/configuracion/cuenta');
    await shot(page, '18-configuracion');
    await page.goto('/biblioteca');
    await shot(page, '19-tema-claro');
    await page.goto(doJonico);
    await page.getByRole('button', { name: 'Activar modo oscuro' }).click();
    await page.getByRole('button', { name: 'Ambos' }).click();
    await shot(page, '20-tema-oscuro');
    await page.getByRole('button', { name: 'Exportar', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: /Presentación/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Oscuro' }).click();
    await shot(page, '21-exportar-tema-oscuro');
  });
});
