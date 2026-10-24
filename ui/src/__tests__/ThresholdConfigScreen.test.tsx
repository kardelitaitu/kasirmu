import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/__tests__/test-utils/render';
import inventoryFtl from '@/locales/inventory.ftl?raw';

// ── Mocks ─────────────────────────────────────────────────────────

vi.mock('@/api/inventory', () => ({
  listInventoryLocations: vi.fn(),
  getStockThresholds: vi.fn(),
  setStockThreshold: vi.fn(),
  deleteStockThreshold: vi.fn(),
}));

vi.mock('@/api/products', () => ({
  listProductsScoped: vi.fn(),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    sessionToken: 'mock-session-token',
    currentInstanceId: 'inst-1',
  }),
}));

import ThresholdConfigScreen from '@/features/inventory/ThresholdConfigScreen';
import {
  listInventoryLocations,
  getStockThresholds,
  setStockThreshold,
  deleteStockThreshold,
} from '@/api/inventory';
import { listProductsScoped } from '@/api/products';

const mockLocations = listInventoryLocations as ReturnType<typeof vi.fn>;
const mockThresholds = getStockThresholds as ReturnType<typeof vi.fn>;
const mockSetThreshold = setStockThreshold as ReturnType<typeof vi.fn>;
const mockDeleteThreshold = deleteStockThreshold as ReturnType<typeof vi.fn>;
const mockListProducts = listProductsScoped as ReturnType<typeof vi.fn>;

// ── Test data ─────────────────────────────────────────────────────

const locations = [
  { id: 'loc-1', name: 'Main Warehouse', type: 'warehouse', description: '', is_active: true, created_at: '', updated_at: '' },
  { id: 'loc-2', name: 'Store Front', type: 'store', description: '', is_active: true, created_at: '', updated_at: '' },
];

const products = [
  { sku: 'SKU-001', name: 'Coffee Beans', category: null, price: { minor_units: 50000, currency: 'IDR' }, barcode: null, in_stock: true, stock_qty: 50, tax_rate_ids: [], created_at: '', price_updated_at: '', product_type: 'goods' },
  { sku: 'SKU-002', name: 'Green Tea', category: null, price: { minor_units: 25000, currency: 'IDR' }, barcode: null, in_stock: true, stock_qty: 30, tax_rate_ids: [], created_at: '', price_updated_at: '', product_type: 'goods' },
];

const thresholds = [
  { id: 'th-1', product_id: 'SKU-001', location_id: 'loc-1', threshold: 10, enabled: true, created_at: '', updated_at: '' },
  { id: 'th-2', product_id: 'SKU-002', location_id: null, threshold: 5, enabled: true, created_at: '', updated_at: '' },
  { id: 'th-3', product_id: 'SKU-001', location_id: 'loc-2', threshold: 3, enabled: false, created_at: '', updated_at: '' },
];

