// Unit tests for completed tab order-type filtering — the logic that
// separates completed orders into All / Dine in / Takeaway based on
// the presence of a table_number.

import { describe, it, expect } from 'vitest';
import type { KdsOrder } from '@/api/kds';

function order(overrides: Partial<KdsOrder> = {}): KdsOrder {
  return {
    id: '1',
    sale_id: 'sale-1',
    store_id: 'store-1',
    target_instance_id: null,
    status: 'served',
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

/** Same filter logic as KdsCompletedView useMemo. */
function filterCompleted(orders: KdsOrder[], filter: 'all' | 'dinein' | 'takeaway'): KdsOrder[] {
  if (filter === 'dinein') {
    return orders.filter((o) => !!o.table_number && o.table_number.trim() !== '');
  }
  if (filter === 'takeaway') {
    return orders.filter((o) => !o.table_number || o.table_number.trim() === '');
  }
  return orders;
}

describe('filterCompleted', () => {
  const dinein = order({ id: '1', table_number: 'T5' });
  const takeaway = order({ id: '2', table_number: null });
  const emptyTable = order({ id: '3', table_number: '' });
  const whitespaceTable = order({ id: '4', table_number: '  ' });

  it('all filter returns everything', () => {
    const result = filterCompleted([dinein, takeaway], 'all');
    expect(result).toHaveLength(2);
  });

  it('dinein filter returns orders with non-empty table_number', () => {
    const result = filterCompleted([dinein, takeaway, emptyTable], 'dinein');
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('1');
  });

  it('dinein filter excludes null table_number', () => {
    const result = filterCompleted([takeaway], 'dinein');
    expect(result).toHaveLength(0);
  });

  it('dinein filter excludes empty string table_number', () => {
    const result = filterCompleted([emptyTable], 'dinein');
    expect(result).toHaveLength(0);
  });

  it('dinein filter excludes whitespace-only table_number', () => {
    const result = filterCompleted([whitespaceTable], 'dinein');
    expect(result).toHaveLength(0);
  });

  it('takeaway filter returns orders with null/empty table_number', () => {
    const result = filterCompleted([dinein, takeaway, emptyTable], 'takeaway');
    expect(result).toHaveLength(2);
    expect(result.map((o) => o.id)).toContain('2');
    expect(result.map((o) => o.id)).toContain('3');
  });

  it('takeaway filter excludes orders with real table_number', () => {
    const result = filterCompleted([dinein], 'takeaway');
    expect(result).toHaveLength(0);
  });

  it('takeaway filter includes whitespace-only as takeaway', () => {
    const result = filterCompleted([whitespaceTable], 'takeaway');
    expect(result).toHaveLength(1);
  });

  it('empty input returns empty for any filter', () => {
    expect(filterCompleted([], 'all')).toEqual([]);
    expect(filterCompleted([], 'dinein')).toEqual([]);
    expect(filterCompleted([], 'takeaway')).toEqual([]);
  });

  it('mixed orders split correctly', () => {
    const orders = [
      order({ id: '1', table_number: 'T1' }),
      order({ id: '2', table_number: null }),
      order({ id: '3', table_number: 'T3' }),
      order({ id: '4', table_number: '' }),
    ];
    expect(filterCompleted(orders, 'dinein')).toHaveLength(2);
    expect(filterCompleted(orders, 'takeaway')).toHaveLength(2);
    expect(filterCompleted(orders, 'all')).toHaveLength(4);
  });
});
