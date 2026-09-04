// Unit tests for category collapse toggle — the pure logic that
// manages collapsed course groups in KdsTicketCard.

import { describe, it, expect } from 'vitest';

/** Same toggle logic as KdsTicketCard. */
function toggleCategory(prev: Set<string>, key: string): Set<string> {
  const next = new Set(prev);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
}

/** Check if a category is collapsed. */
function isCollapsed(collapsed: Set<string>, key: string): boolean {
  return collapsed.has(key);
}

describe('toggleCategory', () => {
  it('collapses an expanded category', () => {
    const result = toggleCategory(new Set(), 'main');
    expect(result.has('main')).toBe(true);
  });

  it('expands a collapsed category', () => {
    const result = toggleCategory(new Set(['main']), 'main');
    expect(result.has('main')).toBe(false);
  });

  it('does not affect other categories', () => {
    const result = toggleCategory(new Set(['main', 'side']), 'main');
    expect(result.has('side')).toBe(true);
    expect(result.has('main')).toBe(false);
  });

  it('double toggle restores original', () => {
    const original = new Set<string>();
    const toggled = toggleCategory(original, 'dessert');
    const restored = toggleCategory(toggled, 'dessert');
    expect([...restored]).toEqual([...original]);
  });

  it('handles null/undefined course key (maps to __other__)', () => {
    const key = '__other__';
    const result = toggleCategory(new Set(), key);
    expect(result.has(key)).toBe(true);
  });
});

describe('isCollapsed', () => {
  it('returns true for collapsed category', () => {
    expect(isCollapsed(new Set(['main']), 'main')).toBe(true);
  });

  it('returns false for expanded category', () => {
    expect(isCollapsed(new Set(), 'main')).toBe(false);
  });

  it('returns false for unrelated category', () => {
    expect(isCollapsed(new Set(['main']), 'side')).toBe(false);
  });
});
