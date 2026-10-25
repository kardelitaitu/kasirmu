// ── RetailPosScreen interaction tests ──────────────────────────────
//
// Covers: long-press quantity picker, SKU/barcode input, barcode
// scanning, shift management, discount modal, clear cart. These
// tests involve userEvent interactions and moderate async waits.
// Split from RetailPosScreen.test.tsx to enable parallel execution. 17 tests.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/__tests__/test-utils/render';
import { createUsePosStateMock } from '@/__tests__/test-utils/mocks/usePosState';
import { mockedBarcode } from '@/__tests__/test-utils/mocks/barcodeScanner';
import { retailProducts } from '@/__tests__/test-utils/mocks/retailPos';
import salesFtl from '@/locales/sales.ftl?raw';
import productsFtl from '@/locales/products.ftl?raw';
import tablesFtl from '@/locales/tables.ftl?raw';
import RetailPosScreen from '@/features/retail/RetailPosScreen';
import type { CourseId, LineId, Sku } from '@/types/domain';
import type { HeldCartRow } from '@/api/sales';

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

// AddProductModal is a real form; driving it here would drag in the whole retail
// harness. A one-button stub that calls the screen's real `addProduct.onSave`
// (RetailPosScreen.tsx:1960) keeps the wiring under test and the form out of it.
vi.mock('@/features/retail/AddProductModal', () => ({
  AddProductModal: (props: {
    isOpen?: boolean;
    onSave?: (p: unknown) => void;
    categories?: readonly { name?: string }[];
  }) =>
    props.isOpen ? (
      <button
        type="button"
        data-testid="stub-add-product-save"
        onClick={() => {
          props.onSave?.({
            sku: 'SKU-NEW',
            name: 'Brand New Product',
            category: props.categories?.[0]?.name ?? 'Makanan',
            price: { minor_units: 1000, currency: 'IDR' },
            barcode: null,
            in_stock: true,
            stock_qty: 10,
            tax_rate_ids: [],
            product_type: 'retail',
          });
        }}
      >
        save new product
      </button>
    ) : null,
}));

// Same treatment for the EDIT modal: a one-button stub that calls the screen's real
// `editProduct.onSave` (RetailPosScreen.tsx:1949), so the optimistic-update wiring is
// under test and the form is not.
vi.mock('@/features/retail/EditProductModal', () => ({
  EditProductModal: (props: { isOpen?: boolean; product?: Record<string, unknown> | null; onSave?: (p: unknown) => void }) =>
    props.isOpen && props.product ? (
      <button
        type="button"
        data-testid="stub-edit-product-save"
        onClick={() => {
          props.onSave?.({ ...props.product, name: 'EDITED NAME', price: { minor_units: 999, currency: 'IDR' } });
        }}
      >
        save edited product
      </button>
    ) : null,
}));

vi.mock('@/api/products', async () => {
  const { createRetailProductsApiMock } =
    await import('@/__tests__/test-utils/mocks/retailPos');
  return createRetailProductsApiMock();
});

