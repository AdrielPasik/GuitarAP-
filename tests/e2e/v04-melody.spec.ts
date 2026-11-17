import { expect, test, type Page } from '@playwright/test';
import { audioLog, audioProbe, audioState, createFromMenu, openLibrary, settleSave, storedDocuments } from './helpers';

const notes = (page: Page) => page.getByRole('listbox', { name: 'Notas de la melodía' }).getByRole('option');
const bpmField = (page: Page) => page.getByRole('spinbutton', { name: 'BPM de melodía' });
const writeNotes = async (page: Page, text: string) => {
  await page.getByLabel('Escribir notas').fill(text);
  await page.getByLabel('Escribir notas').press('Enter');
};
async function songWithMelody(page: Page, title = 'Mi canción') {
  await createFromMenu(page, 'Cuaderno de composición', title);
  await page.getByRole('button', { name: 'Agregar melodía' }).click();
}
const storedMelody = async (page: Page) => {
  const docs = await storedDocuments(page);
  const notebook = docs.find((doc) => doc.content?.kind === 'notebook')!.content;
  return notebook.blocks.find((block: { kind: string }) => block.kind === 'melody').content as { events: Array<{ midi?: number; beats: number; type: string }>; bpm?: number };
};

test('Escenario A — una melodía vocal conserva alturas y octavas, y cambiar la nomenclatura no toca los datos', async ({ page }) => {
  await openLibrary(page);
  await songWithMelody(page);
  await writeNotes(page, 'Do4 Re4 Mi4 Sol4');
  await expect(notes(page)).toHaveCount(4);
  await expect(notes(page).first()).toHaveAccessibleName(/^Do4, 1 pulso/);
  await settleSave(page);
  expect((await storedMelody(page)).events.map((event) => event.midi)).toEqual([60, 62, 64, 67]);

  await page.reload();
  await expect(notes(page)).toHaveCount(4);

  await page.getByRole('button', { name: 'Herramientas de la melodía' }).click();
  await page.getByRole('menuitemradio', { name: 'Nombres: C D E' }).click();
  await expect(notes(page).nth(0)).toHaveAccessibleName(/^C4,/);
  await expect(notes(page).nth(2)).toHaveAccessibleName(/^E4,/);
  await expect(notes(page).nth(3)).toHaveAccessibleName(/^G4,/);
  await page.getByRole('button', { name: 'Herramientas de la melodía' }).click();
  await page.getByRole('menuitemradio', { name: 'Nombres: Do Re Mi' }).click();
  await expect(notes(page).nth(3)).toHaveAccessibleName(/^Sol4,/);
  await page.waitForTimeout(800);
  expect((await storedMelody(page)).events.map((event) => event.midi)).toEqual([60, 62, 64, 67]);
});

test('la entrada de notas valida sin destruir, y se edita con teclado: octava, duración, insertar, borrar, copiar', async ({ page }) => {
  await openLibrary(page);
  await songWithMelody(page);
  await writeNotes(page, 'C4 D4 E4 F4');
  // A typo applies nothing and says why.
  await writeNotes(page, 'G4 H4 Cmaj7');
  await expect(page.getByRole('alert')).toContainText('H4');
  await expect(page.getByRole('alert')).toContainText('acorde');
  await expect(notes(page)).toHaveCount(4);

  const strip = page.getByRole('listbox', { name: 'Notas de la melodía' });
  await notes(page).nth(1).click(); // D4
  await strip.press('ArrowUp'); // D♯4
  await strip.press('Shift+ArrowUp'); // up an octave
  await expect(notes(page).nth(1)).toHaveAccessibleName(/^Re♯5, 1 pulso/);
  await strip.press('ArrowDown');
  await strip.press('Shift+ArrowDown');
  await expect(notes(page).nth(1)).toHaveAccessibleName(/^Re4, 1 pulso/);
  await strip.press('3'); // long
  await expect(notes(page).nth(1)).toHaveAccessibleName(/^Re4, 2 pulsos/);
  await strip.press('g'); // inserts a G after the selection, nearest octave
  await expect(notes(page)).toHaveCount(5);
  await expect(notes(page).nth(2)).toHaveAccessibleName(/^Sol3|^Sol4/);
  await strip.press('Delete');
  await expect(notes(page)).toHaveCount(4);
  await notes(page).nth(0).click();
  await strip.press('Control+d');
  await expect(notes(page)).toHaveCount(5);
  await settleSave(page);
  const stored = await storedMelody(page);
  expect(stored.events).toHaveLength(5);
  expect(stored.events[0].midi).toBe(60);
  expect(stored.events[1].midi).toBe(60);
});

