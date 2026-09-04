// Unit tests for KDS keyboard navigation — the pure selection logic
// used by the keyboard handler in KdsScreen.tsx.

import { describe, it, expect } from 'vitest';

interface Order { id: string; }

/** Pure next-index resolver for ArrowDown. */
function nextIndexDown(currentId: string | null, orders: Order[]): number {
  const currentIdx = currentId ? orders.findIndex((o) => o.id === currentId) : -1;
  return Math.min(currentIdx + 1, orders.length - 1);
}

/** Pure next-index resolver for ArrowUp. */
function nextIndexUp(currentId: string | null, orders: Order[]): number {
  const currentIdx = currentId ? orders.findIndex((o) => o.id === currentId) : orders.length;
  return Math.max(currentIdx - 1, 0);
}

/** Number key → order index (1-based key → 0-based index). */
function numberKeyToIndex(key: string, orders: Order[]): number | null {
  if (key >= '1' && key <= '9') {
    const idx = parseInt(key, 10) - 1;
    if (idx < orders.length) return idx;
  }
  return null;
}

const orders: Order[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('nextIndexDown (ArrowDown)', () => {
  it('moves from no selection to first order', () => {
    expect(nextIndexDown(null, orders)).toBe(0);
  });

  it('moves from first to second', () => {
    expect(nextIndexDown('a', orders)).toBe(1);
  });

  it('moves from second to third', () => {
    expect(nextIndexDown('b', orders)).toBe(2);
  });

  it('stays at last order (no overflow)', () => {
    expect(nextIndexDown('c', orders)).toBe(2);
  });

  it('returns -1 for empty orders', () => {
    expect(nextIndexDown(null, [])).toBe(-1);
  });
});

describe('nextIndexUp (ArrowUp)', () => {
  it('moves from no selection to last order', () => {
    expect(nextIndexUp(null, orders)).toBe(2);
  });

  it('moves from last to second', () => {
    expect(nextIndexUp('c', orders)).toBe(1);
  });

  it('moves from second to first', () => {
    expect(nextIndexUp('b', orders)).toBe(0);
  });

  it('stays at first order (no underflow)', () => {
    expect(nextIndexUp('a', orders)).toBe(0);
  });

  it('returns 0 for empty orders', () => {
    expect(nextIndexUp(null, [])).toBe(0);
  });
});

describe('numberKeyToIndex', () => {
  it('key "1" → index 0', () => {
    expect(numberKeyToIndex('1', orders)).toBe(0);
  });

  it('key "3" → index 2', () => {
    expect(numberKeyToIndex('3', orders)).toBe(2);
  });

  it('key "4" → null (out of range, only 3 orders)', () => {
    expect(numberKeyToIndex('4', orders)).toBeNull();
  });

  it('key "0" → null (not a valid key)', () => {
    expect(numberKeyToIndex('0', orders)).toBeNull();
  });

  it('non-numeric key → null', () => {
    expect(numberKeyToIndex('a', orders)).toBeNull();
    expect(numberKeyToIndex('Escape', orders)).toBeNull();
  });

  it('key "9" with 9 orders → index 8', () => {
    const nineOrders = Array.from({ length: 9 }, (_, i) => ({ id: String(i) }));
    expect(numberKeyToIndex('9', nineOrders)).toBe(8);
  });
});
