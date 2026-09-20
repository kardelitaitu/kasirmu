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
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ token: 'snap-token-123', redirect_url: '' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
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
      hasSession: () => true,
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
      hasSession: () => true,
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
