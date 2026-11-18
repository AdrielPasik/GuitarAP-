/**
 * How a folder SHOWS its contents (level B of personalisation). Independent of the global artistic theme (level A) and
 * never part of any musical document: changing a presentation cannot alter a song.
 *
 * Inheritance:
 *  - a folder with no entry inherits from its parent; a top-level folder with no entry uses the default;
 *  - 'default' ignores the parent and uses the default; 'own' carries a complete presentation;
 *  - resolution walks up the tree with a visited set and a depth cap, so a corrupt cycle can never hang the app;
 *  - entries are keyed by folder id: moving a folder keeps its own presentation, and an inheriting folder simply
 *    starts inheriting from its new parent.
 */

export type FieldKey =
  | 'cover' | 'artist' | 'key' | 'bpm' | 'chords' | 'kind' | 'updated' | 'created' | 'tags' | 'status' | 'play' | 'practice'
  | 'collaborators' | 'notes';
export type ModuleKey = 'header' | 'description' | 'covers' | 'list' | 'featured' | 'recent' | 'practice' | 'music' | 'shared';
export type Density = 'compact' | 'balanced' | 'detailed';
export type SortKey = 'manual' | 'name' | 'updated' | 'created' | 'artist' | 'kind' | 'key';
export type GroupKey = 'none' | 'kind' | 'artist' | 'tags';
export type PresetId = 'collection' | 'compact' | 'notebook' | 'project' | 'combined' | 'custom';

export type Presentation = {
  /** Where it started from. 'custom' once anything was edited. Purely informative. */
  preset: PresetId;
  /** Enabled modules, in display order. */
  modules: ModuleKey[];
  fields: Record<FieldKey, boolean>;
  density: Density;
  sort: SortKey;
  group: GroupKey;
  /** Optional folder description shown by the «description» module. */
  description?: string;
  /** Item ids highlighted by the «featured» module. Ids that no longer exist are ignored. */
  featured?: string[];
};

export type PresentationEntry = { mode: 'inherit' } | { mode: 'default' } | { mode: 'own'; presentation: Presentation };
export type PresentationMap = Record<string, PresentationEntry>;

export const FIELD_KEYS: FieldKey[] = ['cover', 'artist', 'key', 'bpm', 'chords', 'kind', 'updated', 'created', 'tags', 'status', 'play', 'practice', 'collaborators', 'notes'];
export const MODULE_KEYS: ModuleKey[] = ['header', 'description', 'featured', 'covers', 'list', 'recent', 'practice', 'music', 'shared'];

export const FIELD_NAMES: Record<FieldKey, string> = {
  cover: 'Portada', artist: 'Artista', key: 'Tonalidad', bpm: 'BPM', chords: 'Acordes', kind: 'Tipo de material',
  updated: 'Fecha de modificación', created: 'Fecha de creación', tags: 'Etiquetas', status: 'Estado de composición',
  play: 'Acceso a reproducción', practice: 'Acceso a Práctica', collaborators: 'Colaboradores', notes: 'Notas o descripción',
};
export const MODULE_NAMES: Record<ModuleKey, { name: string; blurb: string }> = {
  header: { name: 'Encabezado ilustrado', blurb: 'Portada de la carpeta con su nombre y lo que contiene.' },
  description: { name: 'Descripción', blurb: 'Un texto tuyo sobre la carpeta.' },
  featured: { name: 'Destacados', blurb: 'Los materiales que marques con la estrella.' },
  covers: { name: 'Portadas', blurb: 'Cuadrícula de carátulas, como una colección de discos.' },
  list: { name: 'Lista', blurb: 'Filas con la información que elijas.' },
  recent: { name: 'Recientes de la carpeta', blurb: 'Lo último que tocaste acá.' },
  practice: { name: 'Accesos de práctica', blurb: 'Botones directos a Práctica.' },
  music: { name: 'Información musical', blurb: 'Tonalidades y tempos que de verdad tienen tus materiales.' },
  shared: { name: 'Compartido y colaboradores', blurb: 'Qué está compartido desde esta carpeta.' },
};
export const DENSITY_NAMES: Record<Density, string> = { compact: 'Compacta', balanced: 'Equilibrada', detailed: 'Detallada' };
export const SORT_NAMES: Record<SortKey, string> = {
  manual: 'Orden manual', name: 'Nombre', updated: 'Recientes primero', created: 'Fecha de creación', artist: 'Artista', kind: 'Tipo', key: 'Tonalidad',
};
export const GROUP_NAMES: Record<GroupKey, string> = { none: 'Sin agrupar', kind: 'Por tipo', artist: 'Por artista', tags: 'Por etiquetas' };

