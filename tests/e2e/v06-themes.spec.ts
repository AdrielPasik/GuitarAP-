import { expect, test, type Page } from '@playwright/test';
import { openLibrary } from './helpers';

const SKINS = ['estudio', 'britanico', 'newwave', 'psicodelico', 'vinilo', 'cuaderno'] as const;

/** WCAG relative luminance contrast between two #rrggbb colours. */
const contrast = (a: string, b: string) => {
  const lum = (raw: string) => {
    const hex = raw.length === 4 ? `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}` : raw; // #fff -> #ffffff
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

async function tokens(page: Page, skin: string, theme: 'light' | 'dark') {
  return page.evaluate(
    ({ skin, theme }) => {
      document.documentElement.dataset.skin = skin;
      document.documentElement.dataset.theme = theme;
      const style = getComputedStyle(document.documentElement);
      const read = (name: string) => style.getPropertyValue(name).trim();
      return Object.fromEntries(['--bg', '--surface', '--raised', '--ink', '--ink-2', '--ink-3', '--accent', '--accent-ink', '--on-accent', '--h-root', '--h-third', '--h-fifth', '--h-seventh', '--h-ink'].map((name) => [name, read(name)]));
    },
    { skin, theme },
  );
}

test.setTimeout(120_000); // long, real-time scenarios: the machine running them may be slow

test('Escenario E — los temas musicales: se eligen con vista previa, persisten, no cambian los colores armónicos y mantienen el contraste', async ({ page }) => {
  await openLibrary(page);
  await page.goto('/configuracion/apariencia');

  // Three universes, each previewed before choosing.
  const group = page.getByRole('group', { name: 'Universo visual' });
  await expect(group.getByRole('button', { name: /Estudio analógico/ })).toHaveAttribute('aria-pressed', 'true'); // the default is the look the app had
  // v0.7: a click previews the universe on the whole app without saving; «Cancelar» returns, «Aplicar» keeps it.
  await group.getByRole('button', { name: /Rock británico/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'britanico');
  expect(await page.evaluate(() => window.localStorage.getItem('guitarap.pref.appearance.skin'))).toBeNull();
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'estudio');
  await group.getByRole('button', { name: /Psicodelia/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'psicodelico');
  await page.getByRole('button', { name: /Aplicar Psychedelic Universe/ }).click();

  // It persists across a reload and across screens (and before React paints: no flash of another look).
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'psicodelico');
  await page.goto('/biblioteca');
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'psicodelico');
  expect(await page.evaluate(() => window.localStorage.getItem('guitarap.pref.appearance.skin'))).toBe('"psicodelico"');

  // Harmonic colours are identical in every skin; text and controls stay readable in light and dark.
  const reference = await tokens(page, 'estudio', 'light');
  for (const theme of ['light', 'dark'] as const) {
    for (const skin of SKINS) {
      const t = await tokens(page, skin, theme);
      for (const name of ['--h-root', '--h-third', '--h-fifth', '--h-seventh', '--h-ink'] as const) {
        const base = (await tokens(page, 'estudio', theme))[name];
        expect(t[name], `${name} in ${skin}/${theme}`).toBe(base);
      }
      expect(contrast(t['--ink'], t['--bg']), `ink on page, ${skin}/${theme}`).toBeGreaterThanOrEqual(7);
      expect(contrast(t['--ink'], t['--raised']), `ink on card, ${skin}/${theme}`).toBeGreaterThanOrEqual(7);
      expect(contrast(t['--ink-2'], t['--surface']), `secondary text, ${skin}/${theme}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t['--ink-3'], t['--raised']), `tertiary text, ${skin}/${theme}`).toBeGreaterThanOrEqual(3.2);
      expect(contrast(t['--on-accent'], t['--accent']), `button text, ${skin}/${theme}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t['--accent-ink'], t['--raised']), `accent text, ${skin}/${theme}`).toBeGreaterThanOrEqual(4.5);
    }
  }
  expect(reference['--h-root']).toBeTruthy();
});

test('los temas no rompen ninguna pantalla en escritorio, tableta y móvil, y respetan reducir movimiento', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openLibrary(page);
  for (const [width, height] of [[1440, 900], [820, 1180], [390, 844]] as const) {
    await page.setViewportSize({ width, height });
    for (const skin of SKINS) {
      await page.evaluate((value) => window.localStorage.setItem('guitarap.pref.appearance.skin', JSON.stringify(value)), skin);
      for (const route of ['/biblioteca', '/practica', '/configuracion/apariencia']) {
        await page.goto(route);
        await expect(page.locator('html')).toHaveAttribute('data-skin', skin);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${route} in ${skin} at ${width}px`).toBeLessThanOrEqual(0);
      }
    }
  }
  // Reduced motion: the sleeves do not move or animate.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/biblioteca');
  await page.getByRole('button', { name: 'Nuevo', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Carpeta' }).click();
  await page.getByRole('dialog').getByLabel('Nombre').fill('Carpeta de prueba');
  await page.getByRole('dialog').getByRole('button', { name: 'Crear' }).click();
  const sleeve = page.locator('.lib-row.node').first();
  await expect(sleeve).toBeVisible();
  expect(await sleeve.evaluate((node) => getComputedStyle(node).transitionDuration)).toMatch(/^(0s|1e-06s)/); // the global reduced-motion rule makes it effectively instant
});
