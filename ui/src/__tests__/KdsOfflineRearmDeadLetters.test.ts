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

  it('dedup by id: dead id matches queue entry with a different targetStatus', () => {
    // The canonical dedup key is the action id, not orderId+status.
    // A dead letter for o1->preparing should replace a live queue entry
    // whose id also happens to be o1->preparing even if the statuses
    // differ (the id is derived from orderId->targetStatus in practice,
    // but rearmDeadLetters only looks at the id field).
    const dead = [deadAction('o1', 'preparing')];
    const queue = [pendingAction('o1', 'served', { id: 'o1->preparing' })];
    const result = rearmDeadLetters(dead, queue);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('o1->preparing');
    expect(result[0]!.retryCount).toBe(0);
    // The dead letter's targetStatus wins (it's the rearmed version)
    expect(result[0]!.targetStatus).toBe('preparing');
  });

  it('dedup: queue entry richer data is dropped in favor of rearmed dead', () => {
    // The live queue entry has a non-zero retryCount and a lastError that
    // should NOT survive the rearm — the rearmed version is a fresh start.
    const dead = [deadAction('o1', 'preparing', { lastError: 'original failure' })];
    const queue = [
      pendingAction('o1', 'preparing', {
        retryCount: 4,
        lastError: 'some intermediate error',
        nextAttemptAt: '2026-09-05T14:00:00Z',
      }),
    ];
    const result = rearmDeadLetters(dead, queue);
    expect(result).toHaveLength(1);
    expect(result[0]!.retryCount).toBe(0);
    expect(result[0]!.lastError).toBe('original failure');
    expect('nextAttemptAt' in result[0]!).toBe(false);
  });

  it('dead letter without storeId drops storeId from a store-scoped queue entry', () => {
    // A legacy queue entry that has a storeId but the dead letter does not
    // should lose the storeId — the rearmed action has no storeId.
    const dead = [deadAction('o1', 'preparing')];
    const queue = [
      pendingAction('o1', 'preparing', { storeId: 's1', retryCount: 2 }),
    ];
    const result = rearmDeadLetters(dead, queue);
    expect(result).toHaveLength(1);
    expect('storeId' in result[0]!).toBe(false);
  });

  it('dead letter with storeId wins over a non-store queue entry', () => {
    const dead = [deadAction('o1', 'preparing', { storeId: 's2' })];
    const queue = [pendingAction('o1', 'preparing',
      // no storeId on the queue entry — legacy action
    )];
    const result = rearmDeadLetters(dead, queue);
    expect(result).toHaveLength(1);
    expect(result[0]!.storeId).toBe('s2');
  });

  it('idempotent rearm: rearming the same dead letters twice yields same result', () => {
    const dead = [deadAction('o1', 'preparing')];
    const queue = [pendingAction('o2', 'ready')];
    const once = rearmDeadLetters(dead, queue);
    const twice = rearmDeadLetters(dead, once);
    // The second rearm: dead=[o1->preparing], seen={o1->preparing}.
    // queue=[o2->ready, o1->preparing] → filtered to [o2->ready] (o1 dropped),
    // then requeued=[o1->preparing] appended → [o2->ready, o1->preparing].
    // Same length and same contents as the first rearm.
    expect(twice).toHaveLength(2);
    expect(twice.map((a) => a.id)).toEqual(['o2->ready', 'o1->preparing']);
    // o1 is still rearmed (retryCount 0), not stacked
    expect(twice.find((a) => a.id === 'o1->preparing')!.retryCount).toBe(0);
    // o1's orderId is still the original (not mutated)
    expect(twice.find((a) => a.id === 'o1->preparing')!.orderId).toBe('o1');
  });

  it('preserves queue order: rearmed dead letters appear after existing queue entries', () => {
    const dead = [deadAction('o3', 'served'), deadAction('o4', 'ready')];
    const queue = [
      pendingAction('o1', 'preparing'),
      pendingAction('o2', 'ready'),
    ];
    const result = rearmDeadLetters(dead, queue);
    expect(result.map((a) => a.orderId)).toEqual(['o1', 'o2', 'o3', 'o4']);
  });

  it('handles a large queue with one matching dead letter efficiently', () => {
    const queue: PendingKdsAction[] = Array.from({ length: 100 }, (_, i) =>
      pendingAction(`o${i}`, 'preparing', { retryCount: i % 5 }),
    );
    const dead = [deadAction('o50', 'preparing')];
    const result = rearmDeadLetters(dead, queue);
    expect(result).toHaveLength(100); // o50 replaced, not duplicated
    expect(result.find((a) => a.id === 'o50->preparing')!.retryCount).toBe(0);
    // The other 99 entries are untouched
    for (let i = 0; i < 100; i++) {
      if (i !== 50) {
        const entry = result.find((a) => a.id === `o${i}->preparing`);
        expect(entry).toBeDefined();
        expect(entry!.retryCount).toBe(i % 5);
      }
    }
  });

  it('handles a large dead-letter list', () => {
    const dead = Array.from({ length: 50 }, (_, i) =>
      deadAction(`o${i}`, 'preparing', { lastError: `fail ${i}` }),
    );
    const result = rearmDeadLetters(dead, []);
    expect(result).toHaveLength(50);
    for (const a of result) {
      expect(a.retryCount).toBe(0);
      expect('deadLetterAt' in a).toBe(false);
    }
  });

  it('empty dead list returns a filtered copy of the queue (no dedup work)', () => {
    const queue = [pendingAction('o1', 'preparing')];
    const result = rearmDeadLetters([], queue);
    // With no dead letters, seen is empty, so queue.filter(...NOTHING...) returns
    // a new array. This is correct — the function does not special-case the empty
    // dead list, and callers (the hook) always pass a non-empty dead list when
    // requeuing.
    expect(result).toEqual(queue);
    expect(result).not.toBe(queue);
  });

});

