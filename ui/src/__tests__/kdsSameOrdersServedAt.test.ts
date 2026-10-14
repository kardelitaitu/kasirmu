// ── `sameOrders` must not call two boards equal when a RENDERED field moved ──
//
// `sameOrders` is the PERF-KDS-01 guard: `kds:orders-changed` fires for every write
// anywhere in the order pipeline, so a refetch that returns the same board must not
// replace state, or every ticket card re-renders (each with a 1 Hz SLA timer and a
// line-item fetch). Both boards apply it as `sameOrders(prev, next) ? prev : next`
// (KdsScreen.tsx:181, ExpoScreen.tsx:195).
//
// The guard is a SHALLOW, field-by-field comparison, so its correctness is exactly its
// field list: any field the boards RENDER but the comparator does not compare becomes an
// update the board silently drops. `KdsOrder` has 17 fields; the comparator names 10.
//
// `served_at` is the one that bites. It is rendered in three places:
//
//   ExpoScreen.recallCandidates   filters served tickets by the recall window and
//                                 SORTS them newest-first by `served_at` (:132-134)
//   KdsCompletedView              completion time and day offset (:151, :225)
//   minutesSinceServed            its clock reference (:116)
//
// So a refetch in which ONLY `served_at` changed (a ticket bumped at the pass) produced
// `sameOrders === true`, state was not replaced, and the Expo recall strip kept the old
// ordering until something else about a ticket moved.

import { describe, it, expect } from 'vitest';
import { sameOrders } from '@/features/kds/kdsOrdersDiff';
import type { KdsOrder } from '@/api/kds';

/** A complete-enough ticket; every field the comparator reads is present. */
function order(over: Partial<KdsOrder> = {}): KdsOrder {
  return {
    id: 'o1',
    sale_id: 's1',
    store_id: 'store-1',
    status: 'ready',
    items_summary: '2x Nasi Goreng',
    item_count: 2,
    display_number: 7,
    received_at: '2026-10-13T10:00:00.000Z',
    started_at: '2026-10-13T10:01:00.000Z',
    ready_at: '2026-10-13T10:05:00.000Z',
    served_at: '2026-10-13T10:06:00.000Z',
    prep_time_seconds: 240,
    kitchen_zone: 'front',
    notes: '',
    table_number: 'T5',
    priority: false,
    ...over,
  } as KdsOrder;
}

describe('sameOrders sees a change in a field the boards render', () => {
  it('a bare served_at move makes the boards different', () => {
    const before = [order({ served_at: '2026-10-13T10:06:00.000Z' })];
    const after = [order({ served_at: '2026-10-13T10:09:00.000Z' })];
    expect(
      sameOrders(before, after),
      'served_at orders the Expo recall strip; treating these as the same board ' +
        'leaves that strip stale until another field happens to move.',
    ).toBe(false);
  });

  it('a null -> timestamp transition is a change, not a no-op', () => {
    // The transition the recall strip exists for: a ready ticket becomes served.
    // `status` also moves here, so this case alone would pass even with served_at
    // uncompared -- it is the CONTROL for the case above.
    const before = [order({ status: 'ready', served_at: null })];
    const after = [order({ status: 'served', served_at: '2026-10-13T10:09:00.000Z' })];
    expect(sameOrders(before, after)).toBe(false);
  });

  it('still reports two genuinely identical boards as the same', () => {
    // The check must not become always-false, or PERF-KDS-01 is gone.
    expect(sameOrders([order()], [order()])).toBe(true);
    expect(sameOrders([], [])).toBe(true);
  });

  // ── The fields NOT compared, and why each is safe to omit ──
  //
  // The comparator's correctness IS its field list, so the omissions were checked rather
  // than inherited. `KdsOrder` has 17 fields; 11 are compared after round 87 added
  // `served_at`. The six uncompared ones, each read on this board:
  //
  //   store_id            FILTERED before the compare, never rendered. A change moves
  //                       which orders are in the array, which the length/element walk
  //                       already catches; a change that keeps the same filtered set is
  //                       a genuine no-op for the board.
  //   sale_id             no reader under features/kds.
  //   target_instance_id  no reader under features/kds.
  //   started_at          one reader, KdsScreen.tsx:281, in a COMMENT about backend
  //                       replay -- not rendered.
  //   ready_at            no reader under features/kds.
  //   prep_time_seconds   no reader under features/kds.
  //
  // If any of these gains a render site, add it here and to the comparator. That is the
  // rule this case exists to make visible.
  it('still catches every field it already compared', () => {
    const base = order();
    const movers: Array<[string, Partial<KdsOrder>]> = [
      ['status', { status: 'served' }],
      ['items_summary', { items_summary: '3x Nasi Goreng' }],
      ['item_count', { item_count: 3 }],
      ['display_number', { display_number: 8 }],
      ['received_at', { received_at: '2026-10-13T09:00:00.000Z' }],
      ['kitchen_zone', { kitchen_zone: 'back' }],
      ['table_number', { table_number: 'T6' }],
      ['notes', { notes: 'no chilli' }],
      ['priority', { priority: true }],
      ['id', { id: 'o2' }],
    ];
    for (const [field, patch] of movers) {
      expect(sameOrders([base], [order(patch)]), field + ' must be compared').toBe(false);
    }
  });
});
