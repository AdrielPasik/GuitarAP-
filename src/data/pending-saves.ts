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
