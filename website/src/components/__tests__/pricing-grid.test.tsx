// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import PricingGrid, { PRICING_LABELS } from '../PricingGrid';
import type { PricingTier } from '../../content/pricing/types';
import { labelMap } from '../../i18n';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const mockTiersUSD: PricingTier[] = [
  {
    id: 'free',
    tierKey: 'free',
    name: 'Free',
    currency: 'USD',
    description: 'Basic POS for small shops.',
    highlight: false,
    cta: 'Download free',
    prices: {
      monthly: { price: '$0', period: '/month' },
      yearly: { price: '$0', period: '/year' },
    },
    features: [{ label: '1 Terminal', included: true }],
  },
  {
    id: 'pro',
    tierKey: 'pro',
    name: 'Pro',
    currency: 'USD',
    description: 'For growing businesses.',
    highlight: true,
    cta: 'Get Pro',
    prices: {
      monthly: { price: '$9.99', period: '/month', priceId: 'pri_pro_monthly', variantPrice: '$7.99', variantPriceId: 'pri_pro_ab' },
      yearly: { price: '$99', period: '/year', priceId: 'pri_pro_yearly' },
    },
    features: [{ label: 'Unlimited Terminals', included: true }],
  },
];

const mockTiersIDR: PricingTier[] = [
  {
    id: 'free',
    tierKey: 'free',
    name: 'Gratis',
    currency: 'IDR',
    description: 'POS dasar untuk toko kecil.',
    highlight: false,
    cta: 'Unduh gratis',
    prices: {
      monthly: { price: 'Rp 0', period: '/bulan' },
      yearly: { price: 'Rp 0', period: '/tahun' },
    },
    features: [{ label: '1 Terminal', included: true }],
  },
  {
    id: 'pro',
    tierKey: 'pro',
    name: 'Pro',
    currency: 'IDR',
    description: 'Untuk bisnis berkembang.',
    highlight: true,
    cta: 'Pilih Pro',
    prices: {
      monthly: { price: 'Rp 99.000', period: '/bulan' },
      yearly: { price: 'Rp 990.000', period: '/tahun' },
    },
    features: [{ label: 'Terminal Tanpa Batas', included: true }],
  },
];

describe('PricingGrid Component', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  async function renderGrid(
    locale = 'en',
    tiers = locale === 'id' ? mockTiersIDR : mockTiersUSD,
  ) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PricingGrid
          locale={locale}
          labels={labelMap(locale, PRICING_LABELS)}
          tiers={tiers}
          downloadHref={`/${locale}/download`}
          contactHref={`/${locale}/support`}
        />,
      );
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

  it('renders annual pricing by default ($99 for Pro)', async () => {
    const { container, unmount } = await renderGrid('en');
    expect(container.textContent).toContain('Pro');
    expect(container.textContent).toContain('$99');
    expect(container.textContent).toContain('Download free');
    await unmount();
  });

  it('switches to monthly pricing when monthly toggle is clicked', async () => {
    const { container, unmount } = await renderGrid('en');
    const monthlyBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Monthly'));
    expect(monthlyBtn).toBeDefined();

    await act(async () => {
      monthlyBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('$9.99');
    await unmount();
  });

  it('renders IDR pricing when locale is id', async () => {
    const { container, unmount } = await renderGrid('id', mockTiersIDR);
    expect(container.textContent).toContain('Rp 990.000');
    expect(container.textContent).toContain('Unduh gratis');
    await unmount();
  });

  it('renders free tier download link correctly', async () => {
    const { container, unmount } = await renderGrid('en');
    const downloadLink = container.querySelector('a[href="/en/download"]');
    expect(downloadLink).not.toBeNull();
    expect(downloadLink?.textContent).toContain('Download free');
    await unmount();
  });

  it('marks the highlighted (popular) tier with the badge', async () => {
    const { container, unmount } = await renderGrid('en');
    expect(container.textContent).toContain('Popular');
    // The highlighted tier's card carries the primary-border class.
    const article = container.querySelector('article[id="pro"]');
    expect(article?.className).toContain('border-primary');
    await unmount();
  });

  it('applies the monthly A/B price variant when ?ab=pro_price is set', async () => {
    // C4.1: the ?ab=pro_price URL param swaps Pro monthly to the $7.99
    // variant (variantPriceId) so the split is visible to the user.
    Object.defineProperty(window, 'location', {
      value: { search: '?ab=pro_price' },
      writable: true,
      configurable: true,
    });
    const { container, unmount } = await renderGrid('en');
    try {
      const monthlyBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Monthly'));
      await act(async () => {
        monthlyBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(container.textContent).toContain('$7.99');
    } finally {
      await unmount();
    }
  });

  it('shows the billed-yearly note only on the yearly selection', async () => {
    const { container, unmount } = await renderGrid('en');
    try {
      // Yearly (default) shows the note for paid, non-enterprise tiers.
      expect(container.textContent).toContain('Billed yearly');
      // Switching to monthly hides it.
      const monthlyBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Monthly'));
      await act(async () => {
        monthlyBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(container.textContent).not.toContain('Billed yearly');
    } finally {
      await unmount();
    }
  });

  it('toggles aria-pressed on the billing buttons', async () => {
    const { container, unmount } = await renderGrid('en');
    try {
      const monthlyBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Monthly'));
      const yearlyBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Yearly'));
      expect(yearlyBtn?.getAttribute('aria-pressed')).toBe('true');
      expect(monthlyBtn?.getAttribute('aria-pressed')).toBe('false');
      await act(async () => {
        monthlyBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(monthlyBtn?.getAttribute('aria-pressed')).toBe('true');
      expect(yearlyBtn?.getAttribute('aria-pressed')).toBe('false');
    } finally {
      await unmount();
    }
  });
});

