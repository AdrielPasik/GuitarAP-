import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { NotebookBlock, NotebookContent } from '@/core/model';
import { toNotebook } from '@/core/notebook';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/toast-context';
import { libraryRepository } from '@/data/library-repository';
import { useAccount } from '@/features/account/account-context';
import { downloadBackup } from '@/features/backup/backup-download';
import { NotebookBlocks } from '@/features/notebook/NotebookBlocks';
import { diffNotebooks, mergeByBlocks, type BlockDiff, type Pick } from '@/features/sync/conflict-diff';
import { listConflicts, resolveConflict, type ConflictItem } from '@/features/sync/engine';

const when = (at: number | undefined) => (at ? new Date(at).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' }) : 'sin fecha');
const STATUS: Record<BlockDiff['status'], string> = { same: 'Igual en las dos', changed: 'Cambió', 'only-device': 'Solo en este dispositivo', 'only-cloud': 'Solo en la nube' };

/**
 * Two versions of the same material, side by side, and ways out that never lose either one. Nothing here runs by
 * itself: every action is chosen by the person, and each one leaves a recovery point in the document's history.
 */
export function ConflictsSection() {
  const account = useAccount();
  const owner = account.session?.user.id;
  const [items, setItems] = useState<ConflictItem[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (owner) setItems(await listConflicts(owner));
  }, [owner]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  if (!owner) {
    return (
      <>
        <h2>Conflictos de sincronización</h2>
        <p className="muted">Iniciá sesión para ver si algún material tiene versiones distintas en este dispositivo y en la nube.</p>
      </>
    );
  }
  const open = items?.find((item) => item.id === openId);
  return (
    <>
      <h2>Conflictos de sincronización</h2>
      <p className="muted">
        Un conflicto aparece cuando un material cambió en este dispositivo y también en la nube. GuitarAP no elige por vos: conserva las dos versiones hasta que decidas, y cada decisión deja un punto de recuperación en el historial del material.
      </p>
      {items === null && <p role="status" className="muted">Buscando conflictos…</p>}
      {items?.length === 0 && (
        <p className="notice ok" role="status">
          <Icon name="check" size={16} /> No hay conflictos por revisar.
        </p>
      )}
      {items && items.length > 0 && !open && (
        <ul className="conflict-list" aria-label="Materiales con conflicto">
          {items.map((item) => (
            <li key={item.id}>
              <span>
                <strong>{item.local?.title || item.remote.title || 'Sin título'}</strong>
                <small className="muted block">Este dispositivo: {when(item.local?.updatedAt)} · Nube: {when(item.remote.updatedAt)}</small>
              </span>
              <button type="button" className="btn btn-primary" onClick={() => setOpenId(item.id)}>Comparar y resolver</button>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <ConflictDetail
          item={open}
          owner={owner}
          onBack={() => setOpenId(null)}
          onDone={async () => {
            setOpenId(null);
            await refresh();
          }}
        />
      )}
    </>
  );
}

function ConflictDetail({ item, owner, onBack, onDone }: { item: ConflictItem; owner: string; onBack: () => void; onDone: () => Promise<void> }) {
  const toast = useToast();
  const account = useAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const device = useMemo(() => (item.local ? toNotebook(item.local) : null), [item.local]);
  const cloud = useMemo(() => toNotebook({ id: item.remote.id, type: item.remote.type, content: item.remote.content as NotebookContent }), [item.remote]);
  const diff = useMemo(() => (device ? diffNotebooks(device, cloud) : null), [device, cloud]);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [dropped, setDropped] = useState<ReadonlySet<string>>(new Set());
  const [mergeOpen, setMergeOpen] = useState(false);
  const title = item.local?.title || item.remote.title || 'Sin título';

  async function run(work: () => Promise<{ copyId?: string }>, done: string) {
    setBusy(true);
    setError('');
    try {
      await work();
      toast.show(done);
      await onDone();
      void account.syncNow();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo resolver. Nada se modificó.');
    } finally {
      setBusy(false);
    }
  }
  async function backupFirst() {
    try {
      downloadBackup(await libraryRepository.exportBackup());
      toast.show('Copia de seguridad descargada.');
    } catch {
      setError('No se pudo preparar la copia. Tus materiales no se modificaron.');
    }
  }
  const differing = diff?.blocks.filter((block) => block.status !== 'same') ?? [];

  return (
    <div className="conflict-detail">
      <button type="button" className="btn btn-ghost" onClick={onBack}><Icon name="chevron-left" size={14} /> Volver a la lista</button>
      <h3>«{title}»</h3>
      <dl className="facts">
        <div><dt>Este dispositivo</dt><dd>Modificado {when(item.local?.updatedAt)}</dd></div>
        <div><dt>Nube</dt><dd>Modificado {when(item.remote.updatedAt)}</dd></div>
      </dl>
      <p className="muted small">El servidor no registra qué dispositivo hizo cada cambio, así que solo se pueden comparar las dos versiones.</p>
      {error && <p className="share-error" role="alert">{error}</p>}

      {!item.local && <p className="notice warn">Este material ya no existe en este dispositivo: se puede traer la versión de la nube.</p>}
      {diff?.identical && <p className="notice ok">Las dos versiones tienen el mismo contenido: no se pierde nada con ninguna opción.</p>}

      {diff && (
        <section aria-label="Diferencias" className="conflict-blocks">
          <h4>Qué difiere</h4>
          {diff.metaChanged && <p className="muted small">Los datos de la canción (tonalidad, BPM, estado) son distintos.</p>}
          {(diff.commentsOnlyDevice > 0 || diff.commentsOnlyCloud > 0) && (
            <p className="muted small">Comentarios solo acá: {diff.commentsOnlyDevice} · solo en la nube: {diff.commentsOnlyCloud}.</p>
          )}
          {differing.length === 0 && !diff.metaChanged && <p className="muted small">Los bloques son iguales.</p>}
          {differing.map((block) => (
            <article key={block.id} className={`conflict-block status-${block.status}`}>
              <header>
                <strong>{block.title}</strong>
                <span className="chip-static">{STATUS[block.status]}</span>
              </header>
              {block.lines ? (
                <ol className="lines" aria-label={`Diferencias de ${block.title}`}>
                  {block.lines.map((line, index) => (
                    <li key={index} className={`line-${line.type}`}>
                      <span aria-hidden="true">{line.type === 'added' ? '+' : line.type === 'removed' ? '−' : ' '}</span>
                      <span className="sr-only">{line.type === 'added' ? 'Solo en este dispositivo: ' : line.type === 'removed' ? 'Solo en la nube: ' : ''}</span>
                      {line.text || ' '}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="muted small">No hay una comparación línea por línea confiable para este tipo de bloque: abajo podés ver las dos versiones completas.</p>
              )}
              <div className="both-versions">
                {block.cloud && <VersionPeek label="Versión de la nube" block={block.cloud} />}
                {block.device && <VersionPeek label="Versión de este dispositivo" block={block.device} />}
              </div>
            </article>
          ))}
        </section>
      )}

      <section aria-label="Cómo resolverlo" className="conflict-actions">
        <h4>Cómo resolverlo</h4>
        <div className="conflict-option">
          <div>
            <strong>Conservar ambas</strong> <span className="chip-static">recomendado</span>
            <p className="muted small">La versión de la nube pasa a ser un material aparte («… versión de la nube») y este dispositivo conserva la suya. No se pierde nada.</p>
          </div>
          <button type="button" className="btn btn-primary" disabled={busy || !item.local} onClick={() => void run(() => resolveConflict(owner, item.id, { kind: 'keep-both' }), 'Se conservaron las dos versiones.')}>Conservar ambas</button>
        </div>
        <div className="conflict-option">
          <div>
            <strong>Usar la versión de la nube</strong>
            <p className="muted small">Reemplaza lo que hay acá. Antes se guarda un punto de recuperación y una copia de tu versión («… versión de este dispositivo»).</p>
          </div>
          <button type="button" className="btn" disabled={busy} onClick={() => void run(() => resolveConflict(owner, item.id, { kind: 'use-cloud', alsoCopyMine: true }), 'Se usó la versión de la nube. Tu versión quedó como copia.')}>Usar la de la nube</button>
        </div>
        <div className="conflict-option">
          <div>
            <strong>Usar la versión de este dispositivo</strong>
            <p className="muted small">Se envía a la nube como la última versión. La versión actual de la nube queda guardada en el historial del material.</p>
          </div>
          <button type="button" className="btn" disabled={busy || !item.local} onClick={() => void run(() => resolveConflict(owner, item.id, { kind: 'use-device' }), 'Se usará la versión de este dispositivo. La de la nube quedó en el historial.')}>Usar la de este dispositivo</button>
        </div>
        {device && differing.length > 0 && (
          <div className="conflict-option merge">
            <div>
              <strong>Fusionar bloque por bloque</strong>
              <p className="muted small">Elegís, para cada bloque distinto, qué versión llevar. Se guardan puntos de recuperación de las dos antes de escribir el resultado.</p>
              {mergeOpen && (
                <ul className="merge-picks" aria-label="Elección por bloque">
                  {differing.map((block) => (
                    <li key={block.id}>
                      <span>{block.title} <small className="muted">({STATUS[block.status]})</small></span>
                      {block.status === 'changed' ? (
                        <select aria-label={`Versión de ${block.title}`} value={picks[block.id] ?? 'device'} onChange={(event) => setPicks({ ...picks, [block.id]: event.target.value as Pick })}>
                          <option value="device">Este dispositivo</option>
                          <option value="cloud">La nube</option>
                        </select>
                      ) : (
                        <label className="check">
                          <input type="checkbox" checked={!dropped.has(block.id)} onChange={(event) => setDropped(new Set([...dropped].filter((id) => id !== block.id).concat(event.target.checked ? [] : [block.id])))} /> Incluir
                        </label>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {!mergeOpen ? (
              <button type="button" className="btn" onClick={() => setMergeOpen(true)}>Elegir bloques…</button>
            ) : (
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run(() => resolveConflict(owner, item.id, { kind: 'merged', title, content: mergeByBlocks(device, cloud, picks, dropped) }), 'Se guardó la fusión. Las dos versiones quedaron en el historial.')}>Guardar fusión</button>
            )}
          </div>
        )}
        <p className="muted small">
          ¿Querés una red extra? <button type="button" className="btn btn-link" onClick={() => void backupFirst()}>Descargar una copia de seguridad ahora</button>. El historial del material (<Link to={item.local ? `/material/${item.local.id}` : '/biblioteca'}>abrir</Link> → «⋯» → Historial) guarda los puntos de recuperación.
        </p>
      </section>
    </div>
  );
}

/** One complete version of a block, readable and playable, with no way to change it. */
function VersionPeek({ label, block }: { label: string; block: NotebookBlock }) {
  const single: NotebookContent = { kind: 'notebook', version: 1, blocks: [block] };
  return (
    <details>
      <summary>{label}</summary>
      <NotebookBlocks notebook={single} readOnly />
    </details>
  );
}
