export type StatusKind =
  | 'local'
  | 'unlinked'
  | 'expired'
  | 'recovering'
  | 'update'
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
  /** The download is stopped at something this version cannot read: nothing else is true until the app is updated. */
  updateNeeded?: boolean;
  /** What stopped the last attempt, when it is a failure that can pass by itself (never an invented cause). */
  failure?: { kind: 'network' | 'timeout' | 'rate-limit' | 'server' | string; status?: number };
  /** Milliseconds until the next automatic attempt, when one is scheduled. */
  retryInMs?: number;
  /** The server's last full confirmation (everything sent, everything received). Absent: it never confirmed. */
  lastConfirmedAt?: number;
  now?: number;
  /** Changes still being typed or not yet written into their document (editor drafts): they are on no server, and not even in the document yet. */
  unsaved?: number;
};

/** After this long without a new confirmation the status says how old it is instead of sounding current. */
export const STALE_AFTER_MS = 10 * 60_000;
const wait = (ms: number | undefined) => (ms && ms > 1000 ? ` Se reintenta ${ms < 90_000 ? 'en unos segundos' : `en unos ${Math.round(ms / 60_000)} min`}.` : ' Se reintenta solo.');

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
  if (input.updateNeeded)
    return {
      kind: 'update',
      label: 'Actualización necesaria',
      detail: 'Tu cuenta tiene información que esta versión de GuitarAP todavía no entiende. Lo que ya tenés está intacto y podés seguir trabajando; actualizá la aplicación para completar la descarga.',
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
  if (input.online && input.offlineReport && input.failure) {
    // The browser said it could not reach the server, or the server said something temporary: say exactly that and no more.
    const pendingNote = input.pending ? ` Tus ${plural(input.pending, 'cambio', 'cambios')} están guardados en este dispositivo y se subirán cuando se pueda.` : ' Tus cambios están guardados en este dispositivo.';
    if (input.failure.kind === 'rate-limit')
      return { kind: 'offline', label: 'Sincronización en pausa', detail: `El servidor pidió esperar un poco antes de volver a intentar.${pendingNote}${wait(input.retryInMs)}` };
    if (input.failure.kind === 'server')
      return { kind: 'offline', label: 'Error temporal del servidor', detail: `El servidor tuvo un problema${input.failure.status ? ` (${input.failure.status})` : ''}.${pendingNote}${wait(input.retryInMs)}` };
    if (input.failure.kind === 'timeout')
      return { kind: 'offline', label: 'El servidor no responde', detail: `El servidor tardó demasiado en contestar.${pendingNote}${wait(input.retryInMs)}` };
    return { kind: 'offline', label: 'Sin conexión con el servidor', detail: `No se pudo llegar al servidor (el navegador no dice por qué: puede ser la red, el DNS o un bloqueo).${pendingNote}${wait(input.retryInMs)}` };
  }
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
  if ((input.unsaved ?? 0) > 0)
    return {
      kind: 'pending',
      label: 'Cambios sin guardar aún',
      detail: 'Estás escribiendo, o hay cambios que todavía no llegaron al documento. Recién cuando se guarden en este dispositivo pueden subirse a tu cuenta.',
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
  // "Guardado en tu cuenta" is a claim about the server, so it needs the server's own confirmation: a complete round trip
  // that left nothing pending, nothing in conflict, nothing waiting or set aside, and no editor change not yet written.
  // It always says how old that confirmation is when it is no longer fresh.
  const at = input.lastConfirmedAt;
  const age = at !== undefined ? (input.now ?? Date.now()) - at : undefined;
  if (at !== undefined && age !== undefined && age > STALE_AFTER_MS)
    return { kind: 'synced', label: `Guardado en tu cuenta · ${describeLastSync(at, input.now).toLowerCase()}`, detail: `El servidor lo confirmó ${describeLastSync(at, input.now).toLowerCase()}. No hay cambios tuyos pendientes; desde entonces no se pudo comprobar si hay novedades.` };
  return { kind: 'synced', label: 'Guardado en tu cuenta', detail: at !== undefined ? `El servidor confirmó tus materiales ${describeLastSync(at, input.now).toLowerCase()}.` : 'El servidor confirmó que tiene todo lo tuyo.' };
}

export function describeLastSync(at: number | undefined, now = Date.now()) {
  if (!at) return 'Todavía no se sincronizó';
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return 'Hace unos segundos';
  if (seconds < 3600) return `Hace ${Math.round(seconds / 60)} min`;
  if (seconds < 86_400) return `Hace ${Math.round(seconds / 3600)} h`;
  return new Date(at).toLocaleDateString('es-AR');
}
