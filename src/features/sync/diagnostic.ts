import type { SyncErrorDetail } from '@/features/sync/transport';

/**
 * What the person can read (and send me) about the last sync attempt. It carries operations, codes and counts, never a
 * token, a password, an e-mail address, a song title, lyrics or any document content.
 */
export type SyncDiagnostic = {
  at: number;
  ok: boolean;
  /** 'subida' (push) or 'descarga' (pull). */
  detail?: SyncErrorDetail;
  pushed?: number;
  pulled?: number;
  requests?: number;
  skipped?: { nodes: number; documents: number; versions: number };
  /** Documents edited on two devices: how many copies were kept so that nothing was lost. */
  copies?: number;
  /** `repaired`: the server has migration 0008. `needs-0008`: it answers, but sync_library is the defective one. */
  server?: 'repaired' | 'needs-0008' | 'unknown';
};

export type Explained = {
  /** One plain sentence for the status area. */
  headline: string;
  /** What happened and what to do, in words. */
  explanation: string;
  /** The one thing that needs a person, if anything. */
  action?: 'run-migration' | 'sign-in' | 'update-app' | 'wait' | 'none';
};

const OPERATION: Record<'push' | 'pull', string> = { push: 'subida de cambios', pull: 'descarga de cambios' };
export const operationLabel = (operation: 'push' | 'pull') => OPERATION[operation];

/** Turns a failure into words a person can act on. The raw code stays available beside it. */
export function explainSyncError(detail: SyncErrorDetail | undefined, server?: SyncDiagnostic['server']): Explained {
  if (!detail) return { headline: 'No pudimos sincronizar', explanation: 'Ocurrió un error inesperado en tu dispositivo. Tus cambios siguen guardados acá; abrí Configuración → Sincronización para ver el detalle.', action: 'none' };
  const code = detail.code ? ` (código ${detail.code})` : '';
  if (detail.rpc === 'sync_library' && (detail.code === '42702' || server === 'needs-0008'))
    return {
      headline: 'Falta aplicar una reparación en Supabase',
      explanation:
        'El servidor tiene una versión anterior de la función de sincronización que falla con cualquier carpeta o canción (error 42702). No es un problema de tu cuenta ni de tus datos, que siguen intactos en este dispositivo. Hay que ejecutar una sola vez la migración 0008_sync_library_fix.sql en el SQL Editor de Supabase.',
      action: 'run-migration',
    };
  switch (detail.kind) {
    case 'network':
      return { headline: 'Sin conexión con Supabase', explanation: 'No se pudo conectar. Tus cambios están a salvo en este dispositivo y se enviarán solos cuando vuelva la conexión.', action: 'wait' };
    case 'auth':
      return { headline: 'Tu sesión venció', explanation: `Supabase no aceptó tu sesión${code}. Iniciá sesión de nuevo: tus materiales no se tocan.`, action: 'sign-in' };
    case 'permission':
      return { headline: 'Permiso rechazado por el servidor', explanation: `Supabase rechazó la operación por permisos${code}. Suele pasar si la biblioteca local está vinculada a otra cuenta o si falta aplicar una migración de permisos.`, action: 'none' };
    case 'schema':
      return { headline: 'Falta una migración en Supabase', explanation: `El servidor no tiene una función que la app necesita${code}. Revisá que estén aplicadas las migraciones 0001 a 0008 (docs/sharing-activation.md).`, action: 'run-migration' };
    case 'conflict':
      return { headline: 'Otro dispositivo cambió lo mismo', explanation: `El servidor tiene una versión más nueva${code}. Se conservan las dos y se vuelve a intentar; no se pierde nada.`, action: 'wait' };
    case 'too-large':
      return { headline: 'La subida es demasiado grande', explanation: `El servidor rechazó el tamaño de la petición${code}. La app envía en partes; si persiste, avisá con el detalle de Configuración.`, action: 'update-app' };
    case 'server':
      return { headline: 'Supabase no responde por ahora', explanation: `El servidor devolvió un error temporal${detail.status ? ` (${detail.status})` : ''}. Se reintenta solo; tus cambios siguen guardados acá.`, action: 'wait' };
    case 'data':
      return { headline: 'El servidor rechazó datos de esta biblioteca', explanation: `La ${operationLabel(detail.operation)} fue rechazada${code}${detail.message ? `: ${detail.message}` : ''}. Tus datos locales no se modificaron. Si esto se repite, copiá el detalle de Configuración → Sincronización.`, action: 'none' };
    default:
      return { headline: 'No pudimos sincronizar', explanation: `Respuesta inesperada del servidor${detail.status ? ` (${detail.status})` : ''}${code}. Tus cambios siguen guardados en este dispositivo.`, action: 'none' };
  }
}

/** The plain-text block the person can paste in a message. */
export function diagnosticText(diagnostic: SyncDiagnostic | undefined, version: string): string {
  if (!diagnostic) return `GuitarAP ${version}\nSincronización: sin intentos registrados.`;
  const lines = [`GuitarAP ${version}`, `Sincronización: ${diagnostic.ok ? 'correcta' : 'error'}`, `Cuándo: ${new Date(diagnostic.at).toISOString()}`];
  const d = diagnostic.detail;
  if (d) {
    lines.push(`Operación: ${operationLabel(d.operation)}`, `Función: ${d.rpc}`);
    if (d.status !== undefined) lines.push(`HTTP: ${d.status}`);
    if (d.code) lines.push(`Código: ${d.code}`);
    if (d.message) lines.push(`Descripción: ${d.message}`);
    if (d.hint) lines.push(`Pista: ${d.hint}`);
    lines.push(`Tipo: ${d.kind}`);
  }
  if (diagnostic.server) lines.push(`Servidor: ${diagnostic.server}`);
  if (diagnostic.pushed !== undefined) lines.push(`Enviados: ${diagnostic.pushed} · recibidos: ${diagnostic.pulled ?? 0} · peticiones: ${diagnostic.requests ?? 0}`);
  if (diagnostic.copies) lines.push(`Copias por edición en dos dispositivos: ${diagnostic.copies}`);
  const sk = diagnostic.skipped;
  if (sk && sk.nodes + sk.documents + sk.versions) lines.push(`Sin poder subir: ${sk.nodes} carpetas, ${sk.documents} documentos, ${sk.versions} versiones (apuntan a una carpeta que no existe)`);
  return lines.join('\n');
}

/**
 * Asks the server which version of the sync function it has, without writing anything. `sync_capabilities` exists only
 * after migration 0008; its absence is the fingerprint of the defective function from 0006.
 */
export async function probeSyncServer(url: string, anonKey: string, accessToken: string): Promise<'repaired' | 'needs-0008' | 'unknown'> {
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/sync_capabilities`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: anonKey, authorization: `Bearer ${accessToken}` },
      body: '{}',
    });
    if (response.ok) return 'repaired';
    if (response.status === 404) return 'needs-0008';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}