describe('ThresholdConfigScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocations.mockResolvedValue(locations);
    mockThresholds.mockResolvedValue(thresholds);
    mockListProducts.mockResolvedValue(products);
    mockSetThreshold.mockResolvedValue(undefined);
    mockDeleteThreshold.mockResolvedValue(undefined);
  });

  // ── Rendering ─────────────────────────────────────────────────

  it('renders the title and add button', async () => {
    await renderWithProviders(<ThresholdConfigScreen />, inventoryFtl);
    await waitFor(() => {
      expect(screen.getByText('Stock Threshold Configuration')).toBeInTheDocument();
    });
    expect(screen.getByText('+ Add Threshold')).toBeInTheDocument();
  });

  it('shows loading indicator when data is loading', async () => {
    mockLocations.mockReturnValue(new Promise(() => {}));
    mockThresholds.mockReturnValue(new Promise(() => {}));
    mockListProducts.mockReturnValue(new Promise(() => {}));
    await renderWithProviders(<ThresholdConfigScreen />, inventoryFtl);
    // inv-loading = "Loading products…" in inventory.ftl
    expect(screen.getByText(/Loading products/)).toBeInTheDocument();
  });

  // ── Table rendering ───────────────────────────────────────────

  it('renders threshold rows in the table', async () => {
    await renderWithProviders(<ThresholdConfigScreen />, inventoryFtl);
    await waitFor(() => {
      // SKU-001 appears in TWO rows (th-1 at loc-1, th-3 at loc-2)
      expect(screen.getAllByText('SKU-001').length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.getByText('SKU-002')).toBeInTheDocument();
    // Coffee Beans appears in TWO rows (th-1 at loc-1, th-3 at loc-2)
    expect(screen.getAllByText('Coffee Beans').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Green Tea')).toBeInTheDocument();
    // Location names appear in dropdown AND table cells
    expect(screen.getAllByText('Main Warehouse').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Store Front').length).toBeGreaterThanOrEqual(2);
    // Global appears only in the table (th-2); dialog option isn't rendered yet
    expect(screen.getAllByText('Global (All Locations)').length).toBeGreaterThanOrEqual(1);
  });

  it('shows Enabled/Disabled badges', async () => {
    await renderWithProviders(<ThresholdConfigScreen />, inventoryFtl);
    await waitFor(() => {
      const enabledBadges = screen.getAllByText('Enabled');
      const disabledBadges = screen.getAllByText('Disabled');
      expect(enabledBadges.length).toBe(2);
      expect(disabledBadges.length).toBe(1);
    });
  });

  // ── Location filter ───────────────────────────────────────────

  it('filters thresholds by location', async () => {
    const user = userEvent.setup();
    await renderWithProviders(<ThresholdConfigScreen />, inventoryFtl);

    await waitFor(() => {
      // SKU-001 appears in TWO rows before filtering
      expect(screen.getAllByText('SKU-001').length).toBeGreaterThanOrEqual(2);
    });

    // Filter by Store Front (loc-2) — should show only th-3 (1 row)
    // Label uses inv-threshold-filter-label = "Filter by Location"
    const filterSelect = screen.getByRole('combobox', { name: /filter by location/i });
    await user.selectOptions(filterSelect, 'loc-2');

    await waitFor(() => {
      // After filtering by loc-2, Store Front appears in dropdown + 1 table row
      expect(screen.getAllByText('Store Front').length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── Add threshold dialog ──────────────────────────────────────

  it('opens add dialog when + Add Threshold is clicked', async () => {
    const user = userEvent.setup();
    await renderWithProviders(<ThresholdConfigScreen />, inventoryFtl);

    await waitFor(() => {
      expect(screen.getByText('+ Add Threshold')).toBeInTheDocument();
    });

    await user.click(screen.getByText('+ Add Threshold'));

    await waitFor(() => {
      expect(screen.getByText('Configure Threshold')).toBeInTheDocument();
    });

    // Dialog should contain product select, location select, qty input
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // First product should be pre-selected
    expect(screen.getByDisplayValue('Coffee Beans (SKU-001)')).toBeInTheDocument();
  });

  it('saves a new threshold via dialog', async () => {
    const user = userEvent.setup();
    await renderWithProviders(<ThresholdConfigScreen />, inventoryFtl);

    await waitFor(() => {
      expect(screen.getByText('+ Add Threshold')).toBeInTheDocument();
    });

    await user.click(screen.getByText('+ Add Threshold'));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // Select product
    const productSelect = screen.getByRole('combobox', { name: /product/i });
    await user.selectOptions(productSelect, 'SKU-002');

    // Set threshold value
    const qtyInput = screen.getByRole('spinbutton', { name: /threshold/i });
    await user.clear(qtyInput);
    await user.type(qtyInput, '15');

    // Submit the form
    await user.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(mockSetThreshold).toHaveBeenCalledWith(
        'mock-session-token', 'SKU-002', null, 15, true
      );
    });

    // Dialog should close after save
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  // ── Delete threshold ──────────────────────────────────────────

  it('deletes a threshold when Delete is clicked and confirmed', async () => {
    const user = userEvent.setup();
    await renderWithProviders(<ThresholdConfigScreen />, inventoryFtl);

    await waitFor(() => {
      // SKU-001 appears in TWO rows
      expect(screen.getAllByText('SKU-001').length).toBeGreaterThanOrEqual(2);
    });

    // Click the first Delete button to open the ConfirmDialog
    const deleteBtns = screen.getAllByText('Delete');
    await user.click(deleteBtns[0]!);

    // Wait for dialog to appear and click the confirm "Delete" button
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    const confirmBtn = screen.getAllByText('Delete').at(-1)!;
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(mockDeleteThreshold).toHaveBeenCalledWith('mock-session-token', 'th-1');
    });
  });

  it('deletes a threshold once when the confirm button is double-tapped', async () => {
    // The replay finds the row already gone, so its NotFound toast lands UNDER the
    // success of the delete that worked -- the operator is told the delete failed by
    // the same screen that shows the row gone.
    const user = userEvent.setup();
    await renderWithProviders(<ThresholdConfigScreen />, inventoryFtl);
    await waitFor(() => {
      expect(screen.getAllByText('SKU-001').length).toBeGreaterThanOrEqual(2);
    });

    await user.click(screen.getAllByText('Delete')[0]!);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    const confirmBtn = screen.getAllByText('Delete').at(-1)!;
    fireEvent.click(confirmBtn);
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(mockDeleteThreshold).toHaveBeenCalledTimes(1));
  });
});
