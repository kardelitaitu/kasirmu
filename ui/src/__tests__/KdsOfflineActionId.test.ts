import { describe, it, expect } from 'vitest';
import type { PendingKdsAction } from '@/hooks/useKdsOffline';

/**
 * Tests for the action ID contract (OFF-05).
 *
 * Action IDs follow the pattern `{orderId}->{targetStatus}` and are used
 * for deduplication: when the same order+status fails twice, the second
 * failure replaces the first rather than duplicating it.
 *
 * The production code builds IDs in wrapUpdate. We verify the contract
 * here so the ID format is tested independently of the hook.
 */

/** Replicate the production action ID format. */
function makeActionId(orderId: string, targetStatus: string): string {
  return `${orderId}->${targetStatus}`;
}

/** Build a minimal PendingKdsAction for testing. */
function makeAction(
  orderId: string,
  targetStatus: string,
  overrides: Partial<PendingKdsAction> = {},
): PendingKdsAction {
  return {
    id: makeActionId(orderId, targetStatus),
    orderId,
    targetStatus: targetStatus as PendingKdsAction['targetStatus'],
    retryCount: 0,
    createdAt: '2026-09-05T12:00:00Z',
    lastError: '',
    ...overrides,
  };
}

/** Same dedup logic as wrapUpdate in useKdsOffline. */
function dedupeQueue(
  queue: PendingKdsAction[],
  newAction: PendingKdsAction,
): PendingKdsAction[] {
  return [...queue.filter((a) => a.id !== newAction.id), newAction];
}

describe('action ID format', () => {
  it('uses arrow separator between orderId and status', () => {
    expect(makeActionId('order-1', 'preparing')).toBe('order-1->preparing');
  });

  it('same order+status always produces same ID', () => {
    expect(makeActionId('o1', 'ready')).toBe(makeActionId('o1', 'ready'));
  });

  it('different order IDs produce different IDs', () => {
    expect(makeActionId('o1', 'ready')).not.toBe(makeActionId('o2', 'ready'));
  });

  it('different statuses produce different IDs', () => {
    expect(makeActionId('o1', 'ready')).not.toBe(makeActionId('o1', 'served'));
  });

  it('UUID order IDs work correctly', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(makeActionId(uuid, 'preparing')).toBe(
      '550e8400-e29b-41d4-a716-446655440000->preparing',
    );
  });
});

describe('action ID deduplication', () => {
  it('first action added to empty queue', () => {
    const action = makeAction('o1', 'preparing');
    const result = dedupeQueue([], action);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(action.id);
  });

  it('second action with same ID replaces the first', () => {
    const first = makeAction('o1', 'preparing', { retryCount: 0 });
    const second = makeAction('o1', 'preparing', { retryCount: 1 });
    const result = dedupeQueue([first], second);
    expect(result).toHaveLength(1);
    expect(result[0]!.retryCount).toBe(1);
  });

  it('action with different ID is appended', () => {
    const a = makeAction('o1', 'preparing');
    const b = makeAction('o2', 'ready');
    const result = dedupeQueue([a], b);
    expect(result).toHaveLength(2);
  });

  it('action with same orderId but different status is appended', () => {
    const a = makeAction('o1', 'preparing');
    const b = makeAction('o1', 'ready');
    const result = dedupeQueue([a], b);
    expect(result).toHaveLength(2);
  });

  it('dedup preserves other actions in the queue', () => {
    const existing = [
      makeAction('o1', 'preparing', { retryCount: 0 }),
      makeAction('o2', 'ready'),
      makeAction('o3', 'served'),
    ];
    const replacement = makeAction('o1', 'preparing', { retryCount: 3 });
    const result = dedupeQueue(existing, replacement);
    expect(result).toHaveLength(3);
    expect(result.map((a) => a.orderId)).toEqual(['o2', 'o3', 'o1']);
    expect(result[2]!.retryCount).toBe(3);
  });

  it('multiple dedup rounds converge to single action', () => {
    let queue: PendingKdsAction[] = [];
    for (let i = 0; i < 5; i++) {
      queue = dedupeQueue(queue, makeAction('o1', 'preparing', { retryCount: i }));
    }
    expect(queue).toHaveLength(1);
    expect(queue[0]!.retryCount).toBe(4);
  });
});
