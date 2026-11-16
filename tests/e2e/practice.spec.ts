import { expect, test, type Page } from '@playwright/test';
import { cell, createMaterial, neck, openLibrary, settleSave } from './helpers';

async function seedStudyMaterial(page: Page) {
  await openLibrary(page);
  await createMaterial(page, 'Material de estudio', 'Pentatónica menor de La');
  await page.getByRole('button', { name: 'Mapa del mástil' }).click();
  for (const fret of [5, 8]) await neck(page).pick(5, fret);
  await page.getByRole('button', { name: 'Agregar bloque', exact: true }).first().click();
  await page.getByRole('menuitem', { name: 'Título de sección' }).click();
  await page.getByLabel('Título de sección').fill('Lick relacionado');
  await page.getByRole('button', { name: 'Agregar bloque', exact: true }).first().click();
  await page.getByRole('menuitem', { name: 'Tablatura' }).click();
  await cell(page, 1, 1).click();
  for (const key of ['5', '8', '5']) await page.keyboard.press(key);
  await settleSave(page);
}

test('Test 8 — practice shows scale and tablature read-only, with focus mode, zoom and the metronome', async ({ page }) => {
  await seedStudyMaterial(page);
  await page.getByRole('link', { name: 'Practicar' }).click();
  await page.waitForURL(/\/practica\//);

  // Both kinds of music, nothing editable.
  await expect(page.getByRole('heading', { name: 'Pentatónica menor de La', level: 2 })).toBeVisible();
  await expect(page.getByTestId('map-canvas').getByTestId('marker-5-5')).toBeVisible();
  await expect(page.getByText('Lick relacionado')).toBeVisible();
  await expect(page.locator('.tb-fret.static').filter({ hasText: '8' }).first()).toBeVisible();
  await expect(page.getByRole('textbox', { name: /Cuerda 1, columna/ })).toHaveCount(0);
  await expect(page.locator('.nb-chrome')).toHaveCount(0);
  await expect(page.getByTestId('fret-5-3')).toHaveCount(0); // the neck is not clickable

  // Zoom.
  const zoom = page.getByLabel('Tamaño actual');
  const before = await zoom.innerText();
  await page.getByRole('button', { name: 'Aumentar tamaño' }).click();
  expect(await zoom.innerText()).not.toBe(before);

  // Section navigation.
  await page.getByRole('button', { name: 'Ir a una sección' }).click();
  await page.getByRole('menuitem', { name: 'Lick relacionado' }).click();

  // The metronome works without leaving.
  const play = page.getByRole('banner').getByRole('button', { name: 'Iniciar metrónomo' });
  await play.click();
  await expect(page.getByRole('banner').getByRole('button', { name: 'Detener metrónomo' })).toHaveAttribute('aria-pressed', 'true');

  // Focus mode removes the interface, keeps a slim metronome strip, and Escape leaves.
  await page.getByRole('button', { name: 'Modo foco' }).click();
  await expect(page.getByRole('banner')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Modo foco', exact: true })).toHaveCount(0);
  const strip = page.getByRole('group', { name: 'Metrónomo' });
  await expect(strip).toBeVisible();
  await expect(strip.getByRole('button', { name: 'Detener metrónomo' })).toBeVisible();
  const stage = await page.locator('.practice-stage').boundingBox();
  const footer = await page.locator('.practice-foot').boundingBox();
  expect(stage!.y + stage!.height).toBeLessThanOrEqual(footer!.y + 1); // nothing floats over the music
  await page.keyboard.press('Escape');
  await expect(page.getByRole('banner')).toBeVisible();
  await strip.getByRole('button', { name: 'Detener metrónomo' }).first().click().catch(() => undefined);

  // Reading changed nothing.
  await page.getByRole('link', { name: 'Editar' }).click();
  await expect(cell(page, 1, 1)).toHaveValue('5');
  for (const fret of [5, 8]) await expect(neck(page).marker(5, fret)).toBeVisible();
});

test('practice moves between materials and remembers what you were reading', async ({ page }) => {
  await openLibrary(page);
  await createMaterial(page, 'Tablatura', 'Intro');
  await settleSave(page);
  await page.goto('/biblioteca');
  await createMaterial(page, 'Mapa de escala', 'Solo');
  await settleSave(page);
  await page.goto('/practica');
  await expect(page.getByRole('heading', { level: 2 })).toBeVisible();
  // Materials are ordered by name: Intro < Solo. Practice opens on the most recent one (Solo).
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Solo');
  await expect(page.getByRole('button', { name: 'Material siguiente' })).toBeDisabled();
  await page.getByRole('button', { name: 'Material anterior' }).click();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Intro');
  await page.getByRole('button', { name: 'Material siguiente' }).click();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Solo');
  await page.reload();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Solo');
});
