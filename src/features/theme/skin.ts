import { useEffect } from 'react';
import { usePref } from '@/core/prefs';

/**
 * The visual universe, independent of light/dark. A per-device preference (never part of a document and not synced:
 * two devices can look different without ever producing a conflict). «estudio» is the default and the look the app
 * had before skins existed.
 */
export type Skin = 'estudio' | 'britanico' | 'psicodelico';
export const SKINS: Array<{ id: Skin; name: string; blurb: string }> = [
  { id: 'estudio', name: 'Estudio analógico', blurb: 'Nogal, latón y papel: una consola de grabación cálida.' },
  { id: 'britanico', name: 'Rock británico', blurb: 'Papel crema, tinta y rojo vintage: un cuaderno de composición de los sesenta.' },
  { id: 'psicodelico', name: 'Psicodelia progresiva', blurb: 'Índigo profundo, magenta y ámbar, con ondas: la imaginación de los setenta.' },
];
const KEY = 'guitarap.pref.appearance.skin';
const valid = (value: unknown): value is Skin => value === 'estudio' || value === 'britanico' || value === 'psicodelico';

/** Applied before React renders so the first paint already has the chosen look. */
export function applySkinEarly() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? 'null');
    document.documentElement.dataset.skin = valid(stored) ? stored : 'estudio';
  } catch {
    document.documentElement.dataset.skin = 'estudio';
  }
}

export function useSkin() {
  const [stored, setSkin] = usePref<Skin>('appearance.skin', 'estudio');
  const skin = valid(stored) ? stored : 'estudio';
  useEffect(() => {
    document.documentElement.dataset.skin = skin;
  }, [skin]);
  return [skin, setSkin] as const;
}
