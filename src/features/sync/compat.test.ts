import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTablatureContent, type DocumentVersion, type LibraryNode, type MusicalDocument } from '@/core/model';
import { db } from '@/data/database';
import { activateOwner } from '@/data/library-scope';
import { QUARANTINE_LIMIT, readHalt, readQuarantine, SyncEngine, countDeferred } from '@/features/sync/engine';
import { decideEvent, eventKey, isWellFormed } from '@/features/sync/event-policy';
import { FakeTransport, type ChangeEvent, type PullPage, type SyncTransport } from '@/features/sync/transport';
import { SyncEngine as LegacyEngine } from '@/test/legacy/engine-23e1e22';

/**
 * v0.8 phase 1.1 — what a client does with the cloud change log when it meets something it cannot read.
 * The protocol is untouched: every event below is injected into a FAKE log (no network, no real account).
 */
const OWNER = 'u';
const stamp = { ownerId: OWNER, lastOpId: 'op' };
const remoteNode = (id: string, parentId: string | null = null, kind: 'folder' | 'song' = 'folder') => ({ id, parentId, kind, name: id, order: 1, rev: 1, createdAt: 1, updatedAt: 1, ...stamp });
const remoteDoc = (id: string, nodeId: string | null = null, songId: string | null = null, title = id, rev = 1) =>
  ({ id, nodeId, songId, type: 'tablature' as const, title, content: createTablatureContent(), rev, createdAt: 1, updatedAt: 10 + rev, ...stamp });
const remoteVersion = (id: string, documentId: string) => ({ id, documentId, reason: 'manual', title: 'v', content: createTablatureContent(), createdAt: 2, ...stamp });
const event = (kind: string, record: unknown, extra: Partial<ChangeEvent> = {}): ChangeEvent => ({ kind, record, ...extra });
const mystery = (n = 1, extra: Partial<ChangeEvent> = {}) => event('mystery', { id: `m-${n}`, note: 'not a document' }, extra);
const cursorOf = async () => ((await db.settings.get(`sync-state:${OWNER}`))?.value as { cursor: string }).cursor;

afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete();
  await db.open();
});
const fresh = async () => {
  await activateOwner(OWNER);
  return new FakeTransport();
};
const ids = async () => ({
  nodes: (await db.nodes.toArray()).map((x) => x.id).sort(),
  documents: (await db.documents.toArray()).map((x) => x.id).sort(),
  versions: (await db.versions.toArray()).map((x) => x.id).sort(),
});

describe('event policy (pure decisions)', () => {
  it('knows the three kinds the server publishes today, with or without the future envelope', () => {
    for (const kind of ['node', 'document', 'version'] as const) {
      const record = { node: remoteNode('n'), document: remoteDoc('d'), version: remoteVersion('v', 'd') }[kind];
      expect(decideEvent({ kind, record })).toEqual({ action: 'apply', kind });
      expect(decideEvent({ kind, record, v: 1 })).toEqual({ action: 'apply', kind });
    }
  });
  it('an unknown kind without an envelope is NOT optional: it stops the download', () => {
    expect(decideEvent(mystery())).toEqual({ action: 'halt', reason: 'unsupported' });
    expect(decideEvent(mystery(1, { required: true }))).toEqual({ action: 'halt', reason: 'unsupported' });
  });
  it('only an event that says required:false is set aside', () => {
    expect(decideEvent(mystery(1, { required: false }))).toEqual({ action: 'quarantine', reason: 'unsupported' });
  });
  it('a newer envelope version of a known kind is unsupported, not "a document"', () => {
    expect(decideEvent({ kind: 'document', record: remoteDoc('d'), v: 2 })).toEqual({ action: 'halt', reason: 'unsupported' });
    expect(decideEvent({ kind: 'document', record: remoteDoc('d'), v: 2, required: false })).toEqual({ action: 'quarantine', reason: 'unsupported' });
    expect(decideEvent({ kind: 'document', record: remoteDoc('d'), v: 0 })).toEqual({ action: 'halt', reason: 'unsupported' });
  });
  it('a known kind with a malformed record is quarantined as invalid, never applied', () => {
    expect(decideEvent({ kind: 'document', record: { id: 'x' } })).toEqual({ action: 'quarantine', reason: 'invalid' });
    expect(decideEvent({ kind: 'node', record: null })).toEqual({ action: 'quarantine', reason: 'invalid' });
    expect(isWellFormed('version', remoteVersion('v', 'd'))).toBe(true);
    expect(isWellFormed('version', { id: 'v' })).toBe(false);
  });
  it('an extension that supports the kind and version takes the event', () => {
    const extension = { kind: 'mystery', version: 1, apply: () => undefined };
    expect(decideEvent(mystery(), [extension])).toEqual({ action: 'extension', extension });
    expect(decideEvent(mystery(1, { v: 2 }), [extension])).toEqual({ action: 'halt', reason: 'unsupported' });
  });
  it('the same event has the same identity whatever the key order', () => {
    expect(eventKey(event('k', { a: 1, b: { c: 2, d: 3 } }))).toBe(eventKey(event('k', { b: { d: 3, c: 2 }, a: 1 })));
    expect(eventKey(event('k', { a: 1 }))).not.toBe(eventKey(event('k', { a: 2 })));
  });
});

