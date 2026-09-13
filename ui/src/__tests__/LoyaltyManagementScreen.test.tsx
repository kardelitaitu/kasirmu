import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import loyaltyFtl from '@/locales/loyalty.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';

vi.mock('@/api/loyalty', () => ({
  listLoyaltyAccounts: vi.fn(),
  listLoyaltyTiers: vi.fn(),
  updateLoyaltyTier: vi.fn(),
}));

vi.mock('@/api/customers', () => ({
  listCustomersScoped: vi.fn(),
}));

import LoyaltyManagementScreen from '@/features/loyalty/LoyaltyManagementScreen';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { makeSubscriptionCaps } from '@/__tests__/test-utils/mocks/subscriptionCaps';
import { listLoyaltyAccounts, listLoyaltyTiers, updateLoyaltyTier } from '@/api/loyalty';
import { listCustomersScoped } from '@/api/customers';

const mockListAccounts = listLoyaltyAccounts as ReturnType<typeof vi.fn>;
const mockListTiers = listLoyaltyTiers as ReturnType<typeof vi.fn>;
const mockUpdateTier = updateLoyaltyTier as ReturnType<typeof vi.fn>;
const mockListCustomers = listCustomersScoped as ReturnType<typeof vi.fn>;



const sampleTiers = [
  // LOYALTY-01: the wire carries fixed-point millionths, never a float.
  { id: 'tier-bronze', name: 'Bronze', min_points: 0, points_per_unit: 10, earn_multiplier_millionths: 1_000_000, colour: '#cd7f32', sort_order: 1, created_at: '2025-01-01T00:00:00.000Z' },
  { id: 'tier-silver', name: 'Silver', min_points: 500, points_per_unit: 10, earn_multiplier_millionths: 1_250_000, colour: '#c0c0c0', sort_order: 2, created_at: '2025-01-01T00:00:00.000Z' },
  { id: 'tier-gold', name: 'Gold', min_points: 2500, points_per_unit: 10, earn_multiplier_millionths: 1_500_000, colour: '#ffd700', sort_order: 3, created_at: '2025-01-01T00:00:00.000Z' },
];

const sampleAccounts = [
  {
    account: { id: 'acct-1', customer_id: 'cust-1', points: 150, lifetime_points: 500, tier_id: 'tier-bronze', updated_at: '2026-07-01', created_at: '2026-01-01' },
    tier: sampleTiers[0],
    recent_transactions: [
      { id: 'txn-1', account_id: 'acct-1', sale_id: 'sale-1', points: 100, txn_type: 'earn', description: 'Purchase earn', created_at: '2026-06-15' },
      { id: 'txn-2', account_id: 'acct-1', sale_id: null, points: -30, txn_type: 'redeem', description: 'Redeemed 30 pts', created_at: '2026-06-20' },
    ],
    next_tier: sampleTiers[1],
    points_to_next_tier: 350,
  },
  {
    account: { id: 'acct-2', customer_id: 'cust-2', points: 0, lifetime_points: 0, tier_id: null, updated_at: '2026-07-01', created_at: '2026-07-01' },
    tier: null,
    recent_transactions: [],
    next_tier: null,
    points_to_next_tier: 0,
  },
];

const sampleCustomers = [
  { id: 'cust-1', name: 'Alice' },
  { id: 'cust-2', name: 'Bob' },
];

