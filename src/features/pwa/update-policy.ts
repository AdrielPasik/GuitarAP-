/** When and how firmly to remind about an update that is waiting (see PwaRegistration.tsx). */
export const FIRM_AFTER_DAYS = 3;
export const URGENT_AFTER_DAYS = 14;
const SEEN_KEY = 'guitarap.update.firstSeen';

/** How firmly the notice should speak after an update has been waiting this many days. */
export const noticeLevel = (days: number): 'normal' | 'firm' | 'urgent' => (days >= URGENT_AFTER_DAYS ? 'urgent' : days >= FIRM_AFTER_DAYS ? 'firm' : 'normal');

/** The first time this device saw the update waiting (remembered so the days keep counting across reloads). */
export function daysWaiting(now = Date.now(), storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage): number {
  try {
    const seen = Number(storage.getItem(SEEN_KEY));
    if (Number.isFinite(seen) && seen > 0) return Math.floor((now - seen) / 86_400_000);
    storage.setItem(SEEN_KEY, String(now));
  } catch {
    /* storage unavailable: the notice stays at its first level */
  }
  return 0;
}
export function forgetWaiting() {
  try {
    window.localStorage.removeItem(SEEN_KEY);
  } catch {
    /* nothing to forget */
  }
}

