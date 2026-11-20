import type { ChangeEvent } from '@/features/sync/transport';

/**
 * Compatibility policy for the events of the cloud change log (v0.8, phase 1.1).
 *
 * The log carries events as `{ kind, record }`. Clients installed before this policy read every kind that is not
 * `node` or `version` as a DOCUMENT, so the server must never publish a new kind into this log (new account data
 * travels on its own channel). This module is what a client that knows better does with an event it cannot understand:
 *
 *   known kind (node, document, version), envelope version supported ..... apply it
 *   a registered extension that supports that kind and version ........... let the extension apply it
 *   unknown kind or newer version, `required: false` ..................... keep it in a local quarantine, move on
 *   unknown kind or newer version, `required: true` or no envelope ....... STOP the download at that page and ask for
 *                                                                           an update; the cursor does not pass it
 *   known kind whose record is malformed .................................. quarantine it (never interpret, never lose)
 *
 * An event is never read as a document unless its kind says it is one, and it is never discarded.
 *
 * Local atomicity: a page (library changes + quarantine + cursor) is one IndexedDB transaction. Code that runs inside it
 * (including an extension's `apply`) may only await database operations: awaiting anything else lets the browser close
 * the transaction and the whole page would be rejected.
 */

/** Highest envelope version of the core kinds this client understands. An event without `v` is version 1. */
export const SUPPORTED_EVENT_VERSION = 1;
export const CORE_KINDS = ['node', 'document', 'version'] as const;
export type CoreKind = (typeof CORE_KINDS)[number];
export const isCoreKind = (kind: string): kind is CoreKind => (CORE_KINDS as readonly string[]).includes(kind);

/** Support for a kind this client does not know natively (a later version of the app registers these). */
export type EventExtension = {
  kind: string;
  /** Highest envelope version it understands. */
  version: number;
  /** Runs inside the same local transaction as the page, so the cursor and the effect move together. */
  apply: (record: unknown, owner: string) => Promise<void> | void;
};

export type EventDecision =
  | { action: 'apply'; kind: CoreKind }
  | { action: 'extension'; extension: EventExtension }
  | { action: 'quarantine'; reason: 'unsupported' | 'invalid' }
  | { action: 'halt'; reason: 'unsupported' };

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/** The minimum shape each core kind needs before it may touch the local library. */
export function isWellFormed(kind: CoreKind, record: unknown): boolean {
  if (!isObject(record) || !isString(record.id)) return false;
  if (kind === 'node') return (record.kind === 'folder' || record.kind === 'song') && typeof record.name === 'string' && (record.parentId === null || record.parentId === undefined || isString(record.parentId));
  if (kind === 'document') return (record.type === 'tablature' || record.type === 'fretboard') && typeof record.title === 'string' && isObject(record.content) && typeof record.rev === 'number';
  return isString(record.documentId) && typeof record.title === 'string' && isObject(record.content);
}

export function decideEvent(change: ChangeEvent, extensions: readonly EventExtension[] = []): EventDecision {
  const version = change.v ?? 1;
  if (isCoreKind(change.kind) && Number.isInteger(version) && version >= 1 && version <= SUPPORTED_EVENT_VERSION)
    return isWellFormed(change.kind, change.record) ? { action: 'apply', kind: change.kind } : { action: 'quarantine', reason: 'invalid' };
  const extension = extensions.find((item) => item.kind === change.kind && version <= item.version);
  if (extension) return { action: 'extension', extension };
  // Anything else is not understood. Only an event that says so explicitly may be set aside; the rest stops the download.
  return change.required === false ? { action: 'quarantine', reason: 'unsupported' } : { action: 'halt', reason: 'unsupported' };
}

/** Key-order independent text of a JSON value (PostgreSQL's jsonb does not keep key order). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

/** A short, stable, synchronous fingerprint (cyrb53). Used only to recognise the same event twice, never for security. */
export function fingerprint(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Identity of an event for the quarantine: the same event read twice (after an interruption) is stored once. */
export const eventKey = (change: ChangeEvent) => `${change.kind}@${change.v ?? 1}:${fingerprint(canonicalJson(change.record))}`;

/** Where a person is told what to do. Plain words, no codes. */
export function explainHalt(halt: { kind: string; v?: number }) {
  return {
    headline: 'Hace falta actualizar GuitarAP',
    explanation: `Tu cuenta tiene información (${halt.kind}${halt.v ? `, versión ${halt.v}` : ''}) que esta versión de GuitarAP todavía no entiende. Para no mezclar ni perder nada, se detuvo la descarga en ese punto: lo que ya tenés está intacto y podés seguir trabajando. Actualizá la aplicación y la descarga continúa sola.`,
    action: 'update-app' as const,
  };
}
