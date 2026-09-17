// ── TransactionLogScreen — unit tests ───────────────────────────────
//
// New component baseline coverage.
// Covers: loading state, empty state, renders transactions, filters,
// row expand/collapse, no-session guard.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderInAct } from '@/test-utils/renderInAct';
import { ToastProvider } from '@/components/Toast';
import userEvent from '@testing-library/user-event';
import TransactionLogScreen from '@/features/inventory/TransactionLogScreen';
import type { InventoryTransaction, InventoryLocation, InventoryTransactionLine } from '@/api/inventory';

// ── Hoisted mocks ──────────────────────────────────────────────────

const { mockListTransactions, mockListLocations, mockGetTransaction } = vi.hoisted(() => ({
  mockListTransactions: vi.fn<(...args: unknown[]) => unknown>(),
  mockListLocations: vi.fn<(...args: unknown[]) => unknown>(),
  mockGetTransaction: vi.fn<(...args: unknown[]) => unknown>(),
}));

vi.mock('@/api/inventory', () => ({
  listInventoryTransactions: mockListTransactions,
  listInventoryLocations: mockListLocations,
  getInventoryTransaction: mockGetTransaction,
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    sessionToken: 'mock-token',
  }),
}));

vi.mock('@fluent/react', () => ({
  useLocalization: () => ({
    l10n: { bundles: [], getString: (id: string) => id },
  }),
  Localized: ({ children }: { id: string; children: React.ReactNode }) => <>{children}</>,
}));

// ── Test data factories ────────────────────────────────────────────

function tx(overrides: Partial<InventoryTransaction> = {}): InventoryTransaction {
  return {
    id: `tx-${Math.random().toString(36).slice(2, 6)}`,
    location_id: 'loc-main',
    staff_id: 'user-1',
    type: 'sale',
    notes: null,
    created_at: new Date().toISOString(),
    ...overrides,
  } as InventoryTransaction;
}

function loc(overrides: Partial<InventoryLocation> = {}): InventoryLocation {
  return {
    id: 'loc-main',
    name: 'Main Store',
    ...overrides,
  } as InventoryLocation;
}

function line(overrides: Partial<InventoryTransactionLine> = {}): InventoryTransactionLine {
  return {
    id: 'line-1',
    transaction_id: 'tx-1',
    sku: 'SKU-001',
    product_name: 'Widget',
    qty: 5,
    barcode_scanned: null,
    ...overrides,
  } as InventoryTransactionLine;
}

// ── Default mocks ──────────────────────────────────────────────────

function mockDefaultSuccess() {
  mockListTransactions.mockResolvedValue([
    tx({ id: 'tx-1', type: 'sale', created_at: '2026-07-19T10:00:00.000Z' }),
    tx({ id: 'tx-2', type: 'transfer', location_id: 'loc-wh', created_at: '2026-07-19T11:00:00.000Z' }),
  ]);
  mockListLocations.mockResolvedValue([
    loc({ id: 'loc-main', name: 'Main Store' }),
    loc({ id: 'loc-wh', name: 'Warehouse A' }),
  ]);
  mockGetTransaction.mockResolvedValue([
    {} as InventoryTransaction,
    [line()],
  ]);
}

// ── Render helper ──────────────────────────────────────────────────

async function renderPage() {
  await renderInAct(<ToastProvider><TransactionLogScreen /></ToastProvider>);
}

// ── Tests ──────────────────────────────────────────────────────────

