/**
 * @vitest-environment node
 *
 * This file's import graph is free of browser globals (no render, no
 * `document`/`window`/`localStorage`), so it does not need a jsdom window. Vitest
 * spawns a fresh jsdom per test FILE, which measured ~0.4-0.9s each; under the node
 * environment the same files report `environment: 0ms`.
 *
 * Do not copy this directive onto a file that renders or touches browser state —
 * it will fail with "document is not defined" rather than silently degrade.
 */
// Unit tests for fmtDuration — pure function that formats seconds into
// human-readable strings: "3m 12s", "1h 5m", etc.

import { describe, it, expect } from 'vitest';
import { fmtDuration } from '@/features/kds/components/KdsTicketCard';

describe('fmtDuration', () => {
  // ── Seconds only (< 60) ────────────────────────────────────────

  it('formats zero seconds', () => {
    expect(fmtDuration(0)).toBe('0s');
  });

  it('formats 1 second', () => {
    expect(fmtDuration(1)).toBe('1s');
  });

  it('formats 59 seconds (just under a minute)', () => {
    expect(fmtDuration(59)).toBe('59s');
  });

  // ── Minutes only (< 1hr, no remainder) ──────────────────────────

  it('formats exactly 60 seconds as 1m', () => {
    expect(fmtDuration(60)).toBe('1m');
  });

  it('formats exactly 1800 seconds as 30m', () => {
    expect(fmtDuration(1800)).toBe('30m');
  });

  it('formats 3599 seconds as 59m 59s (just under 1hr)', () => {
    expect(fmtDuration(3599)).toBe('59m 59s');
  });

  // ── Minutes + seconds ───────────────────────────────────────────

  it('formats 90 seconds as 1m 30s', () => {
    expect(fmtDuration(90)).toBe('1m 30s');
  });

  it('formats 61 seconds as 1m 1s', () => {
    expect(fmtDuration(61)).toBe('1m 1s');
  });

  it('formats 3540 seconds as 59m (exact minute, no seconds)', () => {
    expect(fmtDuration(3540)).toBe('59m');
  });

  // ── Hours + minutes (> 1hr) ────────────────────────────────────

  it('formats exactly 3600 seconds as 1h 0m', () => {
    expect(fmtDuration(3600)).toBe('1h 0m');
  });

  it('formats 3661 seconds as 1h 1m', () => {
    expect(fmtDuration(3661)).toBe('1h 1m');
  });

  it('formats 7200 seconds as 2h 0m', () => {
    expect(fmtDuration(7200)).toBe('2h 0m');
  });

  // ── Large values ────────────────────────────────────────────────

  it('formats 86400 seconds (24hr) as 24h 0m', () => {
    expect(fmtDuration(86400)).toBe('24h 0m');
  });

  it('formats 90061 seconds (25h 1m 1s) as 25h 1m', () => {
    expect(fmtDuration(90061)).toBe('25h 1m');
  });
});
