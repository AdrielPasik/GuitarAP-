import { expect, test } from '@playwright/test';
import { createFolder, createMaterial, openLibrary, settleSave } from './helpers';

const row = (page: import('@playwright/test').Page, text: string) => page.locator('.lib-row', { hasText: text });

test('Test 7 — folders, songs and materials: create, rename, duplicate, move, trash, restore, search', async ({ page }) => {
  await openLibrary(page);

  await createFolder(page, 'Escalas');
  await expect(row(page, 'Escalas')).toBeVisible();
  await row(page, 'Escalas').locator('.lib-open').click();
  await expect(page.getByRole('navigation', { name: 'Ubicación' })).toContainText('Escalas');

  await createMaterial(page, 'Mapa de escala', 'Re mayor');
  await settleSave(page);
  await page.getByRole('link', { name: /Volver a la biblioteca/ }).click();
  await expect(row(page, 'Re mayor')).toBeVisible();
  await expect(row(page, 'Re mayor')).toContainText('Mapa de escala');

  // Rename and duplicate.
  await row(page, 'Re mayor').getByRole('button', { name: /Opciones de Re mayor/ }).click();
  await page.getByRole('menuitem', { name: 'Renombrar' }).click();
  await page.getByRole('dialog').getByLabel('Nombre').fill('Re mayor (posición 1)');
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
  await expect(row(page, 'Re mayor (posición 1)')).toBeVisible();
  await row(page, 'Re mayor (posición 1)').getByRole('button', { name: /Opciones de/ }).click();
  await page.getByRole('menuitem', { name: 'Duplicar' }).click();
  await expect(row(page, 'copia')).toBeVisible();

  // A song groups its parts; a standalone tablature does not need one.
  await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await page.getByRole('button', { name: 'Nuevo', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Canción' }).click();
  await page.getByRole('dialog').getByLabel('Nombre').fill('Canción 01');
  await page.getByRole('dialog').getByRole('button', { name: 'Crear' }).click();
  await row(page, 'Canción 01').locator('.lib-open').click();
  await page.getByRole('button', { name: 'Agregar parte' }).click();
  await page.waitForURL(/\/material\//);
  await page.getByLabel('Título del material').fill('Riff principal');
  await settleSave(page);
  await page.getByRole('link', { name: /Volver a la biblioteca/ }).click();
  await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await createMaterial(page, 'Tablatura', 'Tablatura suelta');
  await settleSave(page);
  await page.getByRole('link', { name: /Volver a la biblioteca/ }).click();
  await expect(row(page, 'Tablatura suelta')).toBeVisible();

  // Move into the folder.
  await row(page, 'Tablatura suelta').getByRole('button', { name: /Opciones de/ }).click();
  await page.getByRole('menuitem', { name: 'Mover a…' }).click();
  await page.getByRole('dialog').getByLabel('Carpeta de destino').selectOption({ label: 'Escalas' });
  await page.getByRole('dialog').getByRole('button', { name: 'Mover aquí' }).click();
  await expect(row(page, 'Tablatura suelta')).toHaveCount(0);

  // Search reaches inside folders and songs and shows where the material lives.
  await page.getByLabel('Buscar en la biblioteca').fill('riff');
  await expect(row(page, 'Riff principal')).toContainText('Canción 01');
  await page.getByLabel('Buscar en la biblioteca').fill('suelta');
  await expect(row(page, 'Tablatura suelta')).toContainText('Escalas');
  await page.getByLabel('Buscar en la biblioteca').fill('');

  // Trash with undo, then restore from Configuración.
  await row(page, 'Escalas').locator('.lib-open').click();
  await row(page, 'Tablatura suelta').getByRole('button', { name: /Opciones de/ }).click();
  await page.getByRole('menuitem', { name: 'Enviar a la papelera' }).click();
  await expect(row(page, 'Tablatura suelta')).toHaveCount(0);
  await page.getByRole('button', { name: 'Deshacer' }).click();
  await expect(row(page, 'Tablatura suelta')).toBeVisible();
  await row(page, 'Tablatura suelta').getByRole('button', { name: /Opciones de/ }).click();
  await page.getByRole('menuitem', { name: 'Enviar a la papelera' }).click();
  await expect(row(page, 'Tablatura suelta')).toHaveCount(0); // the write is committed once the list updates
  await page.goto('/configuracion/recuperacion');
  await expect(page.getByText('Tablatura suelta')).toBeVisible();
  await page.getByRole('button', { name: 'Restaurar' }).first().click();
  await expect(page.getByText('La papelera está vacía.')).toBeVisible();
  await page.goto('/biblioteca');
  await page.getByLabel('Buscar en la biblioteca').fill('suelta');
  await expect(row(page, 'Tablatura suelta')).toBeVisible();

  // Everything survives a reload.
  await page.reload();
  await expect(row(page, 'Escalas')).toBeVisible();
  await expect(row(page, 'Canción 01')).toBeVisible();
});

test('an empty library offers the three real starting points', async ({ page }) => {
  await openLibrary(page);
  await expect(page.getByRole('heading', { name: 'Tu cuaderno está vacío' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Escribir una tablatura' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Marcar una escala' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Empezar un cuaderno vacío' })).toBeVisible();
});

test('a library with hundreds of materials stays responsive and searchable', async ({ page }) => {
  await openLibrary(page);
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('guitarap');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const tx = request.result.transaction('documents', 'readwrite');
        const store = tx.objectStore('documents');
        for (let index = 0; index < 500; index += 1) {
          store.put({
            id: `bulk-${index}`, nodeId: null, type: 'fretboard', title: `Material ${index}`,
            content: { tuning: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'], maxFret: 12, root: 0, notation: 'notes', latin: true, positions: [{ id: `p-${index}`, name: 'Posición 1', notes: [] }], baseNotes: [], selectedPositionId: `p-${index}` },
            rev: 1, createdAt: index, updatedAt: index,
          });
        }
        tx.oncomplete = () => {
          request.result.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.reload();
  await expect(page.locator('.lib-row')).toHaveCount(500);
  const started = Date.now();
  await page.getByLabel('Buscar en la biblioteca').fill('Material 499');
  await expect(page.locator('.lib-row')).toHaveCount(1);
  expect(Date.now() - started).toBeLessThan(2000);
});
