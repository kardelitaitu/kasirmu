// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { CheckoutTier } from '../../content/pricing/types';
import { labelMap } from '../../i18n';

// React 19 requires the act environment flag for async act() to work.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Midtrans Snap checkout (ADR #39 D1). Covers:
 *  1. openMidtransCheckout: snap token from the license server → snap.pay,
 *     with the completion signal wired to onClose.
 *  2. CheckoutButton routing: the id-locale button opens Midtrans Snap
 *     (and never Paddle); other locales keep the Paddle path.
 */

beforeEach(() => {
  vi.resetModules();
  const env = import.meta.env as Record<string, unknown>;
  env.PUBLIC_LICENSE_API_URL = 'https://license.test';
  sessionStorage.clear();
  // The snap token fetch is real enough: stub the API on global fetch.
  // URL-aware so the session probe (/__oz/session) and the snap endpoint can
  // answer differently. Default: no cookie (401) — tests that need a cookie
  // session either set sessionStorage or override this stub.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      if (url === '/__oz/session') return json({ error: 'not signed in' }, 401);
      return json({ token: 'snap-token-123', redirect_url: '' });
    }),
  );
});

async function renderButton(locale: string, tier: CheckoutTier) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const { default: CheckoutButton, CHECKOUT_LABELS } = await import('../CheckoutButton');
  await act(async () => {
    root.render(<CheckoutButton locale={locale} tier={tier} labels={labelMap(locale, CHECKOUT_LABELS)} />);
  });
  return { container, root };
}

async function clickButton(container: HTMLElement) {
  const button = container.querySelector('button');
  if (!button) throw new Error('checkout button not found');
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('openMidtransCheckout', () => {
  it('requests a snap token with the session and calls snap.pay', async () => {
    sessionStorage.setItem('oz_session', 'sess-1');
    const pay = vi.fn();
    (window as unknown as { snap: unknown }).snap = { pay };

    const { openMidtransCheckout } = await import('../midtrans');
    await openMidtransCheckout('plus', 'yearly');

    expect(fetch).toHaveBeenCalledWith(
      'https://license.test/api/v1/midtrans/snap',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer sess-1',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ tier_key: 'plus', period: 'yearly' }),
      }),
    );
    expect(pay).toHaveBeenCalledWith('snap-token-123', expect.any(Object));
    delete (window as unknown as { snap?: unknown }).snap;
  });

  it('reports completion through onClose when onSuccess fired', async () => {
    sessionStorage.setItem('oz_session', 'sess-1');
    const onClosed = vi.fn();
    let successCb: (() => void) | undefined;
    let closeCb: (() => void) | undefined;
    (window as unknown as { snap: unknown }).snap = {
      pay: (_token: string, opts?: { onSuccess?: () => void; onClose?: () => void }) => {
        successCb = opts?.onSuccess;
        closeCb = opts?.onClose;
      },
    };

    const { openMidtransCheckout } = await import('../midtrans');
    await openMidtransCheckout('pro', 'monthly', onClosed);
    successCb?.();
    closeCb?.();
    expect(onClosed).toHaveBeenCalledWith(true);
    delete (window as unknown as { snap?: unknown }).snap;
  });

  it('throws without a session token', async () => {
    const { openMidtransCheckout } = await import('../midtrans');
    await expect(openMidtransCheckout('plus', 'yearly')).rejects.toThrow('midtrans not configured');
  });

  it('resolves the license API at click time, so a late runtime config still checks out', async () => {
    // The late-config regression, measured in a browser 2026-09-23: the account
    // dashboard renders, loads this module, and only THEN receives
    // /__oz/runtime-config.js. A module-scope `const API = licenseApiUrl()`
    // froze the pre-config undefined, so the click threw 'midtrans not
    // configured' and issued no request at all — the runtime URL must win even
    // when it arrives after import.
    // Empty string, not undefined: an assignment of undefined to
    // import.meta.env does not take effect under Vitest, so the build-time
    // value would silently survive and this test would prove nothing.
    (import.meta.env as Record<string, unknown>).PUBLIC_LICENSE_API_URL = '';
    const { openMidtransCheckout } = await import('../midtrans');
    window.__OZ_CONFIG__ = { licenseApiUrl: 'https://license.late' };
    sessionStorage.setItem('oz_session', 'sess-1');
    const pay = vi.fn();
    (window as unknown as { snap: unknown }).snap = { pay };

    try {
      await openMidtransCheckout('plus', 'yearly');

      expect(fetch).toHaveBeenCalledWith(
        'https://license.late/api/v1/midtrans/snap',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(pay).toHaveBeenCalledWith('snap-token-123', expect.any(Object));
    } finally {
      delete (window as unknown as { snap?: unknown }).snap;
      delete window.__OZ_CONFIG__;
    }
  });

  it('throws when neither the runtime config nor the build-time URL is set', async () => {
    // Empty string, not undefined: see the note in the test above.
    (import.meta.env as Record<string, unknown>).PUBLIC_LICENSE_API_URL = '';
    delete window.__OZ_CONFIG__;
    const { openMidtransCheckout } = await import('../midtrans');
    sessionStorage.setItem('oz_session', 'sess-1');

    await expect(openMidtransCheckout('plus', 'yearly')).rejects.toThrow('midtrans not configured');
  });

  it('uses the cookie token when sessionStorage is empty (cookie-only session)', async () => {
    // The regression: reading sessionStorage directly made the id-locale
    // checkout fail outright for a user signed in via the httpOnly cookie in a
    // new tab (per-tab sessionStorage empty). It must resolve cookie-first.
    sessionStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const json = (body: unknown, status = 200) =>
          new Response(JSON.stringify(body), {
            status,
            headers: { 'Content-Type': 'application/json' },
          });
        if (url === '/__oz/session') return json({ token: 'cookie.token' });
        return json({ token: 'snap-token-123', redirect_url: '' });
      }),
    );
    const pay = vi.fn();
    (window as unknown as { snap: unknown }).snap = { pay };

    const { openMidtransCheckout } = await import('../midtrans');
    await openMidtransCheckout('plus', 'yearly');

    expect(fetch).toHaveBeenCalledWith(
      'https://license.test/api/v1/midtrans/snap',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer cookie.token' }),
      }),
    );
    expect(pay).toHaveBeenCalledWith('snap-token-123', expect.any(Object));
    delete (window as unknown as { snap?: unknown }).snap;
  });
});

