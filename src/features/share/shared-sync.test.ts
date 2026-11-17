import { describe, expect, it } from 'vitest';
import type { NotebookBlock, NotebookContent } from '@/core/model';
import { CollabError, type Gateway } from '@/features/share/collab-api';
import { newCopy, pullShared, pushShared, type SharedApi } from '@/features/share/shared-sync';

const gateway: Gateway = { url: 'http://test', anonKey: 'anon' };
const lyrics = (id: string, text: string): NotebookBlock => ({ id, kind: 'lyrics', content: { text } });
const melody = (id: string, midis: number[]): NotebookBlock => ({ id, kind: 'melody', content: { version: 1, events: midis.map((midi, index) => ({ id: `${id}-${index}`, type: 'note', midi, beats: 1 })) } });
const book = (...blocks: NotebookBlock[]): NotebookContent => ({ kind: 'notebook', version: 1, blocks });

/** An in-memory stand-in for the server with the same compare-and-swap rule as collab_save_document. */
function fakeServer(initial: NotebookContent) {
  const state = { rev: 1, title: 'Tema', content: initial, allowed: true, online: true, saves: 0 };
  const api: SharedApi = {
    pull: async () => {
      if (!state.online) throw new CollabError('offline', 'offline');
      if (!state.allowed) throw new CollabError('forbidden', 'forbidden');
      return { id: 'doc', title: state.title, type: 'tablature', content: structuredClone(state.content), rev: state.rev, updatedAt: 0, role: 'editor' };
    },
    save: async (_g, _id, baseRev, title, content) => {
      if (!state.online) throw new CollabError('offline', 'offline');
      if (!state.allowed) throw new CollabError('forbidden', 'forbidden');
      if (baseRev !== state.rev) return { conflict: true as const, current: { title: state.title, content: structuredClone(state.content), rev: state.rev, updatedAt: 0 } };
      state.rev += 1;
      state.saves += 1;
      state.title = title;
      state.content = structuredClone(content);
      return { conflict: false as const, rev: state.rev, updatedAt: 0 };
    },
  };
  return { state, api };
}
const edit = (copy: ReturnType<typeof newCopy>, change: (content: NotebookContent) => NotebookContent) => ({ ...copy, content: change(structuredClone(copy.content)), dirty: true });
const textOf = (content: NotebookContent, id: string) => {
  const block = content.blocks.find((item) => item.id === id);
  return block?.kind === 'lyrics' ? block.content.text : undefined;
};

