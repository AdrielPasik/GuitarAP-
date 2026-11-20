import type { DocumentVersion, LibraryNode, MusicalDocument } from '@/core/model';
import { db } from '@/data/database';
import { AccessError, belongsToOwner, libraryScope } from '@/data/library-scope';
import { parseBackup, type ParsedBackup } from '@/features/backup/backup-schema';
import { planImport, type DerivedIds, type ImportPlan, type ImportSummary, type LocalSnapshot } from '@/features/backup/import-plan';
import { canonicalJson, fingerprint } from '@/features/sync/event-policy';

/**
 * Importing a backup (v0.8 phase 1.4). The only way a backup file reaches the library, and it can only ADD:
 *
 *   previewImport  reads the file and the library and says what would happen. It writes nothing at all.
 *   applyImport    after the person confirmed: ONE local transaction adds the new records together with a ledger entry
 *                  (what came in, from which file). If anything fails the transaction is rolled back whole, so an
 *                  interrupted import leaves no half-imported relations and no ledger. It re-checks that the same
 *                  person is on screen and that the library still yields the plan that was confirmed.
 *   undoImport     moves what a given import added to the trash (nothing is deleted; the history is kept).
 */
export class ImportChangedError extends Error {
  constructor(readonly reason: 'account' | 'library') {
    super(reason === 'account' ? 'Cambió la cuenta mientras revisabas la copia. No se importó nada.' : 'Tu biblioteca cambió mientras revisabas la copia. Revisala de nuevo antes de importar; no se importó nada.');
    this.name = 'ImportChangedError';
  }
}

export type Preview = { fileName: string; parsed: ParsedBackup; plan: ImportPlan; ids: DerivedIds; owner: string | null; epoch: number; now: number };
export type ImportLedger = {
  id: string;
  at: number;
  fileName: string;
  schema: number;
  ownerId: string | null;
  foreign: boolean;
  summary: ImportSummary;
  nodes: string[];
  documents: string[];
  versions: string[];
  undoneAt?: number;
};
const ledgerKey = (owner: string | null, id: string) => `import:${owner ?? 'anon'}:${id}`;

