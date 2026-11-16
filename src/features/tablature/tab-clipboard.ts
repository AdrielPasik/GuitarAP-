import { useSyncExternalStore } from 'react';
import type { TabClipboard } from '@/features/tablature/operations';

/** Shared by every tablature block, so a fragment can be copied from one block and pasted into another. */
let current: TabClipboard | null = null;
const listeners = new Set<() => void>();

export const readTabClipboard = () => current;
export function writeTabClipboard(value: TabClipboard) {
  current = value;
  listeners.forEach((listener) => listener());
}
export function useTabClipboard() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
