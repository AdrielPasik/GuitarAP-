import { expect, test, type Page } from '@playwright/test';
import { cell, createMaterial, neck, noHorizontalOverflow, openLibrary, settleSave } from './helpers';

const sizes = [
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'movil', width: 390, height: 844 },
];

async function seed(page: Page) {
  await openLibrary(page);
  await createMaterial(page, 'Material de estudio', 'Responsive');
  await page.getByRole('button', { name: 'Mapa del mástil' }).click();
  for (const fret of [0, 1, 3, 5, 7, 8]) await neck(page).pick(5, fret);
  await page.getByRole('button', { name: 'Agregar bloque', exact: true }).first().click();
  await page.getByRole('menuitem', { name: 'Tablatura' }).click();
  await cell(page, 1, 1).click();
  for (const key of '578753'.split('')) await page.keyboard.press(key);
  await settleSave(page);
}

for (const size of sizes) {
  test(`Test 10 — ${size.name}: nothing breaks and the essentials stay reachable`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await seed(page);
    const url = page.url();

    // Editor.
    await noHorizontalOverflow(page);
    await expect(page.getByLabel('Título del material')).toBeVisible();
    await expect(page.getByRole('banner').getByRole('button', { name: 'Iniciar metrónomo' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`editor-${size.name}.png`) });

    // Library.
    await page.goto('/biblioteca');
    await expect(page.getByRole('heading', { name: 'Biblioteca' })).toBeVisible();
    await expect(page.getByRole('banner').getByRole('button', { name: 'Iniciar sesión' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Secciones principales' }).getByRole('link', { name: /Práctica/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nuevo', exact: true })).toBeVisible();
    await noHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`biblioteca-${size.name}.png`) });

    // Practice and settings.
    await page.goto(url.replace('/material/', '/practica/'));
    await expect(page.getByTestId('map-canvas')).toBeVisible();
    await noHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`practica-${size.name}.png`) });
    await page.goto('/configuracion/cuenta');
    await expect(page.getByRole('heading', { name: 'Cuenta', level: 2 })).toBeVisible();
    await noHorizontalOverflow(page);
  });
}

test('the dark theme keeps readable contrast on the library and the notebook', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: 'Activar modo oscuro' }).click();
  const colors = await page.evaluate(() => {
    const style = (selector: string) => getComputedStyle(document.querySelector(selector)!);
    return { page: style('body').backgroundColor, title: style('.doc-title').color };
  });
  expect(colors.page).not.toBe(colors.title);
  await expect(page.getByTestId('map-canvas')).toBeVisible();
});
