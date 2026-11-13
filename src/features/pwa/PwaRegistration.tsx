import { useRegisterSW } from 'virtual:pwa-register/react';

type PwaUpdateBannerProps = {
  needsRefresh: boolean;
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
};

export function PwaUpdateBanner({ needsRefresh, updateServiceWorker }: PwaUpdateBannerProps) {
  if (!needsRefresh) return null;

  return (
    <div className="fixed inset-x-4 bottom-4 z-20 mx-auto flex max-w-md items-center justify-between gap-4 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl">
      <span>Hay una actualización lista.</span>
      <button
        type="button"
        className="rounded-lg bg-teal-500 px-3 py-1.5 font-semibold hover:bg-teal-400"
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
