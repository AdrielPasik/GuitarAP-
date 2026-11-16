import { expect, test } from '@playwright/test';
import { createMaterial, neck, openLibrary, settleSave } from './helpers';

const ghosts = (page: import('@playwright/test').Page) => page.locator('[data-testid^="marker-"][data-tone="ghost"]');
const real = (page: import('@playwright/test').Page) => page.locator('[data-testid^="marker-"]:not([data-tone="ghost"])');
const guide = (page: import('@playwright/test').Page) => page.getByRole('switch', { name: 'Ayuda de escala' });

test('Ayuda de escala: hints are visual only, the preference persists and notes stay intact', async ({ page }) => {
  await openLibrary(page);
  await createMaterial(page, 'Mapa de escala', 'Do jónico');
  const board = neck(page);

  // A new map starts without hints.
  await expect(guide(page)).toHaveAttribute('aria-checked', 'false');
  for (const [s, f] of [[5, 0], [5, 1], [4, 3]]) await board.pick(s, f);
  await page.getByRole('button', { name: 'Agregar posición' }).click();
  await expect(ghosts(page)).toHaveCount(0);

  // Marking with the help off adds only real notes, and changing fret range does not bring hints back.
  await board.pick(3, 2);
  await board.pick(3, 3);
  await expect(real(page)).toHaveCount(2);
  await page.getByRole('button', { name: 'Trastes visibles' }).click();
  await page.getByLabel('Último traste').fill('12');
  await page.keyboard.press('Escape');
  await expect(ghosts(page)).toHaveCount(0);

  // Turning it on shows the other position's notes as dashed hints, next to the real ones.
  await guide(page).click();
  await expect(guide(page)).toHaveAttribute('aria-checked', 'true');
  await expect(ghosts(page)).toHaveCount(3);
  await expect(real(page)).toHaveCount(2);

  // Turning it off again leaves the real notes untouched.
  await guide(page).click();
  await expect(ghosts(page)).toHaveCount(0);
  await expect(real(page)).toHaveCount(2);
  await settleSave(page);

  // The preference and the notes survive a reload and switching position.
  await page.reload();
  await expect(guide(page)).toHaveAttribute('aria-checked', 'false');
  await expect(real(page)).toHaveCount(2);
  await page.getByRole('tab', { name: 'Posición 1' }).click();
  await expect(ghosts(page)).toHaveCount(0);
  await expect(real(page)).toHaveCount(3);
});
