/**
 * KDS order shaping — the zone list the chips are built from, and the filter
 * that decides which orders reach the board.
 *
 * WHY THIS FILE EXISTS. Both expressions lived inline in KdsScreen.tsx (:303-309
 * and :312-318) and __tests__/KdsZoneExtraction.test.ts retyped them as
 * extractZones / filterByZones / filterByStatus, because production had no name
 * to import. The same reasoning already recorded for the SLA clamps
 * (useTicketSla.ts:66-90), the minute thresholds (kdsThresholdMinutes.ts) and the
 * density arithmetic (kdsDensity.ts): a retyped copy is invisible to a
 * name-matching detector because there is no name to collide with, and only
 * naming the expression makes it testable.
 *
 * WHAT THE COPIES NEVER COVERED, and the reason this is worth more than the
 * three unit conversions it replaces: the copies tested the BRANCHES and never
 * the PRECEDENCE. filterMode 'prepared' beats a non-empty filterCats set, and
 * with neither the board shows everything — a three-way dispatch that existed
 * only inside the memo. Applying both filters independently is a plausible and
 * wrong refactor, and until now no test could see the difference.
 */
import type { KdsOrder } from '@/api/kds';

/** Which board tab the filter is serving. */
export type KdsFilterMode = 'all' | 'prepared';

/**
 * The distinct kitchen zones present in \`orders\`, sorted.
 *
 * Orders with no zone are skipped rather than collected under a null key, so the
 * result is a plain string[] the chip row can map over. The sort is the default
 * one (UTF-16 code-unit order), which is what a Set-then-spread needed to be
 * made deterministic — it is not a locale-aware collation.
 */
export function extractZones(orders: KdsOrder[]): string[] {
  const zoneSet = new Set<string>();
  for (const order of orders) {
    if (order.kitchen_zone) zoneSet.add(order.kitchen_zone);
  }
  return [...zoneSet].sort();
}

/**
 * The orders the board shows, given the active tab and the zone filter.
 *
 * Precedence, in order: 'prepared' returns only ready orders and IGNORES the zone
 * filter; otherwise a non-empty zone set filters by zone; otherwise everything is
 * returned. \`filterCats === null\` and an empty set both mean "no zone filter".
 */
export function filterKdsOrders(
  orders: KdsOrder[],
  filterMode: KdsFilterMode,
  filterCats: Set<string> | null,
): KdsOrder[] {
  if (filterMode === 'prepared') return orders.filter((o) => o.status === 'ready');
  if (filterCats && filterCats.size > 0) {
    return orders.filter((o) => o.kitchen_zone && filterCats.has(o.kitchen_zone));
  }
  return orders;
}

/**
 * Whether the board is showing a narrowed view — the flag the empty state and the
 * "N filtered" affordance read.
 *
 * Extracted from KdsScreen.tsx:393-395 AS OF f68cb3e16^ — those numbers now
 * hold the extracted call itself, so read them as the ORIGINAL range, not as a
 * pointer. The completed branch reads a
 * different source (\`completedFilter\`) and only the open branch consults these two.
 */
export function isBoardFiltered(
  filterMode: KdsFilterMode,
  filterCats: Set<string> | null,
): boolean {
  return filterMode === 'prepared' || (filterCats !== null && filterCats.size > 0);
}

/**
 * Narrow a fetched batch to the active store and drop cancelled tickets.
 *
 * Extracted from KdsScreen.tsx:154-162 AS OF df585537d^ (as with the note above,
 * the current lines hold the call, not the original code). It lived inside
 * fetchOrders — a useCallback with
 * I/O either side, which is why the retyped copy in KdsOrderFiltering.test.ts
 * restated it instead of importing anything. The two rules it encodes are not
 * incidental:
 *   - STORE SCOPE is permissive about a missing id: an order with `store_id: null`
 *     is kept, because null means "not store-bound" rather than "another store".
 *     Reading it as strict equality would silently hide unscoped tickets.
 *   - CANCELLED is terminal: a cancelled ticket is history and must never reach
 *     the active board. That drop is unconditional and applies after the scope
 *     filter, so it cannot be skipped by a store that fails to match.
 *
 * Pure: no refs, no async, no side effects. The caller still owns the fetch, the
 * arrival-animation bookkeeping and the cache flag.
 */
export function filterKdsOrdersByScope(
  orders: KdsOrder[],
  activeStoreId: string | null | undefined,
): KdsOrder[] {
  let filtered = orders;
  if (activeStoreId) {
    filtered = filtered.filter((o) => !o.store_id || o.store_id === activeStoreId);
  }
  return filtered.filter((o) => o.status !== 'cancelled');
}
