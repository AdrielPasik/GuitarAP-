import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { cell, createFolder, createMaterial, mockServer, neck, openLibrary, settleSave } from './helpers';

/**
 * Visual evidence for design review. It only runs on demand:
 *   CAPTURE_EVIDENCE=1 npx playwright test tests/e2e/visual-evidence.spec.ts
 * Screenshots go to docs/evidence/after. Auth and sync are answered locally; no real account is used.
 */
const enabled = Boolean(process.env.CAPTURE_EVIDENCE);
const out = path.resolve('docs/evidence/after');
const shot = async (page: Page, name: string, fullPage = false) => {
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage });
};
const back = (page: Page) => page.getByRole('link', { name: /Volver a la biblioteca/ }).click();

test.describe('evidence', () => {
  test.skip(!enabled, 'set CAPTURE_EVIDENCE=1 to capture');
  test.setTimeout(240_000);

  test('captures the redesigned product', async ({ page }) => {
    await mkdir(out, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockServer(page);
    await openLibrary(page);
    await shot(page, '00-primera-visita-biblioteca-vacia');

    // A believable library.
    await createFolder(page, 'Escalas');
    await createFolder(page, 'Covers');
    await page.getByRole('button', { name: 'Nuevo', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Canción' }).click();
    await page.getByRole('dialog').getByLabel('Nombre').fill('Comfortably Numb');
    await page.getByRole('dialog').getByRole('button', { name: 'Crear' }).click();

    // 3 — a new material, empty.
    await createMaterial(page, 'Material de estudio', 'Pentatónica menor de La');
    await shot(page, '03-nuevo-documento');

    // 9 — one string, many notes.
    await page.getByRole('button', { name: 'Mapa del mástil' }).click();
    await page.getByRole('button', { name: /^Tónica/ }).click();
    await page.getByRole('menuitemradio', { name: 'La', exact: true }).click();
    for (const fret of [0, 3, 5, 7, 10, 12]) await neck(page).pick(5, fret);
    for (const [string, fret] of [[4, 0], [4, 2], [4, 5], [4, 7], [3, 0], [3, 2], [3, 5], [3, 7], [2, 0], [2, 2], [1, 0], [1, 3], [0, 0], [0, 3], [0, 5]]) {
      await neck(page).pick(string, fret);
    }
    await shot(page, '09-mapa-multiples-notas-misma-cuerda');

    // 10 — map + tablature + notes in one material.
    await page.getByRole('button', { name: 'Agregar bloque', exact: true }).first().click();
    await page.getByRole('menuitem', { name: 'Título de sección' }).click();
    await page.getByLabel('Título de sección').fill('Frase sobre la escala');
    await page.getByRole('button', { name: 'Agregar bloque', exact: true }).first().click();
    await page.getByRole('menuitem', { name: 'Tablatura' }).click();
    await cell(page, 1, 1).click();
    for (const key of '5 7 8 7 5 12 10 8'.split(' ')) await page.keyboard.press(key.length > 1 ? key[0] : key);
    await cell(page, 1, 1).click();
    await page.keyboard.press('h');
    await page.getByRole('button', { name: 'Agregar bloque', exact: true }).first().click();
    await page.getByRole('menuitem', { name: 'Nota de estudio' }).click();
    await page.getByLabel('Nota de estudio').fill('Alternate picking a 60 BPM. Subir de a 4 BPM cuando salga limpio.');
    await settleSave(page);
    await page.mouse.move(5, 5);
    await shot(page, '10-documento-mapa-y-tablatura', true);

    // 11–13 — positions.
    await page.getByRole('button', { name: 'Agregar posición' }).click();
    for (const [string, fret] of [[5, 5], [5, 8], [4, 5], [4, 7], [3, 5], [3, 7], [2, 5], [2, 7], [1, 8], [1, 10], [0, 5], [0, 8]]) await neck(page).pick(string, fret);
    await shot(page, '11-posiciones-individuales');
    await page.getByRole('button', { name: 'Conjunta' }).click();
    await shot(page, '12-posiciones-conjuntas', true);
    await page.getByRole('button', { name: 'Completa' }).click();
    await shot(page, '13-mapa-completo');
    await page.getByRole('button', { name: 'Individual' }).click();
    await settleSave(page);
    const study = page.url();

    // A tablature written from the neck.
    await page.goto('/biblioteca');
    await createMaterial(page, 'Tablatura', 'Solo de prueba');
    await cell(page, 1, 1).click();
    for (const key of '5787537535'.split('')) await page.keyboard.press(key);
    await shot(page, '06-editor-secuencial');
    await page.getByRole('button', { name: 'Mástil', exact: true }).click();
    await page.getByRole('button', { name: 'Melodía' }).click();
    for (const fret of [5, 7, 8, 7, 5]) await page.getByTestId('tab-neck').getByTestId(`fret-0-${fret}`).click();
    await shot(page, '07-escritura-por-mastil');
    await cell(page, 1, 13).click().catch(() => undefined);
    await cell(page, 1, 12).click();
    await shot(page, '08-vista-combinada');
    await settleSave(page);
    const tabUrl = page.url();

    // Another map for the library list, then the library in both themes.
    await page.goto('/biblioteca');
    await createMaterial(page, 'Mapa de escala', 'Do mayor');
    for (const fret of [0, 1, 3, 5, 7, 8]) await neck(page).pick(5, fret);
    await settleSave(page);
    await back(page);
    await shot(page, '01-biblioteca-clara');
    await page.getByRole('button', { name: 'Activar modo oscuro' }).click();
    await shot(page, '02-biblioteca-oscura');
    await page.goto(study);
    await shot(page, '10b-documento-oscuro', true);
    await page.getByRole('button', { name: 'Activar modo claro' }).click();

    // 4 — sign in.
    await page.goto('/biblioteca');
    await page.getByRole('banner').getByRole('button', { name: 'Iniciar sesión' }).click();
    await shot(page, '04-inicio-de-sesion');
    await page.getByRole('dialog').getByLabel('Correo').fill('prueba@guitarap.test');
    await page.getByRole('dialog').getByLabel('Contraseña', { exact: true }).fill('clave-de-prueba');
    await page.getByRole('dialog').getByRole('button', { name: 'Iniciar sesión' }).click();
    await expect(page.getByRole('dialog', { name: /Protegé tu biblioteca/ })).toBeVisible();
    await shot(page, '18a-proteger-biblioteca');
    await page.getByRole('button', { name: 'Descargar copia de seguridad' }).click();
    await page.getByLabel(/Confirmo que el archivo se guardó/).check();
    await shot(page, '18b-confirmar-copia');
    await page.getByRole('button', { name: 'Vincular y sincronizar' }).click();
    await expect(page.getByRole('banner').getByText('Todo sincronizado')).toBeVisible({ timeout: 15000 });
    await page.getByRole('banner').getByRole('button', { name: 'Cuenta y sincronización' }).click();
    await shot(page, '05-usuario-conectado');
    await page.keyboard.press('Escape');

    // 14–16 — practice.
    await page.goto(tabUrl.replace('/material/', '/practica/'));
    await shot(page, '14-practica-tablatura');
    await page.goto(study.replace('/material/', '/practica/'));
    await shot(page, '15-practica-mapa');
    await page.getByRole('button', { name: 'Modo foco' }).click();
    await shot(page, '16-modo-foco');
    await page.keyboard.press('Escape');

    // 17–18 — settings.
    await page.goto('/configuracion/cuenta');
    await shot(page, '17-configuracion');
    await page.goto('/configuracion/sincronizacion');
    await shot(page, '18-sincronizacion');
    await page.goto('/configuracion/copias');
    await shot(page, '18c-copias-de-seguridad');

    // Other sizes.
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.goto(study);
    await shot(page, '19-tablet-documento');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/biblioteca');
    await shot(page, '20-movil-biblioteca');
    await page.goto(study);
    await shot(page, '21-movil-documento');
  });
});
