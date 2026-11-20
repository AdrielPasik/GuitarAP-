import { useLiveQuery } from 'dexie-react-hooks';
import { resolveVisible } from '@/data/identity';

/** The owner of the library on screen, live (also when another tab signs in or out). `undefined` only while it is first read. */
export function useVisible() {
  return useLiveQuery(() => resolveVisible(), []);
}
