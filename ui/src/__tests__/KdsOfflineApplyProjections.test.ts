import { describe, it, expect } from 'vitest';
import { applyProjections, MAX_RETRY_ATTEMPTS, CACHE_TTL_MS } from '@/hooks/useKdsOffline';
import type { PendingKdsAction } from '@/hooks/useKdsOffline';
import type { KdsOrder, KdsStatus } from '@/api/kds';

/**
 * Minimal order builder.
 *
 * No `as KdsOrder`. The previous version cast, and the cast was silencing three wrong
 * fields, not just the missing ones: `items_summary` and `notes` were null where the
 * interface declares string, and `priority` was the string 'normal' where it declares
 * boolean. It also omitted sale_id, started_at, ready_at and prep_time_seconds entirely.
 * A fixture built through a cast is a fixture whose shape nobody checks -- applyProjections
 * reads these fields, so a mis-typed one is a test asserting against an object the backend
 * could never return. Writing all sixteen required fields means TypeScript verifies the
 * shape on every edit.
 */
function ord(id: string, status: KdsStatus): KdsOrder {
  return {
    id,
    sale_id: `sale-${id}`,
    store_id: null,
    status,
    items_summary: '',
    item_count: 0,
    display_number: 1,
    received_at: '2026-09-05T12:00:00Z',
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

function action(
  orderId: string,
  targetStatus: string,
  extra: Partial<PendingKdsAction> = {},
): PendingKdsAction {
  return {
    id: `a-${orderId}`,
    orderId,
    targetStatus: targetStatus as PendingKdsAction['targetStatus'],
    retryCount: 1,
    createdAt: '2026-09-05T12:00:00Z',
    lastError: 'offline',
    ...extra,
  };
}

describe('applyProjections', () => {
  it('returns orders unchanged when queue is empty', () => {
    const orders = [ord('1', 'pending'), ord('2', 'preparing')];
    const result = applyProjections(orders, []);
    expect(result).toEqual(orders);
  });

  it('returns same reference when queue is empty', () => {
    const orders = [ord('1', 'pending')];
    expect(applyProjections(orders, [])).toBe(orders);
  });

  it('advances a single order status', () => {
    const orders = [ord('1', 'pending'), ord('2', 'pending')];
    const queue = [action('1', 'preparing')];
    const result = applyProjections(orders, queue);
    expect(result[0]!.status).toBe('preparing');
    expect(result[1]!.status).toBe('pending');
  });

  it('applies multiple actions to different orders', () => {
    const orders = [ord('1', 'pending'), ord('2', 'pending'), ord('3', 'pending')];
    const queue = [action('1', 'preparing'), action('3', 'ready')];
    const result = applyProjections(orders, queue);
    expect(result[0]!.status).toBe('preparing');
    expect(result[1]!.status).toBe('pending');
    expect(result[2]!.status).toBe('ready');
  });

  it('skips action when order already has target status', () => {
    const orders = [ord('1', 'preparing')];
    const queue = [action('1', 'preparing')];
    const result = applyProjections(orders, queue);
    expect(result[0]).toBe(orders[0]);
  });

  it('ignores actions for orders not in the snapshot', () => {
    const orders = [ord('1', 'pending')];
    const queue = [action('999', 'preparing')];
    const result = applyProjections(orders, queue);
    expect(result[0]!.status).toBe('pending');
  });

  it('applies first matching action when multiple target the same order', () => {
    const orders = [ord('1', 'pending')];
    const queue = [action('1', 'preparing'), action('1', 'ready')];
    const result = applyProjections(orders, queue);
    // find() returns first match — preparing
    expect(result[0]!.status).toBe('preparing');
  });

  it('preserves all other order fields when projecting', () => {
    const original = ord('1', 'pending');
    original.table_number = 'T5';
    original.notes = 'extra spicy';
    original.kitchen_zone = 'grill';
    const orders = [original];
    const queue = [action('1', 'preparing')];
    const result = applyProjections(orders, queue);
    expect(result[0]!.table_number).toBe('T5');
    expect(result[0]!.notes).toBe('extra spicy');
    expect(result[0]!.kitchen_zone).toBe('grill');
    expect(result[0]!.status).toBe('preparing');
  });

  it('handles full pipeline: pending → preparing → ready → served', () => {
    let orders = [ord('1', 'pending')];
    orders = applyProjections(orders, [action('1', 'preparing')]);
    expect(orders[0]!.status).toBe('preparing');
    orders = applyProjections(orders, [action('1', 'ready')]);
    expect(orders[0]!.status).toBe('ready');
    orders = applyProjections(orders, [action('1', 'served')]);
    expect(orders[0]!.status).toBe('served');
  });

  it('returns new array even when no action matches', () => {
    const orders = [ord('1', 'pending')];
    const result = applyProjections(orders, [action('99', 'ready')]);
    expect(result).not.toBe(orders);
    expect(result[0]!.status).toBe('pending');
  });
});

describe('useKdsOffline constants', () => {
  it('MAX_RETRY_ATTEMPTS is 5', () => {
    expect(MAX_RETRY_ATTEMPTS).toBe(5);
  });

  it('CACHE_TTL_MS is 24 hours in milliseconds', () => {
    expect(CACHE_TTL_MS).toBe(86_400_000);
  });
});
