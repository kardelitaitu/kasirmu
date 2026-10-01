import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProvidersSync, rerenderWithProviders } from '@/__tests__/test-utils/render';
import inventoryFtl from '@/locales/inventory.ftl?raw';

// ── Mocks ─────────────────────────────────────────────────────────

vi.mock('@/api/inventory', () => ({
  listInventoryLocations: vi.fn(),
  getActiveInventoryShift: vi.fn(),
  startInventoryShift: vi.fn(),
  endInventoryShift: vi.fn(),
  listInventoryTransactions: vi.fn(),
  listInventoryTransactionsForShift: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: { user_id: 'user-1', display_name: 'Test Cashier', role_name: 'cashier' },
    sessionToken: 'mock-session-token',
  }),
}));

// Mutable so a test can SWITCH STORES: ShiftBar's location/shift load depends
// on sessionToken, so changing it starts a second read while the first is in flight.
const wsState = vi.hoisted(() => ({ sessionToken: 'mock-session-token' }));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    sessionToken: wsState.sessionToken,
    currentInstanceId: 'inst-1',
  }),
}));

import ShiftBar from '@/features/inventory/ShiftBar';
import {
  listInventoryLocations,
  getActiveInventoryShift,
  startInventoryShift,
  endInventoryShift,
  listInventoryTransactions,
  listInventoryTransactionsForShift,
} from '@/api/inventory';

const mockLocations = listInventoryLocations as ReturnType<typeof vi.fn>;
const mockGetActiveShift = getActiveInventoryShift as ReturnType<typeof vi.fn>;
const mockStartShift = startInventoryShift as ReturnType<typeof vi.fn>;
const mockEndShift = endInventoryShift as ReturnType<typeof vi.fn>;
const mockListTransactions = listInventoryTransactions as ReturnType<typeof vi.fn>;
const mockListTransactionsForShift = listInventoryTransactionsForShift as ReturnType<typeof vi.fn>;

// ── Test data ─────────────────────────────────────────────────────

const locations = [
  { id: 'loc-1', name: 'Main Warehouse', type: 'warehouse', description: '', is_active: true, created_at: '', updated_at: '' },
  { id: 'loc-2', name: 'Store Front', type: 'store', description: '', is_active: true, created_at: '', updated_at: '' },
];

const activeShift = {
  id: 'shift-active-1',
  user_id: 'user-1',
  location_id: 'loc-1',
  terminal_id: null,
  started_at: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
  ended_at: null,
  status: 'active' as const,
  notes: 'Evening count',
};

const transactions = [
  { id: 'tx-1', type: 'manual-adjustment', location_id: 'loc-1', staff_id: 'user-1', transfer_id: null, purchase_order_id: null, notes: 'Restock', created_at: new Date(Date.now() - 1800000).toISOString() },
  { id: 'tx-2', type: 'stock-count', location_id: 'loc-1', staff_id: 'user-1', transfer_id: null, purchase_order_id: null, notes: 'Count', created_at: new Date(Date.now() - 900000).toISOString() },
];

describe('ShiftBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A test that switches stores mutates this; every other case needs the
    // original token or startInventoryShift is called with the wrong one.
    wsState.sessionToken = 'mock-session-token';
    mockLocations.mockResolvedValue(locations);
    mockGetActiveShift.mockResolvedValue(null);
    mockStartShift.mockResolvedValue(activeShift);
    mockEndShift.mockResolvedValue(undefined);
    mockListTransactions.mockResolvedValue([]);
    mockListTransactionsForShift.mockResolvedValue([]);
  });

  // ── Empty / Start Form State ──────────────────────────────────

  // A store switch must not leave the location dropdown pointing into the store
// the cashier just LEFT. `selectedLocationId` is what `handleStartShift` passes
// to `startInventoryShift`, and core opens the store DB from the session without
// checking the location belongs to it, so a stale id reaches the write.
//
// The stale read resolves with DISTINCTLY DIFFERENT locations -- same values would
// make this pass with the guard removed, because the late write would be
// indistinguishable from the correct one.
it('ignores a slower location load from the previous store after a switch', async () => {
  let releaseStale: (v: unknown) => void = () => {};
  const stalePending = new Promise((resolve) => { releaseStale = resolve; });

  mockGetActiveShift.mockResolvedValue(null);
  // First call: held open, will answer with the PREVIOUS store's locations.
  mockLocations.mockImplementationOnce(() => stalePending);

  const result = renderWithProvidersSync(<ShiftBar />, inventoryFtl);

  // Switch stores while the first read is outstanding. The re-render must go
  // through `rerenderWithProviders` -- the raw testing-library `rerender` replaces
  // the root WITHOUT the providers and anything consuming a context throws.
  mockLocations.mockResolvedValueOnce([
    { id: 'loc-b', name: 'Store B Warehouse', type: 'warehouse', description: '', is_active: true, created_at: '', updated_at: '' },
  ]);
  wsState.sessionToken = 'mock-session-token-2';
  await act(async () => { rerenderWithProviders(result, <ShiftBar />, inventoryFtl); });

  await waitFor(() => {
    expect(screen.getByRole('option', { name: /Store B Warehouse/ })).toBeTruthy();
  });

  // Now let the stale store-A read settle, after store B already won.
  await act(async () => {
    releaseStale([
      { id: 'loc-a', name: 'Store A Warehouse', type: 'warehouse', description: '', is_active: true, created_at: '', updated_at: '' },
    ]);
    await stalePending;
  });

  // Store B's location survives; store A's never appears.
  expect(screen.getByRole('option', { name: /Store B Warehouse/ })).toBeTruthy();
  expect(screen.queryByRole('option', { name: /Store A Warehouse/ })).toBeNull();
});