describe('unknown required events stop the download, they are never read as documents', () => {
  it('applies what comes before, stops at the event, leaves what comes after untouched and does not advance the cursor', async () => {
    const remote = await fresh();
    remote.inject(OWNER, event('document', remoteDoc('before')));
    remote.inject(OWNER, mystery(1));
    remote.inject(OWNER, event('document', remoteDoc('after')));
    const report = await new SyncEngine(remote).sync(OWNER);
    expect(report.halted).toMatchObject({ kind: 'mystery' });
    expect((await ids()).documents).toEqual(['before']); // nothing from the unknown event, nothing after it
    expect(await db.documents.get('m-1')).toBeUndefined(); // never interpreted as a document
    expect(await cursorOf()).toBe('0'); // the cursor did not pass the unknown event
    expect(await readHalt(OWNER)).toMatchObject({ kind: 'mystery', cursor: '0' });
    expect(await readQuarantine(OWNER)).toEqual([]); // required events are not set aside: the log is not allowed to move past them
  });
  it('stays stopped on the next sync (and does not duplicate the part it already applied)', async () => {
    const remote = await fresh();
    remote.inject(OWNER, event('document', remoteDoc('before')));
    remote.inject(OWNER, mystery(1));
    const engine = new SyncEngine(remote);
    await engine.sync(OWNER);
    const second = await engine.sync(OWNER);
    expect(second.halted).toBeTruthy();
    expect(second.pulled).toBe(0); // the applied prefix is recognised, not applied again
    expect(await db.documents.count()).toBe(1);
  });
  it('continues from exactly that event once a version that understands it is running', async () => {
    const remote = await fresh();
    remote.inject(OWNER, event('document', remoteDoc('before')));
    remote.inject(OWNER, mystery(1));
    remote.inject(OWNER, event('document', remoteDoc('after')));
    await new SyncEngine(remote).sync(OWNER);
    const seen: unknown[] = [];
    const upgraded = new SyncEngine(remote, 2, 100, undefined, [{ kind: 'mystery', version: 1, apply: (record) => void seen.push(record) }]);
    const report = await upgraded.sync(OWNER);
    expect(report.halted).toBeUndefined();
    expect((await ids()).documents).toEqual(['after', 'before']);
    expect(seen).toHaveLength(1);
    expect(await cursorOf()).toBe('3');
    expect(await readHalt(OWNER)).toBeUndefined();
  });
  it('an envelope-less event of a known kind with a newer version also stops (a future "document v2" is not a v1 document)', async () => {
    const remote = await fresh();
    remote.inject(OWNER, event('document', remoteDoc('v2-doc'), { v: 2 }));
    const report = await new SyncEngine(remote).sync(OWNER);
    expect(report.halted).toMatchObject({ kind: 'document', v: 2 });
    expect(await db.documents.count()).toBe(0);
  });
  it('still pushes local changes while the download is stopped', async () => {
    const remote = await fresh();
    remote.inject(OWNER, mystery(1));
    await db.documents.add({ id: 'mine', nodeId: null, type: 'tablature', title: 'Mía', content: createTablatureContent(), rev: 1, createdAt: 1, updatedAt: 1, ownerId: OWNER } as MusicalDocument);
    const report = await new SyncEngine(remote).sync(OWNER);
    expect(report.pushed).toBe(1);
    expect(report.halted).toBeTruthy();
  });
});