/** A UUID-shaped id that depends only on its inputs: importing the same file twice yields the same ids. */
async function idFrom(text: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  const hex = [...bytes.slice(0, 16)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export async function deriveIds(parsed: ParsedBackup, owner: string | null): Promise<DerivedIds> {
  const who = owner ?? 'anon';
  const foreign = new Map<string, string>();
  const copyDoc = new Map<string, string>();
  const copyVersion = new Map<string, string>();
  const jobs: Array<Promise<void>> = [];
  const add = (map: Map<string, string>, key: string, seed: string) => jobs.push(idFrom(seed).then((id) => void map.set(key, id)));
  for (const item of parsed.nodes) add(foreign, `node:${item.id}`, `${who}|node|${item.id}`);
  for (const item of parsed.documents) {
    add(foreign, `document:${item.id}`, `${who}|document|${item.id}`);
    add(copyDoc, item.id, `${who}|copy|${item.id}|${fingerprint(canonicalJson({ title: item.title, content: item.content }))}`);
  }
  for (const item of parsed.versions) {
    add(foreign, `version:${item.id}`, `${who}|version|${item.id}`);
    add(copyVersion, item.id, `${who}|vcopy|${item.id}`);
  }
  await Promise.all(jobs);
  const need = (map: Map<string, string>, key: string) => {
    const found = map.get(key);
    if (!found) throw new Error('Identificador desconocido en la importación.');
    return found;
  };
  return { foreign: (table, id) => need(foreign, `${table}:${id}`), copyOfDocument: (id) => need(copyDoc, id), copyOfVersion: (id) => need(copyVersion, id) };
}

async function snapshot(): Promise<LocalSnapshot> {
  const [nodes, documents, versions] = await Promise.all([db.nodes.toArray(), db.documents.toArray(), db.versions.toArray()]);
  return { nodes, documents, versions };
}

/** Reads the file and the library, writes NOTHING, and returns what an import would do. Throws BackupError with a plain message if the file cannot be used. */
export async function previewImport(raw: string, fileName: string): Promise<Preview> {
  const parsed = parseBackup(raw);
  const scope = await libraryScope();
  const ids = await deriveIds(parsed, scope.ownerId);
  const now = Date.now();
  const plan = planImport(parsed, await snapshot(), scope, ids, now);
  return { fileName, parsed, plan, ids, owner: scope.ownerId, epoch: scope.epoch, now };
}

export async function applyImport(preview: Preview, confirm: { foreign: boolean }): Promise<ImportLedger> {
  if (preview.plan.foreign && !confirm.foreign) throw new Error('Esta copia pertenece a otra cuenta: hace falta confirmar que se importa como copias propias.');
  if (!preview.plan.summary.willWrite) throw new Error('No hay nada para importar.');
  const ledger: ImportLedger = { id: crypto.randomUUID(), at: preview.now, fileName: preview.fileName.slice(0, 200), schema: preview.parsed.schema, ownerId: preview.owner, foreign: preview.plan.foreign, summary: preview.plan.summary, nodes: [], documents: [], versions: [] };
  await db.transaction('rw', db.nodes, db.documents, db.versions, db.settings, async () => {
    const scope = await libraryScope();
    if (scope.ownerId !== preview.owner || scope.epoch !== preview.epoch) throw new ImportChangedError('account');
    // The library may have changed since the person looked: the plan is worked out again and must be the same one.
    const fresh = planImport(preview.parsed, await snapshot(), scope, preview.ids, preview.now);
    if (fresh.key !== preview.plan.key) throw new ImportChangedError('library');
    ledger.nodes = fresh.writes.nodes.map((item) => item.id);
    ledger.documents = fresh.writes.documents.map((item) => item.id);
    ledger.versions = fresh.writes.versions.map((item) => item.id);
    await db.settings.put({ key: ledgerKey(preview.owner, ledger.id), value: ledger, updatedAt: preview.now });
    // `add`, never `put`: if any id exists after all, the whole import stops and nothing is written.
    await db.nodes.bulkAdd(fresh.writes.nodes as LibraryNode[]);
    await db.documents.bulkAdd(fresh.writes.documents as MusicalDocument[]);
    await db.versions.bulkAdd(fresh.writes.versions as DocumentVersion[]);
  });
  return ledger;
}

/** The imports made by the person on screen, newest first. */
export async function listImports(): Promise<ImportLedger[]> {
  const scope = await libraryScope();
  const rows = await db.settings.where('key').startsWith(`import:${scope.ownerId ?? 'anon'}:`).toArray();
  return rows.map((row) => row.value as ImportLedger).sort((a, b) => b.at - a.at);
}

export type UndoResult = { documents: number; folders: number; keptFolders: number };
/**
 * Sends what ONE import added to the trash (nothing is deleted: it can be restored from there and the history stays).
 * A folder that now also holds material of the person's own is left in place.
 */
export async function undoImport(importId: string): Promise<UndoResult> {
  const scope = await libraryScope();
  const result: UndoResult = { documents: 0, folders: 0, keptFolders: 0 };
  await db.transaction('rw', db.nodes, db.documents, db.versions, db.settings, async () => {
    const row = await db.settings.get(ledgerKey(scope.ownerId, importId));
    const ledger = row?.value as ImportLedger | undefined;
    if (!ledger || ledger.ownerId !== scope.ownerId) throw new AccessError('registro de importación');
    if (ledger.undoneAt) throw new Error('Esta importación ya se deshizo.');
    const now = Date.now();
    const documents = (await db.documents.bulkGet(ledger.documents)).filter((item): item is MusicalDocument => Boolean(item) && belongsToOwner(item!, scope));
    for (const item of documents) {
      if (item.deletedAt) continue;
      await db.documents.put({ ...item, deletedAt: now, rev: item.rev + 1, updatedAt: now });
      result.documents += 1;
    }
    const added = new Set(ledger.nodes);
    const folders = (await db.nodes.bulkGet(ledger.nodes)).filter((item): item is LibraryNode => Boolean(item) && belongsToOwner(item!, scope) && !item!.deletedAt);
    const liveNodes = (await db.nodes.toArray()).filter((item) => belongsToOwner(item, scope) && !item.deletedAt);
    const liveDocs = (await db.documents.toArray()).filter((item) => belongsToOwner(item, scope) && !item.deletedAt);
    const trashed = new Set<string>();
    // Deepest first, so a folder that only held imported folders can follow them.
    const depth = (item: LibraryNode) => {
      let level = 0;
      for (let cursor: LibraryNode | undefined = item; cursor?.parentId && level < 200; level += 1) cursor = liveNodes.find((node) => node.id === cursor!.parentId);
      return level;
    };
    for (const folder of [...folders].sort((a, b) => depth(b) - depth(a))) {
      const holdsOthers =
        liveNodes.some((node) => node.parentId === folder.id && !trashed.has(node.id) && !added.has(node.id)) ||
        liveNodes.some((node) => node.parentId === folder.id && !trashed.has(node.id) && added.has(node.id)) ||
        liveDocs.some((doc) => (doc.nodeId === folder.id || doc.songId === folder.id) && !ledger.documents.includes(doc.id));
      if (holdsOthers) {
        result.keptFolders += 1;
        continue;
      }
      await db.nodes.put({ ...folder, deletedAt: now, rev: (folder.rev ?? 1) + 1, updatedAt: now });
      trashed.add(folder.id);
      result.folders += 1;
    }
    await db.settings.put({ key: ledgerKey(scope.ownerId, importId), value: { ...ledger, undoneAt: now }, updatedAt: now });
  });
  return result;
}
