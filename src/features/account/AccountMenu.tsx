import { Link } from 'react-router-dom';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Popover } from '@/components/ui/Popover';
import { describeLastSync, type StatusKind } from '@/features/account/account-status';
import { useAccount } from '@/features/account/account-context';

const statusIcon: Record<StatusKind, IconName> = {
  local: 'cloud-off',
  unlinked: 'alert',
  syncing: 'sync',
  synced: 'check',
  pending: 'cloud',
  offline: 'cloud-off',
  error: 'alert',
  conflict: 'alert',
};

export function StatusChip({ compact = false }: { compact?: boolean }) {
  const { status } = useAccount();
  return (
    <span className={`status-chip kind-${status.kind}${compact ? ' compact' : ''}`}>
      <Icon name={statusIcon[status.kind]} size={14} className={status.kind === 'syncing' ? 'spin' : undefined} />
      <span className="status-label">{status.label}</span>
    </span>
  );
}

/** Always-visible account entry: "Iniciar sesión" when signed out, identity and sync state when signed in. */
export function AccountMenu() {
  const account = useAccount();
  if (!account.session) {
    return (
      <div className="account-slot">
        <StatusChip />
        <button
          type="button"
          className="btn btn-outline"
          disabled={account.restoring}
          onClick={() => account.openDialog('sign-in')}
        >
          <Icon name="signin" size={15} />
          Iniciar sesión
        </button>
      </div>
    );
  }
  const initial = (account.email ?? '?').charAt(0).toUpperCase();
  return (
    <Popover
      label="Cuenta y sincronización"
      align="end"
      triggerClassName="account-trigger"
      trigger={
        <>
          <span className="avatar" aria-hidden="true">
            {initial}
          </span>
          <StatusChip />
          <Icon name="chevron-down" size={14} />
        </>
      }
    >
      {(close) => (
        <div className="account-panel">
          <p className="account-email">{account.email}</p>
          <p className={`status-line kind-${account.status.kind}`}>
            <Icon name={statusIcon[account.status.kind]} size={15} />
            <strong>{account.status.label}</strong>
          </p>
          <p className="muted small">{account.status.detail}</p>
          {account.message && <p className="muted small">{account.message}</p>}
          {account.linked && <p className="muted small">Última sincronización: {describeLastSync(account.lastSyncAt)}</p>}
          <div className="account-actions">
            {!account.linked && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  close();
                  account.openDialog('protect');
                }}
              >
                Activar sincronización
              </button>
            )}
            {account.linked && (
              <button
                type="button"
                className="btn"
                disabled={account.status.kind === 'syncing'}
                onClick={() => void account.syncNow()}
              >
                Sincronizar ahora
              </button>
            )}
            <Link className="btn btn-ghost" to="/configuracion/cuenta" onClick={close}>
              Configuración de cuenta
            </Link>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                close();
                account.signOut();
              }}
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      )}
    </Popover>
  );
}
