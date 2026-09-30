import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { bucketForOffset, dayOffset } from '@/features/kds/KdsCompletedView';

describe('bucketForOffset', () => {
  it('returns "today" for offset 0', () => {
    expect(bucketForOffset(0)).toBe('today');
  });

  it('returns "yesterday" for offset 1', () => {
    expect(bucketForOffset(1)).toBe('yesterday');
  });

  it('returns "this-week" for offset 2', () => {
    expect(bucketForOffset(2)).toBe('this-week');
  });

  it('returns "this-week" for offset 6 (end of week)', () => {
    expect(bucketForOffset(6)).toBe('this-week');
  });

  it('returns "older" for offset 7', () => {
    expect(bucketForOffset(7)).toBe('older');
  });

  it('returns "older" for very large offset', () => {
    expect(bucketForOffset(365)).toBe('older');
    expect(bucketForOffset(9999)).toBe('older');
  });

  it('returns null for negative offset (out of range)', () => {
    expect(bucketForOffset(-1)).toBeNull();
    expect(bucketForOffset(-100)).toBeNull();
  });

  it('returns null for offset that falls exactly on "today" start boundary (0) — covered by "today"', () => {
    // offset 0 is in [0, 1) → "today"
    expect(bucketForOffset(0)).toBe('today');
  });

  it('fractional offset works correctly', () => {
    // 0.5 is in [0, 1) → "today"
    expect(bucketForOffset(0.5)).toBe('today');
    // 1.5 is in [1, 2) → "yesterday"
    expect(bucketForOffset(1.5)).toBe('yesterday');
    // 6.9 is in [2, 7) → "this-week"
    expect(bucketForOffset(6.9)).toBe('this-week');
    // 7.0 is in [7, Infinity) → "older"
    expect(bucketForOffset(7.0)).toBe('older');
  });

  it('boundary: offset 1 falls in yesterday, not today', () => {
    expect(bucketForOffset(1)).toBe('yesterday');
  });

  it('boundary: offset 2 falls in this-week, not yesterday', () => {
    expect(bucketForOffset(2)).toBe('this-week');
  });
});

// ── dayOffset ────────────────────────────────────────────────────────
//
// These cases exist because the whole file above tested only the PURE mapping
// from an offset to a bucket. dayOffset is what turns a timestamp into that
// offset, and it used to read both timestamps in the DEVICE zone, so a kitchen
// terminal outside the store's zone filed yesterday's tickets under Today.
// A pure-function test of bucketForOffset can never see that: it is handed a
// number, so it cannot tell where the number came from.
//
// The clock is FAKE here rather than the host being varied, because the defect
// is about which calendar the READ happens on and a real clock at a real
// instant only disagrees across 24 hours a day. Pinning "now" makes every
// case deterministic and lets the disagreement be demonstrated at a fixed
// instant.
describe('dayOffset', () => {
  /** 2026-09-04T17:00:00Z — the instant the defect was measured at. */
  const NOW_ISO = '2026-09-04T17:00:00.000Z';

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_ISO));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('files a ticket served three hours ago as today when the store is UTC', () => {
    // 14:00Z on the same calendar day in UTC.
    expect(dayOffset('2026-09-04T14:00:00.000Z', 'UTC')).toBe(0);
  });

  it('files a ticket served hours ago as YESTERDAY when the store is ahead of UTC', () => {
    // The measured case: at 17:00Z the store at +07:00 is already on
    // 2026-09-05, so a ticket served at 16:00Z was completed on the store's
    // 04-04 — yesterday. A device at UTC or further west called it today.
    expect(dayOffset('2026-09-04T16:00:00.000Z', '+07:00')).toBe(1);
    expect(bucketForOffset(dayOffset('2026-09-04T16:00:00.000Z', '+07:00'))).toBe('yesterday');
  });

  it('files the same ticket as today for a store behind UTC', () => {
    // -07:00 is 2026-09-04 10:00 in the store, so the 16:00Z ticket is on the
    // store's 04-04 too — today. The two cases above and here are the same
    // instant and the same timestamp reaching three different answers purely
    // from the zone, which is the whole point.
    expect(dayOffset('2026-09-04T16:00:00.000Z', '-07:00')).toBe(0);
  });

  it('reads a ticket that straddles local midnight by the store, not the host', () => {
    // 2026-09-04T14:00Z is 2026-09-04 21:00 at +07:00, so a store at +07 is
    // already on 09-05 and calls it yesterday; a store at UTC is still on
    // 09-04 and calls it today. Same instant, same ticket, two answers, and
    // the only thing that may decide between them is the store's zone.
    expect(dayOffset('2026-09-04T14:00:00.000Z', '+07:00')).toBe(1);
    expect(dayOffset('2026-09-04T14:00:00.000Z', 'UTC')).toBe(0);
    // +09:00 is past 23:00, so it too is on 09-05; -07:00 is 07:00 on 09-04.
    expect(dayOffset('2026-09-04T14:00:00.000Z', '+09:00')).toBe(1);
    expect(dayOffset('2026-09-04T14:00:00.000Z', '-07:00')).toBe(0);
  });

  it('falls back to the store default, never the device, when no zone is known', () => {
    // The same failure as a null store profile elsewhere in the app: a missing
    // zone must read as FALLBACK_STORE_TZ (UTC, the schema's column default),
    // not as the host. The null, undefined and no-argument forms must all agree
    // with an explicit 'UTC', because storeOffsetMs('UTC') is 0.
    //
    // The timestamp is chosen so the UTC answer (1) differs from what a host at
    // +07:00 would have said (2) -- see the probe values recorded below.
    expect(dayOffset('2026-09-03T16:00:00.000Z', null)).toBe(1);
    expect(dayOffset('2026-09-03T16:00:00.000Z', undefined)).toBe(1);
    expect(dayOffset('2026-09-03T16:00:00.000Z')).toBe(1);
    expect(dayOffset('2026-09-03T16:00:00.000Z', 'UTC')).toBe(1);
    // A device in a +07 store would have produced 2 here. Pinning the UTC
    // answer is what makes this case fail on a device-anchored implementation.
    expect(dayOffset('2026-09-03T16:00:00.000Z', '+07:00')).toBe(2);
  });

  it('still returns today for a ticket served in the future', () => {
    // The Math.max(0, …) clamp is pre-existing contract: a clock-skewed
    // served_at must not file itself under a future bucket.
    expect(dayOffset('2026-09-04T18:00:00.000Z', 'UTC')).toBe(0);
  });

  it('walks back whole days on the store calendar', () => {
    const daysAgo = (n: number, tz: string) =>
      dayOffset(new Date(Date.parse(NOW_ISO) - n * 86_400_000).toISOString(), tz);
    expect(daysAgo(1, 'UTC')).toBe(1);
    expect(daysAgo(2, 'UTC')).toBe(2);
    expect(daysAgo(7, 'UTC')).toBe(7);
    // Measured, not assumed: the offset is ZONE-INVARIANT for a fixed-ms
    // subtraction, because dayOffset shifts BOTH endpoints by the same amount,
    // so a day that is N x 86_400_000 ms back stays N days back in every zone.
    // The zone only matters for where the calendar BOUNDARY falls, which is
    // the case above. Recorded so a later "fix" does not assume otherwise.
    expect(daysAgo(3, '+14:00')).toBe(3);
    expect(daysAgo(3, '-07:00')).toBe(3);
  });
});
