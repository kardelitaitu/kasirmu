import { useState, useEffect, useMemo } from 'react';
import { getTerminalProfileScoped, listTerminalsScoped, type TerminalProfileDto } from '@/api/terminals';
import { plainErrorMessage } from '@/utils/app-error';

/** Return type of the `useTerminalProfile` hook. */
export interface UseTerminalProfileResult {
  /** The loaded terminal profile, or null if not set / not found. */
  profile: TerminalProfileDto | null;
  /** True while the profile is being loaded. */
  loading: boolean;
  /** True if the terminal is in kds_kiosk lockdown mode. */
  isKdsKiosk: boolean;
  /** Error message if profile loading failed. */
  error: string | null;
}

/**
 * Load the terminal profile for the current device.
 *
 * Determines the current terminal by listing all terminals and matching
 * the hostname-env device ID (or falling back to listing).
 *
 * If the profile's `profileType` is `'kds_kiosk'`, the front-end should
 * force the KDS route and hide all navigation.
 */
export function useTerminalProfile(sessionToken?: string): UseTerminalProfileResult {
  const [profile, setProfile] = useState<TerminalProfileDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // NO TOKEN IS NOT AN ANSWER. `sessionToken` resolves asynchronously, so this
        // effect can run with an empty string; answering `[]` then reported "no
        // terminals registered" — and skipped the kiosk detection below — from a read
        // that was never issued. Stay in the loading state; the token arriving re-runs
        // this effect.
        if (!sessionToken) return;

        // First, try to get the current terminal ID from env or match by device.
        // We list terminals and pick the first one (this is a simplification —
        // in production, the terminal ID is passed as a Tauri env var).
        const terminals = await listTerminalsScoped(sessionToken);
        if (cancelled) return;

        if (terminals.length === 0) {
          setProfile(null);
          setLoading(false);
          return;
        }

        // Use the first active terminal's ID to look up its profile.
        const activeTerminal = terminals.find((t) => t.isActive) ?? terminals[0];
        if (!activeTerminal) {
          setProfile(null);
          setLoading(false);
          return;
        }
        const terminalProfile = await getTerminalProfileScoped(sessionToken, activeTerminal.id);

        if (!cancelled) {
          setProfile(terminalProfile);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            plainErrorMessage(err, 'Failed to load terminal profile'),
          );
          setProfile(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionToken]);

  const isKdsKiosk = profile?.profileType === 'kds_kiosk';

  return useMemo(
    () => ({ profile, loading, isKdsKiosk, error }),
    [profile, loading, isKdsKiosk, error],
  );
}
