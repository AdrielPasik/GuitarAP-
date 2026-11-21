import { expect, type Page } from '@playwright/test';

export const cell = (page: Page, string: number, column: number) =>
  page.getByRole('textbox', { name: `Cuerda ${string}, columna ${column}`, exact: true });

export async function openLibrary(page: Page) {
  await page.goto('/biblioteca');
  await expect(page.getByRole('heading', { name: 'Biblioteca' })).toBeVisible();
}

/** Creates a material from the "Nuevo" menu and waits for the editor. */
export async function createMaterial(page: Page, kind: 'Tablatura' | 'Mapa de escala' | 'Material de estudio', title: string) {
  await page.getByRole('button', { name: 'Nuevo', exact: true }).click();
  const entry = { Tablatura: 'Riff o tablatura', 'Mapa de escala': 'Mapa de escala', 'Material de estudio': 'Cuaderno vacío' }[kind];
  await page.getByRole('menuitem', { name: entry }).click();
  await page.waitForURL(/\/material\//);
  const input = page.getByLabel('Título del material');
  await input.fill(title);
  await expect(input).toHaveValue(title);
}

export async function createFolder(page: Page, name: string) {
  await page.getByRole('button', { name: 'Nuevo', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Carpeta' }).click();
  await page.getByRole('dialog').getByLabel('Nombre').fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'Crear' }).click();
}

/** Marks a point on the first interactive fretboard of the page (strings are 0 = high E … 5 = low E). */
export const neck = (page: Page, testId = 'map-canvas') => ({
  pick: (string: number, fret: number) =>
    page.getByTestId(testId).getByTestId(`fret-${string}-${fret}`).click(),
  marker: (string: number, fret: number) =>
    page.getByTestId(testId).getByTestId(`marker-${string}-${fret}`),
});

/**
 * Waits for the autosave debounce plus the write. When it cannot see "Guardado", it says what the editor was really
 * showing and what was on disk, so an intermittent failure arrives with its evidence instead of a bare timeout.
 */
export async function settleSave(page: Page) {
  const saved = page.getByRole('status').filter({ hasText: 'Guardado' });
  try {
    await expect(saved).toBeVisible();
  } catch (error) {
    const shown = await page.locator('.save-state').allInnerTexts().catch(() => ['(no se pudo leer)']);
    const drafts = await page
      .evaluate(
        () =>
          new Promise<string>((resolve) => {
            const open = indexedDB.open('guitarap');
            open.onsuccess = () => {
              const all = open.result.transaction('settings').objectStore('settings').getAllKeys();
              all.onsuccess = () => resolve(String((all.result as string[]).filter((key) => key.startsWith('draft:')).length));
            };
            open.onerror = () => resolve('?');
          }),
      )
      .catch(() => '?');
    throw new Error(`settleSave: no apareció "Guardado". El editor mostraba ${JSON.stringify(shown)}; borradores en disco: ${drafts}.
${(error as Error).message}`, { cause: error });
  }
  await page.waitForTimeout(1000);
  await expect(saved).toBeVisible();
}

export async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** Test accounts only: every auth and sync call is answered locally, nothing reaches a real project. */
export async function mockServer(page: Page, options: { auth?: 'ok' | 'bad' | 'down' } = {}) {
  await page.route('**/auth/v1/**', async (route) => {
    if (options.auth === 'down') return route.abort('connectionrefused');
    if (options.auth === 'bad') return route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"invalid_grant"}' });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: 'e2e-access-token',
        refresh_token: 'e2e-refresh-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: 'e2e-user', email: 'prueba@guitarap.test' },
      }),
    });
  });
  await page.route('**/rest/v1/rpc/sync_library', async (route) => {
    const body = route.request().postDataJSON() as {
      p_op_id: string;
      p_snapshot: { documents: object[]; nodes: object[]; versions: object[] };
    };
    const echo = (items: object[]) => items.map((item) => ({ ...item, ownerId: 'e2e-user', lastOpId: body.p_op_id }));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        documents: echo(body.p_snapshot.documents),
        nodes: echo(body.p_snapshot.nodes),
        versions: echo(body.p_snapshot.versions),
        conflicts: [],
      }),
    });
  });
  await page.route('**/rest/v1/rpc/pull_library', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cursor: '0', changes: [], hasMore: false }) }),
  );
}


/** Lets the browser tests read what the audio engine scheduled (the sound itself is not recorded). */
export async function audioProbe(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __GUITARAP_AUDIO_TEST__: boolean }).__GUITARAP_AUDIO_TEST__ = true;
  });
}
/** Writing a note sounds by default since v0.5.1. Tests that measure what Play schedules turn that off at load. */
export async function silentWriting(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('guitarap.pref.sound.preview', 'false'));
}
export type AudioEntry = { type: string; midi?: number; when?: number; seconds?: number; instrument?: string; voices?: number };
export const audioLog = (page: Page) =>
  page.evaluate(() => ((window as unknown as { __guitarapAudioLog?: AudioEntry[] }).__guitarapAudioLog ?? []).map((entry) => ({ ...entry })));
export const audioState = (page: Page) =>
  page.evaluate(() => (window as unknown as { __guitarapAudio: { state: string; owner: string | null; voices: number; activeId: string | null } }).__guitarapAudio);

/** Every stored document, read straight from IndexedDB (what is really saved, not what is on screen). */
export function storedDocuments(page: Page) {
  return page.evaluate(
    () =>
      new Promise<Array<{ id: string; title: string; type: string; content: Record<string, never> & { kind?: string; blocks: Array<{ kind: string; content: unknown }> }; deletedAt?: number }>>((resolve, reject) => {
        const request = indexedDB.open('guitarap');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const all = request.result.transaction('documents').objectStore('documents').getAll();
          all.onsuccess = () => resolve(all.result);
        };
      }),
  );
}

/** Creates any material from the "Nuevo" menu by its visible name. */
export async function createFromMenu(page: Page, entry: string, title: string) {
  await page.getByRole('button', { name: 'Nuevo', exact: true }).click();
  await page.getByRole('menuitem', { name: entry }).click();
  await page.waitForURL(/\/material\//);
  await page.getByLabel('Título del material').fill(title);
}

/**
 * Personal preferences (the look, folder presentations...) are stored per account since v0.8: these read and write the
 * copy of whoever is on screen, exactly where the app keeps it.
 */
export const savedPref = (page: Page, key: string) =>
  page.evaluate((name) => window.localStorage.getItem(`guitarap.pref.${name}@${window.localStorage.getItem('guitarap.owner-hint') || 'anon'}`), key);
export const setAccountPref = (page: Page, key: string, raw: string) =>
  page.evaluate(({ name, value }) => window.localStorage.setItem(`guitarap.pref.${name}@${window.localStorage.getItem('guitarap.owner-hint') || 'anon'}`, value), { name: key, value: raw });
