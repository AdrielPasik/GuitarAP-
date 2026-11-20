import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MusicalDocument, NotebookContent } from '@/core/model';
import { fromNotebook, toNotebook } from '@/core/notebook';
import { useUndoRedo } from '@/core/use-undo-redo';
import { libraryRepository, type EditTicket } from '@/data/library-repository';
import { deleteDraft, writeDraft } from '@/data/drafts';
import { registerFlush } from '@/data/pending-saves';

export type SaveState = 'saved' | 'saving' | 'error' | 'draft';

declare global {
  interface Window {
    /** Test hook: makes the autosave wait this long, to prove that closing a session never depends on the timer. */
    __GUITARAP_AUTOSAVE_DELAY?: number;
    /** Test hook: makes the journal write wait this long first, to stand in for a slow disk. */
    __GUITARAP_JOURNAL_DELAY?: number;
  }
}

/**
 * Editing state of one document: the notebook with undo/redo, the title, and an autosave that
 * also flushes when the page is hidden or the editor closes, so the last keystrokes are never lost.
 */
export function useNotebookDocument(document: MusicalDocument, readOnly = false, ticket?: EditTicket) {
  const initial = useMemo(() => toNotebook(document), [document]);
  const history = useUndoRedo<NotebookContent>(initial);
  const [title, setTitle] = useState(document.title);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const serialize = useCallback(
    (notebook: NotebookContent, nextTitle: string) => JSON.stringify({ title: nextTitle, content: fromNotebook(document, notebook) }),
    [document],
  );
  const lastSaved = useRef(serialize(initial, document.title));
  const latest = useRef({ notebook: history.value, title });
  // Layout effects run in the same task as the keystroke that caused them: the journal write starts right away.
  useLayoutEffect(() => {
    latest.current = { notebook: history.value, title };
  });
  /** The revision this editor believes the stored document has (it moves when this editor saves). */
  const expectedRev = useRef(document.rev);
  const journalFailed = useRef(false);
  const wasDirty = useRef(false);

  // Journal: what the editor holds is written to the owner's drafts as soon as it differs from what is saved, one write
  // at a time and always the latest (no timer). If the tab dies before the save, the typing is still on disk.
  const journal = useRef<{ inflight: Promise<void> | null; again: boolean }>({ inflight: null, again: false });
  const writeJournal = useCallback(() => {
    if (!ticket) return;
    const state = journal.current;
    if (state.inflight) {
      state.again = true;
      return;
    }
    state.inflight = (async () => {
      do {
        state.again = false;
        const { notebook, title: currentTitle } = latest.current;
        if (serialize(notebook, currentTitle) === lastSaved.current) break;
        try {
          if (window.__GUITARAP_JOURNAL_DELAY) await new Promise((resolve) => window.setTimeout(resolve, window.__GUITARAP_JOURNAL_DELAY));
          await writeDraft({ documentId: document.id, ownerId: ticket.ownerId, title: currentTitle, content: fromNotebook(document, notebook), baseRev: document.rev, savedAt: Date.now(), reason: 'journal' });
          journalFailed.current = false;
        } catch {
          // The disk refused it: the edit is NOT safe. The editor says so, and the browser is asked to warn before leaving.
          journalFailed.current = true;
          setSaveState('error');
        }
      } while (state.again);
      state.inflight = null;
    })();
  }, [document, serialize, ticket]);

  const flush = useCallback(async () => {
    await journal.current.inflight; // never let an older journal write land after the save that supersedes it
    const { notebook, title: currentTitle } = latest.current;
    const next = serialize(notebook, currentTitle);
    if (next === lastSaved.current) return;
    lastSaved.current = next;
    try {
      setSaveState('saving');
      const edit = { ...document, title: currentTitle, content: fromNotebook(document, notebook) };
      // With a ticket the edit is finished for the owner who typed it, whoever is on screen by now; without one the strict path applies.
      if (ticket) setSaveState((await libraryRepository.saveEdit(ticket, edit, 'autosave', { expectedRev: expectedRev.current, onRev: (rev) => (expectedRev.current = rev) })) === 'saved' ? 'saved' : 'draft');
      else {
        await libraryRepository.saveDocument(edit);
        setSaveState('saved');
      }
    } catch {
      lastSaved.current = '';
      setSaveState('error');
    }
  }, [document, serialize, ticket]);

  useEffect(() => {
    if (readOnly) return;
    // Typed but not confirmed on disk yet: never "Guardado" until the write really finished.
    if (serialize(history.value, title) !== lastSaved.current) {
      wasDirty.current = true;
      setSaveState((state) => (state === 'error' ? state : 'saving'));
      writeJournal();
    } else if (wasDirty.current) {
      // The person undid back to exactly what is stored: there is nothing pending any more, and the journal entry of
      // the state they undid is stale (it must not be offered back later).
      wasDirty.current = false;
      const owner = ticket?.ownerId;
      if (journalFailed.current || ticket) {
        journalFailed.current = false;
        setSaveState((state) => (state === 'error' || state === 'saving' ? 'saved' : state));
      } else setSaveState((state) => (state === 'saving' ? 'saved' : state));
      if (ticket) void Promise.resolve(journal.current.inflight).then(() => deleteDraft(owner ?? null, document.id).catch(() => undefined));
    }
  }, [document.id, history.value, readOnly, serialize, ticket, title, writeJournal]);

  // Leaving while a write is still in flight, or after the disk refused one: ask the browser to let the person decide.
  useEffect(() => {
    if (readOnly || !ticket) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (journal.current.inflight || journalFailed.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [readOnly, ticket]);

  useEffect(() => {
    if (readOnly) return;
    if (serialize(history.value, title) === lastSaved.current) return;
    const timeout = window.setTimeout(() => void flush(), window.__GUITARAP_AUTOSAVE_DELAY ?? 700);
    return () => window.clearTimeout(timeout);
  }, [flush, history.value, readOnly, serialize, title]);

  useEffect(() => (readOnly ? undefined : registerFlush(flush)), [flush, readOnly]);

  useEffect(() => {
    if (readOnly) return;
    const hidden = () => {
      if (window.document.visibilityState === 'hidden') void flush();
    };
    window.document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', hidden);
    return () => {
      window.document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', hidden);
      void flush();
    };
  }, [flush, readOnly]);

  const { set: change, undo, redo, canUndo, canRedo } = history;

  return {
    notebook: history.value,
    change,
    title,
    setTitle,
    saveState,
    retry: flush,
    undo,
    redo,
    canUndo,
    canRedo,
  };
}