describe('unknown optional events are kept, untouched, for a version that can read them', () => {
  it('quarantines them with their exact content, moves the cursor on and applies the rest', async () => {
    const remote = await fresh();
    remote.inject(OWNER, event('document', remoteDoc('a')));
    remote.inject(OWNER, mystery(1, { required: false, v: 3 }));
    remote.inject(OWNER, event('document', remoteDoc('b')));
    const report = await new SyncEngine(remote).sync(OWNER);
    expect(report.halted).toBeUndefined();
    expect(report.quarantined).toBe(1);
    expect((await ids()).documents).toEqual(['a', 'b']);
    expect(await cursorOf()).toBe('3');
    const [entry] = await readQuarantine(OWNER);
    expect(entry).toMatchObject({ kind: 'mystery', v: 3, reason: 'unsupported', record: { id: 'm-1', note: 'not a document' } });
    expect(await db.documents.get('m-1')).toBeUndefined();
  });
  it('reading the same event twice (after an interruption) keeps it once', async () => {
    const remote = await fresh();
    remote.inject(OWNER, mystery(1, { required: false }));
    const engine = new SyncEngine(remote);
    await engine.sync(OWNER);
    await db.settings.update(`sync-state:${OWNER}`, { value: { cursor: '0', documents: {}, nodes: {}, versions: {}, conflicts: {} } }); // as if the cursor had not been saved
    await engine.sync(OWNER);
    expect(await readQuarantine(OWNER)).toHaveLength(1);
  });
  it('replays them in order when support exists, and keeps what is still unreadable', async () => {
    const remote = await fresh();
    remote.inject(OWNER, mystery(1, { required: false }));
    remote.inject(OWNER, event('other', { id: 'o-1' }, { required: false }));
    await new SyncEngine(remote).sync(OWNER);
    expect(await readQuarantine(OWNER)).toHaveLength(2);
    const applied: unknown[] = [];
    const upgraded = new SyncEngine(remote, 2, 100, undefined, [{ kind: 'mystery', version: 1, apply: (record) => void applied.push(record) }]);
    expect(await upgraded.replayQuarantine(OWNER)).toEqual({ replayed: 1, remaining: 1 });
    expect(applied).toEqual([{ id: 'm-1', note: 'not a document' }]);
    expect((await readQuarantine(OWNER)).map((entry) => entry.kind)).toEqual(['other']);
    expect(await new SyncEngine(remote).replayQuarantine(OWNER)).toEqual({ replayed: 0, remaining: 1 }); // a client without support loses nothing
  });
  it('a malformed event of a known kind is set aside as invalid and does not break the rest', async () => {
    const remote = await fresh();
    remote.inject(OWNER, event('document', { id: 'broken' }));
    remote.inject(OWNER, event('document', remoteDoc('fine')));
    const report = await new SyncEngine(remote).sync(OWNER);
    expect(report.halted).toBeUndefined();
    expect((await ids()).documents).toEqual(['fine']);
    expect((await readQuarantine(OWNER))[0]).toMatchObject({ reason: 'invalid', kind: 'document' });
  });
  it('pages made only of events that touch nothing (all set aside, or all waiting) are still saved whole', async () => {
    const remote = await fresh();
    for (let index = 0; index < 150; index += 1) remote.inject(OWNER, mystery(index, { required: false }));
    for (let index = 0; index < 150; index += 1) remote.inject(OWNER, event('document', remoteDoc(`w-${index}`, 'missing-folder')));
    const report = await new SyncEngine(remote, 2, 100).sync(OWNER);
    expect(report.quarantined).toBe(150);
    expect(report.deferred).toBe(150);
    expect(await cursorOf()).toBe('300');
    expect(await db.documents.count()).toBe(0);
  });
  it('a full quarantine stops the download instead of discarding', async () => {
    const remote = await fresh();
    await db.settings.put({
      key: `sync-quarantine:${OWNER}`,
      value: Array.from({ length: QUARANTINE_LIMIT }, (_, index) => ({ key: `k-${index}`, kind: 'x', reason: 'unsupported', record: {}, afterCursor: '0', at: 1 })),
      updatedAt: 1,
    });
    remote.inject(OWNER, mystery(9, { required: false }));
    const report = await new SyncEngine(remote).sync(OWNER);
    expect(report.halted).toBeTruthy();
    expect(await readQuarantine(OWNER)).toHaveLength(QUARANTINE_LIMIT);
    expect(await cursorOf()).toBe('0');
  });
});

