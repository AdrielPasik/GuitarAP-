import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openLibrary } from './helpers';

/**
 * Evidence for v0.7. On demand only:
 *   CAPTURE_EVIDENCE=1 npx playwright test tests/e2e/visual-evidence-v07.spec.ts
 * An isolated browser profile with a seeded test library; nothing real is involved.
 */
const enabled = Boolean(process.env.CAPTURE_EVIDENCE);
const out = path.resolve(process.env.EVIDENCE_DIR ?? 'docs/evidence/v0.7');
const shot = async (page: Page, name: string, fullPage = false) => {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage });
};

const now = Date.now();
const song = (id: string, folder: string, title: string, meta: Record<string, unknown>, chords: string[], i: number) => ({
  id, nodeId: folder, songId: null, type: 'tablature', title, rev: 1, createdAt: now - i * 3_600_000, updatedAt: now - i * 3_600_000,
  content: { kind: 'notebook', version: 1, meta, blocks: [{ id: `${id}-c`, kind: 'chords', content: { version: 1, items: chords.map((symbol, n) => ({ id: `${id}-${n}`, symbol, beats: 4 })) } }] },
});
const scale = (id: string, folder: string, title: string, root: number, i: number) => ({
  id, nodeId: folder, songId: null, type: 'fretboard', title, rev: 1, createdAt: now - i * 7_200_000, updatedAt: now - i * 7_200_000,
  content: {
    kind: 'notebook', version: 1, meta: { key: { tonic: ['C', 'G', 'A'][i % 3], mode: i % 3 === 2 ? 'minor' : 'major' }, notes: 'Subir y bajar a 80 BPM, después a 100.' },
    blocks: [{ id: `${id}-m`, kind: 'map', content: { tuning: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'], maxFret: 12, root, notation: 'notes', latin: false, selectedPositionId: 'p', baseNotes: [], positions: [{ id: 'p', name: 'Posición 1', notes: [{ string: 5, fret: 8, root: true }, { string: 4, fret: 7 }, { string: 3, fret: 5 }] }] } }],
  },
});

async function seed(page: Page) {
  const nodes = [
    { id: 'f-canciones', parentId: null, kind: 'folder', name: 'Canciones', order: 0, createdAt: now, updatedAt: now, rev: 1 },
    { id: 'f-escalas', parentId: null, kind: 'folder', name: 'ESCALAS', order: 1, createdAt: now, updatedAt: now, rev: 1 },
    { id: 'f-proyecto', parentId: null, kind: 'folder', name: 'Proyecto: Luz de agosto', order: 2, createdAt: now, updatedAt: now, rev: 1 },
  ];
  const docs = [
    song('s1', 'f-canciones', 'Something (estudio)', { artist: 'The Beatles', album: 'Abbey Road', year: 1969, key: { tonic: 'C', mode: 'major' }, bpm: 66, cover: { style: 'sun', hue: 28 } }, ['C', 'Cmaj7', 'C7', 'F'], 1),
    song('s2', 'f-canciones', 'Message in a Bottle (estudio)', { artist: 'The Police', key: { tonic: 'C', mode: 'minor' }, bpm: 150, cover: { style: 'grid', hue: 195 } }, ['C#m', 'A', 'B', 'F#m'], 2),
    song('s3', 'f-canciones', 'Wish You Were Here (estudio)', { artist: 'Pink Floyd', key: { tonic: 'G', mode: 'major' }, bpm: 60, cover: { style: 'wave', hue: 260 } }, ['C', 'D', 'Am', 'G'], 3),
    song('s4', 'f-canciones', 'Canción propia: Madrugada', { key: { tonic: 'A', mode: 'minor' }, bpm: 92, status: 'progress', tags: ['propia'] }, ['Am9', 'Fmaj7', 'C', 'G'], 4),
    scale('e1', 'f-escalas', 'C mayor — posición 1', 0, 1),
    scale('e2', 'f-escalas', 'G mayor — CAGED', 7, 2),
    scale('e3', 'f-escalas', 'La menor pentatónica', 9, 3),
    song('p1', 'f-proyecto', 'Estrofa', { key: { tonic: 'D', mode: 'major' }, bpm: 104, status: 'done' }, ['D', 'Bm7', 'Gmaj7', 'A'], 1),
    song('p2', 'f-proyecto', 'Estribillo', { key: { tonic: 'D', mode: 'major' }, bpm: 104, status: 'progress' }, ['G', 'A', 'F#m7', 'Bm'], 2),
    song('p3', 'f-proyecto', 'Puente (idea)', { key: { tonic: 'D', mode: 'major' }, bpm: 104, status: 'idea' }, ['Em9', 'A13'], 3),
  ];
  await page.evaluate(
    async ({ nodes, docs }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('guitarap');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const tx = request.result.transaction(['nodes', 'documents'], 'readwrite');
          nodes.forEach((node) => tx.objectStore('nodes').put(node));
          docs.forEach((doc) => tx.objectStore('documents').put(doc));
          tx.oncomplete = () => { request.result.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
      }),
    { nodes, docs },
  );
}

const preset = (page: Page, name: RegExp) => page.getByRole('dialog', { name: /Personalizar/ }).getByRole('button', { name });

test.describe('evidence v0.7', () => {
  test.skip(!enabled, 'set CAPTURE_EVIDENCE=1 to capture');
  test.setTimeout(400_000);

  test('captures the musical universe', async ({ page }) => {
    await mkdir(out, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLibrary(page);
    await seed(page);
    await page.goto('/biblioteca?c=f-canciones');
    await expect(page.getByText('Something (estudio)').first()).toBeVisible();
    await shot(page, '01-canciones-predeterminada');

    // Canciones as a record collection
    await page.getByRole('button', { name: 'Personalizar carpeta' }).click();
    await preset(page, /Colección visual/).click();
    await page.getByRole('switch', { name: 'Acordes' }).check();
    await page.getByRole('switch', { name: 'BPM' }).uncheck();
    await shot(page, '02-editor-personalizar');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await shot(page, '03-canciones-coleccion', true);

    for (const [id, label] of [[/Lista compacta/, 'lista'], [/Cuaderno musical/, 'cuaderno'], [/Vista combinada/, 'combinada']] as const) {
      await page.getByRole('button', { name: 'Personalizar carpeta' }).click();
      await preset(page, id).click();
      await shot(page, `04-vista-${label}`, true);
      await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    }

    // ESCALAS as a practice notebook
    await page.goto('/biblioteca?c=f-escalas');
    await page.getByRole('button', { name: 'Personalizar carpeta' }).click();
    await preset(page, /Lista compacta/).click();
    await page.getByRole('switch', { name: 'Notas o descripción' }).check();
    await page.getByRole('switch', { name: 'Tonalidad' }).check();
    await page.getByRole('button', { name: 'Detallada' }).click();
    await page.getByRole('checkbox', { name: /Accesos de práctica/ }).check();
    await page.getByRole('button', { name: 'Guardar' }).click();
    await shot(page, '05-escalas-cuaderno-de-practica', true);

    // A song project
    await page.goto('/biblioteca?c=f-proyecto');
    await page.getByRole('button', { name: 'Personalizar carpeta' }).click();
    await preset(page, /Proyecto/).click();
    await page.getByRole('button', { name: 'Guardar' }).click();
    await shot(page, '06-proyecto', true);

    // Every universe on the same collection
    await page.goto('/biblioteca?c=f-canciones');
    for (const skin of ['estudio', 'britanico', 'newwave', 'psicodelico', 'vinilo', 'cuaderno']) {
      await page.evaluate((value) => { document.documentElement.dataset.skin = value; }, skin);
      await shot(page, `07-tema-${skin}`);
      await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
      await shot(page, `07-tema-${skin}-oscuro`);
      await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    }
    await page.evaluate(() => { document.documentElement.dataset.skin = 'estudio'; });
    await page.goto('/configuracion/apariencia');
    await page.getByRole('group', { name: 'Universo visual' }).getByRole('button', { name: /Vinyl Archive/ }).click();
    await shot(page, '08-selector-de-temas-vista-previa', true);
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();

    // Harmony: side, wide, full lab
    await page.goto('/material/s1');
    const tools = page.getByRole('complementary', { name: 'Herramientas musicales' });
    await page.getByRole('button', { name: /Armonía/ }).click();
    await shot(page, '09-armonia-lateral');
    await tools.getByRole('button', { name: 'Panel ampliado' }).click();
    await page.evaluate(() => window.localStorage.setItem('guitarap.pref.harmony.width', '760'));
    await page.reload();
    await page.getByRole('button', { name: /Armonía/ }).click();
    await shot(page, '10-armonia-ampliada');
    await tools.getByRole('button', { name: 'Laboratorio completo' }).click();
    await tools.getByRole('button', { name: 'Acordes', exact: true }).click();
    await tools.getByLabel('Símbolo de acorde').fill('Cmaj7');
    await tools.getByLabel('Símbolo de acorde').press('Enter');
    await shot(page, '11-laboratorio-cmaj7-digitacion');
    await tools.getByRole('button', { name: 'Cmaj9', exact: true }).click();
    await shot(page, '12-laboratorio-cmaj9-que-cambio');
    await tools.getByRole('button', { name: 'Mapa armónico' }).click();
    await shot(page, '13-diapason-grande-mapa-armonico');
    await tools.getByRole('button', { name: 'Digitación tocable' }).click();
    await tools.locator('.voicing-card').nth(0).getByRole('button', { name: /Comparar/ }).click();
    await tools.locator('.voicing-card').nth(3).getByRole('button', { name: /Comparar/ }).click();
    await tools.locator('.lab-compare').scrollIntoViewIfNeeded();
    await shot(page, '14-comparar-posiciones');
    await tools.getByRole('button', { name: 'Tríadas', exact: true }).click();
    await shot(page, '15-triadas-cuerdas-123');
    await tools.getByLabel('Inversión', { exact: true }).selectOption({ label: 'Primera inversión' });
    await shot(page, '16-inversiones');
    await tools.getByLabel('Tipo', { exact: true }).selectOption({ label: 'Dominante 7' });
    await shot(page, '17-septimas-cuatro-cuerdas');
    await tools.getByRole('button', { name: 'Acordes', exact: true }).click();
    await tools.getByLabel('Símbolo de acorde').fill('Am9');
    await tools.getByLabel('Símbolo de acorde').press('Enter');
    await shot(page, '18-novenas-am9');
    await tools.getByRole('button', { name: 'Volver a la canción' }).click();

    // Metronome
    await page.getByRole('button', { name: 'Ajustes del metrónomo' }).click();
    await shot(page, '19-metronomo');
    await page.keyboard.press('Escape');

    // Tablet and phone
    await page.getByRole('button', { name: 'Cerrar herramientas musicales' }).click().catch(() => undefined);
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.goto('/biblioteca?c=f-canciones');
    await shot(page, '20-tablet-canciones');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/biblioteca?c=f-canciones');
    await shot(page, '21-movil-canciones', true);
    await page.goto('/material/s4');
    await page.getByRole('button', { name: /Armonía/ }).click();
    await shot(page, '22-movil-armonia');
  });
});
