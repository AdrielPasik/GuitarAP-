import { useRegisterSW } from 'virtual:pwa-register/react';

type PwaUpdateBannerProps = {
  needsRefresh: boolean;
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
};

export function PwaUpdateBanner({ needsRefresh, updateServiceWorker }: PwaUpdateBannerProps) {
  if (!needsRefresh) return null;

  return (
    <div className="update-banner">
      <span>Hay una actualización lista.</span>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => void updateServiceWorker(true)}
      >
        Actualizar
      </button>
    </div>
  );
}

export function PwaRegistration() {
  const {
    needRefresh: [needsRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.warn('No se pudo registrar el service worker.', error);
    },
  });

  return <PwaUpdateBanner needsRefresh={needsRefresh} updateServiceWorker={updateServiceWorker} />;
}
