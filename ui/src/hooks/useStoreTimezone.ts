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
// WHY A HOOK: the call sites were each hand-rolling the same `useState` + effect
// + `alive` guard + silent `.catch`, and a copy is free to drift — one screen had
// already shipped a UTC-anchored window behind a correct-looking fetch. A second
// reason shows up the moment two tiles mount together: each one issues its own
// `get_primary_location_scoped`, so one dashboard load made THREE identical calls
// for one answer (measured).
//
// Callers get `string | null`, which is the honest "not known yet" — the session
// has no token, the profile is still loading, or the fetch failed. All three are the
// same state to a caller: pass it to `isoToday` / `isoDaysAgo` / `storeOffsetMs`, which
// treat `null` as FALLBACK_STORE_TZ rather than as "use the device".

import { useState, useEffect } from 'react';
import { getPrimaryLocationScoped } from '@/api/locations';
import { useWorkspace } from '@/contexts/WorkspaceContext';

// ── In-flight dedupe, dropped the moment it settles ──────────────────
//
// Keyed by session token so two sessions never share an answer. The entry is
// DELETED ON SETTLE rather than kept as a value cache, and that is the whole
// design: a longer-lived cache would keep serving the PREVIOUS store's offset
// after a store switch, which is a worse bug than the redundant call it saves.
// Settle-and-drop also leaves nothing for a test to leak into its neighbour — a
// cached value would silently outlive a `vi.clearAllMocks()` and make the
// anchoring assertions order-dependent.
const IN_FLIGHT = new Map<string, Promise<string | null>>();

// WHY IN-FLIGHT ONLY, AND NOT A VALUE CACHE:
//
// Dropping the entry on settle is what stops an answer outliving a store switch.
// It also means a caller whose effect runs a tick LATE — a lazily-loaded tile, a
// screen mounted after the profile already arrived — finds the map empty and
// starts a second request for an answer that exists. That is acceptable, and
// deliberately so:
//
//   (a) the late caller still gets the RIGHT value, it just costs one request, and
//   (b) there is no persistent cache to go stale in the meantime.
//
// So the map is an OPTIMISATION and correctness never depends on it. Holding the
// resolved value for a tick would close that gap, but one tick is not a duration we
// can promise to reason about across every React scheduler, and the failure mode of
// getting it wrong is a stale offset — the exact defect class this whole file
// exists to remove. Invisibility when missed beats a correctness hazard when wrong.
//
// The case it DOES cover is the one that measurably happens: siblings that mount
// together (the three canvas tiles on a dashboard load) share the map entry. A probe
// counted three identical get_primary_location_scoped calls for one answer on
// SalesDashboardScreen before this change, and one after.

/**
 * The primary store's fixed UTC offset (e.g. `'+07:00'`), or `null` while it is
 * unknown. All three unknown cases are the same to a caller, and the hook does not
 * pretend otherwise by caching a device-derived value: a cache filled from the
 * host would reintroduce the exact defect this exists to remove.
 *
 * `explicitToken` is for the callers that already hold one — useAnalyticsFilters
 * receives it as an argument and has no reason to read the context again. Omit it
 * to let the hook read the workspace token itself.
 */
export function useStoreTimezone(explicitToken?: string | null): string | null {
  const { sessionToken: workspaceToken } = useWorkspace();
  // `undefined` means "no token was handed in, read the context"; an explicit
  // `null` means "this caller has no session", which is the state that SKIPS the
  // fetch. Collapsing the two would make a caller that deliberately passes null
  // quietly start issuing a request anyway.
  const sessionToken =
    explicitToken === undefined ? workspaceToken ?? '' : explicitToken ?? '';
  const [storeTz, setStoreTz] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionToken) return;
    let alive = true;
    let pending = IN_FLIGHT.get(sessionToken);
    if (!pending) {
      pending = getPrimaryLocationScoped(sessionToken)
        .then((p) => p?.timezone ?? null)
        .finally(() => { IN_FLIGHT.delete(sessionToken); });
      IN_FLIGHT.set(sessionToken, pending);
    }
    pending
      .then((tz) => { if (alive) setStoreTz(tz); })
      .catch(() => { /* storeTz stays null, so callers use FALLBACK_STORE_TZ */ });
    return () => { alive = false; };
  }, [sessionToken]);

  return storeTz;
}
