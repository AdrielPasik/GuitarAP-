/**
 * Personal data kept in this browser's localStorage (folder presentation, highlights, the look, shared links...) belongs
 * to the account on screen, not to the browser: each account reads and writes its own copy, so two people who share a
 * profile never see each other's. The owner comes from a synchronous HINT written by the identity module every time the
 * visible owner changes (the authoritative record lives in IndexedDB; see data/identity.ts).
 *
 * Values saved before this existed (no owner in the key) are never deleted. The FIRST account that reads one after the
 * upgrade claims it (on a device that was already linked, that is its owner, because the hint is set before the first
 * render); everyone else starts from the defaults.
 */
export const ANON = 'anon';
const HINT_KEY = 'guitarap.owner-hint';

export function ownerHint(): string {
  try {
    return window.localStorage.getItem(HINT_KEY) || ANON;
  } catch {
    return ANON;
  }
}
/** Returns true when the hint changed. */
export function rememberOwner(ownerId: string | null): boolean {
  try {
    const next = ownerId ?? ANON;
    if (window.localStorage.getItem(HINT_KEY) === next) return false;
    window.localStorage.setItem(HINT_KEY, next);
    return true;
  } catch {
    return false;
  }
}

export const ownerKey = (base: string) => `${base}@${ownerHint()}`;

export function readOwned(base: string): string | null {
  try {
    const key = ownerKey(base);
    const own = window.localStorage.getItem(key);
    if (own !== null) return own;
    const claimed = `${base}@claimed`;
    if (window.localStorage.getItem(claimed) !== null) return null;
    window.localStorage.setItem(claimed, ownerHint());
    const legacy = window.localStorage.getItem(base);
    if (legacy !== null) window.localStorage.setItem(key, legacy);
    return legacy;
  } catch {
    return null;
  }
}
export function writeOwned(base: string, value: string) {
  window.localStorage.setItem(ownerKey(base), value);
}
