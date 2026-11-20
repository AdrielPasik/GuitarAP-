import { useState } from 'react';
import { useAccount } from '@/features/account/account-context';

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * What the person is told while their account's library reaches this device, and what they must decide about material
 * that belongs to no account. Only shown when the autoRecovery feature is on. Every number is something the library
 * itself confirmed; a failure to reach the server is never presented as an empty library.
 */
export function RecoveryNotice() {
  const account = useAccount();
  const { recovery, localData } = account;
  const [confirming, setConfirming] = useState(false);
  if (!account.autoRecovery || !account.session) return null;
  return (
    <>
      {recovery.phase === 'recovering' && (
        <section className="local-note recovery-note" role="status" aria-label="Recuperación de la biblioteca">
          <span>
            <strong>{recovery.downloadOnly ? 'Descargando tu biblioteca…' : recovery.step === 'push' ? 'Subiendo tus cambios pendientes…' : 'Recuperando tu biblioteca…'}</strong>{' '}
            {recovery.downloadOnly ? 'Solo se descarga: no se sube nada. ' : ''}
            {recovery.pulled ? `Llegaron ${plural(recovery.pulled, 'elemento', 'elementos')} de tu cuenta.` : 'Descargando lo que hay en tu cuenta.'} Podés seguir usando GuitarAP mientras tanto.
          </span>
          <progress aria-label="Progreso de la recuperación" />
        </section>
      )}
      {recovery.phase === 'waiting' && (
        <section className="local-note recovery-note warn" role="status" aria-label="Recuperación pendiente">
          <span>
            <strong>La recuperación de tu biblioteca todavía no terminó.</strong>{' '}
            {recovery.reason === 'offline'
              ? 'No hay conexión con el servidor.'
              : recovery.reason === 'halted'
                ? 'Hace falta actualizar GuitarAP para seguir.'
                : 'El servidor no respondió como se esperaba.'}{' '}
            Lo que ya tenés en este dispositivo está intacto, y se reintenta solo.
          </span>
          <button type="button" className="btn" onClick={() => void account.syncNow()}>
            Reintentar ahora
          </button>
        </section>
      )}
      {recovery.phase === 'done' && !recovery.seen && (
        <section className="local-note recovery-note ok" role="status" aria-label="Biblioteca recuperada">
          <span>
            {recovery.empty ? (
              <>
                <strong>Tu cuenta todavía no tiene materiales en la nube.</strong> Lo que crees desde ahora se guarda en tu cuenta y aparece en tus otros dispositivos.
              </>
            ) : (
              <>
                <strong>Biblioteca recuperada:</strong> {plural(recovery.counts.folders, 'carpeta', 'carpetas')}, {plural(recovery.counts.songs, 'canción', 'canciones')}, {plural(recovery.counts.documents, 'material', 'materiales')}
                {recovery.counts.trashed ? ` (y ${recovery.counts.trashed} en la papelera)` : ''} y {plural(recovery.counts.versions, 'versión', 'versiones')} del historial.
              </>
            )}
            {recovery.issues > 0 && ` ${plural(recovery.issues, 'elemento espera', 'elementos esperan')} algo que todavía no llegó; no se descartó nada y se completa solo.`}
          </span>
          <button type="button" className="btn" onClick={account.dismissRecovery}>
            Entendido
          </button>
        </section>
      )}
      {localData && !localData.decided && (
        <section className="local-note recovery-note" role="region" aria-label="Material de este dispositivo sin cuenta">
          <span>
            <strong>Hay {plural(localData.documents.length, 'material', 'materiales')} en este dispositivo creados sin cuenta.</strong> No se agregaron a tu cuenta:
            {' '}
            {localData.documents.slice(0, 5).map((item) => `«${item.title}»`).join(', ')}
            {localData.documents.length > 5 ? ` y ${localData.documents.length - 5} más` : ''}.
          </span>
          {!confirming ? (
            <>
              <button type="button" className="btn" onClick={() => void account.backupLocalData()}>
                Descargar una copia (recomendado)
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setConfirming(true)}>
                Incorporarlos a mi cuenta…
              </button>
              <button type="button" className="btn" onClick={() => void account.keepLocalData()}>
                Dejarlos solo en este dispositivo
              </button>
            </>
          ) : (
            <>
              <span>
                Se van a subir a tu cuenta y aparecerán en tus otros dispositivos. Te recomendamos descargar una copia antes.
              </span>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setConfirming(false);
                  void account.adoptLocalData();
                }}
              >
                Sí, incorporarlos
              </button>
              <button type="button" className="btn" onClick={() => setConfirming(false)}>
                Cancelar
              </button>
            </>
          )}
        </section>
      )}
    </>
  );
}
