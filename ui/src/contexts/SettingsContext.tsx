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
  // A monotonic token, so only the LATEST load may write into `settings`.
  //
  // THIS IS ONE OF TWELVE FIXES FOR ONE SHAPE, and the shape has no gate. In every
  // case an effect whose dependency list names sessionToken re-ran on a store
  // switch, two reads overlapped, and the slower landed last.
  //
  // THE TWELVE, with their coverage as of round 117. "Pinned" means a mutation was
  // run: the guard was deleted and the suite went red.
  //
  //   51c86e9e8 CurrencyContext.refresh          pinned (80d5c121c)
  //   09ac4df43 SettingsContext loadAll/loadScoped pinned (8593d76ca)
  //   184fcc75e BrandContext.refreshBrandSettings pinned (184fcc75e, same commit)
  //   88415f10f ShiftBar locations/shift         pinned (round 79)
  //   760e0c8da PosScreen receipt settings       pinned (bffa33fd7)
  //   760e0c8da PosScreen course firing         pinned (14295df1a re-verified)
  //   1b0f0fb3a StockTransfersScreen.openDetail pinned (0900ba1eb, re-verified r117)
  //   1aead7518 usePosShifts                     pinned (5bbef0162)
  //   116803906 RetailPosScreen shift            pinned (14295df1a)
  //   eee76b542 RetailPosScreen currency         pinned (4ccb51020)
  //   ac8910736 EmailReportSettings SMTP         pinned (fbf28503d)
  //   e19e412e4 useKdsPreferences localStorage   pinned (e139c2135)
  //   bb279c34d ExchangeRateScreen rate-sync      DEAD END, recorded in place
  //
  // The one dead end is honest rather than open: three attempts survived, the
  // reconciliation failure is written up at its guard, and the next step there is to
  // read the state transition directly instead of inferring it from the DOM.
  //
  // IF YOU WRITE A NEW ONE, the test must make the stale read resolve with
  // DISTINCTLY DIFFERENT values. Returning the same ones makes the test pass with
  // the guard REMOVED -- that cost two mutations each in Currency and Settings.
  //
  // ALSO MEASURED ACROSS THIS CAMPAIGN, because each cost a round: a mock that
  // captures the token BY VALUE rather than through a getter never sees a switch; a
  // test that leaves the token mutated makes the next case's switch a silent NO-OP;
  // and a read mocked once is consumed by the first call, so the token-switch
  // re-issue falls through to the default. All three make a test pass without racing
  // anything.
  //
  // A gate was attempted and deliberately NOT shipped: scanning ui/src for the
  // shape reports 41 sites, most of them false positives (a `setInterval` inside a
  // poll, a store switcher's own setter), and a gate that over-reports gets
  // disabled. The sibling verify-settled-read-copies.py stops the READ verdict
  // being re-declared because that shape is exact; this one is not. Deciding which
  // of the 41 overlap and matter is a human reading what the written value drives.
  //
  // `loadAll` depends on sessionToken, so the initial-load effect below re-runs
  // on every STORE SWITCH and those reads overlap. `mountedRef` only guards
  // unmount -- it stays true across a switch -- so a slower read from the previous
  // store could land afterwards and overwrite the current store's settings:
  // receipt format, tax configuration and CURRENCY among them.
  //
  // This is the same defect CurrencyContext.refresh had (51c86e9e8), on a wider
  // surface. Bumping on unmount also retires any read still in flight when the
  // provider goes away.
  const loadSeq = useRef(0);

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

    // Same invalidation as loadScoped: `loadAll` depends on sessionToken, so a
    // store switch starts a second one while the first is in flight, and
    // allSettled only guarantees the WRITES are batched -- not that they belong to
    // the store that is still active when they land.
    const seq = ++loadSeq.current;
    const stale = () => loadSeq.current !== seq;

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
      // A store switch during this load supersedes it entirely: applying any part
      // of it would mix two stores' receipt, tax and currency settings.
      if (stale()) return;
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
    // Only this load may write: a store switch invalidates every earlier one.
    const seq = ++loadSeq.current;
    const stale = () => loadSeq.current !== seq;
    const tasks: Array<Promise<unknown>> = [];

    if (scopes.has('receipt')) {
      tasks.push(
        getReceiptSettingsScoped(sessionToken).then((v) => {
          if (stale()) return;
          if (!v) return;
          setSettings((prev) => ({ ...prev, receipt: v }));
        }),
      );
    }
    if (scopes.has('store')) {
      tasks.push(
        getStoreSettingsScoped(sessionToken).then((v) => {
          if (stale()) return;
          if (!v) return;
          setSettings((prev) => ({ ...prev, store: v }));
        }),
      );
    }
    if (scopes.has('currencies')) {
      tasks.push(
        listCurrenciesScoped(sessionToken).then((v) => {
          if (stale()) return;
          if (!v) return;
          setSettings((prev) => ({ ...prev, currencies: v }));
        }),
      );
    }
    if (scopes.has('sync')) {
      tasks.push(
        getSyncSettingsScoped(sessionToken).then((v) => {
          if (stale()) return;
          if (!v) return;
          setSettings((prev) => ({ ...prev, sync: withSyncDefaults(v) }));
        }),
      );
    }
    if (scopes.has('preferences')) {
      tasks.push(
        getUserPreferencesScoped(sessionToken).then((p) => {
          if (stale()) return;
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
          if (stale()) return;
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
          if (stale()) return;
          if (!v) return;
          setSettings((prev) => ({ ...prev, appVersion: v.version }));
        }),
      );
    }

    await Promise.allSettled(tasks);
    // A superseded load must not clear the CURRENT load's spinner -- that is how a
    // stale write made itself visible in the first place.
    if (mountedRef.current && !stale()) setLoading(false);
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
      // Retire any load still in flight: `mountedRef` guards the effect body but
      // not a `loadAll`/`loadScoped` that has already awaited past it.
      loadSeq.current += 1;
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
