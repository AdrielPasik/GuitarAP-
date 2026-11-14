import { expect, test } from '@playwright/test';

test('creates a tablature, edits it and opens it in practice mode', async ({ page }) => {
  await page.goto('/biblioteca');
  await page.getByRole('button', { name: '+ Tablatura' }).click();
  await expect(page.getByLabel('Título de tablatura')).toBeVisible();
  const firstCell = page.getByRole('textbox', { name: 'Cuerda 6, columna 1', exact: true });
  await firstCell.fill('12');
  await expect(firstCell).toHaveValue('12');
  await expect(page.getByRole('button', { name: 'Deshacer' })).toBeEnabled();
  await page.getByRole('link', { name: /^Práctica/ }).click();
  await expect(page.getByRole('heading', { name: 'Modo Práctica' })).toBeVisible();
  await expect(page.getByLabel('Título de tablatura')).toHaveValue('Nueva tablatura');
  await page.getByRole('button', { name: 'Modo foco' }).click();
  await expect(page.getByRole('button', { name: 'Salir foco' })).toBeVisible();
});

test('creates a fretboard and switches presentation views', async ({ page }) => {
  await page.goto('/biblioteca');
  await page.getByRole('button', { name: '+ Diapasón' }).click();
  await expect(page.getByRole('img', { name: 'Diapasón interactivo' })).toBeVisible();
  await page.getByRole('button', { name: 'Conjunta' }).click();
  await expect(page.getByRole('button', { name: 'Conjunta' })).toHaveClass(/border-amber-600/);
  await page.getByRole('button', { name: '+ Posición' }).click();
  await expect(page.getByLabel('Nombre de posición')).toHaveValue('Posición 2');
});
