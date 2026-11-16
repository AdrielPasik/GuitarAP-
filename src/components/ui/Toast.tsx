import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { ToastContext, type ToastAction } from '@/components/ui/toast-context';

type ToastItem = { id: number; message: string; action?: ToastAction };

/** Short, non-blocking feedback. Announced politely to assistive technology. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [item, setItem] = useState<ToastItem | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((message: string, action?: ToastAction) => {
    window.clearTimeout(timer.current);
    setItem({ id: Date.now(), message, action });
    timer.current = window.setTimeout(() => setItem(null), action ? 8000 : 4500);
  }, []);
  const api = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext value={api}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {item && (
          <div className="toast" key={item.id}>
            <span>{item.message}</span>
            {item.action && (
              <button
                type="button"
                className="btn btn-link"
                onClick={() => {
                  item.action?.onAction();
                  setItem(null);
                }}
              >
                {item.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext>
  );
}
