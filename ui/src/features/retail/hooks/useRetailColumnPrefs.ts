import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { getUserPreferencesScoped, setUserPreferencesScoped } from '@/api/settings';

/**
 * Retail grid column identifiers (ADR #36 D4). The Cost column is
 * deliberately NOT here — cost is only ever shown in edit surfaces.
 */
export const RETAIL_COLUMNS = [
  'sku',
  'barcode',
  'category',
  'brand',
  'name',
  'rack',
  'stock',
  'price',
  'notes',
] as const;

export type RetailColumn = (typeof RETAIL_COLUMNS)[number];

/** Columns visible by default: the classic retail grid keeps its core. */
export const RETAIL_COLUMN_DEFAULTS: readonly RetailColumn[] = [
  'sku',
  'stock',
  'name',
  'price',
];

export interface RetailColumnPrefs {
  /** Column ids to render, in display order (subset of RETAIL_COLUMNS). */
  visibleColumns: RetailColumn[];
  /** Hide retired (inactive) products from the grid. */
  hideInactive: boolean;
  /** Retail POS product-list view mode (spec 0046b §3.5). */
  viewMode: RetailViewMode;
}

/** Retail POS product-list view modes: text-only table or image grid. */
export type RetailViewMode = 'text' | 'grid';

const DEFAULTS: RetailColumnPrefs = {
  visibleColumns: [...RETAIL_COLUMN_DEFAULTS],
  hideInactive: false,
  viewMode: 'text',
};

const STORAGE_KEY_PREFIX = 'oz-retail-cols-';

/** Read retail column prefs from localStorage, or null if missing/invalid. */
function readLocalPrefs(userId: string): RetailColumnPrefs | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + userId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RetailColumnPrefs>;
    if (!Array.isArray(parsed.visibleColumns)) return null;
    const valid = parsed.visibleColumns.filter((c): c is RetailColumn =>
      (RETAIL_COLUMNS as readonly string[]).includes(c),
    );
    return {
      visibleColumns: valid.length > 0 ? valid : [...RETAIL_COLUMN_DEFAULTS],
      hideInactive: parsed.hideInactive === true,
      viewMode: parsed.viewMode === 'grid' ? 'grid' : 'text',
    };
  } catch {
    return null;
  }
}

/** Write retail column prefs to localStorage. */
function writeLocalPrefs(userId: string, prefs: RetailColumnPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + userId, JSON.stringify(prefs));
  } catch {
    // localStorage may be full or unavailable
  }
}

/**
 * Per-user retail grid column visibility + hide-inactive toggle.
 *
 * Same persistence pattern as `useKdsPreferences` (ADR #36 D4): restore
 * instantly from localStorage, merge with the server copy via the existing
 * `user_preferences` API, write-through on every change.
 */
export function useRetailColumnPrefs(): {
  prefs: RetailColumnPrefs;
  toggleColumn: (col: RetailColumn) => void;
  setHideInactive: (hide: boolean) => void;
  setViewMode: (mode: RetailViewMode) => void;
  loading: boolean;
} {
  const { session } = useAuth();
  const { sessionToken } = useWorkspace();
  const userId = session?.user_id ?? '';

  const [prefs, setPrefs] = useState<RetailColumnPrefs>(
    () => (userId ? readLocalPrefs(userId) ?? DEFAULTS : DEFAULTS),
  );
  const [loading, setLoading] = useState(true);

  // Guarded. Deps name userId and sessionToken, so a store switch starts a second read
  // while the first is in flight, and a slower earlier one lands last. Same class as
  // CurrencyContext (51c86e9e8) through useKdsPreferences (e19e412e4); the whole class is
  // written up in SettingsContext:207.
  //
  // THE CONSEQUENCE IS PERSISTED, which is why this is guarded rather than noted: the
  // success path calls writeLocalPrefs(userId, serverPrefs) as well as setPrefs. A stale
  // read therefore does not merely display the previous store's columns -- it writes them
  // into localStorage under the current user, where they survive a reload and are read
  // back on the next mount BEFORE the server answers (this file's own readLocalPrefs is
  // the instant-restore source at :100). Display-only stale state self-corrects; this
  // does not, and this is the second instance of that shape after useKdsPreferences.
  const prefsSeqRef = useRef(0);
  useEffect(() => {
    if (!userId || !sessionToken) {
      setLoading(false);
      return;
    }
    const seq = ++prefsSeqRef.current;
    const stale = () => prefsSeqRef.current !== seq;
    getUserPreferencesScoped(sessionToken)
      .then((raw) => {
        const serverPrefs: RetailColumnPrefs = {
          visibleColumns: parseColumns(raw['retail_visible_columns']),
          hideInactive: raw['retail_hide_inactive'] === 'true',
          viewMode: raw['retail_view_mode'] === 'grid' ? 'grid' : 'text',
        };
        if (stale()) return;
        setPrefs(serverPrefs);
        writeLocalPrefs(userId, serverPrefs);
      })
      .catch(() => {
        // Server unavailable — keep localStorage defaults (already set).
      })
      .finally(() => setLoading(false));
  }, [userId, sessionToken]);

  const persist = useCallback(
    (patch: Partial<Record<string, string>>) => {
      if (!userId || !sessionToken) return;
      const entries = Object.entries(patch).map(([key, value]) => ({
        key,
        value: value ?? '',
      }));
      setUserPreferencesScoped(sessionToken, entries).catch(() => {
        // Server persistence is best-effort; localStorage already saved.
      });
    },
    [userId, sessionToken],
  );

  const toggleColumn = useCallback(
    (col: RetailColumn) => {
      setPrefs((p) => {
        const visible = p.visibleColumns.includes(col);
        const next: RetailColumnPrefs = {
          ...p,
          visibleColumns: visible
            ? p.visibleColumns.filter((c) => c !== col)
            : [...p.visibleColumns, col],
        };
        writeLocalPrefs(userId, next);
        // Persist the whole column set (single pref key).
        persist({ retail_visible_columns: JSON.stringify(next.visibleColumns) });
        return next;
      });
    },
    [userId, persist],
  );

  const setHideInactive = useCallback(
    (hide: boolean) => {
      setPrefs((p) => {
        const next = { ...p, hideInactive: hide };
        writeLocalPrefs(userId, next);
        return next;
      });
      persist({ retail_hide_inactive: String(hide) });
    },
    [userId, persist],
  );

  const setViewMode = useCallback(
    (mode: RetailViewMode) => {
      setPrefs((p) => {
        const next = { ...p, viewMode: mode };
        writeLocalPrefs(userId, next);
        return next;
      });
      persist({ retail_view_mode: mode });
    },
    [userId, persist],
  );

  return { prefs, toggleColumn, setHideInactive, setViewMode, loading };
}

/** Parse the stored JSON column array, falling back to defaults. */
function parseColumns(raw: string | undefined): RetailColumn[] {
  if (!raw) return [...RETAIL_COLUMN_DEFAULTS];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...RETAIL_COLUMN_DEFAULTS];
    const valid = parsed.filter(
      (c): c is RetailColumn =>
        typeof c === 'string' &&
        (RETAIL_COLUMNS as readonly string[]).includes(c),
    );
    return valid.length > 0 ? valid : [...RETAIL_COLUMN_DEFAULTS];
  } catch {
    return [...RETAIL_COLUMN_DEFAULTS];
  }
}
