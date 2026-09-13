// Unit tests for SLA threshold clamping — the logic that enforces
// monotonic yellow/red thresholds inside useTicketSla.
//
// Both the clamp and RED_URGENT used to be redeclared here ("Same clamping logic as
// useTicketSla"), so the suite validated a copy. The clamp was worse than a copied
// function: production had no name for the expression at all, it was an inline object
// literal in the hook, so there was nothing to import and nothing a name-matching detector
// could flag. useTicketSla.ts now exports clampSlaThresholds() and calls it itself.

import { describe, it, expect } from 'vitest';
import {
  clampSlaThresholds as clampThresholds,
  RED_URGENT,
} from '@/features/kds/hooks/useTicketSla';

describe('clampThresholds', () => {
  it('passes through valid defaults (300, 600)', () => {
    const t = clampThresholds({ yellowAtSec: 300, redAtSec: 600 });
    expect(t.yellowAtSec).toBe(300);
    expect(t.redAtSec).toBe(600);
  });

  // ── Yellow clamping ─────────────────────────────────────────────

  it('clamps yellow minimum to 30', () => {
    expect(clampThresholds({ yellowAtSec: 0, redAtSec: 600 }).yellowAtSec).toBe(30);
    expect(clampThresholds({ yellowAtSec: 10, redAtSec: 600 }).yellowAtSec).toBe(30);
    expect(clampThresholds({ yellowAtSec: -5, redAtSec: 600 }).yellowAtSec).toBe(30);
  });

  // The bounds are expressed in terms of the imported RED_URGENT rather than the literals
  // 840/900: a test that hardcodes a derived constant keeps passing after someone changes
  // the real one and forgets the arithmetic, which is the same failure as copying it.
  it('clamps yellow maximum to RED_URGENT - 60', () => {
    expect(clampThresholds({ yellowAtSec: 900, redAtSec: 900 }).yellowAtSec)
      .toBe(RED_URGENT - 60);
    expect(clampThresholds({ yellowAtSec: 1000, redAtSec: 900 }).yellowAtSec)
      .toBe(RED_URGENT - 60);
  });

  it('passes yellow at boundary 30', () => {
    expect(clampThresholds({ yellowAtSec: 30, redAtSec: 600 }).yellowAtSec).toBe(30);
  });

  it('passes yellow at the upper boundary untouched', () => {
    expect(clampThresholds({ yellowAtSec: RED_URGENT - 60, redAtSec: 900 }).yellowAtSec)
      .toBe(RED_URGENT - 60);
  });

  // ── Red clamping ────────────────────────────────────────────────

  it('clamps red minimum to 60', () => {
    expect(clampThresholds({ yellowAtSec: 300, redAtSec: 0 }).redAtSec).toBe(60);
    expect(clampThresholds({ yellowAtSec: 300, redAtSec: 30 }).redAtSec).toBe(60);
  });

  it('clamps red maximum to RED_URGENT', () => {
    expect(clampThresholds({ yellowAtSec: 300, redAtSec: 1200 }).redAtSec).toBe(RED_URGENT);
  });

  it('passes red at boundary 60', () => {
    expect(clampThresholds({ yellowAtSec: 30, redAtSec: 60 }).redAtSec).toBe(60);
  });

  it('passes red at boundary 900', () => {
    expect(clampThresholds({ yellowAtSec: 840, redAtSec: 900 }).redAtSec).toBe(900);
  });

  // ── Both clamped ────────────────────────────────────────────────

  it('clamps both when both out of range', () => {
    const t = clampThresholds({ yellowAtSec: 0, redAtSec: 9999 });
    expect(t.yellowAtSec).toBe(30);
    expect(t.redAtSec).toBe(900);
  });

  it('preserves relationship yellow < red when both at minimum', () => {
    const t = clampThresholds({ yellowAtSec: 30, redAtSec: 60 });
    expect(t.yellowAtSec).toBeLessThan(t.redAtSec);
  });
});
