/* eslint-disable react-refresh/only-export-components */
// Vite React Refresh: force full remount on HMR to prevent stale
// BrandContext mismatch (same pattern as ThemeProvider).
/// @refresh reset
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { getBrandSettings, type BrandSettings } from '@/api/branding';

// ── Context value ─────────────────────────────────────────────────

interface BrandContextValue {
  /** Current brand settings (loaded from backend). */
  settings: BrandSettings;
  /** Re-fetch brand settings from the backend. */
  refreshBrandSettings: () => void;
  /** True while brand settings are being fetched on first load. */
  loading: boolean;
}

/** React context that carries brand/white-label settings. */
export const BrandContext = createContext<BrandContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────

interface BrandProviderProps {
  children: ReactNode;
}

/**
 * Provides brand/white-label settings to the entire app.
 *
 * Loads settings from the backend on mount and exposes a
 * `refreshBrandSettings()` function so that components like
 * AppearanceSettings can trigger a re-fetch after saving.
 */
const DEFAULT_SETTINGS: BrandSettings = {
  primary_colour: '#147EFB',
  logo_path: null,
  store_name: '',
};

export function BrandProvider({ children }: BrandProviderProps) {
  const [settings, setSettings] = useState<BrandSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  // A monotonic token, so only the LATEST refresh may write -- the same shape
  // CurrencyContext.refresh (51c86e9e8) and SettingsContext (09ac4df43) needed.
  //
  // Reachable here, unlike SubscriptionContext.refresh: `refreshBrandSettings` is
  // public and has eight call sites, including one in `useSettingsSave` after every
  // save and three in AppearanceSettings (logo, colour, store name). Two saves in
  // quick succession start overlapping reads, and a slower earlier one would
  // overwrite the newer brand -- which is white-label identity: the store name
  // printed on receipts and the accent colour used across the UI.
  const refreshSeq = useRef(0);

  const refreshBrandSettings = useCallback(() => {
    const seq = ++refreshSeq.current;
    const stale = () => refreshSeq.current !== seq;
    setLoading(true);
    getBrandSettings()
      .then((s) => {
        if (stale()) return;
        setSettings(s);
        setLoading(false);
      })
      .catch(() => {
        // A superseded load must not clear the CURRENT load's spinner either.
        if (stale()) return;
        setLoading(false);
        /* keep current settings on error */
      });
  }, []);

  // Unmounting retires any read still in flight, so it cannot write after the
  // provider goes away.
  useEffect(() => () => { refreshSeq.current += 1; }, []);

  // Load on first mount.
  useEffect(() => {
    refreshBrandSettings();
  }, [refreshBrandSettings]);

  return (
    <BrandContext.Provider value={{ settings, refreshBrandSettings, loading }}>
      {children}
    </BrandContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────

/**
 * Access the current brand settings and a refresh function.
 * Must be called within a `<BrandProvider>`.
 */
export function useBrand(): BrandContextValue {
  const ctx = useContext(BrandContext);
  if (!ctx) {
    throw new Error('useBrand must be used within a BrandProvider');
  }
  return ctx;
}

/**
 * Access brand settings safely outside of a BrandProvider (or in unit tests).
 * Returns `null` if no BrandProvider wraps the calling tree.
 */
export function useOptionalBrand(): BrandSettings | null {
  const ctx = useContext(BrandContext);
  return ctx?.settings ?? null;
}

