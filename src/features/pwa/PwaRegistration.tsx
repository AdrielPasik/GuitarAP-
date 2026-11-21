import { useEffect, useMemo, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { flushAllPendingSaves } from '@/data/pending-saves';
import { daysWaiting, forgetWaiting, noticeLevel } from '@/features/pwa/update-policy';

/**
 * How the app keeps from being left behind (v0.8 phase 1.6). An update is never forced on a session (a person may be
 * writing), but nobody should stay on an old version indefinitely either:
 *
 *  - the service worker is asked whether there is something new when the app comes back to the front, when the connection
 *    returns, and every hour while it stays open (browsers only look on their own every day or so);
 *  - the notice says how long the update has been waiting, and gets firmer with the days (it never disappears by itself);
 *  - a tab whose code was replaced by an update done in ANOTHER tab (or whose pieces can no longer be downloaded) says so
 *    and offers a reload that first writes what is being typed, instead of failing in strange ways;
 *  - nothing here touches data or the sync protocol, so a client that never updates keeps working with the old rules.
 */
const HOUR = 60 * 60_000;

type PwaUpdateBannerProps = {
  needsRefresh: boolean;
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
  /** Days the update has been waiting. */
  days?: number;
  /** This tab runs code that another tab (or a new release) already replaced. */
  staleTab?: boolean;
  /** Writes what is being typed, then reloads. */
  reload?: () => void;
};

export function PwaUpdateBanner({ needsRefresh, updateServiceWorker, days = 0, staleTab = false, reload }: PwaUpdateBannerProps) {
  if (staleTab)
    return (
      <div className="update-banner urgent" role="alert">
        <span>GuitarAP se actualizó en otra pestaña o ventana. Recargá esta para seguir sin errores: antes se guarda lo que estés escribiendo.</span>
        <button type="button" className="btn btn-primary" onClick={reload}>
          Recargar
        </button>
      </div>
    );
  if (!needsRefresh) return null;
  const level = noticeLevel(days);
  return (
    <div className={`update-banner${level === 'normal' ? '' : ` ${level}`}`} role="status">
      <span>
        {level === 'normal' && 'Hay una actualización lista.'}
        {level === 'firm' && `Hay una actualización lista desde hace ${days} días. Actualizá cuando puedas: trae mejoras de seguridad y de sincronización.`}
        {level === 'urgent' && `Hace ${days} días que hay una actualización lista. Seguir con una versión tan vieja puede dejar de sincronizar bien: actualizá en cuanto termines lo que estás haciendo.`}
      </span>
      <button type="button" className="btn btn-primary" onClick={() => void updateServiceWorker(true)}>
        Actualizar
      </button>
    </div>
  );
}

export function PwaRegistration() {
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const [staleTab, setStaleTab] = useState(false);
  const {
    needRefresh: [needsRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url: string, registered?: ServiceWorkerRegistration) {
      registration.current = registered;
    },
    onRegisterError(error) {
      console.warn('No se pudo registrar el service worker.', error);
    },
  });

  // Look for a new version when the app returns, when the connection returns, and every hour.
  useEffect(() => {
    const check = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) void registration.current?.update().catch(() => undefined);
    };
    const timer = window.setInterval(check, HOUR);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('online', check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('online', check);
    };
  }, []);

  // An update made elsewhere replaces what this tab's code expects: say it, do not fail silently.
  useEffect(() => {
    const replaced = () => setStaleTab(true);
    const lazyFailed = (event: Event) => {
      event.preventDefault(); // the browser would only log it; the person gets a way out instead
      setStaleTab(true);
    };
    navigator.serviceWorker?.addEventListener?.('controllerchange', replaced);
    window.addEventListener('vite:preloadError', lazyFailed);
    return () => {
      navigator.serviceWorker?.removeEventListener?.('controllerchange', replaced);
      window.removeEventListener('vite:preloadError', lazyFailed);
    };
  }, []);

  // Counting from the first sighting is a read-then-remember on local storage: it does not depend on anything else.
  const days = useMemo(() => (needsRefresh ? daysWaiting() : 0), [needsRefresh]);
  useEffect(() => {
    if (!needsRefresh) forgetWaiting();
  }, [needsRefresh]);

  return (
    <PwaUpdateBanner
      needsRefresh={needsRefresh}
      updateServiceWorker={updateServiceWorker}
      days={days}
      staleTab={staleTab}
      reload={() => void flushAllPendingSaves().finally(() => window.location.reload())}
    />
  );
}
