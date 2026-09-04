import { describe, it, expect } from 'vitest';
import { secondsUntilExpiry } from '@/features/kds/components/KdsEnrollmentModal';

/**
 * Tests for secondsUntilExpiry — the countdown timer math for the
 * enrollment modal's QR pairing token.
 *
 * Returns seconds remaining, clamped to 0 for expired tokens.
 */

describe('secondsUntilExpiry', () => {
  it('returns full duration when token was just issued', () => {
    const now = 1_700_000_000_000;
    const expiry = new Date(now + 300_000).toISOString(); // +5 min
    expect(secondsUntilExpiry(expiry, now)).toBe(300);
  });

  it('returns 0 for already expired token', () => {
    const now = 1_700_000_000_000;
    const expiry = new Date(now - 1000).toISOString(); // 1s ago
    expect(secondsUntilExpiry(expiry, now)).toBe(0);
  });

  it('returns 0 for long-expired token', () => {
    const now = 1_700_000_000_000;
    const expiry = new Date(now - 86_400_000).toISOString(); // 1 day ago
    expect(secondsUntilExpiry(expiry, now)).toBe(0);
  });

  it('returns 1 at the boundary (1 second left)', () => {
    const now = 1_700_000_000_000;
    const expiry = new Date(now + 1500).toISOString(); // 1.5s → floor = 1
    expect(secondsUntilExpiry(expiry, now)).toBe(1);
  });

  it('returns exact seconds at the exact boundary', () => {
    const now = 1_700_000_000_000;
    const expiry = new Date(now + 60_000).toISOString(); // exactly 60s
    expect(secondsUntilExpiry(expiry, now)).toBe(60);
  });

  it('truncates fractional seconds', () => {
    const now = 1_700_000_000_000;
    const expiry = new Date(now + 2_500).toISOString(); // 2.5s → floor = 2
    expect(secondsUntilExpiry(expiry, now)).toBe(2);
  });

  it('handles large remaining time', () => {
    const now = 1_700_000_000_000;
    const expiry = new Date(now + 86_400_000).toISOString(); // 24h
    expect(secondsUntilExpiry(expiry, now)).toBe(86_400);
  });

  it('handles 5-minute QR token window', () => {
    const now = 1_700_000_000_000;
    const expiry = new Date(now + 5 * 60 * 1000).toISOString();
    expect(secondsUntilExpiry(expiry, now)).toBe(300);
  });

  it('decrements correctly as time passes', () => {
    const t1 = 1_700_000_000_000;
    const expiry = new Date(t1 + 60_000).toISOString();
    expect(secondsUntilExpiry(expiry, t1)).toBe(60);
    expect(secondsUntilExpiry(expiry, t1 + 1000)).toBe(59);
    expect(secondsUntilExpiry(expiry, t1 + 59_000)).toBe(1);
    expect(secondsUntilExpiry(expiry, t1 + 60_000)).toBe(0);
  });
});
