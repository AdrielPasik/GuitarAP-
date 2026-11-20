import { liveQuery } from 'dexie';
import { rememberOwner } from '@/core/owner-storage';
import { db } from '@/data/database';

/**
 * WHO THE LIBRARY ON SCREEN BELONGS TO. One record, one reader.
 *
 * States of a browser profile:
 *  - signed in (a valid session) ........ `userId` set, `signedOut` false: that account's library is visible;
 *  - session expired (refresh refused) ... exactly the same record: the person is the one who signed in before, so the
 *                                          library stays available offline; only SYNC needs a valid session again;
 *  - explicitly signed out ............... `userId` null, `signedOut` true: no account's library is visible;
 *  - never signed in ..................... no record: the anonymous library is visible.
 * In every state the records of every other account stay on the device, untouched and hidden. The anonymous library
 * (records with no owner) is visible only when no account is.
 *
 * The record is written ONLY by the sign-in flow after the account service answered (sign-in or session refresh), by an
 * explicit sign-out, and by the one-time migration of a device that predates it. It lives in IndexedDB so that every
 * tab reads the same truth and a change in one tab re-runs the queries of the others. `epoch` goes up with every change:
 * anything asynchronous remembers the epoch it started under and discards its result if it moved.
 * (A person with full control of the browser can edit local storage; this is separation between people sharing a
 * profile, not protection against someone who owns the profile.)
 */
export type Identity = { userId: string | null; signedOut: boolean; epoch: number; updatedAt: number };
export type Visible = { ownerId: string | null; epoch: number; /** no identity record yet: the owner comes from the pre-0.8 scope */ legacy: boolean };

export const IDENTITY_KEY = 'identity';
const SCOPE_KEY = 'library-scope';

/** Owner of the library on screen, read in one consistent snapshot. */
export async function resolveVisible(): Promise<Visible> {
  return db.transaction('r', db.settings, async () => {
    const identity = (await db.settings.get(IDENTITY_KEY))?.value as Identity | undefined;
    if (identity) return { ownerId: identity.signedOut ? null : identity.userId, epoch: identity.epoch, legacy: false };
    const legacyOwner = ((await db.settings.get(SCOPE_KEY))?.value as { ownerId?: string | null } | undefined)?.ownerId ?? null;
    return { ownerId: legacyOwner, epoch: 0, legacy: true };
  });
}

async function change(next: { userId: string | null; signedOut: boolean }) {
  await db.transaction('rw', db.settings, async () => {
    const current = (await db.settings.get(IDENTITY_KEY))?.value as Identity | undefined;
    if (current && current.userId === next.userId && current.signedOut === next.signedOut) return;
    const value: Identity = { ...next, epoch: (current?.epoch ?? 0) + 1, updatedAt: Date.now() };
    await db.settings.put({ key: IDENTITY_KEY, value, updatedAt: value.updatedAt });
  });
  remember((await resolveVisible()).ownerId);
}

/** The account service accepted this person (sign-in or session refresh): their library is the one on screen. */
export const authenticated = (userId: string) => change({ userId, signedOut: false });
/** The person asked to leave: nothing of any account stays visible. Nothing is deleted. */
export const signedOutExplicitly = () => change({ userId: null, signedOut: true });

export type IdentityMode = 'authenticated' | 'expired' | 'signed-out' | 'anonymous';
/** How to describe the situation to the person. `hasSession`: a usable session exists in this tab. */
export function identityMode(visible: Visible, hasSession: boolean, signedOut: boolean): IdentityMode {
  if (visible.ownerId) return hasSession ? 'authenticated' : 'expired';
  return signedOut ? 'signed-out' : 'anonymous';
}
/**
 * May a session that was only READ from local storage (not just issued by the account service) put its account on
 * screen? Only if that account is already the one this profile recognises: a stored session can be edited, so it can
 * keep a person signed in but never switch the profile to someone else's library. A profile that has never had an
 * account on screen has nobody to be mistaken for.
 */
export async function trustsSession(userId: string): Promise<boolean> {
  const identity = await readIdentity();
  if (identity) return !identity.signedOut && identity.userId === userId;
  const legacyOwner = (await resolveVisible()).ownerId;
  return legacyOwner === null || legacyOwner === userId;
}
export async function readIdentity() {
  return (await db.settings.get(IDENTITY_KEY))?.value as Identity | undefined;
}

/** Keeps the synchronous owner hint (which personal preferences to read) equal to the authoritative owner. */
function remember(ownerId: string | null) {
  if (rememberOwner(ownerId)) window.dispatchEvent(new CustomEvent('guitarap:pref', { detail: '*' }));
}

/** Follows the visible owner in this and every other tab (IndexedDB changes are observed across tabs). */
export function watchVisible(onChange: (visible: Visible) => void) {
  const subscription = liveQuery(() => resolveVisible()).subscribe({
    next: (visible) => {
      remember(visible.ownerId);
      onChange(visible);
    },
    error: () => undefined,
  });
  return () => subscription.unsubscribe();
}

/** Called once before the first render: makes the preference namespace match the authoritative owner. */
export async function initIdentity() {
  try {
    remember((await resolveVisible()).ownerId);
  } catch {
    /* IndexedDB unavailable: the app runs without a library anyway */
  }
}
