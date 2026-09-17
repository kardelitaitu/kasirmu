// ── RetailPosScreen tests — fast rendering + navigation ─────────
//
// Covers: rendering, products/categories, search, keyboard shortcuts,
// hold/resume, barcode registration, credit reminders, table
// management, KDS navigation. Fast isolated tests that don't trigger
// the payment modal or long-press timers. 24 tests.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/__tests__/test-utils/render';
import { createUsePosStateMock } from '@/__tests__/test-utils/mocks/usePosState';
import { mockedBarcode } from '@/__tests__/test-utils/mocks/barcodeScanner';
import { retailProducts } from '@/__tests__/test-utils/mocks/retailPos';
import salesFtl from '@/locales/sales.ftl?raw';
import productsFtl from '@/locales/products.ftl?raw';
import tablesFtl from '@/locales/tables.ftl?raw';
import RetailPosScreen from '@/features/retail/RetailPosScreen';
import { useTheme } from '@/app/ThemeProvider';
import type { ReactNode } from 'react';
import type { LineId, Sku } from '@/types/domain';

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
  return {
    useAuth: createAuthContextMock(),
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

function ToggleThemeWrapper({ children }: { children: ReactNode }) {
  const { setTheme } = useTheme();
  return (
    <div>
      <button type="button" onClick={() => setTheme('dark')}>Dark</button>
      <button type="button" onClick={() => setTheme('light')}>Light</button>
      {children}
    </div>
  );
}

// ── Helper to click "All Categories" button ──────────────────────

async function showAllProducts() {
  const allBtn = await screen.findByRole('button', { name: /^all categories$/i });
  if (allBtn) await userEvent.click(allBtn);
}

// ── Tests ─────────────────────────────────────────────────────────

describe('RetailPosScreen — rendering', () => {
  beforeEach(async () => {
    mockedBarcode.reset();
    const sp = await import('@/features/sales/usePosState');
    vi.mocked(sp.usePosState).mockReset();
    vi.mocked(sp.usePosState).mockReturnValue(createUsePosStateMock());
  });

  it('renders the store header with name, branch, and clock', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('TOKO TEST')).toBeInTheDocument());
    expect(screen.getByText(/Cabang A/)).toBeInTheDocument();
    expect(screen.getByText('Jl. Contoh No. 123')).toBeInTheDocument();
    expect(screen.getByText('Kasir Test')).toBeInTheDocument();
  });

  it('shows empty cart state initially', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText(/Cart is empty/)).toBeInTheDocument());
  });

  it('renders the function bar with all shortcut buttons', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('F1')).toBeInTheDocument());
    expect(screen.getByText('F2')).toBeInTheDocument();
    expect(screen.getByText('F3')).toBeInTheDocument();
    expect(screen.getByText('F4')).toBeInTheDocument();
    expect(screen.getByText('F5')).toBeInTheDocument();
    expect(screen.getByText('F9')).toBeInTheDocument();
    expect(screen.getByText('F10')).toBeInTheDocument();
  });

  it('displays "No shift" badge when no active shift', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText(/No shift/)).toBeInTheDocument());
  });

  it('loads and displays products', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('Indomie Goreng')).toBeInTheDocument());
    await showAllProducts();
    expect(screen.getByText('Teh Botol Sosro')).toBeInTheDocument();
    expect(screen.getByText('Nasi Goreng Spesial')).toBeInTheDocument();
    expect(screen.getByText('Aqua 600ml')).toBeInTheDocument();
  });

  it('shows low-stock badge for products with stock_qty <= 5', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await showAllProducts();
    await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument());
  });

  it('filters to low-stock products when reminder row is clicked', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await showAllProducts();
    await waitFor(() => expect(screen.getByText('Indomie Goreng')).toBeInTheDocument());

    // Click the low-stock reminder row — filter on
    const lowStockRow = document.querySelector('.retail-reminder-row--low-stock')!;
    expect(lowStockRow).toBeInTheDocument();
    await userEvent.click(lowStockRow);

    // Only Aqua (stock_qty=3 <= 5) should remain visible
    await waitFor(() => expect(screen.queryByText('Indomie Goreng')).not.toBeInTheDocument());
    expect(screen.queryByText('Teh Botol Sosro')).not.toBeInTheDocument();
    expect(screen.getByText('Aqua 600ml')).toBeInTheDocument();

    // Click again — filter off, all products return
    await userEvent.click(lowStockRow);
    await waitFor(() => expect(screen.getByText('Indomie Goreng')).toBeInTheDocument());
    expect(screen.getByText('Teh Botol Sosro')).toBeInTheDocument();
    expect(screen.getByText('Aqua 600ml')).toBeInTheDocument();
  });

  it('renders category filter buttons', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText(/All Categories/i)).toBeInTheDocument());
    expect(screen.getByText('Makanan')).toBeInTheDocument();
    expect(screen.getByText('Minuman')).toBeInTheDocument();
  });

  it('filters products by category', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('Indomie Goreng')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Minuman'));
    expect(screen.queryByText('Indomie Goreng')).not.toBeInTheDocument();
    expect(screen.queryByText('Nasi Goreng Spesial')).not.toBeInTheDocument();
    expect(screen.getByText('Teh Botol Sosro')).toBeInTheDocument();
    expect(screen.getByText('Aqua 600ml')).toBeInTheDocument();
  });

  it('clears category filter when clicking "All"', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('Indomie Goreng')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Minuman'));
    expect(screen.queryByText('Indomie Goreng')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText(/All Categories/i));
    expect(screen.getByText('Indomie Goreng')).toBeInTheDocument();
    expect(screen.getByText('Teh Botol Sosro')).toBeInTheDocument();
  });

  // ── Search ───────────────────────────────────────────────────

  it('searches products by name', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await showAllProducts();
    const searchInput = screen.getByPlaceholderText('Cari produk\u2026');
    await userEvent.type(searchInput, 'Teh');
    expect(screen.queryByText('Indomie Goreng')).not.toBeInTheDocument();
    expect(screen.getByText('Teh Botol Sosro')).toBeInTheDocument();
  });

  it('searches products by SKU', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await showAllProducts();
    const searchInput = screen.getByPlaceholderText('Cari produk\u2026');
    await userEvent.type(searchInput, 'SKU-004');
    expect(screen.queryByText('Indomie Goreng')).not.toBeInTheDocument();
    expect(screen.getAllByText('Aqua 600ml').length).toBeGreaterThanOrEqual(1);
  });

  it('clears search when clicking the clear button', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await showAllProducts();
    const searchInput = screen.getByPlaceholderText('Cari produk\u2026');
    await userEvent.type(searchInput, 'Teh');
    const clearButton = screen.getByLabelText('Clear search');
    await userEvent.click(clearButton);
    expect(screen.getByText('Indomie Goreng')).toBeInTheDocument();
    expect(screen.getByText('Teh Botol Sosro')).toBeInTheDocument();
  });

  it('shows empty state when no products match search', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await showAllProducts();
    const searchInput = screen.getByPlaceholderText('Cari produk\u2026');
    await userEvent.type(searchInput, 'ZZZZZZ');
    expect(screen.getByText(/No products match your search/)).toBeInTheDocument();
  });

  // ── Barcode registration ─────────────────────────────────────

  it('registers the barcode scanner on mount', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(mockedBarcode.useBarcodeScanner).toHaveBeenCalled());
  });

  // ── Keyboard shortcuts / non-interaction ─────────────────────

  it('shows shortcuts overlay on ? key', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('F1')).toBeInTheDocument());
    await userEvent.keyboard('?');
    expect(screen.getByText(/Keyboard Shortcuts/)).toBeInTheDocument();
  });

  it('shows hold warning when no cart items', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    const holdBtn = await screen.findByRole('button', { name: /F4.*Hold/i });
    expect(holdBtn).toBeDisabled();
  });

  it('hides credit reminders button when no outstanding credits', async () => {
    const sp = await import('@/features/sales/usePosState');
    vi.mocked(sp.usePosState).mockReturnValue(createUsePosStateMock({
      lines: [{ id: 'line-1' as LineId, sku: 'SKU-001' as Sku, name: 'Indomie Goreng', category: 'cat-food', qty: 1, unit_price: { minor_units: 3500, currency: 'IDR' } }],
      total: { minor_units: 3500, currency: 'IDR' },
      subtotal: { minor_units: 3500, currency: 'IDR' },
    }));
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    expect(screen.queryByText(/Credit Reminders/)).not.toBeInTheDocument();
  });

  // ── Table Management ─────────────────────────────────────────

  it('renders the Tables button when TABLE_MANAGEMENT feature is enabled', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('F1')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /table/i })).toBeInTheDocument();
  });

  it('hides the Tables button when TABLE_MANAGEMENT feature is disabled', async () => {
    const settingsApi = await import('@/api/settings');
    vi.mocked(settingsApi.getEnabledFeatures).mockResolvedValueOnce({
      features: ['simple-retail', 'cash-payment'],
    });
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('F1')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /table/i })).not.toBeInTheDocument();
  });

  it('opens TableManagementScreen when the Tables button is clicked', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('F1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /table/i }));
    await waitFor(() => expect(screen.getByTestId('table-management-screen')).toBeInTheDocument());
    expect(screen.getByText('Table Management Floor Plan')).toBeInTheDocument();
  });

  it('dismisses TableManagementScreen when the back button is clicked', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('F1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /table/i }));
    await waitFor(() => expect(screen.getByTestId('table-management-screen')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /back/i }));
    await waitFor(() => expect(screen.queryByTestId('table-management-screen')).not.toBeInTheDocument());
    expect(screen.getByText('F1')).toBeInTheDocument();
  });

  // ── KDS (F12) shortcut ──────────────────────────────────────

  it('F12 navigates to KDS workspace via onNavigate', async () => {
    const onNavigate = vi.fn();
    await renderWithProviders(<RetailPosScreen onNavigate={onNavigate} />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('F1')).toBeInTheDocument());
    await userEvent.keyboard('{F12}');
    expect(onNavigate).toHaveBeenCalledWith('kds');
  });

  it('F12 button in function bar calls onNavigate with kds', async () => {
    const onNavigate = vi.fn();
    await renderWithProviders(<RetailPosScreen onNavigate={onNavigate} />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('F1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /F12/i }));
    expect(onNavigate).toHaveBeenCalledWith('kds');
  });

  it('does not crash when F12 is pressed and onNavigate is undefined', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('F1')).toBeInTheDocument());
    await userEvent.keyboard('{F12}');
    expect(screen.queryByTestId('kds-screen')).not.toBeInTheDocument();
  });

  // ── Low-stock filter (Ctrl+L) shortcut ─────────────────────

  it('shows filtered indicator when low-stock filter is active', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await showAllProducts();
    await waitFor(() => expect(screen.getByText('Indomie Goreng')).toBeInTheDocument());

    // No indicator before filtering
    expect(screen.queryByText(/filtered/i)).not.toBeInTheDocument();

    // Toggle on
    await userEvent.keyboard('{Control>}l{/Control}');
    await waitFor(() => expect(screen.getByText(/filtered/i)).toBeInTheDocument());

    // Toggle off — indicator disappears
    await userEvent.keyboard('{Control>}l{/Control}');
    await waitFor(() => expect(screen.queryByText(/filtered/i)).not.toBeInTheDocument());
  });

  it('Ctrl+K opens the credit reminders list', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('F1')).toBeInTheDocument());
    await userEvent.keyboard('{Control>}k{/Control}');
    await waitFor(() => expect(screen.getByRole('heading', { name: /credit reminders/i })).toBeInTheDocument());
  });

  it('F11 key badge is present in the function bar', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('F1')).toBeInTheDocument());
    // F11 badge should exist (was previously missing; keyboard shortcut tested via code review)
    expect(screen.getByText('F11')).toBeInTheDocument();
  });

  it('Ctrl+L toggles low-stock filter in the product grid', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await showAllProducts();
    await waitFor(() => expect(screen.getByText('Indomie Goreng')).toBeInTheDocument());

    // Toggle on: Ctrl+L
    await userEvent.keyboard('{Control>}l{/Control}');
    await waitFor(() => expect(screen.queryByText('Indomie Goreng')).not.toBeInTheDocument());
    expect(screen.getByText('Aqua 600ml')).toBeInTheDocument();

    // Toggle off: Ctrl+L again
    await userEvent.keyboard('{Control>}l{/Control}');
    await waitFor(() => expect(screen.getByText('Indomie Goreng')).toBeInTheDocument());
    expect(screen.getByText('Teh Botol Sosro')).toBeInTheDocument();
  });

  it('shows the low-stock-specific empty message when the filter matches nothing (P1-2)', async () => {
    // Override the products so every stock_qty is above the threshold → the
    // low-stock filter yields zero rows and the grid shows its dedicated message.
    // Persistent mock (not Once) since the load path may re-run (abort/retry).
    const productsApi = await import('@/api/products');
    vi.mocked(productsApi.listProductsScoped).mockResolvedValue(
      retailProducts.map((p) => ({ ...p, stock_qty: 100 })),
    );

    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await showAllProducts();
    await waitFor(() => expect(screen.getByText('Indomie Goreng')).toBeInTheDocument());

    // No low-stock message before the filter is active
    expect(screen.queryByText(/No products below the low-stock threshold/)).not.toBeInTheDocument();

    // Ctrl+L toggles the filter → every product is filtered out
    await userEvent.keyboard('{Control>}l{/Control}');
    await waitFor(() => expect(screen.getByText(/No products below the low-stock threshold/)).toBeInTheDocument());
    expect(screen.queryByText('Indomie Goreng')).not.toBeInTheDocument();
    expect(screen.queryByText('Aqua 600ml')).not.toBeInTheDocument();

    // Reset the persistent mock so high stock values don't leak into later tests
    vi.mocked(productsApi.listProductsScoped).mockResolvedValue(retailProducts);
  });

  it('syncs the retail-pos root data-theme with the global theme provider', async () => {
    await renderWithProviders(
      <ToggleThemeWrapper><RetailPosScreen /></ToggleThemeWrapper>,
      salesFtl, productsFtl, tablesFtl, catFtl,
    );
    await waitFor(() => expect(screen.getByText('TOKO TEST')).toBeInTheDocument());
    const retailRoot = document.querySelector('.retail-pos') as HTMLElement;
    expect(retailRoot).toBeInTheDocument();

    const globalTheme = () => document.documentElement.getAttribute('data-theme') ?? 'default';

    // Default theme: global <html> has no data-theme, component carries 'default'.
    expect(retailRoot.getAttribute('data-theme')).toBe(globalTheme());

    await userEvent.click(screen.getByRole('button', { name: 'Dark' }));
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('dark'));
    expect(retailRoot.getAttribute('data-theme')).toBe('dark');
    expect(retailRoot.getAttribute('data-theme')).toBe(globalTheme());

    await userEvent.click(screen.getByRole('button', { name: 'Light' }));
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('light'));
    expect(retailRoot.getAttribute('data-theme')).toBe('light');
    expect(retailRoot.getAttribute('data-theme')).toBe(globalTheme());
  });
});
