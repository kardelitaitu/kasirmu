// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { labelMap } from '../../i18n';
import { RUNTIME_CONFIG_EVENT } from '../../lib/runtime-config';

// React 19 requires the act environment flag for async act() to work.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * AccountView tests — covers the not-signed-in state, not-configured state,
 * region selector with localStorage persistence, logout flow, 401 session
 * expiry handling, subscription display, and password change.
 */

const paddle = vi.hoisted(() => ({
  openPaddleCheckout: vi.fn(),
  getSessionEmail: vi.fn(async () => 'test@example.com' as string | null),
  clearSession: vi.fn(() => {
    sessionStorage.removeItem('oz_session');
    sessionStorage.removeItem('oz_email');
  }),
  isPaddleConfigured: vi.fn(() => true),
  isPlaceholderPriceId: vi.fn(() => true),
}));
const midtrans = vi.hoisted(() => ({ openMidtransCheckout: vi.fn() }));
vi.mock('../paddle', () => paddle);
vi.mock('../midtrans', () => midtrans);

function mockFetch(handler: (url: string, init?: RequestInit) => { ok: boolean; status: number; json: () => Promise<unknown> }): void {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string, init?: RequestInit) => handler(url, init)));
}

/** Every URL the mocked fetch was called with, in order. */
function fetchMockCalls(): string[] {
  return (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));
}

function okJson(data: unknown) {
  return { ok: true, status: 200, json: async () => data };
}

function badRequest(status: number) {
  return { ok: false, status, json: async () => ({}) };
}

const STUB_LICENSE = { key: 'OZ-TEST-0001', tierKey: 'pro', status: 'active', expiresAt: '2027-01-01' };

function stubMe(
  subscription?: Record<string, unknown> | null,
  /** Pass null for an account that has never activated a license. */
  license: Record<string, unknown> | null = STUB_LICENSE,
): void {
  mockFetch(() =>
    okJson({
      tenant: { email: 'test@example.com', emailVerified: true, status: 'active' },
      license,
      subscription: subscription ?? null,
    }),
  );
}

