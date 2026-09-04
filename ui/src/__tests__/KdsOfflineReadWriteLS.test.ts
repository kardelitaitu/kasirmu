import { describe, it, expect, beforeEach } from 'vitest';
import { readLS, writeLS } from '@/hooks/useKdsOffline';

/**
 * Tests for the localStorage read/write helpers used by useKdsOffline.
 *
 * readLS: reads from localStorage, parses JSON, returns fallback on
 *         missing key or parse error.
 * writeLS: writes JSON to localStorage, returns false on failure (OFF-08).
 */

const KEY = 'kds-test-rw';

describe('readLS', () => {
  beforeEach(() => localStorage.removeItem(KEY));

  it('returns fallback when key is absent', () => {
    expect(readLS(KEY, 'default')).toBe('default');
  });

  it('returns fallback for number when key is absent', () => {
    expect(readLS(KEY, 42)).toBe(42);
  });

  it('round-trips a string', () => {
    localStorage.setItem(KEY, JSON.stringify('hello'));
    expect(readLS(KEY, '')).toBe('hello');
  });

  it('round-trips a number', () => {
    localStorage.setItem(KEY, JSON.stringify(99));
    expect(readLS(KEY, 0)).toBe(99);
  });

  it('round-trips an object', () => {
    const obj = { a: 1, b: 'two' };
    localStorage.setItem(KEY, JSON.stringify(obj));
    expect(readLS(KEY, {})).toEqual(obj);
  });

  it('round-trips an array', () => {
    const arr = [1, 2, 3];
    localStorage.setItem(KEY, JSON.stringify(arr));
    expect(readLS(KEY, [])).toEqual(arr);
  });

  it('returns fallback for corrupted JSON', () => {
    localStorage.setItem(KEY, 'not-valid-json{');
    expect(readLS(KEY, 'fallback')).toBe('fallback');
  });

  it('returns null stored as valid JSON', () => {
    localStorage.setItem(KEY, JSON.stringify(null));
    expect(readLS(KEY, 'default')).toBeNull();
  });

  it('round-trips boolean values', () => {
    localStorage.setItem(KEY, JSON.stringify(true));
    expect(readLS(KEY, false)).toBe(true);
  });
});

describe('writeLS', () => {
  beforeEach(() => localStorage.removeItem(KEY));

  it('writes a string and returns true', () => {
    expect(writeLS(KEY, 'test')).toBe(true);
    expect(readLS(KEY, '')).toBe('test');
  });

  it('writes an object and returns true', () => {
    const obj = { x: 10 };
    expect(writeLS(KEY, obj)).toBe(true);
    expect(readLS(KEY, {})).toEqual(obj);
  });

  it('writes an array and returns true', () => {
    expect(writeLS(KEY, [1, 2])).toBe(true);
    expect(readLS(KEY, [])).toEqual([1, 2]);
  });

  it('overwrites previous value', () => {
    writeLS(KEY, 'first');
    writeLS(KEY, 'second');
    expect(readLS(KEY, '')).toBe('second');
  });

  it('writes null as valid JSON', () => {
    expect(writeLS(KEY, null)).toBe(true);
    expect(readLS(KEY, 'default')).toBeNull();
  });

  it('writes boolean values', () => {
    writeLS(KEY, true);
    expect(readLS(KEY, false)).toBe(true);
    writeLS(KEY, false);
    expect(readLS(KEY, true)).toBe(false);
  });

  it('write→read round-trip for complex nested objects', () => {
    const complex = {
      orders: [{ id: '1', status: 'pending' }],
      meta: { count: 1, ts: '2026-09-05T12:00:00Z' },
    };
    expect(writeLS(KEY, complex)).toBe(true);
    expect(readLS(KEY, {})).toEqual(complex);
  });
});
