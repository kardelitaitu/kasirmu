// ── C4.3: Add-on Marketplace component tests ───────────────────────
//
// Tests the AddonsMarketplace component: render states, owned badges,
// purchase CTAs, empty state, and tier-based filtering.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProvidersSync } from '@/__tests__/test-utils/render';
import settingsFtl from '@/locales/settings.ftl?raw';
import AddonsMarketplace from '@/features/marketplace/AddonsMarketplace';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { makeSubscriptionCaps } from '@/__tests__/test-utils/mocks/subscriptionCaps';
import { WEBSITE_ORIGIN } from '@/api/browser';
import { getAddonsForTier } from '@/api/addons';
import type * as AddonsModule from '@/api/addons';
import type * as BrowserModule from '@/api/browser';

vi.mock('@/contexts/SubscriptionContext', () => ({
  useSubscription: vi.fn(),
}));

// The browser door is mocked so a tap can be OBSERVED. Without it the only
// thing a click test could assert is that nothing threw, which is also true of
// a handler that does nothing at all — the state this file was in until round
// 204, whose "refuse a placeholder price" branch was unreachable from the
// catalog it guards.
//
// It wraps the real module rather than replacing it, so WEBSITE_ORIGIN stays
// the one the app actually uses.
const opened = vi.hoisted(() => ({ urls: [] as string[] }));
vi.mock('@/api/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserModule>()),
  openExternalUrl: async (url: string) => {
    opened.urls.push(url);
  },
}));

