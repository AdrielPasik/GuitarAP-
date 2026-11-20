import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MusicalDocument, NotebookContent } from '@/core/model';
import { fromNotebook, toNotebook } from '@/core/notebook';
import { useUndoRedo } from '@/core/use-undo-redo';
import { libraryRepository, type EditTicket } from '@/data/library-repository';
import { writeDraft } from '@/data/drafts';
import { registerFlush } from '@/data/pending-saves';

export type SaveState = 'saved' | 'saving' | 'error' | 'draft';

declare global {
  interface Window {
    /** Test hook: makes the autosave wait this long, to prove that closing a session never depends on the timer. */
    __GUITARAP_AUTOSAVE_DELAY?: number;
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
  useEffect(() => {
    latest.current = { notebook: history.value, title };
  });

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
        await writeDraft({ documentId: document.id, ownerId: ticket.ownerId, title: currentTitle, content: fromNotebook(document, notebook), baseRev: document.rev, savedAt: Date.now(), reason: 'journal' }).catch(() => undefined);
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
      if (ticket) setSaveState((await libraryRepository.saveEdit(ticket, edit)) === 'saved' ? 'saved' : 'draft');
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
    if (serialize(history.value, title) !== lastSaved.current) writeJournal();
  }, [history.value, readOnly, serialize, title, writeJournal]);

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
