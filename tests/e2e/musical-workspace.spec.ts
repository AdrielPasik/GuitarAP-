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

test('edits one tablature through sequential, fretboard and combined views', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await createTablature(page);

  await expect(page.getByRole('group', { name: 'Modo de edición' })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('editor-secuencial-redisenado.png'),
    fullPage: true,
  });

  await page.getByRole('button', { name: 'Mástil' }).click();
  await expect(page.getByRole('heading', { name: 'Mástil interactivo' })).toBeVisible();
  await page.getByLabel('Trastes visibles').selectOption('24');
  await expect(page.getByTestId('tab-fret-0-24')).toBeVisible();
  await page.getByLabel('Trastes visibles').selectOption('12');
  const autoAdvance = page.getByLabel('Avanzar automáticamente después de cada nota');
  await expect(autoAdvance).not.toBeChecked();

  // Un acorde: tres notas simultáneas, siempre sobre la misma columna.
  await page.getByTestId('tab-fret-0-5').click();
  await page.getByTestId('tab-fret-1-3').click();
  await page.getByTestId('tab-fret-2-2').click();
  await expect(page.getByTestId('tab-fret-0-5')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('tab-fret-1-3')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('tab-fret-2-2')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Seleccionar columna 1', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText('3 notas', { exact: true })).toBeVisible();

  // Eliminar y volver a agregar una nota no cambia la columna activa.
  await page.getByTestId('tab-fret-1-3').click();
  await expect(page.getByTestId('tab-fret-1-3')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Seleccionar columna 1', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByTestId('tab-fret-1-3').click();
  await page.screenshot({
    path: testInfo.outputPath('editor-mastil-entrada-real.png'),
    fullPage: true,
  });

  // Navegación explícita y por teclado.
  await page.getByRole('button', { name: 'Columna siguiente' }).click();
  await expect(page.getByRole('button', { name: 'Seleccionar columna 2', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const fretPanel = page.getByRole('region', { name: 'Entrada visual por mástil' });
  await fretPanel.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('button', { name: 'Seleccionar columna 1', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Columna siguiente' }).click();

  // Una melodía: cada nota ingresada avanza exactamente una columna.
  await autoAdvance.check();
  await page.getByTestId('tab-fret-0-7').click();
  await expect(page.getByRole('button', { name: 'Seleccionar columna 3', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByTestId('tab-fret-1-8').click();
  await expect(page.getByRole('button', { name: 'Seleccionar columna 4', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Combinada' }).click();
  await expect(page.getByRole('button', { name: 'Seleccionar columna 4', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('textbox', { name: 'Cuerda 6, columna 1', exact: true })).toHaveValue(
    '5',
  );
  await expect(page.getByRole('textbox', { name: 'Cuerda 5, columna 1', exact: true })).toHaveValue(
    '3',
  );
  await expect(page.getByRole('textbox', { name: 'Cuerda 4, columna 1', exact: true })).toHaveValue(
    '2',
  );
  await expect(page.getByRole('textbox', { name: 'Cuerda 6, columna 2', exact: true })).toHaveValue(
    '7',
  );
  await expect(page.getByRole('textbox', { name: 'Cuerda 5, columna 3', exact: true })).toHaveValue(
    '8',
  );
  await page.screenshot({
    path: testInfo.outputPath('editor-vista-combinada.png'),
    fullPage: true,
  });

  await page.waitForTimeout(850);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Cuerda 6, columna 1', exact: true })).toHaveValue(
    '5',
  );
  await expect(page.getByRole('textbox', { name: 'Cuerda 6, columna 2', exact: true })).toHaveValue(
    '7',
  );
  await expect(page.getByRole('textbox', { name: 'Cuerda 5, columna 3', exact: true })).toHaveValue(
    '8',
  );
  await page.getByRole('link', { name: /Biblioteca/ }).click();
  await page.getByRole('button', { name: /Ideas musicales/ }).click();
  await expect(page.getByText('Frase visual', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('biblioteca-redisenada.png'), fullPage: true });

  await page.getByRole('button', { name: 'Activar modo oscuro' }).click();
  await page.waitForTimeout(200);
  await page.screenshot({
    path: testInfo.outputPath('biblioteca-redisenada-oscura.png'),
    fullPage: true,
  });
});
