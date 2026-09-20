/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  type ReactNode,
} from 'react';
import {
  getReceiptSettingsScoped,
  getStoreSettingsScoped,
  getUserPreferencesScoped,
  onSettingsUpdated,
  type ReceiptSettingsDto,
  type StoreSettingsDto,
} from '@/api/settings';
import {
  getSyncSettingsScoped,
  type SyncSettingsDto,
} from '@/api/offline';
import {
  listCurrenciesScoped,
  type CurrencyDto,
} from '@/api/currency';
import { getBrandSettingsScoped } from '@/api/branding';
import { getVersionScoped, getDeviceId, type VersionInfo } from '@/api/system';
import { listTerminalsScoped } from '@/api/terminals';
import { useWorkspace } from './WorkspaceContext';

// ── Types ────────────────────────────────────────────────────────────

/** Brand subset that SettingsContext tracks. */
export interface SettingsBrandState {
  colour: string;
  storeName: string;
}

/** User preference subset that SettingsContext tracks. */
export interface SettingsPreferencesState {
  cardSize: number;
  fontSize: number;
  fontSmoothing: string;
}

/** All settings state held by the context. */
export interface SettingsState {
  receipt: ReceiptSettingsDto;
  store: StoreSettingsDto;
  sync: SyncSettingsDto;
  brand: SettingsBrandState;
  preferences: SettingsPreferencesState;
  currencies: CurrencyDto[];
  appVersion: string;
}

// Mirrors kasirmu_core::server_origin::MAIN_SERVER_ORIGIN: the settings draft
// proposes the canonical origin, never the fallback name. Locked by
// scripts/check-server-origins.mjs (ADR #55).
const DEFAULT_LOCAL_SYNC_SERVER_URL = 'https://license.kasir.mu';

/**
 * The compiled canonical origin (ADR #55). Reported as the resolved origin until
 * the first fetch replaces it with the app's actual resolution — an environment
 * override, an attested pin, or this default.
 */
export const DEFAULT_RESOLVED_ORIGIN = 'https://license.kasir.mu';

/**
 * Give an unconfigured settings page a usable cloud-sync draft.
 *
 * A missing/blank URL means there is no target to connect to, regardless of
 * whether an old API key was retained. Keep configured URLs and explicit
 * enabled states untouched; this fallback only supplies the defaults for the
 * unconfigured settings surface.
 */
export function withSyncDefaults(sync: SyncSettingsDto): SyncSettingsDto {
  if (sync.serverUrl?.trim()) return sync;
  return {
    ...sync,
    serverUrl: DEFAULT_LOCAL_SYNC_SERVER_URL,
    enabled: true,
  };
}

/** Default state used before the initial fetch completes. */
const DEFAULT_SETTINGS: SettingsState = {
  receipt: {
    showCurrency: false,
    decimalSeparator: 'dot',
    showTax: true,
    footer: '',
    paperWidth: 'standard',
    showTableNumber: false,
    marginTop: 0,
    marginBottom: 0,
    marginLeft: 0,
    marginRight: 0,
    taxRoundingMode: 'half_up',
  },
  store: { name: '', address: '', taxId: '', currency: 'IDR', branch: '' },
  sync: {
    serverUrl: DEFAULT_LOCAL_SYNC_SERVER_URL,
    hasApiKey: false,
    enabled: false,
    resolvedOrigin: DEFAULT_RESOLVED_ORIGIN,
    resolvedOriginSource: 'main',
  },
  brand: { colour: '#147EFB', storeName: '' },
  preferences: { cardSize: 0, fontSize: 0, fontSmoothing: 'antialiased' },
  currencies: [],
  appVersion: '',
};

/** Public API exposed by `useSettings()`. */
export interface SettingsContextValue {
  /** The current settings snapshot. */
  settings: SettingsState;
  /** True during initial fetch and during active refetch windows. */
  loading: boolean;
  /** Fluent key id when ALL APIs fail; null when at least one succeeded. */
  error: string | null;
  /** True when the most recent load succeeded partially (some APIs failed). */
  hasPartialError: boolean;
  /** Force an immediate full reload (bypasses debounce). */
  refetch: () => Promise<void>;
  /** Keys from the most recent `settings_updated` event (debounced). */
  lastChangedKeys: string[];
  /**
   * Called by save handlers after settings are persisted to the backend.
   * Triggers a debounced scoped refetch so all consumers reflect the change.
   */
  markSettingsUpdated: (keys: string[]) => void;
}

