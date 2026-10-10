// Unit tests for KDS settings value conversions — the pure mappings
// between UI slider values (minutes) and internal thresholds (seconds),
// and the density→compact class determination.
//
// FULLY LOAD-BEARING as of 2026-10-07. Every mapping below now IMPORTS
// production instead of restating it, so a moved bound fails a case here:
//   minutesToSlaThresholds -> @/features/kds/hooks/useTicketSla
//   stepDensity / compactClass -> @/features/kds/kdsDensity
//
// Both were extractions, not rewrites: the expressions were lifted verbatim out
// of the inline sites and the sites now call them —
//   yellowMin * 60 / redMin * 60  -> was KdsScreen.tsx:323-326 (slaThresholds useMemo)
//   Math.max(1, d - 1)            -> was KdsHamburgerPanel.tsx:315
//   Math.min(5, d + 1)            -> was KdsHamburgerPanel.tsx:317
//   d <= 2 ? ' kds--compact' : '' -> was KdsMainContent.tsx:132
// This is the move useTicketSla.ts:66-90 and kdsThresholdMinutes.ts already
// record for the SLA clamps, and for the same stated reason: a retyped copy is
// invisible to a name-matching detector because there is no name to collide
// with, and only naming the expression makes it testable.
//
// WHAT THE EXTRACTION CAUGHT: adopting the real compactClass failed two cases
// immediately, because the copy had returned 'kds--compact' with NO leading
// space while production emits ' kds--compact' (the separator belongs to the
// function; the call site interpolates it straight after the base class). The
// copy was not merely inert — it asserted a value production never produces.
//
// Still retyped elsewhere in this feature, and NOT covered by this file:
//   KdsBoardFiltered    -> boardFiltered,   KdsScreen.tsx:393
//   KdsOrderFiltering   -> filteredOrders,  KdsScreen.tsx:312-318
//   KdsZoneExtraction   -> zones + the zone/status filters, KdsScreen.tsx:303-309
// Those three read memos that close over screen state; extracting them is the
// same opportunity and a separate pass.
//
// History: this file was one of five that retyped production logic and could not
// fail. Across ui/src that pattern was swept for and adjudicated — of the test
// files whose comments claim to mirror production, twelve name a module without
// importing it, and every one outside KDS was a false positive (TopologyScreen
// and SettingsContext render or mount the real thing; dev-mock-scoped-aliases
// reads the real registry, "real registry, not a fixture", :181; cartExtraction
// and screenExtraction.utils read real files or import the real util).
//
// A SECOND SWEEP looked for the sibling failure mode — a test that LOOKS like
// coverage because it feeds a prop an empty default (new Set() / [] / {}), the
// shape that hid the arrival diff in KdsScreen (see kdsArrivalDiff.test.ts).
// It found twelve such sites across ui/src and adjudicated every one: NONE is a
// stub. Each is the SUBJECT of an explicit empty-state case that sits beside
// populated ones — chartsA11y's "empty dataset: no data list is rendered",
// RestaurantFloatingCartBar's "renders empty cart state", the
// topologyValidationWidget's "empty panel when no issues", and LiveSetupPreview's
// "shows only admin workspace as active when no features are enabled" (which
// renders the same component again with real feature sets in the next cases).
// Recorded because a negative result still needs a home: the next reader should
// not re-run this sweep on a hunch.

import { describe, it, expect } from 'vitest';
import { clampDensity, compactClass, stepDensity } from '@/features/kds/kdsDensity';
import { minutesToSlaThresholds } from '@/features/kds/hooks/useTicketSla';