it('shows start form when no active shift exists', async () => {
    renderWithProvidersSync(<ShiftBar />, inventoryFtl);
    await waitFor(() => {
      expect(screen.getByText('Start Inventory Shift')).toBeInTheDocument();
    });
    expect(screen.getByText('Start Shift')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /location/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /notes/i })).toBeInTheDocument();
  });

  it('loads locations into the dropdown', async () => {
    renderWithProvidersSync(<ShiftBar />, inventoryFtl);
    await waitFor(() => {
      const select = screen.getByRole('combobox', { name: /location/i });
      expect(select).toBeInTheDocument();
      // Should have both location options
      expect(select).toContainHTML('Main Warehouse');
      expect(select).toContainHTML('Store Front');
    });
  });

  it('calls startInventoryShift on form submit', async () => {
    const user = userEvent.setup();
    renderWithProvidersSync(<ShiftBar />, inventoryFtl);

    await waitFor(() => {
      expect(screen.getByText('Start Shift')).toBeInTheDocument();
    });

    // Select a location
    const select = screen.getByRole('combobox', { name: /location/i });
    await user.selectOptions(select, 'loc-2');

    // Enter notes
    const notesInput = screen.getByRole('textbox', { name: /notes/i });
    await user.type(notesInput, 'Night shift');

    // Submit
    await user.click(screen.getByText('Start Shift'));

    await waitFor(() => {
      expect(mockStartShift).toHaveBeenCalledWith(
        'mock-session-token', 'loc-2', 'Night shift'
      );
    });
  });

  // ── Active Shift State ────────────────────────────────────────

  it('shows active shift info with timer and end button', async () => {
    mockGetActiveShift.mockResolvedValue(activeShift);
    renderWithProvidersSync(<ShiftBar />, inventoryFtl);

    await waitFor(() => {
      // Fluent interpolates as "Test Cashier — Main Warehouse — Started 01:00:00"
      expect(screen.getByText(/Main Warehouse/)).toBeInTheDocument();
      expect(screen.getByText(/Test Cashier/)).toBeInTheDocument();
    });
    expect(screen.getByText('End Shift')).toBeInTheDocument();
  });

  it('calls onShiftChange callback when shift is loaded', async () => {
    const onShiftChange = vi.fn();
    mockGetActiveShift.mockResolvedValue(activeShift);
    renderWithProvidersSync(<ShiftBar onShiftChange={onShiftChange} />, inventoryFtl);

    await waitFor(() => {
      expect(onShiftChange).toHaveBeenCalledWith(activeShift);
    });
  });

  // ── End Shift Flow ────────────────────────────────────────────

  it('shows summary modal after ending shift', async () => {
    const user = userEvent.setup();
    mockGetActiveShift.mockResolvedValue(activeShift);
    mockListTransactions.mockResolvedValue(transactions);
    renderWithProvidersSync(<ShiftBar />, inventoryFtl);

    // Wait for active shift to load
    await waitFor(() => {
      expect(screen.getByText('End Shift')).toBeInTheDocument();
    });

    // Click End Shift
    await user.click(screen.getByText('End Shift'));

    // Verify endInventoryShift was called
    await waitFor(() => {
      expect(mockEndShift).toHaveBeenCalledWith('mock-session-token', activeShift.id);
    });

    // Summary modal should appear
    await waitFor(() => {
      expect(screen.getByText('Shift Summary')).toBeInTheDocument();
      expect(screen.getByText('Transactions performed during this shift:')).toBeInTheDocument();
    });
  });

  it('shows empty state in summary when no transactions exist', async () => {
    const user = userEvent.setup();
    mockGetActiveShift.mockResolvedValue(activeShift);
    mockListTransactions.mockResolvedValue([]);
    renderWithProvidersSync(<ShiftBar />, inventoryFtl);

    await waitFor(() => {
      expect(screen.getByText('End Shift')).toBeInTheDocument();
    });

    await user.click(screen.getByText('End Shift'));

    await waitFor(() => {
      expect(screen.getByText('No transactions recorded.')).toBeInTheDocument();
    });
  });

  it('closes summary modal when Close button is clicked', async () => {
    const user = userEvent.setup();
    mockGetActiveShift.mockResolvedValue(activeShift);
    renderWithProvidersSync(<ShiftBar />, inventoryFtl);

    await waitFor(() => {
      expect(screen.getByText('End Shift')).toBeInTheDocument();
    });

    await user.click(screen.getByText('End Shift'));

    await waitFor(() => {
      expect(screen.getByText('Shift Summary')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Cancel'));

    await waitFor(() => {
      expect(screen.queryByText('Shift Summary')).not.toBeInTheDocument();
    });
  });
});
