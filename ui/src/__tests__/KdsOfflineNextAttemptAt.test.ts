import { describe, it, expect, vi, afterEach } from 'vitest';
import { nextAttemptAt, MAX_RETRY_ATTEMPTS } from '@/hooks/useKdsOffline';

/**
 * Tests for the exponential backoff formula (OFF-05).
 *
 * nextAttemptAt(retryCount) returns an ISO timestamp in the future:
 *   retry 1 → ~1s, retry 2 → ~2s, retry 3 → ~4s, retry 4 → ~8s
 * with ±30% jitter. Tests mock Math.random to get deterministic results.
 */

describe('nextAttemptAt', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns a valid ISO timestamp', () => {
    const result = nextAttemptAt(1);
    const parsed = new Date(result);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('is in the future', () => {
    const before = Date.now();
    const result = nextAttemptAt(1);
    const after = new Date(result).getTime();
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it('retry 1 → ~1s delay (center jitter)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const result = nextAttemptAt(1);
    const delay = new Date(result).getTime() - now;
    expect(delay).toBe(1000);
  });

  it('retry 2 → ~2s delay', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const result = nextAttemptAt(2);
    const delay = new Date(result).getTime() - now;
    expect(delay).toBe(2000);
  });

  it('retry 3 → ~4s delay', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const result = nextAttemptAt(3);
    const delay = new Date(result).getTime() - now;
    expect(delay).toBe(4000);
  });

  it('retry 4 → ~8s delay', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const result = nextAttemptAt(4);
    const delay = new Date(result).getTime() - now;
    expect(delay).toBe(8000);
  });

  it('minimum jitter (random=0) reduces delay by 30%', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const result = nextAttemptAt(1);
    const delay = new Date(result).getTime() - now;
    // jitter = 1 + (0 * 2 - 1) * 0.3 = 0.7
    expect(delay).toBe(700);
  });

  it('maximum jitter (random=1) increases delay by 30%', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const result = nextAttemptAt(1);
    const delay = new Date(result).getTime() - now;
    // jitter = 1 + (1 * 2 - 1) * 0.3 = 1.3
    expect(delay).toBe(1300);
  });

  it('delay increases monotonically with retry count', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const delays: number[] = [];
    for (let r = 1; r <= 4; r++) {
      delays.push(new Date(nextAttemptAt(r)).getTime() - now);
    }
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]!).toBeGreaterThan(delays[i - 1]!);
    }
  });

  it('high retry count produces large but finite delay', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const result = nextAttemptAt(10); // 2^9 = 512s
    const delay = new Date(result).getTime() - now;
    expect(delay).toBe(512_000); // 512 seconds
  });
});

describe('MAX_RETRY_ATTEMPTS', () => {
  it('is 5 — actions with retryCount >= 5 are dead-lettered', () => {
    expect(MAX_RETRY_ATTEMPTS).toBe(5);
  });
});
