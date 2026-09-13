// Unit tests for filter dropdown keyboard navigation — the pure index
// arithmetic used by handleFilterPanelKeyDown in KdsScreen.tsx.

import { describe, it, expect } from 'vitest';

/** ArrowDown index resolver with wrapping. */
function filterNextDown(currentIndex: number, optionCount: number): number {
  return currentIndex < 0 ? 0 : (currentIndex + 1) % optionCount;
}

/** ArrowUp index resolver with wrapping. */
function filterNextUp(currentIndex: number, optionCount: number): number {
  return currentIndex < 0 ? optionCount - 1 : (currentIndex - 1 + optionCount) % optionCount;
}

const options = ['All', 'Prepared', 'Front', 'Back'];

describe('filterNextDown (ArrowDown)', () => {
  it('no focus → first option', () => {
    expect(filterNextDown(-1, options.length)).toBe(0);
  });

  it('first → second', () => {
    expect(filterNextDown(0, options.length)).toBe(1);
  });

  it('second → third', () => {
    expect(filterNextDown(1, options.length)).toBe(2);
  });

  it('last → wraps to first', () => {
    expect(filterNextDown(3, options.length)).toBe(0);
  });

  it('single option wraps to itself', () => {
    expect(filterNextDown(0, 1)).toBe(0);
  });
});

describe('filterNextUp (ArrowUp)', () => {
  it('no focus → last option', () => {
    expect(filterNextUp(-1, options.length)).toBe(3);
  });

  it('last → second-to-last', () => {
    expect(filterNextUp(3, options.length)).toBe(2);
  });

  it('first → wraps to last', () => {
    expect(filterNextUp(0, options.length)).toBe(3);
  });

  it('single option wraps to itself', () => {
    expect(filterNextUp(0, 1)).toBe(0);
  });

  it('second → first', () => {
    expect(filterNextUp(1, options.length)).toBe(0);
  });
});

describe('edge cases', () => {
  it('two options cycle correctly', () => {
    expect(filterNextDown(0, 2)).toBe(1);
    expect(filterNextDown(1, 2)).toBe(0);
    expect(filterNextUp(0, 2)).toBe(1);
    expect(filterNextUp(1, 2)).toBe(0);
  });

  it('full cycle returns to start (ArrowDown)',  () => {
    let idx = 0;
    for (let i = 0; i < options.length; i++) {
      idx = filterNextDown(idx, options.length);
    }
    expect(idx).toBe(0);
  });

  it('full cycle returns to start (ArrowUp)', () => {
    let idx = 0;
    for (let i = 0; i < options.length; i++) {
      idx = filterNextUp(idx, options.length);
    }
    expect(idx).toBe(0);
  });
});
