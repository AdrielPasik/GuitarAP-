import { expect, test, type Page } from '@playwright/test';
import { createFromMenu, openLibrary, settleSave, storedDocuments } from './helpers';
import { linkAndSync, waitSynced } from './project-helpers';
import { admin, newAccount, newPerson } from './sharing-helpers';

test.setTimeout(120_000);

/** Edits the replication state of a TEST library (fake account, isolated browser) to leave it exactly as an older sync left a real conflict. */
async function plantConflict(page: Page, owner: string, title: string, cloudText: string) {
  await page.evaluate(
    ({ owner, title, cloudText }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('guitarap');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          const tx = database.transaction(['documents', 'settings'], 'readwrite');
          const docs = tx.objectStore('documents').getAll();
          docs.onsuccess = () => {
            const doc = (docs.result as Array<{ id: string; title: string; rev: number; content: { blocks: Array<{ id: string; content: { text: string } }> } }>).find((item) => item.title === title)!;
            const settings = tx.objectStore('settings');
            const get = settings.get(`sync-state:${owner}`);
            get.onsuccess = () => {
              const row = get.result as { key: string; value: { documents: Record<string, number>; conflicts: Record<string, unknown> }; updatedAt: number };
              const cloud = structuredClone(doc);
              cloud.content.blocks[0].content.text = cloudText;
              row.value.documents[doc.id] = doc.rev - 1; // this device changed it after the last confirmed sync
              row.value.conflicts[doc.id] = { ...cloud, rev: doc.rev + 2, updatedAt: Date.now() - 86_400_000, ownerId: owner, lastOpId: 'old-client' };
              settings.put(row);
            };
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      }),
    { owner, title, cloudText },
  );
}

test('Escenario G — un conflicto se compara en pantalla, no se resuelve solo, y «Conservar ambas» no pierde ninguna versión', async ({ browser }) => {
  const owner = await newAccount('owner');
  const { page } = await newPerson(browser, owner);
  await openLibrary(page);
  await createFromMenu(page, 'Canción con letra', 'Documento con conflicto');
  await page.getByLabel('Letra', { exact: true }).fill('Linea uno\nlinea de este dispositivo');
  await settleSave(page);
  await linkAndSync(page);
  await plantConflict(page, owner, 'Documento con conflicto', 'Linea uno\nlinea de la nube');
  await page.reload();
  await expect(page.locator('.topbar').getByText('1 conflicto por revisar')).toBeVisible({ timeout: 20000 });

  // Several sync cycles later it is still there, untouched: only a person resolves it.
  await page.getByRole('button', { name: 'Cuenta y sincronización' }).click();
  await page.locator('.account-panel').getByRole('button', { name: 'Sincronizar ahora' }).click();
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  expect((await storedDocuments(page)).length).toBe(1);

  await page.goto('/configuracion/conflictos');
  const list = page.getByRole('list', { name: 'Materiales con conflicto' });
  await expect(list.getByText('Documento con conflicto')).toBeVisible();
  await list.getByRole('button', { name: 'Comparar y resolver' }).click();

  // The comparison says what differs, line by line.
  const diff = page.getByRole('list', { name: /Diferencias de/ });
  await expect(diff).toContainText('linea de la nube');
  await expect(diff).toContainText('linea de este dispositivo');
  await expect(diff.locator('.line-removed')).toContainText('linea de la nube');
  await expect(diff.locator('.line-added')).toContainText('linea de este dispositivo');
  await expect(page.getByText('qué dispositivo hizo cada cambio')).toBeVisible();

  await page.getByRole('button', { name: 'Conservar ambas', exact: true }).click();
  await expect(page.getByText('No hay conflictos por revisar.')).toBeVisible();
  const docs = await storedDocuments(page);
  expect(docs.map((doc) => doc.title).sort()).toEqual(['Documento con conflicto', 'Documento con conflicto (versión de la nube)']);
  expect(JSON.stringify(docs.find((doc) => doc.title.includes('nube'))!.content)).toContain('linea de la nube');
  expect(JSON.stringify(docs.find((doc) => !doc.title.includes('nube'))!.content)).toContain('linea de este dispositivo');

  // Both versions reach the cloud, and a recovery point exists in the history.
  await waitSynced(page);
  await expect.poll(async () => (await admin<Array<{ n: number }>>(`select count(*)::int as n from public.documents where owner_id = $1`, [owner]))[0].n, { timeout: 30000 }).toBe(2);
  const reasons = await page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const request = indexedDB.open('guitarap');
        request.onsuccess = () => {
          const all = request.result.transaction('versions').objectStore('versions').getAll();
          all.onsuccess = () => resolve((all.result as Array<{ reason: string }>).map((v) => v.reason));
        };
      }),
  );
  expect(reasons).toContain('conflict-device');
});

test('Escenario F — «Mis datos y almacenamiento» dice la verdad: guardado acá, confirmado en la nube, sin fecha inventada, y un segundo navegador recibe todo', async ({ browser }) => {
  const owner = await newAccount('owner');
  const { page } = await newPerson(browser, owner);
  await openLibrary(page);
  await createFromMenu(page, 'Canción con letra', 'Mi canción guardada');
  await page.getByLabel('Letra', { exact: true }).fill('Texto que tiene que llegar a todos lados');
  await settleSave(page);

  // Before linking: the cloud is not claimed, unknowns are said to be unknown.
  await page.goto('/configuracion/datos');
  const grid = page.getByRole('list', { name: 'Estado de tus datos' }).or(page.getByLabel('Estado de tus datos'));
  await expect(grid.getByText('Guardados')).toBeVisible();
  await expect(grid.getByText('Falta activar la sincronización')).toBeVisible();
  await expect(grid.getByText('Sin registro')).toBeVisible(); // no backup is known: no invented date
  await expect(grid.getByText(/Desconocido/).first()).toBeVisible();

  await linkAndSync(page);
  await page.goto('/configuracion/datos');
  await expect(grid.getByText('Sincronizada', { exact: true })).toBeVisible();
  await expect(grid.getByText('1 de 1')).toBeVisible();
  await expect(grid.getByText('Conflictos por revisar').locator('..')).toContainText('0');

  // A downloaded backup is recorded (and only then is a date shown).
  await page.goto('/configuracion/copias');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Descargar copia/ }).first().click();
  await download;
  await page.goto('/configuracion/datos');
  await expect(grid.getByText('Sin registro')).toHaveCount(0);

  // A second browser with the same account receives the library and says so.
  const { page: other } = await newPerson(browser, owner);
  await openLibrary(other);
  await linkAndSync(other);
  await other.goto('/biblioteca');
  await expect(other.locator('.lib-row', { hasText: 'Mi canción guardada' })).toBeVisible({ timeout: 20000 });
  await other.locator('.lib-row', { hasText: 'Mi canción guardada' }).locator('.lib-open').click();
  await expect(other.getByLabel('Letra', { exact: true })).toHaveValue('Texto que tiene que llegar a todos lados');
});
