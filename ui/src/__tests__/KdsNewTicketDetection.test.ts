// Unit tests for new ticket arrival detection — the pure logic that
// identifies newly arrived orders by comparing current vs previous ID sets.

import { describe, it, expect } from 'vitest';

/** Detect newly arrived order IDs (in current but not in previous). */
function detectNewIds(currentIds: Set<string>, prevIds: Set<string>): Set<string> {
  const arrived = new Set<string>();
  for (const id of currentIds) {
    if (!prevIds.has(id)) {
      arrived.add(id);
    }
  }
  return arrived;
}

describe('detectNewIds', () => {
  it('detects new arrivals on empty previous set', () => {
    const current = new Set(['a', 'b', 'c']);
    const result = detectNewIds(current, new Set());
    expect(result).toEqual(new Set(['a', 'b', 'c']));
  });

  it('detects no new arrivals when sets are identical', () => {
    const ids = new Set(['a', 'b', 'c']);
    expect(detectNewIds(ids, ids).size).toBe(0);
  });

  it('detects single new arrival', () => {
    const prev = new Set(['a', 'b']);
    const current = new Set(['a', 'b', 'c']);
    const result = detectNewIds(current, prev);
    expect(result).toEqual(new Set(['c']));
  });

  it('detects multiple new arrivals', () => {
    const prev = new Set(['a']);
    const current = new Set(['a', 'b', 'c', 'd']);
    const result = detectNewIds(current, prev);
    expect(result).toEqual(new Set(['b', 'c', 'd']));
  });

  it('does not include removed IDs', () => {
    const prev = new Set(['a', 'b', 'c']);
    const current = new Set(['a', 'd']);
    const result = detectNewIds(current, prev);
    expect(result).toEqual(new Set(['d']));
  });

  it('returns empty set when all current IDs were already known', () => {
    const prev = new Set(['a', 'b', 'c']);
    const current = new Set(['a', 'b']);
    expect(detectNewIds(current, prev).size).toBe(0);
  });

  it('handles empty current set', () => {
    expect(detectNewIds(new Set(), new Set(['a', 'b'])).size).toBe(0);
  });

  it('handles both empty sets', () => {
    expect(detectNewIds(new Set(), new Set()).size).toBe(0);
  });

  it('detects all new when previous is empty and current has items', () => {
    const current = new Set(['x', 'y']);
    expect(detectNewIds(current, new Set())).toEqual(new Set(['x', 'y']));
  });
});