const fields = (on: FieldKey[]): Record<FieldKey, boolean> => Object.fromEntries(FIELD_KEYS.map((key) => [key, on.includes(key)])) as Record<FieldKey, boolean>;

export const PRESETS: Record<Exclude<PresetId, 'custom'>, { name: string; blurb: string; presentation: Presentation }> = {
  collection: {
    name: 'Colección visual',
    blurb: 'Portadas grandes, artista y tonalidad: tus discos.',
    presentation: { preset: 'collection', modules: ['header', 'covers', 'recent'], fields: fields(['cover', 'artist', 'key', 'play', 'practice']), density: 'balanced', sort: 'updated', group: 'none' },
  },
  compact: {
    name: 'Lista compacta',
    blurb: 'Mucho material de un vistazo, sin adornos.',
    presentation: { preset: 'compact', modules: ['list'], fields: fields(['kind', 'key', 'updated', 'practice']), density: 'compact', sort: 'name', group: 'none' },
  },
  notebook: {
    name: 'Cuaderno musical',
    blurb: 'Descripción, notas y acceso a práctica: un cuaderno de estudio.',
    presentation: { preset: 'notebook', modules: ['header', 'description', 'list', 'practice'], fields: fields(['kind', 'key', 'notes', 'practice', 'updated']), density: 'detailed', sort: 'manual', group: 'kind' },
  },
  project: {
    name: 'Proyecto',
    blurb: 'Partes, BPM y tonalidad, colaboradores y actividad.',
    presentation: { preset: 'project', modules: ['header', 'music', 'list', 'shared', 'recent'], fields: fields(['kind', 'key', 'bpm', 'status', 'collaborators', 'updated', 'play']), density: 'balanced', sort: 'manual', group: 'none' },
  },
  combined: {
    name: 'Vista combinada',
    blurb: 'Destacados y portadas arriba, lista completa abajo.',
    presentation: { preset: 'combined', modules: ['header', 'featured', 'covers', 'list', 'recent'], fields: fields(['cover', 'artist', 'key', 'kind', 'updated', 'play']), density: 'balanced', sort: 'updated', group: 'none' },
  },
};

/** What every folder looks like until someone chooses otherwise: close to the v0.6 list, with a header so few items never look abandoned. */
export const DEFAULT_PRESENTATION: Presentation = {
  preset: 'custom',
  modules: ['header', 'list', 'recent'],
  fields: fields(['kind', 'key', 'updated', 'practice']),
  density: 'balanced',
  sort: 'updated',
  group: 'none',
};

export function presetPresentation(id: Exclude<PresetId, 'custom'>, keep?: Pick<Presentation, 'description' | 'featured'>): Presentation {
  return clonePresentation({ ...PRESETS[id].presentation, description: keep?.description, featured: keep?.featured });
}

export function clonePresentation(presentation: Presentation): Presentation {
  return {
    ...presentation,
    modules: [...presentation.modules],
    fields: { ...presentation.fields },
    featured: presentation.featured ? [...presentation.featured] : undefined,
  };
}

