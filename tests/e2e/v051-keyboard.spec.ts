import { expect, test, type Page } from '@playwright/test';
import { audioLog, audioProbe, audioState, createFromMenu, openLibrary, settleSave, storedDocuments } from './helpers';

const notes = (page: Page) => page.getByRole('listbox', { name: 'Notas de la melodía' }).getByRole('option');
const key = (page: Page, name: string) => page.getByRole('group', { name: 'Teclado musical' }).getByRole('button', { name, exact: true });
async function melody(page: Page) {
  await audioProbe(page);
  await openLibrary(page);
  await createFromMenu(page, 'Cuaderno de composición', 'Prueba de teclado');
  await page.getByRole('button', { name: 'Agregar melodía' }).click();
}
const stored = async (page: Page) => {
  await settleSave(page);
  const docs = await storedDocuments(page);
  const notebook = docs.find((doc) => doc.content?.kind === 'notebook')!.content;
  return notebook.blocks.find((block: { kind: string }) => block.kind === 'melody').content as { events: Array<{ midi?: number; type: string; beats: number }> };
};
const played = async (page: Page) => (await audioLog(page)).filter((entry) => entry.type === 'note').map((entry) => entry.midi);

test('Escenario A — el teclado musical está a la vista y se usa de inmediato', async ({ page }) => {
  await melody(page);
  await expect(page.getByRole('group', { name: 'Teclado musical' })).toBeVisible();
  await expect(page.getByText('Cada tecla agrega una nota al final')).toBeVisible();
  await key(page, 'Do4').click();
  await expect(notes(page)).toHaveCount(1);
});

test('Escenario B — cada tecla suena al tocarla y se agrega en orden, con la altura exacta', async ({ page }) => {
  await melody(page);
  await key(page, 'Do4').click();
  await key(page, 'Mi4').click();
  await key(page, 'Sol4').click();
  await expect(notes(page)).toHaveCount(3);
  await expect(notes(page).nth(0)).toHaveAccessibleName(/^Do4/);
  await expect(notes(page).nth(1)).toHaveAccessibleName(/^Mi4/);
  await expect(notes(page).nth(2)).toHaveAccessibleName(/^Sol4/);
  expect(await played(page)).toEqual([60, 64, 67]); // one sound per key, nothing doubled
  expect((await stored(page)).events.map((event) => event.midi)).toEqual([60, 64, 67]);
});

test('Escenario C — seleccionar una nota y pulsar otra tecla la reemplaza, se escucha y se puede deshacer', async ({ page }) => {
  await melody(page);
  for (const name of ['Do4', 'Mi4', 'Sol4']) await key(page, name).click();
  await notes(page).nth(1).click();
  await page.getByRole('button', { name: 'Reemplazar' }).click();
  await expect(page.getByText('Cada tecla reemplaza «Mi4»')).toBeVisible();
  await key(page, 'Fa4').click();
  await expect(notes(page)).toHaveCount(3);
  await expect(notes(page).nth(1)).toHaveAccessibleName(/^Fa4/);
  const sounds = await played(page);
  expect(sounds.at(-1)).toBe(65);
  await page.keyboard.press('Control+z');
  await expect(notes(page).nth(1)).toHaveAccessibleName(/^Mi4/);
});

test('Escenario D — otra octava: la tecla suena y se guarda con el MIDI correcto', async ({ page }) => {
  await melody(page);
  await page.getByRole('button', { name: 'Octava más aguda' }).click();
  await key(page, 'Do5').click();
  await key(page, 'La5').click();
  expect(await played(page)).toEqual([72, 81]);
  expect((await stored(page)).events.map((event) => event.midi)).toEqual([72, 81]);
  await page.getByRole('button', { name: 'Reproducir melodía' }).click();
  await expect.poll(async () => (await played(page)).length).toBeGreaterThanOrEqual(4);
  expect((await played(page)).slice(2, 4)).toEqual([72, 81]);
});

test('Escenario E — con «Escuchar al escribir» apagado la nota se agrega sin sonar', async ({ page }) => {
  await melody(page);
  await page.getByLabel('Escuchar al escribir').uncheck();
  await key(page, 'Do4').click();
  await expect(notes(page)).toHaveCount(1);
  expect(await played(page)).toEqual([]);
  await page.getByLabel('Escuchar al escribir').check();
  await key(page, 'Re4').click();
  expect(await played(page)).toEqual([62]);
});

test('Escenario F — teclas seguidas, ratón y teclado de la computadora, sin notas perdidas ni duplicadas', async ({ page }) => {
  await melody(page);
  for (const name of ['Do4', 'Re4', 'Mi4', 'Fa4']) await key(page, name).dispatchEvent('pointerdown', { button: 0, pointerType: 'touch' });
  await expect(notes(page)).toHaveCount(4);
  // A touch is a pointerdown and then a click: only the pointerdown writes.
  for (const name of ['Sol4']) await key(page, name).click();
  expect(await played(page)).toEqual([60, 62, 64, 65, 67]);
  // The computer keyboard plays the keys while the keyboard has focus; holding a key plays one note.
  await page.getByRole('group', { name: 'Teclado musical' }).focus();
  await page.keyboard.down('a');
  await page.keyboard.down('a');
  await page.keyboard.up('a');
  await page.keyboard.press('d');
  await expect(notes(page)).toHaveCount(7);
  expect((await stored(page)).events.map((event) => event.midi)).toEqual([60, 62, 64, 65, 67, 60, 64]);
  await page.waitForTimeout(700);
  expect((await audioState(page)).voices).toBe(0);
});

