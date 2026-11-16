import { useCallback, useState } from 'react';

const PREFIX = 'guitarap.pref.';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/** A small per-device preference (never part of a document, never synced). */
export function usePref<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => read(key, fallback));
  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(PREFIX + key, JSON.stringify(next));
      } catch {
        /* storage unavailable: the preference lasts for this session only */
      }
    },
    [key],
  );
  return [value, update] as const;
}
