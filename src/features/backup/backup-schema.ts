import type { DocumentType } from '@/core/model';

/**
 * Reading a backup file safely (v0.8 phase 1.4). Nothing here touches the library: it turns text into records that are
 * known to have the right shape, or says in plain words why it cannot.
 *
 * Schema 1 is what GuitarAP has always written. Schema 2 (preferences and folder presentations, coming later) is read
 * already: its library part is the same, and anything else it carries is listed and ignored for now, so a newer file
 * never fails and never half-imports.
 */
export const LIMITS = {
  bytes: 80_000_000,
  nodes: 20_000,
  documents: 20_000,
  versions: 200_000,
  contentBytes: 8_000_000,
  name: 500,
  title: 1_000,
  id: 200,
  depth: 64,
  invalidKept: 25,
} as const;
export const KNOWN_SCHEMAS = [1, 2] as const;

export type BackupNode = {
  id: string;
  parentId: string | null;
  kind: 'folder' | 'song';
  name: string;
  order: number;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
  rev: number;
  song?: { artist?: string; key?: string; bpm?: number; comments?: string };
  ownerId?: string;
};
export type BackupDocument = {
  id: string;
  nodeId: string | null;
  songId: string | null;
  type: DocumentType;
  title: string;
  content: Record<string, unknown>;
  rev: number;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
  ownerId?: string;
};
export type BackupVersion = {
  id: string;
  documentId: string;
  createdAt: number;
  reason: string;
  title: string;
  content: Record<string, unknown>;
  ownerId?: string;
};
export type InvalidRecord = { kind: 'carpeta o canción' | 'documento' | 'versión'; id?: string; reason: string };
export type ParsedBackup = {
  schema: 1 | 2;
  exportedAt?: string;
  nodes: BackupNode[];
  documents: BackupDocument[];
  versions: BackupVersion[];
  /** Sections this version does not import yet (schema 2: preferences, presentations...). Names only. */
  extras: string[];
  /** The first few reasons, and how many records were left out in total. */
  invalid: InvalidRecord[];
  invalidTotal: number;
};

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

const KEYS_NEVER_KEPT = new Set(['__proto__', 'constructor', 'prototype']);
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** A deep copy that drops the keys that could tamper with object prototypes and refuses absurd nesting. */
function clean(value: unknown, depth = 0): unknown {
  if (depth > LIMITS.depth) throw new BackupError('Un material tiene un anidado demasiado profundo.');
  if (Array.isArray(value)) return value.map((item) => clean(item, depth + 1));
  if (isObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) if (!KEYS_NEVER_KEPT.has(key)) out[key] = clean(item, depth + 1);
    return out;
  }
  return value;
}
const goodId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= LIMITS.id;
const text = (value: unknown, max: number, fallback: string) => (typeof value === 'string' ? value.slice(0, max) : fallback);

