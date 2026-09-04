// Unit tests for round-robin column distribution — the logic that
// distributes KDS orders evenly across N columns so no single column
// grows unboundedly.

import { describe, it, expect } from 'vitest';
import type { KdsOrder } from '@/api/kds';

/** Minimal order builder. */
function order(id: string): KdsOrder {
  return {
    id,
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
  };
}

/** Same round-robin logic as KdsLayoutMasonry useMemo. */
function distributeRoundRobin(orders: KdsOrder[], columnCount: number): KdsOrder[][] {
  const cols: KdsOrder[][] = Array.from({ length: columnCount }, () => []);
  orders.forEach((o, i) => {
    cols[i % columnCount]!.push(o);
  });
  return cols;
}

describe('distributeRoundRobin', () => {
  it('distributes empty array into empty columns', () => {
    const cols = distributeRoundRobin([], 3);
    expect(cols).toHaveLength(3);
    expect(cols.every((c) => c.length === 0)).toBe(true);
  });

  it('distributes 1 order to first column', () => {
    const cols = distributeRoundRobin([order('1')], 3);
    expect(cols[0]).toHaveLength(1);
    expect(cols[1]).toHaveLength(0);
    expect(cols[2]).toHaveLength(0);
  });

  it('distributes 3 orders evenly across 3 columns', () => {
    const cols = distributeRoundRobin([order('1'), order('2'), order('3')], 3);
    expect(cols[0]).toHaveLength(1);
    expect(cols[1]).toHaveLength(1);
    expect(cols[2]).toHaveLength(1);
    expect(cols[0]![0]!.id).toBe('1');
    expect(cols[1]![0]!.id).toBe('2');
    expect(cols[2]![0]!.id).toBe('3');
  });

  it('distributes 6 orders evenly (2 per column)', () => {
    const orders = [order('1'), order('2'), order('3'), order('4'), order('5'), order('6')];
    const cols = distributeRoundRobin(orders, 3);
    expect(cols.map((c) => c.length)).toEqual([2, 2, 2]);
  });

  it('distributes 7 orders with one extra in first column', () => {
    const orders = Array.from({ length: 7 }, (_, i) => order(String(i + 1)));
    const cols = distributeRoundRobin(orders, 3);
    expect(cols.map((c) => c.length)).toEqual([3, 2, 2]);
  });

  it('preserves order identity (no reordering)', () => {
    const orders = [order('a'), order('b'), order('c'), order('d')];
    const cols = distributeRoundRobin(orders, 2);
    expect(cols[0]!.map((o) => o.id)).toEqual(['a', 'c']);
    expect(cols[1]!.map((o) => o.id)).toEqual(['b', 'd']);
  });

  it('works with 1 column (all orders in one)', () => {
    const orders = [order('1'), order('2'), order('3')];
    const cols = distributeRoundRobin(orders, 1);
    expect(cols).toHaveLength(1);
    expect(cols[0]).toHaveLength(3);
  });

  it('works with 2 columns', () => {
    const orders = [order('1'), order('2'), order('3'), order('4'), order('5')];
    const cols = distributeRoundRobin(orders, 2);
    expect(cols.map((c) => c.length)).toEqual([3, 2]);
  });

  it('handles large order count', () => {
    const orders = Array.from({ length: 100 }, (_, i) => order(String(i)));
    const cols = distributeRoundRobin(orders, 3);
    expect(cols.map((c) => c.length)).toEqual([34, 33, 33]);
  });
});
