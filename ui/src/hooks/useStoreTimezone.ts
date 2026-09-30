// ── useStoreTimezone — the primary store's REP-03 calendar anchor ──
//
// Every report surface buckets days by the STORE's UTC offset, never the device's
// (REP-03). The backend enforces it: `Store::daily_revenue` runs
// `DATE(s1.created_at, ?3)` with `tz_modifier()`, pinned by
// `daily_revenue_buckets_by_store_timezone` in
// crates/kasirmu-core/src/db/reports_tests.rs:2473 — a sale at 23:30Z belongs to
// the NEXT day for a +01:00 store. `hourly_heatmap` shifts its hour column the
// same way, and `weekly_revenue` shifts its Monday week key.
//
// So a UI that asks for "the last 14 days" must also say WHICH 14 days. Reading
// `new Date().toISOString().slice(0, 10)` yields the UTC day, and for any store
// that has already crossed midnight it is a window ending YESTERDAY: the tile
// silently omits the store's current trading day — the day a manager opens the
// dashboard to read. Measured at 2026-09-04T21:30Z, a +07:00 store's today is
// 2026-09-05 while the UTC-anchored window ends 2026-09-04; +09:00 misses it too,
// and -05:00/-08:00 agree only because UTC has not moved on yet.
//
// This hook exists so the call sites stop hand-rolling the fetch. Each one had the
// same `useState` + effect + `alive` guard + silent `.catch` written out separately,
// and a copy is free to drift: DashboardScreen, useAnalyticsFilters, KdsCompletedView,
// ExchangeRateScreen, CustomReportScreen, SalesReportScreen and MenuEngineeringScreen
// all call `getPrimaryLocationScoped` and each keeps its own copy of this block.
//
// Callers get `string | null`, which is the honest "not known yet" — the session
// has no token, the profile is still loading, or the fetch failed. All three are the
// same state to a caller: pass it to `isoToday` / `isoDaysAgo` / `storeOffsetMs`, which
// treat `null` as FALLBACK_STORE_TZ rather than as "use the device".

import { useState, useEffect } from 'react';
import { getPrimaryLocationScoped } from '@/api/locations';
import { useWorkspace } from '@/contexts/WorkspaceContext';

/**
 * The primary store's fixed UTC offset (e.g. `'+07:00'`), or `null` while it is
 * unknown. All three unknown cases are the same to a caller, and the hook does not
 * pretend otherwise by caching a device-derived value: a cache filled from the
 * host would reintroduce the exact defect this exists to remove.
 */
export function useStoreTimezone(): string | null {
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';
  const [storeTz, setStoreTz] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionToken) return;
    let alive = true;
    getPrimaryLocationScoped(sessionToken)
      .then((p) => {
        if (alive) setStoreTz(p?.timezone ?? null);
      })
      .catch(() => {
        /* storeTz stays null, so callers use FALLBACK_STORE_TZ */
      });
    return () => {
      alive = false;
    };
  }, [sessionToken]);

  return storeTz;
}
