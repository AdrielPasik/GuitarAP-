import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { FREE_EXPLORER, HarmonyContext, type HarmonyRegistration, type Host } from '@/features/harmony-tools/harmony-context';

const HarmonyTools = lazy(() => import('@/features/harmony-tools/HarmonyTools').then((module) => ({ default: module.HarmonyTools })));

/**
 * Harmony is a place of the whole app, not a feature of one document. One panel, one engine (the existing tools), one
 * door in the top bar. A screen that has a document in hand registers its key and its *explicit* actions
 * (add a chord, use this key…); with nothing registered the panel is a free explorer. Exploring never changes anything.
 */
export function HarmonyProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [chord, setChord] = useState<string | undefined>();
  const [registration, setRegistration] = useState<HarmonyRegistration | null>(null);
  // Re-opening starts from the current document's key; the panel keeps its own state while it stays open.
  const [session, setSession] = useState(0);

  const toggle = useCallback(() => {
    setOpen((value) => {
      if (!value) {
        setChord(undefined);
        setSession((n) => n + 1);
      }
      return !value;
    });
  }, []);
  const close = useCallback(() => setOpen(false), []);
  const openChord = useCallback((symbol: string) => {
    setChord(symbol);
    setSession((n) => n + 1);
    setOpen(true);
  }, []);
  const register = useCallback((next: HarmonyRegistration | null) => setRegistration(next), []);

  useEffect(() => {
    document.documentElement.dataset.harmony = open ? 'open' : 'closed';
    return () => {
      document.documentElement.dataset.harmony = 'closed';
    };
  }, [open]);

  // «H» opens and closes it from anywhere, but never while a person is typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.ctrlKey || event.metaKey || event.altKey || event.key.toLowerCase() !== 'h') return;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  const value = useMemo<Host>(() => ({ open, toggle, close, openChord, register }), [open, toggle, close, openChord, register]);
  return (
    <HarmonyContext value={value}>
      {children}
      {open && (
        <Suspense fallback={null}>
          <HarmonyTools
            key={`${registration?.id ?? 'libre'}:${session}`}
            context={{ key: registration?.context.key, bpm: registration?.context.bpm, chord }}
            actions={registration?.actions ?? FREE_EXPLORER}
            hasDocument={Boolean(registration)}
            onClose={close}
          />
        </Suspense>
      )}
    </HarmonyContext>
  );
}