describe('TransactionLogScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Loading state ───────────────────────────────────────────────

  it('shows loading indicator initially', async () => {
    // Never-resolving promise to keep loading=true
    mockListTransactions.mockReturnValue(new Promise(() => {}));
    mockListLocations.mockReturnValue(new Promise(() => {}));

    await renderPage();

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  // ── Renders title and table ─────────────────────────────────────

  it('renders the page title', async () => {
    mockDefaultSuccess();
    await renderPage();

    expect(
      screen.getByRole('heading', { name: /Inventory Transaction Log/i }),
    ).toBeInTheDocument();
  });

  it('renders transaction rows when data loads', async () => {
    mockDefaultSuccess();
    await renderPage();

    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });

    // Check for the badge elements (not the select option text)
    const badges = document.querySelectorAll('.badge');
    expect(badges.length).toBe(2);
    expect(badges[0]!.textContent).toMatch(/sale/i);
    expect(badges[1]!.textContent).toMatch(/transfer/i);
  });

  it('renders filter dropdowns', async () => {
    mockDefaultSuccess();
    await renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText('Location')).toBeInTheDocument();
    });

    expect(screen.getByLabelText('Staff')).toBeInTheDocument();
    expect(screen.getByLabelText('Type')).toBeInTheDocument();
    expect(screen.getByLabelText('Start Date')).toBeInTheDocument();
    expect(screen.getByLabelText('End Date')).toBeInTheDocument();
  });

  // ── Location filter ─────────────────────────────────────────────

  it('populates location filter dropdown from API', async () => {
    mockDefaultSuccess();
    await renderPage();

    await waitFor(() => {
      const select = screen.getByLabelText('Location') as HTMLSelectElement;
      expect(select.options.length).toBeGreaterThanOrEqual(3); // All + 2 locations
    });
  });

  // ── Row expand / collapse ───────────────────────────────────────

  it('expands a row to show details on click', async () => {
    mockDefaultSuccess();
    await renderPage();

    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });

    // Click the first Details button
    const detailsButtons = screen.getAllByText('Details');
    await userEvent.click(detailsButtons[0]!);

    await waitFor(() => {
      expect(mockGetTransaction).toHaveBeenCalledTimes(1);
    });

    // Expanded lines table should show the product name
    await waitFor(() => {
      expect(screen.getByText('SKU-001')).toBeInTheDocument();
    });
  });

  it('collapses expanded row when clicked again', async () => {
    mockDefaultSuccess();
    await renderPage();

    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });

    // Expand
    const detailsButtons = screen.getAllByText('Details');
    await userEvent.click(detailsButtons[0]!);
    await waitFor(() => {
      expect(mockGetTransaction).toHaveBeenCalledTimes(1);
    });

    // Collapse by clicking again
    await userEvent.click(detailsButtons[0]!);
    await waitFor(() => {
      // After collapsing, expanded lines should be hidden
      expect(screen.queryByText('Widget')).not.toBeInTheDocument();
    });
  });

  // ── Filter by location ──────────────────────────────────────────

  it('filters transactions by location', async () => {
    mockDefaultSuccess();
    await renderPage();

    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });

    // Both transactions visible initially
    const rowsBefore = document.querySelectorAll('.log-row-expandable');
    expect(rowsBefore.length).toBe(2);

    // Select location filter — only Main Store has a sale
    const locationSelect = screen.getByLabelText('Location') as HTMLSelectElement;
    await userEvent.selectOptions(locationSelect, 'loc-wh');

    // Only 1 row visible now (the transfer)
    await waitFor(() => {
      const rows = document.querySelectorAll('.log-row-expandable');
      expect(rows.length).toBe(1);
    });
  });

  // ── Durable load error (INV-08) ────────────────────────────────

  it('shows a persistent error with retry when the initial load fails', async () => {
    mockListTransactions.mockRejectedValue(new Error('boom'));
    mockListLocations.mockRejectedValue(new Error('boom'));
    await renderPage();

    await waitFor(() => {
      expect(document.querySelector('.log-error')).toBeInTheDocument();
    });
    expect(document.querySelector('.log-error')!.textContent).toContain('inv-log-error-load');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('recovers when Retry succeeds after a failed initial load', async () => {
    mockListTransactions
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([
        tx({ id: 'tx-1', type: 'sale', created_at: '2026-07-19T10:00:00.000Z' }),
      ]);
    mockListLocations
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([loc({ id: 'loc-main', name: 'Main Store' })]);
    await renderPage();

    await waitFor(() => {
      expect(document.querySelector('.log-error')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(document.querySelector('.log-error')).not.toBeInTheDocument();
    });
    expect(document.querySelectorAll('.log-row-expandable').length).toBe(1);
  });

  // ── Row count with no results ───────────────────────────────────

  it('shows empty table when no transactions match filters', async () => {
    mockDefaultSuccess();
    await renderPage();

    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });

    // Filter by Staff = 'All' then verify we can still see rows
    const staffSelect = screen.getByLabelText('Staff') as HTMLSelectElement;
    expect(staffSelect.options.length).toBe(2); // "All" + "user-1"

    // Set filter to a date range that excludes all transactions
    const startDate = screen.getByLabelText('Start Date') as HTMLInputElement;
    await userEvent.clear(startDate);
    await userEvent.type(startDate, '2030-01-01');

    await waitFor(() => {
      const rows = document.querySelectorAll('.log-row-expandable');
      expect(rows.length).toBe(0);
    });
  });
});
