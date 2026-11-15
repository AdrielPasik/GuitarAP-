import { expect, test, type Download, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function readBackup(download: Download) {
  const path = await download.path();
  if (!path) throw new Error('Playwright no pudo acceder al archivo descargado.');
  return JSON.parse(await readFile(path, 'utf8')) as {
    schema: number;
    nodes: unknown[];
    documents: unknown[];
    versions: unknown[];
  };
}

async function createLibraryWithHistory(page: Page) {
  await page.goto('/biblioteca');
  await page.getByRole('button', { name: 'Nueva carpeta' }).click();
  await page.getByRole('dialog').getByLabel('Nombre').fill('Backup E2E');
  await page.getByRole('dialog').getByRole('button', { name: 'Crear' }).click();
  await page.getByRole('button', { name: /Backup E2E/ }).click();
  await page.getByRole('button', { name: 'Nuevo material' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Tipo').selectOption('tablature');
  await dialog.getByLabel('Nombre').fill('Documento con historial');
  await dialog.getByRole('button', { name: 'Crear' }).click();
  await page.getByRole('textbox', { name: 'Cuerda 1, columna 1', exact: true }).fill('12');
  await page.waitForTimeout(900);
}

test('downloads valid backups and links only after explicit confirmation', async ({
  page,
}, testInfo) => {
  await page.route('**/auth/v1/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: 'e2e-access-token',
        refresh_token: 'e2e-refresh-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: 'e2e-user', email: 'e2e@guitarap.test' },
      }),
    });
  });
  await createLibraryWithHistory(page);
  await page.goto('/configuracion');
  await page.getByLabel('Email de cuenta').fill('e2e@guitarap.test');
  await page.getByLabel('Contraseña de cuenta').fill('password-for-mocked-auth');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByText('Backup requerido antes del primer sincronizado.')).toBeVisible();

  const firstDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar backup', exact: true }).click();
  const firstBackup = await readBackup(await firstDownloadPromise);
  expect(firstBackup.schema).toBe(1);
  expect(firstBackup.nodes).toHaveLength(1);
  expect(firstBackup.documents).toHaveLength(1);
  expect(firstBackup.versions.length).toBeGreaterThanOrEqual(1);
  await expect(page.getByText(/Contenido verificado:/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sincronizar ahora' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Confirmar backup y habilitar' })).toBeDisabled();

  await page.getByLabel(/Confirmo que Chrome guardó/).check();
  await page.getByRole('button', { name: 'Confirmar backup y habilitar' }).click();
  await expect(page.getByRole('button', { name: 'Sincronizar ahora' })).toBeVisible();

  const secondDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar JSON' }).click();
  const secondBackup = await readBackup(await secondDownloadPromise);
  expect(secondBackup.nodes).toHaveLength(1);
  expect(secondBackup.documents).toHaveLength(1);
  expect(secondBackup.versions.length).toBeGreaterThanOrEqual(1);
  await page.screenshot({
    path: testInfo.outputPath('configuracion-backup-sincronizacion.png'),
    fullPage: true,
  });

  await page.goto('/biblioteca');
  await page.getByRole('button', { name: 'Activar modo oscuro' }).click();
  const card = page.locator('.document-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Documento con historial');
  await page.waitForTimeout(250);
  const colors = await card.evaluate((element) => {
    const style = getComputedStyle(element);
    const title = getComputedStyle(element.querySelector('strong')!);
    return { background: style.backgroundColor, text: title.color };
  });
  expect(colors.background).not.toBe('rgb(255, 255, 255)');
  expect(colors.background).not.toBe(colors.text);
  await page.screenshot({
    path: testInfo.outputPath('biblioteca-oscura-contraste.png'),
    fullPage: true,
  });
});
