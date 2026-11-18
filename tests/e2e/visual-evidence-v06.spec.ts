import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createFromMenu, createMaterial, openLibrary, settleSave } from './helpers';
import { addPart, createSongProject, linkAndSync } from './project-helpers';
import { newAccount, newPerson } from './sharing-helpers';

/**
 * Evidence for v0.6. On demand only:
 *   CAPTURE_EVIDENCE=1 npx playwright test tests/e2e/visual-evidence-v06.spec.ts
 * A test library in an isolated browser with a test account; nothing real is involved.
 */
const enabled = Boolean(process.env.CAPTURE_EVIDENCE);
const out = path.resolve(process.env.EVIDENCE_DIR ?? 'docs/evidence/v0.6');
const shot = async (page: Page, name: string, fullPage = false) => {
  await page.waitForTimeout(450);
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage });
};
const setSkin = async (page: Page, skin: string) => page.evaluate((value) => { document.documentElement.dataset.skin = value; }, skin);

test.describe('evidence v0.6', () => {
  test.skip(!enabled, 'set CAPTURE_EVIDENCE=1 to capture');
  test.setTimeout(300_000);

  test('captures the music workspace', async ({ browser }) => {
    await mkdir(out, { recursive: true });
    const owner = await newAccount('owner');
    const { page } = await newPerson(browser, owner);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLibrary(page);

    // A library like the real one: folders with scales, song projects with parts, loose materials.
    await page.getByRole('button', { name: 'Nuevo', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Carpeta' }).click();
    await page.getByRole('dialog').getByLabel('Nombre').fill('ESCALAS');
    await page.getByRole('dialog').getByRole('button', { name: 'Crear' }).click();
    await page.locator('.lib-row', { hasText: 'ESCALAS' }).locator('.lib-open').click();
    for (const name of ['C Jónico', 'D Jónico', 'La menor pentatónica']) {
      await createMaterial(page, 'Mapa de escala', name);
      await settleSave(page);
      await page.getByRole('link', { name: /Volver a la biblioteca/ }).click();
    }
    await createSongProject(page, 'Tema 1 ft Gottya');
    await addPart(page, 'Letra y melodía', '# Verso 1\n[F]Hoy vuelvo a empezar\n[Bb]con el alma en [C]paz\n\n# Estribillo\n[F]Y canto otra vez');
    await addPart(page, 'Arreglos', '# Intro\nGuitarra limpia, después entra la base');
    await createSongProject(page, 'Camino de vuelta');
    await addPart(page, 'Boceto', '# Verso\nPrimeras ideas');
    await page.goto('/biblioteca');
    await createFromMenu(page, 'Cuaderno de composición', 'Nueva melodía');
    await settleSave(page);
    await page.goto('/biblioteca');
    await createMaterial(page, 'Tablatura', 'Riff de apertura');
    await settleSave(page);
    await linkAndSync(page);

    // Library, in the three universes.
    await page.goto('/biblioteca');
    await page.waitForTimeout(600);
    await shot(page, '01-biblioteca-estudio');
    for (const [skin, file] of [['britanico', '02-biblioteca-rock-britanico'], ['psicodelico', '03-biblioteca-psicodelia']] as const) {
      await setSkin(page, skin);
      await shot(page, file);
    }
    await setSkin(page, 'estudio');

    // A folder and a song project.
    await page.locator('.lib-row', { hasText: 'Tema 1 ft Gottya' }).locator('.lib-open').click();
    await shot(page, '04-proyecto-de-cancion');

    // Practice: the hierarchical explorer, then a part with its siblings.
    await page.goto('/practica');
    await page.getByRole('button', { name: 'Elegir material para practicar' }).click();
    await expect(page.getByRole('group', { name: 'Explorador de materiales' })).toBeVisible();
    await shot(page, '05-practica-explorador-raiz');
    await page.getByRole('button', { name: 'Carpeta ESCALAS' }).click();
    await shot(page, '06-practica-explorador-escalas');
    await page.getByRole('button', { name: 'Subir a la biblioteca' }).click();
    await page.getByRole('button', { name: 'Canción Tema 1 ft Gottya' }).click();
    await page.getByRole('button', { name: 'Letra y melodía' }).click();
    await expect(page.locator('.practice-title')).toHaveText('Letra y melodía');
    await shot(page, '07-practica-partes-de-la-cancion');
    for (const [skin, file] of [['britanico', '08-practica-rock-britanico'], ['psicodelico', '09-practica-psicodelia']] as const) {
      await setSkin(page, skin);
      await shot(page, file);
    }
    await setSkin(page, 'estudio');

    // Settings: skins with a preview, instruments, data, conflicts.
    await page.goto('/configuracion/apariencia');
    await shot(page, '10-configuracion-apariencia-temas');
    await page.goto('/configuracion/sonido');
    await shot(page, '11-configuracion-instrumentos');
    await page.goto('/configuracion/datos');
    await shot(page, '12-mis-datos-y-almacenamiento');
    await page.goto('/configuracion/conflictos');
    await shot(page, '13-conflictos-sin-pendientes');

    // Mobile library and practice.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/biblioteca');
    await shot(page, '14-movil-biblioteca');
    await setSkin(page, 'psicodelico');
    await shot(page, '15-movil-biblioteca-psicodelia');
    await setSkin(page, 'estudio');
    await page.goto('/practica');
    await shot(page, '16-movil-practica');
  });
});
