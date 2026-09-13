// Unit tests for time-bucket assignment — the BUCKETS configuration and the
// bucket-assignment rule KdsCompletedView uses to group completed orders into
// Today / Yesterday / This Week / Older columns.
//
// This suite previously declared its own BUCKETS array, its own dayOffset() ("Same
// dayOffset as KdsCompletedView.tsx") and its own assignBucket(). All three now come from
// the module, so the tests describe the shipped component. That mattered: the local
// assignBucket ended with `return 'older'; // fallback`, while the real loop drops an order
// that matches no range. A negative or NaN offset would have been filed under "older" by
// the test and vanish in production -- and the suite could not have noticed, because it was
// testing the copy that had the fallback.

// `beforeEach` was used but not imported. Vitest injects these names at runtime, so
// `npm run test` stayed green while `tsc --noEmit` failed -- the exact shape of
// KdsThresholdClamp.test.ts in 524be1e7, and the reason CI's ui-test typecheck matters.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BUCKETS,
  dayOffset,
  bucketForOffset as assignBucket,
} from '@/features/kds/KdsCompletedView';

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
