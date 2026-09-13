// ── RetailPosScreen attribute / popularity / context-menu tests ──
//
// Covers ADR #36 (grid columns + show/hide toggle persisted per user,
// hide-inactive filter, cost-only-in-edit, modal persistence), ADR #37
// (default popularity sort with SKU tiebreak, acted-upon search signal),
// and ADR #38 (row context menu → view product images).

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/__tests__/test-utils/render';
import { mockedBarcode } from '@/__tests__/test-utils/mocks/barcodeScanner';
import { retailProducts } from '@/__tests__/test-utils/mocks/retailPos';
import salesFtl from '@/locales/sales.ftl?raw';
import productsFtl from '@/locales/products.ftl?raw';
import tablesFtl from '@/locales/tables.ftl?raw';
import RetailPosScreen from '@/features/retail/RetailPosScreen';

// ── Mock modules ──────────────────────────────────────────────────

vi.mock('@/features/sales/usePosState', async () => {
  const { createUsePosStateMock } =
    await import('@/__tests__/test-utils/mocks/usePosState');
  return { usePosState: vi.fn(() => createUsePosStateMock()) };
});

vi.mock('@/features/sales/useBarcodeScanner', async () => {
  const { createBarcodeScannerModuleMock } =
    await import('@/__tests__/test-utils/mocks/barcodeScanner');
  return createBarcodeScannerModuleMock();
});

vi.mock('@/api/products', async () => {
  const { createRetailProductsApiMock } =
    await import('@/__tests__/test-utils/mocks/retailPos');
  return createRetailProductsApiMock();
});

vi.mock('@/api/shifts', async () => {
  const { createShiftsApiMock } = await import('@/__tests__/test-utils/mocks/api');
  return createShiftsApiMock({
    getActiveShiftScoped: vi.fn(() => Promise.reject(new Error('no shift'))),
  });
});

vi.mock('@/api/settings', async () => {
  const { createSettingsApiMock } = await import('@/__tests__/test-utils/mocks/api');
  return createSettingsApiMock({
    getStoreSettingsScoped: vi.fn(() =>
      Promise.resolve({ name: 'TOKO TEST', address: 'Jl. Contoh No. 123', taxId: '', currency: 'IDR', branch: 'Cabang A', logo: '' }),
    ),
  });
});

vi.mock('@/api/hardware', async () => {
  const { createHardwareApiMock } = await import('@/__tests__/test-utils/mocks/api');
  return createHardwareApiMock();
});

vi.mock('@/api/sales', async () => {
  const { createSalesApiMock } = await import('@/__tests__/test-utils/mocks/api');
  return createSalesApiMock();
});

vi.mock('@/api/kds', async (importOriginal) => {
  const { createRetailKdsApiMock } = await import('@/__tests__/test-utils/mocks/retailPos');
  // Spread the real module so a future @/api/kds export cannot be missing here.
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  return createRetailKdsApiMock(await importOriginal<typeof import('@/api/kds')>());
});

vi.mock('@/features/tables/TableManagementScreen', async () => {
  const { createTableManagementScreenStub } = await import('@/__tests__/test-utils/mocks/retailPos');
  return createTableManagementScreenStub();
});

vi.mock('@/features/sales/SalesHistoryScreen', async () => {
  const { createSalesHistoryScreenStub } = await import('@/__tests__/test-utils/mocks/retailPos');
  return createSalesHistoryScreenStub();
});

vi.mock('@/features/products/ProductLookupScreen', async () => {
  const { createProductLookupScreenStub } = await import('@/__tests__/test-utils/mocks/retailPos');
  return createProductLookupScreenStub();
});

vi.mock('@/api/currency', async () => {
  const { createRetailCurrencyApiMock } = await import('@/__tests__/test-utils/mocks/retailPos');
  return createRetailCurrencyApiMock();
});

vi.mock('@/api/customers', async () => {
  const { createRetailCustomersApiMock } = await import('@/__tests__/test-utils/mocks/retailPos');
  return createRetailCustomersApiMock();
});

vi.mock('@/contexts/AuthContext', async () => {
  const { createAuthContextMock } = await import('@/__tests__/test-utils/mocks/contexts');
  // ADR #36 D7: cost editing is manager+ only — these attribute tests
  // exercise the Cost field, so the session must hold products:edit_cost.
  return {
    useAuth: createAuthContextMock({
      roleName: 'manager',
      isManager: true,
      permissions: ['products:edit_cost'],
    }),
  };
});

vi.mock('@/contexts/WorkspaceContext', async () => {
  const { createWorkspaceContextMock } = await import('@/__tests__/test-utils/mocks/contexts');
  return createWorkspaceContextMock();
});

const catFtl = `
  category-cat-food = Makanan
  category-cat-drink = Minuman
`;

