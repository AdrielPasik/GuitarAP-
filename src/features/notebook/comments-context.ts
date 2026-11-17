import { createContext, useContext } from 'react';
import type { NoteComment } from '@/core/model';

/** Personal annotations of the open notebook. Targets are ids, never indexes. */
export type CommentsApi = {
  all: NoteComment[];
  add: (target: { blockId?: string; eventId?: string }, text: string) => void;
  edit: (id: string, text: string) => void;
  remove: (id: string) => void;
  readOnly: boolean;
};
export const CommentsContext = createContext<CommentsApi>({ all: [], add: () => undefined, edit: () => undefined, remove: () => undefined, readOnly: true });
export const useComments = () => useContext(CommentsContext);
