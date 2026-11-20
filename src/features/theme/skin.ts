import { useEffect } from 'react';
import { readPref, usePref } from '@/core/prefs';

/**
 * The artistic universe (level A of personalisation), independent of light/dark and of how each folder is organised.
 * A per-device preference: never part of a document, never synced, so two devices can look different without a
 * conflict. «estudio» is the default and the look the app had before universes existed.
 * Every universe is original: inspired by eras and movements, never by an existing cover, logo or artwork.
 */
export type Skin = 'estudio' | 'britanico' | 'newwave' | 'psicodelico' | 'vinilo' | 'cuaderno';
export type SkinInfo = { id: Skin; name: string; era: string; blurb: string; swatches: string[]; type: string };
export const SKINS: SkinInfo[] = [
  {
    id: 'estudio', name: 'Analog Studio', era: 'Estudio analógico',
    blurb: 'Nogal, latón y papel. Una consola cálida, pensada para sesiones largas.',
    swatches: ['#2b2116', '#c9a25a', '#f4efe6', '#b5441a'], type: 'Serif cálida, controles de latón',
  },
  {
    id: 'britanico', name: 'British Invasion', era: 'Rock británico de los 60',
    blurb: 'Papel crema, tinta y rojo profundo. Revista musical, tipografía expresiva, ornamento sutil.',
    swatches: ['#1d2430', '#b0332a', '#f1e7d1', '#e2b34c'], type: 'Titulares en versalitas, filetes de imprenta',
  },
  {
    id: 'newwave', name: 'New Wave', era: 'Post-punk, fines de los 70 y los 80',
    blurb: 'Contraste, geometría y color eléctrico controlado. Líneas, diagonales y sombras duras.',
    swatches: ['#0d0d10', '#f4f3ee', '#ffd400', '#00a3b8'], type: 'Sans pesada en mayúsculas, sin curvas',
  },
  {
    id: 'psicodelico', name: 'Psychedelic Universe', era: 'Psicodelia y rock progresivo',
    blurb: 'Profundidad, luz y ondas. Gradientes atmosféricos y movimiento lento.',
    swatches: ['#0d0821', '#8f2cc4', '#ff7bc8', '#ffb64d'], type: 'Serif liviana y amplia, brillos suaves',
  },
  {
    id: 'vinilo', name: 'Vinyl Archive', era: 'Tu colección de discos',
    blurb: 'Fundas de cartón, etiquetas, catálogo. Brilla en la Biblioteca y no molesta en el editor.',
    swatches: ['#e6dccb', '#1b1a18', '#d4572a', '#2f7d7a'], type: 'Etiquetas en mono, catálogo editorial',
  },
  {
    id: 'cuaderno', name: "Songwriter's Notebook", era: 'Cuaderno de composición',
    blurb: 'Papel pautado, tinta azul y margen rojo. Íntimo, para escribir letras.',
    swatches: ['#fbf8ef', '#1f3a8a', '#c2463c', '#2a2620'], type: 'Itálica de pluma, renglones',
  },
];
const IDS = new Set<string>(SKINS.map((skin) => skin.id));
export const isSkin = (value: unknown): value is Skin => typeof value === 'string' && IDS.has(value);

/** Applied before React renders so the first paint already has the chosen look (no flash of the default). */
export function applySkinEarly() {
  try {
    const stored = readPref<unknown>('appearance.skin', null);
    document.documentElement.dataset.skin = isSkin(stored) ? stored : 'estudio';
  } catch {
    document.documentElement.dataset.skin = 'estudio';
  }
}

/** Shows a universe without saving it (the theme picker's «Previsualizar»). `null` returns to the saved one. */
export function previewSkin(skin: Skin | null, saved: Skin) {
  document.documentElement.dataset.skin = skin ?? saved;
}

export function useSkin() {
  const [stored, setSkin] = usePref<Skin>('appearance.skin', 'estudio');
  const skin = isSkin(stored) ? stored : 'estudio';
  useEffect(() => {
    document.documentElement.dataset.skin = skin;
  }, [skin]);
  return [skin, setSkin] as const;
}
