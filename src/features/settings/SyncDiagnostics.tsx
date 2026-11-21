import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { StatusChip } from '@/features/account/AccountMenu';
import { describeLastSync } from '@/features/account/account-status';
import { useAccount } from '@/features/account/account-context';
import type { Attempt, FactError } from '@/features/sync/sync-facts';

/** A time the person can read: the clock time and how long ago it was. Never a raw timestamp. */
const when = (at: number | undefined) =>
  at === undefined ? 'Todavía ninguna' : `${new Date(at).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' })} (${describeLastSync(at).toLowerCase()})`;
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const OPERATION: Record<Attempt['op'], string> = { sync: 'Sincronizar (sube y baja)', download: 'Solo descargar', 'upload-and-download': 'Subir y descargar', probe: 'Probar conexión (solo lectura)' };
const RESULT: Record<Attempt['result'], string> = { ok: 'correcto', offline: 'sin conexión con el servidor', failed: 'error', halted: 'detenida: hace falta actualizar', session: 'sesión', paused: 'en pausa por pedido del servidor' };
const KIND: Record<string, string> = {
  network: 'el navegador no pudo llegar al servidor',
  timeout: 'el servidor tardó demasiado',
  'rate-limit': 'el servidor pidió esperar',
  server: 'error temporal del servidor',
  auth: 'sesión rechazada',
  permission: 'permiso rechazado',
  schema: 'falta algo en el servidor',
  data: 'datos rechazados',
  conflict: 'otro dispositivo cambió lo mismo',
  'too-large': 'petición demasiado grande',
  unknown: 'respuesta inesperada',
  update: 'hace falta actualizar la aplicación',
  session: 'sesión vencida',
};
/** The last error in plain words, with what can be done about it. */
function explainError(error: FactError): { what: string; todo: string } {
  const what = KIND[error.kind] ?? 'error';
  const todo =
    error.kind === 'update' ? 'Actualizá GuitarAP; lo que ya tenés no se toca.' :
    error.kind === 'auth' || error.kind === 'session' ? 'Iniciá sesión de nuevo: tus materiales siguen acá.' :
    error.retryable ? 'No hace falta hacer nada: se reintenta solo.' :
    'Se necesita una acción: copiá el detalle técnico y revisá la configuración del servidor.';
  return { what: `${what}${error.status ? ` (HTTP ${error.status})` : ''}`, todo };
}

/**
 * What can be proven about this account's sync, in plain words. Every figure here is a fact the engine recorded (the
 * server's confirmations, the device's counts), never a guess; what the browser cannot tell is said as unknown.
 * The buttons say what they do: only «Probar conexión» is read-only, and the ones that upload say so.
 */
