// Unit tests for deselection — the logic that clears the selected
// order when it's no longer in the filtered list.

import { describe, it, expect } from 'vitest';

/** Same deselect logic as KdsScreen.tsx useEffect. */
function shouldDeselect(selectedId: string | null, filteredIds: string[]): string | null {
  if (selectedId && !filteredIds.includes(selectedId)) {
    return null;
  }
  return selectedId;
}

describe('shouldDeselect', () => {
  it('clears selection when selected order is filtered out', () => {
    expect(shouldDeselect('order-1', ['order-2', 'order-3'])).toBeNull();
  });

  it('keeps selection when selected order is in filtered list', () => {
    expect(shouldDeselect('order-1', ['order-1', 'order-2'])).toBe('order-1');
  });

  it('keeps null selection (no-op)', () => {
    expect(shouldDeselect(null, ['order-1'])).toBeNull();
  });

  it('clears selection when filtered list is empty', () => {
    expect(shouldDeselect('order-1', [])).toBeNull();
  });

  it('keeps selection in first position', () => {
    expect(shouldDeselect('order-1', ['order-1'])).toBe('order-1');
  });

  it('keeps selection in last position', () => {
    expect(shouldDeselect('order-3', ['order-1', 'order-2', 'order-3'])).toBe('order-3');
  });

  it('clears when filtered list changes and selected is gone', () => {
    expect(shouldDeselect('order-5', ['order-1', 'order-2'])).toBeNull();
  });
});