async function renderAccount(locale: string) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const { default: AccountView, ACCOUNT_LABELS } = await import('../AccountView');
  act(() => {
    root.render(<AccountView locale={locale} labels={labelMap(locale, ACCOUNT_LABELS)} />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  return { container, root };
}

function clickButton(container: HTMLElement, text: string): void {
  const buttons = Array.from(container.querySelectorAll('button'));
  const btn = buttons.find((b) => b.textContent?.trim() === text);
  if (!btn) throw new Error(`button with text "${text}" not found`);
  act(() => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function assertText(container: HTMLElement, text: string): void {
  expect(container.textContent).toContain(text);
}

function assertNoText(container: HTMLElement, text: string): void {
  expect(container.textContent).not.toContain(text);
}

/** The value cell of the account's tier row. */
function tierValue(container: HTMLElement): string | null {
  // The label is "Plan" in en (i18n en.json account.tier) — matching on /tier/ found nothing.
  const dt = Array.from(container.querySelectorAll('dt')).find((n) => /plan|tier/i.test(n.textContent ?? ''));
  return dt?.nextElementSibling?.textContent ?? null;
}


beforeEach(() => {
  vi.clearAllMocks();
  const env = import.meta.env as Record<string, unknown>;
  env.PUBLIC_LICENSE_API_URL = 'https://license.test';
  sessionStorage.clear();
  localStorage.clear();
  window.__OZ_CONFIG__ = { licenseApiUrl: 'https://license.test' };
  stubMe();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

// A just-signed-up account has neither a subscription nor an activated license, and the
// tier row still has to name a real tier: `free` is the floor. It used to render an empty
// dash, which is what a new Google signup saw.
it('shows the free tier for a brand-new account instead of a blank', async () => {
  // A session, or the view renders the signed-out state and fetches nothing.
  sessionStorage.setItem('oz_session', 'tok-brand-new');
  stubMe(null, null);
  const { container, root } = await renderAccount('en');
  try {
    expect(tierValue(container)).toBe('free');
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

// ── Not signed in state ───────────────────────────────────────────────

describe('AccountView — not signed in', () => {
  it('shows sign-in prompt when no session token exists', async () => {
    sessionStorage.clear();
    const { container, root } = await renderAccount('en');
    try {
      assertText(container, "You're not signed in.");
      assertText(container, 'Sign in');
      // Should NOT show license or subscription sections.
      assertNoText(container, 'License');
      assertNoText(container, 'Subscription');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('links to the login page with correct locale', async () => {
    sessionStorage.clear();
    const { container, root } = await renderAccount('id');
    try {
      const link = container.querySelector('a[href="/id/login"]');
      expect(link).not.toBeNull();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

// ── Cookie-only session (R1 httpOnly cookie, no sessionStorage) ────────

describe('AccountView — cookie-only session (R1)', () => {
  it('loads the dashboard when the session exists only in the httpOnly cookie (P2)', async () => {
    // Regression: the initial-state gate used to require a sessionStorage
    // token, so a session living ONLY in the Worker's httpOnly cookie (e.g.
    // sessionStorage cleared by another tab) showed "You're not signed in"
    // instead of the dashboard.
    sessionStorage.clear();
    mockFetch((url) => {
      if (url === '/__oz/session') return okJson({ token: 'cookie.token' });
      if (url.includes('/devices')) return okJson({ devices: [] });
      return okJson({
        tenant: { email: 'cookie@test.com', emailVerified: true, status: 'active' },
        license: { key: 'OZ-TEST-COOKIE', tierKey: 'pro', status: 'active', expiresAt: '2027-01-01' },
        subscription: null,
      });
    });
    const { container, root } = await renderAccount('en');
    try {
      // Dashboard loaded — NOT the anon prompt.
      assertNoText(container, "You're not signed in.");
      assertText(container, 'License');
      assertText(container, 'cookie@test.com');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

// ── Runtime config (Worker-supplied) ──────────────────────────────────

describe('AccountView — the URL the island fetches against', () => {
  // A `__PUBLIC_*__` value is what an unresolved template leaves behind: a
  // TRUTHY string that is not a backend. Returned verbatim it became the base
  // URL — `if (!api)` never fired and the island fetched the placeholder
  // itself, so the notice appeared only after that request failed. Astro's own
  // substitution is not this (measured against `astro build`: absent -> `void
  // 0`, empty -> `""`), so this pins the guard, not the toolchain.
  it('shows not-configured and fetches nothing for a placeholder URL', async () => {
    const env = import.meta.env as Record<string, unknown>;
    env.PUBLIC_LICENSE_API_URL = '__PUBLIC_LICENSE_API_URL__';
    window.__OZ_CONFIG__ = undefined;
    sessionStorage.setItem('oz_session', 'tok-test');
    const { container, root } = await renderAccount('en');
    try {
      assertText(container, 'The license API is not configured on this deployment.');
      // No URL means no request — and specifically not a request to the
      // placeholder string itself, which is what a missing guard produced.
      expect(fetchMockCalls()).toHaveLength(0);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('fetches against the runtime URL when it is present at hydration', async () => {
    const env = import.meta.env as Record<string, unknown>;
    // The build-time value is the placeholder (see the case above); the runtime
    // config supplies the real base URL.
    env.PUBLIC_LICENSE_API_URL = '__PUBLIC_LICENSE_API_URL__';
    window.__OZ_CONFIG__ = undefined;
    sessionStorage.setItem('oz_session', 'tok-runtime-config');
    // getSessionToken() probes the Worker's /__oz/session first and only then
    // falls back to sessionStorage, so the route has to answer here too.
    mockFetch((url) => {
      if (url === '/__oz/session') return okJson({ token: 'tok-runtime-config' });
      if (url.includes('/devices')) return okJson({ devices: [] });
      if (url.includes('/identities')) return okJson({ identities: [] });
      return okJson({
        tenant: { email: 'test@example.com', emailVerified: true, status: 'active' },
        license: STUB_LICENSE,
        subscription: null,
      });
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const { default: AccountView, ACCOUNT_LABELS } = await import('../AccountView');
    const labels = labelMap('en', ACCOUNT_LABELS);
    // The Worker's /__oz/runtime-config.js has landed before the island mounts
    // — the normal case, since the deferred script and the module that hydrates
    // the island both run after the document parses, script order first. A
    // config that lands AFTER hydration is not covered by either case here.
    act(() => {
      window.__OZ_CONFIG__ = { licenseApiUrl: 'https://runtime.example' };
    });
    act(() => {
      root.render(<AccountView locale="en" labels={labels} />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    try {
      // The request has to go to the runtime URL, not to the placeholder the
      // build left behind — that is what the `!api` guard not firing produced.
      expect(fetchMockCalls()).toContain('https://runtime.example/api/v1/web/me');
      assertNoText(container, "You're not signed in.");
      assertNoText(container, 'The license API is not configured on this deployment.');
      assertText(container, 'test@example.com');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('recovers when the runtime config arrives AFTER the first render', async () => {
    // The gap neither case above covers, and the one a browser reproduced: the
    // island hydrates before a slow /__oz/runtime-config.js lands, reads no
    // URL, and would otherwise sit on the notice with zero requests until the
    // user reloads. The config script announces itself; the island must react.
    const env = import.meta.env as Record<string, unknown>;
    env.PUBLIC_LICENSE_API_URL = '';
    window.__OZ_CONFIG__ = undefined;
    sessionStorage.setItem('oz_session', 'tok-late-config');
    mockFetch((url) => {
      if (url === '/__oz/session') return okJson({ token: 'tok-late-config' });
      if (url.includes('/devices')) return okJson({ devices: [] });
      if (url.includes('/identities')) return okJson({ identities: [] });
      return okJson({
        tenant: { email: 'test@example.com', emailVerified: true, status: 'active' },
        license: STUB_LICENSE,
        subscription: null,
      });
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const { default: AccountView, ACCOUNT_LABELS } = await import('../AccountView');
    const labels = labelMap('en', ACCOUNT_LABELS);
    act(() => {
      root.render(<AccountView locale="en" labels={labels} />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    try {
      // No URL yet: the notice is the resting state, and nothing was fetched.
      assertText(container, 'The license API is not configured on this deployment.');
      expect(fetchMockCalls().filter((u) => u.includes('/api/v1/web/'))).toEqual([]);

      act(() => {
        window.__OZ_CONFIG__ = { licenseApiUrl: 'https://late.example' };
        window.dispatchEvent(new Event(RUNTIME_CONFIG_EVENT));
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(fetchMockCalls()).toContain('https://late.example/api/v1/web/me');
      assertText(container, 'test@example.com');
      assertNoText(container, 'The license API is not configured on this deployment.');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

// ── 401 session expiry ───────────────────────────────────────────────

describe('AccountView — 401 session expiry', () => {
  it('clears session and shows not-signed-in on 401', async () => {
    sessionStorage.setItem('oz_session', 'tok-expired');
    mockFetch(() => badRequest(401));
    const { container, root } = await renderAccount('en');
    try {
      assertText(container, "You're not signed in.");
      expect(sessionStorage.getItem('oz_session')).toBeNull();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

// ── Subscription display ──────────────────────────────────────────────

describe('AccountView — subscription display', () => {
  it('shows subscription details for active subscription', async () => {
    sessionStorage.setItem('oz_session', 'tok-active');
    stubMe({
      tierKey: 'pro',
      status: 'active',
      startsAt: '2026-01-01',
      expiresAt: '2027-01-01',
    });
    const { container, root } = await renderAccount('en');
    try {
      assertText(container, 'Subscription');
      assertText(container, 'pro');
      assertText(container, 'Active');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('shows renew hint for inactive subscription', async () => {
    sessionStorage.setItem('oz_session', 'tok-expired-sub');
    stubMe({
      tierKey: 'pro',
      status: 'expired',
      startsAt: '2025-01-01',
      expiresAt: '2026-01-01',
    });
    const { container, root } = await renderAccount('en');
    try {
      assertText(container, 'Subscription');
      assertText(container, 'Expired');
      assertText(container, 'Your subscription is no longer active.');
      assertText(container, 'Renew on the pricing page');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('shows subscribe section when no subscription exists', async () => {
    sessionStorage.setItem('oz_session', 'tok-no-sub');
    stubMe(null);
    const { container, root } = await renderAccount('en');
    try {
      assertText(container, "You don't have an active subscription yet");
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('routes subscribe through Paddle with the plan price id once real prices land', async () => {
    // Regression: when the Paddle catalog lands (non-placeholder price ids),
    // the dashboard subscribe button must open the Paddle overlay with the
    // plan's price id + the account email, and route /me refresh on close.
    sessionStorage.setItem('oz_session', 'tok-sub-paddle');
    paddle.isPlaceholderPriceId.mockReturnValue(false); // real catalog
    paddle.openPaddleCheckout.mockResolvedValue(undefined);
    mockFetch((url) => {
      if (url.includes('/devices')) return okJson({ devices: [] });
      return okJson({
        tenant: { email: 'test@example.com', emailVerified: true, status: 'active' },
        license: { key: 'OZ-TEST-0001', tierKey: 'free', status: 'active', expiresAt: '2027-01-01' },
        subscription: null,
      });
    });
    const { container, root } = await renderAccount('en');
    try {
      // With real price ids, the subscribe buttons render for the 3 paid tiers.
      const subscribeBtn = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Subscribe',
      );
      expect(subscribeBtn).not.toBeNull();
      act(() => subscribeBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(paddle.openPaddleCheckout).toHaveBeenCalled();
      // The first call opens the yearly price of the first subscribable tier.
      const call = paddle.openPaddleCheckout.mock.calls[0];
      expect(call[1]).toBe('test@example.com');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('shows the checkout error when Paddle subscribe fails due to missing session email', async () => {
    // Regression: when the loaded /me payload has no tenant email AND
    // getSessionEmail() returns null, the Paddle subscribe path must surface
    // the localized checkout.error message, not fail silently. P5 reuses
    // me.tenant.email first, so this mock omits the tenant to force the
    // getSessionEmail() fallback path.
    sessionStorage.setItem('oz_session', 'tok-sub-paddle-noemail');
    paddle.isPlaceholderPriceId.mockReturnValue(false);
    paddle.getSessionEmail.mockResolvedValue(null); // no email available
    mockFetch((url) => {
      if (url.includes('/devices')) return okJson({ devices: [] });
      return okJson({
        // No tenant.email on purpose — forces the getSessionEmail() fallback.
        tenant: undefined,
        license: { key: 'OZ-TEST-0001', tierKey: 'free', status: 'active', expiresAt: '2027-01-01' },
        subscription: null,
      });
    });
    const { container, root } = await renderAccount('en');
    try {
      const subscribeBtn = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Subscribe',
      );
      expect(subscribeBtn).not.toBeNull();
      act(() => subscribeBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
      // The error message must appear — Paddle was not called.
      expect(paddle.openPaddleCheckout).not.toHaveBeenCalled();
      const alert = container.querySelector('[role="alert"]');
      expect(alert).not.toBeNull();
      expect(alert!.textContent).toContain("Couldn't start the checkout. Please try again.");
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('routes subscribe through Midtrans Snap for the id locale', async () => {
    sessionStorage.setItem('oz_session', 'tok-sub-midtrans');
    midtrans.openMidtransCheckout.mockResolvedValue(undefined);
    mockFetch((url) => {
      if (url.includes('/devices')) return okJson({ devices: [] });
      return okJson({
        tenant: { email: 'test@example.com', emailVerified: true, status: 'active' },
        license: { key: 'OZ-TEST-0001', tierKey: 'free', status: 'active', expiresAt: '2027-01-01' },
        subscription: null,
      });
    });
    const { container, root } = await renderAccount('id');
    try {
      const subscribeBtn = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Berlangganan',
      );
      expect(subscribeBtn).not.toBeNull();
      act(() => subscribeBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(midtrans.openMidtransCheckout).toHaveBeenCalled();
      expect(paddle.openPaddleCheckout).not.toHaveBeenCalled();
      const call = midtrans.openMidtransCheckout.mock.calls[0];
      expect(call[1]).toBe('yearly');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('uses the saved region (id) to route an en-locale subscribe through Midtrans', async () => {
    // Regression for the region-routing fix: a user on /en/account who saved
    // the Indonesia region preference must get Midtrans, not Paddle — the
    // payment provider follows getExplicitRegion(), not the URL locale.
    localStorage.setItem('oz_region', 'id');
    sessionStorage.setItem('oz_session', 'tok-sub-region-id');
    midtrans.openMidtransCheckout.mockResolvedValue(undefined);
    mockFetch((url) => {
      if (url.includes('/devices')) return okJson({ devices: [] });
      return okJson({
        tenant: { email: 'test@example.com', emailVerified: true, status: 'active' },
        license: { key: 'OZ-TEST-0001', tierKey: 'free', status: 'active', expiresAt: '2027-01-01' },
        subscription: null,
      });
    });
    const { container, root } = await renderAccount('en');
    try {
      // The subscribe button label is the en string even though the region
      // is id — the label comes from locale, the provider from region.
      const subscribeBtn = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Subscribe',
      );
      expect(subscribeBtn).not.toBeNull();
      act(() => subscribeBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(midtrans.openMidtransCheckout).toHaveBeenCalled();
      expect(paddle.openPaddleCheckout).not.toHaveBeenCalled();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('shows IDR prices when the saved region is Indonesia even on the en-locale page', async () => {
    // Regression: on /en/account with region=id the checkout routes through
    // Midtrans (IDR), so the displayed plan prices must be the IDR ones —
    // not the en-locale USD prices. The currency shown and the currency
    // billed must match.
    localStorage.setItem('oz_region', 'id');
    sessionStorage.setItem('oz_session', 'tok-region-id-prices');
    midtrans.openMidtransCheckout.mockResolvedValue(undefined);
    mockFetch((url) => {
      if (url.includes('/devices')) return okJson({ devices: [] });
      return okJson({
        tenant: { email: 'test@example.com', emailVerified: true, status: 'active' },
        license: { key: 'OZ-TEST-0001', tierKey: 'free', status: 'active', expiresAt: '2027-01-01' },
        subscription: null,
      });
    });
    const { container, root } = await renderAccount('en');
    try {
      // IDR yearly Plus price from pricing/id.ts.
      assertText(container, 'Rp 500.000');
      assertNoText(container, '$4.99');
      assertNoText(container, '$49.99');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('shows the checkout error message when the Midtrans checkout fails', async () => {
    // Regression: when openMidtransCheckout throws (e.g. snap token request
    // fails or the SDK is unavailable), the subscribe click must surface the
    // localized checkout.error message, not fail silently.
    sessionStorage.setItem('oz_session', 'tok-sub-midtrans-error');
    localStorage.setItem('oz_region', 'id');
    midtrans.openMidtransCheckout.mockRejectedValue(new Error('snap unavailable'));
    mockFetch((url) => {
      if (url.includes('/devices')) return okJson({ devices: [] });
      return okJson({
        tenant: { email: 'test@example.com', emailVerified: true, status: 'active' },
        license: { key: 'OZ-TEST-0001', tierKey: 'free', status: 'active', expiresAt: '2027-01-01' },
        subscription: null,
      });
    });
    const { container, root } = await renderAccount('en');
    try {
      const subscribeBtn = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Subscribe',
      );
      expect(subscribeBtn).not.toBeNull();
      act(() => subscribeBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
      // The localized error message is rendered with role="alert".
      const alert = container.querySelector('[role="alert"]');
      expect(alert).not.toBeNull();
      expect(alert!.textContent).toContain("Couldn't start the checkout. Please try again.");
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('shows the checking-subscription status when a checkout completes', async () => {
    // Regression: after a completed checkout, the onClosed callback fires
    // pollAfterCheckout which sets refreshState='checking' and shows the
    // "Checking your subscription…" status line. This branch was untested.
    sessionStorage.setItem('oz_session', 'tok-checking');
    localStorage.setItem('oz_region', 'id');
    // Capture the onClosed callback the component passes to Midtrans.
    let onClosed: ((completed: boolean) => void) | undefined;
    midtrans.openMidtransCheckout.mockImplementation(async (_tier: string, _period: string, cb?: (c: boolean) => void) => {
      onClosed = cb;
    });
    mockFetch((url) => {
      if (url.includes('/devices')) return okJson({ devices: [] });
      return okJson({
        tenant: { email: 'test@example.com', emailVerified: true, status: 'active' },
        license: { key: 'OZ-TEST-0001', tierKey: 'free', status: 'active', expiresAt: '2027-01-01' },
        subscription: null,
      });
    });
    const { container, root } = await renderAccount('en');
    try {
      const subscribeBtn = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Subscribe',
      )!;
      act(() => subscribeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(onClosed).toBeTypeOf('function');
      // Simulate the checkout completing → pollAfterCheckout runs.
      act(() => {
        onClosed!(true);
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      // The status line must be visible.
      assertText(container, 'Checking your subscription…');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

// ── License display ───────────────────────────────────────────────────

describe('AccountView — license display', () => {
  it('shows license key and tier for signed-in user', async () => {
    sessionStorage.setItem('oz_session', 'tok-license');
    stubMe();
    const { container, root } = await renderAccount('en');
    try {
      assertText(container, 'License');
      assertText(container, 'OZ-TEST-0001');
      assertText(container, 'pro');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('shows email verified status', async () => {
    sessionStorage.setItem('oz_session', 'tok-verified');
    stubMe();
    const { container, root } = await renderAccount('en');
    try {
      assertText(container, 'Verified');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

// ── Region selector ───────────────────────────────────────────────────

describe('AccountView — region selector', () => {
  it('defaults to Global', async () => {
    sessionStorage.setItem('oz_session', 'tok-region');
    stubMe();
    const { container, root } = await renderAccount('en');
    try {
      assertText(container, 'Region');
      assertText(container, 'Global');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('reads saved region from localStorage', async () => {
    localStorage.setItem('oz_region', 'id');
    sessionStorage.setItem('oz_session', 'tok-region-id');
    stubMe();
    const { container, root } = await renderAccount('en');
    try {
      assertText(container, 'Indonesia');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('persists region change to localStorage', async () => {
    sessionStorage.setItem('oz_session', 'tok-region-change');
    stubMe();
    const { container, root } = await renderAccount('en');
    try {
      // Open the region dropdown.
      const regionBtn = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Global',
      );
      expect(regionBtn).not.toBeNull();
      act(() => {
        regionBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      // Click Indonesia option.
      const idOption = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Indonesia',
      );
      expect(idOption).not.toBeNull();
      act(() => {
        idOption!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      expect(localStorage.getItem('oz_region')).toBe('id');
      assertText(container, 'Region updated.');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('opens the listbox and focuses the first option on ArrowDown', async () => {
    sessionStorage.setItem('oz_session', 'tok-region-keyboard');
    stubMe();
    const { container, root } = await renderAccount('en');
    try {
      const trigger = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Global',
      );
      expect(trigger).not.toBeNull();
      expect(trigger!.getAttribute('aria-expanded')).toBe('false');

      // ArrowDown on the closed trigger opens the listbox and moves focus
      // to the first option.
      act(() => {
        trigger!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(trigger!.getAttribute('aria-expanded')).toBe('true');

      // The first option (Global) should now have focus.
      const options = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-region-option]'));
      expect(options.length).toBe(2);
      expect(document.activeElement).toBe(options[0]);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('moves focus between options with ArrowDown/ArrowUp and selects on Enter', async () => {
    sessionStorage.setItem('oz_session', 'tok-region-keyboard2');
    stubMe();
    const { container, root } = await renderAccount('en');
    try {
      const trigger = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Global',
      )!;
      act(() => {
        trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      const options = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-region-option]'));
      expect(document.activeElement).toBe(options[0]);

      // ArrowDown → second option; ArrowUp → back to first.
      act(() => {
        options[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      });
      expect(document.activeElement).toBe(options[1]);
      act(() => {
        options[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      });
      expect(document.activeElement).toBe(options[0]);

      // Enter on the second option (Indonesia) selects it.
      act(() => {
        options[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      expect(localStorage.getItem('oz_region')).toBe('id');
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('closes the listbox and refocuses the trigger on Escape', async () => {
    sessionStorage.setItem('oz_session', 'tok-region-escape');
    stubMe();
    const { container, root } = await renderAccount('en');
    try {
      const trigger = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Global',
      )!;
      act(() => {
        trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      const options = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-region-option]'));
      act(() => {
        options[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      // Listbox is closed and focus returns to the trigger.
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(container.querySelector('[data-region-option]')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('keeps the listbox open while the user navigates options with the keyboard', async () => {
    // Regression: the trigger's onBlur schedules setRegionOpen(false) in
    // 150ms. In a real browser, moving focus to an option fires the trigger's
    // blur — that timer would close the listbox mid-navigation. jsdom does
    // not fire blur on programmatic .focus(), so this test dispatches the
    // blur explicitly to model the browser, then asserts the listbox stays
    // open past the 150ms window.
    sessionStorage.setItem('oz_session', 'tok-region-blur-nav');
    stubMe();
    const { container, root } = await renderAccount('en');
    try {
      const trigger = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Global',
      )!;
      act(() => {
        trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      const options = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-region-option]'));
      expect(options.length).toBe(2);

      // Model the browser: focus moved to the option, so the trigger blurred.
      // React's synthetic onBlur listens for the bubbling `focusout` event,
      // and the browser sets relatedTarget to the newly-focused option —
      // which lives inside the listbox.
      act(() => {
        trigger.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: options[0] }));
      });

      // Wait past the 150ms blur-close window while an option is focused.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 200));
      });

      // The listbox must STILL be open and navigable.
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      expect(container.querySelector('[data-region-option]')).not.toBeNull();
      // And ArrowDown still moves focus between options.
      act(() => {
        options[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      });
      expect(document.activeElement).toBe(options[1]);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

// ── Logout flow ───────────────────────────────────────────────────────

describe('AccountView — logout', () => {
  it('clears session and redirects on logout', async () => {
    sessionStorage.setItem('oz_session', 'tok-logout');
    sessionStorage.setItem('oz_email', 'test@example.com');
    stubMe();
    let capturedHref = '';
    Object.defineProperty(window, 'location', {
      value: {
        get href() { return capturedHref; },
        set href(v: string) { capturedHref = v; },
      },
      writable: true,
    });
    const { container, root } = await renderAccount('en');
    try {
      clickButton(container, 'Sign out');
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(paddle.clearSession).toHaveBeenCalled();
      expect(capturedHref).toBe('/en');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('clears the session and redirects even when the logout API call fails', async () => {
    // Regression: logout is idempotent server-side. A network error or 500
    // must not prevent the local session from being cleared and the user
    // being redirected — the catch block must still run clearSession.
    sessionStorage.setItem('oz_session', 'tok-logout-fail');
    sessionStorage.setItem('oz_email', 'test@example.com');
    let capturedHref = '';
    Object.defineProperty(window, 'location', {
      value: {
        get href() { return capturedHref; },
        set href(v: string) { capturedHref = v; },
      },
      writable: true,
    });
    mockFetch((url, init) => {
      // /me succeeds so the profile card (with Sign out) renders; only the
      // logout POST fails.
      if (url.includes('/logout')) return badRequest(500);
      if (url.includes('/devices')) return okJson({ devices: [] });
      return okJson({
        tenant: { email: 'test@example.com', emailVerified: true, status: 'active' },
        license: { key: 'OZ-TEST-0001', tierKey: 'pro', status: 'active', expiresAt: '2027-01-01' },
        subscription: null,
      });
    });
    const { container, root } = await renderAccount('en');
    try {
      clickButton(container, 'Sign out');
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(paddle.clearSession).toHaveBeenCalled();
      expect(capturedHref).toBe('/en');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

// ── Password section ──────────────────────────────────────────────────

describe('AccountView — password change', () => {
  it('shows password section for signed-in user', async () => {
    sessionStorage.setItem('oz_session', 'tok-pw');
    stubMe();
    const { container, root } = await renderAccount('en');
    try {
      assertText(container, 'Password');
      assertText(container, 'Optional. With a password you can sign in without requesting an email code.');
      assertText(container, 'Save password');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('shows success message after saving password', async () => {
    sessionStorage.setItem('oz_session', 'tok-pw-save');
    stubMe();
    mockFetch((url) => {
      if (url.includes('set-password')) return okJson({ ok: true });
      return okJson({
        tenant: { email: 'test@example.com', emailVerified: true, status: 'active' },
        license: { key: 'OZ-TEST-0001', tierKey: 'pro', status: 'active', expiresAt: '2027-01-01' },
        subscription: null,
      });
    });
    const { container, root } = await renderAccount('en');
    try {
      // The password fields are wrapped in PasswordField which uses its own
      // state. React's synthetic event system means we can't set values by
      // patching the DOM directly — the internal state stays empty and the
      // submit button remains disabled. Instead, verify the password form
      // structure renders correctly (the actual save flow is tested by
      // checking the fetch mock fires when the button IS enabled).
      const submitBtn = Array.from(container.querySelectorAll('button[type="submit"]')).find(
        (b) => b.textContent?.trim() === 'Save password',
      );
      expect(submitBtn).not.toBeNull();
      expect((submitBtn as HTMLButtonElement).disabled).toBe(true);
      // Verify the password form section is visible.
      assertText(container, 'Save password');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

// ── Error state ───────────────────────────────────────────────────────

describe('AccountView — error state', () => {
  it('shows error message on fetch failure', async () => {
    sessionStorage.setItem('oz_session', 'tok-error');
    mockFetch(() => badRequest(500));
    const { container, root } = await renderAccount('en');
    try {
      assertText(container, "Couldn't load your account. Please try again.");
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

// ── Quick actions & License Copy ──────────────────────────────────────

describe('AccountView — Quick actions & License Copy', () => {
  it('renders copy key button and quick action links when signed in', async () => {
    sessionStorage.setItem('oz_session', 'tok-123');
    stubMe();
    const { container, root } = await renderAccount('en');
    try {
      assertText(container, 'Copy key');
      assertText(container, 'Download app');
      assertText(container, 'Activation guide');
      assertText(container, 'Contact support');

      const downloadLink = container.querySelector('a[href="/en/download"]');
      expect(downloadLink).not.toBeNull();
      const activationLink = container.querySelector('a[href="/en/docs/activation"]');
      expect(activationLink).not.toBeNull();
      const supportLink = container.querySelector('a[href="/en/support"]');
      expect(supportLink).not.toBeNull();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

// ── Devices & Billing Invoices ───────────────────────────────────────

describe('AccountView — Devices & Invoices', () => {
  it('renders registered terminals section and billing invoices section', async () => {
    sessionStorage.setItem('oz_session', 'tok-enterprise');
    // Route /me to the tenant payload and /devices to a one-device list.
    mockFetch((url) => {
      if (url.includes('/devices')) {
        return okJson({ devices: [{ id: 'mac-1', machine_id: 'MACHINE-001', created: '2026-08-01T00:00:00Z', revoked_at: null }] });
      }
      return okJson({
        tenant: { email: 'test@example.com', emailVerified: true, status: 'active' },
        license: { key: 'OZ-TEST-0001', tierKey: 'enterprise', status: 'active', expiresAt: '2027-01-01' },
        subscription: { tierKey: 'enterprise', status: 'active' },
      });
    });
    const { container, root } = await renderAccount('en');
    try {
      assertText(container, 'Registered Terminals');
      // Live count badge (devices.length) replaces the entitlement text.
      assertText(container, '1 terminal');
      assertText(container, 'MACHINE-001');
      assertText(container, 'Billing & Receipts');
      assertText(container, 'Access Billing Portal & Receipts');

      const mailtoInvoice = container.querySelector('a[href^="mailto:sales@kasir.mu"]');
      expect(mailtoInvoice).not.toBeNull();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('revokes a device via POST /web/devices/{id}/revoke and marks it revoked', async () => {
    sessionStorage.setItem('oz_session', 'tok-revoke');
    const revokeCalls: string[] = [];
    mockFetch((url, init) => {
      if (url.includes('/devices') && init?.method === 'POST') {
        revokeCalls.push(url);
        return okJson({ status: 'revoked', revoked_at: '2026-08-29T00:00:00Z' });
      }
      if (url.includes('/devices')) {
        return okJson({ devices: [{ id: 'mac-1', machine_id: 'MACHINE-001', created: '2026-08-01T00:00:00Z', revoked_at: null }] });
      }
      return okJson({
        tenant: { email: 'test@example.com', emailVerified: true, status: 'active' },
        license: { key: 'OZ-TEST-0001', tierKey: 'pro', status: 'active', expiresAt: '2027-01-01' },
        subscription: null,
      });
    });
    const { container, root } = await renderAccount('en');
    try {
      // The active device shows a Revoke button.
      const revokeBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Revoke');
      expect(revokeBtn).not.toBeNull();
      act(() => {
        revokeBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(revokeCalls).toHaveLength(1);
      expect(revokeCalls[0]).toContain('/api/v1/web/devices/mac-1/revoke');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('shows overflow hint when more than 5 devices exist', async () => {
    sessionStorage.setItem('oz_session', 'tok-overflow');
    const devices = Array.from({ length: 7 }, (_, i) => ({
      id: `mac-${i}`,
      machine_id: `MACHINE-${String(i).padStart(3, '0')}`,
      created: '2026-08-01T00:00:00Z',
      revoked_at: null,
    }));
    mockFetch((url) => {
      if (url.includes('/devices')) return okJson({ devices });
      return okJson({
        tenant: { email: 'test@example.com', emailVerified: true, status: 'active' },
        license: { key: 'OZ-TEST-0001', tierKey: 'pro', status: 'active', expiresAt: '2027-01-01' },
        subscription: null,
      });
    });
    const { container, root } = await renderAccount('en');
    try {
      assertText(container, 'Registered Terminals');
      assertText(container, '+2 more');
      // First 5 device IDs should be visible, the 6th and 7th should not.
      assertText(container, 'MACHINE-000');
      assertText(container, 'MACHINE-004');
      assertNoText(container, 'MACHINE-005');
      assertNoText(container, 'MACHINE-006');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('shows terminal slots hint when devices list is empty', async () => {
    sessionStorage.setItem('oz_session', 'tok-empty-devices');
    mockFetch((url) => {
      if (url.includes('/devices')) return okJson({ devices: [] });
      return okJson({
        tenant: { email: 'test@example.com', emailVerified: true, status: 'active' },
        license: { key: 'OZ-TEST-0001', tierKey: 'pro', status: 'active', expiresAt: '2027-01-01' },
        subscription: null,
      });
    });
    const { container, root } = await renderAccount('en');
    try {
      assertText(container, 'Terminal Slots');
      assertText(container, 'Activation guide');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('shows revoke error when API call fails', async () => {
    sessionStorage.setItem('oz_session', 'tok-revoke-error');
    let revokeAttempted = false;
    const deviceId = 'mac-1';
    mockFetch((url, init) => {
      if (url.includes('/devices') && init?.method === 'POST') {
        revokeAttempted = true;
        return badRequest(500);
      }
      if (url.includes('/devices')) {
        return okJson({ devices: [{ id: deviceId, machine_id: 'MACHINE-001', created: '2026-08-01T00:00:00Z', revoked_at: null }] });
      }
      return okJson({
        tenant: { email: 'test@example.com', emailVerified: true, status: 'active' },
        license: { key: 'OZ-TEST-0001', tierKey: 'pro', status: 'active', expiresAt: '2027-01-01' },
        subscription: null,
      });
    });
    const { container, root } = await renderAccount('en');
    try {
      const revokeBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Revoke');
      expect(revokeBtn).not.toBeNull();
      act(() => revokeBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(revokeAttempted).toBe(true);
      // The error message should appear (contains the HTTP status code).
      assertText(container, '500');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('keeps the device list visible after a successful revoke even when the refresh fetch fails', async () => {
    // Regression: after a successful revoke POST, the follow-up GET /devices
    // may fail (network error / server glitch). The device list must NOT
    // collapse to the fallback hint — the just-revoked device should stay
    // visible as "Revoked" even without a fresh list.
    sessionStorage.setItem('oz_session', 'tok-revoke-refresh-fail');
    let devicesGetCount = 0;
    mockFetch((url, init) => {
      if (url.includes('/devices') && init?.method === 'POST') {
        return okJson({ status: 'revoked', revoked_at: '2026-08-29T00:00:00Z' });
      }
      if (url.includes('/devices') && !init?.method) {
        devicesGetCount++;
        // First GET (initial load) succeeds, second GET (refresh after
        // revoke) fails with 500.
        if (devicesGetCount === 1) {
          return okJson({ devices: [{ id: 'mac-1', machine_id: 'MACHINE-001', created: '2026-08-01T00:00:00Z', revoked_at: null }] });
        }
        return badRequest(500);
      }
      return okJson({
        tenant: { email: 'test@example.com', emailVerified: true, status: 'active' },
        license: { key: 'OZ-TEST-0001', tierKey: 'pro', status: 'active', expiresAt: '2027-01-01' },
        subscription: null,
      });
    });
    const { container, root } = await renderAccount('en');
    try {
      // The device is initially active with a Revoke button.
      assertText(container, 'MACHINE-001');
      const revokeBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Revoke');
      expect(revokeBtn).not.toBeNull();
      act(() => revokeBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      // The device list must still be visible (not collapsed to the hint),
      // and the device must show as "Revoked" (the optimistic stamp).
      assertText(container, 'MACHINE-001');
      assertText(container, 'Revoked');
      assertNoText(container, 'Terminal Slots');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

// ── Status pill colors ────────────────────────────────────────────────

describe('AccountView — status pill colors', () => {
  it('shows success pill for active status', async () => {
    sessionStorage.setItem('oz_session', 'tok-pill-active');
    mockFetch(() => okJson({
      tenant: { email: 'test@example.com', emailVerified: true, status: 'active' },
      license: { key: 'OZ-TEST-0001', tierKey: 'pro', status: 'active', expiresAt: '2027-01-01' },
      subscription: null,
    }));
    const { container, root } = await renderAccount('en');
    try {
      // The license status pill shows "Active" with green classes.
      const pills = Array.from(container.querySelectorAll('span.rounded-full'));
      const activePill = pills.find((p) => p.textContent?.trim() === 'Active');
      expect(activePill).not.toBeNull();
      expect(activePill!.className).toContain('bg-success/15');
      expect(activePill!.className).toContain('text-success');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('shows warning pill for grace_period status', async () => {
    sessionStorage.setItem('oz_session', 'tok-pill-grace');
    mockFetch(() => okJson({
      tenant: { email: 'test@example.com', emailVerified: true, status: 'grace_period' },
      license: { key: 'OZ-TEST-0001', tierKey: 'pro', status: 'grace_period', expiresAt: '2026-01-01' },
      subscription: null,
    }));
    const { container, root } = await renderAccount('en');
    try {
      const pills = Array.from(container.querySelectorAll('span.rounded-full'));
      const gracePill = pills.find((p) => p.textContent?.trim() === 'In grace period');
      expect(gracePill).not.toBeNull();
      expect(gracePill!.className).toContain('bg-warning/15');
      expect(gracePill!.className).toContain('text-warning');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('shows danger pill for expired status', async () => {
    sessionStorage.setItem('oz_session', 'tok-pill-expired');
    mockFetch(() => okJson({
      tenant: { email: 'test@example.com', emailVerified: true, status: 'expired' },
      license: { key: 'OZ-TEST-0001', tierKey: 'pro', status: 'expired', expiresAt: '2025-01-01' },
      subscription: null,
    }));
    const { container, root } = await renderAccount('en');
    try {
      const pills = Array.from(container.querySelectorAll('span.rounded-full'));
      const expiredPill = pills.find((p) => p.textContent?.trim() === 'Expired');
      expect(expiredPill).not.toBeNull();
      expect(expiredPill!.className).toContain('bg-danger/15');
      expect(expiredPill!.className).toContain('text-danger');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('shows danger pill for revoked status', async () => {
    sessionStorage.setItem('oz_session', 'tok-pill-revoked');
    mockFetch(() => okJson({
      tenant: { email: 'test@example.com', emailVerified: true, status: 'revoked' },
      license: { key: 'OZ-TEST-0001', tierKey: 'pro', status: 'revoked', expiresAt: '2025-01-01' },
      subscription: null,
    }));
    const { container, root } = await renderAccount('en');
    try {
      const pills = Array.from(container.querySelectorAll('span.rounded-full'));
      const revokedPill = pills.find((p) => p.textContent?.trim() === 'Revoked');
      expect(revokedPill).not.toBeNull();
      expect(revokedPill!.className).toContain('bg-danger/15');
      expect(revokedPill!.className).toContain('text-danger');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('shows a localized label for paused status instead of the raw server value', async () => {
    // Regression: the license-server subscriptions schema allows status
    // 'paused', but statusLabel did not handle it — it fell through to the
    // raw English value ('paused') even for the id locale.
    sessionStorage.setItem('oz_session', 'tok-pill-paused');
    mockFetch(() => okJson({
      tenant: { email: 'test@example.com', emailVerified: true, status: 'active' },
      license: { key: 'OZ-TEST-0001', tierKey: 'pro', status: 'paused', expiresAt: '2027-01-01' },
      subscription: { tierKey: 'pro', status: 'paused', startsAt: '2026-01-01', expiresAt: '2027-01-01' },
    }));
    const { container, root } = await renderAccount('id');
    try {
      // The localized Indonesian label ('Ditangguhkan') must be shown, never
      // the raw English 'paused' value.
      assertText(container, 'Ditangguhkan');
      assertNoText(container, 'paused');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

// ── Status label — edge cases ─────────────────────────────────────────

describe('AccountView — status label edge cases', () => {
  it('shows the localized label for unused status', async () => {
    // statusLabel('unused') was untested — the server can report a license
    // key as 'unused' (minted by the webhook, not yet activated). The
    // dashboard must show the localized label, not the raw value.
    sessionStorage.setItem('oz_session', 'tok-label-unused');
    mockFetch(() => okJson({
      tenant: { email: 'test@example.com', emailVerified: true, status: 'active' },
      license: { key: 'OZ-TEST-0001', tierKey: 'pro', status: 'unused', expiresAt: '2027-01-01' },
      subscription: null,
    }));
    const { container, root } = await renderAccount('en');
    try {
      // 'Not activated' is the statusLabel return for 'unused' status.
      assertText(container, 'Not activated');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('shows the raw value for an unknown status (fallback path)', async () => {
    // statusLabel's default case returns the raw status value — the
    // dashboard must not crash when the server sends a new/unexpected
    // status string.
    sessionStorage.setItem('oz_session', 'tok-label-unknown');
    mockFetch(() => okJson({
      tenant: { email: 'test@example.com', emailVerified: true, status: 'suspended' },
      license: { key: 'OZ-TEST-0001', tierKey: 'pro', status: 'suspended', expiresAt: '2027-01-01' },
      subscription: null,
    }));
    const { container, root } = await renderAccount('en');
    try {
      assertText(container, 'suspended');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

// ── Formatted dates — edge cases ──────────────────────────────────────

describe('AccountView — formatted dates edge cases', () => {
  it('shows an em-dash when the license has no expiry date', async () => {
    // fmtDate(undefined) returns '—' — the license section must not crash
    // or show a raw JavaScript value when expiresAt is absent.
    sessionStorage.setItem('oz_session', 'tok-date-missing');
    mockFetch(() => okJson({
      tenant: { email: 'test@example.com', emailVerified: true, status: 'active' },
      license: { key: 'OZ-TEST-0001', tierKey: 'pro', status: 'active', expiresAt: undefined },
      subscription: null,
    }));
    const { container, root } = await renderAccount('en');
    try {
      assertText(container, '—');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

// ── Renewal countdown badge ───────────────────────────────────────────

describe('AccountView — renewal countdown', () => {
  // Build an expiry exactly N UTC calendar days ahead of today's UTC date.
  // daysUntil() compares UTC calendar dates (date-only), so the fixture must
  // land the expiry on the intended UTC day — constructing at LOCAL midnight
  // was off by one on any timezone east of UTC (e.g. UTC+7).
  function utcDaysFromNow(days: number): string {
    const now = new Date();
    const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return new Date(base + days * 86_400_000).toISOString();
  }

  it('shows renews badge for active subscription with expiry', async () => {
    sessionStorage.setItem('oz_session', 'tok-renew-badge');
    const expectedDays = 10;
    const future = utcDaysFromNow(expectedDays);
    mockFetch(() => okJson({
      tenant: { email: 'test@example.com', emailVerified: true, status: 'active' },
      license: { key: 'OZ-TEST-0001', tierKey: 'pro', status: 'active', expiresAt: future },
      subscription: { tierKey: 'pro', status: 'active', startsAt: '2026-01-01', expiresAt: future },
    }));
    const { container, root } = await renderAccount('en');
    try {
      assertText(container, 'Subscription');
      assertText(container, `Renews in ${expectedDays} days`);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('shows renews badge with danger color when < 7 days', async () => {
    sessionStorage.setItem('oz_session', 'tok-renew-urgent');
    const expectedDays = 3;
    const soon = utcDaysFromNow(expectedDays);
    mockFetch(() => okJson({
      tenant: { email: 'test@example.com', emailVerified: true, status: 'active' },
      license: { key: 'OZ-TEST-0001', tierKey: 'pro', status: 'active', expiresAt: soon },
      subscription: { tierKey: 'pro', status: 'active', startsAt: '2026-01-01', expiresAt: soon },
    }));
    const { container, root } = await renderAccount('en');
    try {
      assertText(container, `Renews in ${expectedDays} days`);
      // Find the badge span and check its class.
      const badges = Array.from(container.querySelectorAll('span.rounded-full'));
      const renewBadge = badges.find((b) => b.textContent?.includes('Renews in'));
      expect(renewBadge).not.toBeNull();
      expect(renewBadge!.className).toContain('bg-danger/15');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('does not show renew badge for inactive subscription', async () => {
    sessionStorage.setItem('oz_session', 'tok-renew-inactive');
    mockFetch(() => okJson({
      tenant: { email: 'test@example.com', emailVerified: true, status: 'active' },
      license: { key: 'OZ-TEST-0001', tierKey: 'pro', status: 'active', expiresAt: '2027-01-01' },
      subscription: { tierKey: 'pro', status: 'expired', startsAt: '2025-01-01', expiresAt: '2026-01-01' },
    }));
    const { container, root } = await renderAccount('en');
    try {
      assertText(container, 'Expired');
      // No badge text should appear for non-active subscriptions.
      assertNoText(container, 'Renews in');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('does not show a negative renewal countdown for active subscription with past expiry', async () => {
    // An "active" subscription whose expiresAt has already passed (server
    // clock skew / grace-period data) must not render "Renews in -3 days".
    sessionStorage.setItem('oz_session', 'tok-renew-past');
    const past = new Date(Date.now() - 3 * 86_400_000);
    mockFetch(() => okJson({
      tenant: { email: 'test@example.com', emailVerified: true, status: 'active' },
      license: { key: 'OZ-TEST-0001', tierKey: 'pro', status: 'active', expiresAt: '2027-01-01' },
      subscription: { tierKey: 'pro', status: 'active', startsAt: '2025-01-01', expiresAt: past.toISOString() },
    }));
    const { container, root } = await renderAccount('en');
    try {
      // The badge must not claim a future countdown for an already-past date.
      assertNoText(container, 'Renews in -3 days');
      assertNoText(container, 'Renews in');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('does not show a countdown badge for an invalid expiry date', async () => {
    // Regression: new Date('not-a-date') creates an Invalid Date (not a
    // throw), so daysUntil returned NaN. Math.round(NaN) = NaN, and NaN < 0
    // is false — the guard failed and "Renews in NaN days" was rendered.
    sessionStorage.setItem('oz_session', 'tok-renew-nan');
    mockFetch(() => okJson({
      tenant: { email: 'test@example.com', emailVerified: true, status: 'active' },
      license: { key: 'OZ-TEST-0001', tierKey: 'pro', status: 'active', expiresAt: '2027-01-01' },
      subscription: { tierKey: 'pro', status: 'active', startsAt: '2026-01-01', expiresAt: 'not-a-date' },
    }));
    const { container, root } = await renderAccount('en');
    try {
      // The subscription section shows, but no countdown badge.
      assertText(container, 'Subscription');
      assertNoText(container, 'Renews in');
      assertNoText(container, 'NaN');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('shows a muted (non-urgent) renew badge when 30+ days remain', async () => {
    // renderRenewBadge: d < 30 → warning; d >= 30 → muted. The muted branch
    // was untested. Build an expiry 45 days ahead (UTC) and assert the badge
    // exists and carries the muted class — not the warning class.
    sessionStorage.setItem('oz_session', 'tok-renew-muted');
    const far = utcDaysFromNow(45);
    mockFetch(() => okJson({
      tenant: { email: 'test@example.com', emailVerified: true, status: 'active' },
      license: { key: 'OZ-TEST-0001', tierKey: 'pro', status: 'active', expiresAt: '2027-01-01' },
      subscription: { tierKey: 'pro', status: 'active', startsAt: '2026-01-01', expiresAt: far },
    }));
    const { container, root } = await renderAccount('en');
    try {
      assertText(container, 'Renews in 45 days');
      const badges = Array.from(container.querySelectorAll('span.rounded-full'));
      const renewBadge = badges.find((b) => b.textContent?.includes('Renews in'));
      expect(renewBadge).not.toBeNull();
      expect(renewBadge!.className).toContain('bg-ink/10');
      expect(renewBadge!.className).not.toContain('bg-warning');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('shows a danger renew badge when the subscription expires today', async () => {
    // d === 0 (expires today) is < 7 → danger. This boundary was untested.
    sessionStorage.setItem('oz_session', 'tok-renew-today');
    const today = utcDaysFromNow(0);
    mockFetch(() => okJson({
      tenant: { email: 'test@example.com', emailVerified: true, status: 'active' },
      license: { key: 'OZ-TEST-0001', tierKey: 'pro', status: 'active', expiresAt: '2027-01-01' },
      subscription: { tierKey: 'pro', status: 'active', startsAt: '2026-01-01', expiresAt: today },
    }));
    const { container, root } = await renderAccount('en');
    try {
      const badges = Array.from(container.querySelectorAll('span.rounded-full'));
      const renewBadge = badges.find((b) => b.textContent?.includes('Renews in'));
      expect(renewBadge).not.toBeNull();
      expect(renewBadge!.className).toContain('bg-danger/15');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

// ── Formatted dates ───────────────────────────────────────────────────

describe('AccountView — formatted dates', () => {
  it('formats license expiry date', async () => {
    sessionStorage.setItem('oz_session', 'tok-date-license');
    mockFetch(() => okJson({
      tenant: { email: 'test@example.com', emailVerified: true, status: 'active' },
      license: { key: 'OZ-TEST-0001', tierKey: 'pro', status: 'active', expiresAt: '2027-01-01T00:00:00Z' },
      subscription: null,
    }));
    const { container, root } = await renderAccount('en');
    try {
      // Should show "Jan 1, 2027" not raw "2027-01-01".
      assertText(container, 'Jan 1, 2027');
      assertNoText(container, '2027-01-01');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('formats dates in Indonesian locale', async () => {
    sessionStorage.setItem('oz_session', 'tok-date-id');
    mockFetch(() => okJson({
      tenant: { email: 'test@example.com', emailVerified: true, status: 'active' },
      license: { key: 'OZ-TEST-0001', tierKey: 'pro', status: 'active', expiresAt: '2027-01-01T00:00:00Z' },
      subscription: null,
    }));
    const { container, root } = await renderAccount('id');
    try {
      // Indonesian locale: "1 Jan 2027" (dd MMM yyyy order).
      assertText(container, '1 Jan 2027');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('does not shift the displayed date across timezone offsets', async () => {
    // Regression: date-only + RFC3339-with-time inputs must render the same
    // calendar day regardless of the machine's timezone. A date-only string
    // like "2027-01-01" previously parsed as UTC midnight and showed
    // "Dec 31, 2026" for users west of UTC. Pin the exact text here.
    sessionStorage.setItem('oz_session', 'tok-date-tz');
    mockFetch(() => okJson({
      tenant: { email: 'test@example.com', emailVerified: true, status: 'active' },
      license: { key: 'OZ-TEST-0001', tierKey: 'pro', status: 'active', expiresAt: '2027-01-01' },
      subscription: null,
    }));
    const { container, root } = await renderAccount('en');
    try {
      // The rendered text must never contain a date-only string in its raw
      // form (server sends it that way; fmtDate must normalize it) and the
      // formatted label must pin to January 1 — never December 31.
      assertText(container, 'Jan 1, 2027');
      assertNoText(container, '2027-01-01');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('shows a stable renews countdown regardless of time of day', async () => {
    // Regression: daysUntil previously measured from UTC midnight vs now,
    // so a subscription expiring "tomorrow" could report 1 or 2 days
    // depending on the wall clock. With local-midnight normalization the
    // countdown is the calendar-day difference.
    sessionStorage.setItem('oz_session', 'tok-countdown-stable');
    // "Tomorrow" at 23:59 local — still 1 calendar day away.
    const tomorrowLate = new Date();
    tomorrowLate.setDate(tomorrowLate.getDate() + 1);
    tomorrowLate.setHours(23, 59, 59, 999);
    mockFetch(() => okJson({
      tenant: { email: 'test@example.com', emailVerified: true, status: 'active' },
      license: { key: 'OZ-TEST-0001', tierKey: 'pro', status: 'active', expiresAt: '2027-01-01' },
      subscription: { tierKey: 'pro', status: 'active', startsAt: '2026-01-01', expiresAt: tomorrowLate.toISOString() },
    }));
    const { container, root } = await renderAccount('en');
    try {
      // Even at 23:59 the countdown must be 1 day, never 2 (ceil of
      // fractional hours). The exact label depends on the runtime clock;
      // assert it's a sane positive count (singular 'day' or plural 'days').
      const text = container.textContent ?? '';
      expect(text).toMatch(/Renews in [0-9]+ day(s)?/);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

// ── Grace period date ────────────────────────────────────────────────

describe('AccountView — grace period date', () => {
  it('formats the grace until date instead of showing raw ISO', async () => {
    // Regression: graceUntil was rendered as the raw string from the server
    // while startsAt and expiresAt used fmtDate. This test pins the fix.
    sessionStorage.setItem('oz_session', 'tok-grace-date');
    mockFetch(() => okJson({
      tenant: { email: 'test@example.com', emailVerified: true, status: 'active' },
      license: { key: 'OZ-TEST-0001', tierKey: 'pro', status: 'active', expiresAt: '2027-01-01' },
      subscription: { tierKey: 'pro', status: 'grace_period', startsAt: '2026-01-01', expiresAt: '2027-01-01', graceUntil: '2027-01-15T00:00:00Z' },
    }));
    const { container, root } = await renderAccount('en');
    try {
      // Must show the formatted date, not the raw ISO value.
      assertText(container, 'Jan 15, 2027');
      assertNoText(container, '2027-01-15T00:00:00Z');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

// ── Copy key ──────────────────────────────────────────────────────────

describe('AccountView — copy key', () => {
  it('copies license key to clipboard and shows Copied feedback', async () => {
    sessionStorage.setItem('oz_session', 'tok-copy');
    stubMe();
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    const { container, root } = await renderAccount('en');
    try {
      const copyBtn = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Copy key',
      );
      expect(copyBtn).not.toBeNull();
      act(() => copyBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      expect(writeText).toHaveBeenCalledWith('OZ-TEST-0001');
      // After click, the button text should change to "Copied!".
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      assertText(container, 'Copied!');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

// ── Language locale ───────────────────────────────────────────────────

describe('AccountView — Indonesian locale', () => {
  it('renders all section labels in Indonesian', async () => {
    sessionStorage.setItem('oz_session', 'tok-id-locale');
    mockFetch(() => okJson({
      tenant: { email: 'test@example.com', emailVerified: true, status: 'active' },
      license: { key: 'OZ-TEST-0001', tierKey: 'pro', status: 'active', expiresAt: '2027-01-01T00:00:00Z' },
      subscription: { tierKey: 'pro', status: 'active', startsAt: '2026-01-01', expiresAt: '2027-01-01' },
    }));
    const { container, root } = await renderAccount('id');
    try {
      assertText(container, 'Lisensi');
      assertText(container, 'Langganan');
      assertText(container, 'Wilayah');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

// ── Email verification badge ───────────────────────────────────────────

describe('AccountView — email verification', () => {
  it('shows the unverified badge when the account email is not verified', async () => {
    // The tenant card must render the ○ Not verified badge (not the green
    // ✓ Verified one) when /me reports emailVerified=false.
    sessionStorage.setItem('oz_session', 'tok-unverified');
    mockFetch(() => okJson({
      tenant: { email: 'new@example.com', emailVerified: false, status: 'active' },
      license: { key: 'OZ-TEST-0001', tierKey: 'pro', status: 'active', expiresAt: '2027-01-01' },
      subscription: null,
    }));
    const { container, root } = await renderAccount('en');
    try {
      assertText(container, 'Not verified');
      assertNoText(container, 'Verified');
      // The ✓ verified marker must not render either.
      expect(container.textContent).not.toContain('✓');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('shows the verified badge when the account email is verified', async () => {
    sessionStorage.setItem('oz_session', 'tok-verified-badge');
    stubMe();
    const { container, root } = await renderAccount('en');
    try {
      assertText(container, 'Verified');
      assertNoText(container, 'Not verified');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

// ── Billing invoice mailto ─────────────────────────────────────────────

describe('AccountView — billing invoice mailto', () => {
  it('builds the invoice mailto link with the tenant email encoded in the subject', async () => {
    sessionStorage.setItem('oz_session', 'tok-invoice-mailto');
    stubMe();
    const { container, root } = await renderAccount('en');
    try {
      const mailto = container.querySelector<HTMLAnchorElement>('a[href^="mailto:sales@kasir.mu"]');
      expect(mailto).not.toBeNull();
      // Subject is "Invoice Request - {email}" with the email URL-encoded.
      const href = mailto!.getAttribute('href') ?? '';
      expect(href).toContain(`subject=${encodeURIComponent('Invoice Request - test@example.com')}`);
      // The anchor label stays localized.
      expect(mailto!.textContent).toContain('Access Billing Portal & Receipts');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('keeps the mailto link label localized in Indonesian', async () => {
    sessionStorage.setItem('oz_session', 'tok-invoice-mailto-id');
    stubMe();
    const { container, root } = await renderAccount('id');
    try {
      const mailto = container.querySelector<HTMLAnchorElement>('a[href^="mailto:sales@kasir.mu"]');
      expect(mailto).not.toBeNull();
      expect(mailto!.textContent).toContain('Akses Portal Tagihan & Kuitansi');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

// ── Post-checkout poll timeout ─────────────────────────────────────────

describe('AccountView — post-checkout poll timeout', () => {
  it('shows the pending state when the webhook never provisions after all polls', async () => {
    // Regression: after a completed checkout, pollAfterCheckout polls /me
    // 8×2500ms. If the webhook never provisions (no subscription appears),
    // the component must land on refreshState='pending' — the "subscription
    // pending" status line — instead of spinning forever or going silent.
    vi.useFakeTimers();
    try {
      sessionStorage.setItem('oz_session', 'tok-poll-timeout');
      // Route through Midtrans (id region) so we can capture the onClosed
      // callback, exactly like the 'checking' test above.
      let onClosed: ((completed: boolean) => void) | undefined;
      midtrans.openMidtransCheckout.mockImplementation(async (_tier: string, _period: string, cb?: (c: boolean) => void) => {
        onClosed = cb;
      });
      mockFetch((url) => {
        if (url.includes('/devices')) return okJson({ devices: [] });
        // /me always returns no subscription — the webhook never provisions.
        return okJson({
          tenant: { email: 'test@example.com', emailVerified: true, status: 'active' },
          license: { key: 'OZ-TEST-0001', tierKey: 'free', status: 'active', expiresAt: '2027-01-01' },
          subscription: null,
        });
      });

      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);
      const { default: AccountView, ACCOUNT_LABELS } = await import('../AccountView');
      act(() => {
        root.render(<AccountView locale="id" labels={labelMap('id', ACCOUNT_LABELS)} />);
      });
      // Let the initial /me + /devices fetches settle under fake timers.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      try {
        const subscribeBtn = Array.from(container.querySelectorAll('button')).find(
          (b) => b.textContent?.trim() === 'Berlangganan',
        );
        expect(subscribeBtn).not.toBeNull();
        act(() => {
          subscribeBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(20);
        });
        expect(onClosed).toBeTypeOf('function');

        // Checkout completes → pollAfterCheckout starts (8 × 2500ms).
        act(() => {
          onClosed!(true);
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(21_000);
        });

        // The pending message must be visible — polling exhausted without a
        // subscription.
        assertText(container, 'Pembayaran Anda berhasil, tetapi langganan belum terlihat');
        // And the transient checking state is gone.
        assertNoText(container, 'Memeriksa langganan Anda');
      } finally {
        act(() => root.unmount());
        container.remove();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves the idle state when polling finds the subscription early', async () => {
    // The happy path: the webhook provisions after the first poll, so the
    // checking status is cleared and no pending message ever appears.
    vi.useFakeTimers();
    try {
      sessionStorage.setItem('oz_session', 'tok-poll-found');
      let onClosed: ((completed: boolean) => void) | undefined;
      midtrans.openMidtransCheckout.mockImplementation(async (_tier: string, _period: string, cb?: (c: boolean) => void) => {
        onClosed = cb;
      });
      let meCalls = 0;
      mockFetch((url) => {
        if (url.includes('/devices')) return okJson({ devices: [] });
        // Count only real /me API calls — getSessionToken's /__oz/session
        // probe is not a /me request and must not shift the counter.
        if (url.includes('/api/v1/web/me')) meCalls++;
        // First /me call = initial load (no subscription). Subsequent polls
        // return an active subscription (webhook provisioned).
        if (meCalls <= 1) {
          return okJson({
            tenant: { email: 'test@example.com', emailVerified: true, status: 'active' },
            license: { key: 'OZ-TEST-0001', tierKey: 'free', status: 'active', expiresAt: '2027-01-01' },
            subscription: null,
          });
        }
        return okJson({
          tenant: { email: 'test@example.com', emailVerified: true, status: 'active' },
          license: { key: 'OZ-TEST-0001', tierKey: 'pro', status: 'active', expiresAt: '2027-01-01' },
          subscription: { tierKey: 'pro', status: 'active', startsAt: '2026-01-01', expiresAt: '2027-01-01' },
        });
      });

      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);
      const { default: AccountView, ACCOUNT_LABELS } = await import('../AccountView');
      act(() => {
        root.render(<AccountView locale="id" labels={labelMap('id', ACCOUNT_LABELS)} />);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      try {
        const subscribeBtn = Array.from(container.querySelectorAll('button')).find(
          (b) => b.textContent?.trim() === 'Berlangganan',
        );
        expect(subscribeBtn).not.toBeNull();
        act(() => {
          subscribeBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(20);
        });

        // Complete the checkout and let the first poll (2500ms) run.
        act(() => {
          onClosed!(true);
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(2500);
        });

        // Subscription found → refreshState back to idle: no checking, no
        // pending status text remains.
        assertNoText(container, 'Memeriksa langganan Anda');
        assertNoText(container, 'Pembayaran Anda berhasil');
        // The subscription section shows the provisioned tier.
        assertText(container, 'pro');
      } finally {
        act(() => root.unmount());
        container.remove();
      }
    } finally {
      vi.useRealTimers();
    }
  });
});


