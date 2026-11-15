import { expect, test, type Page } from '@playwright/test';

type SeedDocument = Record<string, unknown>;

async function seedDocument(page: Page, document: SeedDocument) {
  await page.goto('/biblioteca');
  await page.evaluate(
    async (value) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('guitarap');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const transaction = request.result.transaction('documents', 'readwrite');
          transaction.objectStore('documents').put(value);
          transaction.oncomplete = () => {
            request.result.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
    document,
  );
}

function tablatureSeed(): SeedDocument {
  const columns = Array.from({ length: 200 }, (_, index) => ({
    id: `column-${index}`,
    lineBreak: index === 16 || index === 100,
    cells: Array.from({ length: 6 }, (_, string) => {
      if (index === 0 && string === 0) return { fret: 12 };
      if (index === 0 && string === 1) return { fret: 10 };
      if (index === 15 && string === 0) return { fret: 7, techniques: ['slide-up'] };
      if (index === 16 && string === 0) return { fret: 9, techniques: ['slide-up'] };
      if (index % 11 === 0 && string === index % 6) return { fret: index % 2 ? 5 : 12 };
      return {};
    }),
  }));
  return {
    id: 'validation-tab',
    nodeId: null,
    type: 'tablature',
    title: 'Validación · 200 columnas',
    content: {
      tuning: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'],
      columns,
      zoom: 1,
      wrapAfter: 24,
      annotations: [],
      techniqueLinks: [
        {
          id: 'cross-system-slide',
          technique: 'slide-up',
          from: { columnId: 'column-15', string: 0 },
          to: { columnId: 'column-16', string: 0 },
        },
      ],
    },
    rev: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

test('validates 200-column tablature reflow, navigation, history and persistence', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await seedDocument(page, tablatureSeed());
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/tablaturas/validation-tab');
  await expect.poll(() => page.locator('.tab-system').count()).toBeGreaterThan(1);
  await expect(page.getByRole('textbox', { name: 'Cuerda 1, columna 1', exact: true })).toHaveValue(
    '12',
  );
  await expect(page.getByRole('textbox', { name: 'Cuerda 2, columna 1', exact: true })).toHaveValue(
    '10',
  );
  await expect(page.locator('.technique-mark')).toHaveCount(2);
  await expect(page.getByTestId('tech-link-cross-system-slide')).toContainText('/→17');
  await page.getByRole('textbox', { name: 'Cuerda 1, columna 16', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(
    page.getByRole('textbox', { name: 'Cuerda 1, columna 17', exact: true }),
  ).toBeFocused();
  await page.getByRole('textbox', { name: 'Cuerda 1, columna 1', exact: true }).fill('11');
  await page.getByRole('button', { name: 'Deshacer' }).click();
  await expect(page.getByRole('textbox', { name: 'Cuerda 1, columna 1', exact: true })).toHaveValue(
    '12',
  );
  await page.getByRole('button', { name: 'Rehacer' }).click();
  await expect(page.getByRole('textbox', { name: 'Cuerda 1, columna 1', exact: true })).toHaveValue(
    '11',
  );
  await page.screenshot({ path: testInfo.outputPath('tablatura-200-1366.png'), fullPage: true });
  const systems1366 = await page.locator('.tab-system').count();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect.poll(() => page.locator('.tab-system').count()).toBeLessThan(systems1366);
  await page.screenshot({ path: testInfo.outputPath('tablatura-200-1920.png'), fullPage: true });
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Cuerda 1, columna 1', exact: true })).toHaveValue(
    '11',
  );
  await expect(
    page.getByRole('textbox', { name: 'Cuerda 1, columna 17', exact: true }),
  ).toHaveValue('9');
});

test('validates three C-major positions, labels, isolation and persistence', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/biblioteca');
  await page.getByRole('button', { name: 'Nuevo material' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Tipo').selectOption('fretboard');
  await dialog.getByLabel('Nombre').fill('Do mayor · tres posiciones');
  await dialog.getByRole('button', { name: 'Crear' }).click();
  await page.getByLabel('Tónica').selectOption('0');
  await page.getByTestId('fret-0-8').click();
  await page.getByTestId('fret-1-5').click();
  await page.getByTestId('fret-2-5').click();
  await expect(page.getByTestId('fret-0-8')).toContainText('C');
  await page.getByLabel('Etiqueta de nota').selectOption('finger');
  await expect(page.getByTestId('fret-0-8')).toContainText('1');
  await page.getByLabel('Etiqueta de nota').selectOption('theory');
  await page.getByRole('button', { name: '+ Posición' }).click();
  await page.getByLabel('Nombre de posición').fill('Posición 2');
  await page.getByTestId('fret-4-7').click();
  await page.getByRole('button', { name: '+ Posición' }).click();
  await page.getByLabel('Nombre de posición').fill('Posición 3');
  await page.getByTestId('fret-3-10').click();
  await page.getByText('Posición 2', { exact: true }).click();
  await page.getByTestId('fret-4-7').click();
  await expect(page.getByTestId('fret-4-7').locator('[data-note-marker]')).toHaveAttribute(
    'fill',
    'transparent',
  );
  await page.getByText('Posición 1', { exact: true }).click();
  await expect(page.getByTestId('fret-1-5')).toContainText('E');
  const noteX = await page.getByTestId('fret-0-8').locator('[data-note-marker]').getAttribute('cx');
  const fretWireX = await page.getByTestId('fretwire-8').getAttribute('x1');
  expect(Number(noteX)).toBeLessThan(Number(fretWireX));
  await page.screenshot({
    path: testInfo.outputPath('diapason-do-mayor-individual.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Conjunta' }).click();
  await expect(page.getByTestId('combined-positions').locator('figure')).toHaveCount(3);
  await page.screenshot({
    path: testInfo.outputPath('diapason-do-mayor-conjunta.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Completa' }).click();
  await page.screenshot({
    path: testInfo.outputPath('diapason-do-mayor-completa.png'),
    fullPage: true,
  });
  await page.waitForTimeout(800);
  await page.reload();
  await page.getByText('Posición 2', { exact: true }).click();
  await expect(page.getByTestId('fret-4-7').locator('[data-note-marker]')).toHaveAttribute(
    'fill',
    'transparent',
  );
});

test('keeps six spatial notes on the low E string after closing and reopening', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/biblioteca');
  await page.getByRole('button', { name: 'Nuevo material' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Tipo').selectOption('fretboard');
  await dialog.getByLabel('Nombre').fill('Escala de Do mayor');
  await dialog.getByRole('button', { name: 'Crear' }).click();
  await page.getByLabel('Tónica').selectOption('0');
  await page.getByLabel('Rango de trastes').selectOption('15');

  const frets = [0, 1, 3, 5, 7, 8];
  for (const fret of frets) await page.getByTestId(`fret-5-${fret}`).click();
  await page.getByTestId('fret-4-3').click();
  await page.getByTestId('fret-3-5').click();
  for (const fret of frets)
    await expect(page.getByTestId(`fret-5-${fret}`).locator('[data-note-marker]')).toHaveAttribute(
      'r',
      '14',
    );
  await page.getByTestId('fret-5-1').click();
  await expect(page.getByTestId('fret-5-1').locator('[data-note-marker]')).toHaveAttribute(
    'fill',
    'transparent',
  );
  for (const fret of [0, 3, 5, 7, 8])
    await expect(page.getByTestId(`fret-5-${fret}`).locator('[data-note-marker]')).toHaveAttribute(
      'r',
      '14',
    );
  await page.getByTestId('fret-5-1').click();
  await page.screenshot({
    path: testInfo.outputPath('mapa-do-mayor-seis-notas-misma-cuerda.png'),
    fullPage: true,
  });

  await page.waitForTimeout(850);
  await page.getByRole('link', { name: 'Biblioteca' }).click();
  await page.getByText('Escala de Do mayor', { exact: true }).click();
  for (const fret of frets)
    await expect(page.getByTestId(`fret-5-${fret}`).locator('[data-note-marker]')).toHaveAttribute(
      'r',
      '14',
    );
  await expect(page.getByTestId('fret-4-3').locator('[data-note-marker]')).toHaveAttribute(
    'r',
    '14',
  );
  await expect(page.getByTestId('fret-3-5').locator('[data-note-marker]')).toHaveAttribute(
    'r',
    '14',
  );
  await expect(page.getByTestId('fret-5-8')).toHaveAttribute(
    'aria-label',
    /Cuerda 6, traste 8: C, intervalo 1/,
  );

  const pngDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PNG' }).click();
  expect((await pngDownload).suggestedFilename()).toBe('Escala de Do mayor.png');
  const pdfDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF' }).click();
  expect((await pdfDownload).suggestedFilename()).toBe('Escala de Do mayor.pdf');

  await page.getByRole('link', { name: /^Práctica/ }).click();
  await page.getByLabel('Material').selectOption({ label: 'Mapa · Escala de Do mayor' });
  for (const fret of frets)
    await expect(page.getByTestId(`fret-5-${fret}`).locator('[data-note-marker]')).toHaveAttribute(
      'r',
      '14',
    );
  await page.getByRole('button', { name: 'Modo foco' }).click();
  await page.screenshot({
    path: testInfo.outputPath('practica-mapa-do-mayor-foco.png'),
    fullPage: true,
  });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Modo foco' })).toBeVisible();
});
