// ── MultiStoreDashboardScreen tests ─────────────────────────────────
//
// Covers: loading state, error state with retry, stat cards,
// store cards with primary badge, and data rendering.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MultiStoreDashboardScreen from '@/features/stores/MultiStoreDashboardScreen';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { makeSubscriptionCaps } from '@/__tests__/test-utils/mocks/subscriptionCaps';

// ── Mocks ──────────────────────────────────────────────────────────

const mockListStores = vi.fn();
const mockListTerminals = vi.fn();

vi.mock('@/api/stores', () => ({
  listStoresScoped: () => mockListStores(),
  setPrimaryStoreScoped: vi.fn(),
  deleteStoreProfileScoped: vi.fn(),
}));

vi.mock('@/api/terminals', () => ({
  listTerminals: () => mockListTerminals(),
  listTerminalsScoped: () => mockListTerminals(),
}));

const mockL10n = { getString: (id: string) => id };

vi.mock('@fluent/react', () => ({
  useLocalization: () => ({
    l10n: mockL10n,
  }),
  Localized: ({ children }: { id: string; children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

// TerminalStatusPanel renders nothing in tests.
vi.mock('@/features/terminals/TerminalStatusPanel', () => ({
  default: () => null,
}));

// ── Test data ──────────────────────────────────────────────────────

const sampleStores = [
  {
    id: 'store-1',
    name: 'Main Street',
    is_primary: true,
    address: '123 Main St',
    tax_id: 'TAX-001',
    currency: 'USD',
    timezone: 'America/New_York',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 'store-2',
    name: 'Downtown',
    is_primary: false,
    address: '',
    tax_id: '',
    currency: 'USD',
    timezone: 'America/Chicago',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
];

const sampleTerminals = [
  {
    id: 'term-1',
    name: 'Register 1',
    deviceId: 'dev-term-1',
    isActive: true,
    lastSeenAt: new Date().toISOString(),
    metadata: null,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  },
  {
    id: 'term-2',
    name: 'Register 2',
    deviceId: 'dev-term-2',
    isActive: false,
    lastSeenAt: null,
    metadata: null,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  },
];

// ── Tests ──────────────────────────────────────────────────────────

describe('MultiStoreDashboardScreen', () => {
  beforeEach(() => {
    mockListStores.mockReset();
    mockListTerminals.mockReset();
    mockListStores.mockResolvedValue(sampleStores);
    mockListTerminals.mockResolvedValue(sampleTerminals);
  });

  it('shows loading skeleton while data is being fetched', () => {
    mockListStores.mockReturnValue(new Promise(() => {}));
    mockListTerminals.mockReturnValue(new Promise(() => {}));

    render(<MultiStoreDashboardScreen />);

    expect(document.querySelector('.multi-store-dashboard-loading-skeleton')).toBeInTheDocument();
  });

  it('shows error message and retry button on fetch failure', async () => {
    mockListStores.mockRejectedValue(new Error('Network error'));

    render(<MultiStoreDashboardScreen />);

    await waitFor(() => {
      expect(screen.getByText('multi-store-error-load')).toBeInTheDocument();
    }, { timeout: 3000 });

    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('retries when retry button is clicked', async () => {
    mockListStores.mockRejectedValueOnce(new Error('Network error'));

    render(<MultiStoreDashboardScreen />);

    await waitFor(() => {
      expect(screen.getByText('multi-store-error-load')).toBeInTheDocument();
    }, { timeout: 3000 });

    mockListStores.mockResolvedValueOnce(sampleStores);
    mockListTerminals.mockResolvedValueOnce(sampleTerminals);

    await userEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => {
      expect(screen.getByText('Main Street')).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('renders stat cards with correct counts', async () => {
    render(<MultiStoreDashboardScreen />);

    await waitFor(() => {
      expect(screen.getByText('Main Street')).toBeInTheDocument();
    }, { timeout: 3000 });

    // "2" appears in Total Stores, Total Terminals, and each store's terminal count.
    const twos = screen.getAllByText('2');
    expect(twos.length).toBe(4);
  });

  it('renders store cards with primary badge', async () => {
    render(<MultiStoreDashboardScreen />);

    await waitFor(() => {
      expect(screen.getByText('Main Street')).toBeInTheDocument();
    }, { timeout: 3000 });

    expect(screen.getByText('Primary')).toBeInTheDocument();
    expect(screen.getByText('Downtown')).toBeInTheDocument();
  });

  // ── C2.2: Pro→Premium store-cap nudge ────────────────────────

  it('shows the 3rd-store upgrade banner when Pro is at its 2-store cap (C2.2)', async () => {
    vi.mocked(useSubscription).mockReturnValue({
      caps: makeSubscriptionCaps({ tier: 'pro', locationCount: 2 }),
      loading: false,
      refresh: vi.fn(),
    });
    render(<MultiStoreDashboardScreen />);
    await waitFor(() => {
      expect(screen.getByText('store-limit-upgrade-premium')).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('hides the store-cap banner on Premium below its 5-store cap (C2.2)', async () => {
    vi.mocked(useSubscription).mockReturnValue({
      caps: makeSubscriptionCaps({ tier: 'premium', maxStores: 5, locationCount: 2 }),
      loading: false,
      refresh: vi.fn(),
    });
    render(<MultiStoreDashboardScreen />);
    await waitFor(() => {
      expect(screen.getByText('Main Street')).toBeInTheDocument();
    }, { timeout: 3000 });
    expect(screen.queryByText('store-limit-upgrade-premium')).not.toBeInTheDocument();
  });
});