describe('two people editing one song', () => {
  const start = () => book(lyrics('l1', 'verso'), melody('m1', [60, 62]));

  it('Ana edits the lyrics, Beto edits the melody: both changes survive on both sides', async () => {
    const { state, api } = fakeServer(start());
    const ana = (await pullShared(api, gateway, null, 'doc', 'ana')).copy!;
    const beto = (await pullShared(api, gateway, null, 'doc', 'beto')).copy!;

    const anaEdited = edit(ana, (content) => ({ ...content, blocks: [lyrics('l1', 'verso de Ana'), content.blocks[1]] }));
    expect((await pushShared(api, gateway, anaEdited)).status).toBe('synced');

    const betoEdited = edit(beto, (content) => ({ ...content, blocks: [content.blocks[0], melody('m1', [60, 62, 64])] }));
    const betoPushed = await pushShared(api, gateway, betoEdited); // stale revision: merged, then uploaded
    expect(betoPushed.status).toBe('merged');
    expect(betoPushed.conflicts).toEqual([]);
    expect(textOf(state.content, 'l1')).toBe('verso de Ana');
    const m1 = state.content.blocks.find((block) => block.id === 'm1');
    expect(m1?.kind === 'melody' && m1.content.events).toHaveLength(3);

    // Ana pulls and sees Beto's melody without losing her lyrics.
    const anaAfter = await pullShared(api, gateway, anaEdited.dirty ? (await pushShared(api, gateway, anaEdited)).copy : anaEdited, 'doc', 'ana');
    expect(anaAfter.copy?.content.blocks.find((block) => block.id === 'm1')?.kind).toBe('melody');
    expect(textOf(anaAfter.copy!.content, 'l1')).toBe('verso de Ana');
  });

  it('both edit the same lyrics: nothing is overwritten, the other version stays and mine is kept as a copy', async () => {
    const { state, api } = fakeServer(start());
    const ana = (await pullShared(api, gateway, null, 'doc', 'ana')).copy!;
    const beto = (await pullShared(api, gateway, null, 'doc', 'beto')).copy!;
    await pushShared(api, gateway, edit(ana, (content) => ({ ...content, blocks: [lyrics('l1', 'versión de Ana'), content.blocks[1]] })));
    const result = await pushShared(api, gateway, edit(beto, (content) => ({ ...content, blocks: [lyrics('l1', 'versión de Beto'), content.blocks[1]] })));
    expect(result.status).toBe('merged');
    expect(result.conflicts).toHaveLength(1);
    expect(textOf(state.content, 'l1')).toBe('versión de Ana');
    expect(JSON.stringify(state.content)).toContain('versión de Beto'); // Beto's work is on the server too, as a labelled copy
    expect(state.content.blocks.length).toBe(3);
  });

  it('offline edits stay on the device, and go up when the connection returns', async () => {
    const { state, api } = fakeServer(start());
    const copy = (await pullShared(api, gateway, null, 'doc', 'beto')).copy!;
    state.online = false;
    const offline = await pushShared(api, gateway, edit(copy, (content) => ({ ...content, blocks: [lyrics('l1', 'escrito sin red'), content.blocks[1]] })));
    expect(offline.status).toBe('offline');
    expect(offline.copy?.dirty).toBe(true);
    expect(textOf(state.content, 'l1')).toBe('verso');
    state.online = true;
    const back = await pushShared(api, gateway, offline.copy!);
    expect(back.status).toBe('synced');
    expect(textOf(state.content, 'l1')).toBe('escrito sin red');
    expect(back.copy?.dirty).toBe(false);
  });

  it('after access is revoked, pending edits are NOT uploaded and the local copy is kept', async () => {
    const { state, api } = fakeServer(start());
    const copy = (await pullShared(api, gateway, null, 'doc', 'beto')).copy!;
    state.allowed = false;
    const edited = edit(copy, (content) => ({ ...content, blocks: [lyrics('l1', 'cambio tardío'), content.blocks[1]] }));
    const pushed = await pushShared(api, gateway, edited);
    expect(pushed.status).toBe('revoked');
    expect(pushed.copy?.dirty).toBe(true);
    expect(textOf(pushed.copy!.content, 'l1')).toBe('cambio tardío');
    expect(textOf(state.content, 'l1')).toBe('verso');
    expect(state.saves).toBe(0);
    const pulled = await pullShared(api, gateway, edited, 'doc', 'beto');
    expect(pulled.status).toBe('revoked');
    expect(pulled.copy).toBe(edited); // untouched
  });

  it('a clean copy follows the server; a copy with changes merges them in', async () => {
    const { state, api } = fakeServer(start());
    const copy = (await pullShared(api, gateway, null, 'doc', 'beto')).copy!;
    state.rev = 2;
    state.content = book(lyrics('l1', 'cambió el otro'), melody('m1', [60, 62]));
    const clean = await pullShared(api, gateway, copy, 'doc', 'beto');
    expect(textOf(clean.copy!.content, 'l1')).toBe('cambió el otro');
    expect(clean.copy?.dirty).toBe(false);
    const mine = edit(copy, (content) => ({ ...content, blocks: [content.blocks[0], melody('m1', [72])] }));
    const merged = await pullShared(api, gateway, mine, 'doc', 'beto');
    expect(merged.status).toBe('merged');
    expect(textOf(merged.copy!.content, 'l1')).toBe('cambió el otro');
    const m1 = merged.copy!.content.blocks.find((block) => block.id === 'm1');
    expect(m1?.kind === 'melody' && m1.content.events.map((event) => event.midi)).toEqual([72]);
  });
});
