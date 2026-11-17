import { usePref } from '@/core/prefs';

/** Decorative illustrations ("decor") and their movement ("motion"): per-device preferences, never part of a document. */
export function useFxPrefs() {
  const [decor, setDecor] = usePref<boolean>('fx.decor', true);
  const [motion, setMotion] = usePref<boolean>('fx.motion', true);
  return { decor, setDecor, motion, setMotion };
}
