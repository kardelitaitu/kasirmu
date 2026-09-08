// ── MultiStoreDashboardScreen tests ─────────────────────────────────
//
// Covers: loading state, error state with retry, stat cards,
// store cards with primary badge, and data rendering.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MultiStoreDashboardScreen from '@/features/locations/MultiStoreDashboardScreen';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { makeSubscriptionCaps } from '@/__tests__/test-utils/mocks/subscriptionCaps';

// ── Mocks ──────────────────────────────────────────────────────────

const mockListStores = vi.fn();
const mockListTerminals = vi.fn();

vi.mock('@/api/locations', () => ({
  listLocationsScoped: () => mockListStores(),
  setPrimaryLocationScoped: vi.fn(),
  deleteLocationProfileScoped: vi.fn(),
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
      state: 'active',
      loading: false,
      refresh: vi.fn(),
    });
    render(<MultiStoreDashboardScreen />);
    await waitFor(() => {
      expect(screen.getByText('location-limit-upgrade-premium')).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('hides the store-cap banner on Premium below its 5-store cap (C2.2)', async () => {
    vi.mocked(useSubscription).mockReturnValue({
      caps: makeSubscriptionCaps({ tier: 'premium', maxLocations: 5, locationCount: 2 }),
      state: 'active',
      loading: false,
      refresh: vi.fn(),
    });
    render(<MultiStoreDashboardScreen />);
    await waitFor(() => {
      expect(screen.getByText('Main Street')).toBeInTheDocument();
    }, { timeout: 3000 });
    expect(screen.queryByText('location-limit-upgrade-premium')).not.toBeInTheDocument();
  });

  // ── Locations → Topology entry points (§"Locations and Topology
  //    navigation") ──────────────────────────────────────────────
  // The dashboard only ROUTES: Configure topology deep-links into the
  // settings hub's topology section scoped to the location, creation
  // hands off to the editor's armed Add Branch form, and View details
  // opens a read-only modal. No mutation happens on this page.
  describe('Locations → Topology entry points', () => {
    const mockSetActiveWorkspace = vi.fn();

    beforeEach(() => {
      window.location.hash = '';
      mockSetActiveWorkspace.mockClear();
      vi.mocked(useWorkspace).mockReturnValue({
        ...(vi.mocked(useWorkspace)()),
        setActiveWorkspace: mockSetActiveWorkspace,
      } as ReturnType<typeof useWorkspace>);
    });

    afterEach(() => {
      window.location.hash = '';
    });

    it('renders Add location and the per-location View details / Configure topology pair', async () => {
      render(<MultiStoreDashboardScreen />);
      await waitFor(() => {
        expect(screen.getByText('Main Street')).toBeInTheDocument();
      }, { timeout: 3000 });

      expect(screen.getByRole('button', { name: 'multi-store-btn-add-location-aria' })).toBeInTheDocument();
      // Every store card gets the pair — including the primary one, whose
      // footer previously held no actions at all.
      expect(screen.getAllByRole('button', { name: 'multi-store-btn-details-label' })).toHaveLength(2);
      expect(screen.getAllByRole('button', { name: 'multi-store-btn-configure-topology-label' })).toHaveLength(2);
    });

    it('deep-links Configure topology into the location-scoped topology editor', async () => {
      render(<MultiStoreDashboardScreen />);
      await waitFor(() => {
        expect(screen.getByText('Main Street')).toBeInTheDocument();
      }, { timeout: 3000 });

      await userEvent.click(screen.getAllByRole('button', { name: 'multi-store-btn-configure-topology-label' })[0]!);

      expect(window.location.hash).toBe('#/settings/topology?branch=store-1');
      expect(mockSetActiveWorkspace).toHaveBeenCalledWith('admin');
    });

    it('routes location creation into the topology editor (?create=1)', async () => {
      render(<MultiStoreDashboardScreen />);
      await waitFor(() => {
        expect(screen.getByText('Main Street')).toBeInTheDocument();
      }, { timeout: 3000 });

      await userEvent.click(screen.getByRole('button', { name: 'multi-store-btn-add-location-aria' }));

      expect(window.location.hash).toBe('#/settings/topology?create=1');
      expect(mockSetActiveWorkspace).toHaveBeenCalledWith('admin');
    });

    it('opens the read-only details modal and routes its Configure topology action', async () => {
      render(<MultiStoreDashboardScreen />);
      await waitFor(() => {
        expect(screen.getByText('Main Street')).toBeInTheDocument();
      }, { timeout: 3000 });

      await userEvent.click(screen.getAllByRole('button', { name: 'multi-store-btn-details-label' })[0]!);
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText('Main Street')).toBeInTheDocument();
      expect(within(dialog).getByText('123 Main St')).toBeInTheDocument();

      await userEvent.click(within(dialog).getByRole('button', { name: 'multi-store-btn-configure-topology-label' }));
      expect(window.location.hash).toBe('#/settings/topology?branch=store-1');
      // The hand-off closes the modal; navigation takes over from here.
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('closes the details modal without navigating on Close', async () => {
      render(<MultiStoreDashboardScreen />);
      await waitFor(() => {
        expect(screen.getByText('Main Street')).toBeInTheDocument();
      }, { timeout: 3000 });

      await userEvent.click(screen.getAllByRole('button', { name: 'multi-store-btn-details-label' })[0]!);
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'multi-store-details-close-aria' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(window.location.hash).toBe('');
    });
  });
});
