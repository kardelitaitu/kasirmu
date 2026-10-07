// boardFiltered — whether any filter is active on the KDS board.
//
// The OPEN-tab half now IMPORTS production (2026-10-07): isBoardFiltered lives in
// features/kds/kdsOrderView.ts, extracted verbatim from KdsScreen.tsx:393-395, and
// the 'prepared wins over zones' case below is the same precedence pinned in
// KdsZoneExtraction.test.ts against filterKdsOrders. The COMPLETED half still
// delegates to its own comparison, because production reads a second source there
// (completedFilter) that this file models as a prop.
//
// One of five KDS suites that retyped production logic; see the header of
// KdsSettingsConversions.test.ts for the sweep.

import { describe, it, expect } from 'vitest';
import { isBoardFiltered } from '@/features/kds/kdsOrderView';

/** The tab dispatch the screen performs, with the open branch delegated. */
function boardFiltered(
  activeTab: 'open' | 'completed',
  completedFilter: 'all' | 'dinein' | 'takeaway',
  filterMode: 'all' | 'prepared',
  filterCats: Set<string> | null,
): boolean {
  return activeTab === 'completed'
    ? completedFilter !== 'all'
    : isBoardFiltered(filterMode, filterCats);
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
