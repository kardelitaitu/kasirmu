// ── RetailPosScreen checkout + navigation tests ───────────────────
//
// Covers: payment modal, full checkout flow with cash payment, F6
// Sales History, F8 Stock Inquiry. These tests involve heavier
// component loading (PaymentModal) and are the most time-consuming.
// Split from RetailPosScreen.test.tsx to enable parallel execution. 8 tests.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/__tests__/test-utils/render';
import { createUsePosStateMock } from '@/__tests__/test-utils/mocks/usePosState';
import { mockedBarcode } from '@/__tests__/test-utils/mocks/barcodeScanner';
import salesFtl from '@/locales/sales.ftl?raw';
import productsFtl from '@/locales/products.ftl?raw';
import tablesFtl from '@/locales/tables.ftl?raw';
import RetailPosScreen from '@/features/retail/RetailPosScreen';
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
    getActiveShift: vi.fn(() => Promise.reject(new Error('no shift'))),
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

describe('RetailPosScreen — checkout & navigation', () => {
  beforeEach(async () => {
    mockedBarcode.reset();
    const sp = await import('@/features/sales/usePosState');
    vi.mocked(sp.usePosState).mockReset();
    vi.mocked(sp.usePosState).mockReturnValue(createUsePosStateMock());
  });

  // ── Payment modal ────────────────────────────────────────────

  it('opens payment modal when Pay is clicked with items and active shift', async () => {
    const posState = await import('@/features/sales/usePosState');
    vi.mocked(posState.usePosState).mockReturnValue(createUsePosStateMock({
      lines: [{ id: 'line-1' as LineId, sku: 'SKU-001' as Sku, name: 'Indomie Goreng', category: '', qty: 1, unit_price: { minor_units: 3500, currency: 'IDR' } }],
      total: { minor_units: 3500, currency: 'IDR' },
      subtotal: { minor_units: 3500, currency: 'IDR' },
    }));
    const shiftsApi = await import('@/api/shifts');
    vi.mocked(shiftsApi.getActiveShiftScoped).mockResolvedValueOnce({
      id: 'shift-1', userId: 'user-1', terminalId: null,
      openedAt: '2026-07-05T08:00:00Z', closedAt: null,
      openingBalanceMinor: 100000, closingBalanceMinor: null,
      expectedCashMinor: null, cashDifferenceMinor: null,
      totalSalesMinor: 50000, totalCashMinor: 40000, totalCardMinor: 10000,
      totalOtherMinor: 0, totalVoidsMinor: 0, totalRefundsMinor: 0,
      totalPayoutsMinor: 0, notes: '', status: 'open',
      createdAt: '2026-07-05T08:00:00Z', updatedAt: '2026-07-05T08:00:00Z',
    });
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    const payBtn = await screen.findByRole('button', { name: /^pay$/i });
    await userEvent.click(payBtn);
    await waitFor(() => expect(screen.getByText(/Payment/)).toBeInTheDocument());
  });

  it('completes full checkout flow with cash payment: add items → pay → tender → complete sale', async () => {
    const posState = await import('@/features/sales/usePosState');
    const addProduct = vi.fn();
    const resetCart = vi.fn();
    vi.mocked(posState.usePosState).mockReturnValue(createUsePosStateMock({
      lines: [{ id: 'line-1' as LineId, sku: 'SKU-001' as Sku, name: 'Indomie Goreng', category: 'cat-food', qty: 1, unit_price: { minor_units: 3500, currency: 'IDR' } }],
      total: { minor_units: 3500, currency: 'IDR' },
      subtotal: { minor_units: 3500, currency: 'IDR' },
      addProduct, resetCart,
    }));
    const shiftsApi = await import('@/api/shifts');
    vi.mocked(shiftsApi.getActiveShiftScoped).mockResolvedValueOnce({
      id: 'shift-1', userId: 'user-1', terminalId: null,
      openedAt: '2026-07-06T08:00:00Z', closedAt: null,
      openingBalanceMinor: 100000, closingBalanceMinor: null,
      expectedCashMinor: null, cashDifferenceMinor: null,
      totalSalesMinor: 0, totalCashMinor: 0, totalCardMinor: 0,
      totalOtherMinor: 0, totalVoidsMinor: 0, totalRefundsMinor: 0,
      totalPayoutsMinor: 0, notes: '', status: 'open',
      createdAt: '2026-07-06T08:00:00Z', updatedAt: '2026-07-06T08:00:00Z',
    });
    const salesApi = await import('@/api/sales');
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    const payBtn = await screen.findByRole('button', { name: /^pay$/i });
    await userEvent.click(payBtn);
    await waitFor(() => expect(screen.getByText(/^Complete$/)).toBeInTheDocument());
    const exactBtn = Array.from(document.querySelectorAll('.payment-quick-btn')).find(
      (btn) => btn.textContent?.includes('Exact'),
    )!;
    await userEvent.click(exactBtn);
    await waitFor(() => expect(screen.getByText(/Change/)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /^Complete$/i }));
    // ReceiptPreview shows after sale completes — verify it rendered
    await waitFor(() => expect(screen.getByText('Print Receipt')).toBeInTheDocument(), { timeout: 5000 });
    await userEvent.click(screen.getByText('Print Receipt'));
    expect(salesApi.completeSaleScoped).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ paymentMethod: 'CASH', tenderedMinor: 3500 }),
    );
    expect(salesApi.printSalesReceipt).toHaveBeenCalled();
  });

  // ── F6 Sales History shortcut ─────────────────────────────────

  it('opens SalesHistoryScreen when F6 is pressed', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('F1')).toBeInTheDocument());
    await userEvent.keyboard('{F6}');
    await waitFor(() => expect(screen.getByTestId('sales-history-screen')).toBeInTheDocument());
    expect(screen.getByText('Sales History')).toBeInTheDocument();
  });

  it('opens SalesHistoryScreen when the F6 button is clicked', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('F1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /F6/i }));
    await waitFor(() => expect(screen.getByTestId('sales-history-screen')).toBeInTheDocument());
  });

  it('dismisses SalesHistoryScreen when the back button is clicked', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('F1')).toBeInTheDocument());
    await userEvent.keyboard('{F6}');
    await waitFor(() => expect(screen.getByTestId('sales-history-screen')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /back/i }));
    await waitFor(() => expect(screen.queryByTestId('sales-history-screen')).not.toBeInTheDocument());
    expect(screen.getByText('F1')).toBeInTheDocument();
  });

  // ── F8 Stock Inquiry shortcut ─────────────────────────────────

  it('opens ProductLookupScreen when F8 is pressed', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('F1')).toBeInTheDocument());
    await userEvent.keyboard('{F8}');
    await waitFor(() => expect(screen.getByTestId('stock-inquiry-screen')).toBeInTheDocument());
    expect(screen.getByText('Stock Inquiry')).toBeInTheDocument();
  });

  it('opens ProductLookupScreen when the F8 button is clicked', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('F1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /F8/i }));
    await waitFor(() => expect(screen.getByTestId('stock-inquiry-screen')).toBeInTheDocument());
  });

  it('dismisses ProductLookupScreen when the back button is clicked', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('F1')).toBeInTheDocument());
    await userEvent.keyboard('{F8}');
    await waitFor(() => expect(screen.getByTestId('stock-inquiry-screen')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /back/i }));
    await waitFor(() => expect(screen.queryByTestId('stock-inquiry-screen')).not.toBeInTheDocument());
    expect(screen.getByText('F1')).toBeInTheDocument();
  });

  // ── Discount flow ──────────────────────────────────────────────

  it('completes checkout with a percentage discount applied', async () => {
    const posState = await import('@/features/sales/usePosState');
    const addProduct = vi.fn();
    const resetCart = vi.fn();
    vi.mocked(posState.usePosState).mockReturnValue(createUsePosStateMock({
      lines: [{ id: 'line-1' as LineId, sku: 'SKU-001' as Sku, name: 'Indomie Goreng', category: 'cat-food', qty: 2, unit_price: { minor_units: 3500, currency: 'IDR' } }],
      total: { minor_units: 6300, currency: 'IDR' },
      subtotal: { minor_units: 7000, currency: 'IDR' },
      discountPercent: 10,
      discountLabel: 'Staff meal',
      discountAmount: { minor_units: 700, currency: 'IDR' },
      addProduct, resetCart,
    }));
    const shiftsApi = await import('@/api/shifts');
    vi.mocked(shiftsApi.getActiveShiftScoped).mockResolvedValueOnce({
      id: 'shift-1', userId: 'user-1', terminalId: null,
      openedAt: '2026-07-06T08:00:00Z', closedAt: null,
      openingBalanceMinor: 100000, closingBalanceMinor: null,
      expectedCashMinor: null, cashDifferenceMinor: null,
      totalSalesMinor: 0, totalCashMinor: 0, totalCardMinor: 0,
      totalOtherMinor: 0, totalVoidsMinor: 0, totalRefundsMinor: 0,
      totalPayoutsMinor: 0, notes: '', status: 'open',
      createdAt: '2026-07-06T08:00:00Z', updatedAt: '2026-07-06T08:00:00Z',
    });
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    const payBtn = await screen.findByRole('button', { name: /^pay$/i });
    await userEvent.click(payBtn);
    await waitFor(() => expect(screen.getByText(/^Complete$/)).toBeInTheDocument());
    // Click Rp10.000 quick-tender button (over-tender by 6500)
    const tenKBtn = Array.from(document.querySelectorAll('.payment-quick-btn')).find(
      (btn) => btn.textContent?.includes('10.000'),
    )!;
    await userEvent.click(tenKBtn);
    // Change is rendered by a useEffect after the tender state updates, so
    // wait for it rather than asserting synchronously — this avoids a known
    // cross-file flake when retail+theme tests share a vitest worker.
    await waitFor(() => expect(screen.getByText(/Change/)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /^Complete$/i }));
    // ReceiptPreview shows after sale completes — verify it rendered
    await waitFor(() => expect(screen.getByText('Print Receipt')).toBeInTheDocument(), { timeout: 5000 });
    await userEvent.click(screen.getByText('Print Receipt'));
  });
});
