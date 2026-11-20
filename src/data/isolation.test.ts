import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTablatureContent, type MusicalDocument } from '@/core/model';
import { ownerHint, readOwned, writeOwned } from '@/core/owner-storage';
import { db } from '@/data/database';
import { authenticated, identityMode, readIdentity, resolveVisible, signedOutExplicitly, trustsSession } from '@/data/identity';
import { appendBlocksToDocument } from '@/data/block-transfer';
import { AccessError, activateOwner, belongsToOwner, libraryScope } from '@/data/library-scope';
import { libraryRepository as repo } from '@/data/library-repository';
import { flushAllPendingSaves, registerFlush } from '@/data/pending-saves';
import { SyncEngine } from '@/features/sync/engine';
import { FakeTransport } from '@/features/sync/transport';

/**
 * v0.8 phase 1.2 — one browser profile, several people. Every test uses made-up accounts; nothing touches a real
 * library or a real server. The point of each: a record that is not the person's own can neither be seen nor changed,
 * by id, whatever the interface would have offered.
 */
const A = 'user-a';
const B = 'user-b';
const signInAs = async (id: string) => authenticated(id);
const doc = (id: string, ownerId: string | undefined, nodeId: string | null = null): MusicalDocument => ({
  id, nodeId, songId: null, type: 'tablature', title: `Material ${id}`, content: createTablatureContent(), rev: 1, createdAt: 1, updatedAt: 1, ...(ownerId ? { ownerId } : {}),
});
const ids = async () => (await db.documents.toArray()).map((item) => item.id).sort();
const visibleDocs = async () => {
  const scope = await libraryScope();
  return (await db.documents.toArray()).filter((item) => belongsToOwner(item, scope)).map((item) => item.id).sort();
};

beforeEach(() => window.localStorage.clear());
afterEach(async () => {
  await db.delete();
  await db.open();
});

describe('who the library on screen belongs to', () => {
  it('a profile that never signed in shows the anonymous library; a record of an account is never part of it', async () => {
    await db.documents.bulkAdd([doc('anon', undefined), doc('a1', A)]);
    expect(await visibleDocs()).toEqual(['anon']);
    expect(identityMode(await resolveVisible(), false, false)).toBe('anonymous');
  });
  it('signing in shows exactly that account; the others stay stored and hidden', async () => {
    await db.documents.bulkAdd([doc('a1', A), doc('b1', B)]);
    await signInAs(A);
    expect(await visibleDocs()).toEqual(['a1']);
    await signInAs(B);
    expect(await visibleDocs()).toEqual(['b1']);
    expect(await ids()).toEqual(['a1', 'b1']);
  });
  it('signing out hides everything of the account at once, deletes nothing, and signing in again brings it all back', async () => {
    await activateOwner(A);
    await db.documents.bulkAdd([doc('a1', A), doc('a2', A)]);
    await signedOutExplicitly();
    expect(await visibleDocs()).toEqual([]);
    expect(await ids()).toEqual(['a1', 'a2']);
    expect(identityMode(await resolveVisible(), false, true)).toBe('signed-out');
    await signInAs(A);
    expect(await visibleDocs()).toEqual(['a1', 'a2']);
  });
  it('an expired session changes nothing about who is on screen (offline work continues); only sync needs a session', async () => {
    await activateOwner(A);
    await db.documents.add(doc('a1', A));
    // Expiry never writes to the identity record: the person is the one who signed in before.
    expect(await visibleDocs()).toEqual(['a1']);
    expect(identityMode(await resolveVisible(), false, false)).toBe('expired');
    expect(identityMode(await resolveVisible(), true, false)).toBe('authenticated');
  });
  it('the epoch moves with every real change and stays put when nothing changed', async () => {
    await signInAs(A);
    const first = (await readIdentity())!.epoch;
    await signInAs(A);
    expect((await readIdentity())!.epoch).toBe(first);
    await signInAs(B);
    expect((await readIdentity())!.epoch).toBe(first + 1);
    await signedOutExplicitly();
    expect((await readIdentity())!.epoch).toBe(first + 2);
  });
  it('after signing out, records made on the device belong to nobody and are not given to the next account', async () => {
    await activateOwner(A);
    await signedOutExplicitly();
    const created = await repo.createStudyMaterial('Hecho sin cuenta');
    expect(created.ownerId).toBeUndefined();
    await signInAs(B);
    expect(await visibleDocs()).toEqual([]); // the device was linked once: B is not offered someone's anonymous work
    await signedOutExplicitly();
    expect(await visibleDocs()).toEqual([created.id]);
  });
  it('a device from before v0.8 (no identity record) keeps showing its linked account until the app decides', async () => {
    await db.settings.put({ key: 'library-scope', value: { ownerId: A, locked: true }, updatedAt: 1 });
    await db.documents.bulkAdd([doc('a1', A), doc('b1', B)]);
    const visible = await resolveVisible();
    expect(visible).toMatchObject({ ownerId: A, legacy: true });
    expect(await visibleDocs()).toEqual(['a1']);
  });
});

