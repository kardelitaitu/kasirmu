import { describe, it, expect } from 'vitest';
import { rearmDeadLetters, type PendingKdsAction, type DeadLetterKdsAction } from '@/hooks/useKdsOffline';

/**
 * Tests for rearmDeadLetters — the pure dedup+merge logic used by
 * requeueDeadLetter. Resets retryCount, drops deadLetterAt, and merges
 * with the existing pending queue (dedup by action ID).
 */

function deadAction(
  orderId: string,
  status: string,
  overrides: Partial<DeadLetterKdsAction> = {},
): DeadLetterKdsAction {
  return {
    id: `${orderId}->${status}`,
    orderId,
    targetStatus: status as DeadLetterKdsAction['targetStatus'],
    retryCount: 5,
    createdAt: '2026-09-05T12:00:00Z',
    lastError: 'too many retries',
    deadLetterAt: '2026-09-05T13:00:00Z',
    ...overrides,
  };
}

function pendingAction(
  orderId: string,
  status: string,
  overrides: Partial<PendingKdsAction> = {},
): PendingKdsAction {
  return {
    id: `${orderId}->${status}`,
    orderId,
    targetStatus: status as PendingKdsAction['targetStatus'],
    retryCount: 2,
    createdAt: '2026-09-05T12:00:00Z',
    lastError: '',
    ...overrides,
  };
}

describe('rearmDeadLetters', () => {
  it('returns empty array when no dead letters', () => {
    expect(rearmDeadLetters([], [])).toEqual([]);
  });

  it('resets retryCount to 0', () => {
    const dead = [deadAction('o1', 'preparing')];
    const result = rearmDeadLetters(dead, []);
    expect(result[0]!.retryCount).toBe(0);
  });

  it('drops deadLetterAt field', () => {
    const dead = [deadAction('o1', 'preparing')];
    const result = rearmDeadLetters(dead, []);
    expect('deadLetterAt' in result[0]!).toBe(false);
  });

  it('preserves id, orderId, targetStatus, createdAt, lastError', () => {
    const dead = [deadAction('o1', 'preparing')];
    const result = rearmDeadLetters(dead, []);
    expect(result[0]!.id).toBe('o1->preparing');
    expect(result[0]!.orderId).toBe('o1');
    expect(result[0]!.targetStatus).toBe('preparing');
    expect(result[0]!.createdAt).toBe('2026-09-05T12:00:00Z');
    expect(result[0]!.lastError).toBe('too many retries');
  });

  it('preserves storeId when present', () => {
    const dead = [deadAction('o1', 'preparing', { storeId: 's1' })];
    const result = rearmDeadLetters(dead, []);
    expect(result[0]!.storeId).toBe('s1');
  });

  it('does not include storeId when absent', () => {
    const dead = [deadAction('o1', 'preparing')];
    const result = rearmDeadLetters(dead, []);
    expect('storeId' in result[0]!).toBe(false);
  });

  it('appends to existing queue', () => {
    const dead = [deadAction('o2', 'ready')];
    const queue = [pendingAction('o1', 'preparing')];
    const result = rearmDeadLetters(dead, queue);
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.orderId)).toEqual(['o1', 'o2']);
  });

  it('deduplicates: dead letter replaces existing queue entry with same ID', () => {
    const dead = [deadAction('o1', 'preparing', { retryCount: 5, lastError: 'failed' })];
    const queue = [pendingAction('o1', 'preparing', { retryCount: 3 })];
    const result = rearmDeadLetters(dead, queue);
    expect(result).toHaveLength(1);
    expect(result[0]!.retryCount).toBe(0); // rearmed
  });

  it('deduplicates: only the dead action is rearmed, not the queue entry', () => {
    const dead = [deadAction('o1', 'preparing', { retryCount: 5 })];
    const queue = [
      pendingAction('o1', 'preparing', { retryCount: 3 }),
      pendingAction('o2', 'ready'),
    ];
    const result = rearmDeadLetters(dead, queue);
    expect(result).toHaveLength(2);
    // o2 is untouched (queue filtered first, then rearmed appended)
    expect(result[0]!.orderId).toBe('o2');
    expect(result[0]!.retryCount).toBe(2);
    // o1 is rearmed (queue version removed, dead version appended with retryCount 0)
    expect(result[1]!.orderId).toBe('o1');
    expect(result[1]!.retryCount).toBe(0);
  });

  it('multiple dead letters: all rearmed', () => {
    const dead = [
      deadAction('o1', 'preparing'),
      deadAction('o2', 'ready'),
      deadAction('o3', 'served'),
    ];
    const result = rearmDeadLetters(dead, []);
    expect(result).toHaveLength(3);
    for (const a of result) {
      expect(a.retryCount).toBe(0);
      expect('deadLetterAt' in a).toBe(false);
    }
  });

  it('empty queue with dead letters: all rearmed', () => {
    const dead = [deadAction('o1', 'preparing')];
    const result = rearmDeadLetters(dead, []);
    expect(result).toHaveLength(1);
    expect(result[0]!.retryCount).toBe(0);
  });
});
