import { expect, test, type Page } from '@playwright/test';
import { cell, neck, openLibrary, settleSave } from './helpers';

/** Documents exactly as the previous releases stored them: a bare tablature or fretboard, no blocks. */
const legacyTablature = () => ({
  id: 'legacy-tab',
  nodeId: null,
  type: 'tablature',
  title: 'Riff heredado',
  rev: 4,
  createdAt: 1000,
  updatedAt: 2000,
  content: {
    tuning: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'],
    zoom: 1,
    wrapAfter: 16,
    annotations: ['Verso'],
    columns: Array.from({ length: 6 }, (_, index) => ({
      id: `col-${index}`,
      section: index === 0 ? 'Verso' : undefined,
      cells: Array.from({ length: 6 }, (_, string) => (string === 0 ? { fret: [5, 7, 8, 7, 5, 12][index] } : {})),
    })),
  },
});
const legacyMap = () => ({
  id: 'legacy-map',
  nodeId: null,
  type: 'fretboard',
  title: 'Escala heredada',
  rev: 2,
  createdAt: 1000,
  updatedAt: 3000,
  content: {
    tuning: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'],
    maxFret: 12,
    root: 9,
    notation: 'notes',
    latin: true,
    selectedPositionId: 'pos-1',
    positions: [{ id: 'pos-1', name: 'Posición 1', notes: [{ string: 5, fret: 0, finger: 1 }, { string: 5, fret: 3, finger: 3 }, { string: 5, fret: 5, finger: 4 }] }],
    baseNotes: [{ string: 5, fret: 0, finger: 1 }, { string: 5, fret: 3, finger: 3 }, { string: 5, fret: 5, finger: 4 }],
  },
});

async function seed(page: Page) {
  await openLibrary(page);
  await page.evaluate(
    async (documents) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('guitarap');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const tx = request.result.transaction('documents', 'readwrite');
          documents.forEach((item) => tx.objectStore('documents').put(item));
          tx.oncomplete = () => {
            request.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    [legacyTablature(), legacyMap()],
  );
}
const stored = (page: Page, id: string) =>
  page.evaluate(
    (key) =>
      new Promise<unknown>((resolve, reject) => {
        const request = indexedDB.open('guitarap');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const read = request.result.transaction('documents').objectStore('documents').get(key);
          read.onsuccess = () => {
            request.result.close();
            resolve(read.result);
          };
        };
      }),
    id,
  ) as Promise<{ content: Record<string, unknown>; rev: number }>;

test('materials saved before notebooks open untouched, and stay in their original shape when edited', async ({ page }) => {
  await seed(page);
  await page.reload();
  await expect(page.locator('.lib-open', { hasText: 'Riff heredado' })).toContainText('Tablatura');
  await expect(page.locator('.lib-open', { hasText: 'Escala heredada' })).toContainText('Mapa de escala');

  // Opening and reading does not rewrite anything.
  await page.goto('/tablaturas/legacy-tab'); // old links keep working
  for (const [index, value] of ['5', '7', '8', '7', '5', '12'].entries()) await expect(cell(page, 1, index + 1)).toHaveValue(value);
  await page.waitForTimeout(1200);
  expect((await stored(page, 'legacy-tab')).rev).toBe(4);

  // Editing keeps the legacy shape: older devices can still read it.
  await cell(page, 1, 3).click();
  await page.keyboard.press('Delete');
  await settleSave(page);
  const afterEdit = await stored(page, 'legacy-tab');
  expect(afterEdit.rev).toBeGreaterThan(4);
  expect(afterEdit.content.kind).toBeUndefined();
  expect(Array.isArray(afterEdit.content.columns)).toBe(true);

  await page.goto('/diapason/legacy-map');
  for (const fret of [0, 3, 5]) await expect(neck(page).marker(5, fret)).toBeVisible();
  await expect(neck(page).marker(5, 3)).toHaveAttribute('data-tone', 'note');
  await expect(neck(page).marker(5, 5)).toHaveAttribute('data-tone', 'root'); // A is the tonic
});

test('adding a block to an old material upgrades it without losing the original, which stays in history', async ({ page }) => {
  await seed(page);
  await page.goto('/material/legacy-map');
  await page.getByRole('button', { name: 'Agregar bloque', exact: true }).first().click();
  await page.getByRole('menuitem', { name: 'Tablatura' }).click();
  await cell(page, 1, 1).click();
  await page.keyboard.press('5');
  await settleSave(page);

  const upgraded = await stored(page, 'legacy-map');
  const content = upgraded.content as { kind: string; blocks: Array<{ kind: string; content: { positions?: Array<{ notes: unknown[] }> } }> };
  expect(content.kind).toBe('notebook');
  expect(content.blocks.map((block) => block.kind)).toEqual(['map', 'tablature']);
  expect(content.blocks[0].content.positions?.[0].notes).toHaveLength(3);

  await page.goto('/biblioteca');
  await expect(page.locator('.lib-open', { hasText: 'Escala heredada' })).toContainText('Material de estudio');
  const versions = await page.evaluate(
    () =>
      new Promise<Array<{ content: { kind?: string } }>>((resolve, reject) => {
        const request = indexedDB.open('guitarap');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const read = request.result.transaction('versions').objectStore('versions').getAll();
          read.onsuccess = () => {
            request.result.close();
            resolve(read.result);
          };
        };
      }),
  );
  expect(versions.some((version) => version.content.kind === undefined)).toBe(true);
});
