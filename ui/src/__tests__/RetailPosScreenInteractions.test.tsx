// ── RetailPosScreen interaction tests ──────────────────────────────
//
// Covers: long-press quantity picker, SKU/barcode input, barcode
// scanning, shift management, discount modal, clear cart. These
// tests involve userEvent interactions and moderate async waits.
// Split from RetailPosScreen.test.tsx to enable parallel execution. 17 tests.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/__tests__/test-utils/render';
import { createUsePosStateMock } from '@/__tests__/test-utils/mocks/usePosState';
import { mockedBarcode } from '@/__tests__/test-utils/mocks/barcodeScanner';
import salesFtl from '@/locales/sales.ftl?raw';
import productsFtl from '@/locales/products.ftl?raw';
import tablesFtl from '@/locales/tables.ftl?raw';
import RetailPosScreen from '@/features/retail/RetailPosScreen';
import type { CourseId, LineId, Sku } from '@/types/domain';

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
    getStoreSettings: vi.fn(() =>
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

// ── Tests ─────────────────────────────────────────────────────────

let mockAddProduct: ReturnType<typeof vi.fn>;

describe('RetailPosScreen — interactions', () => {
  beforeEach(async () => {
    mockedBarcode.reset();
    mockAddProduct = vi.fn();
    const sp = await import('@/features/sales/usePosState');
    vi.mocked(sp.usePosState).mockReset();
    vi.mocked(sp.usePosState).mockReturnValue(
      createUsePosStateMock({ addProduct: mockAddProduct }),
    );
  });

  // ── Long-press quantity picker ────────────────────────────────
  // Note: these tests use real setTimeout(500) for long-press detection

  it('opens quantity picker on long-press of a product button', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('Indomie Goreng')).toBeInTheDocument());
    const productBtn = screen.getByText('Indomie Goreng').closest('button')!;
    fireEvent.pointerDown(productBtn);
    await act(async () => { await new Promise(r => setTimeout(r, 500)); });
    fireEvent.pointerUp(productBtn);
    await waitFor(() => expect(screen.getByText('Add')).toBeInTheDocument());
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByDisplayValue('1')).toBeInTheDocument();
  });

  it('shows correct price in quantity picker', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    const productBtns = await screen.findAllByRole('button', { name: /indomie goreng/i });
    const productBtn = productBtns[0]!;
    fireEvent.pointerDown(productBtn);
    await act(async () => { await new Promise(r => setTimeout(r, 500)); });
    fireEvent.pointerUp(productBtn);
    await waitFor(() => {
      const qtyModal = screen.getByRole('heading', { name: /Indomie Goreng/i })
        .closest('.retail-qty-modal')!;
      expect(qtyModal as HTMLElement).toBeInTheDocument();
    });
  });

  it('calls addProduct when confirming quantity via long-press', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('Indomie Goreng')).toBeInTheDocument());
    const productBtn = screen.getByText('Indomie Goreng').closest('button')!;
    fireEvent.pointerDown(productBtn);
    await act(async () => { await new Promise(r => setTimeout(r, 500)); });
    fireEvent.pointerUp(productBtn);
    await waitFor(() => expect(screen.getByText('Add')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Add'));
    expect(mockAddProduct).toHaveBeenCalledTimes(1);
    expect(mockAddProduct).toHaveBeenCalledWith(expect.objectContaining({ sku: 'SKU-001' }), 1);
  });

  it('adds product on single tap of a product button', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('Indomie Goreng')).toBeInTheDocument());
    const productBtn = screen.getByText('Indomie Goreng').closest('button')!;
    fireEvent.pointerDown(productBtn);
    fireEvent.pointerUp(productBtn);
    await waitFor(() => expect(mockAddProduct).toHaveBeenCalledTimes(1));
    expect(mockAddProduct).toHaveBeenCalledWith(expect.objectContaining({ sku: 'SKU-001' }));
  });

  // ── P1-1: screen-reader announcement ─────────────────────────

  it('announces the added product via the screen-reader live region', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('Indomie Goreng')).toBeInTheDocument());

    // The visually-hidden live region is always mounted inside #retail-main
    const announceRegion = screen.getByTestId('retail-sr-announce');
    expect(announceRegion).toBeInTheDocument();
    expect(announceRegion).toHaveAttribute('role', 'status');
    expect(announceRegion).toHaveAttribute('aria-live', 'polite');
    // Empty before any add
    expect(announceRegion.textContent).toBe('');

    // Single tap → handleAdd → announce('Added Indomie Goreng')
    const productBtn = screen.getByText('Indomie Goreng').closest('button')!;
    fireEvent.pointerDown(productBtn);
    fireEvent.pointerUp(productBtn);

    await waitFor(() => {
      expect(announceRegion.textContent).toMatch(/Added Indomie Goreng/);
    });
  });

  // ── SKU / Barcode input ──────────────────────────────────────

  it('adds product when SKU is submitted via Enter', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    const skuInputs = await screen.findAllByPlaceholderText(/Scan or type barcode/);
    const skuInput = skuInputs[0]!;
    await userEvent.type(skuInput, 'SKU-001{Enter}');
    expect(mockAddProduct).toHaveBeenCalledTimes(1);
    expect(mockAddProduct).toHaveBeenCalledWith(expect.objectContaining({ sku: 'SKU-001', name: 'Indomie Goreng' }));
  });

  it('adds product when SKU is submitted via GO button', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    const skuInputs = await screen.findAllByPlaceholderText(/Scan or type barcode/);
    const skuInput = skuInputs[0]!;
    await userEvent.type(skuInput, 'SKU-001');
    await userEvent.click(screen.getByText('GO'));
    expect(mockAddProduct).toHaveBeenCalledTimes(1);
  });

  it('shows warning toast when SKU is not found', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    const skuInputs = await screen.findAllByPlaceholderText(/Scan or type barcode/);
    const skuInput = skuInputs[0]!;
    await userEvent.type(skuInput, 'INVALID-SKU{Enter}');
    await waitFor(() => {
      const toast = screen.getByRole('alert');
      // P1-7: SKU lookups use a distinct message (not the barcode one)
      expect(toast.textContent).toMatch(/No product matches SKU "INVALID-SKU"/);
    });
  });

  it('calls lookupProductBySku when barcode is entered via SKU input', async () => {
    const productsApi = await import('@/api/products');
    vi.mocked(productsApi.lookupProductBySkuScoped!).mockResolvedValueOnce({
      sku: 'REMOTE-SKU', name: 'Remote Product', category: null,
      price: { minor_units: 10000, currency: 'IDR' }, barcode: '1234567890',
      in_stock: true, stock_qty: 10, tax_rate_ids: [], created_at: '',
      price_updated_at: '', product_type: 'retail',
    });
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    const skuInputs = await screen.findAllByPlaceholderText(/Scan or type barcode/);
    const skuInput = skuInputs[0]!;
    await userEvent.type(skuInput, '1234567890{Enter}');
    await waitFor(() => expect(productsApi.lookupProductBySkuScoped).toHaveBeenCalledWith(expect.any(String), '1234567890'));
  });

  // ── Barcode scanning ─────────────────────────────────────────

  it('adds product when barcode is scanned matching local product', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(mockedBarcode.useBarcodeScanner).toHaveBeenCalled());
    act(() => { mockedBarcode.triggerScan('8991002100110'); });
    await waitFor(() => expect(mockAddProduct).toHaveBeenCalledWith(expect.objectContaining({ sku: 'SKU-001', name: 'Indomie Goreng' })));
  });

  it('calls lookupByBarcode when scanned code not in local products', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(mockedBarcode.useBarcodeScanner).toHaveBeenCalled());
    const productsApi = await import('@/api/products');
    act(() => { mockedBarcode.triggerScan('UNKNOWN-CODE'); });
    await waitFor(() => expect(productsApi.lookupByBarcodeScoped).toHaveBeenCalledWith(expect.any(String), 'UNKNOWN-CODE'));
  });

  // ── Shift management ─────────────────────────────────────────

  it('opens shift modal when F9 is pressed and no shift is active', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText(/No shift/)).toBeInTheDocument());
    await userEvent.keyboard('{F9}');
    expect(screen.getByRole('heading', { name: /open shift/i })).toBeInTheDocument();
  });

  it('opens a shift when opening balance is submitted', async () => {
    const { openShiftScoped } = await import('@/api/shifts');
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText(/No shift/)).toBeInTheDocument());
    await userEvent.keyboard('{F9}');
    const input = screen.getByLabelText(/Opening balance/);
    await userEvent.type(input, '100000');
    await userEvent.click(screen.getByText('Open'));
    // MONEY-05: the store currency is IDR (exponent 0) — the drawer
    // amount is already in minor units. The old hardcoded ×100 sent
    // 10000000 and broke cash reconciliation 100x.
    await waitFor(() => expect(openShiftScoped).toHaveBeenCalledWith(expect.any(String), 100000));
  });

  it('shows warning when Pay is pressed without an active shift', async () => {
    const posState = await import('@/features/sales/usePosState');
    vi.mocked(posState.usePosState).mockReturnValue(createUsePosStateMock({
      lines: [{ id: 'line-1' as LineId, sku: 'SKU-001' as Sku, name: 'Indomie Goreng', category: '', qty: 1, unit_price: { minor_units: 3500, currency: 'IDR' } }],
      total: { minor_units: 3500, currency: 'IDR' },
      subtotal: { minor_units: 3500, currency: 'IDR' },
    }));
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    const payBtns = await screen.findAllByRole('button', { name: /F1.*Pay/i });
    await userEvent.click(payBtns[0]!);
    await waitFor(() => {
      const toast = screen.getByRole('alert');
      expect(toast.textContent).toMatch(/Open a shift first/);
    });
  });

  // ── Discount modal ───────────────────────────────────────────

  it('opens discount modal', async () => {
    const posState = await import('@/features/sales/usePosState');
    vi.mocked(posState.usePosState).mockReturnValue(createUsePosStateMock({
      lines: [{ id: 'line-1' as LineId, sku: 'SKU-001' as Sku, name: 'Indomie Goreng', category: '', qty: 1, unit_price: { minor_units: 3500, currency: 'IDR' } }],
      total: { minor_units: 3500, currency: 'IDR' },
      subtotal: { minor_units: 3500, currency: 'IDR' },
    }));
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    const diskonBtn = await screen.findByRole('button', { name: /^diskon$/i });
    await userEvent.click(diskonBtn);
    await waitFor(() => expect(screen.getByRole('heading', { name: /Discount/i })).toBeInTheDocument());
  });

  it('applies discount from the discount modal', async () => {
    const posState = await import('@/features/sales/usePosState');
    const setDiscount = vi.fn();
    vi.mocked(posState.usePosState).mockReturnValue(createUsePosStateMock({
      lines: [{ id: 'line-1' as LineId, sku: 'SKU-001' as Sku, name: 'Indomie Goreng', category: '', qty: 1, unit_price: { minor_units: 3500, currency: 'IDR' } }],
      total: { minor_units: 3500, currency: 'IDR' },
      subtotal: { minor_units: 3500, currency: 'IDR' },
      setDiscount,
    }));
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    const diskonBtn = await screen.findByRole('button', { name: /^diskon$/i });
    await userEvent.click(diskonBtn);
    // Use getByRole to avoid ambiguity with the dialog's aria-label="Discount"
    const discountInput = screen.getByRole('spinbutton', { name: /discount/i });
    await userEvent.type(discountInput, '10');
    await userEvent.click(screen.getByRole('button', { name: /apply/i }));
    expect(setDiscount).toHaveBeenCalledWith(10, '');
  });

  // MONEY-04: the Rp tab must scale the entered amount by the CART
  // currency's minor-unit exponent. The old handler hardcoded ×100 —
  // for IDR (exponent 0) that inflated the ratio 100x, so any Rp
  // discount ≥ 1% of the subtotal clamped to 100% off (free goods).
  it('converts an Rp discount at the IDR exponent (2000 off 100000 = 2%)', async () => {
    const posState = await import('@/features/sales/usePosState');
    const setDiscount = vi.fn();
    vi.mocked(posState.usePosState).mockReturnValue(createUsePosStateMock({
      lines: [{ id: 'line-1' as LineId, sku: 'SKU-001' as Sku, name: 'Indomie Goreng', category: '', qty: 1, unit_price: { minor_units: 100000, currency: 'IDR' } }],
      total: { minor_units: 100000, currency: 'IDR' },
      subtotal: { minor_units: 100000, currency: 'IDR' },
      setDiscount,
    }));
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    const diskonBtn = await screen.findByRole('button', { name: /^diskon$/i });
    await userEvent.click(diskonBtn);
    await userEvent.click(screen.getByRole('button', { name: /^Rp$/i }));
    const rpInput = screen.getByRole('spinbutton', { name: /discount \(rp\)/i });
    await userEvent.type(rpInput, '2000');
    await userEvent.click(screen.getByRole('button', { name: /apply/i }));
    expect(setDiscount).toHaveBeenCalledWith(2, '');
  });

  // ── Clear cart ───────────────────────────────────────────────

  it('shows clear confirmation when Void/Clear is clicked with items', async () => {
    const posState = await import('@/features/sales/usePosState');
    vi.mocked(posState.usePosState).mockReturnValue(createUsePosStateMock({
      lines: [{ id: 'line-1' as LineId, sku: 'SKU-001' as Sku, name: 'Indomie Goreng', category: '', qty: 1, unit_price: { minor_units: 3500, currency: 'IDR' } }],
      total: { minor_units: 3500, currency: 'IDR' },
      subtotal: { minor_units: 3500, currency: 'IDR' },
    }));
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    const clearBtn = await screen.findByRole('button', { name: /^clear$/i });
    await userEvent.click(clearBtn);
    await waitFor(() => expect(screen.getByText(/Clear Cart/)).toBeInTheDocument());
  });

  // ── Pay button edge cases ──────────────────────────────────

  it('disables Pay button when cart is empty (no lines)', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    const payBtns = await screen.findAllByRole('button', { name: /pay/i });
    expect(payBtns[0]).toBeDisabled();
  });

  it('keeps Pay button disabled when cart has items but no shift', async () => {
    const posState = await import('@/features/sales/usePosState');
    vi.mocked(posState.usePosState).mockReturnValue(createUsePosStateMock({
      lines: [{ id: 'line-1' as LineId, sku: 'SKU-001' as Sku, name: 'Indomie Goreng', category: '', qty: 1, unit_price: { minor_units: 3500, currency: 'IDR' } }],
      total: { minor_units: 3500, currency: 'IDR' },
      subtotal: { minor_units: 3500, currency: 'IDR' },
    }));
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    const payBtns = await screen.findAllByRole('button', { name: /pay/i });
    expect(payBtns[0]).toBeDisabled();
  });

  // ── Cart line removal ────────────────────────────────────────

  it('calls removeLine when cart remove button is clicked', async () => {
    const posState = await import('@/features/sales/usePosState');
    const removeLine = vi.fn();
    vi.mocked(posState.usePosState).mockReturnValue(createUsePosStateMock({
      lines: [{ id: 'line-1' as LineId, sku: 'SKU-001' as Sku, name: 'Indomie Goreng', category: 'cat-food', qty: 1, unit_price: { minor_units: 3500, currency: 'IDR' } }],
      total: { minor_units: 3500, currency: 'IDR' },
      subtotal: { minor_units: 3500, currency: 'IDR' },
      removeLine,
    }));
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => {
      // Product name appears in both the product grid AND the cart panel.
      const names = screen.getAllByText('Indomie Goreng');
      expect(names.length).toBeGreaterThanOrEqual(1);
    });
    const removeBtns = document.querySelectorAll('.retail-cart-remove-btn');
    expect(removeBtns.length).toBeGreaterThanOrEqual(1);
    await userEvent.click(removeBtns[0]!);
    expect(removeLine).toHaveBeenCalledTimes(1);
    expect(removeLine).toHaveBeenCalledWith('line-1');
  });

  it('removes multiple line items individually from cart panel', async () => {
    const posState = await import('@/features/sales/usePosState');
    const removeLine = vi.fn();
    vi.mocked(posState.usePosState).mockReturnValue(createUsePosStateMock({
      lines: [
        { id: 'line-1' as LineId, sku: 'SKU-001' as Sku, name: 'Indomie Goreng', category: 'cat-food', qty: 1, unit_price: { minor_units: 3500, currency: 'IDR' } },
        { id: 'line-2' as LineId, sku: 'SKU-002' as Sku, name: 'Teh Botol Sosro', category: 'cat-drink', qty: 2, unit_price: { minor_units: 5000, currency: 'IDR' } },
      ],
      total: { minor_units: 13500, currency: 'IDR' },
      subtotal: { minor_units: 13500, currency: 'IDR' },
      removeLine,
    }));
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => {
      const names = screen.getAllByText('Indomie Goreng');
      expect(names.length).toBeGreaterThanOrEqual(1);
    });
    const names = screen.getAllByText('Teh Botol Sosro');
    expect(names.length).toBeGreaterThanOrEqual(1);
    // Find all remove buttons and click each
    const removeBtns = document.querySelectorAll('.retail-cart-remove-btn');
    for (const btn of removeBtns) {
      await userEvent.click(btn);
    }
    expect(removeLine).toHaveBeenCalledTimes(2);
    expect(removeLine).toHaveBeenCalledWith('line-1');
    expect(removeLine).toHaveBeenCalledWith('line-2');
  });

  // ── Keyboard shortcut: F5 → SKU focus ────────────────────────

  it('focuses SKU input when F5 is pressed', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    const skuInputs = await screen.findAllByPlaceholderText(/Scan or type barcode/);
    const skuInput = skuInputs[0];
    expect(skuInput).not.toBe(document.activeElement);
    await userEvent.keyboard('{F5}');
    await waitFor(() => {
      expect(skuInput).toBe(document.activeElement);
    });
  });

  // ── Keyboard shortcut: F6 → Sales History ────────────────────

  it('opens Sales History screen when F6 is pressed', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => {
      expect(screen.getByText('Indomie Goreng')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('sales-history-screen')).not.toBeInTheDocument();
    await userEvent.keyboard('{F6}');
    await waitFor(() => {
      expect(screen.getByTestId('sales-history-screen')).toBeInTheDocument();
    });
    expect(screen.getByText('Sales History')).toBeInTheDocument();
  });

  // ── Keyboard shortcut: F7 → Customer Search ──────────────────

  it('opens Customer Search overlay when F7 is pressed', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => {
      expect(screen.getByText('Indomie Goreng')).toBeInTheDocument();
    });
    await userEvent.keyboard('{F7}');
    // Customer search shows an input field for searching
    await waitFor(() => {
      // The customer search renders a search input
      const searchInputs = screen.getAllByPlaceholderText(/search|cari|find/i);
      expect(searchInputs.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Keyboard shortcut: F8 → Stock Inquiry ────────────────────

  it('opens Stock Inquiry screen when F8 is pressed', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => {
      expect(screen.getByText('Indomie Goreng')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('stock-inquiry-screen')).not.toBeInTheDocument();
    await userEvent.keyboard('{F8}');
    await waitFor(() => {
      expect(screen.getByTestId('stock-inquiry-screen')).toBeInTheDocument();
    });
    expect(screen.getByText('Stock Inquiry')).toBeInTheDocument();
  });

  // ── P1-7: distinct SKU vs barcode failure messages ───────────

  it('shows the distinct barcode-not-found message when a scan fails', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(mockedBarcode.useBarcodeScanner).toHaveBeenCalled());
    act(() => { mockedBarcode.triggerScan('UNKNOWN-CODE'); });
    await waitFor(() => {
      const toast = screen.getByRole('alert');
      // P1-7: barcode failures keep the barcode message (distinct from retail-sku-not-found)
      expect(toast.textContent).toMatch(/No product or bundle matches this barcode/);
    });
  });

  // ── P1-3: held cart delete confirmation ──────────────────────

  it('requires confirmation before deleting a held cart', async () => {
    const salesApi = await import('@/api/sales');
    const heldCarts = [
      { id: 'held-1', label: 'Hold #100', item_count: 2, total_minor: 8500, currency: 'IDR', created_at: '2026-01-01T00:00:00Z', bill_type: 'hold', customer_name: null },
      { id: 'held-2', label: 'Hold #200', item_count: 1, total_minor: 3500, currency: 'IDR', created_at: '2026-01-01T00:00:00Z', bill_type: 'hold', customer_name: null },
    ];
    vi.mocked(salesApi.listHeldCartsScoped).mockResolvedValue(heldCarts);

    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('Indomie Goreng')).toBeInTheDocument());

    // F4 with a held cart id → handleResume opens the held carts list
    await userEvent.keyboard('{F4}');
    await waitFor(() => expect(screen.getByRole('heading', { name: /held carts/i })).toBeInTheDocument());

    // Click the delete button on the first row → confirm dialog appears, no immediate delete
    const deleteBtns = screen.getAllByTestId('held-cart-delete');
    expect(deleteBtns.length).toBeGreaterThanOrEqual(1);
    await userEvent.click(deleteBtns[0]!);
    await waitFor(() => expect(screen.getByRole('heading', { name: /delete held cart/i })).toBeInTheDocument());
    expect(salesApi.deleteHeldCartScoped).not.toHaveBeenCalled();

    // Confirm → deleteHeldCartScoped called with the cart id
    const confirmBtn = screen.getByTestId('held-cart-delete-confirm');
    expect(confirmBtn).toBeInTheDocument();
    await userEvent.click(confirmBtn);
    await waitFor(() => expect(salesApi.deleteHeldCartScoped).toHaveBeenCalledWith(expect.any(String), 'held-1'));

    // Reset the persistent mock so held carts don't leak into later tests
    // (both the mount effect and handleResume call listHeldCartsScoped).
    vi.mocked(salesApi.listHeldCartsScoped).mockResolvedValue([]);
  });

  // ── P1-4: scroll position preservation ───────────────────────

  it('restores product grid scroll position after returning from a sub-view', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('Indomie Goreng')).toBeInTheDocument());

    // The scroll container is the product grid — set a non-zero scrollTop
    const grid = screen.getByTestId('product-grid-scroll');
    expect(grid).toBeInTheDocument();
    grid.scrollTop = 120;

    // F6 → Sales History sub-view (goToSubView saves scroll position)
    await userEvent.keyboard('{F6}');
    await waitFor(() => expect(screen.getByTestId('sales-history-screen')).toBeInTheDocument());

    // Back → main view remounts and the restore effect reapplies scrollTop
    await userEvent.click(screen.getByRole('button', { name: /back/i }));
    await waitFor(() => expect(screen.queryByTestId('sales-history-screen')).not.toBeInTheDocument());
    const restoredGrid = screen.getByTestId('product-grid-scroll');
    expect(restoredGrid).toBeInTheDocument();
    await waitFor(() => expect(restoredGrid.scrollTop).toBe(120));
  });

  it('resets cart when clear is confirmed', async () => {
    const posState = await import('@/features/sales/usePosState');
    const resetCart = vi.fn();
    vi.mocked(posState.usePosState).mockReturnValue(createUsePosStateMock({
      lines: [{ id: 'line-1' as LineId, sku: 'SKU-001' as Sku, name: 'Indomie Goreng', category: 'cat-food', qty: 1, unit_price: { minor_units: 3500, currency: 'IDR' } }],
      total: { minor_units: 3500, currency: 'IDR' },
      subtotal: { minor_units: 3500, currency: 'IDR' },
      resetCart,
    }));
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    const clearBtn = await screen.findByRole('button', { name: /^clear$/i });
    await userEvent.click(clearBtn);
    const confirmBtns = screen.getAllByRole('button', { name: /^clear$/i });
    await userEvent.click(confirmBtns[1]!);
    expect(resetCart).toHaveBeenCalledTimes(1);
  });

  // ── PERF-04: rAF-throttled cart resize ───────────────────────────

  it('flushes the final cart width to localStorage on mouseup even when the rAF frame never runs', async () => {
    // Simulate a fast drag where the rAF callback is skipped (stubbed to no-op):
    // the ONLY path that applies the final pointer position is the synchronous
    // flush in stopResize. Regression guard for the flush-ordering bug where
    // isResizing was cleared before the flush made it early-return.
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
    const cafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    localStorage.removeItem('retail-cart-width');
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);

    // Give the root a deterministic right edge so the width math is exact:
    // right(800) - clientX(400) = 400, within [280, min(1024*0.5, 800)].
    const main = document.getElementById('retail-main');
    expect(main).not.toBeNull();
    const rectSpy = vi.spyOn(main!, 'getBoundingClientRect').mockReturnValue({ right: 800 } as DOMRect);

    const handle = document.querySelector('.retail-resize-handle');
    expect(handle).not.toBeNull();
    fireEvent.mouseDown(handle!);
    fireEvent.mouseMove(window, { clientX: 400 });
    fireEvent.mouseUp(window);

    expect(localStorage.getItem('retail-cart-width')).toBe('400');
    expect(handle!.getAttribute('aria-valuenow')).toBe('400');

    rafSpy.mockRestore();
    cafSpy.mockRestore();
    rectSpy.mockRestore();
  });

  // ── Cart line remove → undo flow (RetailCartPanel undo bar) ────

  it('reveals the undo bar when a cart line is removed', async () => {
    const posState = await import('@/features/sales/usePosState');
    vi.mocked(posState.usePosState).mockReturnValue(createUsePosStateMock({
      lines: [{ id: 'line-1' as LineId, sku: 'SKU-001' as Sku, name: 'Indomie Goreng', category: 'cat-food', qty: 1, unit_price: { minor_units: 3500, currency: 'IDR' } }],
      total: { minor_units: 3500, currency: 'IDR' },
      subtotal: { minor_units: 3500, currency: 'IDR' },
    }));
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => {
      expect(screen.getAllByText('Indomie Goreng').length).toBeGreaterThanOrEqual(1);
    });
    expect(document.querySelector('.retail-undo-bar')).toBeNull();
    const removeBtns = document.querySelectorAll('.retail-cart-remove-btn');
    await userEvent.click(removeBtns[0]!);
    // The undo bar appears with the removed-item count (aria-live status).
    await waitFor(() => {
      const bar = document.querySelector('.retail-undo-bar');
      expect(bar).not.toBeNull();
      expect(bar!.textContent).toMatch(/1 item removed/);
    });
  });

  it('undo restores the removed line with its modifiers and course intact', async () => {
    const posState = await import('@/features/sales/usePosState');
    vi.mocked(posState.usePosState).mockReturnValue(createUsePosStateMock({
      lines: [{
        id: 'line-1' as LineId, sku: 'SKU-001' as Sku, name: 'Indomie Goreng', category: 'cat-food', qty: 1,
        unit_price: { minor_units: 3500, currency: 'IDR' },
        courseId: 'main' as CourseId,
        modifiers: [{ groupId: 'g1', groupName: 'Topping', modifierId: 'm1', modifierName: 'Extra Cheese', priceMinor: 500 }],
      }],
      total: { minor_units: 4000, currency: 'IDR' },
      subtotal: { minor_units: 4000, currency: 'IDR' },
      addProduct: mockAddProduct,
    }));
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => {
      expect(screen.getAllByText('Indomie Goreng').length).toBeGreaterThanOrEqual(1);
    });
    const removeBtns = document.querySelectorAll('.retail-cart-remove-btn');
    await userEvent.click(removeBtns[0]!);
    await waitFor(() => expect(document.querySelector('.retail-undo-bar')).not.toBeNull());
    await userEvent.click(screen.getByRole('button', { name: /^undo$/i }));
    // The exact line — sku, name, price, qty AND its modifiers + course —
    // must be handed back to the state layer, not a bare re-add.
    expect(mockAddProduct).toHaveBeenCalledTimes(1);
    expect(mockAddProduct).toHaveBeenCalledWith(
      expect.objectContaining({ sku: 'SKU-001', name: 'Indomie Goreng', price: { minor_units: 3500, currency: 'IDR' } }),
      1,
      expect.objectContaining({
        courseId: 'main',
        modifiers: [expect.objectContaining({ modifierName: 'Extra Cheese', priceMinor: 500 })],
      }),
    );
  });

  it('dismissing the undo bar discards the removed line without restoring it', async () => {
    const posState = await import('@/features/sales/usePosState');
    vi.mocked(posState.usePosState).mockReturnValue(createUsePosStateMock({
      lines: [{ id: 'line-1' as LineId, sku: 'SKU-001' as Sku, name: 'Indomie Goreng', category: 'cat-food', qty: 1, unit_price: { minor_units: 3500, currency: 'IDR' } }],
      total: { minor_units: 3500, currency: 'IDR' },
      subtotal: { minor_units: 3500, currency: 'IDR' },
    }));
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => {
      expect(screen.getAllByText('Indomie Goreng').length).toBeGreaterThanOrEqual(1);
    });
    const removeBtns = document.querySelectorAll('.retail-cart-remove-btn');
    await userEvent.click(removeBtns[0]!);
    await waitFor(() => expect(document.querySelector('.retail-undo-bar')).not.toBeNull());
    await userEvent.click(screen.getByRole('button', { name: /dismiss undo notification/i }));
    // Dismiss = discard: nothing is re-added, and the bar fades away.
    expect(mockAddProduct).not.toHaveBeenCalled();
    await waitFor(() => expect(document.querySelector('.retail-undo-bar')).toBeNull());
  });
});