describe('operations by id are refused for another account, whatever the interface offered', () => {
  beforeEach(async () => {
    await db.nodes.bulkAdd([
      { id: 'nb', parentId: null, kind: 'folder', name: 'Carpeta de B', order: 1, createdAt: 1, updatedAt: 1, rev: 1, ownerId: B },
      { id: 'na', parentId: null, kind: 'folder', name: 'Carpeta de A', order: 1, createdAt: 1, updatedAt: 1, rev: 1, ownerId: A },
    ]);
    await db.documents.bulkAdd([doc('db', B, 'nb'), doc('da', A, 'na')]);
    await db.versions.bulkAdd([{ id: 'vb', documentId: 'db', createdAt: 1, reason: 'manual', title: 'v', content: createTablatureContent(), ownerId: B }]);
    await activateOwner(A);
  });
  const untouched = async () => {
    expect((await db.documents.get('db'))).toMatchObject({ title: 'Material db', rev: 1, nodeId: 'nb' });
    expect((await db.documents.get('db'))?.deletedAt).toBeUndefined();
    expect(await db.nodes.get('nb')).toMatchObject({ name: 'Carpeta de B', rev: 1 });
    expect(await db.documents.count()).toBe(2);
  };
  it('save', async () => {
    await expect(repo.saveDocument({ ...doc('db', B), title: 'Pisado' })).rejects.toBeInstanceOf(AccessError);
    await untouched();
  });
  it('duplicate (document and folder)', async () => {
    await expect(repo.duplicateDocument('db')).rejects.toBeInstanceOf(AccessError);
    await expect(repo.duplicateNode('nb')).rejects.toBeInstanceOf(AccessError);
    await untouched();
  });
  it('move (a foreign document, and my document into a foreign folder)', async () => {
    await expect(repo.moveDocument('db', null)).rejects.toBeInstanceOf(AccessError);
    await expect(repo.moveDocument('da', 'nb')).rejects.toBeInstanceOf(AccessError);
    await expect(repo.moveNode('na', 'nb')).rejects.toBeInstanceOf(AccessError);
    expect((await db.documents.get('da'))?.nodeId).toBe('na');
    await untouched();
  });
  it('trash and restore (documents and folders)', async () => {
    await expect(repo.trashDocument('db')).rejects.toBeInstanceOf(AccessError);
    await expect(repo.restoreDocument('db')).rejects.toBeInstanceOf(AccessError);
    await expect(repo.trashNode('nb')).rejects.toBeInstanceOf(AccessError);
    await expect(repo.restoreNode('nb')).rejects.toBeInstanceOf(AccessError);
    await untouched();
  });
  it('history: restoring a foreign version, or a version through my own document', async () => {
    await expect(repo.restoreVersion('db', 'vb')).rejects.toBeInstanceOf(AccessError);
    await expect(repo.restoreVersion('da', 'vb')).rejects.toBeInstanceOf(AccessError);
    await untouched();
  });
  it('rename or edit a folder, and create things inside a foreign folder', async () => {
    await expect(repo.updateNode('nb', { name: 'Robada' })).rejects.toBeInstanceOf(AccessError);
    await expect(repo.createNode('Dentro', 'folder', 'nb')).rejects.toBeInstanceOf(AccessError);
    await expect(repo.createDocument('tablature', 'Dentro', 'nb')).rejects.toBeInstanceOf(AccessError);
    await expect(repo.createStudyMaterial('Dentro', 'nb')).rejects.toBeInstanceOf(AccessError);
    await expect(repo.createFromTemplate('melody', 'nb')).rejects.toBeInstanceOf(AccessError);
    await untouched();
  });
  it('blocks cannot be written into a foreign song', async () => {
    await expect(appendBlocksToDocument('db', [])).rejects.toThrow();
    await untouched();
  });
  it('a missing id stays harmless (the same quiet no-op as before), only a foreign one is refused', async () => {
    await expect(repo.trashDocument('does-not-exist')).resolves.toBeUndefined();
    await expect(repo.moveDocument('does-not-exist', null)).resolves.toBeUndefined();
  });
  it('my own records still work in every one of those operations', async () => {
    await repo.saveDocument({ ...doc('da', A), title: 'Mío' });
    const copy = await repo.duplicateDocument('da');
    await repo.moveDocument('da', null);
    await repo.trashDocument('da');
    await repo.restoreDocument('da');
    await repo.trashNode('na');
    await repo.restoreNode('na');
    expect((await db.documents.get('da'))?.title).toBe('Mío');
    expect(copy.ownerId).toBe(A);
  });
  it('exporting a backup never includes another account', async () => {
    const backup = JSON.parse(await repo.exportBackup()) as { documents: Array<{ id: string }>; nodes: Array<{ id: string }>; versions: Array<{ id: string }> };
    expect(backup.documents.map((item) => item.id)).toEqual(['da']);
    expect(backup.nodes.map((item) => item.id)).toEqual(['na']);
    expect(backup.versions).toEqual([]);
  });
  it('a person signed out can only export what has no owner', async () => {
    await signedOutExplicitly();
    const backup = JSON.parse(await repo.exportBackup()) as { documents: unknown[]; nodes: unknown[] };
    expect(backup.documents).toEqual([]);
    expect(backup.nodes).toEqual([]);
  });
});

