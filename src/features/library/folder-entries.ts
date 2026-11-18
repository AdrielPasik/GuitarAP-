import type { CoverStyle, LibraryNode, MusicalDocument, SongMeta } from '@/core/model';
import { documentKind, toNotebook, type DocumentKind } from '@/core/notebook';
import type { GroupKey, SortKey } from '@/core/presentation';
import { keyTitle } from '@/core/theory/keys';

/**
 * One row of a folder, whatever its origin (a material or a sub-folder / song). Only facts read from the data:
 * a missing artist stays missing, it is never guessed.
 */
export type Entry = {
  id: string;
  type: 'doc' | 'node';
  kind: DocumentKind | 'folder' | 'song';
  title: string;
  artist?: string;
  album?: string;
  year?: number;
  key?: string;
  bpm?: number;
  chords?: string[];
  tags?: string[];
  status?: SongMeta['status'];
  notes?: string;
  cover: { style: CoverStyle; hue: number; chosen: boolean };
  createdAt: number;
  updatedAt: number;
  shared: boolean;
  /** For folders/songs: how many items they hold. */
  count?: number;
  order: number;
  doc?: MusicalDocument;
  node?: LibraryNode;
  /** Whether quick playback has something to play. */
  playable: boolean;
};

/** A stable hue from a name, so each item keeps its own colour like a record sleeve. */
export const hueOf = (name: string) => [...name].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 360, 7);
const STYLES: CoverStyle[] = ['grooves', 'bands', 'sun', 'grid', 'wave', 'type'];
export const autoStyle = (id: string): CoverStyle => STYLES[hueOf(id) % STYLES.length];

export function docEntry(doc: MusicalDocument, shared: boolean, order: number): Entry {
  const notebook = toNotebook(doc);
  const meta = notebook.meta ?? {};
  const chords = notebook.blocks.flatMap((block) => (block.kind === 'chords' ? block.content.items.map((item) => item.symbol) : []));
  const uniqueChords = [...new Set(chords)].slice(0, 8);
  const playable = notebook.blocks.some((block) =>
    (block.kind === 'melody' && block.content.events.some((event) => event.type === 'note')) ||
    (block.kind === 'chords' && block.content.items.length > 0) ||
    (block.kind === 'tablature' && block.content.columns.some((column) => column.cells.some((cell) => cell.fret !== undefined))),
  );
  return {
    id: doc.id,
    type: 'doc',
    kind: documentKind(doc),
    title: doc.title || 'Sin título',
    artist: meta.artist?.trim() || undefined,
    album: meta.album?.trim() || undefined,
    year: meta.year,
    key: meta.key ? keyTitle(meta.key, 'english') : undefined,
    bpm: meta.bpm,
    chords: uniqueChords.length ? uniqueChords : undefined,
    tags: meta.tags?.length ? meta.tags : undefined,
    status: meta.status,
    notes: meta.notes?.trim() || undefined,
    cover: { style: meta.cover?.style ?? autoStyle(doc.id), hue: meta.cover?.hue ?? hueOf(doc.title || doc.id), chosen: Boolean(meta.cover) },
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    shared,
    order,
    doc,
    playable,
  };
}

export function nodeEntry(node: LibraryNode, count: number, shared: boolean): Entry {
  return {
    id: node.id,
    type: 'node',
    kind: node.kind,
    title: node.name,
    artist: node.song?.artist?.trim() || undefined,
    key: node.song?.key?.trim() || undefined,
    bpm: node.song?.bpm,
    notes: node.song?.comments?.trim() || undefined,
    cover: { style: autoStyle(node.id), hue: hueOf(node.name), chosen: false },
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    shared,
    count,
    order: node.order,
    node,
    playable: false,
  };
}

const KIND_ORDER = ['folder', 'song', 'composition', 'melody', 'chords', 'lyrics', 'tablature', 'map', 'mixed'];
const compareText = (a?: string, b?: string) => (a && b ? a.localeCompare(b, 'es') : a ? -1 : b ? 1 : 0);

/** Folders stay first (as in any file browser); materials follow the chosen order. Missing values go last. */
export function sortEntries(entries: Entry[], sort: SortKey): Entry[] {
  const by: Record<SortKey, (a: Entry, b: Entry) => number> = {
    manual: (a, b) => a.order - b.order || a.createdAt - b.createdAt,
    name: (a, b) => a.title.localeCompare(b.title, 'es'),
    updated: (a, b) => b.updatedAt - a.updatedAt,
    created: (a, b) => b.createdAt - a.createdAt,
    artist: (a, b) => compareText(a.artist, b.artist) || a.title.localeCompare(b.title, 'es'),
    kind: (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.title.localeCompare(b.title, 'es'),
    key: (a, b) => compareText(a.key, b.key) || a.title.localeCompare(b.title, 'es'),
  };
  return [...entries].sort((a, b) => (a.type === b.type ? 0 : a.type === 'node' ? -1 : 1) || by[sort](a, b));
}

export const KIND_LABEL: Record<Entry['kind'], string> = {
  tablature: 'Tablaturas', map: 'Mapas', mixed: 'Materiales de estudio', melody: 'Melodías', lyrics: 'Letras', chords: 'Acordes',
  composition: 'Composiciones', folder: 'Carpetas', song: 'Canciones',
};

export function groupEntries(entries: Entry[], group: GroupKey): Array<{ name: string | null; items: Entry[] }> {
  if (group === 'none') return [{ name: null, items: entries }];
  const groups = new Map<string, Entry[]>();
  const add = (name: string, entry: Entry) => groups.set(name, [...(groups.get(name) ?? []), entry]);
  for (const entry of entries) {
    if (group === 'kind') add(KIND_LABEL[entry.kind], entry);
    else if (group === 'artist') add(entry.artist ?? 'Sin artista', entry);
    else if (entry.tags?.length) entry.tags.forEach((tag) => add(`#${tag}`, entry));
    else add('Sin etiquetas', entry);
  }
  const last = ['Sin artista', 'Sin etiquetas'];
  return [...groups].sort(([a], [b]) => (last.includes(a) ? 1 : last.includes(b) ? -1 : a.localeCompare(b, 'es'))).map(([name, items]) => ({ name, items }));
}

/** Which organisation options make sense with this data. */
export function availability(entries: Entry[]) {
  return {
    artist: entries.some((entry) => entry.artist),
    key: entries.some((entry) => entry.key),
    tags: entries.some((entry) => entry.tags?.length),
    kinds: new Set(entries.map((entry) => entry.kind)).size > 1,
  };
}
