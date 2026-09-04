// Unit tests for Set toggle logic — the pure pattern used by
// KdsCompletedView.toggleBucket and similar toggle handlers.

import { describe, it, expect } from 'vitest';

/** Pure set toggle: returns a new Set with the key added or removed. */
function toggleSet<T>(prev: Set<T>, key: T): Set<T> {
  const next = new Set(prev);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
}

describe('toggleSet', () => {
  it('adds key to empty set', () => {
    const result = toggleSet(new Set(), 'a');
    expect(result.has('a')).toBe(true);
    expect(result.size).toBe(1);
  });

  it('adds key to existing set', () => {
    const result = toggleSet(new Set(['a']), 'b');
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(true);
    expect(result.size).toBe(2);
  });

  it('removes existing key', () => {
    const result = toggleSet(new Set(['a', 'b']), 'a');
    expect(result.has('a')).toBe(false);
    expect(result.has('b')).toBe(true);
    expect(result.size).toBe(1);
  });

  it('does not mutate original set', () => {
    const original = new Set(['a', 'b']);
    toggleSet(original, 'c');
    expect(original.size).toBe(2);
    expect(original.has('c')).toBe(false);
  });

  it('double toggle restores original', () => {
    const original = new Set(['a', 'b']);
    const toggled = toggleSet(original, 'c');
    const restored = toggleSet(toggled, 'c');
    expect([...restored]).toEqual([...original]);
  });

  it('toggle non-existent key twice adds and removes', () => {
    let s = new Set<string>();
    s = toggleSet(s, 'x');
    expect(s.has('x')).toBe(true);
    s = toggleSet(s, 'x');
    expect(s.has('x')).toBe(false);
    expect(s.size).toBe(0);
  });
});
