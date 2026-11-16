import { useAccount } from '@/features/account/account-context';
import { Icon } from '@/components/ui/Icon';

/**
 * Guided safety step before the first sync: download a verified copy, confirm it, then link.
 * The library is never linked, and nothing is uploaded, until the person confirms.
 */
export function LinkWizard() {
  const account = useAccount();
  const { backup } = account;
  return (
    <div className="wizard">
      <ol className="wizard-steps">
        <li className={backup.summary ? 'done' : 'current'}>
          <span className="step-mark">{backup.summary ? <Icon name="check" size={12} /> : 1}</span>
          <div>
            <strong>Descargá una copia de seguridad</strong>
            <p>Un archivo JSON con todas tus carpetas, materiales e historial.</p>
            {!backup.summary && (
              <button type="button" className="btn btn-primary" disabled={backup.busy} onClick={() => void account.prepareBackup()}>
                {backup.busy ? 'Preparando copia…' : 'Descargar copia de seguridad'}
              </button>
            )}
            {backup.summary && (
              <p className="ok">
                <Icon name="check" size={14} /> Copia verificada: {backup.summaryText}.
              </p>
            )}
          </div>
        </li>
        <li className={backup.summary ? 'current' : 'todo'}>
          <span className="step-mark">2</span>
          <div>
            <strong>Confirmá que el archivo se guardó</strong>
            <label className="check">
              <input
                type="checkbox"
                disabled={!backup.summary}
                checked={backup.confirmed}
                onChange={(event) => account.setBackupConfirmed(event.target.checked)}
              />
              <span>Confirmo que el archivo se guardó en mi equipo y puedo encontrarlo.</span>
            </label>
          </div>
        </li>
        <li className={backup.confirmed ? 'current' : 'todo'}>
          <span className="step-mark">3</span>
          <div>
            <strong>Activá la sincronización</strong>
            <p>Recién ahora se vincula esta biblioteca a tu cuenta.</p>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!backup.confirmed || backup.busy}
              onClick={() => void account.linkLibrary()}
            >
              {backup.busy && backup.summary ? 'Vinculando…' : 'Vincular y sincronizar'}
            </button>
          </div>
        </li>
      </ol>
      {backup.error && (
        <p role="alert" className="notice danger">
          {backup.error}
        </p>
      )}
    </div>
  );
}
