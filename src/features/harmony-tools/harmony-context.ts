import { createContext, useContext, useEffect } from 'react';
import type { ToolsActions, ToolsContext } from '@/features/harmony-tools/HarmonyTools';

export type HarmonyRegistration = { id: string; context: Pick<ToolsContext, 'key' | 'bpm'>; actions?: ToolsActions };
export type Host = {
  open: boolean;
  toggle: () => void;
  close: () => void;
  /** Opens (or retargets) the panel on a chord, e.g. «Ver sus notas» from a chords block. */
  openChord: (symbol: string) => void;
  register: (registration: HarmonyRegistration | null) => void;
};
export const HarmonyContext = createContext<Host | null>(null);

export const FREE_EXPLORER: ToolsActions = { canAddChord: false, onAddChord: () => undefined, onAddProgression: () => undefined, onUseKey: () => undefined, onCreateMap: () => undefined };

export function useHarmony() {
  const host = useContext(HarmonyContext);
  if (!host) throw new Error('useHarmony debe usarse dentro de HarmonyProvider.');
  return host;
}

/** A screen with a document in hand: gives the panel its key and its explicit actions for as long as it is mounted. */
export function useHarmonyDocument(registration: HarmonyRegistration | null) {
  const { register } = useHarmony();
  const id = registration?.id;
  // The actions close over fresh state every render, so the registered object is refreshed every render (cheap: the
  // panel is the only consumer and children of the provider are not re-rendered by it).
  useEffect(() => {
    register(registration);
  });
  useEffect(() => () => register(null), [register, id]);
}
