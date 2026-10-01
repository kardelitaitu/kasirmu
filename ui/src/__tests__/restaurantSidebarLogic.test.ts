import { describe, expect, it } from 'vitest';
import { computeRovingIndex, isRovingKey, type RovingKey } from '@/features/restaurant/components/sidebarLogic';

describe('isRovingKey', () => {
  it('accepts the four roving navigation keys', () => {
    expect(isRovingKey('ArrowDown')).toBe(true);
    expect(isRovingKey('ArrowUp')).toBe(true);
    expect(isRovingKey('Home')).toBe(true);
    expect(isRovingKey('End')).toBe(true);
  });

  it('rejects every other key', () => {
    for (const k of ['Enter', 'Escape', 'Tab', 'a', ' ', 'ArrowLeft', 'ArrowRight', 'F5']) {
      expect(isRovingKey(k)).toBe(false);
    }
  });
});

describe('computeRovingIndex', () => {
  it('returns null when there are no items', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End'] as RovingKey[]) {
      expect(computeRovingIndex(0, 0, key)).toBeNull();
    }
  });

  it('Home always resolves to the first item', () => {
    expect(computeRovingIndex(2, 4, 'Home')).toBe(0);
    expect(computeRovingIndex(0, 4, 'Home')).toBe(0);
    expect(computeRovingIndex(3, 4, 'Home')).toBe(0);
  });

  it('End always resolves to the last item', () => {
    expect(computeRovingIndex(1, 4, 'End')).toBe(3);
    expect(computeRovingIndex(0, 4, 'End')).toBe(3);
  });

  it('ArrowDown advances by one and wraps from the last item to the first', () => {
    expect(computeRovingIndex(0, 4, 'ArrowDown')).toBe(1);
    expect(computeRovingIndex(2, 4, 'ArrowDown')).toBe(3);
    expect(computeRovingIndex(3, 4, 'ArrowDown')).toBe(0);
  });

  it('ArrowUp retreats by one and wraps from the first item to the last', () => {
    expect(computeRovingIndex(1, 4, 'ArrowUp')).toBe(0);
    expect(computeRovingIndex(0, 4, 'ArrowUp')).toBe(3);
    expect(computeRovingIndex(3, 4, 'ArrowUp')).toBe(2);
  });

  it('handles a single-item list without changing index on any key', () => {
    expect(computeRovingIndex(0, 1, 'ArrowDown')).toBe(0);
    expect(computeRovingIndex(0, 1, 'ArrowUp')).toBe(0);
    expect(computeRovingIndex(0, 1, 'Home')).toBe(0);
    expect(computeRovingIndex(0, 1, 'End')).toBe(0);
  });
});
