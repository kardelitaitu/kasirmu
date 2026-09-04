// Unit tests for computeLevel — pure function that determines SLA
// escalation level (green/yellow/red) from elapsed seconds and thresholds.

import { describe, it, expect } from 'vitest';
import { computeLevel } from '@/features/kds/hooks/useTicketSla';
import type { SlaThresholds } from '@/features/kds/hooks/useTicketSla';

/** Default thresholds: 5 min yellow (300s), 10 min red (600s). */
const DEFAULTS: SlaThresholds = { yellowAtSec: 300, redAtSec: 600 };

describe('computeLevel', () => {
  // ── Green zone (below yellow threshold) ──────────────────────────

  it('returns green for 0 seconds', () => {
    expect(computeLevel(0, DEFAULTS)).toBe('green');
  });

  it('returns green for 1 second', () => {
    expect(computeLevel(1, DEFAULTS)).toBe('green');
  });

  it('returns green for 299 seconds (just under yellow)', () => {
    expect(computeLevel(299, DEFAULTS)).toBe('green');
  });

  // ── Yellow zone (between yellow and red thresholds) ──────────────

  it('returns yellow at exactly yellowAtSec (300s)', () => {
    expect(computeLevel(300, DEFAULTS)).toBe('yellow');
  });

  it('returns yellow at 301 seconds', () => {
    expect(computeLevel(301, DEFAULTS)).toBe('yellow');
  });

  it('returns yellow at 599 seconds (just under red)', () => {
    expect(computeLevel(599, DEFAULTS)).toBe('yellow');
  });

  it('returns yellow at the midpoint (450s)', () => {
    expect(computeLevel(450, DEFAULTS)).toBe('yellow');
  });

  // ── Red zone (at or above red threshold) ─────────────────────────

  it('returns red at exactly redAtSec (600s)', () => {
    expect(computeLevel(600, DEFAULTS)).toBe('red');
  });

  it('returns red at 601 seconds', () => {
    expect(computeLevel(601, DEFAULTS)).toBe('red');
  });

  it('returns red at 900 seconds (15 min — urgent threshold)', () => {
    expect(computeLevel(900, DEFAULTS)).toBe('red');
  });

  it('returns red at 3600 seconds (1 hour)', () => {
    expect(computeLevel(3600, DEFAULTS)).toBe('red');
  });

  // ── Custom thresholds ────────────────────────────────────────────

  it('respects custom yellow threshold', () => {
    const t: SlaThresholds = { yellowAtSec: 120, redAtSec: 600 };
    expect(computeLevel(119, t)).toBe('green');
    expect(computeLevel(120, t)).toBe('yellow');
  });

  it('respects custom red threshold', () => {
    const t: SlaThresholds = { yellowAtSec: 300, redAtSec: 900 };
    expect(computeLevel(899, t)).toBe('yellow');
    expect(computeLevel(900, t)).toBe('red');
  });

  it('respects custom thresholds with narrow gap', () => {
    const t: SlaThresholds = { yellowAtSec: 60, redAtSec: 120 };
    expect(computeLevel(59, t)).toBe('green');
    expect(computeLevel(60, t)).toBe('yellow');
    expect(computeLevel(119, t)).toBe('yellow');
    expect(computeLevel(120, t)).toBe('red');
  });

  // ── Edge cases ───────────────────────────────────────────────────

  it('returns green for negative elapsed (clock skew)', () => {
    expect(computeLevel(-10, DEFAULTS)).toBe('green');
  });

  it('handles very large elapsed values', () => {
    expect(computeLevel(86400, DEFAULTS)).toBe('red'); // 24 hours
  });

  it('handles yellowAtSec equal to redAtSec (degenerate)', () => {
    const t: SlaThresholds = { yellowAtSec: 300, redAtSec: 300 };
    // elapsed < 300 → green, elapsed < 300 → yellow (never reached), else red
    expect(computeLevel(299, t)).toBe('green');
    expect(computeLevel(300, t)).toBe('red');
  });

  it('handles very small thresholds', () => {
    const t: SlaThresholds = { yellowAtSec: 1, redAtSec: 2 };
    expect(computeLevel(0, t)).toBe('green');
    expect(computeLevel(1, t)).toBe('yellow');
    expect(computeLevel(2, t)).toBe('red');
  });
});
