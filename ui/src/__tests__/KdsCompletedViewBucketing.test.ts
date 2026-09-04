// Unit tests for time-bucket assignment — documents the BUCKETS
// configuration and the bucket-assignment algorithm used by
// KdsCompletedView to group completed orders into Today / Yesterday /
// This Week / Older columns.

import { describe, it, expect, vi, afterEach } from 'vitest';

/** Same bucket config as KdsCompletedView.tsx. */
const BUCKETS = [
  { key: 'today',     start: 0, end: 1 },
  { key: 'yesterday', start: 1, end: 2 },
  { key: 'this-week', start: 2, end: 7 },
  { key: 'older',     start: 7, end: Infinity },
] as const;

/** Same dayOffset as KdsCompletedView.tsx. */
function dayOffset(ts: string): number {
  const now = new Date();
  const d = new Date(ts);
  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const orderDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.max(0, Math.floor((nowDay - orderDay) / 86_400_000));
}

/** Assign a day offset to a bucket key. */
function assignBucket(dayOff: number): string {
  for (const b of BUCKETS) {
    if (dayOff >= b.start && dayOff < b.end) return b.key;
  }
  return 'older'; // fallback
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-05T14:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('BUCKETS configuration', () => {
  it('has exactly 4 buckets', () => {
    expect(BUCKETS).toHaveLength(4);
  });

  it('starts at 0 and ends at Infinity', () => {
    expect(BUCKETS[0]!.start).toBe(0);
    expect(BUCKETS[BUCKETS.length - 1]!.end).toBe(Infinity);
  });

  it('each bucket end matches next bucket start', () => {
    for (let i = 0; i < BUCKETS.length - 1; i++) {
      expect(BUCKETS[i]!.end).toBe(BUCKETS[i + 1]!.start);
    }
  });

  it('bucket keys are unique', () => {
    const keys = BUCKETS.map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('assignBucket', () => {
  it('day 0 → today', () => {
    expect(assignBucket(0)).toBe('today');
  });

  it('day 1 → yesterday', () => {
    expect(assignBucket(1)).toBe('yesterday');
  });

  it('day 2 → this-week', () => {
    expect(assignBucket(2)).toBe('this-week');
  });

  it('day 6 → this-week (end of range)', () => {
    expect(assignBucket(6)).toBe('this-week');
  });

  it('day 7 → older', () => {
    expect(assignBucket(7)).toBe('older');
  });

  it('day 30 → older', () => {
    expect(assignBucket(30)).toBe('older');
  });

  it('day 365 → older', () => {
    expect(assignBucket(365)).toBe('older');
  });
});

describe('bucket assignment end-to-end', () => {
  it('assigns today orders to today bucket', () => {
    expect(assignBucket(dayOffset('2026-09-05T10:00:00Z'))).toBe('today');
  });

  it('assigns yesterday orders to yesterday bucket', () => {
    expect(assignBucket(dayOffset('2026-09-04T10:00:00Z'))).toBe('yesterday');
  });

  it('assigns 3-day-old orders to this-week bucket', () => {
    expect(assignBucket(dayOffset('2026-09-02T10:00:00Z'))).toBe('this-week');
  });

  it('assigns 10-day-old orders to older bucket', () => {
    expect(assignBucket(dayOffset('2026-08-26T10:00:00Z'))).toBe('older');
  });
});