describe('importing a backup can never reach another account', () => {
  const backupOf = (documents: MusicalDocument[]) => JSON.stringify({ schema: 1, nodes: [], documents, versions: [] });
  beforeEach(async () => {
    await db.documents.add(doc('db', B));
    await activateOwner(A);
  });
  it("refuses a backup that belongs to another account, and imports nothing", async () => {
    await expect(repo.importBackup(backupOf([doc('x', B)]), 'merge')).rejects.toThrow('otra cuenta');
    expect(await ids()).toEqual(['db']);
  });
  it('refuses an id that already belongs to another account (it would overwrite their record)', async () => {
    await expect(repo.importBackup(backupOf([doc('db', A)]), 'merge')).rejects.toThrow('otra cuenta');
    expect((await db.documents.get('db'))?.ownerId).toBe(B);
  });
  it('"replace" only ever replaces what the person can see: other accounts survive', async () => {
    await db.documents.add(doc('da', A));
    await repo.importBackup(backupOf([doc('fresh', A)]), 'replace');
    expect(await ids()).toEqual(['db', 'fresh']);
  });
  it('taken as copies (an explicit choice), the records get new ids and the current owner, and nothing of the backup collides', async () => {
    await repo.importBackup(backupOf([doc('x', B)]), 'merge', { asCopies: true });
    const imported = (await db.documents.toArray()).filter((item) => item.id !== 'db');
    expect(imported).toHaveLength(1);
    expect(imported[0].id).not.toBe('x');
    expect(imported[0].ownerId).toBe(A);
    expect((await db.documents.get('db'))?.ownerId).toBe(B);
  });
  it('records without an owner are adopted by the account that imports them', async () => {
    await repo.importBackup(backupOf([doc('anon', undefined)]), 'merge');
    expect((await db.documents.get('anon'))?.ownerId).toBe(A);
  });
});

