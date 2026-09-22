// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import CheckoutButton, { CHECKOUT_LABELS } from '../CheckoutButton';
import type { CheckoutTier } from '../../content/pricing/types';
import { labelMap } from '../../i18n';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const paddleMock = vi.hoisted(() => ({
  hasSession: vi.fn<() => Promise<boolean>>(async () => true),
  isPaddleConfigured: vi.fn(() => true),
  isPlaceholderPriceId: vi.fn(() => false),
  openPaddleCheckout: vi.fn(),
  getSessionEmail: vi.fn<() => Promise<string | null>>(async () => 'user@example.com'),
}));

const midtransMock = vi.hoisted(() => ({
  openMidtransCheckout: vi.fn(),
}));

vi.mock('../paddle', () => paddleMock);
vi.mock('../midtrans', () => midtransMock);

const sampleTier: CheckoutTier = {
  tierKey: 'pro',
  name: 'Pro',
  cta: 'Get Pro',
  period: 'yearly',
  priceId: 'pri_pro_yearly',
};

describe('CheckoutButton Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const env = import.meta.env as Record<string, unknown>;
    env.PUBLIC_LICENSE_API_URL = 'https://license.test';
    sessionStorage.clear();
    localStorage.clear();
    window.__OZ_CONFIG__ = { licenseApiUrl: 'https://license.test' };
    paddleMock.hasSession.mockResolvedValue(true);
    paddleMock.isPaddleConfigured.mockReturnValue(true);
    paddleMock.isPlaceholderPriceId.mockReturnValue(false);
    paddleMock.getSessionEmail.mockResolvedValue('user@example.com');
  });

  async function renderBtn(tier = sampleTier, locale = 'en') {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<CheckoutButton tier={tier} locale={locale} labels={labelMap(locale, CHECKOUT_LABELS)} />);
    });

    return {
      container,
      unmount: async () => {
        await act(async () => {
          root.unmount();
        });
        container.remove();
      },
    };
  }

  it('shows a "not available" message when provider is unconfigured (no mailto fallback)', async () => {
    paddleMock.isPaddleConfigured.mockReturnValue(false);
    paddleMock.hasSession.mockResolvedValue(true);
    const { container, unmount } = await renderBtn(sampleTier, 'en');

    const link = container.querySelector('a[href^="mailto:"]');
    expect(link).toBeNull();

    const button = container.querySelector('button');
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(paddleMock.openPaddleCheckout).not.toHaveBeenCalled();
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("isn't available to purchase online");
    await unmount();
  });

  it('redirects to login when user has no session', async () => {
    paddleMock.hasSession.mockResolvedValue(false);
    const { container, unmount } = await renderBtn(sampleTier, 'en');

    const button = container.querySelector('button');
    expect(button).not.toBeNull();

    // Mock window.location
    delete (window as { location?: unknown }).location;
    Object.defineProperty(window, 'location', {
      value: { href: '' },
      writable: true,
      configurable: true,
    });

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(window.location.href).toBe('/en/login?next=/en/pricing&tier=pro');
    await unmount();
  });

  it('opens Paddle checkout when signed in on global locale', async () => {
    paddleMock.hasSession.mockResolvedValue(true);
    const { container, unmount } = await renderBtn(sampleTier, 'en');

    const button = container.querySelector('button');
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(paddleMock.openPaddleCheckout).toHaveBeenCalledWith(
      'pri_pro_yearly',
      'user@example.com',
      undefined,
      undefined
    );
    await unmount();
  });

  it('opens Midtrans checkout when on id locale', async () => {
    paddleMock.hasSession.mockResolvedValue(true);
    const { container, unmount } = await renderBtn(sampleTier, 'id');

    const button = container.querySelector('button');
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(midtransMock.openMidtransCheckout).toHaveBeenCalledWith(
      'pro',
      'yearly',
      undefined,
      undefined
    );
    await unmount();
  });

  it('opens Midtrans checkout when the saved region is id even on an en-locale button', async () => {
    // Regression: payment routing follows the saved region (getExplicitRegion),
    // not the URL locale. A user on /en/pricing with region=id must get
    // Midtrans — the same bug class we fixed in AccountView.
    localStorage.setItem('oz_region', 'id');
    paddleMock.hasSession.mockResolvedValue(true);
    const { container, unmount } = await renderBtn(sampleTier, 'en');

    const button = container.querySelector('button');
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(midtransMock.openMidtransCheckout).toHaveBeenCalled();
    expect(paddleMock.openPaddleCheckout).not.toHaveBeenCalled();
    await unmount();
  });

  it('shows a "not available" message when the price id is still a placeholder (no mailto fallback)', async () => {
    // Regression: with placeholder price ids, the button must never open a
    // dead Paddle overlay or hide behind a mailto link — it shows the
    // actionable "not available to purchase online" message.
    paddleMock.isPlaceholderPriceId.mockReturnValue(true);
    paddleMock.hasSession.mockResolvedValue(true);
    const { container, unmount } = await renderBtn(sampleTier, 'en');

    const link = container.querySelector('a[href^="mailto:"]');
    expect(link).toBeNull();

    const button = container.querySelector('button');
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(paddleMock.openPaddleCheckout).not.toHaveBeenCalled();
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("isn't available to purchase online");
    await unmount();
  });

  it('shows the real CTA and opens checkout for a cookie-only session (sessionStorage empty)', async () => {
    // The regression: hasSession() used to read sessionStorage synchronously,
    // so a user signed in via the httpOnly cookie in a new tab (per-tab
    // sessionStorage empty) saw "Sign in to subscribe" and was bounced to
    // /login. The gate/label now resolve cookie-first.
    sessionStorage.clear();
    paddleMock.hasSession.mockResolvedValue(true);
    const { container, unmount } = await renderBtn(sampleTier, 'en');

    const button = container.querySelector('button');
    expect(button?.textContent).toBe('Get Pro');

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(paddleMock.openPaddleCheckout).toHaveBeenCalledWith(
      'pri_pro_yearly',
      'user@example.com',
      undefined,
      undefined
    );
    await unmount();
  });

  it('redirects to login when Paddle checkout has no session email', async () => {
    // Regression: a signed-in session whose email cannot be resolved (cache
    // cleared, /me down) must fall back to the login gate, not fail silently.
    paddleMock.hasSession.mockResolvedValue(true);
    paddleMock.getSessionEmail.mockResolvedValue(null);
    const { container, unmount } = await renderBtn(sampleTier, 'en');

    const button = container.querySelector('button');
    delete (window as { location?: unknown }).location;
    Object.defineProperty(window, 'location', {
      value: { href: '' },
      writable: true,
      configurable: true,
    });

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(window.location.href).toContain('/en/login');
    expect(paddleMock.openPaddleCheckout).not.toHaveBeenCalled();
    await unmount();
  });
});
