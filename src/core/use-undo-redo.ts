import { useCallback, useState } from 'react';

type Updater<T> = T | ((current: T) => T);

/** Keeps immutable editor state with bounded, deterministic undo and redo stacks. */
export function useUndoRedo<T>(initialValue: T, limit = 100) {
  const [present, setPresent] = useState(initialValue);
  const [past, setPast] = useState<T[]>([]);
  const [future, setFuture] = useState<T[]>([]);

  const set = useCallback((updater: Updater<T>) => {
    setPresent((current) => {
      const next = typeof updater === 'function' ? (updater as (value: T) => T)(current) : updater;
      if (Object.is(next, current)) return current;
      setPast((items) => [...items, structuredClone(current)].slice(-limit));
      setFuture([]);
      return next;
    });
  }, [limit]);

  const undo = useCallback(() => {
    setPast((items) => {
      const previous = items.at(-1);
      if (previous === undefined) return items;
      setPresent((current) => {
        setFuture((next) => [structuredClone(current), ...next].slice(0, limit));
        return previous;
      });
      return items.slice(0, -1);
    });
  }, [limit]);

  const redo = useCallback(() => {
    setFuture((items) => {
      const next = items[0];
      if (next === undefined) return items;
      setPresent((current) => {
        setPast((previous) => [...previous, structuredClone(current)].slice(-limit));
        return next;
      });
      return items.slice(1);
    });
  }, [limit]);

  /** Replaces the state and forgets the history: for content that arrives from outside (not an edit of mine). */
  const reset = useCallback((next: T) => {
    setPresent(next);
    setPast([]);
    setFuture([]);
  }, []);

  return { value: present, set, reset, undo, redo, canUndo: past.length > 0, canRedo: future.length > 0 };
}
