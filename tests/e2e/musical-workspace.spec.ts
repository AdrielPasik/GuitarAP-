import { expect, test, type Page } from '@playwright/test';

async function createTablature(page: Page) {
  await page.goto('/biblioteca');
  await page.getByRole('button', { name: 'Nueva carpeta' }).click();
  await page.getByRole('dialog').getByLabel('Nombre').fill('Ideas musicales');
  await page.getByRole('dialog').getByRole('button', { name: 'Crear' }).click();
  await page.getByRole('button', { name: /Ideas musicales/ }).click();
  await page.getByRole('button', { name: 'Nuevo material' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Tipo').selectOption('tablature');
  await dialog.getByLabel('Nombre').fill('Frase visual');
  await dialog.getByRole('button', { name: 'Crear' }).click();
}

test('edits one tablature through sequential, fretboard and combined views', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await createTablature(page);

  await expect(page.getByRole('group', { name: 'Modo de edición' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('editor-secuencial-redisenado.png'), fullPage: true });

  await page.getByRole('button', { name: 'Mástil' }).click();
  await expect(page.getByRole('heading', { name: 'Mástil interactivo' })).toBeVisible();
  await page.getByLabel('Trastes visibles').selectOption('24');
  await expect(page.getByTestId('tab-fret-0-24')).toBeVisible();
  await page.getByLabel('Trastes visibles').selectOption('12');
  await page.getByTestId('tab-fret-0-5').click();
  await page.getByTestId('tab-fret-1-3').click();
  await expect(page.getByTestId('tab-fret-0-5')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('tab-fret-1-3')).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: testInfo.outputPath('editor-mastil-entrada-real.png'), fullPage: true });

  await page.getByRole('button', { name: 'Seleccionar columna 2' }).click();
  await page.getByTestId('tab-fret-0-7').click();
  await page.getByRole('button', { name: 'Combinada' }).click();
  await expect(page.getByRole('textbox', { name: 'Cuerda 6, columna 1', exact: true })).toHaveValue('5');
  await expect(page.getByRole('textbox', { name: 'Cuerda 5, columna 1', exact: true })).toHaveValue('3');
  await expect(page.getByRole('textbox', { name: 'Cuerda 6, columna 2', exact: true })).toHaveValue('7');
  await page.screenshot({ path: testInfo.outputPath('editor-vista-combinada.png'), fullPage: true });

  await page.waitForTimeout(850);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Cuerda 6, columna 1', exact: true })).toHaveValue('5');
  await expect(page.getByRole('textbox', { name: 'Cuerda 6, columna 2', exact: true })).toHaveValue('7');
  await page.getByRole('link', { name: /Biblioteca/ }).click();
  await page.getByRole('button', { name: /Ideas musicales/ }).click();
  await expect(page.getByText('Frase visual', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('biblioteca-redisenada.png'), fullPage: true });

  await page.getByRole('button', { name: 'Activar modo oscuro' }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: testInfo.outputPath('biblioteca-redisenada-oscura.png'), fullPage: true });
});