/** Repairs anything read from storage: unknown keys dropped, missing ones filled from the default. Never throws. */
export function normalizePresentation(raw: unknown): Presentation {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<Presentation>;
  const base = DEFAULT_PRESENTATION;
  const modules = Array.isArray(value.modules) ? value.modules.filter((key, index, list): key is ModuleKey => MODULE_KEYS.includes(key as ModuleKey) && list.indexOf(key) === index) : [...base.modules];
  const rawFields = (value.fields && typeof value.fields === 'object' ? value.fields : {}) as Partial<Record<FieldKey, unknown>>;
  return {
    preset: (['collection', 'compact', 'notebook', 'project', 'combined', 'custom'] as PresetId[]).includes(value.preset as PresetId) ? (value.preset as PresetId) : 'custom',
    modules,
    fields: Object.fromEntries(FIELD_KEYS.map((key) => [key, typeof rawFields[key] === 'boolean' ? rawFields[key] : base.fields[key]])) as Record<FieldKey, boolean>,
    density: (['compact', 'balanced', 'detailed'] as Density[]).includes(value.density as Density) ? (value.density as Density) : 'balanced',
    sort: (Object.keys(SORT_NAMES) as SortKey[]).includes(value.sort as SortKey) ? (value.sort as SortKey) : base.sort,
    group: (Object.keys(GROUP_NAMES) as GroupKey[]).includes(value.group as GroupKey) ? (value.group as GroupKey) : 'none',
    description: typeof value.description === 'string' ? value.description.slice(0, 600) : undefined,
    featured: Array.isArray(value.featured) ? value.featured.filter((id): id is string => typeof id === 'string').slice(0, 24) : undefined,
  };
}

export type Resolved = { presentation: Presentation; source: 'own' | 'inherited' | 'default'; fromId: string | null };

/**
 * The presentation a folder actually uses. `parentOf` gives each folder's parent id (null at the root).
 * The root of the library itself (folderId = null) can also have an entry, under the key ROOT_KEY.
 */
export const ROOT_KEY = '__root__';
export function resolvePresentation(map: PresentationMap, folderId: string | null, parentOf: (id: string) => string | null | undefined): Resolved {
  const seen = new Set<string>();
  let id: string | null = folderId;
  let first = true;
  for (let depth = 0; depth < 64; depth += 1) {
    const key: string = id ?? ROOT_KEY;
    if (seen.has(key)) break; // cycle: stop and use the default
    seen.add(key);
    const entry = map[key];
    if (entry?.mode === 'own') return { presentation: normalizePresentation(entry.presentation), source: first ? 'own' : 'inherited', fromId: id };
    if (entry?.mode === 'default') return { presentation: DEFAULT_PRESENTATION, source: 'default', fromId: null };
    if (id === null) break;
    // No entry or 'inherit': look at the parent. A top-level folder inherits from nothing, so it lands on the default.
    const parent = parentOf(id);
    if (parent === undefined || parent === null) break;
    id = parent;
    first = false;
  }
  return { presentation: DEFAULT_PRESENTATION, source: 'default', fromId: null };
}

/** Explicit «aplicar a subcarpetas»: every descendant inherits again (their own settings are replaced only on consent). */
export function applyToDescendants(map: PresentationMap, folderId: string, childrenOf: (id: string) => string[]): PresentationMap {
  const next = { ...map };
  const seen = new Set<string>([folderId]);
  const stack = [...childrenOf(folderId)];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    next[id] = { mode: 'inherit' };
    stack.push(...childrenOf(id));
  }
  return next;
}

/** Moves a module up or down without losing the others. */
export function moveModule(modules: ModuleKey[], key: ModuleKey, delta: -1 | 1): ModuleKey[] {
  const index = modules.indexOf(key);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= modules.length) return modules;
  const next = [...modules];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function toggleModule(modules: ModuleKey[], key: ModuleKey, on: boolean): ModuleKey[] {
  if (on) return modules.includes(key) ? modules : [...modules, key];
  return modules.filter((item) => item !== key);
}
