import { describe, it, expect, vi, afterEach } from 'vitest';
import { bucketForOffset, dayOffset, BUCKETS } from '@/features/kds/KdsCompletedView';

/**
 * Tests for the full completed-order bucketing pipeline.
 *
 * KdsCompletedView builds a Map<string, KdsOrder[]> by:
 *   1. Filtering orders by type (dinein/takeaway/all)
 *   2. Computing dayOffset for each order (served_at || received_at)
 *   3. Mapping offset → bucket key via bucketForOffset
 *   4. Grouping into BUCKETS in insertion order
 *
 * We test the pipeline end-to-end by replicating the useMemo logic.
 */

/** Replicate the bucketing pipeline from KdsCompletedView. */
function bucketOrders(
  orders: { id: string; served_at?: string | null; received_at: string; table_number?: string | null }[],
  filter: 'all' | 'dinein' | 'takeaway' = 'all',
): Map<string, string[]> {
  // Step 1: filter
  let filtered = orders;
  if (filter === 'dinein') {
    filtered = orders.filter((o) => !!o.table_number && o.table_number.trim() !== '');
  } else if (filter === 'takeaway') {
    filtered = orders.filter((o) => !o.table_number || o.table_number.trim() === '');
  }

  // Step 2-4: bucket
  const map = new Map<string, string[]>();
  for (const b of BUCKETS) map.set(b.key, []);
  for (const o of filtered) {
    const ref = o.served_at || o.received_at;
    const key = bucketForOffset(dayOffset(ref));
    if (key) map.get(key)!.push(o.id);
  }
  return map;
}

describe('bucketing pipeline', () => {
  afterEach(() => vi.restoreAllMocks());

  it('empty input produces empty buckets', () => {
    const result = bucketOrders([]);
    expect(result.size).toBe(4);
    for (const ids of result.values()) {
      expect(ids).toHaveLength(0);
    }
  });

  it('all orders in "today" bucket when received today', () => {
    // Use dayOffset=0 by mocking Date.now to be the same day
    vi.spyOn(Date.prototype, 'toISOString').mockReturnValue(
      new Date().toISOString(), // keep time unchanged
    );
    // Instead, just use very recent timestamps
    const now = new Date();
    const orders = [
      { id: '1', received_at: now.toISOString() },
      { id: '2', received_at: now.toISOString() },
    ];
    const result = bucketOrders(orders);
    expect(result.get('today')).toHaveLength(2);
    expect(result.get('yesterday')).toHaveLength(0);
  });

  it('dinein filter excludes takeaway orders', () => {
    const orders = [
      { id: '1', received_at: '2026-09-05T12:00:00Z', table_number: 'T1' },
      { id: '2', received_at: '2026-09-05T12:00:00Z', table_number: null },
    ];
    const result = bucketOrders(orders, 'dinein');
    const total = Array.from(result.values()).flat();
    expect(total).toContain('1');
    expect(total).not.toContain('2');
  });

  it('takeaway filter excludes dinein orders', () => {
    const orders = [
      { id: '1', received_at: '2026-09-05T12:00:00Z', table_number: 'T1' },
      { id: '2', received_at: '2026-09-05T12:00:00Z', table_number: null },
    ];
    const result = bucketOrders(orders, 'takeaway');
    const total = Array.from(result.values()).flat();
    expect(total).toContain('2');
    expect(total).not.toContain('1');
  });

  it('BUCKETS has exactly 4 entries in correct order', () => {
    expect(BUCKETS).toHaveLength(4);
    expect(BUCKETS.map((b) => b.key)).toEqual(['today', 'yesterday', 'this-week', 'older']);
  });

  it('every bucket key maps to an array', () => {
    for (const b of BUCKETS) {
      const result = bucketOrders([]);
      expect(result.has(b.key)).toBe(true);
      expect(Array.isArray(result.get(b.key))).toBe(true);
    }
  });

  it('dayOffset pipeline: newer orders go to earlier buckets', () => {
    // An order from 2 days ago should be in this-week, not yesterday
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const offset = dayOffset(twoDaysAgo.toISOString());
    expect(offset).toBe(2);
    expect(bucketForOffset(offset)).toBe('this-week');
  });

  it('dayOffset pipeline: 8-day-old order goes to older', () => {
    const eightDaysAgo = new Date();
    eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);
    const offset = dayOffset(eightDaysAgo.toISOString());
    expect(offset).toBe(8);
    expect(bucketForOffset(offset)).toBe('older');
  });

  it('pipeline preserves order IDs within a bucket', () => {
    const orders = [
      { id: 'aaa', received_at: '2026-09-05T12:00:00Z' },
      { id: 'bbb', received_at: '2026-09-05T12:01:00Z' },
      { id: 'ccc', received_at: '2026-09-05T12:02:00Z' },
    ];
    const result = bucketOrders(orders);
    expect(result.get('today')).toEqual(['aaa', 'bbb', 'ccc']);
  });
});
