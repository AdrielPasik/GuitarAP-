/**
 * "Probar conexión": a READ-ONLY check that sends nothing of the person's: one GET to the project's public health
 * address with the public client key (the same one every page of the app already uses). It never carries a session,
 * never uploads, and never touches the library. What it can say is limited by what a browser reveals:
 *
 *   reachable    the server answered (any HTTP status): the path to it works
 *   refused      it answered with an error status: the path works, the server (or the key) said no
 *   timeout      this check stopped waiting
 *   unreachable  the browser could not reach it. DNS failure, no connection, a blocking extension/VPN/antivirus and CORS all
 *                look identical to a web page, so the cause is NOT claimed
 */
export type ProbeServer = 'reachable' | 'refused' | 'timeout' | 'unreachable';
export type ConnectivityProbe = { at: number; navigatorOnline: boolean; server: ProbeServer; status?: number; ms: number };

export async function probeConnectivity(config: { url: string; anonKey: string }, options: { timeoutMs?: number; fetcher?: typeof fetch; now?: () => number } = {}): Promise<ConnectivityProbe> {
  const now = options.now ?? Date.now;
  const started = now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000);
  const navigatorOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
  try {
    const response = await (options.fetcher ?? fetch)(`${config.url.replace(/\/$/, '')}/auth/v1/health`, { method: 'GET', headers: { apikey: config.anonKey }, signal: controller.signal, cache: 'no-store' });
    return { at: started, navigatorOnline, server: response.ok ? 'reachable' : 'refused', status: response.status, ms: now() - started };
  } catch {
    return { at: started, navigatorOnline, server: controller.signal.aborted ? 'timeout' : 'unreachable', ms: now() - started };
  } finally {
    clearTimeout(timer);
  }
}

/** The verdict in plain words, as strong as the evidence and no stronger. */
export function describeProbe(probe: ConnectivityProbe): { ok: boolean; text: string } {
  if (probe.server === 'reachable') return { ok: true, text: 'Se llega al servidor de GuitarAP: la conexión y el nombre del servidor funcionan.' };
  if (probe.server === 'refused')
    return { ok: true, text: `Se llega al servidor, pero respondió con un error (${probe.status}). La conexión funciona; el problema está del lado del servicio o de la configuración.` };
  if (probe.server === 'timeout') return { ok: false, text: 'El servidor no contestó a tiempo. Puede estar lento o la conexión ser muy mala; probá de nuevo en un rato.' };
  if (!probe.navigatorOnline) return { ok: false, text: 'Este dispositivo dice que no tiene conexión a Internet. Tus cambios están guardados acá y se suben solos cuando vuelva.' };
  return {
    ok: false,
    text: 'El navegador no pudo llegar al servidor. Puede ser la red, el DNS, un bloqueo (extensión, VPN, antivirus) o una caída del servicio: el navegador no deja distinguirlo. Tus cambios están guardados en este dispositivo.',
  };
}
