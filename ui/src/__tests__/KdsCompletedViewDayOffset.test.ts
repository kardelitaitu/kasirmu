// Unit tests for dayOffset — pure function that computes the day offset
// from today for a given ISO timestamp. Used for time-bucketing completed
// orders into Today / Yesterday / This Week / Older columns.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dayOffset } from '@/features/kds/KdsCompletedView';

// Mock "today" as 2026-09-05 14:30:00 UTC for deterministic tests.
const TODAY = new Date('2026-09-05T14:30:00Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(TODAY);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('dayOffset', () => {
  it('returns 0 for an order received today (same calendar day)', () => {
    expect(dayOffset('2026-09-05T08:00:00Z')).toBe(0);
  });

  it('returns 0 for an order received moments ago today', () => {
    expect(dayOffset('2026-09-05T14:29:00Z')).toBe(0);
  });

  it('returns 0 for an order received at midnight today', () => {
    expect(dayOffset('2026-09-05T00:00:00Z')).toBe(0);
  });

  it('returns 1 for an order received yesterday', () => {
    expect(dayOffset('2026-09-04T14:30:00Z')).toBe(1);
  });

  it('returns 1 for an order received late yesterday (safe across timezones)', () => {
    // Use 12:00 UTC — midnight in UTC-12, noon in UTC+0 — clearly yesterday
    expect(dayOffset('2026-09-04T12:00:00Z')).toBe(1);
  });

  it('returns 2 for an order received 2 days ago', () => {
    expect(dayOffset('2026-09-03T10:00:00Z')).toBe(2);
  });

  it('returns 6 for an order received 6 days ago', () => {
    expect(dayOffset('2026-08-30T10:00:00Z')).toBe(6);
  });

  it('returns 7 for an order received 7 days ago', () => {
    expect(dayOffset('2026-08-29T10:00:00Z')).toBe(7);
  });

  it('returns 30 for an order received 30 days ago', () => {
    expect(dayOffset('2026-08-06T10:00:00Z')).toBe(30);
  });

  it('returns 0 for a future timestamp (clock skew protection via Math.max)', () => {
    expect(dayOffset('2026-09-06T10:00:00Z')).toBe(0);
  });

  it('handles timestamps safely across timezones (midday avoids edge)', () => {
    // Midday UTC is safe: yesterday midday is always 1 day ago
    expect(dayOffset('2026-09-04T12:00:00Z')).toBe(1);
    // 2 days ago midday is always 2
    expect(dayOffset('2026-09-03T12:00:00Z')).toBe(2);
  });
});
