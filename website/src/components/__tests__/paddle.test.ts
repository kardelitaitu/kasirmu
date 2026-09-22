// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock runtime-config so paddle.ts's module-level `const API = licenseApiUrl()` resolves.
vi.mock('../../lib/runtime-config', () => ({
  licenseApiUrl: () => 'https://license.test',
}));

/**
 * Unit coverage for paddle.ts pure helpers. The checkout overlay (loadPaddle,
 * openPaddleCheckout) requires a full Paddle SDK mock and is covered by the
 * CheckoutButton integration tests. These pin the session / placeholder logic.
 */

// Dynamic import after mocks are hoisted so the module-level API resolves correctly.
let paddle: typeof import('../paddle');

beforeEach(async () => {
  vi.resetModules();
  paddle = await import('../paddle');
  sessionStorage.clear();
  // Default no-Worker state: hasSession/getSessionEmail fall back to
  // sessionStorage. Individual tests override this with their own fetch stub.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no worker')));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isPlaceholderPriceId', () => {
  it('returns true for pri_placeholder_ prefixed ids', () => {
    expect(paddle.isPlaceholderPriceId('pri_placeholder_pro_monthly')).toBe(true);
    expect(paddle.isPlaceholderPriceId('pri_placeholder_')).toBe(true);
  });

  it('returns false for real Paddle price ids', () => {
    expect(paddle.isPlaceholderPriceId('pri_01h7x1234567890abcdef')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(paddle.isPlaceholderPriceId(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(paddle.isPlaceholderPriceId('')).toBe(false);
  });
});

describe('hasSession', () => {
  it('returns false when sessionStorage is empty', async () => {
    expect(await paddle.hasSession()).toBe(false);
  });

  it('returns true when a session token is present', async () => {
    sessionStorage.setItem('oz_session', 'tok_abc123');
    expect(await paddle.hasSession()).toBe(true);
  });

  it('returns false after the session is cleared', async () => {
    sessionStorage.setItem('oz_session', 'tok_abc123');
    paddle.clearSession();
    expect(await paddle.hasSession()).toBe(false);
  });

  it('is cookie-first: true from the cookie with empty sessionStorage', async () => {
    // The re-export delegates to session.ts, so a cookie-only session (new
    // tab, sessionStorage cleared) must read as signed in.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ token: 'cookie.token' }),
    }));
    expect(sessionStorage.getItem('oz_session')).toBeNull();
    expect(await paddle.hasSession()).toBe(true);
  });
});

describe('clearSession', () => {
  it('removes both oz_session and oz_email from sessionStorage', () => {
    sessionStorage.setItem('oz_session', 'tok_abc');
    sessionStorage.setItem('oz_email', 'user@test.com');
    paddle.clearSession();
    expect(sessionStorage.getItem('oz_session')).toBeNull();
    expect(sessionStorage.getItem('oz_email')).toBeNull();
  });

  it('does not throw when sessionStorage is empty', () => {
    expect(() => paddle.clearSession()).not.toThrow();
  });
});

describe('getSessionEmail', () => {
  it('returns the cached email from sessionStorage', async () => {
    sessionStorage.setItem('oz_email', 'cached@test.com');
    const email = await paddle.getSessionEmail();
    expect(email).toBe('cached@test.com');
  });

  it('fetches from /me when no cached email exists', async () => {
    sessionStorage.setItem('oz_session', 'tok_test');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ tenant: { email: 'fetched@test.com' } }),
      }),
    );
    const email = await paddle.getSessionEmail();
    expect(email).toBe('fetched@test.com');
    expect(sessionStorage.getItem('oz_email')).toBe('fetched@test.com');
  });

  it('returns null when there is no session token', async () => {
    // getSessionToken calls /__oz/session first; stub it so the test
    // doesn't hit the real network. A 401 or rejection means no cookie.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no worker')));
    const email = await paddle.getSessionEmail();
    expect(email).toBeNull();
  });

  it('resolves the email from a cookie token when sessionStorage is empty (R1 cookie path)', async () => {
    // P1: the httpOnly-cookie session (sessionStorage cleared) must still
    // resolve the email — getSessionToken reads /__oz/session, then /me.
    sessionStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        if (url === '/__oz/session') {
          return { ok: true, json: async () => ({ token: 'cookie.token' }) };
        }
        return { ok: true, json: async () => ({ tenant: { email: 'cookie@test.com' } }) };
      }),
    );
    const email = await paddle.getSessionEmail();
    expect(email).toBe('cookie@test.com');
    expect(sessionStorage.getItem('oz_email')).toBe('cookie@test.com');
  });

  it('returns null when the /me endpoint fails', async () => {
    sessionStorage.setItem('oz_session', 'tok_test');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const email = await paddle.getSessionEmail();
    expect(email).toBeNull();
  });

  it('returns null when fetch throws (network error)', async () => {
    sessionStorage.setItem('oz_session', 'tok_test');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    const email = await paddle.getSessionEmail();
    expect(email).toBeNull();
  });

  it('caches the email from /me into sessionStorage', async () => {
    sessionStorage.setItem('oz_session', 'tok_test');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ tenant: { email: 'new@test.com' } }),
      }),
    );
    await paddle.getSessionEmail();
    expect(sessionStorage.getItem('oz_email')).toBe('new@test.com');
  });
});
