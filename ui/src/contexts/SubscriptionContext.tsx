import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  getSubscriptionCapabilities,
  type SubscriptionCapabilities,
  type SubscriptionLifecycleState,
} from '@/api/subscription';

/**
 * The lifecycle state visible to the UI: the backend's normalized state
 * once the read settles, `loading` while the first fetch is in flight.
 * (`loading` never comes from the backend — it is this provider's fetch
 * phase only.)
 */
export type SubscriptionUiState = SubscriptionLifecycleState | 'loading';

interface SubscriptionContextValue {
  /** The tenant's tier capabilities, or `null` while loading / on transport failure. */
  caps: SubscriptionCapabilities | null;
  /**
   * Lifecycle state (todo-global-saas-1.md §B). Fail-closed: a transport
   * failure reports `unavailable` — the backend itself already downgrades
   * missing/tampered subscription data to Free entitlements + `unavailable`,
   * so a missing response can never silently grant tier-gated access.
   */
  state?: SubscriptionUiState;
  /** True until the first capabilities read settles. */
  loading: boolean;
  /** Re-fetch capabilities (e.g. after license activation/renewal). */
  refresh: () => void;
}

const SubscriptionContext = createContext<SubscriptionContextValue>({
  caps: null,
  state: 'loading',
  loading: true,
  refresh: () => {},
});

/**
 * C2.2: fetches the tenant's subscription capabilities once at app start and
 * shares them with every tier-gated screen (analytics/loyalty locks, QRIS
 * gate, location/terminal/staff limits). The read is local (no network).
 *
 * §B fail-closed contract: the command layer never errors for missing or
 * tampered subscription data — it returns Free entitlements with
 * `state: 'unavailable'`, so gates lock. Only a transport-level failure
 * lands in the catch path, which also reports `unavailable`.
 */
export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const [caps, setCaps] = useState<SubscriptionCapabilities | null>(null);
  const [state, setState] = useState<SubscriptionUiState>('loading');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    setState('loading');
    getSubscriptionCapabilities()
      .then((next) => {
        setCaps(next);
        setState(next.state);
      })
      .catch(() => {
        // Transport failure (command missing, IPC broken) — fail closed.
        setCaps(null);
        setState('unavailable');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <SubscriptionContext.Provider value={{ caps, state, loading, refresh }}>
      {children}
    </SubscriptionContext.Provider>
  );
}

/** Access the tenant's subscription capabilities + lifecycle state (C2.2). */
export function useSubscription(): SubscriptionContextValue {
  return useContext(SubscriptionContext);
}

/**
 * §B administrative entitlement gate (todo-global-saas-1.md):
 * administrative SaaS features — Analytics, Reports, Audit Log, Memo,
 * Promotions, Data Management, Topology editing, premium Settings — lock
 * the moment the subscription leaves `active` (i.e. at `expiresAt`, and
 * for canceled/paused/unavailable data too), while POS operational runtime
 * continues through the tier's signed offline grace window. Grace never
 * re-opens administrative features, and a missing/invalid subscription
 * fails closed here exactly as it does in the capabilities command.
 *
 * Operational tier gates (QRIS, loyalty earning, quotas) keep reading
 * `caps` — the backend already downgrades their entitlements via
 * `effective_tier()` when grace lapses.
 */
export function useAdminGate(): { locked: boolean; state: SubscriptionUiState } {
  const { state } = useSubscription();
  // Absent state (legacy mock, unexpected payload) fails closed.
  const resolved = state ?? 'unavailable';
  return { locked: resolved !== 'active', state: resolved };
}

/** The ADR #58 §2.3 re-authentication window: 3 days before `expiresAt`. */
export const PRE_EXPIRY_REAUTH_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * ADR #58 §2.3: Hook to determine if the paid subscription is within the 3-day
 * pre-expiry re-authentication window where an online check is required / prompted.
 */
export function usePreExpiryReauth(): {
  isPreExpiryWindow: boolean;
  daysRemaining: number;
  expiresAt: string | null;
} {
  const { caps, state } = useSubscription();
  if (!caps || caps.tier === 'free' || !caps.expiresAt || state !== 'active') {
    return { isPreExpiryWindow: false, daysRemaining: 0, expiresAt: null };
  }

  const expiresAtMs = Date.parse(caps.expiresAt);
  if (Number.isNaN(expiresAtMs)) {
    return { isPreExpiryWindow: false, daysRemaining: 0, expiresAt: null };
  }

  const nowMs = Date.now();
  const isPreExpiryWindow =
    nowMs >= expiresAtMs - PRE_EXPIRY_REAUTH_WINDOW_MS && nowMs < expiresAtMs;
  const daysRemaining = isPreExpiryWindow
    ? Math.max(1, Math.ceil((expiresAtMs - nowMs) / (24 * 60 * 60 * 1000)))
    : 0;

  return { isPreExpiryWindow, daysRemaining, expiresAt: caps.expiresAt };
}

