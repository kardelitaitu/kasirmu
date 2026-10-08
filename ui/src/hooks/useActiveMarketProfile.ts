//! useActiveMarketProfile — the primary store's compiled ActiveMarketProfile.
//!
//! Exposes the compiled, locked market profile governing local checkout:
//! country_code, currency, default_locale, timezone, tax_regime, statutory_rounding,
//! and enabled_payment_rails.
//!
//! Zero runtime database reads during the sale lifecycle; cached in-flight and
//! dropped on settle, with reload() capability.

import { useEffect, useState, useCallback } from 'react';
import { getActiveMarketProfileScoped, type ActiveMarketProfile } from '@/api/regional';
import { getPrimaryLocationScoped } from '@/api/locations';
import { useWorkspace } from '@/contexts/WorkspaceContext';

export interface UseActiveMarketProfileResult {
  profile: ActiveMarketProfile | null;
  loading: boolean;
  error: Error | null;
  reload: () => void;
}

const IN_FLIGHT = new Map<string, Promise<ActiveMarketProfile | null>>();

/**
 * Load the primary location's compiled ActiveMarketProfile for the current workspace session.
 */
export function useActiveMarketProfile(explicitToken?: string | null): UseActiveMarketProfileResult {
  const { sessionToken: workspaceToken } = useWorkspace();
  const sessionToken =
    explicitToken === undefined ? workspaceToken ?? '' : explicitToken ?? '';
  const [profile, setProfile] = useState<ActiveMarketProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!sessionToken) {
      setProfile(null);
      setLoading(false);
      setError(null);
      return;
    }
    let alive = true;
    setLoading(true);
    let pending = IN_FLIGHT.get(sessionToken);
    if (!pending) {
      pending = (async () => {
        const primary = await getPrimaryLocationScoped(sessionToken);
        if (!primary) return null;
        return await getActiveMarketProfileScoped(sessionToken, primary.id);
      })().finally(() => {
        IN_FLIGHT.delete(sessionToken);
      });
      IN_FLIGHT.set(sessionToken, pending);
    }
    pending
      .then((res) => {
        if (alive) {
          setProfile(res);
          setError(null);
        }
      })
      .catch((err) => {
        if (alive) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [sessionToken, nonce]);

  return { profile, loading, error, reload };
}