describe('CheckoutButton market routing', () => {
  it('opens Midtrans Snap for the id locale and never Paddle', async () => {
    vi.doMock('../midtrans', () => ({ openMidtransCheckout: vi.fn().mockResolvedValue(undefined) }));
    vi.doMock('../../lib/region', () => ({ getRegion: () => 'id', getExplicitRegion: () => 'id' }));
    const { openMidtransCheckout } = await import('../midtrans');
    sessionStorage.setItem('oz_session', 'sess-1');
    sessionStorage.setItem('oz_region', 'id');

    const { container, root } = await renderButton('id', {
      tierKey: 'plus',
      name: 'Plus',
      cta: 'Mulai',
      period: 'yearly',
      priceId: 'pri_placeholder_x',
    });
    await clickButton(container);

    // The bundle arg (C3.2) rides positionally after the onClosed callback.
    expect(openMidtransCheckout).toHaveBeenCalledWith('plus', 'yearly', undefined, undefined);
    await act(async () => root.unmount());
  });

  it('carries the selected bundle into the Midtrans snap request', async () => {
    vi.doMock('../midtrans', () => ({ openMidtransCheckout: vi.fn().mockResolvedValue(undefined) }));
    vi.doMock('../../lib/region', () => ({ getRegion: () => 'id', getExplicitRegion: () => 'id' }));
    const { openMidtransCheckout } = await import('../midtrans');
    sessionStorage.setItem('oz_session', 'sess-1');
    sessionStorage.setItem('oz_region', 'id');

    const { container, root } = await renderButton('id', {
      tierKey: 'plus',
      name: 'Plus',
      cta: 'Mulai',
      period: 'yearly',
      bundle: 'restaurant_starter',
    });
    await clickButton(container);

    expect(openMidtransCheckout).toHaveBeenCalledWith('plus', 'yearly', undefined, 'restaurant_starter');
    await act(async () => root.unmount());
  });

  it('opens Paddle for the en locale', async () => {
    vi.doMock('../midtrans', () => ({ openMidtransCheckout: vi.fn() }));
    vi.doMock('../../lib/region', () => ({ getRegion: () => 'global', getExplicitRegion: () => 'global' }));
    vi.doMock('../paddle', () => ({
      hasSession: () => Promise.resolve(true),
      isPaddleConfigured: () => true,
      isPlaceholderPriceId: () => false,
      openPaddleCheckout: vi.fn().mockResolvedValue(undefined),
      getSessionEmail: () => Promise.resolve('a@b.com'),
    }));
    const { openPaddleCheckout } = await import('../paddle');
    sessionStorage.setItem('oz_session', 'sess-1');

    const { container, root } = await renderButton('en', {
      tierKey: 'plus',
      name: 'Plus',
      cta: 'Get Plus',
      period: 'yearly',
      priceId: 'pri_01real',
    });
    await clickButton(container);

    expect(openPaddleCheckout).toHaveBeenCalledWith('pri_01real', 'a@b.com', undefined, undefined);
    await act(async () => root.unmount());
  });

  it('carries the selected bundle into the Paddle checkout custom data', async () => {
    vi.doMock('../midtrans', () => ({ openMidtransCheckout: vi.fn() }));
    vi.doMock('../../lib/region', () => ({ getRegion: () => 'global', getExplicitRegion: () => 'global' }));
    vi.doMock('../paddle', () => ({
      hasSession: () => Promise.resolve(true),
      isPaddleConfigured: () => true,
      isPlaceholderPriceId: () => false,
      openPaddleCheckout: vi.fn().mockResolvedValue(undefined),
      getSessionEmail: () => Promise.resolve('a@b.com'),
    }));
    const { openPaddleCheckout } = await import('../paddle');
    sessionStorage.setItem('oz_session', 'sess-1');

    const { container, root } = await renderButton('en', {
      tierKey: 'plus',
      name: 'Plus',
      cta: 'Get Plus',
      period: 'yearly',
      priceId: 'pri_01real',
      bundle: 'restaurant_starter',
    });
    await clickButton(container);

    expect(openPaddleCheckout).toHaveBeenCalledWith('pri_01real', 'a@b.com', undefined, 'restaurant_starter');
    await act(async () => root.unmount());
  });
});
