import { expect, test, type Page } from '@playwright/test';

async function createMaterial(page: Page, type: 'tablature' | 'fretboard', name: string) {
  await page.getByRole('button', { name: 'Nuevo material' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Tipo').selectOption(type);
  await dialog.getByLabel('Nombre').fill(name);
  await dialog.getByRole('button', { name: 'Crear' }).click();
}

test('creates a reflowing tablature and preserves editing in practice mode', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/biblioteca');
  await createMaterial(page, 'tablature', 'Riff con acordes');
  await expect(page.getByLabel('Título de tablatura')).toHaveValue('Riff con acordes');
  await page.getByRole('textbox', { name: 'Cuerda 6, columna 1', exact: true }).fill('12');
  await page.getByRole('textbox', { name: 'Cuerda 5, columna 1', exact: true }).fill('10');
  await page.getByRole('button', { name: /slide up/i }).click();
  await page.getByLabel('Ajuste automático').uncheck();
  await page.getByLabel('Columnas por renglón').selectOption('8');
  await expect(page.locator('.tab-system')).toHaveCount(2);
  await page.screenshot({ path: testInfo.outputPath('tablatura-acorde-tecnica.png'), fullPage: true });
  await page.getByRole('link', { name: /^Práctica/ }).click();
  await expect(page.getByRole('heading', { name: 'Modo Práctica' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('practica.png'), fullPage: true });
});

test('edits three fretboard positions and captures all views', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/biblioteca');
  await createMaterial(page, 'fretboard', 'Do mayor');
  await page.getByLabel('Tónica').selectOption('0');
  await page.getByTestId('fret-0-8').click();
  await page.getByTestId('fret-1-5').click();
  await page.getByRole('button', { name: '+ Posición' }).click();
  await page.getByLabel('Nombre de posición').fill('Posición 2');
  await page.getByTestId('fret-2-2').click();
  await page.getByRole('button', { name: '+ Posición' }).click();
  await page.getByLabel('Nombre de posición').fill('Posición 3');
  await page.getByTestId('fret-3-10').click();
  await page.screenshot({ path: testInfo.outputPath('diapason-individual.png'), fullPage: true });
  await page.getByRole('button', { name: 'Conjunta' }).click();
  await page.screenshot({ path: testInfo.outputPath('diapason-conjunta.png'), fullPage: true });
  await page.getByRole('button', { name: 'Completa' }).click();
  await page.screenshot({ path: testInfo.outputPath('diapason-completa.png'), fullPage: true });
});

test('creates a folder with an integrated creation dialog', async ({ page }, testInfo) => {
  await page.goto('/biblioteca');
  await page.getByRole('button', { name: 'Nueva carpeta' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre').fill('Escalas');
  await page.screenshot({ path: testInfo.outputPath('dialogo-creacion-carpeta.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Crear' }).click();
  await expect(page.getByRole('button', { name: /Escalas/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('biblioteca.png'), fullPage: true });
});