vi.mock('@/api/shifts', async () => {
  const { createShiftsApiMock } = await import('@/__tests__/test-utils/mocks/api');
  return createShiftsApiMock({
    // Ok(None) is the bridge's "no shift open" (crates/kasirmu-bridge/src/
    // shifts.rs:346); a REJECTION means the read failed. Modelling "no shift"
    // as a rejection is what made a failed read render as "No shift" and made
    // handlePay's open-shift guard fire for a read that never answered.
    getActiveShiftScoped: vi.fn(() => Promise.resolve(null)),
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
  // The quick-return receipt lookup is NOT part of the shared factory, and its absence is
  // silent: the call resolves to undefined and the handler reads it as "no such sale".
  // Added here so the quick-return cases can run AND count their calls.
  return { ...createSalesApiMock(), lookupSaleByReceiptBarcodeScoped: vi.fn(async () => null) };
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
  // RESTORE EVERY MOCK AFTER EVERY CASE, not at the end of each test body.
  //
  // This file mutates shared module mocks about thirty times (`createProduct.
  // mockRejectedValue`, `updateProduct.mockRejectedValue`, `holdCartScoped.
  // mockImplementation`, ...) and used to undo each one on the LAST LINE of its own test.
  // That only works while every assertion passes: the first throw skipped its cleanup, and
  // the rejection leaked into every later case in the file -- an order-dependent failure
  // whose victim looked unrelated to its cause. Measured 2026-10-25: a full-suite run
  // failed ``does not leave an unsaved product on screen when the add is refused`` once,
  // then passed twice on re-run, while the file passed in isolation every time.
  //
  // `restoreAllMocks` rather than `resetAllMocks`: it also undoes `vi.spyOn` (the
  // requestAnimationFrame pair at :1206) and restores the original module implementations,
  // so a case cannot leave a spy installed for its successor either.
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  // ── The quantity picker accepts any quantity typed into it ─────────
  //
  // `setQtyInput` is handed to the modal RAW as `onInputChange`
  // (RetailPosScreen.tsx:2046) with no validation, and `handleConfirmQty`
  // (:388-402) clamps only the LOWER bound — `Math.max(1, parseInt(...) || 1)`.
  // The stock check at :391-397 is the only other gate and it is SKIPPED for a
  // product whose `stock_qty` is null — every service item, and any product the
  // inventory table does not cover. With it skipped there is nothing left: the
  // typed value goes straight to `addProduct`, the cart, and the server.
  //
  // The money consequence is on screen at RetailModals.tsx:655: the modal's own
  // total multiplies the unit price by that quantity, so the cashier reads a
  // wrong figure before confirming.
  //
  // A STOCKED product does not demonstrate it — the stock guard rejects
  // 999999 on SKU-001 (stock 100) and the case would pass for the wrong reason,
  // the same trap the round-93 popularity fixture fell into. The fixture below
  // removes `stock_qty` so the only thing that can stop the value is a ceiling.
  it('clamps an absurd typed quantity to a sane ceiling', async () => {
    const productsApi = vi.mocked(await import('@/api/products'));
    productsApi.listProductsScoped.mockResolvedValue(
      retailProducts.map((p) => (p.sku === 'SKU-001' ? { ...p, stock_qty: null } : p)),
    );
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('Indomie Goreng')).toBeInTheDocument());

    const productBtn = screen.getByText('Indomie Goreng').closest('button')!;
    fireEvent.pointerDown(productBtn);
    await act(async () => { await new Promise(r => setTimeout(r, 500)); });
    fireEvent.pointerUp(productBtn);
    await waitFor(() => expect(screen.getByDisplayValue('1')).toBeInTheDocument());

    const input = screen.getByDisplayValue('1');
    fireEvent.change(input, { target: { value: '999999' } });
    await userEvent.click(screen.getByText('Add'));

    expect(
      mockAddProduct,
      'a typed quantity of 999999 reached the cart unbounded; clamp it at commit',
    ).toHaveBeenCalled();

    const qty = mockAddProduct.mock.calls[0]![1] as number;
    expect(Number.isInteger(qty), 'the committed quantity must be a whole number').toBe(true);
    expect(qty, 'the committed quantity must have a ceiling').toBeLessThanOrEqual(9999);
  });

  // The same field, and the money it drives. The modal's total line multiplies
  // the unit price by whatever the box holds (RetailModals.tsx:655), so an
  // unbounded value puts a figure on screen the cashier reads as a price before
  // confirming. Asserted as MONEY, because that is what is wrong with it.
  it('shows a bounded total for an absurd typed quantity', async () => {
    const productsApi = vi.mocked(await import('@/api/products'));
    productsApi.listProductsScoped.mockResolvedValue(
      retailProducts.map((p) => (p.sku === 'SKU-001' ? { ...p, stock_qty: null } : p)),
    );
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('Indomie Goreng')).toBeInTheDocument());

    const productBtn = screen.getByText('Indomie Goreng').closest('button')!;
    fireEvent.pointerDown(productBtn);
    await act(async () => { await new Promise(r => setTimeout(r, 500)); });
    fireEvent.pointerUp(productBtn);
    await waitFor(() => expect(screen.getByDisplayValue('1')).toBeInTheDocument());

    // The heading is unique once the modal is up; the product card's own span
    // also carries the name, so the modal is addressed by its class.
    const modal = document.querySelector('.retail-qty-modal')!;
    fireEvent.change(screen.getByDisplayValue('1'), { target: { value: '999999' } });

    // SKU-001 is 3,500 IDR; 999,999 units would total 3,499,996,500 — billions.
    const total = modal.querySelector('.retail-qty-total')?.textContent ?? '';
    expect(total, `the displayed total is unbounded: ${total}`).not.toMatch(/499\.?996/);
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

  it('opens the shift ONCE when the Open button is double-tapped', async () => {
    // Core refuses the replay ("user already has an open shift", db/shifts.rs:95-107), but
    // handleOpenShift's catch is a bare `catch {}` that discards that reason and toasts
    // retail-toast-failed-open-shift -- the cashier is told the drawer failed to open when
    // it opened.
    const { openShiftScoped } = await import('@/api/shifts');
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText(/No shift/)).toBeInTheDocument());
    await userEvent.keyboard('{F9}');
    await userEvent.type(screen.getByLabelText(/Opening balance/), '100000');

    const openBtn = screen.getByText('Open').closest('button') as HTMLButtonElement;
    act(() => {
      openBtn.click();
      openBtn.click();
    });

    await waitFor(() => expect(openShiftScoped).toHaveBeenCalledTimes(1));
  });

  it('looks the receipt up ONCE when the quick-return button is double-tapped', async () => {
    // A read, so nothing is written -- but the second lookup can answer AFTER the first
    // opened the refund modal and re-open it, or toast "not found" over a receipt that was
    // found.
    const salesApi = await import('@/api/sales');
    const lookup = salesApi.lookupSaleByReceiptBarcodeScoped as unknown as ReturnType<typeof vi.fn>;
    expect(lookup, 'the sales mock must expose the receipt lookup').toBeDefined();

    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText(/No shift/)).toBeInTheDocument());
    await userEvent.keyboard('{F11}');

    const input = await waitFor(() => {
      const el = document.querySelector('.retail-quick-return-input') as HTMLInputElement | null;
      expect(el, 'the quick-return input did not open').not.toBeNull();
      return el!;
    });
    fireEvent.change(input, { target: { value: 'RCPT-1' } });

    const submit = document.querySelector('.retail-shift-confirm-btn') as HTMLButtonElement;
    act(() => {
      submit.click();
      submit.click();
    });

    await waitFor(() => expect(lookup).toHaveBeenCalledTimes(1));
  });

  // ── A refund changes the shift totals, so the shift must be RE-READ ──────
  //
  // `ShiftDto` carries the money a refund moves — `totalRefundsMinor`,
  // `totalSalesMinor`, `totalCashMinor` (api/shifts.ts:18-23) — and the retail till
  // read it ONCE, in a mount effect keyed on `sessionToken`. It feeds the close-shift
  // flow (RetailModals:1873), which is where the cashier reconciles the drawer, so
  // after a refund those figures excluded it.
  //
  // ⚠️ WHY THIS IS A SOURCE-LEVEL ASSERTION ON THE HANDLER, and it was written the
  // other way first. The behavioural version drove F11, typed a receipt barcode and
  // waited for the count to rise — and it could not work: `createSalesApiMock`
  // (test-utils/mocks/api.ts) does not provide
  // `lookupSaleByReceiptBarcodeScoped`, so the lookup resolves to undefined, the refund
  // modal never opens, and `onRefunded` never fires. The case failed on "expected 1 to
  // be greater than 1" for the wrong reason — the handler was never reached at all.
  //
  // What actually changed is that the completion handler re-reads. That is stated
  // precisely enough to check, and the re-read itself is covered by the mount path's
  // existing cases.
  it('re-reads the shift when a quick-return refund completes', () => {
    const src = readFileSync(
      resolve(__dirname, '../features/retail/RetailPosScreen.tsx'),
      'utf-8',
    );
    const at = src.indexOf('const handleQuickReturnRefundDone');
    expect(at, 'the refund-completion handler moved — re-point this guard').toBeGreaterThan(0);
    // ⚠️ SLICE TO THE HANDLER'S OWN END, not a character count.
    //
    // This was `at + 700` and the assertion below was FALSE on code that HAS the
    // fix: the handler's own 18-line explanation pushes `loadActiveShift()` to offset
    // ~880. Comments are stripped AFTER the slice, so the window closed before the
    // line being looked for.
    //
    // Identical to the blind guard round 114 found in posDispatchRecord.test.ts
    // (`at + 4200`, outgrown by the comments the fix added). A fixed window is a
    // matcher keyed to proximity, and comments are what grows a handler.
    const start = at;
    const end = src.indexOf('\n  const ', start + 1);
    const body = src.slice(start, end === -1 ? start + 2000 : end);
    const code = body
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');

    // And prove the window contains the handler at all, so it cannot go blind again.
    expect(
      code.includes('setQuickReturnSale(null)'),
      'the scanned window does not contain the handler body — widen it rather than '
      + 'letting this guard pass on an empty match',
    ).toBe(true);

    expect(
      /loadActiveShift\(\)/.test(code),
      'a completed refund changes totalRefundsMinor, so the close-shift flow must read '
      + 'the shift again — it was read once at mount and never refreshed',
    ).toBe(true);
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

  // The retail percentage handler was the copy that drifted from the canonical
  // one at features/sales/hooks/usePosCartActions.ts:206-207. It used
  // `parseFloat` + `Math.min(100, ...)` where the main screen uses
  // `Number` + `!Number.isInteger(pct) || pct < 1 || pct > 100`, so the retail
  // screen accepted a fractional percent the main screen refuses.
  //
  // The consequence is money, not cosmetics: usePosState computes
  // `Math.floor(subtotal.minor_units * (100 - discountPercent) / 100)`
  // (usePosState.ts:228-236), so a fractional percent silently truncates the
  // DISCOUNTED TOTAL and the receipt shows a percent the total does not match.
  // `Math.min(100, ...)` also turned an over-100 entry into a free sale
  // instead of refusing it.
  //
  // The modal input is type="number" with min/max (RetailModals.tsx:494-502),
  // but those attributes are advisory -- they do not prevent a fractional
  // value being typed or pasted -- so the guard has to be in the handler.
  async function openRetailDiscount(setDiscount: ReturnType<typeof vi.fn>) {
    const posState = await import('@/features/sales/usePosState');
    vi.mocked(posState.usePosState).mockReturnValue(createUsePosStateMock({
      lines: [{ id: 'line-1' as LineId, sku: 'SKU-001' as Sku, name: 'Indomie Goreng', category: '', qty: 1, unit_price: { minor_units: 100000, currency: 'IDR' } }],
      total: { minor_units: 100000, currency: 'IDR' },
      subtotal: { minor_units: 100000, currency: 'IDR' },
      setDiscount,
    }));
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    const diskonBtn = await screen.findByRole('button', { name: /^diskon$/i });
    await userEvent.click(diskonBtn);
    return screen.getByRole('spinbutton', { name: /discount/i });
  }
  // ── The qty increase must not pass a STALE absolute value ─────────────
  //
  // `handleIncreaseQty` (RetailPosScreen.tsx:896) computes an ABSOLUTE value from the
  // rendered prop — `updateQty(line.id, line.qty + 1)` — and `updateQty`
  // (usePosState.ts:138) OVERWRITES the row rather than incrementing it:
  //
  //     setLines((prev) => prev.map((l) => (l.id === lineId ? { ...l, qty } : l)))
  //
  // So two taps landing in ONE React batch both close over the same `line.qty` and both
  // write the same value. The second tap is silently swallowed: the cashier presses `+`
  // twice and the cart goes up by one. On a touch till a double-tap is one gesture, so
  // that is the normal case, not an edge.
  //
  // The stock guard directly above (RetailPosScreen.tsx:844) is stale the same way — it
  // tests `line.qty + 1` against remaining stock, so fast taps walk past the limit the
  // guard exists to hold.
  //
  // WHY THE ARGUMENTS ARE THE OBSERVABLE: `usePosState` is mocked here, so `updateQty`
  // is a spy and what the handler DECIDED is visible directly. A suite running the real
  // hook could not tell the difference — a saturating row looks exactly like a correct
  // one — which is why this lives in the mocked-suite rather than a rendering suite.
  it('asks for a rising quantity when + is pressed twice in one batch', async () => {
    const posState = await import('@/features/sales/usePosState');
    const updateQty = vi.fn();
    const changeQty = vi.fn();
    vi.mocked(posState.usePosState).mockReturnValue(createUsePosStateMock({
      changeQty,
      lines: [{
        id: 'line-1' as LineId,
        sku: 'SKU-001' as Sku,
        name: 'Indomie Goreng',
        category: '',
        qty: 1,
        unit_price: { minor_units: 100000, currency: 'IDR' },
      }],
      total: { minor_units: 100000, currency: 'IDR' },
      subtotal: { minor_units: 100000, currency: 'IDR' },
      updateQty,
    }));

    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);

    // One tap first, so the reachability half is settled separately: the handler must
    // reach the write at all, or the batch assertion below passes trivially.
    // Class selector, not a role/name one: the suite's sales.ftl bundle does not
    // translate this aria key, so the accessible name is the raw id and the working
    // cart tests in this file all address the cart by class (:654, :654, :1097).
    const increase = screen.getByRole('button', { name: /Increase quantity/i });
    await userEvent.click(increase);
    await waitFor(() => expect(changeQty).toHaveBeenCalledTimes(1));

    // Now both taps inside a single act(), so React batches them and the second handler
    // closes over the SAME stale `line.qty` — the state a fast double-tap produces.
    await act(async () => {
      increase.click();
      increase.click();
    });

    // The two batched taps must ask for DIFFERENT rising values. A repeated 2,2 is the
    // lost increment: the row would end at qty 2 after two presses.
    // The write is now a DELTA, so each tap asks for the same +1 and `usePosState`'s
    // `changeQty` resolves it inside the `setLines` updater against the committed state.
    // That is what makes two batched taps accumulate: a repeated delta is CORRECT, where
    // a repeated absolute value (2,2) was the lost increment.
    const batched = changeQty.mock.calls.slice(1).map((c) => c[1] as number);
    expect(
      batched,
      'two batched taps did not each ask for one more unit',
    ).toEqual([1, 1]);
    expect(updateQty, 'the handler still writes an absolute quantity, so the stale read can return').not.toHaveBeenCalledWith('line-1', 2);
  });
  it('refuses a fractional percent discount', async () => {
    const setDiscount = vi.fn();
    const input = await openRetailDiscount(setDiscount);
    await userEvent.type(input, '33.7');
    await userEvent.click(screen.getByRole('button', { name: /apply/i }));
    // 33.7 would have become a silent Math.floor on the discounted total.
    expect(setDiscount).not.toHaveBeenCalled();
  });
  it('refuses a percent above 100 instead of clamping it to a free sale', async () => {
    const setDiscount = vi.fn();
    const input = await openRetailDiscount(setDiscount);
    await userEvent.type(input, '150');
    await userEvent.click(screen.getByRole('button', { name: /apply/i }));
    expect(setDiscount).not.toHaveBeenCalled();
  });
  it('refuses a zero percent discount', async () => {
    const setDiscount = vi.fn();
    const input = await openRetailDiscount(setDiscount);
    await userEvent.type(input, '0');
    await userEvent.click(screen.getByRole('button', { name: /apply/i }));
    expect(setDiscount).not.toHaveBeenCalled();
  });
  it('accepts a whole percent of exactly 100', async () => {
    const setDiscount = vi.fn();
    const input = await openRetailDiscount(setDiscount);
    await userEvent.type(input, '100');
    await userEvent.click(screen.getByRole('button', { name: /apply/i }));
    // The boundary must stay ACCEPTED: the guard is an integer check, and a
    // deliberate 100% is a legal free sale, not an error to refuse.
    expect(setDiscount).toHaveBeenCalledWith(100, '');
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

  // MONEY-05: the Rp tab converts a typed AMOUNT into a percent, and
  // usePosState recomputes the money from that percent. So rounding the
  // RATIO -- which is what `Math.round(x * 100) / 100` did -- rounded the MONEY,
  // in both directions. These cases use amounts whose percent does not
  // survive two decimal places, which the 2000/100000 case above does.

  /** Type an Rp discount against a mocked subtotal and return setDiscount. */
  async function applyRpDiscount(subtotalMinor: number, typed: string) {
    const posState = await import('@/features/sales/usePosState');
    const setDiscount = vi.fn();
    vi.mocked(posState.usePosState).mockReturnValue(createUsePosStateMock({
      lines: [{ id: 'line-1' as LineId, sku: 'SKU-001' as Sku, name: 'X', category: '', qty: 1, unit_price: { minor_units: subtotalMinor, currency: 'IDR' } }],
      total: { minor_units: subtotalMinor, currency: 'IDR' },
      subtotal: { minor_units: subtotalMinor, currency: 'IDR' },
      setDiscount,
    }));
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await userEvent.click(await screen.findByRole('button', { name: /^diskon$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^Rp$/i }));
    await userEvent.type(screen.getByRole('spinbutton', { name: /discount \(rp\)/i }), typed);
    await userEvent.click(screen.getByRole('button', { name: /apply/i }));
    return setDiscount;
  }


  // The Rp tab offers an AMOUNT the domain cannot hold, and the tests below
  // pin only the half that is fixable here. Verified across the whole chain:
  //
  //   foundation/src/percentage.rs:38        Percentage(u8)
  //   pos/checkout.rs:246                   discount_percent: i64
  //   pos/preview.rs:176                    checkout_discount_percent -> clamp 0..=100
  //   usePosState.ts:287                     Math.round(percent)
  //
  // so only 5058 of 14955150 (subtotal, amount) pairs up to 50000/300
  // produce a whole percent. This is a domain decision, so these tests do
  // not assert an exact amount is preserved -- they cannot be. They assert
  // the projection itself, which IS this line's responsibility.

  it('projects the exact ratio rather than a two-decimal approximation', async () => {
    // 70 off 40000 is a true 0.175%. Math.round(x * 100) / 100 sent 0.18,
    // and the cart then took 73 off instead of 70.
    const setDiscount = await applyRpDiscount(40000, '70');

    const pct = setDiscount.mock.calls[0]![0] as number;
    expect(pct).toBeCloseTo(0.175, 9);
  });

  it('never projects a discount above what was typed', async () => {
    // The old ratio round could push the projection past the typed amount,
    // which is the direction that costs the cashier money.
    const setDiscount = await applyRpDiscount(40000, '70');
    const pct = setDiscount.mock.calls[0]![0] as number;

    expect(pct * 40000 / 100).toBeLessThanOrEqual(70);
  });

  it('keeps a whole-percent Rp discount exact', async () => {
    // 2000 off 100000 is exactly 2% and must still project to exactly 2.
    const setDiscount = await applyRpDiscount(100000, '2000');
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

  // ── Retail function keys must not fire behind a sub-view ─────────────
  //
  // A sub-view is an early return that REPLACES the screen (RetailPosScreen.tsx
  // :1666 Sales History, :1675 Table Management, :1684 Stock Inquiry; payment is
  // the fourth at :1626). \`isAnyOverlayOpen\` covers the local DIALOGS and none of
  // those, and although the flags sat in the keydown effect's dependency array the
  // handler never READ them — so F1 (Pay) opened the payment dialog for a cart the
  // cashier could not see, and F2/F3/F4 could clear, discount or re-hold it.

  it('does not run retail hotkeys while a sub-view is showing', async () => {
    const posState = await import('@/features/sales/usePosState');
    // A line so the cart is not empty; several keys return early on an empty cart,
    // which would make the assertion below hold for the wrong reason.
    vi.mocked(posState.usePosState).mockReturnValue(
      createUsePosStateMock({
        lines: [
          {
            id: 'line-1' as LineId,
            sku: 'SKU-001' as Sku,
            name: 'Indomie Goreng',
            category: 'cat-food',
            qty: 1,
            unit_price: { minor_units: 3500, currency: 'IDR' },
          },
        ],
        total: { minor_units: 3500, currency: 'IDR' },
        subtotal: { minor_units: 3500, currency: 'IDR' },
      }),
    );
    // F12 → `onNavigate('kds')` is the observable. It is an optional PROP, so a spy
    // here cannot be faked by any other part of the harness, and it needs neither a
    // shift nor a modal — measured: F1 was tried first and is unreachable in this
    // suite because its API mock rejects `getActiveShiftScoped` (:95), so
    // `handlePay` early-returned on the open-shift guard and BOTH the reachability
    // assertion and the negative failed for a reason unrelated to the guard.
    const onNavigate = vi.fn();
    await renderWithProviders(
      <RetailPosScreen onNavigate={onNavigate} />,
      salesFtl, productsFtl, tablesFtl, catFtl,
    );
    await waitFor(() => expect(screen.getAllByText('Indomie Goreng').length).toBeGreaterThan(0));

    // REACHABILITY. F12 must reach the navigator on the SALE view, or the
    // assertion after the sub-view opens proves nothing about the guard.
    await userEvent.keyboard('{F12}');
    await waitFor(() => {
      expect(
        onNavigate.mock.calls.map((c) => c[0]),
        'F12 did not reach onNavigate on the sale view — this test would then measure nothing',
      ).toContain('kds');
    });
    onNavigate.mockClear();

    // Hand the view to Sales History…
    await userEvent.keyboard('{F6}');
    await waitFor(() => expect(screen.getByTestId('sales-history-screen')).toBeInTheDocument());

    // …and the function keys must now be inert. They belong to the sale view; behind
    // a sub-view F1 opened the payment dialog for a cart the cashier could not see.
    await userEvent.keyboard('{F12}');
    await userEvent.keyboard('{F1}');
    await userEvent.keyboard('{F2}');
    expect(
      onNavigate.mock.calls.map((c) => c[0]),
      'F12 navigated away while Sales History owned the view',
    ).not.toContain('kds');
    expect(
      document.querySelector('[data-testid="payment-modal"]'),
      'F1 opened the payment dialog while Sales History owned the view',
    ).toBeNull();
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
    // Annotated so `bill_type: 'hold'` is checked against the `BillType` union.
    const heldCarts: HeldCartRow[] = [
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

  // ── Held-cart resume: a failed delete must not report a successful resume ──

  it('does NOT claim a held cart was resumed when deleting it fails', async () => {
    // handleResumeCart validates every field it reads out of the untrusted
    // cart_data, then ends with an UNGUARDED
    //     await deleteHeldCartScoped(sessionToken, cartId);
    // This flow has no create step to fall back on: the delete IS the commit.
    // When it rejected, the catch toasted "failed to resume" while the cart
    // stayed on the shelf — so the lines were loaded into the till AND the hold
    // survived, which is how one delivery gets sold twice.
    const salesApi = await import('@/api/sales');

    // The default factory returns an EMPTY cart, and `handleHold` opens with
    // `if (lines.length === 0) return;` — so on the shared default F4 is a
    // silent no-op and the held-carts modal can never open. Seed one line.
    const posState = await import('@/features/sales/usePosState');
    vi.mocked(posState.usePosState).mockReturnValue(
      createUsePosStateMock({
        lines: [
          {
            // SKU-001 is the real fixture product (mocks/retailPos.tsx:34), so the
            // cart line and the grid row agree and the modal can open.
            id: 'line-1' as LineId,
            sku: 'SKU-001' as Sku,
            name: 'Indomie Goreng',
            category: 'cat-food',
            qty: 1,
            unit_price: { minor_units: 3500, currency: 'IDR' },
          } as never,
        ],
        subtotal: { minor_units: 3500, currency: 'IDR' },
        total: { minor_units: 3500, currency: 'IDR' },
      }),
    );

    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    // getAllBy: with a cart line seeded, 'Indomie Goreng' now appears in both the
    // product grid and the cart panel.
    await waitFor(() => expect(screen.getAllByText('Indomie Goreng').length).toBeGreaterThanOrEqual(1));

    // TWO holds, not one: handleResume auto-resumes a lone hold without ever
    // showing the list (RetailPosScreen.tsx:1343), so a one-row seed never
    // renders the row button the click below needs.
    vi.mocked(salesApi.listHeldCartsScoped).mockResolvedValue([
      {
        id: 'held-resume',
        label: 'Hold #300',
        item_count: 1,
        total_minor: 5000,
        currency: 'IDR',
        created_at: '2026-01-01T00:00:00Z',
        bill_type: 'hold',
        customer_name: null,
      },
      {
        id: 'held-other',
        label: 'Hold #400',
        item_count: 1,
        total_minor: 7000,
        currency: 'IDR',
        created_at: '2026-01-01T00:00:00Z',
        bill_type: 'hold',
        customer_name: null,
      },
    ]);
    vi.mocked(salesApi.getHeldCartScoped).mockResolvedValue({
      id: 'held-resume',
      label: 'Hold #300',
      item_count: 1,
      total_minor: 3500,
      currency: 'IDR',
      created_at: '2026-01-01T00:00:00Z',
      bill_type: 'hold',
      customer_name: null,
      deduction_location_id: null,
      cart_data: JSON.stringify({
        lines: [{ sku: 'SKU-001', name: 'Indomie Goreng', category: 'cat-food', qty: 1, unit_price: { minor_units: 3500, currency: 'IDR' } }],
      }),
    });

    // Step 1 — hold the seeded cart. This is what sets `heldCartId`, and F4's
    // binding is `if (heldCartId) handleResume(); else handleHold();`
    // (RetailPosScreen.tsx:1513). It also succeeds here, unlike the resume below.
    vi.mocked(salesApi.holdCartScoped).mockResolvedValue({
      id: 'held-resume',
      label: 'Hold #300',
      item_count: 1,
      total_minor: 3500,
      currency: 'IDR',
      created_at: '2026-01-01T00:00:00Z',
      bill_type: 'hold',
      customer_name: null,
    } as never);

    // F4 must be pressed with the SKU input NOT focused: the hotkey handler does
    // `const typing = isEditableTarget(e.target)` and F4 is one of the keys it
    // suppresses while editing, so a focused input swallows the press silently.
    // (F5 cannot help — it FOCUSES the SKU input.)
    (document.activeElement as HTMLElement | null)?.blur?.();
    await userEvent.keyboard('{F4}');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/held/i));

    // Step 2 — F4 again, now resuming. TWO holds make handleResume render the list
    // instead of auto-resuming a lone hold (RetailPosScreen.tsx:1343).
    (document.activeElement as HTMLElement | null)?.blur?.();
    await userEvent.keyboard('{F4}');
    await waitFor(() => expect(screen.getByRole('heading', { name: /held carts/i })).toBeInTheDocument());

    vi.mocked(salesApi.deleteHeldCartScoped).mockRejectedValueOnce(new Error('database is locked'));

    // The resume control is the row body (RetailModals.tsx:690), addressed by
    // its aria-label ('Resume cart') rather than a data-testid — only the
    // delete button has one.
    const resumeBtns = screen.getAllByLabelText('Resume cart');
    expect(resumeBtns.length).toBeGreaterThanOrEqual(1);
    await userEvent.click(resumeBtns[0]!);

    // The failure has to be reported. Assert over ALL alerts: the "Order held"
    // toast from step 1 is still in the stack, so getByRole('alert') would read
    // the stale one and pass the instant a toast exists for any reason.
    await waitFor(() => {
      expect(screen.getAllByRole('alert').map((a) => a.textContent).join(' | ')).toMatch(/resume/i);
    });
    // Exactly one delete attempt, and NO success toast. A "resumed" success
    // message here would be the bug: the delete is the commit, so a rejected
    // delete with a success toast means the cashier rings up goods that are
    // still on hold — one delivery sold twice.
    expect(salesApi.deleteHeldCartScoped).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('alert').map((a) => a.textContent).join(' | ')).not.toMatch(/resumed/i);

    // Restore every mock this test overrode to its documented default
    // (test-utils/mocks/api.ts:74-76). `vi.clearAllMocks()` in the global
    // beforeEach clears CALL HISTORY but not a `mockResolvedValue` implementation,
    // and the @/api/sales mock is module-level, so anything left here leaks into
    // every later test in this file. `getHeldCartScoped` was the one this test
    // added and the sibling delete-confirm test does not restore.
    vi.mocked(salesApi.listHeldCartsScoped).mockResolvedValue([]);
    vi.mocked(salesApi.getHeldCartScoped).mockResolvedValue(null);
    vi.mocked(salesApi.holdCartScoped).mockResolvedValue({ id: 'held-1' } as never);
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

  // ── Held carts must be discoverable after a reload ───────────

  it('surfaces held carts that already exist on the server', async () => {
    // Measured before this test existed: after a reload with three held carts on
    // the server, `listHeldCartsScoped` WAS called (mount effect,
    // RetailPosScreen.tsx:1373) but `heldCartsList` stayed `[]` — that effect sets
    // `heldCartId` only and never the list. The reminder popup renders its
    // held-cart row off `heldCartsList.length` (:1817), so the ONE affordance that
    // tells a cashier "there are carts on hold" could not appear at the start of a
    // shift, which is exactly when it is needed. F4 did not fill the gap either:
    // with a single hold it RESUMES silently instead of listing (see next test).
    const salesApi = await import('@/api/sales');
    vi.mocked(salesApi.listHeldCartsScoped).mockResolvedValue([
      { id: 'h1', label: 'Hold #1', item_count: 1, total_minor: 100, currency: 'IDR', created_at: '2026-01-01T00:00:00Z', bill_type: 'hold', customer_name: null },
      { id: 'h2', label: 'Hold #2', item_count: 1, total_minor: 200, currency: 'IDR', created_at: '2026-01-01T00:00:00Z', bill_type: 'hold', customer_name: null },
      { id: 'h3', label: 'Hold #3', item_count: 1, total_minor: 300, currency: 'IDR', created_at: '2026-01-01T00:00:00Z', bill_type: 'hold', customer_name: null },
    ]);

    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('Indomie Goreng')).toBeInTheDocument());

    await waitFor(() => {
      expect(document.querySelector('.retail-reminder-row--held-cart')).not.toBeNull();
    });

    vi.mocked(salesApi.listHeldCartsScoped).mockResolvedValue([]);
  });

  it('does NOT silently take over a lone hold when the cashier presses F4 to browse', async () => {
    // F4's binding is `if (heldCartId) handleResume(); else handleHold();`
    // (:1513), and `handleResume` auto-resumes when exactly one hold exists
    // (:1343-1345). Combined with the mount effect above — which sets heldCartId
    // from the first hold on the server — pressing F4 to LOOK at held carts on a
    // reloaded till silently loads that hold into the current sale. Measured:
    // `getCalls=1, deleteCalls=0, listModalOpen=false, alerts=[]` — no modal, no
    // confirmation, no toast. Browsing must not be a committing action.
    const salesApi = await import('@/api/sales');
    vi.mocked(salesApi.listHeldCartsScoped).mockResolvedValue([
      { id: 'only', label: 'Hold #only', item_count: 1, total_minor: 100, currency: 'IDR', created_at: '2026-01-01T00:00:00Z', bill_type: 'hold', customer_name: null },
    ]);

    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('Indomie Goreng')).toBeInTheDocument());

    // An EMPTY cart: F4 here is a browse gesture, not an "update my tab" gesture.
    const posState = await import('@/features/sales/usePosState');
    vi.mocked(posState.usePosState).mockReturnValue(createUsePosStateMock());

    (document.activeElement as HTMLElement | null)?.blur?.();
    await userEvent.keyboard('{F4}');
    await new Promise((r) => setTimeout(r, 300));

    // The list must be what opens, and the hold must still be on the server.
    await waitFor(() => {
      expect(document.querySelector('.retail-held-carts-modal')).not.toBeNull();
    });
    expect(salesApi.getHeldCartScoped).not.toHaveBeenCalled();
    expect(salesApi.deleteHeldCartScoped).not.toHaveBeenCalled();

    vi.mocked(salesApi.listHeldCartsScoped).mockResolvedValue([]);
  });

  // ── An optimistic ADD must be rolled back when the create fails ──────
  //
  // `handleSaveNewProduct` (RetailPosScreen.tsx:605) inserts the new product into `products`
  // BEFORE awaiting `createProductScoped` (:606). The catch at :631 toasts and nothing else —
  // it never removes the row.
  //
  // So when the create is refused the operator sees the product in the grid and believes it
  // is saved; it vanishes on the next reload. Same class as the ADR #36 comment at :602-604
  // describes fixing ("previously the product only lived in local React state and vanished
  // on reload"), reintroduced on the FAILURE path.

  // ── A double-tap on Hold must not create two held carts ────────────────
  //
  // `handleHold` (RetailPosScreen.tsx:1302) has no in-flight guard: no saving flag,
  // no ref, no cooldown. It is reachable from two places that both allow a fast
  // repeat — the Hold/Resume function-bar button (:1858/:1877, `disabled` only on an
  // empty cart) and the F4 hotkey (:1587), whose guards cover overlays and typing but
  // not re-entry.
  //
  // A DOM `disabled` cannot help either: React does not re-render between two clicks
  // that land inside one await, so both fire. Two holds for one sale leaves the
  // cashier with a duplicate tab and a cart they then have to find and delete.
  it('does not create a second held cart when Hold is pressed twice in one pass', async () => {
    // Locally imported like the other hold cases in this file: `@/api/sales` is fully
    // mocked here, so a namespace import at module scope is not available.
    const salesApi = await import('@/api/sales');

    // The default factory returns an EMPTY cart, and `handleHold` opens with
    // `if (lines.length === 0) return;` — so on the shared default F4 is a silent no-op
    // and this test would pass on zero writes either way. Seed one line, exactly as the
    // neighbouring hold case documents (:749-751).
    const posState = await import('@/features/sales/usePosState');
    vi.mocked(posState.usePosState).mockReturnValue(
      createUsePosStateMock({
        lines: [
          {
            id: 'line-1' as LineId,
            sku: 'SKU-001' as Sku,
            name: 'Indomie Goreng',
            category: 'cat-food',
            qty: 1,
            unit_price: { minor_units: 3500, currency: 'IDR' },
          } as never,
        ],
        subtotal: { minor_units: 3500, currency: 'IDR' },
        total: { minor_units: 3500, currency: 'IDR' },
      }),
    );

    vi.mocked(salesApi.holdCartScoped).mockResolvedValue({
      id: 'held-1',
      label: 'Hold #1',
      item_count: 1,
      total_minor: 3500,
      currency: 'IDR',
      created_at: '2026-01-01T00:00:00Z',
      bill_type: 'hold',
      customer_name: null,
    } as never);

    renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('Indomie Goreng')).toBeInTheDocument());

    // The way a cashier's second press actually arrives: two F4s back to back with no
    // await between them. The SKU input must not be focused — the handler suppresses
    // F4 while editing.
    (document.activeElement as HTMLElement | null)?.blur?.();
    await userEvent.keyboard('{F4}');
    (document.activeElement as HTMLElement | null)?.blur?.();
    await userEvent.keyboard('{F4}');

    // Wait for the WRITE, not the toast: the toast assertion below would depend on
    // the success path, and what is under test is how many writes fire.
    await waitFor(() => {
      expect(vi.mocked(salesApi.holdCartScoped).mock.calls.length).toBeGreaterThan(0);
    });

    // THE ASSERTION: exactly one hold-cart write for one sale.
    // (Note the two F4s above are separated by userEvent's own await, so the first hold
    // completes and flips `heldCartId` before the second — which routes to handleResume.
    // The synchronous-button path below is the one where two writes can land inside one
    // await, which is what a double-click does.)
    expect(
      vi.mocked(salesApi.holdCartScoped).mock.calls.length,
      'a double-press created more than one held cart',
    ).toBe(1);
    vi.mocked(salesApi.holdCartScoped).mockReset();
  });

  it('does not create a second held cart when the HOLD BUTTON is double-clicked', async () => {
    const salesApi = await import('@/api/sales');
    const posState = await import('@/features/sales/usePosState');
    vi.mocked(posState.usePosState).mockReturnValue(
      createUsePosStateMock({
        lines: [
          {
            id: 'line-1' as LineId,
            sku: 'SKU-001' as Sku,
            name: 'Indomie Goreng',
            category: 'cat-food',
            qty: 1,
            unit_price: { minor_units: 3500, currency: 'IDR' },
          } as never,
        ],
        subtotal: { minor_units: 3500, currency: 'IDR' },
        total: { minor_units: 3500, currency: 'IDR' },
      }),
    );

    // A pending hold for the whole test: the FIRST click never resolves, so the handler is
    // still inside its await when the second click lands. That is the race a real
    // double-click produces and the only way two writes can fire from one cart.
    let release: (() => void) | undefined;
    const gate = new Promise<void>((res) => { release = res; });
    vi.mocked(salesApi.holdCartScoped).mockReset();
    vi.mocked(salesApi.holdCartScoped).mockImplementation((() => gate.then(() => ({
      id: 'held-1', label: 'Hold #1', item_count: 1, total_minor: 3500, currency: 'IDR',
      created_at: '2026-01-01T00:00:00Z', bill_type: 'hold', customer_name: null,
    }))) as never);

    renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('Indomie Goreng')).toBeInTheDocument());

    // Hold/Resume is the function-bar button labelled "Hold" (RetailFnBar.tsx:69-71,
    // key `pos-cart-hold`) — NOT the first .retail-fn-btn, which is Pay.
    const holdBtn = await waitFor(() => {
      const b = Array.from(document.querySelectorAll('.retail-fn-btn'))
        .find((el) => el.textContent?.includes('Hold'));
      expect(b, 'the Hold function-bar button was not found').toBeDefined();
      return b as HTMLElement;
    });

    // Two clicks with NO await between them.
    fireEvent.click(holdBtn!);
    fireEvent.click(holdBtn!);

    expect(
      vi.mocked(salesApi.holdCartScoped).mock.calls.length,
      'a double-click on Hold issued more than one hold write',
    ).toBe(1);

    release?.();
  });
  it('does not leave an unsaved product on screen when the add is refused', async () => {
    // `@/api/products` is fully mocked, so the mock is reached through vi.mocked rather
    // than a namespace import (which the module mock does not provide).
    const productsMod = await import('@/api/products');
    const createProduct = vi.mocked(productsMod.createProductScoped);
    // The create is refused. Everything the screen does AFTER this point is the defect.
    createProduct.mockRejectedValue(new Error('sku already exists'));

    // Render with the same bundle set the other cases use: `catFtl` carries the category
    // names the grid's action bar depends on, so without it the row never appears.
    renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('Indomie Goreng')).toBeInTheDocument());

    // Open the add-product modal through the grid's own control.
    // RetailProductGrid.tsx:590-599 — the label is `retail-add-product-btn-aria`,
    // "Add new product", not the visible "+ Product" the <Localized> wraps.
    const addBtn = await waitFor(() => {
      const candidates = screen.queryAllByRole('button', { name: /add new product/i });
      expect(candidates.length, 'the add-product control was not found').toBeGreaterThan(0);
      return candidates[0]!;
    });
    fireEvent.click(addBtn);

    // Save through the stubbed modal, which calls the screen's real `addProduct.onSave`.
    const saveBtn = await waitFor(() => screen.getByTestId('stub-add-product-save'));
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(createProduct).toHaveBeenCalledTimes(1);
    });

    // THE ASSERTION: a product whose create was refused must not still be on screen.
    await waitFor(() => {
      expect(screen.queryByText('Brand New Product')).not.toBeInTheDocument();
    });

    createProduct.mockReset();
  });

  // ── A new CATEGORY must actually persist ─────────────────────────────
  //
  // `handleSaveNewCategory` (RetailPosScreen.tsx:595-600) appends the category to React
  // state and calls `invalidateCatalog` — it never awaits a WRITE. `createCategoryScoped`
  // (api/products.ts:285) exists and is exported, but a grep over the whole retail feature
  // finds ZERO calls to it.
  //
  // So a category the operator adds is purely local and disappears on the next reload —
  // the exact defect ADR #36 fixed for PRODUCTS ("previously the product only lived in
  // local React state and vanished on reload") and which is still open for categories.
  it('persists a new category instead of only adding it to local state', async () => {
    const productsMod = await import('@/api/products');
    const createCategory = vi.mocked(productsMod.createCategoryScoped);
    createCategory.mockReset();
    createCategory.mockResolvedValue({ id: 'cat-server-1' });

    renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('Indomie Goreng')).toBeInTheDocument());

    // Open the add-category modal through the screen's own control.
    const addCatBtn = await waitFor(() => {
      const b = screen.queryAllByRole('button', { name: /add category|kategori baru|new category/i });
      expect(b.length, 'the add-category control was not found').toBeGreaterThan(0);
      return b[0]!;
    });
    fireEvent.click(addCatBtn);

    // AddCategoryModal.tsx:86-93 — the field is `#add-category-name`. Byte-addressed rather
    // than by role because the POS screen behind the modal also has textboxes.
    const nameInput = await waitFor(() => {
      const el = document.querySelector('#add-category-name');
      expect(el, 'the add-category modal did not open').not.toBeNull();
      return el as HTMLInputElement;
    });
    fireEvent.change(nameInput, { target: { value: 'Kategori Baru' } });
    fireEvent.submit(nameInput.closest('form')!);

    // THE ASSERTION: the category has to reach the server.
    await waitFor(() => {
      expect(createCategory, 'a new category was never sent to the server').toHaveBeenCalledTimes(1);
    });
    expect(createCategory).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ name: 'Kategori Baru' }),
    );
  });

  // ── An optimistic EDIT must be rolled back too ────────────────────────
  //
  // `handleSaveProductEdit` (RetailPosScreen.tsx:547) replaces the product in `products`
  // at :549 and CLOSES the editor at :554, both BEFORE awaiting `updateProductScoped`
  // (:560). The catch at :590 toasts and nothing else — it never restores the old values.
  //
  // So a refused edit leaves the grid showing the operator's new values while the server
  // holds the old ones. The stale row survives until the next reload, and the toast is
  // long gone by then. Same defect as the add path one function over, and `prev` is
  // captured at :548 for exactly this rollback — it was simply never used.
  it('restores the previous product values when the edit is refused', async () => {
    const productsMod = await import('@/api/products');
    const updateProduct = vi.mocked(productsMod.updateProductScoped);
    updateProduct.mockReset();
    updateProduct.mockRejectedValue(new Error('forbidden'));

    renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() => expect(screen.getByText('Indomie Goreng')).toBeInTheDocument());

    // Open the editor for the first product through its own card control.
    const editBtn = await waitFor(() => {
      const b = screen.queryAllByRole('button', { name: /edit indomie goreng/i });
      expect(b.length, 'the edit-product control was not found').toBeGreaterThan(0);
      return b[0]!;
    });
    fireEvent.click(editBtn);

    const saveBtn = await waitFor(() => screen.getByTestId('stub-edit-product-save'));
    fireEvent.click(saveBtn);

    await waitFor(() => expect(updateProduct).toHaveBeenCalledTimes(1));

    // THE ASSERTION: the rejected values must not survive on screen.
    await waitFor(() => {
      expect(screen.queryByText('EDITED NAME')).not.toBeInTheDocument();
    });
    // And the ORIGINAL is back, not merely deleted.
    expect(screen.getByText('Indomie Goreng')).toBeInTheDocument();

    updateProduct.mockReset();
  });

  // ── Resuming a hold must remove it from the browse list it came from ──────
  //
  // `handleResumeCart` ENDS by DELETING the record (RetailPosScreen.tsx:1509) —
  // the delete IS the commit, the same fact the neighbouring 'does NOT claim a
  // held cart was resumed' case documents. What it does NOT do is drop the row
  // from `heldCartsList`, while its sibling `handleDeleteHeldCart` does exactly
  // that (:1553). One state write, two paths, only one of them performing it.
  //
  // TWO CONSEQUENCES, both on the browse path:
  //
  //  1. The reminder popup counts `heldCartsList.length` (:2080) — the one
  //     affordance that says 'there are carts on hold'. After resuming the last
  //     hold it still claims one, and each resume keeps the count inflated by one.
  //  2. The popup's own row opens the modal WITHOUT refetching (:2084, a bare
  //     `setShowHeldCartsList(true)`), so the held carts list shows a cart that no
  //     longer exists on the server. Tapping it calls getHeldCartScoped, which
  //     returns null, and `if (!full) return;` (:1462) exits in silence — no modal
  //     change, no toast, nothing. The cashier taps a row and the UI does nothing,
  //     with no way to learn why.
  //
  // THE FIX MUST NOT BE 'refetch on every open': the mount effect and
  // `showHeldCartList` already own the fetch, and the popup path is deliberately
  // synchronous. Keeping the local list authoritative is the cheaper, correct
  // shape — it is what the delete path already does.
  it('drops a resumed hold from the browse list and the reminder count', async () => {
    const salesApi = await import('@/api/sales');
    const posState = await import('@/features/sales/usePosState');

    // ONE hold: `handleResume` auto-resumes a lone cart (:1534), which is the
    // shortest route through the real resume path.
    vi.mocked(salesApi.listHeldCartsScoped).mockResolvedValue([
      {
        id: 'held-only',
        label: 'Hold #900',
        item_count: 1,
        total_minor: 3500,
        currency: 'IDR',
        created_at: '2026-01-01T00:00:00Z',
        bill_type: 'hold',
        customer_name: null,
      },
    ]);
    vi.mocked(salesApi.getHeldCartScoped).mockResolvedValue({
      id: 'held-only',
      label: 'Hold #900',
      item_count: 1,
      total_minor: 3500,
      currency: 'IDR',
      created_at: '2026-01-01T00:00:00Z',
      bill_type: 'hold',
      customer_name: null,
      deduction_location_id: null,
      cart_data: JSON.stringify({
        lines: [{ sku: 'SKU-001', name: 'Indomie Goreng', category: 'cat-food', qty: 1, unit_price: { minor_units: 3500, currency: 'IDR' } }],
      }),
    });

    // A non-empty cart so the F4 binding routes to `handleResume` rather than the
    // browse branch (`lines.length === 0` -> showHeldCartList), and so `heldCartId`
    // gets set by the resume. SKU-001 is the real fixture product.
    vi.mocked(posState.usePosState).mockReturnValue(
      createUsePosStateMock({
        lines: [
          {
            id: 'line-1' as LineId,
            sku: 'SKU-001' as Sku,
            name: 'Indomie Goreng',
            category: 'cat-food',
            qty: 1,
            unit_price: { minor_units: 3500, currency: 'IDR' },
          } as never,
        ],
        subtotal: { minor_units: 3500, currency: 'IDR' },
        total: { minor_units: 3500, currency: 'IDR' },
      }),
    );

    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);
    await waitFor(() =>
      expect(screen.getAllByText('Indomie Goreng').length).toBeGreaterThanOrEqual(1),
    );

    // BASELINE. The popup counts the one hold the mount effect seeded (:1579).
    await waitFor(() =>
      expect(document.querySelector('.retail-reminder-row--held-cart')).not.toBeNull(),
    );
    expect(
      document.querySelector('.retail-reminder-row--held-cart')!.textContent,
      'baseline: the one seeded hold must be counted',
    ).toMatch(/1/);

    // Resume it. F4 with a non-empty cart and a held id routes to handleResume
    // (:1770), which auto-resumes the lone cart and DELETES it server-side.
    (document.activeElement as HTMLElement | null)?.blur?.();
    await userEvent.keyboard('{F4}');
    await waitFor(() => expect(salesApi.deleteHeldCartScoped).toHaveBeenCalledWith(expect.any(String), 'held-only'));

    // THE ASSERTION. The record is gone from the server, so the browse list and
    // the popup count must not still offer it.
    await waitFor(() => {
      const row = document.querySelector('.retail-reminder-row--held-cart');
      expect(
        row,
        'the resumed hold is deleted server-side but still counted by the ' +
          'reminder popup, so it keeps claiming a cart that no longer exists',
      ).toBeNull();
    });

    // CONSEQUENCE 2, from the same missing write, and it is why the row count
    // matters rather than merely being a cosmetic drift. The popup's held-cart row
    // opens the modal with a BARE `setShowHeldCartsList(true)` (:2084) — no refetch —
    // so the modal renders this same local array. While the stale row survived, that
    // modal listed a cart the server no longer held, and tapping it called
    // getHeldCartScoped, received null, and hit `if (!full) return;` (:1462): no
    // modal change, no toast, no error. A control that does nothing at all, with
    // nothing on screen to explain it.
    //
    // Asserted indirectly, because the F4 browse branch auto-resumes a LONE cart
    // (:1534-38) and so never renders the modal — the same shape the sibling
    // 'does NOT silently take over a lone hold' case documents. The observable is
    // that the popup row, which is the ONLY reachable entry to that modal on an
    // empty-then-refilled till, is gone: there is nothing left to tap.
    expect(
      document.querySelector('.retail-reminder-row--held-cart'),
      'the popup row is the entry to the stale list — with it gone there is no dead ' +
        'control left to tap',
    ).toBeNull();
    vi.mocked(salesApi.listHeldCartsScoped).mockResolvedValue([]);
    vi.mocked(salesApi.getHeldCartScoped).mockResolvedValue(null);
  });
});
