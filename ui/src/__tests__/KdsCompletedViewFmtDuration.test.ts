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
// Unit tests for fmtDuration (KdsCompletedView) — formats the duration
// between two ISO timestamps into "Xs", "Xm Ys", or "Xh Ym".

import { describe, it, expect } from 'vitest';
import { fmtDuration } from '@/features/kds/KdsCompletedView';

describe('fmtDuration (completed view)', () => {
  // ── Seconds only (< 60s) ───────────────────────────────────────

  it('formats 0 seconds (same timestamps)', () => {
    expect(fmtDuration('2026-01-01T10:00:00Z', '2026-01-01T10:00:00Z')).toBe('0s');
  });

  it('formats 30 seconds', () => {
    expect(fmtDuration('2026-01-01T10:00:00Z', '2026-01-01T10:00:30Z')).toBe('30s');
  });

  it('formats 59 seconds (just under 1 min)', () => {
    expect(fmtDuration('2026-01-01T10:00:00Z', '2026-01-01T10:00:59Z')).toBe('59s');
  });

  // ── Minutes + seconds ───────────────────────────────────────────

  it('formats exactly 60 seconds as 1m 0s', () => {
    expect(fmtDuration('2026-01-01T10:00:00Z', '2026-01-01T10:01:00Z')).toBe('1m 0s');
  });

  it('formats 90 seconds as 1m 30s', () => {
    expect(fmtDuration('2026-01-01T10:00:00Z', '2026-01-01T10:01:30Z')).toBe('1m 30s');
  });

  it('formats 3599 seconds as 59m 59s (just under 1 hr)', () => {
    expect(fmtDuration('2026-01-01T10:00:00Z', '2026-01-01T10:59:59Z')).toBe('59m 59s');
  });

  // ── Hours + minutes (> 1 hr) ───────────────────────────────────

  it('formats exactly 3600 seconds as 1h 0m', () => {
    expect(fmtDuration('2026-01-01T10:00:00Z', '2026-01-01T11:00:00Z')).toBe('1h 0m');
  });

  it('formats 3661 seconds as 1h 1m', () => {
    expect(fmtDuration('2026-01-01T10:00:00Z', '2026-01-01T11:01:01Z')).toBe('1h 1m');
  });

  it('formats 7200 seconds as 2h 0m', () => {
    expect(fmtDuration('2026-01-01T10:00:00Z', '2026-01-01T12:00:00Z')).toBe('2h 0m');
  });

  // ── Large values ────────────────────────────────────────────────

  it('formats 86400 seconds (24 hr) as 24h 0m', () => {
    expect(fmtDuration('2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z')).toBe('24h 0m');
  });

  // ── Reverse order (to < from) ───────────────────────────────────

  it('clamps to 0s when to < from (Math.max protection)', () => {
    expect(fmtDuration('2026-01-01T10:01:00Z', '2026-01-01T10:00:00Z')).toBe('0s');
  });
});
