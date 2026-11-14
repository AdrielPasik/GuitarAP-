import { STANDARD_TUNING } from '@/core/music';

export type DocumentType = 'tablature' | 'fretboard';
export type NodeKind = 'folder' | 'song';
export type Technique = 'hammer-on' | 'pull-off' | 'slide-up' | 'slide-down' | 'bend-half' | 'bend-full' | 'vibrato' | 'mute';

export type LibraryNode = {
  id: string;
  parentId: string | null;
  kind: NodeKind;
  name: string;
  order: number;
  deletedAt?: number;
  createdAt: number;
  updatedAt: number;
  song?: { artist?: string; key?: string; bpm?: number; comments?: string };
};

export type TabCell = { fret?: number; techniques?: Technique[]; annotation?: string };
export type TabColumn = { id: string; cells: TabCell[]; section?: string };
export type TablatureContent = {
  tuning: string[];
  columns: TabColumn[];
  zoom: number;
  wrapAfter: number;
  annotations: string[];
};

export type FretNote = { string: number; fret: number; finger?: 1 | 2 | 3 | 4; root?: boolean };
export type FretPosition = { id: string; name: string; notes: FretNote[]; comments?: string };
export type FretboardContent = {
  tuning: string[];
  maxFret: number;
  root: number;
  notation: 'notes' | 'intervals';
  latin: boolean;
  positions: FretPosition[];
  baseNotes: FretNote[];
  selectedPositionId: string;
};

export type MusicalDocument = {
  id: string;
  nodeId: string | null;
  songId?: string | null;
  type: DocumentType;
  title: string;
  content: TablatureContent | FretboardContent;
  rev: number;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
};

export type DocumentVersion = {
  id: string;
  documentId: string;
  createdAt: number;
  reason: 'autosave' | 'pre-restore' | 'manual' | 'import';
  title: string;
  content: MusicalDocument['content'];
};

export type AppSetting = { key: string; value: unknown; updatedAt: number };

export function createTablatureContent(): TablatureContent {
  return {
    tuning: [...STANDARD_TUNING],
    columns: Array.from({ length: 16 }, () => ({ id: crypto.randomUUID(), cells: Array.from({ length: 6 }, () => ({})) })),
    zoom: 1,
    wrapAfter: 16,
    annotations: [],
  };
}

export function createFretboardContent(): FretboardContent {
  const position = { id: crypto.randomUUID(), name: 'Posición 1', notes: [] };
  return {
    tuning: [...STANDARD_TUNING],
    maxFret: 15,
    root: 0,
    notation: 'notes',
    latin: false,
    positions: [position],
    baseNotes: [],
    selectedPositionId: position.id,
  };
}
