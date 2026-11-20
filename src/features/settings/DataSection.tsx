import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Icon } from '@/components/ui/Icon';
import { db } from '@/data/database';
import { belongsToOwner, libraryScope } from '@/data/library-scope';
import { describeLastSync } from '@/features/account/account-status';
import { useAccount } from '@/features/account/account-context';
import { readLastBackup } from '@/features/backup/backup-download';
import { syncSummary } from '@/features/sync/engine';

const mb = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(0.1, bytes / 1024 ** 2).toFixed(1)} MB`);
type Storage = { usage?: number; quota?: number; persisted?: boolean };

/**
 * Where the work lives, said plainly and only as far as it can be checked. Nothing here is a guess: a value that
 * cannot be verified is shown as unknown, never as a reassuring default.
 */
export function DataSection() {
  const account = useAccount();
  const owner = account.session?.user.id;
  const [storage, setStorage] = useState<Storage | null>(null);
  const [persistAnswer, setPersistAnswer] = useState('');
  const counts = useLiveQuery(async () => {
    const scope = await libraryScope();
    const [nodes, documents, versions] = await Promise.all([db.nodes.toArray(), db.documents.toArray(), db.versions.toArray()]);
    return {
      nodes: nodes.filter((item) => belongsToOwner(item, scope) && !item.deletedAt).length,
      documents: documents.filter((item) => belongsToOwner(item, scope) && !item.deletedAt).length,
      versions: versions.filter((item) => belongsToOwner(item, scope)).length,
    };
  }, []);
  const summary = useLiveQuery(async () => (owner && account.linked ? syncSummary(owner) : null), [owner, account.linked, account.pendingCount, account.conflictCount, account.lastSyncAt]);

  useEffect(() => {
    let live = true;
    void (async () => {
      const api = navigator.storage;
      if (!api?.estimate) return live ? setStorage({}) : undefined;
      const [estimate, persisted] = await Promise.all([api.estimate().catch(() => undefined), api.persisted?.().catch(() => undefined)]);
      if (live) setStorage({ usage: estimate?.usage, quota: estimate?.quota, persisted });
    })();
    return () => {
      live = false;
    };
  }, [persistAnswer]);

  const [rebuilt, setRebuilt] = useState<string>('');
  const [rebuilding, setRebuilding] = useState<'' | 'download' | 'sync'>('');
  const [confirmSync, setConfirmSync] = useState(false);
  function run(mode: 'download' | 'sync') {
    setRebuilding(mode);
    setRebuilt('');
    return account.rebuildFromCloud(mode).then((result) => {
      setRebuilding('');
      if (!result) return setRebuilt('No se pudo completar ahora; no se tocó nada. Probá de nuevo en un momento.');
      const held = result.held ? ` ${result.held === 1 ? '1 material con cambios tuyos sin subir se dejó tal cual' : `${result.held} materiales con cambios tuyos sin subir se dejaron tal cual`}.` : '';
      const sent = mode === 'sync' ? ` Se subieron ${result.pushed} elementos a tu cuenta.` : ' No se subió nada.';
      setRebuilt(`${result.refetched === 0 ? 'Listo: tu biblioteca ya estaba completa.' : `Listo: se recuperaron ${result.refetched} elementos que faltaban.`}${sent}${held}`);
    });
  }
  const lastBackup = readLastBackup();
  const cloud = !account.session
    ? { label: 'Sin sesión', detail: 'Tus materiales están solo en este dispositivo.', tone: 'local' }
    : !account.linked
      ? { label: 'Falta activar la sincronización', detail: 'Todavía no se subió nada a tu cuenta.', tone: 'warn' }
      : account.status.kind === 'synced'
        ? { label: 'Sincronizada', detail: 'El servidor confirmó que recibió todo.', tone: 'ok' }
        : { label: account.status.label, detail: account.status.detail, tone: account.status.kind === 'error' || account.status.kind === 'conflict' ? 'warn' : 'pending' };

  return (
    <>
      <h2>Mis datos y almacenamiento</h2>
      <p className="data-explain">
        Tus materiales se guardan primero en este dispositivo. Al sincronizar, también quedan en tu cuenta en la nube. Podés descargar una copia JSON cuando quieras.
      </p>

      {account.autoRecovery && account.session && account.linked && (
        <section className="data-rebuild" aria-label="Reconstruir desde la nube">
          <h3>Reconstruir desde la nube</h3>
          <p className="muted small">
            Vuelve a traer lo que tu cuenta tiene confirmado. En ningún caso borra algo de este dispositivo ni pisa un cambio que todavía no se subió. Elegí qué querés que haga:
          </p>
          <div className="rebuild-choice">
            <strong>Solo descargar</strong>
            <p className="muted small">
              No escribe nada en la nube: no sube ningún cambio. Si algún material tiene cambios tuyos sin subir, ese material se deja tal cual está (no se compara, no se reemplaza, no se copia).
            </p>
            <button type="button" className="btn btn-primary" disabled={rebuilding !== '' || account.recovery.phase === 'recovering'} onClick={() => void run('download')}>
              {rebuilding === 'download' ? 'Descargando…' : 'Solo descargar de la nube'}
            </button>
          </div>
          <div className="rebuild-choice">
            <strong>Subir mis cambios y descargar</strong>
            <p className="muted small">
              Hay {account.pendingCount === 1 ? '1 cambio pendiente' : `${account.pendingCount} cambios pendientes`} de subir. Esta opción SÍ escribe en tu cuenta: primero sube lo tuyo, para que la nube y este dispositivo coincidan antes de comparar y así nada de lo que escribiste se reemplace; después descarga lo que falta.
            </p>
            {!confirmSync ? (
              <button type="button" className="btn" disabled={rebuilding !== '' || account.recovery.phase === 'recovering'} onClick={() => setConfirmSync(true)}>
                Subir y descargar…
              </button>
            ) : (
              <span className="row">
                <span>¿Subir tus cambios pendientes a la nube y descargar?</span>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setConfirmSync(false);
                    void run('sync');
                  }}
                >
                  Sí, subir y descargar
                </button>
                <button type="button" className="btn" onClick={() => setConfirmSync(false)}>
                  Cancelar
                </button>
              </span>
            )}
          </div>
          {rebuilt && <p role="status">{rebuilt}</p>}
        </section>
      )}
      {account.autoRecovery && account.localData?.decided && (
        <section className="data-rebuild" aria-label="Material de este dispositivo sin cuenta">
          <p className="muted small">Hay {account.localData.documents.length} materiales en este dispositivo que no son de ninguna cuenta (se ven al cerrar sesión).</p>
          <button type="button" className="btn" onClick={() => void account.adoptLocalData()}>
            Incorporarlos a mi cuenta
          </button>
        </section>
      )}
      <dl className="data-grid" aria-label="Estado de tus datos">
        <div className="data-row">
          <dt>En este dispositivo</dt>
          <dd>
            <strong className="ok">Guardados</strong>
            <span className="muted small block">
              {counts ? `${counts.documents} ${counts.documents === 1 ? 'material' : 'materiales'}, ${counts.nodes} ${counts.nodes === 1 ? 'carpeta o canción' : 'carpetas y canciones'}, ${counts.versions} puntos de historial` : 'Contando…'}
            </span>
          </dd>
        </div>
        <div className="data-row">
          <dt>En la nube</dt>
          <dd>
            <strong className={cloud.tone}>{cloud.label}</strong>
            <span className="muted small block">{cloud.detail}</span>
          </dd>
        </div>
        <div className="data-row">
          <dt>Última sincronización confirmada</dt>
          <dd>{account.linked ? describeLastSync(account.lastSyncAt) : 'No aplica: la sincronización no está activa'}</dd>
        </div>
        <div className="data-row">
          <dt>Materiales confirmados por el servidor</dt>
          <dd>
            {summary
              ? `${summary.documentsConfirmed} de ${summary.documents}`
              : account.linked
                ? 'Calculando…'
                : 'Desconocido: sin sincronización no hay forma de comprobarlo'}
            {summary && summary.documentsConfirmed < summary.documents && <span className="muted small block">El resto está pendiente, en conflicto o sin poder subir.</span>}
          </dd>
        </div>
        <div className="data-row">
          <dt>Cambios pendientes</dt>
          <dd>{account.linked ? <strong className={account.pendingCount ? 'warn' : ''}>{account.pendingCount}</strong> : 'Desconocido (sin sincronización)'}</dd>
        </div>
        <div className="data-row">
          <dt>Conflictos por revisar</dt>
          <dd>
            <strong className={account.conflictCount ? 'warn' : ''}>{account.linked ? account.conflictCount : 'Desconocido'}</strong>
            {account.linked && account.conflictCount > 0 && <Link className="btn btn-link" to="/configuracion/conflictos">Revisar y resolver</Link>}
          </dd>
        </div>
        <div className="data-row">
          <dt>Última copia descargada desde este navegador</dt>
          <dd>
            {lastBackup ? new Date(lastBackup).toLocaleString('es-AR', { dateStyle: 'long', timeStyle: 'short' }) : 'Sin registro'}
            {!lastBackup && <span className="muted small block">Si descargaste copias antes, este navegador no puede saberlo. <Link to="/configuracion/copias">Descargar una copia</Link></span>}
          </dd>
        </div>
        <div className="data-row">
          <dt>Espacio del navegador</dt>
          <dd>
            {storage === null ? 'Comprobando…' : storage.usage === undefined ? 'Este navegador no informa el espacio usado' : `${mb(storage.usage)} usados${storage.quota ? ` de ${mb(storage.quota)} disponibles` : ''}`}
            {storage && storage.persisted !== undefined && (
              <span className="muted small block">
                {storage.persisted ? 'El navegador se comprometió a no borrar estos datos por falta de espacio.' : 'El navegador podría borrar estos datos si se queda sin espacio (es raro).'}{' '}
                {!storage.persisted && navigator.storage?.persist && (
                  <button
                    type="button"
                    className="btn btn-link"
                    onClick={async () => setPersistAnswer((await navigator.storage.persist()) ? 'Listo: el almacenamiento quedó protegido.' : 'El navegador no lo concedió. Descargá copias periódicas como respaldo.')}
                  >
                    Pedir que los proteja
                  </button>
                )}
                {persistAnswer && <span role="status"> {persistAnswer}</span>}
              </span>
            )}
          </dd>
        </div>
      </dl>

      <section className="data-recover" aria-labelledby="recover-title">
        <h3 id="recover-title"><Icon name="sync" size={15} /> Tenerlo en otro dispositivo</h3>
        <ol>
          <li>Abrí GuitarAP en el otro dispositivo e iniciá sesión con la misma cuenta.</li>
          <li>Si ese dispositivo ya tiene materiales propios, descargá antes una copia de seguridad: se vincula sin borrar nada.</li>
          <li>Activá la sincronización. Tu biblioteca se descarga sola; cuando diga «Sincronizada», el servidor confirmó todo.</li>
          <li>Sin conexión a la cuenta: <Link to="/configuracion/copias">Copias de seguridad</Link> permite restaurar el archivo JSON, sin reemplazar nada sin avisarte.</li>
        </ol>
      </section>
    </>
  );
}
