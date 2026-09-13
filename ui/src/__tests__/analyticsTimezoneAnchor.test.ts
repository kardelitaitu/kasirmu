import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { FALLBACK_STORE_TZ, isoToday } from '@/features/analytics/analytics-data';

/**
 * R36-01 — the analytics date range must not depend on the host timezone.
 *
 * Before this fix, `isoToday(null)` fell through to `isoDay(new Date())`, which
 * reads the *device's* calendar. That is what made PR #95's analytics test fail
 * deterministically on a UTC CI runner while passing on a UTC+7 workstation.
 *
 * These assertions are written against an independently computed UTC value, so
 * they hold no matter what zone the process runs in -- which is the point. The
 * companion script scripts/check-tz-invariance.py runs this file under four host
 * zones (UTC, Asia/Jakarta, Pacific/Kiritimati, America/Los_Angeles) and fails if
 * the results ever diverge.
 */

/** Today's calendar date in UTC, computed without touching local-time getters. */
function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The calendar date `offsetMs` ahead of UTC, read back as a UTC calendar. */
function shiftedToday(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString().slice(0, 10);
}

describe('analytics timezone anchor (R36-01)', () => {
  it('anchors to UTC when the store timezone is unknown, not to the host', () => {
    // The regression: this used to be the device's local date.
    expect(isoToday(null)).toBe(utcToday());
    expect(isoToday(undefined)).toBe(utcToday());
  });

  it('treats an explicit "UTC" the same as the fallback', () => {
    // storeOffsetMs parses only ±HH:MM and returns 0 otherwise, so 'UTC' and
    // the FALLBACK_STORE_TZ constant land on the same instant by construction.
    expect(isoToday('UTC')).toBe(isoToday(null));
  });

  it('honours a fixed store offset when one is configured', () => {
    expect(isoToday('+07:00')).toBe(shiftedToday(7 * 3_600_000));
    expect(isoToday('-03:30')).toBe(shiftedToday(-(3 * 3_600_000 + 30 * 60_000)));
  });

  it('does not invent an offset for an IANA name it cannot parse', () => {
    // Documents the deliberate limitation in storeOffsetMs: IANA zones are NOT
    // resolved client-side, so an unparseable value behaves like UTC rather
    // than silently applying a possibly-different DST rule.
    expect(isoToday('Asia/Jakarta')).toBe(utcToday());
  });

  it('is stable across repeated calls within a run', () => {
    expect(new Set(Array.from({ length: 25 }, () => isoToday(null))).size).toBe(1);
  });

  it('keeps the fallback in step with the schema column default', () => {
    // The fallback is justified by `timezone TEXT NOT NULL DEFAULT 'UTC'` in
    // the migrations. That claim is only true while the schema says so, so
    // assert it against the file rather than trusting a comment. If a
    // migration changes the default, this fails and the constant gets
    // reconsidered instead of quietly drifting.
    // __dirname + resolve, matching StaffLoginScreen.test.tsx: import.meta.url
    // is an http:// URL under Vite and readFileSync rejects it.
    const sqlite = readFileSync(
      resolve(__dirname, '../../../crates/oz-core/migrations/20260813_init.sql'),
      'utf8',
    );
    const m = /timezone\s+TEXT NOT NULL DEFAULT '([^']+)'/.exec(sqlite);
    expect(m, 'store_profiles.timezone default no longer matches the shape this test parses').not.toBeNull();
    expect(m![1]).toBe(FALLBACK_STORE_TZ);
  });
});
