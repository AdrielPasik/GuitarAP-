import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { test, type Page } from '@playwright/test';
import { cell, neck, openLibrary, settleSave } from './helpers';
import { mirror, newAccount, newPerson, admin } from './sharing-helpers';

/**
 * Visual evidence for v0.5. On demand only:
 *   CAPTURE_EVIDENCE=1 npx playwright test tests/e2e/visual-evidence-v05.spec.ts
 * Two throwaway accounts on the local test gateway (a real PostgreSQL engine) and realistic content typed through
 * the real interface. No real library or account is involved.
 */
const enabled = Boolean(process.env.CAPTURE_EVIDENCE);
const out = path.resolve(process.env.EVIDENCE_DIR ?? 'docs/evidence/v0.5');
const shot = async (page: Page, name: string, fullPage = false) => {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage });
};
const addBlock = async (page: Page, entry: string) => {
  await page.getByRole('button', { name: 'Agregar bloque', exact: true }).first().click();
  await page.getByRole('menuitem', { name: new RegExp(`^${entry}`) }).click();
};

test.describe('evidence v0.5', () => {
  test.skip(!enabled, 'set CAPTURE_EVIDENCE=1 to capture');
  test.setTimeout(420_000);

  test('captures the collaborative studio', async ({ browser }) => {
    await mkdir(out, { recursive: true });
    const owner = await newAccount('owner');
    const goti = await newAccount('goti');
    const { page, context } = await newPerson(browser, owner);
    await page.setViewportSize({ width: 1440, height: 900 });

    // A second song to move things to.
    await openLibrary(page);
    await page.waitForTimeout(500);
    await shot(page, '01-biblioteca');
    await page.getByRole('button', { name: 'Nueva canción' }).first().click();
    await page.getByLabel('Nombre de la canción').fill('Ideas sueltas');
    await page.getByRole('dialog').getByRole('button', { name: 'Crear canción' }).click();
    await page.waitForURL(/\/material\//);
    await settleSave(page);
    await mirror(page, owner, 'Ideas sueltas');

    // 02 start of a composition: the minimal form.
    await page.goto('/biblioteca');
    await page.getByRole('button', { name: 'Nueva canción' }).first().click();
    const form = page.getByRole('dialog', { name: 'Nueva canción' });
    await form.getByLabel('Nombre de la canción').fill('Tema 1 FT Goti');
    await form.getByLabel('BPM de la canción').fill('92');
    await form.getByLabel('Tonalidad de la canción').selectOption('F:major');
    await form.getByRole('radio', { name: /Con estructura inicial/ }).check();
    await shot(page, '02-inicio-de-composicion');
    await form.getByRole('button', { name: 'Crear canción' }).click();
    await page.waitForURL(/\/material\//);

    // The song: Verso 1 (letra + melodía), Estribillo, then a solo, a progression and a scale.
    const lyrics = page.getByLabel('Letra', { exact: true });
    await lyrics.first().fill('# Verso 1\n[F]Hoy vuelvo a empezar\n[Bb]con el alma en [C]paz');
    await page.getByLabel('Escribir notas').first().fill('Fa4 La4 Do5 Sib4 La4 Sol4 Fa4:2');
    await page.getByLabel('Escribir notas').first().press('Enter');
    await lyrics.nth(1).fill('# Estribillo\nY canto otra vez, y canto otra vez');
    await page.getByLabel('Escribir notas').nth(1).fill('Do5 Do5 La4 Sib4 Do5:2');
    await page.getByLabel('Escribir notas').nth(1).press('Enter');
    await addBlock(page, 'Sección');
    await page.getByLabel('Nombre de la sección 7').fill('Solo');
    await addBlock(page, 'Tablatura');
    await cell(page, 1, 1).click();
    for (const key of '8108') await page.keyboard.press(key);
    await addBlock(page, 'Acordes');
    await page.getByLabel('Escribir acordes').fill('F Bb C F');
    await page.getByLabel('Escribir acordes').press('Enter');
    await addBlock(page, 'Mapa del mástil');
    for (const [s, f] of [[5, 1], [5, 3], [5, 5], [4, 3], [4, 5], [3, 2], [3, 3], [3, 5]]) await neck(page).pick(s, f);
    await page.getByRole('button', { name: 'Comentarios de el cuaderno' }).click();
    await page.getByLabel('Nuevo comentario sobre el cuaderno').fill('Falta resolver el puente. Probar el estribillo en Sol.');
    await page.getByRole('button', { name: 'Agregar comentario' }).click();
    await page.keyboard.press('Escape');
    await settleSave(page);
    const songUrl = page.url();
    await page.getByRole('button', { name: 'Índice', exact: true }).click();
    await page.mouse.move(2, 2);
    await shot(page, '03-cancion-con-secciones-e-indice', true);
    await page.getByRole('button', { name: 'Índice', exact: true }).click();

    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, '04-cancion-encabezado-bpm-tonalidad');

    // Letra + melodía, playing.
    await page.getByRole('button', { name: 'Acciones de melodía 3' }).click();
    await page.getByRole('menuitem', { name: /^Ver con su letra/ }).click();
    await page.getByRole('region', { name: /^Letra \+ melodía/ }).getByRole('spinbutton', { name: 'BPM de melodía' }).fill('50');
    await page.getByRole('region', { name: /^Letra \+ melodía/ }).getByRole('spinbutton', { name: 'BPM de melodía' }).press('Enter');
    await page.getByRole('region', { name: /^Letra \+ melodía/ }).scrollIntoViewIfNeeded();
    await shot(page, '05-letra-mas-melodia');
    await page.getByRole('region', { name: /^Letra \+ melodía/ }).getByRole('button', { name: 'Reproducir melodía' }).click();
    await page.waitForTimeout(1200);
    await shot(page, '06-letra-mas-melodia-sonando');
    await page.getByRole('region', { name: /^Letra \+ melodía/ }).getByRole('button', { name: 'Detener melodía' }).click();
    await page.getByRole('button', { name: 'Cerrar esta vista' }).click();

    // 07 menus: move / copy.
    await page.getByRole('button', { name: 'Acciones de tablatura 8' }).click();
    await shot(page, '07-menu-de-un-bloque');
    await page.getByRole('menuitem', { name: /^Mover a otra canción…/ }).click();
    await shot(page, '08-menu-mover-a');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Acciones de tablatura 8' }).click();
    await page.getByRole('menuitem', { name: /^Copiar a otra canción…/ }).click();
    await shot(page, '09-menu-copiar-a');
    await page.keyboard.press('Escape');

    // 10 harmony tools with the song's key.
    await page.getByRole('button', { name: 'Armonía', exact: true }).click();
    await shot(page, '10-circulo-de-quintas-en-fa');
    await page.getByRole('button', { name: 'Cerrar herramientas musicales' }).click();

    // 11 practice
    await page.goto(songUrl.replace('/material/', '/practica/'));
    await shot(page, '11-practica');

    // Settings
    await page.goto('/configuracion/colaboracion');
    await shot(page, '12-configuracion-colaboracion');
    await page.goto('/configuracion/musica');
    await shot(page, '13-configuracion-preferencias-musicales');

    // Mirror the song so it can be shared, then share it.
    await page.goto(songUrl);
    const songId = await mirror(page, owner, 'Tema 1 FT Goti');
    await page.reload();
    await page.getByRole('button', { name: 'Compartir', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /^Compartir «/ });
    await dialog.getByText('Privado').waitFor();
    await shot(page, '14-compartir-privado');
    await dialog.getByLabel('Proteger con contraseña').check();
    await dialog.getByLabel('Contraseña del enlace').fill('cancion-123');
    await dialog.getByRole('button', { name: 'Crear enlace de lectura' }).click();
    await dialog.getByLabel('Enlace para copiar').waitFor();
    const linkUrl = await dialog.getByLabel('Enlace para copiar').inputValue();
    const previous = linkUrl;
    await dialog.getByLabel('Rol de la invitación').selectOption('editor');
    await dialog.getByRole('button', { name: 'Crear invitación' }).click();
    await page.waitForFunction((value) => (document.querySelector('[aria-label="Enlace para copiar"]') as HTMLInputElement | null)?.value !== value, previous);
    const inviteUrl = await dialog.getByLabel('Enlace para copiar').inputValue();
    await shot(page, '15-compartir-enlace-y-colaboradores');

    // Guest: password gate, then the song.
    const guest = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const guestPage = await guest.newPage();
    await guestPage.goto(linkUrl);
    await guestPage.getByRole('button', { name: 'Entrar' }).waitFor();
    await shot(guestPage, '16-invitado-pantalla-de-contrasena');
    await guestPage.getByLabel('Contraseña').fill('cancion-123');
    await guestPage.getByRole('button', { name: 'Entrar' }).click();
    await guestPage.getByRole('heading', { name: 'Tema 1 FT Goti', level: 1 }).waitFor();
    await shot(guestPage, '17-invitado-vista-de-lectura');
    await shot(guestPage, '17b-invitado-vista-completa', true);

    // Collaborator: accepts, edits, sees the shared list and the activity.
    const { page: collab } = await newPerson(browser, goti);
    await collab.setViewportSize({ width: 1440, height: 900 });
    await collab.goto(inviteUrl);
    await collab.getByLabel('Tu nombre para el proyecto').fill('Goti');
    await shot(collab, '18-invitacion');
    await collab.getByRole('button', { name: 'Aceptar invitación' }).click();
    await collab.waitForURL(/\/compartido\//);
    await collab.getByLabel('Letra', { exact: true }).first().waitFor();
    await collab.getByLabel('Letra', { exact: true }).first().fill('# Verso 1\n[F]Hoy vuelvo a empezar\n[Bb]con el alma en [C]paz\nLetra nueva de Goti');
    await page.waitForTimeout(2500);
    await shot(collab, '19-proyecto-colaborativo');
    await collab.getByText('Actividad').first().click();
    await shot(collab, '20-actividad');
    await collab.goto('/compartidos');
    await shot(collab, '21-compartidos-conmigo');

    // Empty states and themes.
    const empty = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const emptyPage = await empty.newPage();
    await emptyPage.goto('/biblioteca');
    await emptyPage.waitForTimeout(500);
    await shot(emptyPage, '22-estado-vacio');
    await page.goto(songUrl);
    await page.getByRole('button', { name: 'Activar modo oscuro' }).click();
    await shot(page, '23-tema-oscuro');
    await page.goto('/configuracion/colaboracion');
    await shot(page, '24-configuracion-oscuro');
    await page.getByRole('button', { name: 'Activar modo claro' }).click();

    // Responsive.
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.goto(songUrl);
    await shot(page, '25-tablet-cancion');
    await guestPage.setViewportSize({ width: 820, height: 1180 });
    await shot(guestPage, '26-tablet-invitado');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/biblioteca');
    await shot(page, '27-movil-biblioteca');
    await page.goto(songUrl);
    await shot(page, '28-movil-cancion', true);
    await guestPage.setViewportSize({ width: 390, height: 844 });
    await shot(guestPage, '29-movil-invitado', true);
    await admin('select 1');
    void songId;
    void context;
  });
});