test('el teclado visual solo elige la altura', async ({ page }) => {
  await openLibrary(page);
  await songWithMelody(page);
  await page.getByRole('button', { name: 'Teclado' }).click();
  await page.getByRole('button', { name: 'Do4', exact: true }).click();
  await page.getByRole('button', { name: 'Mi4', exact: true }).click();
  await expect(notes(page)).toHaveCount(2);
  await expect(notes(page).nth(1)).toHaveAccessibleName(/^Mi4/);
});

test('Escenario B — Play programa las notas en orden y a tiempo; pausa, reanuda y detiene sin voces colgadas', async ({ page }) => {
  await audioProbe(page);
  await openLibrary(page);
  await songWithMelody(page);
  await writeNotes(page, 'Do4 Re4 Mi4 Sol4');
  await bpmField(page).fill('120');
  await bpmField(page).press('Enter');
  await expect(bpmField(page)).toHaveValue('120');

  // Nothing sounds until the person presses Play.
  expect(await audioLog(page)).toHaveLength(0);
  await page.getByRole('button', { name: 'Reproducir melodía' }).click();
  await expect.poll(async () => (await audioLog(page)).filter((entry) => entry.type === 'note').length).toBe(4);
  const played = (await audioLog(page)).filter((entry) => entry.type === 'note');
  expect(played.map((entry) => entry.midi)).toEqual([60, 62, 64, 67]);
  const gaps = played.slice(1).map((entry, index) => (entry.when ?? 0) - (played[index].when ?? 0));
  for (const gap of gaps) expect(gap).toBeCloseTo(0.5, 1);
  expect(played[0].seconds).toBeGreaterThan(0.4);
  await expect.poll(async () => (await audioState(page)).state, { timeout: 6000 }).toBe('idle');

  // Pause / resume / stop.
  await page.getByRole('button', { name: 'Reproducir melodía' }).click();
  await expect.poll(async () => (await audioState(page)).state).toBe('playing');
  await page.getByRole('button', { name: 'Pausar melodía' }).click();
  await expect.poll(async () => (await audioState(page)).state).toBe('paused');
  const whilePaused = (await audioLog(page)).length;
  await page.waitForTimeout(700);
  expect((await audioLog(page)).length).toBe(whilePaused);
  await page.getByRole('button', { name: 'Continuar melodía' }).click();
  await expect.poll(async () => (await audioState(page)).state).toBe('playing');
  await page.getByRole('button', { name: 'Detener melodía' }).click();
  await expect.poll(async () => (await audioState(page)).state).toBe('idle');
  expect((await audioState(page)).voices).toBe(0);
  const afterStop = (await audioLog(page)).length;
  await page.waitForTimeout(800);
  expect((await audioLog(page)).length).toBe(afterStop);
});

test('el sonido no sigue si cambiás de documento, y el metrónomo se aparta cuando suena la música', async ({ page }) => {
  await audioProbe(page);
  await openLibrary(page);
  await songWithMelody(page, 'Una');
  await writeNotes(page, 'C4 D4 E4 F4 G4 A4 B4 C5');
  await bpmField(page).fill('60');
  await bpmField(page).press('Enter');
  await page.getByRole('button', { name: 'Iniciar metrónomo' }).click();
  await expect(page.getByRole('button', { name: 'Detener metrónomo' })).toBeVisible();
  await page.getByRole('button', { name: 'Reproducir melodía' }).click();
  await expect.poll(async () => (await audioState(page)).state).toBe('playing');
  await expect(page.getByRole('button', { name: 'Iniciar metrónomo' })).toBeVisible();
  await settleSave(page);
  await page.getByRole('link', { name: /Volver a la biblioteca/ }).click();
  await expect.poll(async () => (await audioState(page)).state).toBe('idle');
  expect((await audioState(page)).voices).toBe(0);
});

test('Escenario J — Práctica reproduce la melodía y resalta la nota que suena sin modificar el documento', async ({ page }) => {
  await audioProbe(page);
  await openLibrary(page);
  await songWithMelody(page, 'Para practicar');
  await writeNotes(page, 'Do4 Re4 Mi4 Sol4 Fa4 Mi4 Re4 Do4');
  await settleSave(page);
  const before = JSON.stringify(await storedDocuments(page));
  await page.getByRole('link', { name: 'Practicar' }).click();
  await expect(page).toHaveURL(/\/practica\//);
  await page.getByRole('button', { name: 'Reproducir melodía' }).click();
  await expect(page.locator('.mel-chip.playing')).toHaveCount(1);
  await page.getByRole('button', { name: 'Modo foco' }).click();
  await expect(page.getByRole('button', { name: /Pausar melodía|Reproducir melodía/ })).toBeVisible();
  await page.getByRole('button', { name: 'Detener melodía' }).click();
  await expect.poll(async () => (await audioState(page)).state).toBe('idle');
  await page.keyboard.press('Escape');
  expect(JSON.stringify(await storedDocuments(page))).toBe(before);
});
