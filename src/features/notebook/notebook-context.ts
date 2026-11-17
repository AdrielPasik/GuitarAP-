import { createContext, useContext } from 'react';
import type { KeySignature } from '@/core/model';

/** What every block may know about the notebook it lives in. Reading it never changes the music. */
export type NotebookInfo = {
  docBpm?: number;
  key?: KeySignature;
  /** Opens the harmony tools in the context of this block's content (optional). */
  openTools?: (context?: { chord?: string }) => void;
  /** Adds a chord symbol to the chords block the user is working on. */
  readOnly?: boolean;
};
export const NotebookInfoContext = createContext<NotebookInfo>({});
export const useNotebookInfo = () => useContext(NotebookInfoContext);
