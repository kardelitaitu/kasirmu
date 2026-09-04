// Unit tests for boardFiltered — the boolean expression that determines
// whether any filter is active on the KDS board.

import { describe, it, expect } from 'vitest';

/** Same logic as KdsScreen.tsx boardFiltered. */
function boardFiltered(
  activeTab: 'open' | 'completed',
  completedFilter: 'all' | 'dinein' | 'takeaway',
  filterMode: 'all' | 'prepared',
  filterCats: Set<string> | null,
): boolean {
  return activeTab === 'completed'
    ? completedFilter !== 'all'
    : (filterMode === 'prepared' || (filterCats !== null && filterCats.size > 0));
}

describe('boardFiltered', () => {
  // ── Completed tab ───────────────────────────────────────────────

  it('completed tab + all filter → not filtered', () => {
    expect(boardFiltered('completed', 'all', 'all', null)).toBe(false);
  });

  it('completed tab + dinein filter → filtered', () => {
    expect(boardFiltered('completed', 'dinein', 'all', null)).toBe(true);
  });

  it('completed tab + takeaway filter → filtered', () => {
    expect(boardFiltered('completed', 'takeaway', 'all', null)).toBe(true);
  });

  // ── Open tab — prepared mode ────────────────────────────────────

  it('open tab + prepared mode → filtered', () => {
    expect(boardFiltered('open', 'all', 'prepared', null)).toBe(true);
  });

  it('open tab + all mode + no zones → not filtered', () => {
    expect(boardFiltered('open', 'all', 'all', null)).toBe(false);
  });

  it('open tab + all mode + empty zone set → not filtered', () => {
    expect(boardFiltered('open', 'all', 'all', new Set())).toBe(false);
  });

  it('open tab + all mode + zones selected → filtered', () => {
    expect(boardFiltered('open', 'all', 'all', new Set(['front']))).toBe(true);
  });

  it('open tab + all mode + multiple zones → filtered', () => {
    expect(boardFiltered('open', 'all', 'all', new Set(['front', 'back']))).toBe(true);
  });

  // ── Open tab — prepared overrides zones ─────────────────────────

  it('open tab + prepared + zones → filtered (prepared wins)', () => {
    expect(boardFiltered('open', 'all', 'prepared', new Set(['front']))).toBe(true);
  });
});