describe('references that have not arrived yet are waited for, not lost and not fatal', () => {
  it('a document that points to a folder delivered later is applied when the folder arrives', async () => {
    const remote = await fresh();
    remote.inject(OWNER, event('document', remoteDoc('d', 'f')));
    remote.inject(OWNER, event('document', remoteDoc('other')));
    const engine = new SyncEngine(remote);
    const first = await engine.sync(OWNER);
    expect(first.deferred).toBe(1);
    expect((await ids()).documents).toEqual(['other']);
    expect(await countDeferred(OWNER)).toBe(1);
    remote.inject(OWNER, event('node', remoteNode('f')));
    const second = await new SyncEngine(remote).sync(OWNER); // a new engine, as after closing the app
    expect(second.deferred).toBe(0);
    expect((await ids()).documents).toEqual(['d', 'other']);
    expect((await db.documents.get('d'))?.nodeId).toBe('f');
  });
  it('a child folder before its parent, in either page, converges to the same tree', async () => {
    const remote = await fresh();
    remote.inject(OWNER, event('node', remoteNode('child', 'parent')));
    remote.inject(OWNER, event('node', remoteNode('parent')));
    const report = await new SyncEngine(remote, 2, 1).sync(OWNER); // one event per page
    expect(report.deferred).toBe(0);
    expect((await ids()).nodes).toEqual(['child', 'parent']);
  });
  it('a version of a document that has not arrived waits for it', async () => {
    const remote = await fresh();
    remote.inject(OWNER, event('version', remoteVersion('v1', 'd')));
    remote.inject(OWNER, event('document', remoteDoc('d')));
    const report = await new SyncEngine(remote, 2, 1).sync(OWNER);
    expect(report.deferred).toBe(0);
    expect((await ids()).versions).toEqual(['v1']);
  });
  it('a newer event about a waiting record replaces the old one (no stale copy is applied)', async () => {
    const remote = await fresh();
    remote.inject(OWNER, event('document', remoteDoc('d', 'f', null, 'viejo', 1)));
    remote.inject(OWNER, event('document', remoteDoc('d', null, null, 'nuevo', 2)));
    await new SyncEngine(remote).sync(OWNER);
    expect(await countDeferred(OWNER)).toBe(0);
    expect(await db.documents.get('d')).toMatchObject({ title: 'nuevo', rev: 2, nodeId: null });
  });
  it('what never arrives stays visible as waiting; nothing is dropped or applied by guessing', async () => {
    const remote = await fresh();
    remote.inject(OWNER, event('document', remoteDoc('d', 'ghost-folder')));
    const report = await new SyncEngine(remote).sync(OWNER);
    expect(report.deferred).toBe(1);
    expect(await db.documents.count()).toBe(0);
    expect(await cursorOf()).toBe('1'); // the event is stored in the replication state, so the cursor may move
  });
  it('a document whose song is actually a folder is set aside as invalid, not applied', async () => {
    const remote = await fresh();
    remote.inject(OWNER, event('node', remoteNode('not-a-song')));
    remote.inject(OWNER, event('document', remoteDoc('d', null, 'not-a-song')));
    await new SyncEngine(remote).sync(OWNER);
    expect(await db.documents.count()).toBe(0);
    expect((await readQuarantine(OWNER))[0]).toMatchObject({ reason: 'invalid' });
  });
});