describe('clampDensity', () => {
  // Extracted 2026-10-09 from WorkspaceKdsSettings.tsx:119, which held the FOURTH
  // inline copy of the 1..5 range as `Math.min(5, Math.max(1, …))`. The header above
  // lists the three sites this module was created for and does not know about that
  // one — a settings card hydrating an unset or hand-edited stored value. Widening
  // DENSITY_MAX used to leave the card accepting a density the board would not render.
  it('passes a legal value through unchanged', () => {
    expect(clampDensity(1)).toBe(1);
    expect(clampDensity(3)).toBe(3);
    expect(clampDensity(5)).toBe(5);
  });

  it('raises a below-range value to the floor', () => {
    expect(clampDensity(0)).toBe(1);
    expect(clampDensity(-4)).toBe(1);
  });

  it('lowers an above-range value to the ceiling', () => {
    expect(clampDensity(6)).toBe(5);
    expect(clampDensity(99)).toBe(5);
  });

  it('agrees with the stepper bounds rather than restating them', () => {
    // A relationship case, not a literal one: if DENSITY_MIN/MAX move, the stepper
    // and the clamp must move together or this fails.
    expect(clampDensity(Number.NEGATIVE_INFINITY)).toBe(stepDensity(1, 'down'));
    expect(clampDensity(Number.POSITIVE_INFINITY)).toBe(stepDensity(5, 'up'));
  });
});

describe('minutesToSlaThresholds', () => {
  it('converts default thresholds (5 min / 10 min)', () => {
    const t = minutesToSlaThresholds(5, 10);
    expect(t.yellowAtSec).toBe(300);
    expect(t.redAtSec).toBe(600);
  });

  it('converts minimum thresholds (3 min / 4 min)', () => {
    const t = minutesToSlaThresholds(3, 4);
    expect(t.yellowAtSec).toBe(180);
    expect(t.redAtSec).toBe(240);
  });

  it('converts maximum thresholds (30 min / 60 min)', () => {
    const t = minutesToSlaThresholds(30, 60);
    expect(t.yellowAtSec).toBe(1800);
    expect(t.redAtSec).toBe(3600);
  });

  it('converts 1 min / 2 min', () => {
    const t = minutesToSlaThresholds(1, 2);
    expect(t.yellowAtSec).toBe(60);
    expect(t.redAtSec).toBe(120);
  });

  it('converts 0 min (edge case)', () => {
    const t = minutesToSlaThresholds(0, 0);
    expect(t.yellowAtSec).toBe(0);
    expect(t.redAtSec).toBe(0);
  });
});

describe('compactClass', () => {
  // The expected values carry a LEADING SPACE, which is the production contract:
  // the call site interpolates the result straight after 'kds-content-wrap', so
  // the separator belongs to this function. The retyped copy this suite used to
  // hold returned 'kds--compact' with no space and asserted that — the copy was
  // not merely inert, it was WRONG, and adopting the real module is what exposed
  // it (both cases failed on the first run after the swap).
  it('density 1 → compact, with the leading separator the call site needs', () => {
    expect(compactClass(1)).toBe(' kds--compact');
  });

  it('density 2 → compact', () => {
    expect(compactClass(2)).toBe(' kds--compact');
  });

  it('density 3 → not compact', () => {
    expect(compactClass(3)).toBe('');
  });

  it('density 4 → not compact', () => {
    expect(compactClass(4)).toBe('');
  });

  it('density 5 → not compact', () => {
    expect(compactClass(5)).toBe('');
  });
});

describe('stepDensity', () => {
  it('decrease from 3 → 2', () => {
    expect(stepDensity(3, 'down')).toBe(2);
  });

  it('decrease from 1 → 1 (floor)', () => {
    expect(stepDensity(1, 'down')).toBe(1);
  });

  it('decrease from 2 → 1', () => {
    expect(stepDensity(2, 'down')).toBe(1);
  });

  it('increase from 3 → 4', () => {
    expect(stepDensity(3, 'up')).toBe(4);
  });

  it('increase from 5 → 5 (ceiling)', () => {
    expect(stepDensity(5, 'up')).toBe(5);
  });

  it('increase from 4 → 5', () => {
    expect(stepDensity(4, 'up')).toBe(5);
  });
});
