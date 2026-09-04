import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { getUserPreferencesScoped, setUserPreferencesScoped } from '@/api/settings';

export type KdsLayout = 'kanban' | 'focus' | 'metro';

export interface KdsPreferences {
  layout: KdsLayout;
  showOrderId: boolean;
  showTableNumber: boolean;
  /** Kitchen zone filter (empty string = no zone / all orders). */
  kdsZone: string;
  /** Auto-advance pending tickets to preparing after a configurable delay. */
  autoAcknowledge: boolean;
  /** Delay in minutes before a pending ticket is auto-advanced. */
  acknowledgeDelayMin: number;
}

const DEFAULTS: KdsPreferences = {
  layout: 'kanban',
  showOrderId: true,
  showTableNumber: true,
  kdsZone: '',
  autoAcknowledge: false,
  acknowledgeDelayMin: 2,
};

/**
 * Exported for testing. KdsPreferencesReadLocalPrefs.test.ts declared its own copy -- and
 * unlike a copied function, a copied storage key fails in the least visible way possible:
 * the test writes and reads through its own constant, so it stays green forever while
 * production reads a different key. It survives a rename of the real value with nothing to
 * catch it, because both sides of the assertion come from the same copy.
 */
export const STORAGE_KEY_PREFIX = 'oz-kds-prefs-';

/**
 * Read KDS preferences from localStorage, or null if missing/invalid.
 *
 * Exported for testing. It was module-private, and rather than export it the first suite
 * that covered it (KdsPreferencesReadLocalPrefs.test.ts) copied the body into the test file
 * and asserted against the copy -- so all ten of its "contract" tests passed while exercising
 * no production code at all. The copy is already different from this function: it enumerates
 * six `?? default` fields, whereas the real one returns `{ ...DEFAULTS, ...parsed }` and so
 * lets any unknown stored key through into the result. That gap is invisible today and turns
 * into a silent divergence the first time KdsPreferences gains a seventh field, because
 * DEFAULTS grows and a hand-written copy does not.
 */
export function readLocalPrefs(userId: string): KdsPreferences | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + userId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<KdsPreferences>;
    // Validate — ensure all required fields are present.
    if (!parsed.layout || !['kanban', 'focus', 'metro'].includes(parsed.layout)) return null;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return null;
  }
}

/** Write KDS preferences to localStorage. Exported for testing. */
export function writeLocalPrefs(userId: string, prefs: KdsPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + userId, JSON.stringify(prefs));
  } catch {
    // localStorage may be full or unavailable
  }
}

export function useKdsPreferences(): {
  prefs: KdsPreferences;
  setLayout: (layout: KdsLayout) => void;
  setShowOrderId: (show: boolean) => void;
  setShowTableNumber: (show: boolean) => void;
  setKdsZone: (zone: string) => void;
  setAutoAcknowledge: (enabled: boolean) => void;
  setAcknowledgeDelay: (min: number) => void;
  loading: boolean;
} {
  const { session } = useAuth();
  const { sessionToken } = useWorkspace();
  const userId = session?.user_id ?? '';

  // Initialize from localStorage first (instant restore), fall back to defaults.
  const [prefs, setPrefs] = useState<KdsPreferences>(
    () => (userId ? readLocalPrefs(userId) ?? DEFAULTS : DEFAULTS),
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    // Fetch from server and merge.
    if (!sessionToken) {
      setLoading(false);
      return;
    }
    getUserPreferencesScoped(sessionToken)
      .then((raw) => {
        const serverPrefs: KdsPreferences = {
          layout: (raw['kds_layout'] as KdsLayout) || DEFAULTS.layout,
          showOrderId: raw['kds_show_order_id'] !== 'false',
          showTableNumber: raw['kds_show_table_number'] !== 'false',
          kdsZone: raw['kds_zone'] ?? DEFAULTS.kdsZone,
          autoAcknowledge: raw['kds_auto_acknowledge'] === 'true',
          acknowledgeDelayMin: Number(raw['kds_ack_delay_min']) || DEFAULTS.acknowledgeDelayMin,
        };
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
      // Scoped write must match the scoped read above: the unscoped
      // variant writes to the global DB while get_user_preferences_scoped
      // reads the store DB, so unscoped writes never survive a reload.
      setUserPreferencesScoped(sessionToken, entries).catch(() => {
        // Server persistence is best-effort; localStorage already saved.
      });
    },
    [userId, sessionToken],
  );

  const setLayout = useCallback(
    (layout: KdsLayout) => {
      setPrefs((p) => {
        const next = { ...p, layout };
        writeLocalPrefs(userId, next);
        return next;
      });
      persist({ kds_layout: layout });
    },
    [userId, persist],
  );

  const setShowOrderId = useCallback(
    (show: boolean) => {
      setPrefs((p) => {
        const next = { ...p, showOrderId: show };
        writeLocalPrefs(userId, next);
        return next;
      });
      persist({ kds_show_order_id: String(show) });
    },
    [userId, persist],
  );

  const setShowTableNumber = useCallback(
    (show: boolean) => {
      setPrefs((p) => {
        const next = { ...p, showTableNumber: show };
        writeLocalPrefs(userId, next);
        return next;
      });
      persist({ kds_show_table_number: String(show) });
    },
    [userId, persist],
  );

  const setKdsZone = useCallback(
    (zone: string) => {
      setPrefs((p) => {
        const next = { ...p, kdsZone: zone };
        writeLocalPrefs(userId, next);
        return next;
      });
      persist({ kds_zone: zone });
    },
    [userId, persist],
  );

  const setAutoAcknowledge = useCallback(
    (enabled: boolean) => {
      setPrefs((p) => {
        const next = { ...p, autoAcknowledge: enabled };
        writeLocalPrefs(userId, next);
        return next;
      });
      persist({ kds_auto_acknowledge: String(enabled) });
    },
    [userId, persist],
  );

  const setAcknowledgeDelay = useCallback(
    (min: number) => {
      const clamped = Math.max(1, Math.min(10, min));
      setPrefs((p) => {
        const next = { ...p, acknowledgeDelayMin: clamped };
        writeLocalPrefs(userId, next);
        return next;
      });
      persist({ kds_ack_delay_min: String(clamped) });
    },
    [userId, persist],
  );

  return { prefs, setLayout, setShowOrderId, setShowTableNumber, setKdsZone, setAutoAcknowledge, setAcknowledgeDelay, loading };
}
