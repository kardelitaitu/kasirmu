// Vite React Refresh: force full remount on HMR to prevent stale
// CurrencyContext mismatch.
/// @refresh reset
import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { getDefaultCurrency, getDefaultCurrencyScoped, setDefaultCurrency as setDefaultCurrencyApi } from '@/api/currency';

// ── Types ──────────────────────────────────────────────────────────

interface CurrencyContextValue {
  /** The current default currency code (e.g. "IDR", "USD"). */
  currency: string;
  /** Persist a new default currency to the backend and update the context. */
  setCurrency: (code: string) => Promise<void>;
  /**
   * Re-read the default currency (CurrencyContext reload): the scoped
   * per-store value (CUR-03) when a session token is supplied, the
   * global bootstrap value otherwise. A failed refresh keeps the last
   * good value — it must never reset the display currency.
   */
  refresh: (sessionToken?: string | null) => Promise<void>;
  /** True while the initial currency value is being fetched from the backend. */
  loading: boolean;
}

// ── Context ────────────────────────────────────────────────────────

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

// ── Provider ───────────────────────────────────────────────────────

interface CurrencyProviderProps {
  children: ReactNode;
  /** Optional fallback used while loading / when no default is set. */
  fallback?: string;
}

/**
 * Provides the store's default currency to the entire component tree.
 * Loads from the backend on mount and exposes a `setCurrency` function
 * that persists the choice and immediately propagates it to all consumers.
 */
export function CurrencyProvider({ children, fallback = 'USD' }: CurrencyProviderProps) {
  const [currency, setCurrencyState] = useState<string>(fallback);
  const [loading, setLoading] = useState(true);

  // Load from backend on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await getDefaultCurrency();
        if (!cancelled) setCurrencyState(stored ?? fallback);
      } catch {
        if (!cancelled) setCurrencyState(fallback);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fallback]);

  const setCurrency = useCallback(async (code: string) => {
    await setDefaultCurrencyApi({ code });
    setCurrencyState(code);
  }, []);

  // A monotonically increasing token, so only the LATEST refresh may write.
  // This is the one that races: `CurrencyWorkspaceSync` calls `refresh(token)` on
  // every workspace change, and the mount effect above is cancelled on cleanup
  // while this one had no guard at all.
  //
  // Why it matters: a store switch A -> B -> A can resolve out of order, and the
  // slower earlier read then overwrites the newer one, leaving the WRONG store's
  // currency on screen. Every money figure in the app is formatted with this
  // value, so the failure is not cosmetic — a price printed in another store's
  // currency is a different number.
  //
  // Strictly-greater-than rather than `!cancelled`, because these calls overlap
  // rather than nest: `CurrencyWorkspaceSync` fires one per token change, and an
  // unmount mid-flight must cancel too.
  const refreshSeq = useRef(0);

  const refresh = useCallback(async (sessionToken?: string | null) => {
    const seq = ++refreshSeq.current;
    const stale = () => refreshSeq.current !== seq;
    try {
      const stored = sessionToken
        ? await getDefaultCurrencyScoped(sessionToken)
        : await getDefaultCurrency();
      if (stale()) return;
      if (stored) setCurrencyState(stored);
    } catch {
      // Keep the current value — a failed refresh must not change the
      // display currency out from under the user.
    }
  }, []);

  // Unmounting invalidates any in-flight refresh, same as the mount effect's
  // cleanup does for itself.
  useEffect(() => () => { refreshSeq.current += 1; }, []);

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, refresh, loading }}>
      {children}
    </CurrencyContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────────────

/**
 * Access the store's default currency.
 * Must be called within a `<CurrencyProvider>`.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useCurrency(): CurrencyContextValue {
  const ctx = useContext(CurrencyContext);
  if (!ctx) {
    throw new Error('useCurrency must be used within a CurrencyProvider');
  }
  return ctx;
}

/**
 * Access the store's default currency if inside a `<CurrencyProvider>`, or null otherwise.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useOptionalCurrency(): CurrencyContextValue | null {
  return useContext(CurrencyContext);
}
