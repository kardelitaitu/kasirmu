// Kitchen zone extraction and the board filter — NOW IMPORTING production
// (2026-10-07), where this file previously retyped both.
//
// It was one of five KDS suites with that property; see the header of
// KdsSettingsConversions.test.ts for the full sweep. The rewiring did two
// things beyond deleting three local copies:
//   1. the cases below now fail when kdsOrderView.ts moves — verified by
//      mutation (removing the sort fails 2 cases);
//   2. it made the three-way PRECEDENCE testable for the first time. The copies
//      tested the two filter branches as independent functions, so nothing could
//      observe which wins when both are active. Applying both in sequence is a
//      plausible refactor and a behaviour change; that case now fails it.
//
// extractZones / filterKdsOrders live in features/kds/kdsOrderView.ts, extracted
// verbatim from KdsScreen.tsx:303-309 and :312-318.

import { describe, it, expect } from 'vitest';
import type { KdsOrder } from '@/api/kds';

function order(overrides: Partial<KdsOrder> = {}): KdsOrder {
  return {
    id: '1',
    sale_id: 'sale-1',
    store_id: 'store-1',
    target_instance_id: null,
    status: 'preparing',
    items_summary: '',
    item_count: 0,
    display_number: null,
    received_at: '',
    started_at: null,
    ready_at: null,
    served_at: null,
    prep_time_seconds: 0,
    kitchen_zone: null,
    notes: '',
    table_number: null,
    priority: false,
    ...overrides,
  };
}

// The implementations are IMPORTED now, not retyped. This file used to restate
// extractZones / filterByZones / filterByStatus, and its own comments said so
// ("Same zone extraction logic as KdsScreen.tsx useMemo"). A copy cannot fail
// when production moves, and — more importantly — the copies tested the two
// BRANCHES and never the PRECEDENCE between them. Both gaps are closed by
// importing: the dispatch below is the screen's own code path.
import { extractZones, filterKdsOrders } from '@/features/kds/kdsOrderView';

/** The old zone-filter helper, expressed through the real dispatcher so the
 *  cases below keep their shape while exercising production's precedence. */
function filterByZones(orders: KdsOrder[], zones: Set<string>): KdsOrder[] {
  return filterKdsOrders(orders, 'all', zones);
}

/** The old status helper, likewise: 'prepared' IS the ready-status branch. */
function filterByStatus(orders: KdsOrder[]): KdsOrder[] {
  return filterKdsOrders(orders, 'prepared', null);
}

describe('extractZones', () => {
  it('returns empty array for no orders', () => {
    expect(extractZones([])).toEqual([]);
  });

  it('returns empty array when all zones are null', () => {
    expect(extractZones([order(), order()])).toEqual([]);
  });

  it('extracts unique zones', () => {
    const orders = [
      order({ kitchen_zone: 'front' }),
      order({ kitchen_zone: 'back' }),
      order({ kitchen_zone: 'front' }),
    ];
    expect(extractZones(orders)).toEqual(['back', 'front']);
  });

  it('returns sorted zones', () => {
    const orders = [
      order({ kitchen_zone: 'grill' }),
      order({ kitchen_zone: 'bar' }),
      order({ kitchen_zone: 'pastry' }),
    ];
    expect(extractZones(orders)).toEqual(['bar', 'grill', 'pastry']);
  });

  it('handles single zone', () => {
    expect(extractZones([order({ kitchen_zone: 'front' })])).toEqual(['front']);
  });
});

describe('filterByZones', () => {
  it('returns all orders when zone set is empty', () => {
    const orders = [order({ kitchen_zone: 'front' }), order({ kitchen_zone: 'back' })];
    expect(filterByZones(orders, new Set())).toEqual(orders);
  });

  it('filters by single zone', () => {
    const orders = [
      order({ id: '1', kitchen_zone: 'front' }),
      order({ id: '2', kitchen_zone: 'back' }),
      order({ id: '3', kitchen_zone: 'front' }),
    ];
    const result = filterByZones(orders, new Set(['front']));
    expect(result).toHaveLength(2);
    expect(result.every((o) => o.kitchen_zone === 'front')).toBe(true);
  });

  it('filters by multiple zones', () => {
    const orders = [
      order({ id: '1', kitchen_zone: 'front' }),
      order({ id: '2', kitchen_zone: 'back' }),
      order({ id: '3', kitchen_zone: 'bar' }),
    ];
    const result = filterByZones(orders, new Set(['front', 'bar']));
    expect(result).toHaveLength(2);
  });

  it('excludes orders with null zone', () => {
    const orders = [
      order({ id: '1', kitchen_zone: 'front' }),
      order({ id: '2', kitchen_zone: null }),
    ];
    const result = filterByZones(orders, new Set(['front']));
    expect(result).toHaveLength(1);
  });
});

describe('filterByStatus', () => {
  it('filters orders by status', () => {
    const orders = [
      order({ id: '1', status: 'ready' }),
      order({ id: '2', status: 'preparing' }),
      order({ id: '3', status: 'ready' }),
    ];
    const result = filterByStatus(orders);
    expect(result).toHaveLength(2);
    expect(result.every((o) => o.status === 'ready')).toBe(true);
  });

  it('returns empty for non-matching status', () => {
    // filterByStatus is now the real 'prepared' dispatch (ready only), so a
    // pending order is excluded by the production rule rather than by a
    // status string this test passed in.
    expect(filterByStatus([order({ status: 'pending' })])).toEqual([]);
  });
});

// ── The three-way PRECEDENCE ──────────────────────────────────────────────
// New 2026-10-07, and the reason this file was worth rewiring rather than just
// re-importing. The retyped helpers tested the two filter branches as separate
// functions, so nothing could observe which one WINS when both are active. The
// screen's own dispatcher decides that, and these cases pin the order.
describe('filterKdsOrders — precedence', () => {
  const readyGrill = order({ id: 'a', status: 'ready', kitchen_zone: 'grill' });
  const prepGrill = order({ id: 'b', status: 'preparing', kitchen_zone: 'grill' });
  const readyFry = order({ id: 'c', status: 'ready', kitchen_zone: 'fry' });
  const all = [readyGrill, prepGrill, readyFry];

  it("'prepared' WINS over a non-empty zone set", () => {
    // Both filters are satisfiable, and only one may apply. If a refactor
    // applied them in sequence this returns [] (ready AND fry) instead of the
    // two ready orders — the exact bug the copies could not see.
    const out = filterKdsOrders(all, 'prepared', new Set(['fry']));
    expect(out.map((o) => o.id)).toEqual(['a', 'c']);
  });

  it("'all' with no zone filter returns everything, unchanged", () => {
    expect(filterKdsOrders(all, 'all', null)).toBe(all);
    expect(filterKdsOrders(all, 'all', new Set())).toBe(all);
  });

  it("'all' with a zone filter narrows to that zone", () => {
    const out = filterKdsOrders(all, 'all', new Set(['grill']));
    expect(out.map((o) => o.id)).toEqual(['a', 'b']);
  });

  it('an order with no zone never matches a zone filter', () => {
    const zoneless = order({ id: 'd', status: 'ready', kitchen_zone: null });
    expect(filterKdsOrders([zoneless], 'all', new Set(['grill']))).toEqual([]);
  });

  it("'prepared' with no zone filter keeps only ready orders", () => {
    expect(filterKdsOrders(all, 'prepared', null).map((o) => o.id)).toEqual(['a', 'c']);
  });
});
