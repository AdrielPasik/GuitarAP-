import { expect, type Locator, type Page } from '@playwright/test';
import { settleSave } from './helpers';

/** Helpers for the whole-project sharing tests. They drive the real interface and the real sync (no mirroring). */

/** Nuevo → Canción: a song PROJECT (a node that holds parts), like «Tema 1 ft Gottya». */
export async function createSongProject(page: Page, name: string) {
  await page.goto('/biblioteca');
  await page.getByRole('button', { name: 'Nuevo', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Canción', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Nombre').fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'Crear' }).click();
  await page.locator('.lib-row', { hasText: name }).locator('.lib-open').first().click();
  await expect(page.getByRole('button', { name: 'Compartir proyecto' })).toBeVisible();
}

/** Inside an open song project: «Agregar parte», name it and give it lyrics; returns to the project. */
export async function addPart(page: Page, title: string, lyrics: string) {
  await page.getByRole('button', { name: 'Agregar parte' }).click();
  await page.waitForURL(/\/material\//);
  await page.getByLabel('Título del material').fill(title);
  await page.getByRole('button', { name: 'Agregar bloque', exact: true }).first().click();
  await page.getByRole('menuitem', { name: /^Letra/ }).click();
  await page.getByLabel('Letra', { exact: true }).fill(lyrics);
  await settleSave(page);
  await page.getByRole('link', { name: /Volver a la biblioteca/ }).click();
  await expect(page.getByRole('button', { name: 'Compartir proyecto' })).toBeVisible();
}

/** Settings → Sincronización: back up, confirm, link, and wait for the server's confirmation. */
export async function linkAndSync(page: Page) {
  await page.goto('/configuracion/sincronizacion');
  await page.getByRole('button', { name: 'Descargar copia de seguridad' }).click();
  await page.getByLabel(/Confirmo que el archivo se guardó/).check();
  await page.getByRole('button', { name: 'Vincular y sincronizar' }).click();
  await expect(page.locator('.topbar').getByText('Guardado en tu cuenta')).toBeVisible({ timeout: 30000 });
}

/** Opens the song project from the library (list row) and returns to its page. */
export async function openProject(page: Page, name: string) {
  await page.goto('/biblioteca');
  await page.locator('.lib-row', { hasText: name }).locator('.lib-open').first().click();
  await expect(page.getByRole('button', { name: 'Compartir proyecto' })).toBeVisible();
}

export async function openProjectShare(page: Page, name: string) {
  await page.getByRole('button', { name: 'Compartir proyecto' }).click();
  const dialog = page.getByRole('dialog', { name: new RegExp(`^Compartir (el proyecto )?«${name}»`) });
  await expect(dialog.getByText('Privado').or(dialog.getByText(/Compartido/)).first()).toBeVisible();
  return dialog;
}

/** Creates a read-only link and returns its URL (shown once). */
export async function readLinkUrl(dialog: Locator, options: { password?: string } = {}) {
  if (options.password) {
    await dialog.getByLabel('Proteger con contraseña').check();
    await dialog.getByLabel('Contraseña del enlace').fill(options.password);
  }
  await dialog.getByRole('button', { name: 'Crear enlace de lectura' }).click();
  const field = dialog.getByLabel('Enlace para copiar');
  await expect(field).toHaveValue(/\/c\//); // the box may still show an earlier invitation for a moment
  return field.inputValue();
}

/** Creates an invitation for a role and returns its URL. */
export async function inviteUrl(dialog: Locator, role: 'Editor' | 'Comentarista' | 'Lector') {
  await dialog.getByLabel('Rol de la invitación').selectOption({ label: role });
  await dialog.getByRole('button', { name: 'Crear invitación' }).click();
  const field = dialog.getByLabel('Enlace para copiar');
  await expect(field).toHaveValue(/\/invitacion\//); // the box may still show an earlier link for a moment
  return field.inputValue();
}

/** Waits for the app's automatic sync to confirm that nothing is pending any more. */
export async function waitSynced(page: Page) {
  await expect(page.locator('.topbar').getByText('Guardado en tu cuenta')).toBeVisible({ timeout: 40000 });
}
