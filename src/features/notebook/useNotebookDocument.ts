import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MusicalDocument, NotebookContent } from '@/core/model';
import { fromNotebook, toNotebook } from '@/core/notebook';
import { useUndoRedo } from '@/core/use-undo-redo';
import { libraryRepository } from '@/data/library-repository';
import { registerFlush } from '@/data/pending-saves';

export type SaveState = 'saved' | 'saving' | 'error';

/**
 * Editing state of one document: the notebook with undo/redo, the title, and an autosave that
 * also flushes when the page is hidden or the editor closes, so the last keystrokes are never lost.
 */
export function useNotebookDocument(document: MusicalDocument, readOnly = false) {
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

  const flush = useCallback(async () => {
    const { notebook, title: currentTitle } = latest.current;
    const next = serialize(notebook, currentTitle);
    if (next === lastSaved.current) return;
    lastSaved.current = next;
    try {
      setSaveState('saving');
      await libraryRepository.saveDocument({ ...document, title: currentTitle, content: fromNotebook(document, notebook) });
      setSaveState('saved');
    } catch {
      lastSaved.current = '';
      setSaveState('error');
    }
  }, [document, serialize]);

  useEffect(() => {
    if (readOnly) return;
    if (serialize(history.value, title) === lastSaved.current) return;
    const timeout = window.setTimeout(() => void flush(), 700);
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
