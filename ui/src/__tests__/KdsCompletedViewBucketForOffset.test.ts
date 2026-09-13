import { describe, it, expect } from 'vitest';
import { bucketForOffset } from '@/features/kds/KdsCompletedView';

describe('bucketForOffset', () => {
  it('returns "today" for offset 0', () => {
    expect(bucketForOffset(0)).toBe('today');
  });

  it('returns "yesterday" for offset 1', () => {
    expect(bucketForOffset(1)).toBe('yesterday');
  });

  it('returns "this-week" for offset 2', () => {
    expect(bucketForOffset(2)).toBe('this-week');
  });

  it('returns "this-week" for offset 6 (end of week)', () => {
    expect(bucketForOffset(6)).toBe('this-week');
  });

  it('returns "older" for offset 7', () => {
    expect(bucketForOffset(7)).toBe('older');
  });

  it('returns "older" for very large offset', () => {
    expect(bucketForOffset(365)).toBe('older');
    expect(bucketForOffset(9999)).toBe('older');
  });

  it('returns null for negative offset (out of range)', () => {
    expect(bucketForOffset(-1)).toBeNull();
    expect(bucketForOffset(-100)).toBeNull();
  });

  it('returns null for offset that falls exactly on "today" start boundary (0) — covered by "today"', () => {
    // offset 0 is in [0, 1) → "today"
    expect(bucketForOffset(0)).toBe('today');
  });

  it('fractional offset works correctly', () => {
    // 0.5 is in [0, 1) → "today"
    expect(bucketForOffset(0.5)).toBe('today');
    // 1.5 is in [1, 2) → "yesterday"
    expect(bucketForOffset(1.5)).toBe('yesterday');
    // 6.9 is in [2, 7) → "this-week"
    expect(bucketForOffset(6.9)).toBe('this-week');
    // 7.0 is in [7, Infinity) → "older"
    expect(bucketForOffset(7.0)).toBe('older');
  });

  it('boundary: offset 1 falls in yesterday, not today', () => {
    expect(bucketForOffset(1)).toBe('yesterday');
  });

  it('boundary: offset 2 falls in this-week, not yesterday', () => {
    expect(bucketForOffset(2)).toBe('this-week');
  });
});
