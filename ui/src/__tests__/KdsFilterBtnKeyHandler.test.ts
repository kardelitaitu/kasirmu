// Unit tests for the filter button keyboard handler — the logic that
// opens the filter panel and focuses the first/last option on
// ArrowDown/ArrowUp.

import { describe, it, expect } from 'vitest';

interface FilterBtnResult {
  open: boolean;
  focusTarget: 'first' | 'last' | null;
}

/** Pure logic from handleFilterBtnKeyDown. */
function handleFilterBtnKeyDown(
  key: string,
  currentOpen: boolean,
): FilterBtnResult {
  if (key === 'ArrowDown') {
    return { open: true, focusTarget: 'first' };
  }
  if (key === 'ArrowUp') {
    return { open: true, focusTarget: 'last' };
  }
  return { open: currentOpen, focusTarget: null };
}

describe('handleFilterBtnKeyDown', () => {
  it('ArrowDown opens panel and targets first option', () => {
    expect(handleFilterBtnKeyDown('ArrowDown', false)).toEqual({
      open: true,
      focusTarget: 'first',
    });
  });

  it('ArrowUp opens panel and targets last option', () => {
    expect(handleFilterBtnKeyDown('ArrowUp', false)).toEqual({
      open: true,
      focusTarget: 'last',
    });
  });

  it('Escape does not change state', () => {
    expect(handleFilterBtnKeyDown('Escape', true)).toEqual({
      open: true,
      focusTarget: null,
    });
    expect(handleFilterBtnKeyDown('Escape', false)).toEqual({
      open: false,
      focusTarget: null,
    });
  });

  it('Enter does not change state', () => {
    expect(handleFilterBtnKeyDown('Enter', false)).toEqual({
      open: false,
      focusTarget: null,
    });
  });

  it('Space does not change state', () => {
    expect(handleFilterBtnKeyDown(' ', true)).toEqual({
      open: true,
      focusTarget: null,
    });
  });

  it('ArrowDown works when panel is already open', () => {
    expect(handleFilterBtnKeyDown('ArrowDown', true)).toEqual({
      open: true,
      focusTarget: 'first',
    });
  });

  it('ArrowUp works when panel is already open', () => {
    expect(handleFilterBtnKeyDown('ArrowUp', true)).toEqual({
      open: true,
      focusTarget: 'last',
    });
  });
});
