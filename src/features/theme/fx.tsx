import { useEffect } from 'react';
import { useFxPrefs } from '@/features/theme/fx-prefs';

/** Applies the decorative-effects preferences to <html> and pauses movement while the tab is hidden. */
export function FxEffects() {
  const { decor, motion } = useFxPrefs();
  useEffect(() => {
    document.documentElement.dataset.decor = decor ? 'on' : 'off';
    document.documentElement.dataset.motion = motion ? 'on' : 'off';
  }, [decor, motion]);
  useEffect(() => {
    const update = () => {
      document.documentElement.dataset.visible = document.hidden ? 'false' : 'true';
    };
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return null;
}
