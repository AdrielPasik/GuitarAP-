import { usePref } from '@/core/prefs';
import type { NameStyle } from '@/core/theory/pitch';

/** How note names are shown (Do Re Mi or C D E). A per-device preference: it never changes saved pitches. */
export function useNoteStyle() {
  const [style, setStyle] = usePref<NameStyle>('notation', 'latin');
  return [style, setStyle] as const;
}