/** Products with ADR #36/#37 fields for the attribute tests. */
const attrProducts = retailProducts.map((p, i) => ({
  ...p,
  cost_minor: 1000 + i * 100,
  brand: i % 2 === 0 ? 'Indofood' : 'Sosro',
  rack_location: `R-0${(i % 5) + 1}`,
  notes: i === 0 ? 'Fragile' : null,
  unit: 'pcs',
  is_active: p.sku !== 'SKU-004', // Aqua is retired in these fixtures
  default_supplier_id: null,
  popularity_score: 100 - i * 10, // descending: SKU-001 most popular
}));

describe('RetailPosScreen — ADR #36/#37/#38', () => {
  beforeEach(async () => {
    localStorage.clear();
    mockedBarcode.reset();
    // Attribute fixtures on every test (persistent, not Once — the load
    // path may re-run on abort/retry).
    const productsApi = vi.mocked(await import('@/api/products'));
    productsApi.listProductsScoped.mockResolvedValue(attrProducts);
  });

  it('sorts by popularity descending by default (ADR #37 D5)', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('Indomie Goreng')).toBeInTheDocument());

    // Most popular (SKU-001, score 100) must render before the least
    // popular (SKU-004, score 70) in the default sort.
    const grid = screen.getByTestId('product-grid-scroll');
    const names = Array.from(grid.querySelectorAll('.retail-col-name .retail-product-btn span:first-child'))
      .map((el) => el.textContent);
    expect(names[0]).toBe('Indomie Goreng');
    expect(names[names.length - 1]).toBe('Aqua 600ml');

    // The popularity chip is active (aria-pressed) on load.
    expect(screen.getByRole('button', { name: /popularity/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('default sort ties break deterministically on SKU (ADR #37 D5)', async () => {
    const tied = attrProducts.map((p) => ({ ...p, popularity_score: 50 }));
    const productsApi = vi.mocked(await import('@/api/products'));
    productsApi.listProductsScoped.mockResolvedValue(tied);
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('Indomie Goreng')).toBeInTheDocument());

    const grid = screen.getByTestId('product-grid-scroll');
    const names = Array.from(grid.querySelectorAll('.retail-col-name .retail-product-btn span:first-child'))
      .map((el) => el.textContent);
    // SKU tiebreak ascending: SKU-001, SKU-002, SKU-003, SKU-004.
    expect(names).toEqual(['Indomie Goreng', 'Teh Botol Sosro', 'Nasi Goreng Spesial', 'Aqua 600ml']);
  });

  it('column toggle shows/hides the Rack column and never offers Cost (ADR #36 D4)', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('Indomie Goreng')).toBeInTheDocument());

    // Rack column hidden by default.
    const grid = screen.getByTestId('product-grid-scroll');
    expect(grid.querySelector('.retail-col-rack')).not.toBeInTheDocument();

    // Open the Columns menu → Rack toggle exists, Cost does not.
    await userEvent.click(screen.getByRole('button', { name: /columns/i }));
    const menu = await screen.findByRole('menu', { name: /choose visible columns/i });
    const rackItem = within(menu).getByRole('menuitemcheckbox', { name: /rack/i });
    expect(within(menu).queryByRole('menuitemcheckbox', { name: /cost/i })).not.toBeInTheDocument();

    // Toggle Rack on → column appears with rack codes.
    await userEvent.click(rackItem);
    await waitFor(() => expect(grid.querySelector('.retail-col-rack')).toBeInTheDocument());
    expect(screen.getByText('R-01')).toBeInTheDocument();

    // Toggle Rack off → column disappears.
    await userEvent.click(within(menu).getByRole('menuitemcheckbox', { name: /rack/i }));
    await waitFor(() => expect(grid.querySelector('.retail-col-rack')).not.toBeInTheDocument());
  });

  it('hide-inactive toggle hides retired products (ADR #36)', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('Indomie Goreng')).toBeInTheDocument());
    expect(screen.getByText('Aqua 600ml')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /columns/i }));
    const menu = await screen.findByRole('menu', { name: /choose visible columns/i });
    await userEvent.click(within(menu).getByRole('menuitemcheckbox', { name: /hide inactive/i }));

    await waitFor(() => expect(screen.queryByText('Aqua 600ml')).not.toBeInTheDocument());
    expect(screen.getByText('Indomie Goreng')).toBeInTheDocument();
  });

  it('right-click opens the row context menu; images action fires the opener (ADR #38)', async () => {
    const browserApi = await import('@/api/browser');
    const openSpy = vi.spyOn(browserApi, 'openProductImagesScoped').mockResolvedValue(true);

    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('Indomie Goreng')).toBeInTheDocument());

    const row = screen.getByText('Indomie Goreng').closest('tr')!;
    await userEvent.pointer({ keys: '[MouseRight]', target: row });

    const menu = await screen.findByRole('menu', { name: /product actions/i });
    await userEvent.click(within(menu).getByRole('menuitem', { name: /view product images/i }));

    expect(openSpy).toHaveBeenCalledWith(expect.any(String), 'SKU-001');
    // Menu closes after acting.
    await waitFor(() => expect(screen.queryByRole('menu', { name: /product actions/i })).not.toBeInTheDocument());
  });

  it('context menu closes on Escape (ADR #38 D1)', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('Indomie Goreng')).toBeInTheDocument());

    const row = screen.getByText('Indomie Goreng').closest('tr')!;
    await userEvent.pointer({ keys: '[MouseRight]', target: row });
    await screen.findByRole('menu', { name: /product actions/i });

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu', { name: /product actions/i })).not.toBeInTheDocument());
  });

  it('edit modal shows Cost and the restock cost-override hint (ADR #36 D5)', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('Indomie Goreng')).toBeInTheDocument());

    // Open the edit modal from the row action.
    const editBtn = screen.getByRole('button', { name: /edit indomie goreng/i });
    await userEvent.click(editBtn);

    const dialog = await screen.findByRole('dialog', { name: /edit product/i });
    expect(within(dialog).getByLabelText(/cost/i)).toBeInTheDocument();
    // No override hint at current stock (no increase yet).
    expect(within(dialog).queryByText(/restocking/i)).not.toBeInTheDocument();

    // Increase stock above the fixture's 100 → cost-override hint appears.
    const stockInput = within(dialog).getByLabelText(/stock quantity/i);
    await userEvent.clear(stockInput);
    await userEvent.type(stockInput, '125');
    expect(await within(dialog).findByText(/restocking/i)).toBeInTheDocument();
  });

  it('saving the edit modal persists via updateProductScoped with cost (ADR #36 D5)', async () => {
    const productsApi = vi.mocked(await import('@/api/products'));
    productsApi.updateProductScoped.mockResolvedValue({ sku: 'SKU-001' });
    productsApi.adjustStockScoped.mockResolvedValue(25);

    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('Indomie Goreng')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /edit indomie goreng/i }));
    const dialog = await screen.findByRole('dialog', { name: /edit product/i });

    // Update the cost to 5000 and stock to 125 (restock → adjust + override).
    const costInput = within(dialog).getByLabelText(/cost/i);
    await userEvent.clear(costInput);
    await userEvent.type(costInput, '5000');
    const stockInput = within(dialog).getByLabelText(/stock quantity/i);
    await userEvent.clear(stockInput);
    await userEvent.type(stockInput, '125');
    await userEvent.click(within(dialog).getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(productsApi.updateProductScoped).toHaveBeenCalled());
    const updateArgs = productsApi.updateProductScoped.mock.calls[0]![1];
    expect(updateArgs.costMinor).toBe(5000);
    expect(updateArgs.brand).toBe('Indofood');
    expect(updateArgs.rackLocation).toBe('R-01');

    // Stock increased from the fixture (100) to 125 → adjustment issued.
    await waitFor(() => expect(productsApi.adjustStockScoped).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ sku: 'SKU-001', delta: 25 }),
    ));
  });

  it('saving the add modal persists via createProductScoped with new fields (ADR #36 D5)', async () => {
    const productsApi = vi.mocked(await import('@/api/products'));
    productsApi.createProductScoped.mockResolvedValue({ sku: 'PROD-NEW' });

    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('Indomie Goreng')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /add new product/i }));
    const dialog = await screen.findByRole('dialog', { name: /add product/i });

    await userEvent.type(within(dialog).getByLabelText(/product name/i), 'Test Widget');
    await userEvent.clear(within(dialog).getByLabelText(/cost/i));
    await userEvent.type(within(dialog).getByLabelText(/cost/i), '2500');
    await userEvent.type(within(dialog).getByLabelText(/brand/i), 'Acme');
    await userEvent.type(within(dialog).getByLabelText(/rack/i), 'A-09');
    await userEvent.click(within(dialog).getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(productsApi.createProductScoped).toHaveBeenCalled());
    const createArgs = productsApi.createProductScoped.mock.calls[0]![1];
    expect(createArgs.costMinor).toBe(2500);
    expect(createArgs.brand).toBe('Acme');
    expect(createArgs.rackLocation).toBe('A-09');
    expect(createArgs.isActive).toBe(true);
  });

  it('adding from a non-empty search fires the popularity search signal (ADR #37 D2)', async () => {
    const productsApi = vi.mocked(await import('@/api/products'));
    productsApi.recordProductSearchScoped.mockResolvedValue(undefined);

    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('Indomie Goreng')).toBeInTheDocument());

    await userEvent.type(screen.getByPlaceholderText(/cari produk/i), 'Indomie');
    const addBtn = await screen.findByRole('button', { name: /add indomie goreng to cart/i });
    await userEvent.click(addBtn);

    await waitFor(() => expect(productsApi.recordProductSearchScoped).toHaveBeenCalledWith(
      expect.any(String),
      'SKU-001',
    ));
  });
});