describe('interruptions never lose an event or make a later attempt skip it', () => {
  it('an error in the middle of a page rolls the whole page back, including the state, and the next attempt gets everything', async () => {
    const remote = await fresh();
    remote.inject(OWNER, event('node', remoteNode('f')));
    remote.inject(OWNER, event('document', remoteDoc('d1', 'f')));
    remote.inject(OWNER, event('document', remoteDoc('d2', 'f')));
    const original = db.documents.put.bind(db.documents);
    let calls = 0;
    vi.spyOn(db.documents, 'put').mockImplementation(((...args: Parameters<typeof original>) => {
      calls += 1;
      if (calls === 2) throw new Error('disk full (simulated)');
      return original(...args);
    }) as typeof db.documents.put);
    await expect(new SyncEngine(remote).sync(OWNER)).rejects.toThrow('disk full');
    expect(await ids()).toEqual({ nodes: [], documents: [], versions: [] }); // nothing half-applied
    expect(await cursorOf()).toBe('0');
    vi.restoreAllMocks();
    const report = await new SyncEngine(remote).sync(OWNER);
    expect(report.pulled).toBe(3);
    expect(await ids()).toEqual({ nodes: ['f'], documents: ['d1', 'd2'], versions: [] });
    expect(await cursorOf()).toBe('3');
  });
  it('pages that committed stay committed when a later page fails, and the retry resumes after them', async () => {
    const remote = await fresh();
    for (let index = 0; index < 4; index += 1) remote.inject(OWNER, event('document', remoteDoc(`d${index}`)));
    let pulls = 0;
    const flaky: SyncTransport = {
      push: (...args) => remote.push(...args),
      pull: async (owner, cursor, limit) => {
        pulls += 1;
        if (pulls === 2) throw new Error('browser closed (simulated)');
        return remote.pull(owner, cursor, limit);
      },
    };
    await expect(new SyncEngine(flaky, 2, 2).sync(OWNER)).rejects.toThrow('browser closed');
    expect(await cursorOf()).toBe('2'); // the first page is saved WITH its data
    expect((await ids()).documents).toEqual(['d0', 'd1']);
    const report = await new SyncEngine(remote, 2, 2).sync(OWNER);
    expect(report.pulled).toBe(2); // only what was missing
    expect((await ids()).documents).toEqual(['d0', 'd1', 'd2', 'd3']);
  });
  it('replaying the whole log again changes nothing (idempotence)', async () => {
    const remote = await fresh();
    remote.inject(OWNER, event('node', remoteNode('f')));
    remote.inject(OWNER, event('document', remoteDoc('d', 'f')));
    remote.inject(OWNER, event('version', remoteVersion('v', 'd')));
    await new SyncEngine(remote).sync(OWNER);
    const before = JSON.stringify([await db.nodes.toArray(), await db.documents.toArray(), await db.versions.toArray()]);
    const state = (await db.settings.get(`sync-state:${OWNER}`))!.value as Record<string, unknown>;
    await db.settings.put({ key: `sync-state:${OWNER}`, value: { ...state, cursor: '0' }, updatedAt: 1 });
    const report = await new SyncEngine(remote).sync(OWNER);
    expect(report.conflicts).toBe(0);
    expect(report.copies).toEqual([]);
    expect(JSON.stringify([await db.nodes.toArray(), await db.documents.toArray(), await db.versions.toArray()])).toBe(before);
  });
  it('a document edited on this device is not overwritten by a replay of an older remote revision', async () => {
    const remote = await fresh();
    remote.inject(OWNER, event('document', remoteDoc('d', null, null, 'remoto', 1)));
    await new SyncEngine(remote).sync(OWNER);
    await db.documents.update('d', { title: 'editado aquí', rev: 2, updatedAt: 99 });
    const state = (await db.settings.get(`sync-state:${OWNER}`))!.value as Record<string, unknown>;
    await db.settings.put({ key: `sync-state:${OWNER}`, value: { ...state, cursor: '0' }, updatedAt: 1 });
    await new SyncEngine(new (class extends FakeTransport {
      async push() {
        return { documents: [], nodes: [], versions: [], conflicts: [] };
      }
      async pull(): Promise<PullPage> {
        return remote.pull(OWNER, '0', 100);
      }
    })()).sync(OWNER);
    expect((await db.documents.get('d'))?.title).toBe('editado aquí'); // the echo of the old revision is recognised
  });
});

