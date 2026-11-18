import { expect, test, type Page } from '@playwright/test';
import { createMaterial, openLibrary, settleSave } from './helpers';
import { addPart, createSongProject } from './project-helpers';

const explorer = (page: Page) => page.getByRole('group', { name: 'Explorador de materiales' });
const openExplorer = async (page: Page) => {
  await page.getByRole('button', { name: 'Elegir material para practicar' }).click();
  await expect(explorer(page)).toBeVisible();
};
const title = (page: Page) => page.locator('.practice-title');

test.setTimeout(120_000); // long, real-time scenarios: the machine running them may be slow

test('Escenario A — Práctica respeta las carpetas: Escalas → C Jónico, y la canción → Arreglos, sin mezclar jerarquías', async ({ page }) => {
  await openLibrary(page);
  // The library from the screenshot: a folder with two scales, a song project with two parts, a loose melody.
  await page.getByRole('button', { name: 'Nuevo', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Carpeta' }).click();
  await page.getByRole('dialog').getByLabel('Nombre').fill('Escalas');
  await page.getByRole('dialog').getByRole('button', { name: 'Crear' }).click();
  await page.locator('.lib-row', { hasText: 'Escalas' }).locator('.lib-open').click();
  for (const name of ['C Jónico', 'D Jónico']) {
    await createMaterial(page, 'Mapa de escala', name);
    await settleSave(page);
    await page.getByRole('link', { name: /Volver a la biblioteca/ }).click();
  }
  await createSongProject(page, 'Tema de práctica');
  await addPart(page, 'Letra y melodía', 'Hoy vuelvo a empezar');
  await addPart(page, 'Arreglos', 'Intro con guitarra limpia');
  await page.goto('/biblioteca');
  await createMaterial(page, 'Tablatura', 'Nueva melodía');
  await settleSave(page);

  await page.goto('/practica');
  await openExplorer(page);
  // The root: folders and projects first, and nothing from inside them.
  const root = explorer(page).getByRole('list', { name: 'Contenido de la biblioteca' });
  await expect(root.getByRole('button', { name: 'Carpeta Escalas' })).toBeVisible();
  await expect(root.getByRole('button', { name: 'Canción Tema de práctica' })).toBeVisible();
  await expect(root.getByRole('button', { name: 'Nueva melodía' })).toBeVisible();
  await expect(root.getByText('C Jónico')).toHaveCount(0);
  await expect(root.getByText('Arreglos')).toHaveCount(0);

  // Into Escalas, pick C Jónico.
  await root.getByRole('button', { name: 'Carpeta Escalas' }).click();
  const scales = explorer(page).getByRole('list', { name: 'Contenido de Escalas' });
  await expect(scales.getByRole('button', { name: 'C Jónico' })).toBeVisible();
  await expect(scales.getByRole('button', { name: 'D Jónico' })).toBeVisible();
  await expect(scales.getByText('Arreglos')).toHaveCount(0);
  await scales.getByRole('button', { name: 'C Jónico' }).click();
  await expect(title(page)).toHaveText('C Jónico');

  // Back to the library, into the song, pick Arreglos.
  await openExplorer(page);
  await expect(explorer(page).getByRole('list', { name: 'Contenido de Escalas' })).toBeVisible(); // it opens where you are
  await explorer(page).getByRole('button', { name: 'Subir a la biblioteca' }).click();
  await explorer(page).getByRole('button', { name: 'Canción Tema de práctica' }).click();
  const parts = explorer(page).getByRole('list', { name: 'Contenido de Tema de práctica' });
  await expect(parts.getByRole('button', { name: 'Letra y melodía' })).toBeVisible();
  await expect(parts.getByRole('button', { name: 'C Jónico' })).toHaveCount(0);
  await parts.getByRole('button', { name: 'Arreglos' }).click();
  await expect(title(page)).toHaveText('Arreglos');
  await expect(page.getByText('Intro con guitarra limpia')).toBeVisible();

  // The parts of the project are one click away without walking the library again.
  const nav = page.getByRole('navigation', { name: 'Partes de la canción' });
  await expect(nav.getByRole('button', { name: 'Arreglos' })).toHaveAttribute('aria-current', 'true');
  await nav.getByRole('button', { name: 'Letra y melodía' }).click();
  await expect(title(page)).toHaveText('Letra y melodía');
  await expect(page.getByText('Hoy vuelvo a empezar')).toBeVisible();

  // Search crosses the hierarchy and says where each result lives.
  await openExplorer(page);
  await explorer(page).getByLabel('Buscar material para practicar').fill('jónico');
  await expect(explorer(page).getByRole('list', { name: 'Resultados' }).getByRole('button', { name: /D Jónico/ })).toContainText('Escalas');
});
