import { useEffect, useMemo, useState } from 'react';
import { configuredSupabase } from '@/features/sync/supabase-auth';
import { useAccount } from '@/features/account/account-context';
import { gatewayFor, probeCapabilities } from '@/features/share/collab-api';

/** The gateway for the signed-in account (or the anonymous one). Never contains anything but the public anon key and the user's own token. */
export function useGateway() {
  const account = useAccount();
  return useMemo(() => gatewayFor(account.session), [account.session]);
}

export type CollabState = 'unconfigured' | 'checking' | 'ready' | 'unavailable' | 'offline';

let cached: CollabState | null = null;

/**
 * Is sharing actually installed in this project? A side-effect-free probe, remembered for the session. When the
 * migration has not been applied the app says so plainly instead of offering buttons that cannot work.
 */
export function useCollabState(): CollabState {
  const configured = Boolean(configuredSupabase());
  const gateway = useGateway();
  const [state, setState] = useState<CollabState>(configured ? (cached ?? 'checking') : 'unconfigured');
  useEffect(() => {
    if (!configured || !gateway) return;
    let live = true;
    void probeCapabilities(gateway).then((result) => {
      if (result !== 'offline') cached = result;
      if (live) setState(result);
    });
    return () => {
      live = false;
    };
  }, [configured, gateway]);
  return state;
}

/** For tests: forget the remembered probe. */
export function resetCollabProbe() {
  cached = null;
}