describe('compatibility with the previous client (commit 23e1e22)', () => {
  const library = async () => {
    await db.nodes.add(remoteNode('f') as LibraryNode);
    await db.documents.add(remoteDoc('d', 'f') as unknown as MusicalDocument);
    await db.versions.add(remoteVersion('v', 'd') as unknown as DocumentVersion);
  };
  const wipe = async () => {
    await db.delete();
    await db.open();
    await activateOwner(OWNER);
  };
  it('the previous client pushes and the current one recovers the same library from the same log', async () => {
    const remote = await fresh();
    await library();
    expect((await new LegacyEngine(remote).sync(OWNER)).pushed).toBe(3);
    await wipe();
    const report = await new SyncEngine(remote).sync(OWNER);
    expect(report.pulled).toBe(3);
    expect(await ids()).toEqual({ nodes: ['f'], documents: ['d'], versions: ['v'] });
  });
  it('the current client pushes and the previous one recovers the same library', async () => {
    const remote = await fresh();
    await library();
    expect((await new SyncEngine(remote).sync(OWNER)).pushed).toBe(3);
    await wipe();
    const report = await new LegacyEngine(remote).sync(OWNER);
    expect(report.pulled).toBe(3);
    expect(await ids()).toEqual({ nodes: ['f'], documents: ['d'], versions: ['v'] });
  });
  it('both clients may alternate on one log without duplicates or conflicts', async () => {
    const remote = await fresh();
    await library();
    await new LegacyEngine(remote).sync(OWNER);
    await db.documents.update('d', { title: 'cambiado', rev: 2, updatedAt: 50 });
    const current = await new SyncEngine(remote).sync(OWNER);
    expect(current.pushed).toBe(1);
    expect(current.conflicts).toBe(0);
    const legacy = await new LegacyEngine(remote).sync(OWNER);
    expect(legacy.conflicts).toBe(0);
    expect(await db.documents.count()).toBe(1);
  });
  it('WHY the log must never carry a new kind: the previous client cannot survive one, the current one handles it cleanly', async () => {
    const remote = await fresh();
    remote.inject(OWNER, event('document', remoteDoc('first')));
    remote.inject(OWNER, event('setting', { key: 'skin', value: 'psicodelico' }));
    remote.inject(OWNER, event('document', remoteDoc('last')));
    // Previous client: reads the unknown event as a document and cannot go past it (the download fails and never advances).
    await expect(new LegacyEngine(remote).sync(OWNER)).rejects.toThrow();
    const stuck = ((await db.settings.get(`sync-state:${OWNER}`))?.value as { cursor: string } | undefined)?.cursor ?? '0';
    expect(stuck).toBe('0');
    await wipe();
    // Current client: stops with a clear report, applies what came before, interprets nothing, loses nothing.
    const report = await new SyncEngine(remote).sync(OWNER);
    expect(report.halted).toMatchObject({ kind: 'setting' });
    expect((await ids()).documents).toEqual(['first']);
  });
  it('WHY the previous client could lose events: after an error mid-page its next attempt skips what the failed page had "confirmed"', async () => {
    const remote = await fresh();
    remote.inject(OWNER, event('node', remoteNode('a')));
    remote.inject(OWNER, event('document', remoteDoc('b', null, 'song-later')));
    await expect(new LegacyEngine(remote).sync(OWNER)).rejects.toThrow(); // the song has not arrived: the page is rolled back
    remote.inject(OWNER, event('node', remoteNode('song-later', null, 'song')));
    await expect(new LegacyEngine(remote).sync(OWNER)).rejects.toThrow(); // still stuck, now for good
    expect(await db.nodes.get('a')).toBeUndefined(); // 'a' was confirmed in memory, rolled back on disk, and is skipped from now on
    await db.delete();
    await db.open();
    await activateOwner(OWNER);
    // The current client keeps the same log and finishes the job.
    await new SyncEngine(remote).sync(OWNER);
    expect((await ids()).nodes).toEqual(['a', 'song-later']);
    expect((await ids()).documents).toEqual(['b']);
  });
});
