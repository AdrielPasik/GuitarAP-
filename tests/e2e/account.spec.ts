import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { cell, createMaterial, mockServer, openLibrary, settleSave } from './helpers';

const topbar = (page: Page) => page.getByRole('banner');

test('Test 6 — a first visit shows how to sign in, validates, and explains errors in plain words', async ({ page }) => {
  await mockServer(page, { auth: 'bad' });
  await openLibrary(page);
  const signIn = topbar(page).getByRole('button', { name: 'Iniciar sesión' });
  await expect(signIn).toBeVisible();
  await expect(topbar(page).getByText('Solo en este dispositivo')).toBeVisible();

  await signIn.click();
  const dialog = page.getByRole('dialog', { name: 'Iniciar sesión' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(dialog.getByText('Escribí tu correo.')).toBeVisible();
  await expect(dialog.getByText('Escribí tu contraseña.')).toBeVisible();

  await dialog.getByLabel('Correo').fill('no-es-un-correo');
  await dialog.getByLabel('Contraseña', { exact: true }).fill('x');
  await dialog.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(dialog.getByText('Revisá el formato del correo.')).toBeVisible();

  const password = dialog.getByLabel('Contraseña', { exact: true });
  await expect(password).toHaveAttribute('type', 'password');
  await dialog.getByRole('button', { name: 'Mostrar contraseña' }).click();
  await expect(password).toHaveAttribute('type', 'text');

  await dialog.getByLabel('Correo').fill('prueba@guitarap.test');
  await dialog.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(/El correo o la contraseña no son correctos\./);
  await expect(dialog).not.toContainText('400');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(signIn).toBeFocused();
});

test('an unreachable service explains that offline work continues', async ({ page }) => {
  await mockServer(page, { auth: 'down' });
  await openLibrary(page);
  await topbar(page).getByRole('button', { name: 'Iniciar sesión' }).click();
  const dialog = page.getByRole('dialog', { name: 'Iniciar sesión' });
  await dialog.getByLabel('Correo').fill('prueba@guitarap.test');
  await dialog.getByLabel('Contraseña', { exact: true }).fill('secreto');
  await dialog.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(dialog.getByRole('alert')).toContainText('seguir trabajando sin conexión');
});

test('signing in never links the library until a verified backup is confirmed', async ({ page }, testInfo) => {
  await mockServer(page);
  await openLibrary(page);
  await createMaterial(page, 'Tablatura', 'Documento con historial');
  await cell(page, 1, 1).click();
  await page.keyboard.press('7');
  await settleSave(page);
  await page.goto('/biblioteca');

  await topbar(page).getByRole('button', { name: 'Iniciar sesión' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Correo').fill('prueba@guitarap.test');
  await dialog.getByLabel('Contraseña', { exact: true }).fill('secreto');
  await dialog.getByRole('button', { name: 'Iniciar sesión' }).click();

  // Step 2: protect the library first.
  await expect(page.getByRole('dialog', { name: /Protegé tu biblioteca/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vincular y sincronizar' })).toBeDisabled();
  await expect(page.getByText('Falta activar la sincronización')).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar copia de seguridad' }).click();
  const path = await (await download).path();
  const backup = JSON.parse(await readFile(path!, 'utf8')) as { schema: number; documents: unknown[]; versions: unknown[] };
  expect(backup.schema).toBe(1);
  expect(backup.documents).toHaveLength(1);
  await expect(page.getByText(/Copia verificada:/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vincular y sincronizar' })).toBeDisabled();

  await page.getByLabel(/Confirmo que el archivo se guardó/).check();
  await page.getByRole('button', { name: 'Vincular y sincronizar' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // Linked and synced: the top bar says so, in words.
  await expect(topbar(page).getByText('Guardado en tu cuenta')).toBeVisible({ timeout: 15000 });
  await topbar(page).getByRole('button', { name: 'Cuenta y sincronización' }).click();
  await expect(page.getByText('prueba@guitarap.test')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('conectado.png') });

  // A new edit is shown as pending, then synced again.
  await page.keyboard.press('Escape');
  await page.goto('/biblioteca');
  await expect(page.locator('.lib-open', { hasText: 'Documento con historial' })).toBeVisible();
});

test('the session is restored, signing out keeps every material, and offline work stays local', async ({ page, context }) => {
  await mockServer(page);
  await openLibrary(page);
  await createMaterial(page, 'Tablatura', 'Sigue acá');
  await settleSave(page);
  await page.goto('/biblioteca');
  await topbar(page).getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.getByRole('dialog').getByLabel('Correo').fill('prueba@guitarap.test');
  await page.getByRole('dialog').getByLabel('Contraseña', { exact: true }).fill('secreto');
  await page.getByRole('dialog').getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.getByRole('button', { name: 'Descargar copia de seguridad' }).click();
  await page.getByLabel(/Confirmo que el archivo se guardó/).check();
  await page.getByRole('button', { name: 'Vincular y sincronizar' }).click();
  await expect(topbar(page).getByText('Guardado en tu cuenta')).toBeVisible({ timeout: 15000 });

  await page.reload();
  await expect(topbar(page).getByRole('button', { name: 'Cuenta y sincronización' })).toBeVisible();
  await expect(topbar(page).getByRole('button', { name: 'Iniciar sesión' })).toHaveCount(0);

  // This test is about work staying local while offline, not about the first download of a lazily loaded editor.
  // Open the tablature editor once while online (its code is then in memory), come back, and only then cut the network.
  await page.locator('.lib-open', { hasText: 'Sigue acá' }).click();
  await expect(cell(page, 1, 1)).toBeVisible();
  await page.getByRole('link', { name: /Volver a la biblioteca/ }).click();
  await expect(page.locator('.lib-open', { hasText: 'Sigue acá' })).toBeVisible();
  await context.setOffline(true);
  await expect(topbar(page).getByText(/Sin conexión/)).toBeVisible();
  await page.locator('.lib-open', { hasText: 'Sigue acá' }).click();
  await cell(page, 1, 1).click();
  await page.keyboard.press('9');
  await expect(cell(page, 1, 1)).toHaveValue('9');
  await settleSave(page);
  await context.setOffline(false);

  await topbar(page).getByRole('button', { name: 'Cuenta y sincronización' }).click();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(topbar(page).getByRole('button', { name: 'Iniciar sesión' })).toBeVisible();
  // v0.8: signing out hides the account's library (nothing is deleted); it comes back, intact, when the account signs in again.
  await page.goto('/biblioteca');
  await expect(page.locator('.lib-open', { hasText: 'Sigue acá' })).toHaveCount(0);
  await expect(page.getByText(/Cerraste sesión/)).toBeVisible();
  await topbar(page).getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.getByRole('dialog').getByLabel('Correo').fill('prueba@guitarap.test');
  await page.getByRole('dialog').getByLabel('Contraseña', { exact: true }).fill('secreto');
  await page.getByRole('dialog').getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.locator('.lib-open', { hasText: 'Sigue acá' })).toBeVisible();
});
