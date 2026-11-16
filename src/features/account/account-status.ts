export type StatusKind =
  | 'local'
  | 'unlinked'
  | 'syncing'
  | 'synced'
  | 'pending'
  | 'offline'
  | 'error'
  | 'conflict';

export type StatusInput = {
  signedIn: boolean;
  linked: boolean;
  online: boolean;
  syncing: boolean;
  failed: boolean;
  offlineReport: boolean;
  pending: number;
  conflicts: number;
};

export type StatusView = { kind: StatusKind; label: string; detail: string };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** One honest sentence about where the person's work lives right now. */
export function describeStatus(input: StatusInput): StatusView {
  if (!input.signedIn)
    return {
      kind: 'local',
      label: 'Solo en este dispositivo',
      detail: 'Tus materiales se guardan acá. Iniciá sesión para sincronizarlos con tu cuenta.',
    };
  if (!input.linked)
    return {
      kind: 'unlinked',
      label: 'Falta activar la sincronización',
      detail: 'Descargá una copia de seguridad y confirmala para vincular esta biblioteca a tu cuenta.',
    };
  if (input.conflicts > 0)
    return {
      kind: 'conflict',
      label: plural(input.conflicts, 'conflicto por revisar', 'conflictos por revisar'),
      detail: 'Se conservaron ambas versiones. Nada se sobrescribió.',
    };
  if (input.failed)
    return {
      kind: 'error',
      label: 'No pudimos sincronizar',
      detail: 'Tus cambios siguen guardados en este dispositivo. Reintentá en un momento.',
    };
  if (input.syncing)
    return { kind: 'syncing', label: 'Sincronizando…', detail: 'Enviando y recibiendo cambios.' };
  if (!input.online || input.offlineReport)
    return {
      kind: 'offline',
      label: input.pending ? `Sin conexión · ${plural(input.pending, 'pendiente', 'pendientes')}` : 'Sin conexión',
      detail: 'Seguí trabajando: se sincroniza solo cuando vuelva la conexión.',
    };
  if (input.pending > 0)
    return {
      kind: 'pending',
      label: plural(input.pending, 'cambio pendiente', 'cambios pendientes'),
      detail: 'Se enviarán a tu cuenta en unos segundos.',
    };
  return { kind: 'synced', label: 'Todo sincronizado', detail: 'Tus materiales coinciden con tu cuenta.' };
}

export function describeLastSync(at: number | undefined, now = Date.now()) {
  if (!at) return 'Todavía no se sincronizó';
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return 'Hace unos segundos';
  if (seconds < 3600) return `Hace ${Math.round(seconds / 60)} min`;
  if (seconds < 86_400) return `Hace ${Math.round(seconds / 3600)} h`;
  return new Date(at).toLocaleDateString('es-AR');
}
