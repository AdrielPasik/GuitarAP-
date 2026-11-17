import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { test, type Page } from '@playwright/test';
import { audioProbe, cell, createFromMenu, neck, openLibrary, settleSave } from './helpers';

/**
 * Visual evidence for v0.4. Runs only on demand:
 *   CAPTURE_EVIDENCE=1 npx playwright test tests/e2e/visual-evidence-v04.spec.ts
 * Everything is made with a throwaway browser profile and realistic content typed through the real interface.
 */
const enabled = Boolean(process.env.CAPTURE_EVIDENCE);
const out = path.resolve('docs/evidence/v0.4');
const shot = async (page: Page, name: string, fullPage = false) => {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage });
};
const addBlock = async (page: Page, entry: string) => {
  await page.getByRole('button', { name: 'Agregar bloque', exact: true }).first().click();
  await page.getByRole('menuitem', { name: new RegExp(`^${entry}`) }).click();
};
const bpmField = (page: Page, label: string) => page.getByRole('spinbutton', { name: `BPM de ${label}` });

test.describe('evidence v0.4', () => {
  test.skip(!enabled, 'set CAPTURE_EVIDENCE=1 to capture');
  test.setTimeout(400_000);

  test('captures the evolved product', async ({ page, browser }) => {
    await mkdir(out, { recursive: true });
    await audioProbe(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    // 04 empty state, 01 new library after real content exists
    await openLibrary(page);
    await page.waitForTimeout(600);
    await shot(page, '04-estado-vacio-con-guitarras');
    await page.getByRole('button', { name: 'Nuevo', exact: true }).click();
    await shot(page, '06-pantalla-de-creacion');
    await page.keyboard.press('Escape');

    // The song, built the way the person would: lyrics, melody, chords, solo, scale, comment.
    await createFromMenu(page, 'Canción con letra', 'Hoy vuelvo a casa');
    await page.getByLabel('Letra', { exact: true }).fill('# Verso 1\n[C]Hoy vuelvo [G]a casa\n[Am]con el alma en [F]paz\n\n# Estribillo\n[F]Y canto otra [G]vez');
    await page.getByText('Vista con acordes').click();
    await shot(page, '07-cancion-con-letra');

    await addBlock(page, 'Melodía');
    await page.getByLabel('Escribir notas').fill('Do4 Mi4 Sol4 Fa4:2 Mi4 Re4 Do4:2');
    await page.getByLabel('Escribir notas').press('Enter');
    await page.getByRole('button', { name: 'Sílabas y frase de esta melodía' }).click();
    await page.getByLabel('Frase de letra de la melodía').fill('Hoy vuelvo a casa con el alma en paz');
    await page.getByLabel('Sílabas para repartir').fill('Hoy vuel-vo a ca-sa');
    await page.getByRole('button', { name: 'Repartir sobre las notas' }).click();
    await page.getByRole('option').nth(3).click();
    await shot(page, '11-melodia-con-letra');

    await addBlock(page, 'Acordes');
    await page.getByLabel('Escribir acordes').fill('C G Am F');
    await page.getByLabel('Escribir acordes').press('Enter');
    await page.getByRole('button', { name: 'Tonalidad del cuaderno', exact: true }).click();
    await page.getByLabel('Tonalidad principal').selectOption('C:major');
    await page.keyboard.press('Escape');

    await addBlock(page, 'Tablatura');
    await cell(page, 1, 1).click();
    for (const key of '578757') await page.keyboard.press(key);
    await addBlock(page, 'Mapa del mástil');
    for (const [s, f] of [[5, 8], [5, 10], [5, 12], [4, 8], [4, 10], [3, 7], [3, 9], [3, 10], [2, 7], [2, 9], [1, 8], [1, 10], [0, 8], [0, 10]]) await neck(page).pick(s, f);
    await page.getByRole('button', { name: 'Comentarios de el cuaderno' }).click();
    await page.getByLabel('Nuevo comentario sobre el cuaderno').fill('Falta resolver el puente. Probar el estribillo en Sol.');
    await page.getByRole('button', { name: 'Agregar comentario' }).click();
    await shot(page, '15-comentarios');
    await page.keyboard.press('Escape');
    await settleSave(page);
    const songUrl = page.url();
    await page.mouse.move(2, 2);
    await shot(page, '14-cuaderno-mixto-completo', true);

    // 08 melody song / 09 editor / 10 playing
    await page.goto(songUrl);
    await page.getByRole('option').first().click();
    await page.getByRole('region', { name: /^Melodía/ }).getByRole('button', { name: 'Teclado' }).click();
    await page.locator('.melody-block').scrollIntoViewIfNeeded();
    await shot(page, '09-editor-simple-de-melodias');
    await page.getByRole('region', { name: /^Melodía/ }).getByRole('button', { name: 'Teclado' }).click();
    await bpmField(page, 'melodía').fill('60');
    await bpmField(page, 'melodía').press('Enter');
    await page.getByRole('button', { name: 'Reproducir melodía' }).click();
    await page.waitForTimeout(1300);
    await shot(page, '10-melodia-en-reproduccion');
    await page.getByRole('button', { name: 'Detener melodía' }).click();
    await page.getByRole('option').first().click();
    await shot(page, '08-cancion-con-melodia');

    // 12 tablature playing
    await bpmField(page, 'tablatura').fill('60');
    await bpmField(page, 'tablatura').press('Enter');
    await page.getByRole('button', { name: 'Reproducir tablatura' }).click();
    await page.waitForTimeout(1500);
    await page.locator('.tab-block').scrollIntoViewIfNeeded();
    await shot(page, '12-tablatura-en-reproduccion');
    await page.getByRole('button', { name: 'Detener tablatura' }).click();

    // 13 map
    await page.locator('.map-block').scrollIntoViewIfNeeded();
    await shot(page, '13-mapa-de-escala');

    // Harmony tools
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('button', { name: 'Armonía', exact: true }).click();
    await shot(page, '24-herramientas-circulo-de-quintas');
    await page.getByRole('complementary').getByRole('button', { name: 'Modulación' }).click();
    await page.getByRole('complementary').getByLabel('Destino').selectOption('G:major');
    await shot(page, '25-herramientas-modulacion');
    await page.getByRole('complementary').getByRole('button', { name: 'Acordes', exact: true }).click();
    await page.getByRole('complementary').getByLabel('Símbolo de acorde').fill('G7');
    await page.getByRole('complementary').getByLabel('Símbolo de acorde').press('Enter');
    await shot(page, '26-herramientas-acordes');
    await page.getByRole('button', { name: 'Cerrar herramientas musicales' }).click();

    // 16 / 17 practice
    await page.goto(songUrl.replace('/material/', '/practica/'));
    await shot(page, '16-practica');
    await page.getByRole('button', { name: 'Modo foco' }).click();
    await shot(page, '17-practica-en-foco');
    await page.keyboard.press('Escape');

    // 18 settings
    await page.goto('/configuracion/sonido');
    await shot(page, '18-configuracion-sonido');
    await page.goto('/configuracion/apariencia');
    await shot(page, '18b-configuracion-apariencia');

    // 01 library with content, 19 light, 20 dark
    await page.goto('/biblioteca');
    await page.waitForTimeout(600);
    await shot(page, '01-biblioteca-musical');
    await shot(page, '19-tema-claro');
    await page.getByRole('button', { name: 'Activar modo oscuro' }).click();
    await shot(page, '20-tema-oscuro');
    await page.goto(songUrl);
    await shot(page, '20b-cuaderno-oscuro');
    await page.getByRole('button', { name: 'Activar modo claro' }).click();

    // 21 desktop / 22 tablet / 23 mobile
    await page.goto('/biblioteca');
    await shot(page, '21-escritorio');
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.goto('/biblioteca');
    await shot(page, '22-tablet-biblioteca');
    await page.goto(songUrl);
    await shot(page, '22b-tablet-cuaderno', true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/biblioteca');
    await shot(page, '23-movil-biblioteca');
    await page.goto(songUrl);
    await shot(page, '23b-movil-cuaderno', true);
    await page.goto(songUrl.replace('/material/', '/practica/'));
    await shot(page, '23c-movil-practica');
    await page.setViewportSize({ width: 1440, height: 900 });

    // 05 motion: two frames of the same scene three seconds apart
    await page.goto('/biblioteca');
    await page.waitForTimeout(400);
    await page.locator('.lib-hero').screenshot({ path: path.join(out, '05a-movimiento-cuadro-1.png') });
    await page.waitForTimeout(3500);
    await page.locator('.lib-hero').screenshot({ path: path.join(out, '05b-movimiento-cuadro-2.png') });

    // 02 / 03 brand: sheet with the mark, lockups and app icons, light and dark
    const brandPage = await browser.newPage({ viewport: { width: 1200, height: 560 } });
    await brandPage.goto(`${new URL(page.url()).origin}/biblioteca`);
    await brandPage.setContent(`<base href="${new URL(page.url()).origin}/"><body style="margin:0;font-family:system-ui;display:grid;grid-template-columns:1fr 1fr;height:560px">
      <section style="background:#f4efe6;padding:36px;display:grid;gap:20px;align-content:center">
        <img src="/brand/guitarap-lockup-light.svg" height="110"/>
        <div style="display:flex;gap:18px;align-items:center"><img src="/brand/guitarap-mark-light.svg" height="96"/><img src="/brand/guitarap-mark-light.svg" height="48"/><img src="/brand/guitarap-mark-light.svg" height="24"/><img src="/brand/guitarap-mark-light.svg" height="16"/></div>
        <div style="display:flex;gap:14px;align-items:center"><img src="/icons/icon-192.png" height="96"/><img src="/icons/icon-maskable-512.png" height="96" style="border-radius:50%"/><img src="/icons/favicon-32.png" height="32"/></div>
      </section>
      <section style="background:#1d1a16;padding:36px;display:grid;gap:20px;align-content:center">
        <img src="/brand/guitarap-lockup-dark.svg" height="110"/>
        <div style="display:flex;gap:18px;align-items:center"><img src="/brand/guitarap-mark-dark.svg" height="96"/><img src="/brand/guitarap-mark-dark.svg" height="48"/><img src="/brand/guitarap-mark-dark.svg" height="24"/><img src="/brand/guitarap-mark-dark.svg" height="16"/></div>
        <p style="color:#bcb5a6;margin:0">Aro-G + seis cuerdas + cabeza de nota. De 16 px a gigante.</p>
      </section></body>`, { waitUntil: 'load' });
    await brandPage.waitForTimeout(500);
    await brandPage.screenshot({ path: path.join(out, '03-logo-claro-y-oscuro.png') });
    await brandPage.close();
    await copyFile(path.resolve('docs/brand/directions.png'), path.join(out, '02-identidad-tres-direcciones.png'));
  });
});
