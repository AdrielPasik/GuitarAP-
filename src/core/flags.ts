/**
 * Features that are built but not yet switched on for everybody.
 *
 *  - autoRecovery (v0.8 phase 1.3): signing in on a device recovers the library from the cloud by itself.
 *
 * A PRODUCTION build honours only the build-time variable (VITE_FEATURE_AUTO_RECOVERY=true), which no deployment sets
 * today, so nobody can switch it on by accident in the browser. Any other build (local development, the test build) also
 * honours a browser override, so it can be tried in an isolated profile:
 *   localStorage.setItem('guitarap.flag.autoRecovery', 'on')
 */
export function autoRecoveryEnabled(): boolean {
  if (import.meta.env.VITE_FEATURE_AUTO_RECOVERY === 'true') return true;
  if (import.meta.env.MODE === 'production') return false;
  try {
    return window.localStorage.getItem('guitarap.flag.autoRecovery') === 'on';
  } catch {
    return false;
  }
}
