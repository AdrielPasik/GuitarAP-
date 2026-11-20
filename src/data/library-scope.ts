import { db } from '@/data/database';
import { authenticated, resolveVisible } from '@/data/identity';

/**
 * What the app may show and change RIGHT NOW. The owner comes from the identity module (see identity.ts), never from
 * a value that only this file wrote. `locked` only remembers that this profile has linked a library to an account at
 * least once (the first link claims the records that had no owner).
 */
export type Scope = { ownerId: string | null; locked: boolean; epoch: number };
const key = 'library-scope';

export async function libraryScope(): Promise<Scope> {
  return db.transaction('r', db.settings, async () => {
    const visible = await resolveVisible();
    const stored = (await db.settings.get(key))?.value as { locked?: boolean } | undefined;
    return { ownerId: visible.ownerId, locked: Boolean(stored?.locked), epoch: visible.epoch };
  });
}
export async function activeOwnerId() {
  return (await libraryScope()).ownerId;
}

/** Links this profile's library to an account. Records without an owner are claimed only the very first time. */
export async function activateOwner(ownerId: string) {
  await db.transaction('rw', db.nodes, db.documents, db.versions, db.settings, async () => {
    const locked = Boolean(((await db.settings.get(key))?.value as { locked?: boolean } | undefined)?.locked);
    if (!locked) {
      const [nodes, documents, versions] = await Promise.all([db.nodes.toArray(), db.documents.toArray(), db.versions.toArray()]);
      await db.nodes.bulkPut(nodes.filter((item) => !item.ownerId).map((item) => ({ ...item, ownerId, rev: item.rev ?? 1 })));
      await db.documents.bulkPut(documents.filter((item) => !item.ownerId).map((item) => ({ ...item, ownerId })));
      await db.versions.bulkPut(versions.filter((item) => !item.ownerId).map((item) => ({ ...item, ownerId })));
    }
    await db.settings.put({ key, value: { ownerId, locked: true }, updatedAt: Date.now() });
  });
  await authenticated(ownerId);
}

/**
 * A record is visible to the account on screen when it is theirs. Records that never had an owner (made on this device
 * before any account) are open to whoever uses the device signed out; once the device has been linked to an account they
 * are no longer offered to the signed-in person (the link claimed them; later ones wait for their explicit decision).
 */
export function belongsToOwner<T extends { ownerId?: string }>(item: T, scope: Pick<Scope, 'ownerId' | 'locked'>) {
  return scope.ownerId ? item.ownerId === scope.ownerId || (!scope.locked && !item.ownerId) : !item.ownerId;
}

/** Thrown when an operation names a record that is not the current owner's. It says the same thing whether the record exists or not. */
export class AccessError extends Error {
  constructor(what = 'material') {
    super(`No tenés acceso a ese ${what}.`);
    this.name = 'AccessError';
  }
}
/**
 * The single gate for operations by id. A record that is not there stays "not there" for the caller to decide; a record
 * that is there but belongs to someone else is refused, even if no screen could ever have offered its id.
 */
export function authorize<T extends { ownerId?: string }>(item: T | undefined, scope: Pick<Scope, 'ownerId' | 'locked'>, what = 'material'): T | undefined {
  if (item && !belongsToOwner(item, scope)) throw new AccessError(what);
  return item;
}
/** Same, but the record must exist. */
export function mustExist<T extends { ownerId?: string }>(item: T | undefined, scope: Pick<Scope, 'ownerId' | 'locked'>, missing: string, what = 'material'): T {
  if (!item) throw new Error(missing);
  return authorize(item, scope, what)!;
}
