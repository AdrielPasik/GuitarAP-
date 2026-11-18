import { expect, test, type Page } from '@playwright/test';
import { audioLog, audioProbe, createFolder, createFromMenu, openLibrary, settleSave, storedDocuments } from './helpers';

/**
 * v0.7 — The Musical Universe. Every scenario runs in an isolated, empty browser profile: no real library is involved.
 */
test.setTimeout(150_000);

const row = (page: Page, text: string) => page.locator('.lib-row', { hasText: text });
const customize = (page: Page) => page.getByRole('dialog', { name: /Personalizar/ });
const stored = (page: Page) => page.evaluate(() => JSON.parse(window.localStorage.getItem('guitarap.pref.folder-presentations') ?? '{}'));
const modulesShown = (page: Page) => page.locator('.folder-view > .module').evaluateAll((items) => items.map((item) => item.className.replace('module module-', '')));

/** From the editor back to the folder the material lives in. */
const back = (page: Page) => page.getByRole('link', { name: /Volver a la biblioteca/ }).click();

async function openFolder(page: Page, name: string) {
  await row(page, name).locator('.lib-open').click();
  await expect(page.getByRole('navigation', { name: 'Ubicación' }).getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'page');
}

/** Puts documents straight into the local database (as a restore would), all inside one new folder. */
async function seedFolder(page: Page, folder: { id: string; name: string }, count: number) {
  await page.evaluate(
    async ({ folder, count }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('guitarap');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const tx = request.result.transaction(['nodes', 'documents'], 'readwrite');
          const now = Date.now();
          tx.objectStore('nodes').put({ id: folder.id, parentId: null, kind: 'folder', name: folder.name, order: 0, createdAt: now, updatedAt: now, rev: 1 });
          const keys = ['C', 'G', 'D', 'A', 'E'];
          for (let i = 0; i < count; i += 1) {
            tx.objectStore('documents').put({
              id: `${folder.id}-doc-${i}`,
              nodeId: folder.id,
              songId: null,
              type: 'tablature',
              title: `Canción ${String(i + 1).padStart(3, '0')}`,
              rev: 1,
              createdAt: now - i * 60_000,
              updatedAt: now - i * 60_000,
              content: {
                kind: 'notebook',
                version: 1,
                blocks: [{ id: `b${i}`, kind: 'chords', content: { version: 1, items: [{ id: `c${i}`, symbol: 'Am', beats: 4 }, { id: `d${i}`, symbol: 'F', beats: 4 }] } }],
                meta: { key: { tonic: keys[i % 5], mode: 'major' }, bpm: 80 + (i % 40), ...(i % 3 === 0 ? { artist: `Banda ${i % 7}` } : {}) },
              },
            });
          }
          tx.oncomplete = () => {
            request.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    { folder, count },
  );
}

test('A — personalizar una carpeta: portadas, campos, recientes y densidad persisten, y el tema global no los toca', async ({ page }) => {
  await openLibrary(page);
  await createFolder(page, 'Canciones');
  await openFolder(page, 'Canciones');
  await createFromMenu(page, 'Progresión de acordes', 'Wonderwall de estudio');
  await settleSave(page);
  await back(page);
  await createFromMenu(page, 'Riff o tablatura', 'Idea de estribillo');
  await settleSave(page);
  await back(page);

  await page.getByRole('button', { name: 'Personalizar carpeta' }).click();
  const panel = customize(page);
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: /Colección visual/ }).click();
  await expect(page.locator('.folder-view .module-covers')).toBeVisible(); // live preview, nothing saved yet
  expect(await stored(page)).toEqual({});
  await panel.getByRole('switch', { name: 'Artista' }).check();
  await panel.getByRole('switch', { name: 'Tonalidad' }).check();
  await panel.getByRole('switch', { name: 'BPM' }).uncheck();
  await panel.getByRole('checkbox', { name: /Recientes de la carpeta/ }).check();
  await panel.getByRole('button', { name: 'Detallada' }).click();
  await expect(page.locator('.folder-view')).toHaveClass(/density-detailed/);
  await panel.getByRole('button', { name: 'Guardar' }).click();
  await expect(panel).toHaveCount(0);

  const saved = Object.values(await stored(page)) as Array<{ mode: string; presentation: { fields: Record<string, boolean>; density: string; modules: string[] } }>;
  expect(saved).toHaveLength(1);
  expect(saved[0].mode).toBe('own');
  expect(saved[0].presentation.fields).toMatchObject({ artist: true, key: true, bpm: false });
  expect(saved[0].presentation.density).toBe('detailed');
  expect(saved[0].presentation.modules).toContain('recent');

  await page.reload();
  await expect(page.locator('.folder-view')).toHaveClass(/density-detailed/);
  await expect(page.locator('.folder-view .module-covers')).toBeVisible();

  // Changing the global universe leaves the folder's organisation exactly as it was.
  const before = await stored(page);
  await page.evaluate(() => window.localStorage.setItem('guitarap.pref.appearance.skin', '"vinilo"'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'vinilo');
  expect(await stored(page)).toEqual(before);
  await expect(page.locator('.folder-view .module-covers')).toBeVisible();
  await expect(page.locator('.folder-view')).toHaveClass(/density-detailed/);

  // Presentation never touched the music.
  const docs = await storedDocuments(page);
  expect(docs.find((doc) => doc.title === 'Wonderwall de estudio')?.content.blocks.some((block) => block.kind === 'chords')).toBe(true);
});

test('B — módulos combinados y reordenados: portadas y lista en la misma carpeta', async ({ page }) => {
  await openLibrary(page);
  await createFolder(page, 'Mixta');
  await openFolder(page, 'Mixta');
  await createFromMenu(page, 'Progresión de acordes', 'Tema uno');
  await settleSave(page);
  await back(page);
  await page.getByRole('button', { name: 'Personalizar carpeta' }).click();
  const panel = customize(page);
  await panel.getByRole('button', { name: /Colección visual/ }).click();
  await panel.getByRole('checkbox', { name: /^Lista/ }).check();
  await panel.getByRole('button', { name: 'Subir Lista' }).click();
  await panel.getByRole('button', { name: 'Subir Lista' }).click();
  await panel.getByRole('button', { name: 'Guardar' }).click();
  await page.reload();
  await expect(page.locator('.entry-list').getByText('Tema uno')).toBeVisible();
  const order = await modulesShown(page);
  expect(order.indexOf('list')).toBeGreaterThanOrEqual(0);
  expect(order.indexOf('covers')).toBeGreaterThan(order.indexOf('list'));
  await expect(page.locator('.cover-grid').getByText('Tema uno')).toBeVisible();
  await expect(page.locator('.entry-list').getByText('Tema uno')).toBeVisible();
});

test('C — herencia: la subcarpeta sigue al padre hasta que se personaliza', async ({ page }) => {
  await openLibrary(page);
  await createFolder(page, 'Padre');
  await openFolder(page, 'Padre');
  await createFolder(page, 'Hija');
  await page.getByRole('button', { name: 'Personalizar carpeta' }).click();
  await customize(page).getByRole('button', { name: /Lista compacta/ }).click();
  await customize(page).getByRole('button', { name: 'Guardar' }).click();
  await openFolder(page, 'Hija');
  expect(await modulesShown(page)).not.toContain('header'); // inherited: no header, just the compact list
  await expect(page.locator('.folder-empty')).toBeVisible();
  await page.getByRole('button', { name: 'Personalizar carpeta' }).click();
  await expect(customize(page).getByRole('radio', { name: /Heredar de «Padre»/ })).toBeChecked();
  await customize(page).getByRole('button', { name: 'Cancelar', exact: true }).click();

  // The parent changes: the child follows.
  await page.getByRole('navigation', { name: 'Ubicación' }).getByRole('button', { name: 'Padre' }).click();
  await page.getByRole('button', { name: 'Personalizar carpeta' }).click();
  await customize(page).getByRole('button', { name: /Proyecto/ }).click();
  await customize(page).getByRole('button', { name: 'Guardar' }).click();
  await openFolder(page, 'Hija');
  expect(await modulesShown(page)).toContain('header');

  // The child gets its own look and stops following.
  await page.getByRole('button', { name: 'Personalizar carpeta' }).click();
  await customize(page).getByRole('button', { name: /Cuaderno musical/ }).click();
  await expect(customize(page).getByRole('radio', { name: /Propia de esta carpeta/ })).toBeChecked();
  await customize(page).getByRole('button', { name: 'Guardar' }).click();
  await page.getByRole('navigation', { name: 'Ubicación' }).getByRole('button', { name: 'Padre' }).click();
  await page.getByRole('button', { name: 'Personalizar carpeta' }).click();
  await customize(page).getByRole('button', { name: /Lista compacta/ }).click();
  await customize(page).getByRole('button', { name: 'Guardar' }).click();
  await openFolder(page, 'Hija');
  const hija = await modulesShown(page);
  expect(hija).toContain('header');
  expect(hija).not.toEqual(['list']); // still its own notebook look, not the parent's compact list
});

test('D — biblioteca adaptable con 0, 1, 10, 100 y 500 materiales', async ({ page }) => {
  await openLibrary(page);
  const timings: Record<number, number> = {};
  for (const count of [0, 1, 10, 100, 500]) {
    const folder = { id: `seed-${count}`, name: `Carpeta ${count}` };
    await seedFolder(page, folder, count);
    await page.goto('/biblioteca');
    const started = Date.now();
    await page.goto(`/biblioteca?c=${folder.id}`);
    await expect(page.getByRole('heading', { name: folder.name, exact: true })).toBeVisible();
    if (count > 0) await expect(page.locator('.entry-list .lib-row')).toHaveCount(count);
    timings[count] = Date.now() - started;
    // Never an abandoned page: the header with real counts and real actions is always there.
    await expect(page.locator('.folder-hero')).toBeVisible();
    if (count === 0) await expect(page.locator('.folder-empty')).toBeVisible();
    if (count === 1) await expect(page.locator('.folder-hero-sub')).toContainText('1 material');
    // No invented facts: items without an artist show none.
    if (count >= 10) {
      const artists = await page.locator('.entry-list .fact.artist').count();
      expect(artists).toBe(0); // artist is off in the default presentation
    }
  }
  test.info().annotations.push({ type: 'tiempos (ms) de apertura de carpeta', description: JSON.stringify(timings) });
  console.log('Tiempos de apertura de carpeta (ms):', timings);
  expect(timings[500]).toBeLessThan(8000);

  // 500 items as covers with every field on still renders and scrolls.
  await page.getByRole('button', { name: 'Personalizar carpeta' }).click();
  await customize(page).getByRole('button', { name: /Vista combinada/ }).click();
  await customize(page).getByRole('switch', { name: 'Artista' }).check();
  await customize(page).getByRole('switch', { name: 'Acordes' }).check();
  const started = Date.now();
  await customize(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(page.locator('.cover-grid .cover-card')).toHaveCount(500);
  console.log('500 portadas con todos los campos (ms):', Date.now() - started);
  await page.mouse.wheel(0, 20000);
  // Artist appears only where the data has one (every third seeded item).
  const withArtist = await page.locator('.cover-grid .fact.artist').count();
  expect(withArtist).toBe(167);
});

test('Ficha: artista y portada son opcionales y solo cambian la meta, nunca la música', async ({ page }) => {
  await openLibrary(page);
  await createFromMenu(page, 'Progresión de acordes', 'Something de estudio');
  await settleSave(page);
  const before = (await storedDocuments(page)).find((doc) => doc.title === 'Something de estudio')!;
  await page.goto('/biblioteca');
  await page.getByRole('button', { name: 'Opciones de Something de estudio' }).click();
  await page.getByRole('menuitem', { name: /Ficha/ }).click();
  const dialog = page.getByRole('dialog', { name: /Ficha de/ });
  await dialog.getByLabel('Artista').fill('The Beatles');
  await dialog.getByLabel('Año').fill('1969');
  await dialog.locator('.cover-option', { hasText: 'Sol' }).click();
  await dialog.getByRole('button', { name: 'Guardar ficha' }).click();
  const after = (await storedDocuments(page)).find((doc) => doc.title === 'Something de estudio')!;
  expect(JSON.stringify(after.content.blocks)).toBe(JSON.stringify(before.content.blocks));
  expect((after.content as unknown as { meta: Record<string, unknown> }).meta).toMatchObject({ artist: 'The Beatles', year: 1969, cover: { style: 'sun' } });
});

test('E — los seis universos son sistemas distintos (tipografía, forma, superficie) con los mismos colores armónicos', async ({ page }) => {
  await openLibrary(page);
  const looks = new Set<string>();
  for (const skin of ['estudio', 'britanico', 'newwave', 'psicodelico', 'vinilo', 'cuaderno']) {
    const look = await page.evaluate((value) => {
      document.documentElement.dataset.skin = value;
      const style = getComputedStyle(document.documentElement);
      const title = getComputedStyle(document.querySelector('h1 button') as HTMLElement);
      return {
        harmonic: ['--h-root', '--h-third', '--h-fifth', '--h-seventh'].map((name) => style.getPropertyValue(name).trim()).join(),
        system: [style.getPropertyValue('--bg').trim(), style.getPropertyValue('--radius-card').trim(), style.getPropertyValue('--display-weight').trim(), title.fontFamily, title.textTransform, title.fontStyle].join('|'),
      };
    }, skin);
    looks.add(look.system);
    expect(look.harmonic).toBe('#1d5fd1,#8a3fc2,#0a7d62,#c2410c');
  }
  expect(looks.size).toBe(6);
});

test('F — Armonía: lateral, ampliada redimensionable, laboratorio completo; explorar no modifica la canción', async ({ page }) => {
  await audioProbe(page);
  await openLibrary(page);
  await createFromMenu(page, 'Progresión de acordes', 'Laboratorio');
  await settleSave(page);
  const before = JSON.stringify((await storedDocuments(page)).map((doc) => doc.content));
  const tools = page.getByRole('complementary', { name: 'Herramientas musicales' });

  await page.getByRole('button', { name: /Armonía/ }).click();
  await expect(tools).toBeVisible();
  const side = (await tools.boundingBox())!.width;
  await tools.getByRole('button', { name: 'Panel ampliado' }).click();
  const handle = tools.getByRole('separator', { name: 'Ancho del panel de armonía' });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 260, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  const wide = (await tools.boundingBox())!.width;
  expect(wide).toBeGreaterThan(side + 150);
  expect(Number(await page.evaluate(() => window.localStorage.getItem('guitarap.pref.harmony.width')))).toBeGreaterThan(560);

  await tools.getByRole('button', { name: 'Laboratorio completo' }).click();
  await expect(tools.getByRole('heading', { name: /Laboratorio de armonía/ })).toBeVisible();
  expect((await tools.boundingBox())!.width).toBeGreaterThan(1000);

  await tools.getByRole('button', { name: 'Acordes', exact: true }).click();
  await tools.getByLabel('Símbolo de acorde').fill('Cmaj7');
  await tools.getByLabel('Símbolo de acorde').press('Enter');
  await expect(tools.getByLabel('Fórmula interválica')).toHaveText('1 – 3 – 5 – 7');
  await tools.getByRole('button', { name: 'Cmaj9', exact: true }).click();
  await expect(tools.locator('.lab-change')).toContainText('+ 9 (D)');
  await expect(tools.getByRole('list', { name: 'Posiciones de Cmaj9' }).getByRole('listitem').first()).toBeVisible();
  await tools.getByRole('button', { name: 'Escuchar', exact: true }).click();
  await expect.poll(async () => (await audioLog(page)).filter((entry) => entry.type === 'note').length).toBeGreaterThanOrEqual(3);
  await tools.getByRole('button', { name: 'Mapa armónico' }).click();
  await expect(tools.getByText(/no se tocan todas a la vez/)).toBeVisible();

  await tools.getByRole('button', { name: 'Tríadas', exact: true }).click();
  await tools.getByLabel('Juego de cuerdas', { exact: true }).selectOption({ label: 'Cuerdas 1–2–3' });
  await tools.getByLabel('Inversión', { exact: true }).selectOption({ label: 'Primera inversión' });
  await expect(tools.locator('.lab-shape-facts')).toContainText('bajo E');

  // Back to the song: it is exactly as it was.
  await tools.getByRole('button', { name: 'Volver a la canción' }).click();
  await expect(tools.getByRole('heading', { name: /Explorar armonía/ })).toBeVisible();
  expect(JSON.stringify((await storedDocuments(page)).map((doc) => doc.content))).toBe(before);

  // Only the explicit button adds something.
  await tools.getByRole('button', { name: 'Acordes', exact: true }).click();
  await tools.getByRole('button', { name: 'Digitación tocable' }).click();
  await tools.getByRole('button', { name: 'Guardar posición como mapa' }).click();
  await expect.poll(async () => (await storedDocuments(page)).find((doc) => doc.title === 'Laboratorio')?.content.blocks.filter((block) => block.kind === 'map').length).toBe(1);
});

test('H — metrónomo: cuatro timbres sin saturar, sonido recordado y prueba de sonido', async ({ page }) => {
  await audioProbe(page);
  await openLibrary(page);
  const peaks = await page.evaluate(async () => {
    const probe = (window as unknown as { __guitarapMeasureClick: (accent: boolean, level: number, sound?: string) => Promise<{ peak: number }> }).__guitarapMeasureClick;
    const out: Record<string, { soft: number; max: number }> = {};
    for (const sound of ['digital', 'woodblock', 'analog', 'dry']) out[sound] = { soft: (await probe(false, 0.6, sound)).peak, max: (await probe(true, 1, sound)).peak };
    return out;
  });
  for (const [sound, peak] of Object.entries(peaks)) {
    expect(peak.soft, `${sound} audible`).toBeGreaterThan(0.05);
    expect(peak.max, `${sound} sin clipping`).toBeLessThan(1);
  }
  await page.getByRole('button', { name: 'Ajustes del metrónomo' }).click();
  await page.getByRole('radio', { name: 'Woodblock' }).check();
  await page.getByRole('button', { name: 'Probar sonido' }).click();
  await expect.poll(async () => (await audioLog(page)).filter((entry) => entry.type === 'click').length).toBeGreaterThanOrEqual(2);
  const clicks = (await audioLog(page)).filter((entry) => entry.type === 'click') as Array<{ sound?: string }>;
  expect(clicks.at(-1)?.sound).toBe('woodblock');
  await page.reload();
  expect(await page.evaluate(() => window.localStorage.getItem('guitarap.pref.metronome.sound'))).toBe('"woodblock"');
});