describe('LoyaltyManagementScreen', () => {
  beforeEach(() => {
    mockListAccounts.mockResolvedValue(sampleAccounts);
    mockListTiers.mockResolvedValue(sampleTiers);
    mockListCustomers.mockResolvedValue(sampleCustomers);
  });

  // ── Rendering ─────────────────────────────────────────────────

  it('renders the title', async () => {
    renderWithFluentSync(<LoyaltyManagementScreen />, loyaltyFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Loyalty')).toBeInTheDocument();
    });
  });

  it('renders Accounts and Tiers tab buttons', async () => {
    renderWithFluentSync(<LoyaltyManagementScreen />, loyaltyFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Accounts')).toBeInTheDocument();
    });
    expect(screen.getByText('Tiers')).toBeInTheDocument();
  });

  it('shows loading skeleton while fetching data', () => {
    mockListAccounts.mockReturnValue(new Promise(() => {}));
    mockListTiers.mockReturnValue(new Promise(() => {}));
    mockListCustomers.mockReturnValue(new Promise(() => {}));
    renderWithFluentSync(<LoyaltyManagementScreen />, loyaltyFtl, sharedFtl);
    expect(document.querySelector('.loyalty-mgmt-loading-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  // ── Accounts tab (default) ────────────────────────────────────

  it('displays accounts table with customer names', async () => {
    renderWithFluentSync(<LoyaltyManagementScreen />, loyaltyFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('displays tier badges for accounts with tier', async () => {
    renderWithFluentSync(<LoyaltyManagementScreen />, loyaltyFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Bronze')).toBeInTheDocument();
    });
  });

  it('displays dash for accounts without tier', async () => {
    renderWithFluentSync(<LoyaltyManagementScreen />, loyaltyFtl, sharedFtl);
    await waitFor(() => {
      const badges = document.querySelectorAll('.loyalty-tier-badge');
      const noneBadge = Array.from(badges).find(el => el.textContent === '—');
      expect(noneBadge).toBeInTheDocument();
    });
  });

  it('displays points and lifetime_points', async () => {
    renderWithFluentSync(<LoyaltyManagementScreen />, loyaltyFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('150')).toBeInTheDocument();
      expect(screen.getByText('500')).toBeInTheDocument();
    });
  });

  it('shows a retryable error when the initial load fails', async () => {
    const user = userEvent.setup();
    mockListAccounts.mockRejectedValueOnce(new Error('Database unavailable'));
    renderWithFluentSync(<LoyaltyManagementScreen />, loyaltyFtl, sharedFtl);

    await waitFor(() => {
      // ERR-05: raw backend text never renders — the localized copy does.
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to load loyalty data');
      expect(screen.queryByText('Database unavailable')).toBeNull();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });
    expect(screen.queryByText('No loyalty accounts yet')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(mockListAccounts).toHaveBeenCalledTimes(2);
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });
  });

  it('rejects negative tier thresholds before saving', async () => {
    const user = userEvent.setup();
    renderWithFluentSync(<LoyaltyManagementScreen />, loyaltyFtl, sharedFtl);
    await waitFor(() => expect(screen.getByText('Tiers')).toBeInTheDocument());
    await user.click(screen.getByText('Tiers'));
    await waitFor(() => expect(screen.getAllByText('Edit').length).toBeGreaterThan(0));
    await user.click(screen.getAllByText('Edit')[0]!);

    const inputs = document.querySelectorAll('.loyalty-tier-input');
    await user.clear(inputs[1] as HTMLInputElement);
    await user.type(inputs[1] as HTMLInputElement, '-1');
    await user.click(screen.getByText('Save'));

    await waitFor(() => expect(screen.getByText('Please fill in all fields correctly')).toBeInTheDocument());
    expect(mockUpdateTier).not.toHaveBeenCalled();
  });

  it('shows empty state when no accounts', async () => {
    mockListAccounts.mockResolvedValue([]);
    renderWithFluentSync(<LoyaltyManagementScreen />, loyaltyFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('No loyalty accounts yet')).toBeInTheDocument();
    });
  });

  // ── Account expand/collapse ───────────────────────────────────

  it('names the expand control with the customer (LOY-10)', async () => {
    renderWithFluentSync(<LoyaltyManagementScreen />, loyaltyFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });

    // The account row is a button (role="button") that expands/collapses.
    // Its accessible name must identify WHICH customer will be expanded,
    // not a generic "Expand" label with no context.
    const aliceRow = screen.getByText('Alice').closest('tr')!;
    expect(aliceRow.getAttribute('aria-label')).toMatch(/Alice/);

    // The nested expand button must carry the same customer-specific name
    // so screen-reader users can target a specific account.
    const expandButtons = screen.getAllByRole('button', { name: /Alice/ });
    expect(expandButtons.length).toBeGreaterThan(0);
  });

  it('expands account row to show transactions', async () => {
    const user = userEvent.setup();
    renderWithFluentSync(<LoyaltyManagementScreen />, loyaltyFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });

    // Click the first row.
    const row = screen.getByText('Alice').closest('tr')!;
    await user.click(row);

    await waitFor(() => {
      expect(screen.getByText('Recent Activity')).toBeInTheDocument();
      expect(screen.getByText('Earn')).toBeInTheDocument();
      expect(screen.getByText('Redeem')).toBeInTheDocument();
    });
  });

  it('collapses expanded row when clicked again', async () => {
    const user = userEvent.setup();
    renderWithFluentSync(<LoyaltyManagementScreen />, loyaltyFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });

    const row = screen.getByText('Alice').closest('tr')!;
    await user.click(row);
    await waitFor(() => {
      expect(screen.getByText('Recent Activity')).toBeInTheDocument();
    });

    await user.click(row);
    await waitFor(() => {
      expect(screen.queryByText('Recent Activity')).not.toBeInTheDocument();
    });
  });

  it('shows no transactions message for account without transactions', async () => {
    const user = userEvent.setup();
    renderWithFluentSync(<LoyaltyManagementScreen />, loyaltyFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Bob')).toBeInTheDocument();
    });

    const row = screen.getByText('Bob').closest('tr')!;
    await user.click(row);

    await waitFor(() => {
      expect(screen.getByText('No transactions yet')).toBeInTheDocument();
    });
  });

  // ── Tiers tab ─────────────────────────────────────────────────

  it('switches to Tiers tab and shows tier cards', async () => {
    const user = userEvent.setup();
    renderWithFluentSync(<LoyaltyManagementScreen />, loyaltyFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Tiers')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Tiers'));

    await waitFor(() => {
      // Silver appears in both heading and badge, so getAllByText for card view.
      expect(screen.getAllByText('Silver').length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.getAllByText('Gold').length).toBeGreaterThanOrEqual(2);
  });

  it('shows tier details in card view', async () => {
    const user = userEvent.setup();
    renderWithFluentSync(<LoyaltyManagementScreen />, loyaltyFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Tiers')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Tiers'));

    await waitFor(() => {
      // All cards should show the tier name (in both heading and badge)
      expect(screen.getAllByText('Silver').length).toBeGreaterThanOrEqual(2);
      // Points/Unit and Multiplier details
      const multiplierTexts = screen.getAllByText(/x/);
      expect(multiplierTexts.length).toBeGreaterThan(0);
    });
  });

  it('opens edit form when Edit button is clicked on a tier', async () => {
    const user = userEvent.setup();
    renderWithFluentSync(<LoyaltyManagementScreen />, loyaltyFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Tiers')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Tiers'));

    await waitFor(() => {
      const editBtns = screen.getAllByText('Edit');
      expect(editBtns.length).toBeGreaterThan(0);
    });

    // Click Edit on the first tier (Bronze).
    const editBtns = screen.getAllByText('Edit');
    await user.click(editBtns[0]!);

    await waitFor(() => {
      expect(screen.getByText('Save')).toBeInTheDocument();
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });
  });

  it('cancels tier edit and returns to card view', async () => {
    const user = userEvent.setup();
    renderWithFluentSync(<LoyaltyManagementScreen />, loyaltyFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Tiers')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Tiers'));

    await waitFor(() => {
      const editBtns = screen.getAllByText('Edit');
      expect(editBtns.length).toBeGreaterThan(0);
    });

    await user.click(screen.getAllByText('Edit')[0]!);
    await waitFor(() => {
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Cancel'));
    await waitFor(() => {
      // Cancel should close the edit form and show Edit again.
      const editBtns = screen.getAllByText('Edit');
      expect(editBtns.length).toBeGreaterThan(0);
    });
  });

  it('saves tier edit successfully', async () => {
    const user = userEvent.setup();
    mockUpdateTier.mockResolvedValue({
      ...sampleTiers[0],
      name: 'Bronze+',
      points_per_unit: 15,
    });
    renderWithFluentSync(<LoyaltyManagementScreen />, loyaltyFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Tiers')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Tiers'));

    await waitFor(() => {
      const editBtns = screen.getAllByText('Edit');
      expect(editBtns.length).toBeGreaterThan(0);
    });
    await user.click(screen.getAllByText('Edit')[0]!);

    await waitFor(() => {
      expect(screen.getByText('Save')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(mockUpdateTier).toHaveBeenCalled();
    });
  });

  // ── LOYALTY-01: fixed-point multiplier ─────────────────────────────

  it('prefills the multiplier field from millionths (no float artifacts)', async () => {
    const user = userEvent.setup();
    renderWithFluentSync(<LoyaltyManagementScreen />, loyaltyFtl, sharedFtl);
    await waitFor(() => expect(screen.getByText('Tiers')).toBeInTheDocument());
    await user.click(screen.getByText('Tiers'));
    await waitFor(() => expect(screen.getAllByText('Edit').length).toBeGreaterThan(0));
    // Silver is 1_250_000 millionths → the field must show exactly "1.25".
    await user.click(screen.getAllByText('Edit')[1]!);
    await waitFor(() => expect(screen.getByText('Save')).toBeInTheDocument());
    // Raw .value string — toHaveValue() coerces number inputs to a JS
    // number, which would hide a float-formatting artifact like "1.2500000000000002".
    expect((screen.getByLabelText('Earn multiplier') as HTMLInputElement).value).toBe('1.25');
  });

  it('saves the multiplier as fixed-point millionths', async () => {
    const user = userEvent.setup();
    mockUpdateTier.mockResolvedValue({ ...sampleTiers[0], name: 'Bronze' });
    renderWithFluentSync(<LoyaltyManagementScreen />, loyaltyFtl, sharedFtl);
    await waitFor(() => expect(screen.getByText('Tiers')).toBeInTheDocument());
    await user.click(screen.getByText('Tiers'));
    await waitFor(() => expect(screen.getAllByText('Edit').length).toBeGreaterThan(0));
    await user.click(screen.getAllByText('Edit')[0]!);
    await waitFor(() => expect(screen.getByText('Save')).toBeInTheDocument());

    const multInput = screen.getByLabelText('Earn multiplier');
    await user.clear(multInput);
    await user.type(multInput, '1.4');
    await user.click(screen.getByText('Save'));

    await waitFor(() => {
      // "1.4" must reach the wire as the integer 1_400_000 — the exact
      // value the backend needs; a float 1.4 there is the LOYALTY-01 bug.
      expect(mockUpdateTier).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ earn_multiplier_millionths: 1_400_000 }),
      );
    });
  });

  it('rejects a zero multiplier without sending a request', async () => {
    // A type="number" field already blocks text garbage ("1e3" rejection
    // is pinned at the parseMinorUnits unit level); the reachable invalid
    // classes are empties and zero.
    const user = userEvent.setup();
    renderWithFluentSync(<LoyaltyManagementScreen />, loyaltyFtl, sharedFtl);
    await waitFor(() => expect(screen.getByText('Tiers')).toBeInTheDocument());
    await user.click(screen.getByText('Tiers'));
    await waitFor(() => expect(screen.getAllByText('Edit').length).toBeGreaterThan(0));
    await user.click(screen.getAllByText('Edit')[0]!);
    await waitFor(() => expect(screen.getByText('Save')).toBeInTheDocument());

    await user.clear(screen.getByLabelText('Earn multiplier'));
    await user.type(screen.getByLabelText('Earn multiplier'), '0');
    await user.click(screen.getByText('Save'));

    await waitFor(() => expect(screen.getByText('Save')).toBeInTheDocument());
    expect(mockUpdateTier).not.toHaveBeenCalled();
  });

  it('shows validation error when tier form has empty name', async () => {
    const user = userEvent.setup();
    renderWithFluentSync(<LoyaltyManagementScreen />, loyaltyFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Tiers')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Tiers'));

    await waitFor(() => {
      const editBtns = screen.getAllByText('Edit');
      expect(editBtns.length).toBeGreaterThan(0);
    });
    await user.click(screen.getAllByText('Edit')[0]!);

    await waitFor(() => {
      expect(screen.getByText('Save')).toBeInTheDocument();
    });

    // Clear the name input value via user event
    const inputs = document.querySelectorAll('.loyalty-tier-input');
    const nameInput = inputs[0] as HTMLInputElement;
    await user.clear(nameInput);

    await user.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(screen.getByText('Please fill in all fields correctly')).toBeInTheDocument();
    });
  });

  it('rejects a non-integer min points instead of truncating it', async () => {
    const user = userEvent.setup();
    renderWithFluentSync(<LoyaltyManagementScreen />, loyaltyFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Tiers')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Tiers'));

    await waitFor(() => {
      expect(screen.getAllByText('Edit').length).toBeGreaterThan(0);
    });
    await user.click(screen.getAllByText('Edit')[0]!);
    await waitFor(() => {
      expect(screen.getByText('Save')).toBeInTheDocument();
    });

    // min_points is the second .loyalty-tier-input — enter a decimal.
    const inputs = document.querySelectorAll('.loyalty-tier-input');
    const minPointsInput = inputs[1] as HTMLInputElement;
    await user.clear(minPointsInput);
    await user.type(minPointsInput, '10.5');

    await user.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(screen.getByText('Please fill in all fields correctly')).toBeInTheDocument();
    });
    expect(mockUpdateTier).not.toHaveBeenCalled();
  });
});

