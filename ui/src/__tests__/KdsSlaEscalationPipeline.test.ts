// Unit tests for the full SLA escalation pipeline — combining
// computeLevel with the urgent flag to verify the complete
// green→yellow→red→red-urgent progression.

import { describe, it, expect } from 'vitest';
import { computeLevel } from '@/features/kds/hooks/useTicketSla';
import type { SlaThresholds } from '@/features/kds/hooks/useTicketSla';

const RED_URGENT = 900;
const DEFAULTS: SlaThresholds = { yellowAtSec: 300, redAtSec: 600 };

function isUrgent(elapsed: number): boolean {
  return elapsed >= RED_URGENT;
}

function classify(elapsed: number, t: SlaThresholds = DEFAULTS) {
  const level = computeLevel(elapsed, t);
  const urgent = isUrgent(elapsed);
  return { level, urgent };
}

describe('full SLA escalation pipeline', () => {
  it('0s → green, not urgent', () => {
    expect(classify(0)).toEqual({ level: 'green', urgent: false });
  });

  it('299s → green, not urgent', () => {
    expect(classify(299)).toEqual({ level: 'green', urgent: false });
  });

  it('300s → yellow, not urgent', () => {
    expect(classify(300)).toEqual({ level: 'yellow', urgent: false });
  });

  it('599s → yellow, not urgent', () => {
    expect(classify(599)).toEqual({ level: 'yellow', urgent: false });
  });

  it('600s → red, not urgent', () => {
    expect(classify(600)).toEqual({ level: 'red', urgent: false });
  });

  it('899s → red, not urgent (just under threshold)', () => {
    expect(classify(899)).toEqual({ level: 'red', urgent: false });
  });

  it('900s → red, urgent (exact threshold)', () => {
    expect(classify(900)).toEqual({ level: 'red', urgent: true });
  });

  it('901s → red, urgent', () => {
    expect(classify(901)).toEqual({ level: 'red', urgent: true });
  });

  it('3600s (1hr) → red, urgent', () => {
    expect(classify(3600)).toEqual({ level: 'red', urgent: true });
  });

  it('86400s (24hr) → red, urgent', () => {
    expect(classify(86400)).toEqual({ level: 'red', urgent: true });
  });

  // ── Custom thresholds ───────────────────────────────────────────

  it('custom yellow=60 red=120 → correct pipeline', () => {
    const t = { yellowAtSec: 60, redAtSec: 120 };
    expect(classify(0, t)).toEqual({ level: 'green', urgent: false });
    expect(classify(60, t)).toEqual({ level: 'yellow', urgent: false });
    expect(classify(119, t)).toEqual({ level: 'yellow', urgent: false });
    expect(classify(120, t)).toEqual({ level: 'red', urgent: false });
    expect(classify(900, t)).toEqual({ level: 'red', urgent: true });
  });

  // ── Urgent is independent of thresholds ─────────────────────────

  it('urgent fires at 900s regardless of redAtSec', () => {
    const t = { yellowAtSec: 30, redAtSec: 60 };
    expect(classify(900, t)).toEqual({ level: 'red', urgent: true });
  });

  it('urgent at 900s even with very high thresholds', () => {
    const t = { yellowAtSec: 800, redAtSec: 1000 };
    expect(classify(900, t)).toEqual({ level: 'yellow', urgent: true });
  });
});
