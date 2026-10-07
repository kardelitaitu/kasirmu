// Unit tests for KDS settings value conversions — the pure mappings
// between UI slider values (minutes) and internal thresholds (seconds),
// and the density→compact class determination.
//
// PARTLY LOAD-BEARING, and the split matters. Two of the three mappings below
// now IMPORT production instead of restating it, so their cases fail when the
// real bound moves:
//   stepDensity / compactClass -> @/features/kds/kdsDensity (extracted 2026-10-07
//     out of KdsHamburgerPanel.tsx:315,317 and KdsMainContent.tsx:132, which now
//     call the module — the same move kdsThresholdMinutes.ts and useTicketSla.ts
//     already record for the SLA bounds).
// The third is still a retyped copy and CANNOT fail:
//   minutes*60 -> KdsScreen.tsx:323-326, still inline inside the slaThresholds
//     useMemo. Extracting it means threading SlaThresholds through a memo that
//     also feeds every ticket card, so it is deliberately left for a dedicated
//     pass rather than folded into this one. Its cases below remain documentation
//     of the mapping, not a guard on it.
//
// THIS FILE IS ONE OF FIVE with the same property, all in this feature. Across
// ui/src the pattern was swept for and adjudicated: of the test files whose own
// comments claim to mirror production, twelve name a module without importing
// it, and every one outside KDS turned out to be a false positive — Topology
// Screen and SettingsContext render or mount the real thing, dev-mock-scoped-
// aliases reads the real registry ("real registry, not a fixture", :181), and
// cartExtraction / screenExtraction.utils read real files or import the real
// util. The five below are the genuine remainder, each retyping logic that lives
// inline in a component body:
//   KdsBoardFiltered         -> boardFiltered, KdsScreen.tsx:393
//   KdsDeselectOnFilter      -> the deselect effect, now really covered by
//                               useKdsShortcuts.test.tsx (2026-10-07)
//   KdsOrderFiltering        -> filteredOrders, KdsScreen.tsx:312-318
//   KdsSettingsConversions   -> this file, three sites above
//   KdsZoneExtraction        -> zones / filterByZones / filterByStatus,
//                               KdsScreen.tsx:303-309
//
// This is not a reason to delete them — the mappings are worth stating, and the
// component suites cover the behaviour independently (KdsHamburgerPanel.test.tsx
// renders the real panel and asserts its steppers). It IS the reason the copies
// are labelled here rather than left looking like real coverage, and it is why
// extracting these three mappings into a pure module — the shape kdsStatus.ts
// and kdsSettingsModel.ts already use — is the change that would make every case
// below load-bearing. Until then, read this file as documentation of the
// mapping, not as a guard on it.

import { describe, it, expect } from 'vitest';

/** Same conversion as KdsScreen.tsx slaThresholds useMemo. */
function toSlaThresholds(yellowMin: number, redMin: number) {
  return {
    yellowAtSec: yellowMin * 60,
    redAtSec: redMin * 60,
  };
}

import { compactClass, stepDensity } from '@/features/kds/kdsDensity';

describe('toSlaThresholds', () => {
  it('converts default thresholds (5 min / 10 min)', () => {
    const t = toSlaThresholds(5, 10);
    expect(t.yellowAtSec).toBe(300);
    expect(t.redAtSec).toBe(600);
  });

  it('converts minimum thresholds (3 min / 4 min)', () => {
    const t = toSlaThresholds(3, 4);
    expect(t.yellowAtSec).toBe(180);
    expect(t.redAtSec).toBe(240);
  });

  it('converts maximum thresholds (30 min / 60 min)', () => {
    const t = toSlaThresholds(30, 60);
    expect(t.yellowAtSec).toBe(1800);
    expect(t.redAtSec).toBe(3600);
  });

  it('converts 1 min / 2 min', () => {
    const t = toSlaThresholds(1, 2);
    expect(t.yellowAtSec).toBe(60);
    expect(t.redAtSec).toBe(120);
  });

  it('converts 0 min (edge case)', () => {
    const t = toSlaThresholds(0, 0);
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