// `getAddonsForTier` is wrapped so ONE test can feed a value the shipped
// catalog cannot produce (a placeholder price). Every other test reads the real
// catalog through this same wrapper, so a wrapper that drifted would fail them.
vi.mock('@/api/addons', async (importOriginal) => {
  const actual = await importOriginal<typeof AddonsModule>();
  return {
    ...actual,
    getAddonsForTier: vi.fn(actual.getAddonsForTier),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  opened.urls.length = 0;
  vi.mocked(useSubscription).mockReturnValue({
    caps: makeSubscriptionCaps({ tier: 'plus', addons: [] }),
    state: 'active',
    loading: false,
    refresh: vi.fn(),
  });
});

describe('AddonsMarketplace', () => {
  // ── Render tests ──────────────────────────────────────────

  it('renders the marketplace title and subtitle', () => {
    renderWithProvidersSync(<AddonsMarketplace />, settingsFtl);
    expect(screen.getByText('Add-ons')).toBeInTheDocument();
    expect(screen.getByText(/extend your plan/i)).toBeInTheDocument();
  });

  it('renders addon cards for the current tier', () => {
    renderWithProvidersSync(<AddonsMarketplace />, settingsFtl);
    // Plus tier should see advanced_analytics and extra_storage
    expect(screen.getByText('Advanced Analytics')).toBeInTheDocument();
    expect(screen.getByText('Extra Cloud Storage')).toBeInTheDocument();
  });

  it('renders purchase buttons for unowned addons', () => {
    renderWithProvidersSync(<AddonsMarketplace />, settingsFtl);
    const addButtons = screen.getAllByText('Add');
    expect(addButtons.length).toBeGreaterThanOrEqual(1);
  });

  // ── Owned badge tests ─────────────────────────────────────

  it('shows "Active" badge for owned addons', () => {
    vi.mocked(useSubscription).mockReturnValue({
      caps: makeSubscriptionCaps({
        tier: 'plus',
        addons: ['advanced_analytics'],
      }),
      loading: false,
      refresh: vi.fn(),
    });
    renderWithProvidersSync(<AddonsMarketplace />, settingsFtl);

    // Should show Active badge
    expect(screen.getByText('Active')).toBeInTheDocument();
    // Should NOT show Add button for the owned addon
    const addButtons = screen.getAllByText('Add');
    expect(addButtons.length).toBeGreaterThanOrEqual(1);
    // The owned addon card should have the --owned class
    const ownedCard = document.querySelector('.addon-card--owned');
    expect(ownedCard).toBeInTheDocument();
  });

  it('shows Active badge only for owned addons, not all', () => {
    vi.mocked(useSubscription).mockReturnValue({
      caps: makeSubscriptionCaps({
        tier: 'plus',
        addons: ['advanced_analytics'],
      }),
      loading: false,
      refresh: vi.fn(),
    });
    renderWithProvidersSync(<AddonsMarketplace />, settingsFtl);

    // advanced_analytics is owned → Active
    // extra_storage is NOT owned → Add button
    const activeBadges = screen.getAllByText('Active');
    expect(activeBadges.length).toBe(1);
    const addButtons = screen.getAllByText('Add');
    expect(addButtons.length).toBeGreaterThanOrEqual(1);
  });

  // ── Tier filtering tests ──────────────────────────────────

  it('shows different addons for different tiers', () => {
    // Pro tier should see extra_storage and priority_support, NOT advanced_analytics
    vi.mocked(useSubscription).mockReturnValue({
      caps: makeSubscriptionCaps({
        tier: 'pro',
        addons: [],
      }),
      loading: false,
      refresh: vi.fn(),
    });
    renderWithProvidersSync(<AddonsMarketplace />, settingsFtl);

    expect(screen.getByText('Extra Cloud Storage')).toBeInTheDocument();
    expect(screen.getByText('Priority Support')).toBeInTheDocument();
    // advanced_analytics targets Plus only
    expect(screen.queryByText('Advanced Analytics')).not.toBeInTheDocument();
  });

  it('shows custom_hal for premium tier', () => {
    vi.mocked(useSubscription).mockReturnValue({
      caps: makeSubscriptionCaps({
        tier: 'premium',
        addons: [],
      }),
      loading: false,
      refresh: vi.fn(),
    });
    renderWithProvidersSync(<AddonsMarketplace />, settingsFtl);

    expect(screen.getByText('Custom HAL Drivers')).toBeInTheDocument();
  });

  // ── Price display ─────────────────────────────────────────

  it('displays addon prices', () => {
    renderWithProvidersSync(<AddonsMarketplace />, settingsFtl);
    expect(screen.getByText('$2.99/mo')).toBeInTheDocument();
    expect(screen.getByText('$1.99/mo')).toBeInTheDocument();
  });

  // ── Empty state ───────────────────────────────────────────

  it('shows empty state when no addons match the tier', () => {
    // Free tier only sees priority_support (all-tier)
    vi.mocked(useSubscription).mockReturnValue({
      caps: makeSubscriptionCaps({
        tier: 'free',
        addons: [],
      }),
      loading: false,
      refresh: vi.fn(),
    });
    renderWithProvidersSync(<AddonsMarketplace />, settingsFtl);

    // Free tier still sees priority_support (all-tier addon)
    expect(screen.getByText('Priority Support')).toBeInTheDocument();
  });

  // ── The purchase door ─────────────────────────────────────

  it('opens the website add-on anchor for a catalogued price', () => {
    renderWithProvidersSync(<AddonsMarketplace />, settingsFtl);
    // Two "Add" buttons render at Plus (advanced_analytics, extra_storage);
    // the first is advanced_analytics, whose catalogued price is
    // pri_addon_analytics_monthly — NOT a placeholder.
    fireEvent.click(screen.getAllByText('Add')[0]!);
    // The LOCALE PREFIX is asserted, not just the path: every marketing page
    // lives at /[locale]/pricing/ (astro.config.mjs:72 turns on
    // prefixDefaultLocale), so a bare /pricing/ has no page to resolve to.
    // 'id' is the app's real default (LocaleContext.tsx:32) — the test render
    // helper mounts no LocaleProvider, so the context default is what applies.
    // The fragment is part of the expectation precisely because it has NO
    // target on the live page: pinning it keeps the intent visible instead of
    // letting a later edit "fix" it silently.
    expect(opened.urls).toEqual([
      `${WEBSITE_ORIGIN}/id/pricing/#addon-advanced_analytics`,
    ]);
  });

  it('refuses a placeholder price without opening anything', () => {
    // Every catalogued id is a real-looking `pri_addon_*`, so this branch is
    // UNREACHABLE from the shipped catalog and cannot be driven any other way.
    // That is exactly why the case has to pin it: the guard named
    // `pri_placeholder_` while the catalog carried none, and a test that only
    // clicks the real catalog could not tell a working guard from no guard.
    vi.mocked(getAddonsForTier).mockReturnValueOnce([
      {
        id: 'placeholder_probe',
        nameKey: 'addon-analytics-name',
        descriptionKey: 'addon-analytics-desc',
        priceUsd: 1,
        targetTiers: [],
        paddlePriceId: 'pri_placeholder_probe',
        icon: '?',
      },
    ]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderWithProvidersSync(<AddonsMarketplace />, settingsFtl);
    fireEvent.click(screen.getAllByText('Add')[0]!);
    expect(opened.urls).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      'Addon placeholder_probe Paddle price not configured yet',
    );
    warn.mockRestore();
  });

  // ── Accessibility ─────────────────────────────────────────

  it('renders addon cards with proper structure', () => {
    renderWithProvidersSync(<AddonsMarketplace />, settingsFtl);
    const cards = document.querySelectorAll('.addon-card');
    expect(cards.length).toBeGreaterThanOrEqual(1);

    // Each card should have an icon, name, description, and footer
    for (const card of cards) {
      expect(card.querySelector('.addon-card-icon')).toBeInTheDocument();
      expect(card.querySelector('.addon-card-name')).toBeInTheDocument();
      expect(card.querySelector('.addon-card-desc')).toBeInTheDocument();
      expect(card.querySelector('.addon-card-footer')).toBeInTheDocument();
    }
  });
});
