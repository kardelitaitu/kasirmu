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
// Unit tests for formatClock — pure function that formats a Date into
// a compact clock string like "05 Sep 14:30" for the KDS footer.

import { describe, it, expect } from 'vitest';
import { formatClock } from '@/features/kds/KdsScreenFooter';

describe('formatClock', () => {
  const date = new Date('2026-09-05T14:30:00Z');

  it('formats date in en-US locale', () => {
    const result = formatClock(date, 'en-US');
    // en-US: "Sep 05, 2:30 PM" or similar — just check it contains the parts
    expect(result).toContain('5');
    expect(result).toContain('30');
  });

  it('formats date in id locale', () => {
    const result = formatClock(date, 'id');
    expect(result).toContain('5');
    expect(result).toContain('30');
  });

  it('formats midnight correctly', () => {
    const midnight = new Date('2026-01-01T00:00:00Z');
    const result = formatClock(midnight, 'en-US');
    expect(result).toContain('1');
    expect(result).toContain('00');
  });

  it('formats end of day correctly', () => {
    const end = new Date('2026-12-31T23:59:00Z');
    const result = formatClock(end, 'en-US');
    // Day may shift in non-UTC timezones, just verify time parts
    expect(result).toContain('59');
  });

  it('falls back to toLocaleString for invalid locale', () => {
    const result = formatClock(date, 'invalid-locale-xyz');
    // Should not throw, should return some string
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
