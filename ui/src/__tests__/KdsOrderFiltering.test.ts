// Unit tests for order filtering — the logic that filters KDS orders
// by store scope and excludes cancelled tickets from the active board.

import { describe, it, expect } from 'vitest';
import type { KdsOrder } from '@/api/kds';

function order(overrides: Partial<KdsOrder> = {}): KdsOrder {
  return {
    id: '1',
    sale_id: 'sale-1',
    store_id: null,
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

/** Same filtering logic as KdsScreen.tsx fetchOrders. */
function filterOrders(orders: KdsOrder[], activeStoreId: string | null): KdsOrder[] {
  let filtered = orders;
  if (activeStoreId) {
    filtered = filtered.filter((o) => !o.store_id || o.store_id === activeStoreId);
  }
  return filtered.filter((o) => o.status !== 'cancelled');
}

describe('filterOrders', () => {
  // ── Cancelled exclusion ─────────────────────────────────────────

  it('excludes cancelled orders', () => {
    const orders = [
      order({ id: '1', status: 'preparing' }),
      order({ id: '2', status: 'cancelled' }),
      order({ id: '3', status: 'ready' }),
    ];
    const result = filterOrders(orders, null);
    expect(result).toHaveLength(2);
    expect(result.map((o) => o.id)).toEqual(['1', '3']);
  });

  it('excludes all-cancelled input', () => {
    const orders = [order({ status: 'cancelled' }), order({ status: 'cancelled' })];
    expect(filterOrders(orders, null)).toEqual([]);
  });

  it('keeps non-cancelled statuses', () => {
    // `as const` so `s` is the KdsStatus union rather than widened `string`; order()
    // takes Partial<KdsOrder>, whose status field is KdsStatus.
    const statuses = ['pending', 'preparing', 'ready', 'served'] as const;
    const orders = statuses.map((s) => order({ status: s }));
    const result = filterOrders(orders, null);
    expect(result).toHaveLength(4);
  });

  // ── Store scope filtering ───────────────────────────────────────

  it('filters by active store ID', () => {
    const orders = [
      order({ id: '1', store_id: 'store-A' }),
      order({ id: '2', store_id: 'store-B' }),
      order({ id: '3', store_id: 'store-A' }),
    ];
    const result = filterOrders(orders, 'store-A');
    expect(result).toHaveLength(2);
    expect(result.every((o) => o.store_id === 'store-A')).toBe(true);
  });

  it('includes orders with null store_id when store filter is active', () => {
    const orders = [
      order({ id: '1', store_id: 'store-A' }),
      order({ id: '2', store_id: null }),
    ];
    const result = filterOrders(orders, 'store-A');
    expect(result).toHaveLength(2);
  });

  it('no store filter returns all non-cancelled', () => {
    const orders = [
      order({ id: '1', store_id: 'store-A' }),
      order({ id: '2', store_id: 'store-B' }),
    ];
    const result = filterOrders(orders, null);
    expect(result).toHaveLength(2);
  });

  it('store filter excludes mismatched store_id', () => {
    const orders = [
      order({ id: '1', store_id: 'store-A' }),
      order({ id: '2', store_id: 'store-B' }),
    ];
    const result = filterOrders(orders, 'store-A');
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('1');
  });

  // ── Combined filters ────────────────────────────────────────────

  it('applies both store filter and cancelled exclusion', () => {
    const orders = [
      order({ id: '1', store_id: 'store-A', status: 'preparing' }),
      order({ id: '2', store_id: 'store-A', status: 'cancelled' }),
      order({ id: '3', store_id: 'store-B', status: 'preparing' }),
      order({ id: '4', store_id: null, status: 'ready' }),
    ];
    const result = filterOrders(orders, 'store-A');
    // '1' passes (store-A + not cancelled)
    // '2' excluded (cancelled)
    // '3' excluded (store-B)
    // '4' passes (null store_id passes store filter + not cancelled)
    expect(result).toHaveLength(2);
    expect(result.map((o) => o.id)).toEqual(['1', '4']);
  });

  it('empty input returns empty', () => {
    expect(filterOrders([], 'store-A')).toEqual([]);
    expect(filterOrders([], null)).toEqual([]);
  });
});
