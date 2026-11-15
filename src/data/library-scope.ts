import { db } from '@/data/database';

type Scope = { ownerId: string | null; locked: boolean };
const key = 'library-scope';
const fallback: Scope = { ownerId: null, locked: false };
export async function libraryScope() { return ((await db.settings.get(key))?.value as Scope | undefined) ?? fallback; }
export async function activeOwnerId() { return (await libraryScope()).ownerId; }
export async function activateOwner(ownerId: string) {
  const scope = await libraryScope();
  if (!scope.locked) await db.transaction('rw', db.nodes, db.documents, db.versions, async () => {
    const [nodes, documents, versions] = await Promise.all([db.nodes.toArray(), db.documents.toArray(), db.versions.toArray()]);
    await db.nodes.bulkPut(nodes.filter((item) => !item.ownerId).map((item) => ({ ...item, ownerId, rev: item.rev ?? 1 })));
    await db.documents.bulkPut(documents.filter((item) => !item.ownerId).map((item) => ({ ...item, ownerId })));
    await db.versions.bulkPut(versions.filter((item) => !item.ownerId).map((item) => ({ ...item, ownerId })));
  });
  await db.settings.put({ key, value: { ownerId, locked: true }, updatedAt: Date.now() });
}
export async function deactivateOwner() { const scope = await libraryScope(); if (scope.locked) await db.settings.put({ key, value: { ...scope, ownerId: null }, updatedAt: Date.now() }); }
export function belongsToOwner<T extends { ownerId?: string }>(item: T, scope: Scope) { return scope.ownerId ? item.ownerId === scope.ownerId : !scope.locked && !item.ownerId; }
