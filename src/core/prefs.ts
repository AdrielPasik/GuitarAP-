import { useCallback, useEffect, useState } from 'react';

import { readOwned, writeOwned } from '@/core/owner-storage';

const PREFIX = 'guitarap.pref.';
/**
 * Preferences that describe a PERSON, not a device: they are kept per account (see owner-storage.ts) so that people who
 * share a browser profile never see each other's. Everything else (volumes, metronome, panel sizes...) stays per device.
 * Phase 2 of v0.8 will make these follow the account across devices.
 */
export const ACCOUNT_PREFS: ReadonlySet<string> = new Set(['folder-presentations', 'folder-featured', 'practice-last', 'appearance.skin', 'fx.decor']);
const EVENT = 'guitarap:pref';

export function readPref<T>(key: string, fallback: T): T {
  return read(key, fallback);
}
function read<T>(key: string, fallback: T): T {
  try {
    const raw = ACCOUNT_PREFS.has(key) ? readOwned(PREFIX + key) : window.localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/**
 * A small per-device preference (never part of a document, never synced). Every component that reads the
 * same key follows a change made anywhere: the instrument chosen in one block is the one in the next.
 */
export function usePref<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => read(key, fallback));
  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (detail === key || detail === '*') setValue(read(key, fallback));
    };
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
    // `fallback` is a constant default at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        if (ACCOUNT_PREFS.has(key)) writeOwned(PREFIX + key, JSON.stringify(next));
        else window.localStorage.setItem(PREFIX + key, JSON.stringify(next));
      } catch {
        /* storage unavailable: the preference lasts for this session only */
      }
      window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
    },
    [key],
  );
  return [value, update] as const;
}
