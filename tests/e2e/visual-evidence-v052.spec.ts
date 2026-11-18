import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openLibrary } from './helpers';
import { addPart, createSongProject, inviteUrl, openProject, openProjectShare, readLinkUrl } from './project-helpers';
import { newAccount, newPerson } from './sharing-helpers';

/**
 * Evidence for the whole-project sharing flow and the sync diagnostics. On demand only:
 *   CAPTURE_EVIDENCE=1 npx playwright test tests/e2e/visual-evidence-v052.spec.ts
 * Test accounts and a test library only; nothing real is involved.
 */
const enabled = Boolean(process.env.CAPTURE_EVIDENCE);
const out = path.resolve('docs/evidence/v0.5.2');
const shot = async (page: Page, name: string, fullPage = false) => {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage });
};

test.describe('evidence v0.5.2', () => {
  test.skip(!enabled, 'set CAPTURE_EVIDENCE=1 to capture');
  test.setTimeout(240_000);

  test('captures: project header, share dialog, guest project, shared list, sync diagnostic', async ({ browser }) => {
    await mkdir(out, { recursive: true });
    const owner = await newAccount('owner');
    const goti = await newAccount('goti');
    const { page } = await newPerson(browser, owner);
    await openLibrary(page);

    // Sync diagnostic: the exact production symptom, injected, before anything is shared.
    await createSongProject(page, 'Tema 1 ft Gottya');
    await addPart(page, 'Letra y melodía', '# Verso 1\nHoy vuelvo a empezar con los acordes de siempre');
    await addPart(page, 'Arreglos', '# Intro\nGuitarra limpia, después entra la base');
    let broken = true;
    await page.route('**/rest/v1/rpc/sync_library', (route) =>
      broken
        ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: '42702', message: 'column reference "parent_id" is ambiguous', details: 'It could refer to either a PL/pgSQL variable or a table column.' }) })
        : route.continue(),
    );
    await page.goto('/configuracion/sincronizacion');
    await page.getByRole('button', { name: 'Descargar copia de seguridad' }).click();
    await page.getByLabel(/Confirmo que el archivo se guardó/).check();
    await page.getByRole('button', { name: 'Vincular y sincronizar' }).click();
    await expect(page.locator('.topbar').getByText('Falta aplicar una reparación en Supabase')).toBeVisible({ timeout: 30000 });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByText('Detalle técnico del último intento').click();
    await shot(page, '01-sincronizacion-error-explicado');
    broken = false;
    await page.getByRole('button', { name: 'Sincronizar ahora' }).click();
    await expect(page.locator('.topbar').getByText('Todo sincronizado')).toBeVisible({ timeout: 30000 });
    await shot(page, '02-sincronizacion-reparada');

    // The project and its header action.
    await page.goto('/biblioteca');
    await openProject(page, 'Tema 1 ft Gottya');
    await shot(page, '03-proyecto-compartir-proyecto');

    // The share dialog, for the whole project.
    const dialog = await openProjectShare(page, 'Tema 1 ft Gottya');
    await expect(dialog.getByText('Esto compartirá el proyecto con 2 partes')).toBeVisible();
    await shot(page, '04-compartir-proyecto-alcance');
    const url = await readLinkUrl(dialog);
    const invitation = await inviteUrl(dialog, 'Editor');
    await shot(page, '05-compartir-proyecto-enlace-e-invitacion');

    // Opened from one part: the project is the default.
    await page.keyboard.press('Escape');
    await page.locator('.lib-row', { hasText: 'Arreglos' }).locator('.lib-open').click();
    await page.getByRole('button', { name: 'Compartir', exact: true }).click();
    await shot(page, '06-compartir-desde-una-parte');
    await page.keyboard.press('Escape');

    // What the friend receives with ONE link.
    const { page: guest } = await newPerson(browser, null);
    await guest.setViewportSize({ width: 1440, height: 900 });
    await guest.goto(url);
    await expect(guest.getByText('2 partes')).toBeVisible();
    await shot(guest, '07-invitado-proyecto-completo', true);

    // The collaborator: one project with its parts.
    const { page: friend } = await newPerson(browser, goti);
    await friend.setViewportSize({ width: 1440, height: 900 });
    await friend.goto(invitation);
    await friend.getByLabel('Tu nombre para el proyecto').fill('Goti');
    await friend.getByRole('button', { name: 'Aceptar invitación' }).click();
    await friend.waitForURL(/\/compartidos/);
    await expect(friend.getByRole('list', { name: 'Partes de Tema 1 ft Gottya' })).toBeVisible();
    await shot(friend, '08-compartidos-proyecto-con-partes');
    await page.close();
  });

  test('captures: sharing a project that is not in the cloud yet', async ({ browser }) => {
    await mkdir(out, { recursive: true });
    const owner = await newAccount('owner');
    const { page } = await newPerson(browser, owner);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLibrary(page);
    await createSongProject(page, 'Todavía local');
    await addPart(page, 'Parte uno', 'texto local');
    await page.goto('/configuracion/sincronizacion');
    await page.getByRole('button', { name: 'Descargar copia de seguridad' }).click();
    await page.getByLabel(/Confirmo que el archivo se guardó/).check();
    await page.route('**/rest/v1/rpc/sync_library', (route) => route.abort('failed'));
    await page.getByRole('button', { name: 'Vincular y sincronizar' }).click();
    await expect(page.locator('.topbar').getByText('Falta activar la sincronización')).toHaveCount(0);
    await openProject(page, 'Todavía local');
    await page.getByRole('button', { name: 'Compartir proyecto' }).click();
    await expect(page.getByText('Este proyecto todavía no está en tu cuenta en la nube.')).toBeVisible();
    await shot(page, '09-compartir-sincronizar-primero');
  });
});