describe('what a sync may do while the person on screen changes', () => {
  it('refuses to start for an account that is not the one on screen', async () => {
    await activateOwner(A);
    await signedOutExplicitly();
    await expect(new SyncEngine(new FakeTransport()).sync(A)).rejects.toThrow('no está vinculada');
  });
  it('a page that arrives after someone else took the screen is not applied', async () => {
    await activateOwner(A);
    const remote = new FakeTransport();
    remote.inject(A, { kind: 'document', record: { ...doc('remote', A), lastOpId: 'op' } });
    const switching = {
      push: (...args: Parameters<FakeTransport['push']>) => remote.push(...args),
      pull: async (...args: Parameters<FakeTransport['pull']>) => {
        await signInAs(B); // while the response is on its way, B signs in
        return remote.pull(...args);
      },
    };
    await expect(new SyncEngine(switching).sync(A)).rejects.toThrow('La sesión cambió');
    expect(await ids()).toEqual([]); // nothing of A's page landed
  });
});

describe('saves that are still pending when the person changes', () => {
  it('are all flushed first, while the person is still the owner', async () => {
    await activateOwner(A);
    await db.documents.add(doc('da', A));
    let typed = 'borrador';
    const stop = registerFlush(async () => {
      await repo.saveDocument({ ...doc('da', A), title: typed });
    });
    await flushAllPendingSaves();
    await signedOutExplicitly();
    expect((await db.documents.get('da'))?.title).toBe('borrador');
    typed = 'tarde';
    // After the change of person, the same save is refused: nothing is written on behalf of the previous owner.
    await expect(repo.saveDocument({ ...doc('da', A), title: typed })).rejects.toBeInstanceOf(AccessError);
    stop();
    expect((await db.documents.get('da'))?.title).toBe('borrador');
  });
});

describe('personal preferences stay with the account that made them', () => {
  const setOwner = async (id: string | null) => (id ? signInAs(id) : signedOutExplicitly());
  it('each account has its own copy; another starts from the defaults', async () => {
    await setOwner(A);
    writeOwned('guitarap.pref.folder-presentations', '{"x":1}');
    await setOwner(B);
    expect(ownerHint()).toBe(B);
    expect(readOwned('guitarap.pref.folder-presentations')).toBeNull();
    writeOwned('guitarap.pref.folder-presentations', '{"y":2}');
    await setOwner(A);
    expect(readOwned('guitarap.pref.folder-presentations')).toBe('{"x":1}');
  });
  it('a value saved before this existed is kept untouched and is claimed once, by whoever reads it first', async () => {
    window.localStorage.setItem('guitarap.pref.folder-featured', '{"old":["1"]}');
    await setOwner(A);
    expect(readOwned('guitarap.pref.folder-featured')).toBe('{"old":["1"]}');
    await setOwner(B);
    expect(readOwned('guitarap.pref.folder-featured')).toBeNull(); // not handed to the second account
    expect(window.localStorage.getItem('guitarap.pref.folder-featured')).toBe('{"old":["1"]}'); // never deleted
  });
  it('signed out, nothing of an account is read', async () => {
    await setOwner(A);
    writeOwned('guitarap.pref.practice-last', '"da"');
    await setOwner(null);
    expect(ownerHint()).toBe('anon');
    expect(readOwned('guitarap.pref.practice-last')).toBeNull();
  });
});

describe('a session read from local storage cannot be edited into the library of another account', () => {
  it('only the account the profile already recognises is trusted', async () => {
    await signInAs(A);
    expect(await trustsSession(A)).toBe(true);
    expect(await trustsSession(B)).toBe(false);
  });
  it('after an explicit sign-out no stored session is trusted', async () => {
    await signInAs(A);
    await signedOutExplicitly();
    expect(await trustsSession(A)).toBe(false);
    expect(await trustsSession(B)).toBe(false);
  });
  it('a profile that never had an account on screen has nobody to be mistaken for', async () => {
    expect(await trustsSession(A)).toBe(true);
  });
  it('a profile from before v0.8 trusts only the account it was linked to', async () => {
    await db.settings.put({ key: 'library-scope', value: { ownerId: A, locked: true }, updatedAt: 1 });
    expect(await trustsSession(A)).toBe(true);
    expect(await trustsSession(B)).toBe(false);
  });
});
