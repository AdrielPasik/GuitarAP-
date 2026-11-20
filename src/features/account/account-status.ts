export type StatusKind =
  | 'local'
  | 'unlinked'
  | 'expired'
  | 'recovering'
  | 'syncing'
  | 'synced'
  | 'pending'
  | 'offline'
  | 'error'
  | 'conflict';

export type StatusInput = {
  signedIn: boolean;
  /** The session ended by itself but this profile's library is still the person's: work continues offline. */
  expired?: boolean;
  linked: boolean;
  online: boolean;
  syncing: boolean;
  failed: boolean;
  offlineReport: boolean;
  pending: number;
  conflicts: number;
  /** Local records that cannot be uploaded: the status must not say everything is synced while some are not. */
  skipped?: number;
  /** The server has confirmed at least one complete round trip for this account. Without it nothing is "synced". */
  confirmed?: boolean;
  /** The first download of this account on this device is running (counts of what arrived so far). */
  recovering?: { pulled: number };
  /** That first download has not finished yet (no connection, an error): the library is not complete here. */
  recoveryPending?: boolean;
  errorLabel?: string;
  errorDetail?: string;
};

export type StatusView = { kind: StatusKind; label: string; detail: string };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** One honest sentence about where the person's work lives right now. */
export function describeStatus(input: StatusInput): StatusView {
  if (!input.signedIn && input.expired)
    return {
      kind: 'expired',
      label: 'Sesión vencida',
      detail: 'Tus materiales siguen disponibles en este dispositivo y podés seguir trabajando. Para sincronizar, iniciá sesión de nuevo.',
    };
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
  if (input.recovering)
    return {
      kind: 'recovering',
      label: 'Recuperando tu biblioteca…',
      detail: input.recovering.pulled ? `Llegaron ${input.recovering.pulled} elementos de tu cuenta. Podés seguir usando GuitarAP.` : 'Descargando lo que hay en tu cuenta. Podés seguir usando GuitarAP.',
    };
  if (input.recoveryPending && (!input.online || input.offlineReport))
    return {
      kind: 'offline',
      label: 'Sin conexión · recuperación pendiente',
      detail: 'Todavía no se descargó toda tu biblioteca. Se reanuda sola cuando vuelva la conexión.',
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
      label: input.errorLabel ?? 'No pudimos sincronizar',
      detail: input.errorDetail ?? 'Tus cambios siguen guardados en este dispositivo. Reintentá en un momento.',
    };
  if (input.syncing)
    return { kind: 'syncing', label: 'Sincronizando…', detail: 'Enviando y recibiendo cambios.' };
  if (!input.online || input.offlineReport)
    return {
      kind: 'offline',
      label: input.pending ? `Sin conexión · ${plural(input.pending, 'pendiente', 'pendientes')}` : 'Sin conexión',
      detail: 'Seguí trabajando: se sincroniza solo cuando vuelva la conexión.',
    };
  if ((input.skipped ?? 0) > 0)
    return {
      kind: 'error',
      label: `${input.skipped} sin poder subir`,
      detail: 'Hay materiales que apuntan a una carpeta que ya no existe en esta biblioteca. Siguen acá, intactos; el resto se sincronizó.',
    };
  if (input.pending > 0)
    return {
      kind: 'pending',
      label: plural(input.pending, 'cambio pendiente', 'cambios pendientes'),
      detail: 'Se enviarán a tu cuenta en unos segundos.',
    };
  if (input.confirmed === false)
    return {
      kind: 'pending',
      label: 'Falta la primera sincronización',
      detail: 'Todavía el servidor no confirmó que recibió tu biblioteca. Se hace sola en unos segundos, o tocá «Sincronizar ahora».',
    };
  if (input.recoveryPending)
    return { kind: 'pending', label: 'Recuperación pendiente', detail: 'Todavía no se confirmó que toda tu biblioteca llegó a este dispositivo. Se reintenta sola.' };
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
