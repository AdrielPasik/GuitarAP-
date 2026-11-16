import type { Role } from '@/core/harmony';
import { STANDARD_TUNING } from '@/core/music';

export type DocumentType = 'tablature' | 'fretboard';
export type NodeKind = 'folder' | 'song';
export type Technique =
  | 'hammer-on'
  | 'pull-off'
  | 'slide-up'
  | 'slide-down'
  | 'bend-half'
  | 'bend-full'
  | 'vibrato'
  | 'mute';

export type LibraryNode = {
  id: string;
  parentId: string | null;
  kind: NodeKind;
  name: string;
  order: number;
  deletedAt?: number;
  createdAt: number;
  updatedAt: number;
  rev?: number;
  ownerId?: string;
  song?: { artist?: string; key?: string; bpm?: number; comments?: string };
};

export type TabCell = { fret?: number; techniques?: Technique[]; annotation?: string };
export type TabColumn = { id: string; cells: TabCell[]; section?: string; lineBreak?: boolean };
export type LinkedTechnique = Extract<
  Technique,
  'hammer-on' | 'pull-off' | 'slide-up' | 'slide-down'
>;
/** A musical gesture between two actual notes. Column ids, rather than indexes,
 * keep it stable while the tablature is reflowed or columns are inserted. */
export type TabTechniqueLink = {
  id: string;
  technique: LinkedTechnique;
  from: { columnId: string; string: number };
  to: { columnId: string; string: number };
};
/** A temporal sequence: every column is one musical event, in reading order. */
export type TablatureContent = {
  tuning: string[];
  columns: TabColumn[];
  zoom: number;
  wrapAfter: number;
  annotations: string[];
  /** Optional for backwards compatibility with documents saved before links. */
  techniqueLinks?: TabTechniqueLink[];
};

export type FretNote = { string: number; fret: number; finger?: 1 | 2 | 3 | 4; root?: boolean };
export type FretPosition = { id: string; name: string; notes: FretNote[]; comments?: string };
/**
 * How a map is read. Purely visual: none of it adds, removes or moves a note.
 * Every field is optional so maps saved by earlier versions keep working.
 */
export type FretboardView = {
  /** What each point says. Falls back to `notation` for older maps. */
  labels?: 'notes' | 'intervals' | 'both';
  /** Harmonic functions kept in full color; the rest are softened. Absent = all. */
  emphasis?: Role[];
  /** Compact legend under the neck (default on). */
  legend?: boolean;
  /** Name the degrees 9, 11 and 13 instead of 2, 4 and 6. */
  extensions?: boolean;
  /** Dashed hints of the scale's notes (default on for maps saved before this option). */
  guide?: boolean;
};

/** A spatial map: points on the instrument, with no order and no time. */
export type FretboardContent = {
  tuning: string[];
  maxFret: number;
  /** First visible fret. Optional so maps saved before ranges keep working (0). */
  minFret?: number;
  root: number;
  notation: 'notes' | 'intervals';
  latin: boolean;
  positions: FretPosition[];
  baseNotes: FretNote[];
  selectedPositionId: string;
  view?: FretboardView;
};

export type TextBlockStyle = 'heading' | 'note';
/** A musical block inside a study notebook. Existing content models are reused as-is. */
export type NotebookBlock =
  | { id: string; kind: 'tablature'; title?: string; content: TablatureContent }
  | { id: string; kind: 'map'; title?: string; content: FretboardContent }
  | { id: string; kind: 'text'; style: TextBlockStyle; text: string };
export type NotebookContent = { kind: 'notebook'; version: 1; blocks: NotebookBlock[] };

export type MusicalDocument = {
  id: string;
  nodeId: string | null;
  songId?: string | null;
  /** Coarse category persisted in SQL (CHECK constraint). The real shape lives in `content`. */
  type: DocumentType;
  title: string;
  content: TablatureContent | FretboardContent | NotebookContent;
  rev: number;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
  ownerId?: string;
};

export type DocumentVersion = {
  id: string;
  documentId: string;
  createdAt: number;
  reason: 'autosave' | 'pre-restore' | 'manual' | 'import';
  title: string;
  content: MusicalDocument['content'];
  ownerId?: string;
};

export type AppSetting = { key: string; value: unknown; updatedAt: number };

export function createTablatureContent(): TablatureContent {
  return {
    tuning: [...STANDARD_TUNING],
    columns: Array.from({ length: 16 }, () => ({
      id: crypto.randomUUID(),
      cells: Array.from({ length: 6 }, () => ({})),
    })),
    zoom: 1,
    wrapAfter: 16,
    annotations: [],
    techniqueLinks: [],
  };
}

export function createFretboardContent(): FretboardContent {
  const position = { id: crypto.randomUUID(), name: 'Posición 1', notes: [] };
  return {
    tuning: [...STANDARD_TUNING],
    maxFret: 15,
    root: 0,
    notation: 'notes',
    latin: true,
    positions: [position],
    baseNotes: [],
    selectedPositionId: position.id,
    // A new map starts without hints so the scale can be found by ear; older maps keep theirs.
    view: { guide: false },
  };
}