export function SyncDiagnostics() {
  const account = useAccount();
  const owner = account.session?.user.id;
  const overview = useLiveQuery(async () => (owner ? (await import('@/features/account/account-data')).readOverview(owner) : undefined), [owner, account.status.kind, account.pendingCount, account.conflictCount, account.facts?.lastAttemptAt]);
  const [probe, setProbe] = useState<{ ok: boolean; text: string; at: number } | null>(null);
  const [probing, setProbing] = useState(false);
  if (!owner || !overview) return null;
  const { facts, history, pending } = overview;
  const failed = facts.lastAttemptOk === false;
  return (
    <section className="sync-diagnostics" aria-label="Qué se sabe de la sincronización">
      <h3>Qué se sabe con certeza</h3>
      <dl className="facts">
        <div><dt>Estado actual</dt><dd><StatusChip /> <span className="muted small block">{account.status.detail}</span></dd></div>
        <div><dt>Última sincronización confirmada</dt><dd>{when(facts.lastConfirmedAt)}<span className="muted small block">Una vuelta completa en la que el servidor recibió todo lo tuyo y no quedó nada pendiente.</span></dd></div>
        <div><dt>Última subida confirmada</dt><dd>{when(facts.lastPushAt)}</dd></div>
        <div><dt>Última bajada completa</dt><dd>{when(facts.lastPullAt)}</dd></div>
        <div><dt>Último intento de comunicación</dt><dd>{facts.lastAttemptAt === undefined ? 'Todavía ninguno' : `${when(facts.lastAttemptAt)} · ${facts.lastAttemptOk ? 'salió bien' : 'no salió bien'}`}</dd></div>
        {facts.nextAttemptAt ? <div><dt>Próximo intento automático</dt><dd>{new Date(facts.nextAttemptAt).toLocaleTimeString('es-AR', { timeStyle: 'short' })}</dd></div> : null}
        <div>
          <dt>Pendiente de subir</dt>
          <dd>
            {plural(pending.documents, 'material', 'materiales')} y {plural(pending.folders, 'carpeta o canción', 'carpetas o canciones')}
            {pending.skipped > 0 ? ` · ${pending.skipped} sin poder subir` : ''}
            {(pending.titles.length > 0 || pending.folderNames.length > 0) && (
              <details>
                <summary>Ver cuáles</summary>
                <ul className="small">
                  {pending.folderNames.map((name, index) => <li key={`n${index}`}>Carpeta o canción: {name}</li>)}
                  {pending.titles.map((title, index) => <li key={`d${index}`}>{title}</li>)}
                </ul>
              </details>
            )}
          </dd>
        </div>
        <div><dt>Conflictos por revisar</dt><dd>{overview.conflicts}{overview.conflicts > 0 && <> · <Link to="/configuracion/conflictos">Revisarlos</Link></>}</dd></div>
        <div><dt>Esperando algo que no llegó</dt><dd>{plural(overview.deferred, 'elemento', 'elementos')}</dd></div>
        <div><dt>Apartados para una versión más nueva</dt><dd>{overview.quarantined}</dd></div>
        <div><dt>Recuperación inicial</dt><dd>{overview.recoveryComplete === undefined ? 'No aplica en esta versión' : overview.recoveryComplete ? 'Completa' : 'Incompleta: todavía no se confirmó que toda tu biblioteca llegó acá'}</dd></div>
        <div><dt>Hasta dónde llegó la bajada</dt><dd>posición {overview.cursor}{overview.halted ? ' · detenida: hace falta actualizar GuitarAP' : ''}</dd></div>
        <div><dt>Sesión</dt><dd>{account.session ? 'Activa en este dispositivo' : 'Vencida'}</dd></div>
      </dl>
      {facts.lastError && (
        <div className="notice warn" role="status">
          <span>
            <strong>Último problema ({when(facts.lastError.at)}):</strong> {explainError(facts.lastError).what}. {explainError(facts.lastError).todo}
          </span>
        </div>
      )}
      <div className="row">
        <button
          type="button"
          className="btn"
          disabled={probing}
          title="Solo consulta si se llega al servidor. No envía nada tuyo."
          onClick={async () => {
            setProbing(true);
            const result = await account.probeConnection().catch(() => undefined);
            setProbing(false);
            if (result) setProbe({ ...result.verdict, at: result.probe.at });
          }}
        >
          {probing ? 'Probando…' : 'Probar conexión (solo lectura)'}
        </button>
        <button type="button" className="btn" disabled={account.status.kind === 'syncing'} title="Sube tus cambios pendientes y descarga lo nuevo." onClick={() => void account.syncNow()}>
          {failed ? 'Reintentar ahora (sube y baja)' : 'Sincronizar ahora (sube y baja)'}
        </button>
      </div>
      {probe && (
        <p role="status" className={`notice ${probe.ok ? 'ok' : 'warn'}`}>
          <span>{probe.text}</span>
        </p>
      )}
      <details>
        <summary>Últimos intentos ({history.length})</summary>
        {history.length === 0 ? (
          <p className="muted small">Todavía no hay intentos registrados.</p>
        ) : (
          <ol className="attempt-history small" aria-label="Historial de intentos">
            {history.slice(0, 15).map((item, index) => (
              <li key={`${item.at}-${index}`}>
                {new Date(item.at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'medium' })} · {OPERATION[item.op]} · {RESULT[item.result]}
                {item.kind ? ` (${KIND[item.kind] ?? item.kind}${item.status ? `, HTTP ${item.status}` : ''})` : ''} · {item.ms < 1000 ? `${item.ms} ms` : `${(item.ms / 1000).toFixed(1)} s`}
                {item.willRetry ? ' · se reintenta solo' : ''}
              </li>
            ))}
          </ol>
        )}
        <p className="muted small">El historial es local, de esta cuenta en este dispositivo, y no guarda contenido de tus materiales.</p>
      </details>
    </section>
  );
}
