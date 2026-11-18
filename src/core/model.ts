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
  /** Playback only. Absent = the document tempo (or the metronome's). */
  bpm?: number;
  /** Beats each column lasts when played. Absent = 1: a step is a beat unless said otherwise. */
  stepBeats?: number;
  instrument?: 'piano' | 'guitar';
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

/** One step of a melody: a pitched note or a rest. Pitch is a MIDI number (C4 = 60), never a display string. */
export type MelodyEvent = {
  id: string;
  type: 'note' | 'rest';
  /** MIDI pitch of a note. Absent for rests. */
  midi?: number;
  /** How the note is spelled when shown (Re♭ vs Do♯). Never changes the sound. */
  accidental?: 'sharp' | 'flat';
  /** Length in beats: 0.5 short, 1 normal, 2 long, 4 sustained. Any positive multiple of 0.25 is valid. */
  beats: number;
  /** Optional syllable sung on this note. "_" continues the previous syllable (melisma). */
  lyric?: string;
};
/** A sequence of notes, independent of any instrument. Its look (names, colours) is a preference, not data. */
export type MelodyContent = {
  version: 1;
  /** Stable reference to the lyrics block this melody is sung with. Removing the link keeps both blocks. */
  lyricsBlockId?: string;
  events: MelodyEvent[];
  /** Own tempo. Absent = the notebook's, then the metronome's. */
  bpm?: number;
  instrument?: 'piano' | 'guitar';
  /** Free text: the phrase sung over this melody, usable without aligning anything. */
  phrase?: string;
};
export type ChordItem = { id: string; symbol: string; beats: number };
export type ChordsContent = { version: 1; items: ChordItem[]; bpm?: number; instrument?: 'piano' | 'guitar' };
/** Lyrics as plain text. A line starting with "# " is a section title; [Am] inside a line is a chord. */
export type LyricsContent = { text: string; showChords?: boolean };

/** A personal annotation. Targets are ids, never indexes, so they survive reordering. */
export type NoteComment = {
  id: string;
  text: string;
  createdAt: number;
  updatedAt: number;
  /** Absent = a note about the whole notebook. */
  blockId?: string;
  /** A musical event inside the block (melody note, chord). */
  eventId?: string;
};
export type KeySignature = { tonic: string; mode: 'major' | 'minor' };
export type SongMeta = {
  key?: KeySignature;
  bpm?: number;
  timeSignature?: string;
  status?: 'idea' | 'progress' | 'done';
  tags?: string[];
};

/** A musical block inside a study notebook. Existing content models are reused as-is. */
export type NotebookBlock =
  | { id: string; kind: 'tablature'; title?: string; content: TablatureContent }
  | { id: string; kind: 'map'; title?: string; content: FretboardContent }
  | { id: string; kind: 'melody'; title?: string; content: MelodyContent }
  | { id: string; kind: 'lyrics'; title?: string; content: LyricsContent }
  | { id: string; kind: 'chords'; title?: string; content: ChordsContent }
  /** A named group: the blocks that follow it, up to the next section. Optional; never imposed. */
  | { id: string; kind: 'section'; title: string }
  | { id: string; kind: 'text'; style: TextBlockStyle; text: string };
export type NotebookContent = {
  kind: 'notebook';
  version: 1;
  blocks: NotebookBlock[];
  /** Optional song context (key, tempo…). Reading it never changes the music. */
  meta?: SongMeta;
  comments?: NoteComment[];
};

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
  reason: 'autosave' | 'pre-restore' | 'manual' | 'import' | 'conflict-device' | 'conflict-cloud';
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
