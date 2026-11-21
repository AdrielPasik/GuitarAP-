/**
 * Editors register what saves their latest keystrokes. Before the person on screen changes (signing out, signing in as
 * someone else) every registered save runs while it is still authorised, so closing a session never loses the last
 * moments of work, and nothing is written afterwards on behalf of the previous person.
 */
const flushers = new Set<() => Promise<void> | void>();
export function registerFlush(flush: () => Promise<void> | void) {
  flushers.add(flush);
  return () => {
    flushers.delete(flush);
  };
}
export async function flushAllPendingSaves() {
  await Promise.allSettled([...flushers].map((flush) => flush()));
}

/**
 * Which editors hold changes that are not yet written into their document. The account's status reads this so that it can
 * never call everything saved while somebody is still typing, in this tab or (through the drafts) in another.
 */
const dirty = new Set<string>();
const listeners = new Set<() => void>();
export function setEditorDirty(id: string, isDirty: boolean) {
  if (isDirty === dirty.has(id)) return;
  if (isDirty) dirty.add(id);
  else dirty.delete(id);
  listeners.forEach((listener) => listener());
}
export const dirtyEditors = () => dirty.size;
export function subscribeDirty(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
