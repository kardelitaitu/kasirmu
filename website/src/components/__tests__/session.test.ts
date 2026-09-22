// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSession, hasSession, isPlaceholderPriceId } from '../paddle';
import { EMAIL_STORAGE_KEY, SESSION_STORAGE_KEY } from '../../lib/session';

/**
 * Session storage helpers. The critical regression: clearSession must
 * remove the cached email WITH the token — otherwise the next account on
 * the same browser gets the previous user's email prefilled in Paddle
 * checkout, attaching the subscription to the wrong tenant.
 *
 * `hasSession` is re-exported from lib/session.ts and is cookie-first, so it
 * is async and consults the Worker's /__oz/session before sessionStorage.
 */
describe('session helpers', () => {
  beforeEach(() => {
    sessionStorage.clear();
    // Deterministic no-Worker default: the relative endpoint rejects, so
    // hasSession falls back to sessionStorage.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no worker')));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('clearSession removes BOTH the token and the cached email', () => {
    sessionStorage.setItem(SESSION_STORAGE_KEY, 'tok');
    sessionStorage.setItem(EMAIL_STORAGE_KEY, 'alice@example.com');
    clearSession();
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(EMAIL_STORAGE_KEY)).toBeNull();
  });

  it('clearSession is a no-op when storage is empty', () => {
    expect(() => clearSession()).not.toThrow();
  });

  it('hasSession reflects the stored token', async () => {
    expect(await hasSession()).toBe(false);
    sessionStorage.setItem(SESSION_STORAGE_KEY, 'tok');
    expect(await hasSession()).toBe(true);
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    expect(await hasSession()).toBe(false);
  });

  it('hasSession is cookie-first: signed in from the cookie with empty sessionStorage', async () => {
    // The re-export must not read sessionStorage directly — a cookie-only
    // session in a new tab has an empty store and must still read as signed in.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ token: 'cookie.token' }),
    }));
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(await hasSession()).toBe(true);
  });

  it('isPlaceholderPriceId detects only placeholder ids', () => {
    expect(isPlaceholderPriceId('pri_placeholder_x')).toBe(true);
    expect(isPlaceholderPriceId('pri_01m05gdnqp30xze6db73qcracp')).toBe(false);
    expect(isPlaceholderPriceId(undefined)).toBe(false);
  });
});