describe('C2.2 loyalty module teaser (Pro → Premium)', () => {
  afterEach(() => {
    vi.mocked(useSubscription).mockImplementation(() => ({
      caps: null,
      state: 'active',
      loading: false,
      refresh: vi.fn(),
    }));
  });

  it('locks the screen with an animated preview + upgrade CTA below Premium', async () => {
    vi.mocked(useSubscription).mockReturnValue({
      caps: makeSubscriptionCaps({ tier: 'pro', supportsLoyalty: false }),
      state: 'active',
      loading: false,
      refresh: vi.fn(),
    });
    renderWithFluentSync(<LoyaltyManagementScreen />, loyaltyFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Loyalty is a Premium feature')).toBeInTheDocument();
    });
    expect(screen.getByText('Upgrade to Premium')).toBeInTheDocument();
    expect(screen.queryByText('Accounts')).not.toBeInTheDocument();
  });

  it('renders the live UI when the tier supports loyalty', async () => {
    vi.mocked(useSubscription).mockReturnValue({
      caps: makeSubscriptionCaps({ tier: 'premium', supportsLoyalty: true }),
      state: 'active',
      loading: false,
      refresh: vi.fn(),
    });
    renderWithFluentSync(<LoyaltyManagementScreen />, loyaltyFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.queryByText('Loyalty is a Premium feature')).not.toBeInTheDocument();
    });
  });
});
