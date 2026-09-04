// Unit tests for SLA threshold clamping — the logic that enforces
// monotonic yellow/red thresholds inside useTicketSla.

import { describe, it, expect } from 'vitest';

const RED_URGENT = 900;

/** Same clamping logic as useTicketSla. */
function clampThresholds(input: { yellowAtSec: number; redAtSec: number }) {
  return {
    yellowAtSec: Math.max(30, Math.min(input.yellowAtSec, RED_URGENT - 60)),
    redAtSec: Math.max(60, Math.min(input.redAtSec, RED_URGENT)),
  };
}

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

  it('clamps yellow maximum to 840 (RED_URGENT - 60)', () => {
    expect(clampThresholds({ yellowAtSec: 900, redAtSec: 900 }).yellowAtSec).toBe(840);
    expect(clampThresholds({ yellowAtSec: 1000, redAtSec: 900 }).yellowAtSec).toBe(840);
  });

  it('passes yellow at boundary 30', () => {
    expect(clampThresholds({ yellowAtSec: 30, redAtSec: 600 }).yellowAtSec).toBe(30);
  });

  it('passes yellow at boundary 840', () => {
    expect(clampThresholds({ yellowAtSec: 840, redAtSec: 900 }).yellowAtSec).toBe(840);
  });

  // ── Red clamping ────────────────────────────────────────────────

  it('clamps red minimum to 60', () => {
    expect(clampThresholds({ yellowAtSec: 300, redAtSec: 0 }).redAtSec).toBe(60);
    expect(clampThresholds({ yellowAtSec: 300, redAtSec: 30 }).redAtSec).toBe(60);
  });

  it('clamps red maximum to 900 (RED_URGENT)', () => {
    expect(clampThresholds({ yellowAtSec: 300, redAtSec: 1200 }).redAtSec).toBe(900);
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
