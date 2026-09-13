// Unit tests for kitchen zone extraction — the logic that extracts
// unique zones from orders and filters orders by zone/category.

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

/** Same zone extraction logic as KdsScreen.tsx useMemo. */
function extractZones(orders: KdsOrder[]): string[] {
  const zoneSet = new Set<string>();
  for (const o of orders) {
    if (o.kitchen_zone) zoneSet.add(o.kitchen_zone);
  }
  return [...zoneSet].sort();
}

/** Same filter logic as KdsScreen.tsx useMemo. */
function filterByZones(orders: KdsOrder[], zones: Set<string>): KdsOrder[] {
  if (zones.size === 0) return orders;
  return orders.filter((o) => o.kitchen_zone && zones.has(o.kitchen_zone));
}

function filterByStatus(orders: KdsOrder[], status: string): KdsOrder[] {
  return orders.filter((o) => o.status === status);
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
    const result = filterByStatus(orders, 'ready');
    expect(result).toHaveLength(2);
    expect(result.every((o) => o.status === 'ready')).toBe(true);
  });

  it('returns empty for non-matching status', () => {
    expect(filterByStatus([order({ status: 'pending' })], 'ready')).toEqual([]);
  });
});
