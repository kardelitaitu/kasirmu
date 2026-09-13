// Unit tests for formatElapsed — pure function that formats elapsed
// seconds into short display strings like "5m 30s" or "2h 5m".

import { describe, it, expect } from 'vitest';
import { formatElapsed } from '@/features/kds/hooks/useTicketSla';

describe('formatElapsed', () => {
  // ── Seconds only (m === 0) ──────────────────────────────────────

  it('formats 0 seconds', () => {
    expect(formatElapsed(0)).toBe('0s');
  });

  it('formats 1 second', () => {
    expect(formatElapsed(1)).toBe('1s');
  });

  it('formats 59 seconds (just under 1 min)', () => {
    expect(formatElapsed(59)).toBe('59s');
  });

  // ── Minutes only (s === 0, m > 0) ───────────────────────────────

  it('formats exactly 60 seconds as 1m', () => {
    expect(formatElapsed(60)).toBe('1m');
  });

  it('formats exactly 1800 seconds as 30m', () => {
    expect(formatElapsed(1800)).toBe('30m');
  });

  it('formats exactly 3540 seconds as 59m', () => {
    expect(formatElapsed(3540)).toBe('59m');
  });

  // ── Minutes + seconds ───────────────────────────────────────────

  it('formats 61 seconds as 1m 1s', () => {
    expect(formatElapsed(61)).toBe('1m 1s');
  });

  it('formats 90 seconds as 1m 30s', () => {
    expect(formatElapsed(90)).toBe('1m 30s');
  });

  it('formats 3599 seconds as 59m 59s (just under 1 hr)', () => {
    expect(formatElapsed(3599)).toBe('59m 59s');
  });

  // ── Hours (> 3600s — no hours formatter, goes to Xm Ys) ─────────

  it('formats 3600 seconds as 60m (no hours branch)', () => {
    expect(formatElapsed(3600)).toBe('60m');
  });

  it('formats 3661 seconds as 61m 1s', () => {
    expect(formatElapsed(3661)).toBe('61m 1s');
  });

  it('formats 86400 seconds (24 hr) as 1440m', () => {
    expect(formatElapsed(86400)).toBe('1440m');
  });

  // ── Negative values ─────────────────────────────────────────────

  it('formats -1 as -1m -1s (JS modulo preserves sign)', () => {
    // Math.floor(-1/60) = -1, -1 % 60 = -1 → "-1m -1s"
    expect(formatElapsed(-1)).toBe('-1m -1s');
  });

  it('formats -60 as -1m (exact negative minute)', () => {
    // Math.floor(-60/60) = -1, -60 % 60 = 0 → "-1m"
    expect(formatElapsed(-60)).toBe('-1m');
  });
});
