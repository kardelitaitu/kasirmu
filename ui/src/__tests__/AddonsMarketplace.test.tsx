// ── C4.3: Add-on Marketplace component tests ───────────────────────
//
// Tests the AddonsMarketplace component: render states, owned badges,
// purchase CTAs, empty state, and tier-based filtering.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProvidersSync } from '@/__tests__/test-utils/render';
import settingsFtl from '@/locales/settings.ftl?raw';
import AddonsMarketplace from '@/features/marketplace/AddonsMarketplace';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { makeSubscriptionCaps } from '@/__tests__/test-utils/mocks/subscriptionCaps';

vi.mock('@/contexts/SubscriptionContext', () => ({
  useSubscription: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
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