test('las teclas de la computadora no se interceptan al escribir una letra o un título', async ({ page }) => {
  await melody(page);
  const title = page.getByRole('textbox', { name: /Título de melodía/ });
  await title.fill('');
  await title.pressSequentially('asdf');
  await expect(title).toHaveValue('asdf');
  await expect(notes(page)).toHaveCount(0);
});

test('en un teléfono el teclado se desplaza dentro de su caja y no ensancha la página', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await melody(page);
  await expect(page.getByRole('group', { name: 'Teclado musical' })).toBeVisible();
  await key(page, 'Do4').click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

async function lyricSong(page: Page) {
  await audioProbe(page);
  await openLibrary(page);
  await createFromMenu(page, 'Canción con letra', 'Cuaderno de letra');
}

test('Escenario G — la letra se escribe como en un cuaderno: estructura con un toque, pegado intacto, recarga idéntica y sin atajos del teclado musical', async ({ page }) => {
  await lyricSong(page);
  const letter = page.getByLabel('Letra', { exact: true });
  const text = '# Verso 1\n[F]Hoy vuelvo a empezar\ncon el alma en [C]paz\n\n# Estribillo\nY canto otra vez';
  await letter.fill(text); // a multi-line paste keeps its lines and blank separators
  await expect(letter).toHaveValue(text);

  // Typing the keys that play the keyboard writes plain letters here.
  await letter.press('End');
  await letter.press('Control+End');
  await letter.pressSequentially('\nasdfwetyu zx');
  await expect(letter).toHaveValue(`${text}\nasdfwetyu zx`);
  await expect(page.getByRole('listbox', { name: 'Notas de la melodía' })).toHaveCount(0);

  // Structure chips: «Verso» numbers itself, the others are literal; no commands to remember.
  await letter.press('Control+End');
  await page.getByRole('group', { name: 'Estructura de la letra' }).getByRole('button', { name: 'Verso', exact: true }).click();
  await expect(letter).toHaveValue(/\n# Verso 2\n$/);
  await page.getByRole('group', { name: 'Estructura de la letra' }).getByRole('button', { name: 'Puente' }).click();
  await expect(letter).toHaveValue(/# Verso 2\n# Puente\n$/);

  await settleSave(page);
  await page.reload();
  await expect(page.getByLabel('Letra', { exact: true })).toHaveValue(/Hoy vuelvo a empezar[\s\S]*asdfwetyu zx[\s\S]*# Verso 2\n# Puente\n$/);
});

test('Escenario H — vista Letra + melodía: se escribe en las dos mitades con el teclado, se escucha y todo sobrevive a la recarga', async ({ page }) => {
  await lyricSong(page);
  await page.getByLabel('Letra', { exact: true }).fill('# Verso 1\nHoy vuelvo a empezar');
  await page.getByRole('button', { name: 'Agregar bloque', exact: true }).first().click();
  await page.getByRole('menuitem', { name: /^Melodía/ }).click();
  await key(page, 'Do4').click();
  await key(page, 'Mi4').click();
  await page.getByRole('button', { name: 'Acciones de melodía 2' }).click();
  await page.getByRole('menuitem', { name: /^Vincular con una letra…/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Hoy vuelvo a empezar/ }).click();
  const vocal = page.getByRole('region', { name: /^Letra \+ melodía/ });
  await expect(vocal).toBeVisible();

  await vocal.getByRole('group', { name: 'Teclado musical' }).getByRole('button', { name: 'Sol4', exact: true }).click();
  await vocal.getByLabel('Letra', { exact: true }).fill('# Verso 1\nHoy vuelvo a empezar otra vez');
  await expect(vocal.locator('.mel-chip')).toHaveCount(3);
  expect((await played(page)).slice(-1)).toEqual([67]);

  await vocal.getByRole('button', { name: 'Reproducir melodía' }).click();
  await expect(vocal.locator('.mel-chip.playing')).toHaveCount(1);
  await vocal.getByRole('button', { name: 'Detener melodía' }).click();

  await settleSave(page);
  await page.reload();
  // The link survives (two real blocks, nothing duplicated); the badge reopens the joint view.
  await page.getByRole('button', { name: /^con su letra/ }).click();
  const again = page.getByRole('region', { name: /^Letra \+ melodía/ });
  await expect(again.locator('.mel-chip')).toHaveCount(3);
  await expect(again.getByLabel('Letra', { exact: true })).toHaveValue('# Verso 1\nHoy vuelvo a empezar otra vez');
  expect((await stored(page)).events.map((event) => event.midi)).toEqual([60, 64, 67]);
});
