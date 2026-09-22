// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSessionToken, hasSession } from '../session';

/**
 * R1 httpOnly-cookie session helper tests: getSessionToken must prefer the
 * Worker's /__oz/session cookie endpoint and fall back to sessionStorage
 * when the endpoint is absent (no-Worker dev) or returns no token.
 */

describe('getSessionToken — R1 httpOnly cookie', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('returns the token from /__oz/session when the cookie exists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ token: 'cookie.token' }),
    }));

    expect(await getSessionToken()).toBe('cookie.token');
    expect(fetch).toHaveBeenCalledWith('/__oz/session');
  });

  it('falls back to sessionStorage when the endpoint returns no token', async () => {
    sessionStorage.setItem('oz_session', 'stored.token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ error: 'no token field' }),
    }));

    expect(await getSessionToken()).toBe('stored.token');
  });

  it('falls back to sessionStorage when the endpoint 401s', async () => {
    sessionStorage.setItem('oz_session', 'stored.token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'not signed in' }),
    }));

    expect(await getSessionToken()).toBe('stored.token');
  });

  it('falls back to sessionStorage when there is no Worker (fetch rejects)', async () => {
    sessionStorage.setItem('oz_session', 'stored.token');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no worker')));

    expect(await getSessionToken()).toBe('stored.token');
  });

  it('returns null when neither the cookie nor sessionStorage has a token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'not signed in' }),
    }));

    expect(await getSessionToken()).toBeNull();
  });

  it('collapses concurrent callers into a single /__oz/session request', async () => {
    // The header resolves the session on load and again on astro:page-load,
    // and the checkout CTA also asks — without dedupe a page fired several
    // identical probes.
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ token: 'cookie.token' }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const [a, b] = await Promise.all([getSessionToken(), getSessionToken()]);
    expect(a).toBe('cookie.token');
    expect(b).toBe('cookie.token');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('hasSession — cookie-first session gate', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('reports signed in from a cookie-only session with empty sessionStorage', async () => {
    // The regression: a user signed in via the httpOnly cookie, opening the
    // site in a new tab (sessionStorage is per-tab and therefore empty) must
    // still be recognized as signed in.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ token: 'cookie.token' }),
    }));

    expect(sessionStorage.getItem('oz_session')).toBeNull();
    expect(await hasSession()).toBe(true);
  });

  it('reports signed in from a sessionStorage-only session (no Worker)', async () => {
    sessionStorage.setItem('oz_session', 'stored.token');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no worker')));

    expect(await hasSession()).toBe(true);
  });

  it('reports signed out when neither source has a token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'not signed in' }),
    }));

    expect(await hasSession()).toBe(false);
  });
});
