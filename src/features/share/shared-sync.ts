import type { NotebookContent } from '@/core/model';
import { mergeNotebooks, type Conflict } from '@/core/merge';
import { toNotebook } from '@/core/notebook';
import type { SharedCopy } from '@/data/database';
import type { collabApi, Gateway } from '@/features/share/collab-api';
import { CollabError } from '@/features/share/collab-api';

/**
 * Keeping my copy of someone else's song in step with the server, without ever overwriting either side silently.
 * The copy remembers the version both sides last agreed on (`baseContent`/`baseRev`). Pulling merges the server's
 * changes into mine; pushing is a compare-and-swap on the revision, and when the server moved on the two are merged
 * (see core/merge) and the push retried. If access was revoked, my copy is kept untouched and nothing is uploaded.
 */
export type SharedApi = Pick<typeof collabApi, 'pull' | 'save'>;
export type SyncStatus = 'synced' | 'offline' | 'revoked' | 'merged';
export type SyncOutcome = { copy: SharedCopy | null; status: SyncStatus; conflicts: Conflict[]; message?: string };

const failureOf = (error: unknown) => (error instanceof CollabError ? error.failure : 'other');

export function newCopy(id: string, userId: string, remote: { title: string; content: unknown; rev: number; role: SharedCopy['role'] }): SharedCopy {
  const notebook = toNotebook({ id, type: 'tablature', content: remote.content as NotebookContent });
  return {
    id, userId, title: remote.title, role: remote.role, baseContent: notebook, baseRev: remote.rev,
    content: structuredClone(notebook), localTitle: remote.title, dirty: false, updatedAt: Date.now(),
  };
}

/** Brings the server's current version into my copy. Safe to call at any time; never writes to the server. */
export async function pullShared(api: SharedApi, gateway: Gateway, existing: SharedCopy | null, id: string, userId: string): Promise<SyncOutcome> {
  let remote;
  try {
    remote = await api.pull(gateway, id);
  } catch (error) {
    const failure = failureOf(error);
    if (failure === 'forbidden') return { copy: existing, status: 'revoked', conflicts: [], message: 'Ya no tenés acceso a este proyecto. Tu copia quedó guardada en este dispositivo.' };
    return { copy: existing, status: 'offline', conflicts: [] };
  }
  if (!existing) return { copy: newCopy(id, userId, remote), status: 'synced', conflicts: [] };
  const theirs = toNotebook({ id, type: 'tablature', content: remote.content as NotebookContent });
  if (remote.rev === existing.baseRev) return { copy: { ...existing, role: remote.role }, status: 'synced', conflicts: [] };
  if (!existing.dirty) {
    return { copy: { ...existing, role: remote.role, title: remote.title, localTitle: remote.title, baseContent: theirs, baseRev: remote.rev, content: structuredClone(theirs), updatedAt: Date.now() }, status: 'synced', conflicts: [] };
  }
  const { merged, conflicts } = mergeNotebooks(existing.baseContent, existing.content, theirs);
  return {
    copy: { ...existing, role: remote.role, title: remote.title, baseContent: theirs, baseRev: remote.rev, content: merged, updatedAt: Date.now(), dirty: true },
    status: 'merged',
    conflicts,
  };
}

/** Uploads my unsent changes. On a revision clash it merges and retries; it never overwrites the other person's work. */
export async function pushShared(api: SharedApi, gateway: Gateway, copy: SharedCopy): Promise<SyncOutcome> {
  let current = copy;
  const conflicts: Conflict[] = [];
  let merged = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (!current.dirty) return { copy: current, status: merged ? 'merged' : 'synced', conflicts };
    let result;
    try {
      result = await api.save(gateway, current.id, current.baseRev, current.localTitle, current.content, crypto.randomUUID());
    } catch (error) {
      const failure = failureOf(error);
      if (failure === 'forbidden') return { copy: current, status: 'revoked', conflicts, message: 'Se quitó o cambió tu permiso: tus cambios no se subieron y siguen guardados en este dispositivo.' };
      return { copy: current, status: 'offline', conflicts };
    }
    if (!result.conflict) {
      return { copy: { ...current, baseContent: structuredClone(current.content), baseRev: result.rev, dirty: false, updatedAt: Date.now() }, status: merged ? 'merged' : 'synced', conflicts };
    }
    const theirs = toNotebook({ id: current.id, type: 'tablature', content: result.current.content as NotebookContent });
    const outcome = mergeNotebooks(current.baseContent, current.content, theirs);
    conflicts.push(...outcome.conflicts);
    merged = true;
    current = { ...current, title: result.current.title, baseContent: theirs, baseRev: result.current.rev, content: outcome.merged, dirty: true };
  }
  return { copy: current, status: 'merged', conflicts, message: 'El proyecto cambia muy seguido: tus cambios se combinaron pero todavía no se subieron. Se reintentará.' };
}
