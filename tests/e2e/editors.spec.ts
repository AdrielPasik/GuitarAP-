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

test('renders a musical phrase identically in read-only practice after saving', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/biblioteca');
  await createMaterial(page, 'tablature', 'Frases musicales');
  const cell = (string: number, column: number) => page.getByRole('textbox', { name: `Cuerda ${string}, columna ${column}`, exact: true });
  await cell(6, 1).fill('5'); await cell(5, 1).fill('3'); await cell(4, 1).fill('2');
  await cell(6, 2).fill('7'); await cell(5, 2).fill('5'); await cell(4, 2).fill('4');
  await cell(6, 3).fill('8'); await cell(5, 3).fill('6'); await cell(4, 3).fill('5');
  await cell(6, 4).fill('7'); await cell(5, 4).fill('5'); await cell(4, 4).fill('4');
  await cell(6, 5).fill('5'); await cell(5, 5).fill('3'); await cell(4, 5).fill('2');
  await cell(6, 6).fill('3'); await cell(5, 6).fill('1'); await cell(4, 6).fill('0');
  await cell(6, 7).fill('5'); await cell(5, 7).fill('3'); await cell(4, 7).fill('2');
  await cell(6, 8).fill('5'); await cell(6, 9).fill('7'); await cell(5, 9).fill('5'); await cell(4, 9).fill('4');
  await cell(6, 10).fill('8'); await cell(5, 10).fill('6'); await cell(4, 10).fill('5');
  await cell(6, 11).fill('7'); await cell(5, 11).fill('5'); await cell(4, 11).fill('4');
  await cell(6, 12).fill('5'); await cell(5, 12).fill('3'); await cell(4, 12).fill('2');
  await cell(6, 13).fill('3'); await cell(5, 13).fill('1'); await cell(4, 13).fill('0');
  await cell(6, 14).fill('5'); await cell(5, 14).fill('3'); await cell(4, 14).fill('2');
  await cell(6, 15).fill('7'); await cell(5, 15).fill('5'); await cell(4, 15).fill('4');
  await cell(6, 16).fill('8'); await cell(5, 16).fill('6'); await cell(4, 16).fill('5');
  await cell(6, 9).focus(); await page.getByRole('button', { name: 'Salto' }).click();
  await cell(6, 8).click(); await page.getByLabel('Técnica vinculada').selectOption('slide-up'); await page.getByRole('button', { name: 'Enlazar desde selección' }).click(); await cell(6, 9).click();
  await expect(page.locator('.linked-technique.outgoing')).toContainText('/→9');
  await page.getByRole('button', { name: 'Deshacer' }).click(); await expect(page.locator('.linked-technique.outgoing')).toHaveCount(0);
  await page.getByRole('button', { name: 'Rehacer' }).click(); await expect(page.locator('.linked-technique.outgoing')).toContainText('/→9');
  await page.getByLabel('Anotación').fill('Verso'); await page.getByRole('button', { name: 'Añadir sección' }).click();
  await expect(page.locator('.section-mark')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('tablatura-frase-musical-clara.png'), fullPage: true });
  await page.getByRole('button', { name: 'Activar modo oscuro' }).click();
  await page.screenshot({ path: testInfo.outputPath('tablatura-frase-musical-oscura.png'), fullPage: true });
  await page.getByRole('button', { name: 'Activar modo claro' }).click();
  await page.waitForTimeout(900);
  await page.getByRole('link', { name: /^Práctica/ }).click();
  await page.getByLabel('Material').selectOption({ label: 'Tab · Frases musicales' });
  await expect(cell(6, 1)).toHaveValue('5'); await expect(cell(5, 2)).toHaveValue('5'); await expect(page.locator('.linked-technique.outgoing')).toContainText('/→9');
  await expect(cell(6, 1)).toHaveAttribute('readonly', '');
  await page.getByRole('button', { name: 'A+' }).click(); await page.getByRole('button', { name: 'Modo foco' }).click();
  await page.screenshot({ path: testInfo.outputPath('practica-frases-clara.png'), fullPage: true });
  await page.getByRole('button', { name: 'Salir foco' }).click();
  await page.getByRole('button', { name: 'Activar modo oscuro' }).click();
  await page.screenshot({ path: testInfo.outputPath('practica-frases-oscura.png'), fullPage: true });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Modo Práctica' })).toBeVisible(); await expect(cell(6, 1)).toHaveValue('5');
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
  await page.getByRole('button', { name: 'Activar modo oscuro' }).click();
  await page.screenshot({ path: testInfo.outputPath('diapason-completa-oscura.png'), fullPage: true });
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