export function parseBackup(raw: string): ParsedBackup {
  if (!raw || !raw.trim()) throw new BackupError('El archivo está vacío.');
  if (raw.length > LIMITS.bytes) throw new BackupError('El archivo es demasiado grande para importarlo (más de 80 MB).');
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    throw new BackupError('Ese archivo no es un JSON válido. Elegí una copia de seguridad descargada desde GuitarAP.');
  }
  if (!isObject(candidate)) throw new BackupError('Ese archivo no parece una copia de seguridad de GuitarAP.');
  const schema = candidate.schema;
  if (typeof schema !== 'number' || !Number.isInteger(schema) || schema < 1) throw new BackupError('Ese archivo no parece una copia de seguridad de GuitarAP (no dice con qué versión se hizo).');
  if (!(KNOWN_SCHEMAS as readonly number[]).includes(schema)) throw new BackupError('Esta copia se hizo con una versión más nueva de GuitarAP que esta. Actualizá la aplicación para poder importarla; no se tocó nada.');
  const { nodes, documents, versions } = candidate;
  if (!Array.isArray(nodes) || !Array.isArray(documents) || !Array.isArray(versions)) throw new BackupError('La copia está incompleta: faltan carpetas, materiales o historial.');
  if (nodes.length > LIMITS.nodes || documents.length > LIMITS.documents || versions.length > LIMITS.versions) throw new BackupError('La copia tiene más elementos de los que se pueden importar de una vez.');

  const invalid: InvalidRecord[] = [];
  let invalidTotal = 0;
  const reject = (kind: InvalidRecord['kind'], id: unknown, reason: string) => {
    invalidTotal += 1;
    if (invalid.length < LIMITS.invalidKept) invalid.push({ kind, id: typeof id === 'string' ? id.slice(0, 40) : undefined, reason });
  };
  const fallbackTime = typeof candidate.exportedAt === 'string' && Number.isFinite(Date.parse(candidate.exportedAt)) ? Date.parse(candidate.exportedAt) : 0;
  const when = (value: unknown) => (finite(value) ? value : fallbackTime);
  const owner = (value: unknown) => (typeof value === 'string' && value.length > 0 && value.length <= LIMITS.id ? value : undefined);

  const seenNodes = new Set<string>();
  const outNodes: BackupNode[] = [];
  for (const item of nodes) {
    if (!isObject(item) || !goodId(item.id)) { reject('carpeta o canción', isObject(item) ? item.id : undefined, 'no tiene un identificador válido'); continue; }
    if (seenNodes.has(item.id)) { reject('carpeta o canción', item.id, 'identificador repetido'); continue; }
    if (item.kind !== 'folder' && item.kind !== 'song') { reject('carpeta o canción', item.id, 'tipo desconocido'); continue; }
    if (item.parentId !== null && item.parentId !== undefined && !goodId(item.parentId)) { reject('carpeta o canción', item.id, 'referencia a su carpeta inválida'); continue; }
    seenNodes.add(item.id);
    const created = when(item.createdAt);
    const song = isObject(item.song) ? (clean(item.song) as BackupNode['song']) : undefined;
    outNodes.push({
      id: item.id, parentId: (item.parentId as string | null | undefined) ?? null, kind: item.kind, name: text(item.name, LIMITS.name, 'Sin título') || 'Sin título',
      order: finite(item.order) ? item.order : created, createdAt: created, updatedAt: when(item.updatedAt) || created,
      ...(finite(item.deletedAt) ? { deletedAt: item.deletedAt } : {}), rev: finite(item.rev) && item.rev >= 1 ? Math.floor(item.rev) : 1,
      ...(song ? { song: { artist: text(song.artist, 200, '') || undefined, key: text(song.key, 40, '') || undefined, bpm: finite(song.bpm) ? song.bpm : undefined, comments: text(song.comments, 20_000, '') || undefined } } : {}),
      ownerId: owner(item.ownerId),
    });
  }

  const seenDocs = new Set<string>();
  const outDocs: BackupDocument[] = [];
  for (const item of documents) {
    if (!isObject(item) || !goodId(item.id)) { reject('documento', isObject(item) ? item.id : undefined, 'no tiene un identificador válido'); continue; }
    if (seenDocs.has(item.id)) { reject('documento', item.id, 'identificador repetido'); continue; }
    if (item.type !== 'tablature' && item.type !== 'fretboard') { reject('documento', item.id, 'tipo desconocido'); continue; }
    if (!isObject(item.content)) { reject('documento', item.id, 'no tiene contenido'); continue; }
    const badRef = (['nodeId', 'songId'] as const).some((ref) => item[ref] !== null && item[ref] !== undefined && !goodId(item[ref]));
    if (badRef) { reject('documento', item.id, 'referencia a su carpeta o canción inválida'); continue; }
    let content: Record<string, unknown>;
    try {
      content = clean(item.content) as Record<string, unknown>;
    } catch (error) {
      reject('documento', item.id, error instanceof BackupError ? error.message : 'contenido ilegible');
      continue;
    }
    if (JSON.stringify(content).length > LIMITS.contentBytes) { reject('documento', item.id, 'es demasiado grande'); continue; }
    seenDocs.add(item.id);
    const created = when(item.createdAt);
    outDocs.push({
      id: item.id, nodeId: (item.nodeId as string | null | undefined) ?? null, songId: (item.songId as string | null | undefined) ?? null, type: item.type, title: text(item.title, LIMITS.title, ''),
      content, rev: finite(item.rev) && item.rev >= 1 ? Math.floor(item.rev) : 1, createdAt: created, updatedAt: when(item.updatedAt) || created,
      ...(finite(item.deletedAt) ? { deletedAt: item.deletedAt } : {}), ownerId: owner(item.ownerId),
    });
  }

  const seenVersions = new Set<string>();
  const outVersions: BackupVersion[] = [];
  for (const item of versions) {
    if (!isObject(item) || !goodId(item.id)) { reject('versión', isObject(item) ? item.id : undefined, 'no tiene un identificador válido'); continue; }
    if (seenVersions.has(item.id)) { reject('versión', item.id, 'identificador repetido'); continue; }
    if (!goodId(item.documentId)) { reject('versión', item.id, 'no dice a qué material pertenece'); continue; }
    if (!isObject(item.content)) { reject('versión', item.id, 'no tiene contenido'); continue; }
    let content: Record<string, unknown>;
    try {
      content = clean(item.content) as Record<string, unknown>;
    } catch {
      reject('versión', item.id, 'contenido ilegible');
      continue;
    }
    seenVersions.add(item.id);
    outVersions.push({ id: item.id, documentId: item.documentId, createdAt: when(item.createdAt), reason: text(item.reason, 40, 'manual') || 'manual', title: text(item.title, LIMITS.title, ''), content, ownerId: owner(item.ownerId) });
  }

  const known = new Set(['schema', 'exportedAt', 'nodes', 'documents', 'versions']);
  const extras = Object.keys(candidate).filter((key) => !known.has(key) && /^[\w-]{1,40}$/.test(key) && !KEYS_NEVER_KEPT.has(key));
  return { schema: schema as 1 | 2, exportedAt: typeof candidate.exportedAt === 'string' ? candidate.exportedAt.slice(0, 40) : undefined, nodes: outNodes, documents: outDocs, versions: outVersions, extras, invalid, invalidTotal };
}
