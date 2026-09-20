// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { labelMap } from '../../i18n';

// React 19 requires the act environment flag for async act() to work.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Account dashboard bundle upgrade (C3.2 follow-on): existing Plus
 * subscribers without the bundle see the Restaurant Starter upgrade card in
 * the subscription section, and the button routes through the SAME
 * bundle-aware checkout helpers as the pricing page — Paddle with the
 * bundle price id + custom_data.bundle (other locales), Midtrans Snap with
 * bundle=restaurant_starter (id). The checkout modules are stubbed so the
 * test asserts the routing, not the overlay SDK.
 */

const midtrans = vi.hoisted(() => ({ openMidtransCheckout: vi.fn() }));
const paddle = vi.hoisted(() => ({
  openPaddleCheckout: vi.fn(),
  getSessionEmail: vi.fn(async () => 'plus@example.com'),
  clearSession: vi.fn(),
  isPaddleConfigured: vi.fn(() => true),
  // The pricing content still carries pri_placeholder_* ids until the real
  // catalog lands (subscription-tiers.md §2); the test simulates the catalog
  // having landed so the card renders and the routing is exercised.
  isPlaceholderPriceId: vi.fn(() => false),
}));
vi.mock('../midtrans', () => midtrans);
vi.mock('../paddle', () => paddle);

function stubMe(subscription?: Record<string, unknown>): void {
  // A plain object (not an undici Response) so res.json() resolves on a
  // plain microtask — a Response body-stream read can resolve outside the
  // act() window and trigger React's "not wrapped in act" warning.
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        tenant: { email: 'plus@example.com', emailVerified: true, status: 'active' },
        license: { key: 'OZ-PLUS-0001', tierKey: 'plus', status: 'active', expiresAt: '2027-01-01' },
        subscription: subscription ?? null,
      }),
    }),
  );
}

async function renderAccount(locale: string) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const { default: AccountView, ACCOUNT_LABELS } = await import('../AccountView');
  // Synchronous act for the mount, then a SEPARATE async act spanning a
  // macrotask settle — the same shape React Testing Library uses (render,
  // then waitFor). An async act that contains the render itself lets the
  // /me fetch's microtask updates escape and trips React's "not wrapped in
  // act" warning.
  act(() => {
    root.render(<AccountView locale={locale} labels={labelMap(locale, ACCOUNT_LABELS)} />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  return { container, root };
}

function assertText(container: HTMLElement, text: string): void {
  expect(container.textContent).toContain(text);
}

function assertNoText(container: HTMLElement, text: string): void {
  expect(container.textContent).not.toContain(text);
}

beforeEach(() => {
  vi.clearAllMocks();
  const env = import.meta.env as Record<string, unknown>;
  env.PUBLIC_LICENSE_API_URL = 'https://license.test';
  sessionStorage.clear();
  sessionStorage.setItem('oz_session', 'sess-account-bundle-1');
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('AccountView bundle upgrade', () => {
  it('shows the Restaurant Starter card to a Plus subscriber and routes it through Paddle', async () => {
    stubMe({ tierKey: 'plus', status: 'active', startsAt: '2026-01-01', expiresAt: '2027-01-01' });
    const { container, root } = await renderAccount('en');
    try {
      assertText(container, 'Restaurant Starter bundle');
      expect(container.querySelector('[data-testid="account-bundle-upgrade"]')).not.toBeNull();
      // Yearly bundle price from the en pricing content.
      expect(container.textContent).toContain('$74.99');
      expect(container.textContent).toContain('10% off à la carte');

      const button = container.querySelector('[data-testid="account-bundle-upgrade"] button');
      expect(button).not.toBeNull();
      await act(async () => {
        (button as HTMLButtonElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(paddle.openPaddleCheckout).toHaveBeenCalledWith(
        'pri_placeholder_plus_bundle_yearly',
        'plus@example.com',
        expect.any(Function),
        'restaurant_starter',
      );
      expect(midtrans.openMidtransCheckout).not.toHaveBeenCalled();
    } finally {
      // Unmount schedules a root update — React 19 warns if it lands
      // outside act() after the async mount has settled.
      act(() => root.unmount());
      container.remove();
    }
  });

  it('routes the bundle upgrade through Midtrans Snap for the id locale', async () => {
    stubMe({ tierKey: 'plus', status: 'active' });
    const { container, root } = await renderAccount('id');
    try {
      assertText(container, 'Paket Restaurant Starter');
      assertText(container, 'Rp 750.000');

      const button = container.querySelector('[data-testid="account-bundle-upgrade"] button');
      expect(button).not.toBeNull();
      await act(async () => {
        (button as HTMLButtonElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(midtrans.openMidtransCheckout).toHaveBeenCalledWith(
        'plus',
        'yearly',
        expect.any(Function),
        'restaurant_starter',
      );
      expect(paddle.openPaddleCheckout).not.toHaveBeenCalled();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('hides the upgrade card once the subscriber already owns the bundle', async () => {
    stubMe({ tierKey: 'plus', status: 'active', bundleId: 'restaurant_starter' });
    const { container, root } = await renderAccount('en');
    try {
      assertText(container, 'Subscription');
      expect(container.querySelector('[data-testid="account-bundle-upgrade"]')).toBeNull();
      assertNoText(container, 'Restaurant Starter bundle');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('hides the upgrade card for non-Plus subscriptions', async () => {
    stubMe({ tierKey: 'pro', status: 'active' });
    const { container, root } = await renderAccount('en');
    try {
      assertText(container, 'Subscription');
      expect(container.querySelector('[data-testid="account-bundle-upgrade"]')).toBeNull();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('hides the card while the bundle checkout is unavailable (placeholder ids)', async () => {
    // Real behavior against the current content: bundle price ids are
    // pri_placeholder_* until the catalog lands, so no dead checkout.
    paddle.isPlaceholderPriceId.mockReturnValue(true);
    stubMe({ tierKey: 'plus', status: 'active' });
    const { container, root } = await renderAccount('en');
    try {
      assertText(container, 'Subscription');
      expect(container.querySelector('[data-testid="account-bundle-upgrade"]')).toBeNull();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('shows the bundle card with IDR prices when the saved region is Indonesia on an en-locale page', async () => {
    // Regression: the bundle upgrade card's pricing source must follow the
    // payment provider region (id → Midtrans → IDR prices), not the URL
    // locale (en → USD). The bundle card for Plus users on /en/account with
    // region=id must show 'Rp 750.000', not '$74.99'.
    localStorage.setItem('oz_region', 'id');
    stubMe({ tierKey: 'plus', status: 'active' });
    const { container, root } = await renderAccount('en');
    try {
      assertText(container, 'Paket Restaurant Starter');
      assertText(container, 'Rp 750.000');
      assertNoText(container, '$74.99');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});
