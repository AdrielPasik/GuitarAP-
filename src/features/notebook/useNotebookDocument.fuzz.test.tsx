import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/data/database';
import { listDrafts } from '@/data/drafts';
import { libraryRepository as repo } from '@/data/library-repository';
import { activateOwner, libraryScope } from '@/data/library-scope';
import { useNotebookDocument } from '@/features/notebook/useNotebookDocument';

/**
 * v0.8 phase 1.6 — hunting for a state the editor can get stuck in. Random (but reproducible) sequences of typing, undoing
 * back to what is stored, pausing, page-hidden events and another tab saving the same document, with a very short autosave
 * delay. After every sequence, once things settle, the editor must be at rest: never stuck on «Guardando…», the document
 * must hold what was typed last (or the other tab's text must be kept in the history), and no stale draft may remain.
 */
const A = 'user-a';
const mulberry = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  window.localStorage.clear();
  window.__GUITARAP_AUTOSAVE_DELAY = 8;
});
afterEach(async () => {
  window.__GUITARAP_AUTOSAVE_DELAY = undefined;
  await db.delete();
  await db.open();
});

describe('the editor always comes to rest', () => {
  it('after 300 random sequences of typing, undoing, pausing, hiding the page and a second tab saving', async () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      await db.delete();
      await db.open();
      await activateOwner(A);
      const random = mulberry(seed);
      window.__GUITARAP_AUTOSAVE_DELAY = Math.floor(random() * 40); // from instantly to a few keystrokes late
      const created = await repo.createStudyMaterial('Base');
      const ticket = await repo.openForEdit(created);
      const { result, unmount } = renderHook(() => useNotebookDocument(created, false, ticket));
      const otherTicket = await repo.openForEdit(created);
      let otherRev = created.rev;
      let last = 'Base';
      let other: string | undefined;
      const steps = 3 + Math.floor(random() * 8);
      for (let step = 0; step < steps; step += 1) {
        const pick = random();
        if (pick < 0.45) {
          last = `Texto ${seed}-${step}`;
          act(() => result.current.setTitle(last));
        } else if (pick < 0.6) {
          last = 'Base';
          act(() => result.current.setTitle('Base')); // back to exactly what is stored (only "saved" if nothing was saved in between)
        } else if (pick < 0.75) {
          await act(async () => {
            await sleep(Math.floor(random() * 25));
          });
        } else if (pick < 0.85) {
          act(() => {
            Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
            document.dispatchEvent(new Event('visibilitychange'));
            Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
          });
        } else {
          // A second tab saves through the same door a real tab uses (its own ticket, its own idea of the revision).
          other = `Otra pestaña ${seed}-${step}`;
          await repo.saveEdit(otherTicket, { ...created, title: other }, 'autosave', { expectedRev: otherRev, onRev: (rev) => (otherRev = rev) });
        }
      }
      // Settle: one more flush request (what leaving the page does) and wait for rest.
      await act(async () => {
        await result.current.retry();
      });
      await waitFor(() => expect(result.current.saveState, `seed ${seed}`).toBe('saved'), { timeout: 3000 });
      const stored = await db.documents.get(created.id);
      const titles = [stored?.title, ...(await db.versions.where('documentId').equals(created.id).toArray()).map((version) => version.title)];
      expect(stored?.title === last || titles.includes(last) || last === 'Base', `seed ${seed}: last typed "${last}" in ${JSON.stringify(titles)}`).toBe(true);
      if (other) expect(titles.includes(other) || stored?.title === other || stored?.title === last, `seed ${seed}: other tab's "${other}" lost`).toBe(true);
      await waitFor(async () => expect(await listDrafts(await libraryScope()), `seed ${seed}: stale draft`).toEqual([]), { timeout: 3000 });
      unmount();
      await sleep(5);
    }
  }, 240_000);
});