// ── Context ──────────────────────────────────────────────────────────

const SettingsContext = createContext<SettingsContextValue | null>(null);

// ── Key-prefix → scope mapping ──────────────────────────────────────

type SettingsScope = 'receipt' | 'store' | 'sync' | 'brand' | 'preferences' | 'currencies' | 'version';

const SCOPE_PREFIXES: Array<{ prefix: string; scope: SettingsScope }> = [
  { prefix: 'receipt.', scope: 'receipt' },
  { prefix: 'store.', scope: 'store' },
  { prefix: 'currency.', scope: 'currencies' },
  { prefix: 'sync.', scope: 'sync' },
  { prefix: 'brand.', scope: 'brand' },
  { prefix: 'prefs.', scope: 'preferences' },
  { prefix: 'user.', scope: 'preferences' },
];

/** Map a list of changed keys to the unique set of affected scopes. */
function keysToScopes(keys: string[]): Set<SettingsScope> {
  const scopes = new Set<SettingsScope>();
  for (const key of keys) {
    let matched = false;
    for (const { prefix, scope } of SCOPE_PREFIXES) {
      if (key.startsWith(prefix)) {
        scopes.add(scope);
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Unknown key → full refetch
      return new Set<SettingsScope>(['receipt', 'store', 'sync', 'brand', 'preferences', 'currencies', 'version']);
    }
  }
  return scopes;
}

/** DEBOUNCE_MS window for coalescing rapid settings_updated events. */
const DEBOUNCE_MS = 300;

// ── Provider ─────────────────────────────────────────────────────────

interface SettingsProviderProps {
  children: ReactNode;
}

/**
 * Provides a single source of truth for all settings state.
 *
 * Fetches all settings on mount. Supports scoped refetch via
 * `markSettingsUpdated()` — called by save handlers after persisting
 * changes. The refetch is debounced (300ms) so rapid updates
 * (e.g. multiple toggles) trigger a single backend round-trip.
 *
 * When Phase 0e delivers the async event-bus bridge, the context's
 * internal listener will subscribe to `settings_updated` events
 * from the Rust backend for true real-time cross-terminal reactivity.
 */
export function SettingsProvider({ children }: SettingsProviderProps) {
  const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasPartialError, setHasPartialError] = useState(false);
  const [lastChangedKeys, setLastChangedKeys] = useState<string[]>([]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingKeysRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);

  // Read sessionToken for scoped settings APIs. `terminalId` is the
  // device id (`getDeviceId()`); the backend tags `settings_updated` events
  // with the originating terminal's ROW id (or "unknown" when this device
  // has no registered terminal).
  const { sessionToken, terminalId } = useWorkspace();

  // ── Local terminal identity (SYNC-10) ────────────────────────
  // A local save already refetches via the save handler's
  // markSettingsUpdated call; the backend ALSO publishes a
  // settings_updated event for that same change. The listener must ignore
  // events it can positively attribute to this terminal so the UI doesn't
  // double-refetch, while still reacting to events from other terminals.
  //
  // Identities: the device id (the value the backend matches against the
  // terminals.device_id column) plus the registered terminal's row id
  // (the value the backend actually emits in events). "unknown" is the
  // backend's signature for an unregistered device — when no terminal is
  // registered here, every "unknown" event is a local echo, so it is
  // skipped too; when we ARE registered, "unknown" can only be an
  // unregistered peer's change and must still refetch.
  const localIdentityRef = useRef<{ ids: Set<string>; hasRegisteredTerminal: boolean }>({
    ids: new Set(),
    hasRegisteredTerminal: false,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ids = new Set<string>();
        let hasRegisteredTerminal = false;
        const deviceId = terminalId || (await getDeviceId().catch(() => ''));
        if (deviceId) ids.add(deviceId);
        try {
          const terminals = sessionToken ? await listTerminalsScoped(sessionToken) : [];
          const match = terminals.find((t) => t.deviceId === deviceId);
          if (match) {
            ids.add(match.id);
            hasRegisteredTerminal = true;
          }
        } catch {
          // IPC unavailable (browser dev) — device id only.
        }
        if (!cancelled) {
          localIdentityRef.current = { ids, hasRegisteredTerminal };
        }
      } catch {
        // Never let identity resolution crash the provider (e.g. a test or
        // non-Tauri shell that leaves getDeviceId unmocked).
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [terminalId, sessionToken]);

  // ── Full load (all APIs) ────────────────────────────────────

  const loadAll = useCallback(async () => {
    if (!sessionToken) {
      setSettings(DEFAULT_SETTINGS);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const results = await Promise.allSettled([
      getReceiptSettingsScoped(sessionToken),
      getStoreSettingsScoped(sessionToken),
      listCurrenciesScoped(sessionToken),
      getSyncSettingsScoped(sessionToken),
      getUserPreferencesScoped(sessionToken),
      getBrandSettingsScoped(sessionToken),
      getVersionScoped(sessionToken),
    ]);
    const [rR, sR, cR, syncR, prefsR, brandR, verR] = results;

    let hasAnyFailure = false;
    try {
      if (rR.status === 'fulfilled' && rR.value) {
        setSettings((prev) => ({ ...prev, receipt: rR.value }));
      } else {
        hasAnyFailure = true;
      }
      if (sR.status === 'fulfilled' && sR.value) {
        setSettings((prev) => ({ ...prev, store: sR.value }));
      } else {
        hasAnyFailure = true;
      }
      if (cR.status === 'fulfilled' && cR.value) {
        setSettings((prev) => ({ ...prev, currencies: cR.value }));
      } else {
        hasAnyFailure = true;
      }
      if (syncR.status === 'fulfilled' && syncR.value) {
        setSettings((prev) => ({ ...prev, sync: withSyncDefaults(syncR.value) }));
      } else {
        hasAnyFailure = true;
      }
      if (prefsR.status === 'fulfilled' && prefsR.value) {
        const p = prefsR.value;
        const cardSize = p['cardsize'] !== undefined
          ? Math.min(4, Math.max(0, parseInt(p['cardsize'], 10) || 0))
          : 0;
        const fontSize = p['fontsize'] !== undefined
          ? Math.min(4, Math.max(0, parseInt(p['fontsize'], 10) || 0))
          : 0;
        const fontSmoothing = p['font-smoothing'] ?? 'antialiased';
        setSettings((prev) => ({
          ...prev,
          preferences: { cardSize, fontSize, fontSmoothing },
        }));
      } else {
        hasAnyFailure = true;
      }
      if (brandR.status === 'fulfilled' && brandR.value) {
        setSettings((prev) => ({
          ...prev,
          brand: {
            colour: brandR.value.primary_colour,
            storeName: brandR.value.store_name,
          },
        }));
      } else {
        hasAnyFailure = true;
      }
      if (verR.status === 'fulfilled' && verR.value) {
        setSettings((prev) => ({ ...prev, appVersion: verR.value.version }));
      } else {
        hasAnyFailure = true;
      }

      if (results.every((r) => r.status === 'rejected')) {
        setError('settings-load-failed');
        setHasPartialError(false);
      } else {
        setHasPartialError(hasAnyFailure);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [sessionToken]);

  // ── Scoped refetch (key-prefix based) ───────────────────────

  const loadScoped = useCallback(async (keys: string[]) => {
    if (!sessionToken) {
      setLoading(false);
      return;
    }

    const scopes = keysToScopes(keys);

    // If full refetch requested, delegate to loadAll
    if (scopes.size >= 6) {
      await loadAll();
      return;
    }

    setLoading(true);
    const tasks: Array<Promise<unknown>> = [];

    if (scopes.has('receipt')) {
      tasks.push(
        getReceiptSettingsScoped(sessionToken).then((v) => {
          if (!v) return;
          setSettings((prev) => ({ ...prev, receipt: v }));
        }),
      );
    }
    if (scopes.has('store')) {
      tasks.push(
        getStoreSettingsScoped(sessionToken).then((v) => {
          if (!v) return;
          setSettings((prev) => ({ ...prev, store: v }));
        }),
      );
    }
    if (scopes.has('currencies')) {
      tasks.push(
        listCurrenciesScoped(sessionToken).then((v) => {
          if (!v) return;
          setSettings((prev) => ({ ...prev, currencies: v }));
        }),
      );
    }
    if (scopes.has('sync')) {
      tasks.push(
        getSyncSettingsScoped(sessionToken).then((v) => {
          if (!v) return;
          setSettings((prev) => ({ ...prev, sync: withSyncDefaults(v) }));
        }),
      );
    }
    if (scopes.has('preferences')) {
      tasks.push(
        getUserPreferencesScoped(sessionToken).then((p) => {
          if (!p) return;
          const cardSize = p['cardsize'] !== undefined
            ? Math.min(4, Math.max(0, parseInt(p['cardsize'], 10) || 0))
            : 0;
          const fontSize = p['fontsize'] !== undefined
            ? Math.min(4, Math.max(0, parseInt(p['fontsize'], 10) || 0))
            : 0;
          const fontSmoothing = p['font-smoothing'] ?? 'antialiased';
          setSettings((prev) => ({
            ...prev,
            preferences: { cardSize, fontSize, fontSmoothing },
          }));
        }),
      );
    }
    if (scopes.has('brand')) {
      tasks.push(
        getBrandSettingsScoped(sessionToken).then((v) => {
          if (!v) return;
          setSettings((prev) => ({
            ...prev,
            brand: { colour: v.primary_colour, storeName: v.store_name },
          }));
        }),
      );
    }
    if (scopes.has('version')) {
      tasks.push(
        getVersionScoped(sessionToken).then((v: VersionInfo) => {
          if (!v) return;
          setSettings((prev) => ({ ...prev, appVersion: v.version }));
        }),
      );
    }

    await Promise.allSettled(tasks);
    if (mountedRef.current) setLoading(false);
  }, [sessionToken, loadAll]);

  // ── Debounced update handler ────────────────────────────────

  const markSettingsUpdated = useCallback(
    (keys: string[]) => {
      // Accumulate all keys received within the debounce window
      for (const key of keys) {
        pendingKeysRef.current.add(key);
      }
      setLastChangedKeys(keys);

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        const allKeys = [...pendingKeysRef.current];
        pendingKeysRef.current.clear();
        loadScoped(allKeys);
      }, DEBOUNCE_MS);
    },
    [loadScoped],
  );

  // Wrapped refetch to bypass debounce
  const refetch = useCallback(async () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    pendingKeysRef.current.clear();
    await loadAll();
  }, [loadAll]);

  // ── Initial load ────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    loadAll();
    return () => {
      mountedRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [loadAll]);

  // ── Tauri event listener (Phase 0e: async event bridge) ────

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    // onSettingsUpdated (ui/src/api/settings.ts) owns the dynamic import of
    // the Tauri event API and degrades silently outside Tauri (browser dev).
    onSettingsUpdated((payload) => {
      const keys = payload.changed_keys;
      const origin = payload.terminal_id;
      // Skip our own change — the save handler already refetched via
      // markSettingsUpdated (see the identity effect above).
      const identity = localIdentityRef.current;
      const isOwn =
        origin !== undefined &&
        (identity.ids.has(origin) ||
          (origin === 'unknown' && !identity.hasRegisteredTerminal));
      if (isOwn) return;
      if (keys && keys.length > 0) {
        markSettingsUpdated(keys);
      }
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((err) => {
        console.warn('Failed to register settings_updated listener:', err);
      });

    return () => {
      if (unlisten) unlisten();
    };
  }, [markSettingsUpdated]);

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      loading,
      error,
      hasPartialError,
      refetch,
      lastChangedKeys,
      markSettingsUpdated,
    }),
    [settings, loading, error, hasPartialError, refetch, lastChangedKeys, markSettingsUpdated],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────────────

/**
 * Access the shared settings state and mutation helpers.
 * Must be called within a `<SettingsProvider>`.
 */
export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error('useSettings must be used within a <SettingsProvider>');
  }
  return ctx;
}

/**
 * Access settings state safely outside of a SettingsProvider.
 * Returns `null` when no provider wraps the calling tree.
 */
export function useOptionalSettings(): SettingsContextValue | null {
  return useContext(SettingsContext);
}
