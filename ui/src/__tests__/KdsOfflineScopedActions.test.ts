import { describe, it, expect } from 'vitest';
import { scopedActions, type PendingKdsAction } from '@/hooks/useKdsOffline';

/**
 * Tests for scopedActions — OFF-07 store-scope isolation.
 *
 * When a shared terminal has multiple stores, each store's pending actions
 * must never leak into another store's retry loop. Actions without a
 * storeId (legacy/unscoped) are always included.
 */

function action(
  orderId: string,
  status: string,
  storeId?: string,
): PendingKdsAction {
  return {
    id: `${orderId}->${status}`,
    orderId,
    targetStatus: status as PendingKdsAction['targetStatus'],
    retryCount: 0,
    createdAt: '2026-09-05T12:00:00Z',
    lastError: 'offline',
    ...(storeId ? { storeId } : {}),
  };
}

describe('scopedActions', () => {
  it('returns all actions when no storeId (no filtering)', () => {
    const queue = [action('1', 'preparing', 's1'), action('2', 'ready', 's2')];
    expect(scopedActions(queue)).toEqual(queue);
  });

  it('returns all actions when storeId is undefined', () => {
    const queue = [action('1', 'preparing', 's1')];
    expect(scopedActions(queue, undefined)).toEqual(queue);
  });

  it('filters to matching storeId', () => {
    const queue = [
      action('1', 'preparing', 's1'),
      action('2', 'ready', 's2'),
      action('3', 'served', 's1'),
    ];
    const result = scopedActions(queue, 's1');
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.orderId)).toEqual(['1', '3']);
  });

  it('includes legacy actions (no storeId) with any scope', () => {
    const queue = [
      action('1', 'preparing'), // no storeId
      action('2', 'ready', 's1'),
      action('3', 'served', 's2'),
    ];
    const result = scopedActions(queue, 's1');
    expect(result).toHaveLength(2); // action 1 (legacy) + action 2 (s1)
    expect(result.map((a) => a.orderId)).toContain('1');
    expect(result.map((a) => a.orderId)).toContain('2');
  });

  it('excludes actions from other scopes', () => {
    const queue = [action('1', 'preparing', 's1'), action('2', 'ready', 's2')];
    const result = scopedActions(queue, 's1');
    expect(result).toHaveLength(1);
    expect(result[0]!.orderId).toBe('1');
  });

  it('returns empty when no actions match scope', () => {
    const queue = [action('1', 'preparing', 's2'), action('2', 'ready', 's3')];
    expect(scopedActions(queue, 's1')).toHaveLength(0);
  });

  it('returns empty for empty input', () => {
    expect(scopedActions([], 's1')).toHaveLength(0);
  });

  it('all legacy actions pass through with any scope', () => {
    const queue = [
      action('1', 'preparing'),
      action('2', 'ready'),
      action('3', 'served'),
    ];
    const result = scopedActions(queue, 'any-store');
    expect(result).toHaveLength(3);
  });

  it('UUID storeId works correctly', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const queue = [
      action('1', 'preparing', uuid),
      action('2', 'ready', 'other-uuid'),
    ];
    const result = scopedActions(queue, uuid);
    expect(result).toHaveLength(1);
    expect(result[0]!.orderId).toBe('1');
  });
});
