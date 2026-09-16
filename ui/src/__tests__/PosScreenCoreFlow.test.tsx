// ── PosScreen TDD: Core Sale Flow (Red → Green → Refactor) ─────────────
//
// Target: Exercise the critical path: add product → cart → pay → complete
// Current coverage: ~52% statements, ~55% branches
// Goal: Push to >80% by covering uncovered branches in this flow

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/__tests__/test-utils/render';
import salesFtl from '@/locales/sales.ftl?raw';
import productsFtl from '@/locales/products.ftl?raw';
import inventoryFtl from '@/locales/inventory.ftl?raw';
import settingsFtl from '@/locales/settings.ftl?raw';
import PosScreen from '@/features/sales/PosScreen';
import type { CartId } from '@/types/domain';
import * as shiftsApi from '@/api/shifts';
import * as settingsApi from '@/api/settings';
import * as salesApi from '@/api/sales';
import * as productsApi from '@/api/products';
import * as kdsApi from '@/api/kds';

import type * as HardwareModule from '@/api/hardware';
import { mockedBarcode } from '@/__tests__/test-utils/mocks/barcodeScanner';

// ── Shared mock setup (same as integration test) ────────────────────────

vi.mock('@/api/hardware', async () => {
  const actual = await vi.importActual<typeof HardwareModule>('@/api/hardware');
  return {
    ...actual,
    listDisplays: vi.fn(() => Promise.resolve([])),
    displayShow: vi.fn(() => Promise.resolve()),
    displayClear: vi.fn(() => Promise.resolve()),
  };
});

vi.mock('@/features/sales/useBarcodeScanner', async () => {
  const { createBarcodeScannerModuleMock } =
    await import('@/__tests__/test-utils/mocks/barcodeScanner');
  return createBarcodeScannerModuleMock();
});

const mockLookupByBarcode = vi.hoisted(() => vi.fn((_code: string) => Promise.resolve(null)));

vi.mock('@/api/products', () => ({
  lookupByBarcode: mockLookupByBarcode,
  lookupByBarcodeScoped: vi.fn((_sessionToken: string, code: string) =>
    mockLookupByBarcode(code),
  ),
  lookupProductBySku: vi.fn((sku: string) => {
    const products: Record<string, unknown> = {
      'ITEM-001': {
        sku: 'ITEM-001',
        name: 'Test Item',
        category: 'Test',
        price: { minor_units: 700, currency: 'USD' },
        barcode: 'BARCODE-001',
        in_stock: true,
        stock_qty: 100,
        tax_rate_ids: [],
        product_type: 'standard',
        created_at: '',
        price_updated_at: '',
      },
      'ITEM-002': {
        sku: 'ITEM-002',
        name: 'Second Item',
        category: 'Test',
        price: { minor_units: 300, currency: 'USD' },
        barcode: 'BARCODE-002',
        in_stock: true,
        stock_qty: 50,
        tax_rate_ids: [],
        product_type: 'standard',
        created_at: '',
        price_updated_at: '',
      },
    };
    return Promise.resolve(products[sku] ?? null);
  }),
  listProducts: vi.fn(() => Promise.resolve([
    {
      sku: 'ITEM-001',
      name: 'Test Item',
      category: 'Test',
      price: { minor_units: 700, currency: 'USD' },
      barcode: 'BARCODE-001',
      in_stock: true,
      stock_qty: 100,
      tax_rate_ids: [],
      product_type: 'standard',
      created_at: '',
      price_updated_at: '',
    },
    {
      sku: 'ITEM-002',
      name: 'Second Item',
      category: 'Test',
      price: { minor_units: 300, currency: 'USD' },
      barcode: 'BARCODE-002',
      in_stock: true,
      stock_qty: 50,
      tax_rate_ids: [],
      product_type: 'standard',
      created_at: '',
      price_updated_at: '',
    },
  ])),
  listCategories: vi.fn(() => Promise.resolve([])),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  deleteProduct: vi.fn(),
  adjustStock: vi.fn(),
  listProductVariants: vi.fn(() => Promise.resolve([])),
  getProductVariant: vi.fn(() => Promise.resolve(null)),
  createProductVariant: vi.fn(),
  updateProductVariant: vi.fn(),
  deleteProductVariant: vi.fn(),
  createCategory: vi.fn(),
  deleteCategory: vi.fn(),
}));

vi.mock('@/api/bundles', () => ({
  lookupBundleBySku: vi.fn(() => Promise.resolve(null)),
  listBundles: vi.fn(() => Promise.resolve([])),
  getBundle: vi.fn(() => Promise.resolve(null)),
  createBundle: vi.fn(),
  updateBundle: vi.fn(),
  deleteBundle: vi.fn(),
}));

vi.mock('@/api/shifts', async () => {
  const { createShiftsApiMock } = await import('@/__tests__/test-utils/mocks/api');
  return createShiftsApiMock();
});

vi.mock('@/api/settings', async () => {
  const { createSettingsApiMock } = await import('@/__tests__/test-utils/mocks/api');
  return createSettingsApiMock();
});

vi.mock('@/api/sales', async () => {
  const { createSalesApiMock } = await import('@/__tests__/test-utils/mocks/api');
  return createSalesApiMock();
});

// The two createKdsOrderFromSale* entries used to live in the @/api/sales mock
// above, which did nothing: @/api/sales exports neither of them (36 exports,
// checked), and PaymentModal.tsx:10 imports them from @/api/kds -- the module this
// file never mocked. So the mock configured a surface nobody read from, while the
// real module ran and threw on every checkout, swallowed by the caller's .catch.
// Same root cause as the retail factory: a mock attached to the wrong module looks
// like coverage and provides none.
vi.mock('@/api/kds', async (importOriginal) => {
  const { createKdsApiMock } = await import('@/__tests__/test-utils/mocks/api');
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  return { ...(await importOriginal<typeof import('@/api/kds')>()), ...createKdsApiMock() };
});

vi.mock('@/api/tax', () => ({
  computeCartTax: vi.fn(() => Promise.resolve({ taxMinor: 0, hasExclusive: false })),
}));

vi.mock('@/utils/interaction', () => ({
  triggerInteraction: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', async () => {
  const { createAuthContextMock } = await import('@/__tests__/test-utils/mocks/contexts');
  return {
    useAuth: createAuthContextMock({ isManager: true }),
  };
});

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    activeWorkspace: 'store-pos',
    setActiveWorkspace: vi.fn(),
    activeInstance: null,
    setActiveInstance: vi.fn(),
    availableWorkspaces: [],
    workspaceScreens: [],
    loading: false,
    error: null,
    retry: vi.fn(),
    lastWorkspace: null,
    switchStore: vi.fn(),
    resolvedStoreId: 'default',
    sessionToken: 'mock-session-token',
    swapSessionToken: vi.fn(),
    terminalId: '',
  }),
  useWorkspaceScope: () => ({
    storeId: 'default',
    instanceId: 'default',
    typeKey: 'store-pos',
  }),
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks/useFeatures', () => ({
  useFeatures: () => ({
    enabled: new Set<string>(),
    loading: false,
    isEnabled: () => true,
    loaded: true,
    filterRoutes: (routes: string[]) => routes,
    error: null,
  }),
  FEATURES: {
    KITCHEN_DISPLAY: 'kitchen-display',
    TABLE_MANAGEMENT: 'table-management',
    USB_SCALE: 'usb-scale',
    MULTI_LOCATION: 'multi-location',
    QUICK_RETURN: 'quick-return',
    SERIAL_TRACKING: 'serial-tracking',
  } as const,
}));

// ── Test fixtures ──────────────────────────────────────────────────────

function shiftFixture(openedAt?: Date) {
  const date = openedAt ?? new Date();
  return {
    id: 'shift-1',
    userId: 'user-1',
    terminalId: null,
    openedAt: date.toISOString(),
    closedAt: null,
    openingBalanceMinor: 0,
    closingBalanceMinor: null,
    expectedCashMinor: null,
    cashDifferenceMinor: null,
    totalSalesMinor: 0,
    totalCashMinor: 0,
    totalCardMinor: 0,
    totalOtherMinor: 0,
    totalVoidsMinor: 0,
    totalRefundsMinor: 0,
    totalPayoutsMinor: 0,
    notes: '',
    status: 'open' as const,
    createdAt: date.toISOString(),
    updatedAt: date.toISOString(),
  };
}

const receiptSettingsFixture = {
  showCurrency: true,
  decimalSeparator: '.',
  showTax: true,
  footer: '',
  paperWidth: '80mm',
  showTableNumber: false,
  marginTop: 0,
  marginBottom: 0,
  marginLeft: 0,
  marginRight: 0,
  taxRoundingMode: 'half_up',
};

// Additional FTL strings for the core flow
const testCoreFtl = `
pos-shift-loading = Loading shift…
pos-shift-elapsed = { \$h }h { \$m }m
pos-shift-no-active = No active shift
pos-shift-open-btn = Open Shift
pos-shift-open-aria = Open shift
pos-shift-close-btn = Close Shift
pos-shift-close-aria = Close shift
pos-cart-lock = Lock
pos-cart-open-bill = Open Bill
pos-cart-open-bill-aria = Open Bill
pos-cart-open-bills = Open Bills
pos-cart-open-bills-aria = Open Bills
pos-cart-clear = Clear
pos-cart-clear-aria = Clear cart
pos-cart-pay = Charge
pos-cart-charge-aria = Charge
pos-cart-empty = Cart is empty
pos-cart-empty-subtitle = Tap a menu item to start the order
pos-cart-panel-title = Current Sale
pos-cart-panel-title-order = Current Order
pos-cart-panel-aria = Cart
pos-cart-line-aria = { \$sku }, { \$qty } × { \$amount }
pos-cart-line-override-aria = Override price for { \$name }
pos-cart-line-decrease-aria = Decrease quantity for { \$sku }
pos-cart-line-increase-aria = Increase quantity for { \$sku }
pos-cart-line-remove-aria = Remove { \$sku }
pos-cart-line-swipe-remove-aria = Remove { \$sku }
pos-cart-deduction-badge-aria = Deduction location: { \$name }
pos-cart-deducting-label = Deducting: { \$name }
pos-dismiss-error-aria = Dismiss error
pos-close-shift-cart-error = Cart is not empty. Close or complete the sale first.
pos-close-shift-failed = Failed to close shift
pos-toast-receipt-settings-failed = Failed to load receipt settings
pos-bundle-expanded = Bundle "{ \$name }" added — { \$count } items
pos-no-barcode-match = No product or bundle matches this barcode
pos-scanner-error = Scanner error: { \$detail }
pos-close-shift-title = Close Shift
pos-close-shift-closing = Closing…
pos-close-shift-confirm = Close Shift
pos-close-shift-opening = Opening…
pos-close-shift-opening-balance = Opening Balance
pos-close-shift-opening-balance-placeholder = Enter opening balance
pos-open-shift-title = Open Shift
pos-open-shift-opening-balance = Opening Balance
pos-open-shift-opening-balance-placeholder = Enter opening balance
pos-close-shift-notes-label = Notes (optional)
pos-close-shift-notes-placeholder = Any notes about this shift…
pos-close-shift-notes-aria = Shift notes
pos-close-shift-summary-label = { \$label }
pos-close-shift-summary-value = { \$value }
pos-shift-closed-title = Shift Closed
pos-shift-total-sales = Total Sales
pos-shift-cash-sales = Cash Sales
pos-shift-card-sales = Card Sales
pos-shift-expected-cash = Expected Cash
pos-shift-counted = Counted
pos-shift-difference = Difference
pos-shift-over = Over
pos-shift-short = Short
pos-shift-notes = Notes
pos-shift-summary-done = Done
tables-title = Table Management
retail-fn-history = Sales History
retail-fn-stok = Stock Inquiry
kds-title = Kitchen Display
settings-page-title = Settings
pos-cart-subtotal = Subtotal
pos-cart-options-expand-aria = Show discount, tip, service charge
pos-cart-options-collapse-aria = Hide discount, tip, service charge
payment-done-title = Sale Complete
payment-done-receipt = Receipt printed
payment-change-label = Change due
payment-done-note = Receipt printed
pos-cart-discount-label = Discount ({ \$label })
pos-cart-discount-remove-aria = Remove discount
pos-cart-add-discount = + Add Discount
pos-cart-pct-placeholder = %
pos-cart-label-placeholder = Label (optional)
pos-cart-discount-pct-aria = Discount percentage
pos-cart-discount-label-aria = Discount label
pos-cart-apply = Apply
pos-cart-cancel = Cancel
pos-cart-discount-cancel-aria = Cancel discount
pos-cart-tip-label = Add Tip
pos-cart-tip-aria = Tip percentage
pos-cart-tip-segment-zero-aria = No tip
pos-cart-tip-segment-aria = { \$percent }% tip
pos-cart-tip-line = Tip ({ \$percent }%)
pos-cart-service-toggle-aria = Toggle service charge
pos-cart-service-toggle-label = Add { \$percent }% service charge
pos-cart-service-line = Service ({ \$percent }%)
pos-cart-clear-aria = Clear cart
pos-cart-open-bill-aria = Open Bill
pos-cart-open-bills-aria = Open Bills
pos-cart-undo-btn = Undo
pos-cart-undo-dismiss-aria = Dismiss undo
payment-title = Complete Order
payment-amount-tendered = Amount Tendered
payment-complete = Complete
payment-cancel = Cancel
payment-print = Print
payment-skip = Skip
sale-complete = Sale Complete
payment-method-cash = Cash
payment-method-card = Card
payment-method-qris = QRIS
payment-method-credit = Credit
payment-method-open-bill = Open Bill
payment-qr-reference-placeholder = QR reference
payment-qr-upgrade = QRIS payments are a Plus feature. Upgrade to Plus to accept QRIS.
payment-customer-placeholder = e.g. John Doe
payment-loyalty-points-label = Points
pos-cart-table-label = Table
pos-cart-table-aria = Table number
pos-cart-table-placeholder = Table number
pos-cart-discount-form = Discount form
pos-cart-discount-btn = + Add Discount
pos-cart-discount-apply = Apply
pos-cart-discount-cancel = Cancel
pos-cart-discount-clear = ×
payment-shortfall-cancelled = Payment cancelled
payment-shortfall-title = Shortfall
payment-shortfall-message = Tendered amount is less than total
payment-shortfall-retry = Retry
payment-shortfall-cancel = Cancel
`;

// ── Test helpers ───────────────────────────────────────────────────────

async function renderPosScreenWithShift(openedAt?: Date) {
  vi.mocked(shiftsApi.getActiveShiftScoped).mockResolvedValueOnce(shiftFixture(openedAt));
  vi.mocked(settingsApi.getReceiptSettingsScoped).mockResolvedValueOnce(receiptSettingsFixture);
  vi.mocked(salesApi.startSaleScoped).mockResolvedValue({
    cartId: 'test-cart-1' as CartId,
    deductionLocationId: 'loc-store-inventory',
  });
  vi.mocked(salesApi.getCartDeductionLocation).mockResolvedValue({
    locationId: 'loc-store-inventory',
    locationName: 'Store Inventory',
  });
  // Mock completeSale for payment flow
  vi.mocked(salesApi.completeSaleScoped).mockResolvedValue({
    saleId: 'sale-1',
    total: { minor_units: 1000, currency: 'USD' },
    lineCount: 1,
  });
  // Mock finalizeSale
  vi.mocked(salesApi.finalizeSale).mockResolvedValue(undefined);
  // Mock getSale for receipt
  vi.mocked(salesApi.getSale).mockResolvedValue({
    id: 'sale-1',
    subtotal: { minor_units: 700, currency: 'USD' },
    total: { minor_units: 1000, currency: 'USD' },
    taxTotal: { minor_units: 0, currency: 'USD' },
    lineCount: 1,
    status: 'completed',
    paymentMethod: 'cash',
    tenderedMinor: 1000,
    userId: null,
    lines: [{
      id: 'line-1',
      sku: 'ITEM-001',
      name: 'Test Item',
      qty: 1,
      unit_price: { minor_units: 700, currency: 'USD' },
      total_minor: 700,
      tax_amount: { minor_units: 0, currency: 'USD' },
      tax_rate_id: null,
    }],
    createdAt: new Date().toISOString(),
  });
  vi.mocked(salesApi.printSalesReceipt).mockResolvedValue({ printed: true });

  return renderWithProviders(
    <PosScreen />,
    salesFtl,
    productsFtl,
    inventoryFtl,
    settingsFtl,
    testCoreFtl,
  );
}

// ── TEST: Core Sale Flow (RED - should fail initially) ─────────────────

describe('PosScreen — Core Sale Flow (TDD)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockedBarcode.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('adds product to cart, opens payment, completes cash sale, resets cart', async () => {
    // 1. Render with active shift
    await renderPosScreenWithShift();

    // Wait for shift to load - shows "0m" for elapsed time
    await waitFor(() => {
      expect(screen.getByText('0m')).toBeInTheDocument();
    });

    // 2. Add product via barcode scan (simulates clicking product card)
    // First, scan a product barcode
    vi.mocked(productsApi.lookupByBarcodeScoped).mockResolvedValueOnce({
      sku: 'ITEM-001',
      name: 'Test Item',
      category: 'Test',
      price: { minor_units: 700, currency: 'USD' },
      barcode: 'BARCODE-001',
      in_stock: true,
      stock_qty: 100,
      tax_rate_ids: [],
      product_type: 'standard',
      created_at: '',
      price_updated_at: '',
    });

    // Debug: check barcode scanner is registered
    await waitFor(() => {
      console.log('Barcode scanner mock:', mockedBarcode.useBarcodeScanner);
      console.log('Barcode scanner calls:', mockedBarcode.useBarcodeScanner.mock.calls);
    }, { timeout: 2000 });

    await act(async () => {
      mockedBarcode.triggerScan('BARCODE-001');
    });

    // 3. Verify product added to cart (check cart panel specifically)
    await waitFor(() => {
      const cartLine = screen.getByTestId('cart-panel-line-item');
      expect(cartLine).toBeInTheDocument();
      expect(cartLine.textContent).toContain('Test Item');
    });

    // 4. Verify subtotal shows $7.00 (format uses comma for decimal in some locales)
    await waitFor(() => {
      // Subtotal is in the options toggle button - find by class
      const optionsToggle = document.querySelector('.pos-cart-options-toggle');
      expect(optionsToggle).toBeInTheDocument();
      expect(optionsToggle?.textContent).toContain('$');
      expect(optionsToggle?.textContent).toContain('7');
    });

    // 5. Click Pay button (Charge) - use the one in the cart footer
    const payButtons = screen.getAllByRole('button', { name: /charge/i });
    await userEvent.click(payButtons[payButtons.length - 1]!);

    // 6. Verify PaymentModal opens - debug
    await waitFor(() => {
      console.log('After charge click:', document.body.innerHTML?.includes('Complete Order'));
      console.log('showPayment state check:', document.body.innerHTML?.includes('payment-overlay'));
    }, { timeout: 2000 });

    await waitFor(() => {
      expect(screen.getByText('Complete Order')).toBeInTheDocument();
    });

    // 7. Enter amount tendered ($10.00)
    const tenderedInput = screen.getByLabelText(/amount tendered/i);
    await userEvent.type(tenderedInput, '10.00');

    // 8. Click Complete
    const completeBtn = screen.getByRole('button', { name: /^complete$/i });
    await userEvent.click(completeBtn);

    // 9. Wait for ReceiptPreview to appear, then click Skip
    await waitFor(() => {
      expect(screen.getByText('Skip')).toBeInTheDocument();
    });

    const skipBtn = screen.getByRole('button', { name: /skip/i });
    await userEvent.click(skipBtn);

    // 10. Verify sale completes - cart should be reset to empty
    await waitFor(() => {
      expect(screen.getByText('Cart is empty')).toBeInTheDocument();
    }, { timeout: 5000 });

    // 11. Verify shift is still open
    expect(screen.getByText('0m')).toBeInTheDocument();

    // 10. Verify cart is reset (empty state)
    await waitFor(() => {
      expect(screen.getByText('Cart is empty')).toBeInTheDocument();
    });

    // 11. Verify shift is still open
    expect(screen.getByText('0m')).toBeInTheDocument();

    // 12. The kitchen ticket must actually be requested. This assertion could not
    // pass before: the two createKdsOrderFromSale* mocks sat on the @/api/sales
    // module, which exports neither, while @/api/kds -- the module PaymentModal
    // really imports from -- was left unmocked. So the real module ran and threw
    // on every checkout, and PaymentModal's catch took its FAILURE branch
    // (console.error plus the payment-toast-kds-failed warning). Every sale in
    // this file was therefore validating the "kitchen ticket failed" path while
    // reading as a clean checkout.
    //
    // Covers the cash path (PaymentModal.tsx:1030). The QR path (:756) is a
    // separate branch with its own catch, and is NOT covered here -- removing one
    // call site leaves this test green, confirmed by sabotage.
    await waitFor(() => {
      expect(kdsApi.createKdsOrderFromSaleScoped).toHaveBeenCalledWith(
        expect.any(String),
        'sale-1',
      );
    });
    // And the failure toast must NOT have fired, otherwise the assertion above
    // passed while the branch under test was still the error path.
    expect(screen.queryByText('payment-toast-kds-failed')).toBeNull();
  });

  it('adds multiple products, shows correct subtotal, opens payment', async () => {
    await renderPosScreenWithShift();

    await waitFor(() => {
      expect(screen.getByText('0m')).toBeInTheDocument();
    });

    // Add first product
    vi.mocked(productsApi.lookupByBarcodeScoped).mockResolvedValueOnce({
      sku: 'ITEM-001',
      name: 'Test Item',
      category: 'Test',
      price: { minor_units: 700, currency: 'USD' },
      barcode: 'BARCODE-001',
      in_stock: true,
      stock_qty: 100,
      tax_rate_ids: [],
      product_type: 'standard',
      created_at: '',
      price_updated_at: '',
    });

    await act(async () => {
      mockedBarcode.triggerScan('BARCODE-001');
    });

    // Verify product added to cart
    await waitFor(() => {
      const cartLine = screen.getByTestId('cart-panel-line-item');
      expect(cartLine).toBeInTheDocument();
      expect(cartLine.textContent).toContain('Test Item');
    });

    // Add second product
    vi.mocked(productsApi.lookupByBarcodeScoped).mockResolvedValueOnce({
      sku: 'ITEM-002',
      name: 'Second Item',
      category: 'Test',
      price: { minor_units: 300, currency: 'USD' },
      barcode: 'BARCODE-002',
      in_stock: true,
      stock_qty: 50,
      tax_rate_ids: [],
      product_type: 'standard',
      created_at: '',
      price_updated_at: '',
    });

    await act(async () => {
      mockedBarcode.triggerScan('BARCODE-002');
    });

    // Verify second product added
    await waitFor(() => {
      const cartLines = screen.getAllByTestId('cart-panel-line-item');
      expect(cartLines.length).toBe(2);
      expect(cartLines[1]!.textContent).toContain('Second Item');
    });

    // Verify subtotal is $10.00 (700 + 300 = 1000 minor units)
    await waitFor(() => {
      const optionsToggle = document.querySelector('.pos-cart-options-toggle');
      expect(optionsToggle).toBeInTheDocument();
      expect(optionsToggle?.textContent).toContain('$');
      expect(optionsToggle?.textContent).toContain('10');
    });

    // Open payment
    const payButtons = screen.getAllByRole('button', { name: /charge/i });
    await userEvent.click(payButtons[payButtons.length - 1]!);

    // Wait for payment modal to appear
    await waitFor(() => {
      expect(screen.getByText('Complete Order')).toBeInTheDocument();
    }, { timeout: 5000 });

    // Verify total in payment modal matches - payment total is in .payment-total-amount
    await waitFor(() => {
      const paymentTotal = document.querySelector('.payment-total-amount');
      expect(paymentTotal).toBeInTheDocument();
      expect(paymentTotal?.textContent).toContain('$');
      expect(paymentTotal?.textContent).toContain('10');
    });
  });

  it('rejects adding product when no shift is open', async () => {
    // Render without shift
    vi.mocked(shiftsApi.getActiveShiftScoped).mockResolvedValueOnce(null);
    vi.mocked(settingsApi.getReceiptSettingsScoped).mockResolvedValueOnce(receiptSettingsFixture);

    await renderWithProviders(
      <PosScreen />,
      salesFtl,
      productsFtl,
      inventoryFtl,
      settingsFtl,
      testCoreFtl,
    );

    // Try to scan a product
    vi.mocked(productsApi.lookupByBarcodeScoped).mockResolvedValueOnce({
      sku: 'ITEM-001',
      name: 'Test Item',
      category: 'Test',
      price: { minor_units: 700, currency: 'USD' },
      barcode: 'BARCODE-001',
      in_stock: true,
      stock_qty: 100,
      tax_rate_ids: [],
      product_type: 'standard',
      created_at: '',
      price_updated_at: '',
    });

    await act(async () => {
      mockedBarcode.triggerScan('BARCODE-001');
    });

    // Should show warning toast
    await waitFor(() => {
      expect(screen.getByText(/open a shift first/i)).toBeInTheDocument();
    });

    // Cart should remain empty
    expect(screen.getByText('Cart is empty')).toBeInTheDocument();
  });

  // ── Discount Tests ────────────────────────────────────────────────────

  it('applies discount and shows discount row', async () => {
    await renderPosScreenWithShift();

    await waitFor(() => {
      expect(screen.getByText('0m')).toBeInTheDocument();
    });

    // Add product
    vi.mocked(productsApi.lookupByBarcodeScoped).mockResolvedValueOnce({
      sku: 'ITEM-001',
      name: 'Test Item',
      category: 'Test',
      price: { minor_units: 700, currency: 'USD' },
      barcode: 'BARCODE-001',
      in_stock: true,
      stock_qty: 100,
      tax_rate_ids: [],
      product_type: 'standard',
      created_at: '',
      price_updated_at: '',
    });

    await act(async () => {
      mockedBarcode.triggerScan('BARCODE-001');
    });

    await waitFor(() => {
      const cartLine = screen.getByTestId('cart-panel-line-item');
      expect(cartLine).toBeInTheDocument();
    });

    // Click + Add Discount button
    const addDiscountBtn = screen.getByRole('button', { name: /add discount/i });
    await userEvent.click(addDiscountBtn);

    // Enter discount percentage (10%)
    const pctInput = screen.getByPlaceholderText('%');
    await userEvent.type(pctInput, '10');

    // Click Apply
    const applyBtn = screen.getByRole('button', { name: /apply/i });
    await userEvent.click(applyBtn);

    // Verify discount row appears
    await waitFor(() => {
      expect(screen.getByText((content) => content.includes('Discount') && content.includes('10%'))).toBeInTheDocument();
    });

    // Verify discount row shows the discount amount (10% of $7,00 = $0,70)
    await waitFor(() => {
      const discountRow = document.querySelector('.pos-cart-discount-row');
      expect(discountRow).toBeInTheDocument();
      expect(discountRow?.textContent).toContain('0,70');
    });
  });

  it('clears discount when Clear Discount button clicked', async () => {
    await renderPosScreenWithShift();

    await waitFor(() => {
      expect(screen.getByText('0m')).toBeInTheDocument();
    });

    // Add product
    vi.mocked(productsApi.lookupByBarcodeScoped).mockResolvedValueOnce({
      sku: 'ITEM-001',
      name: 'Test Item',
      category: 'Test',
      price: { minor_units: 700, currency: 'USD' },
      barcode: 'BARCODE-001',
      in_stock: true,
      stock_qty: 100,
      tax_rate_ids: [],
      product_type: 'standard',
      created_at: '',
      price_updated_at: '',
    });

    await act(async () => {
      mockedBarcode.triggerScan('BARCODE-001');
    });

    await waitFor(() => {
      const cartLine = screen.getByTestId('cart-panel-line-item');
      expect(cartLine).toBeInTheDocument();
    });

    // Click + Add Discount button
    const addDiscountBtn = screen.getByRole('button', { name: /add discount/i });
    await userEvent.click(addDiscountBtn);

    // Enter discount percentage (10%)
    const pctInput = screen.getByPlaceholderText('%');
    await userEvent.type(pctInput, '10');

    // Click Apply
    const applyBtn = screen.getByRole('button', { name: /apply/i });
    await userEvent.click(applyBtn);

    await waitFor(() => {
      expect(screen.getByText((content) => content.includes('Discount') && content.includes('10%'))).toBeInTheDocument();
    });

    // Click Clear Discount (× button)
    const clearBtn = screen.getByRole('button', { name: /remove discount/i });
    await userEvent.click(clearBtn);

    // Verify discount row is gone
    await waitFor(() => {
      expect(screen.queryByText((content) => content.includes('Discount') && content.includes('10%'))).not.toBeInTheDocument();
    });

    // Verify discount row is gone
    await waitFor(() => {
      const discountRow = document.querySelector('.pos-cart-discount-row');
      expect(discountRow).not.toBeInTheDocument();
    });
  });

  // ── Tip Tests ────────────────────────────────────────────────────────

  it('selects tip percentage and shows tip preview', async () => {
    await renderPosScreenWithShift();

    await waitFor(() => {
      expect(screen.getByText('0m')).toBeInTheDocument();
    });

    // Add product
    vi.mocked(productsApi.lookupByBarcodeScoped).mockResolvedValueOnce({
      sku: 'ITEM-001',
      name: 'Test Item',
      category: 'Test',
      price: { minor_units: 700, currency: 'USD' },
      barcode: 'BARCODE-001',
      in_stock: true,
      stock_qty: 100,
      tax_rate_ids: [],
      product_type: 'standard',
      created_at: '',
      price_updated_at: '',
    });

    await act(async () => {
      mockedBarcode.triggerScan('BARCODE-001');
    });

    await waitFor(() => {
      const cartLine = screen.getByTestId('cart-panel-line-item');
      expect(cartLine).toBeInTheDocument();
    });

    // Click 15% tip button (matches both test FTL '15% tip' and real FTL 'Set tip to 15 percent')
    const tipBtn = screen.getByRole('button', { name: /15/i });
    await userEvent.click(tipBtn);

    // Verify tip preview row appears (text split across elements)
    await waitFor(() => {
      const tipRow = document.querySelector('.pos-cart-tip-preview-row');
      expect(tipRow).toBeInTheDocument();
      expect(tipRow?.textContent).toContain('Tip (15%)');
      expect(tipRow?.textContent).toContain('+');
    });
  });

  it('removes tip when None selected', async () => {
    await renderPosScreenWithShift();

    await waitFor(() => {
      expect(screen.getByText('0m')).toBeInTheDocument();
    });

    // Add product
    vi.mocked(productsApi.lookupByBarcodeScoped).mockResolvedValueOnce({
      sku: 'ITEM-001',
      name: 'Test Item',
      category: 'Test',
      price: { minor_units: 700, currency: 'USD' },
      barcode: 'BARCODE-001',
      in_stock: true,
      stock_qty: 100,
      tax_rate_ids: [],
      product_type: 'standard',
      created_at: '',
      price_updated_at: '',
    });

    await act(async () => {
      mockedBarcode.triggerScan('BARCODE-001');
    });

    await waitFor(() => {
      const cartLine = screen.getByTestId('cart-panel-line-item');
      expect(cartLine).toBeInTheDocument();
    });

    // Click 15% tip
    const tipBtn = screen.getByRole('button', { name: /set tip to 15 percent/i });
    await userEvent.click(tipBtn);

    await waitFor(() => {
      expect(screen.getByText((content) => content.includes('Tip (15%)'))).toBeInTheDocument();
    });

    // Click None (0%)
    const noneBtn = screen.getByRole('button', { name: /no tip/i });
    await userEvent.click(noneBtn);

    // Verify tip preview gone
    await waitFor(() => {
      const tipRow = document.querySelector('.pos-cart-tip-preview-row');
      expect(tipRow).not.toBeInTheDocument();
    });
  });

  // ── Service Charge Tests ─────────────────────────────────────────────

  it('toggles service charge on and shows preview', async () => {
    await renderPosScreenWithShift();

    await waitFor(() => {
      expect(screen.getByText('0m')).toBeInTheDocument();
    });

    // Add product
    vi.mocked(productsApi.lookupByBarcodeScoped).mockResolvedValueOnce({
      sku: 'ITEM-001',
      name: 'Test Item',
      category: 'Test',
      price: { minor_units: 700, currency: 'USD' },
      barcode: 'BARCODE-001',
      in_stock: true,
      stock_qty: 100,
      tax_rate_ids: [],
      product_type: 'standard',
      created_at: '',
      price_updated_at: '',
    });

    await act(async () => {
      mockedBarcode.triggerScan('BARCODE-001');
    });

    await waitFor(() => {
      const cartLine = screen.getByTestId('cart-panel-line-item');
      expect(cartLine).toBeInTheDocument();
    });

    // Click service charge toggle
    const serviceToggle = screen.getByRole('button', { name: /toggle service charge/i });
    await userEvent.click(serviceToggle);

    // Verify service charge preview row appears (text split across elements)
    await waitFor(() => {
      const serviceRow = document.querySelector('.pos-cart-service-preview-row');
      expect(serviceRow).toBeInTheDocument();
      expect(serviceRow?.textContent).toContain('Service (10%)');
      expect(serviceRow?.textContent).toContain('+');
    });
  });

  // ── Quantity Tests ───────────────────────────────────────────────────

  it('increases and decreases quantity via +/- buttons', async () => {
    await renderPosScreenWithShift();

    await waitFor(() => {
      expect(screen.getByText('0m')).toBeInTheDocument();
    });

    // Add product
    vi.mocked(productsApi.lookupByBarcodeScoped).mockResolvedValueOnce({
      sku: 'ITEM-001',
      name: 'Test Item',
      category: 'Test',
      price: { minor_units: 700, currency: 'USD' },
      barcode: 'BARCODE-001',
      in_stock: true,
      stock_qty: 100,
      tax_rate_ids: [],
      product_type: 'standard',
      created_at: '',
      price_updated_at: '',
    });

    await act(async () => {
      mockedBarcode.triggerScan('BARCODE-001');
    });

    await waitFor(() => {
      const cartLine = screen.getByTestId('cart-panel-line-item');
      expect(cartLine).toBeInTheDocument();
    });

    // Find the increase button and click
    const increaseBtn = screen.getByRole('button', { name: /increase quantity/i });
    await userEvent.click(increaseBtn);

    // Verify cart line shows qty 2
    await waitFor(() => {
      const cartLine = screen.getByTestId('cart-panel-line-item');
      expect(cartLine).toBeInTheDocument();
      expect(cartLine.textContent).toContain('2');
    });

    // Click decrease button
    const decreaseBtn = screen.getByRole('button', { name: /decrease quantity/i });
    await userEvent.click(decreaseBtn);

    // Verify qty back to 1 (exact match avoids matching button aria-labels)
    await waitFor(() => {
      const qtyValue = screen.getByLabelText('Quantity: 1');
      expect(qtyValue).toBeInTheDocument();
    });
  });

  // ── Line Removal with Undo ───────────────────────────────────────────

  it('removes line and shows undo pill', async () => {
    await renderPosScreenWithShift();

    await waitFor(() => {
      expect(screen.getByText('0m')).toBeInTheDocument();
    });

    // Add product
    vi.mocked(productsApi.lookupByBarcodeScoped).mockResolvedValueOnce({
      sku: 'ITEM-001',
      name: 'Test Item',
      category: 'Test',
      price: { minor_units: 700, currency: 'USD' },
      barcode: 'BARCODE-001',
      in_stock: true,
      stock_qty: 100,
      tax_rate_ids: [],
      product_type: 'standard',
      created_at: '',
      price_updated_at: '',
    });

    await act(async () => {
      mockedBarcode.triggerScan('BARCODE-001');
    });

    await waitFor(() => {
      const cartLine = screen.getByTestId('cart-panel-line-item');
      expect(cartLine).toBeInTheDocument();
    });

    // Click remove button (×)
    const removeBtn = screen.getByRole('button', { name: /remove ITEM-001/i });
    await userEvent.click(removeBtn);

    // Cart should be empty
    await waitFor(() => {
      expect(screen.getByText('Cart is empty')).toBeInTheDocument();
    });

    // Undo pill should be visible
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^undo$/i })).toBeInTheDocument();
    });
  });

  it('undoes line removal', async () => {
    await renderPosScreenWithShift();

    await waitFor(() => {
      expect(screen.getByText('0m')).toBeInTheDocument();
    });

    // Add product
    vi.mocked(productsApi.lookupByBarcodeScoped).mockResolvedValueOnce({
      sku: 'ITEM-001',
      name: 'Test Item',
      category: 'Test',
      price: { minor_units: 700, currency: 'USD' },
      barcode: 'BARCODE-001',
      in_stock: true,
      stock_qty: 100,
      tax_rate_ids: [],
      product_type: 'standard',
      created_at: '',
      price_updated_at: '',
    });

    await act(async () => {
      mockedBarcode.triggerScan('BARCODE-001');
    });

    await waitFor(() => {
      const cartLine = screen.getByTestId('cart-panel-line-item');
      expect(cartLine).toBeInTheDocument();
    });

    // Click remove button
    const removeBtn = screen.getByRole('button', { name: /remove ITEM-001/i });
    await userEvent.click(removeBtn);

    await waitFor(() => {
      expect(screen.getByText('Cart is empty')).toBeInTheDocument();
    });

    // Click Undo (the cart undo button, not the dismiss button)
    const undoBtn = screen.getByRole('button', { name: /^undo$/i });
    await userEvent.click(undoBtn);

    // Line should reappear
    await waitFor(() => {
      const cartLine = screen.getByTestId('cart-panel-line-item');
      expect(cartLine).toBeInTheDocument();
      expect(cartLine.textContent).toContain('Test Item');
    });
  });

  // ── Open Bill Tests ──────────────────────────────────────────────────

  it('opens Open Bill input, saves, and reopens cart', async () => {
    await renderPosScreenWithShift();

    await waitFor(() => {
      expect(screen.getByText('0m')).toBeInTheDocument();
    });

    // Add product
    vi.mocked(productsApi.lookupByBarcodeScoped).mockResolvedValueOnce({
      sku: 'ITEM-001',
      name: 'Test Item',
      category: 'Test',
      price: { minor_units: 700, currency: 'USD' },
      barcode: 'BARCODE-001',
      in_stock: true,
      stock_qty: 100,
      tax_rate_ids: [],
      product_type: 'standard',
      created_at: '',
      price_updated_at: '',
    });

    await act(async () => {
      mockedBarcode.triggerScan('BARCODE-001');
    });

    await waitFor(() => {
      const cartLine = screen.getByTestId('cart-panel-line-item');
      expect(cartLine).toBeInTheDocument();
    });

    // Click Open Bill button (aria-label: 'Save as open bill' from pos-cart-open-bill-aria)
    const openBillBtn = screen.getByRole('button', { name: /save as open bill/i });
    await userEvent.click(openBillBtn);

    // Open Bill input modal should appear
    await waitFor(() => {
      expect(screen.getByPlaceholderText('e.g. John Doe')).toBeInTheDocument();
    });

    // Enter name and save
    const nameInput = screen.getByPlaceholderText('e.g. John Doe');
    await userEvent.type(nameInput, 'Table 5');

    const saveBtn = screen.getByRole('button', { name: /save open bill/i });
    await userEvent.click(saveBtn);

    // Cart should be reset to empty
    await waitFor(() => {
      expect(screen.getByText('Cart is empty')).toBeInTheDocument();
    });
  });

  // ── Keyboard Navigation Tests ────────────────────────────────────────

  it('navigates cart lines with ArrowUp/ArrowDown', async () => {
    await renderPosScreenWithShift();

    await waitFor(() => {
      expect(screen.getByText('0m')).toBeInTheDocument();
    });

    // Add two products — use mockImplementation keyed by barcode
    // so internal extra calls don't consume the wrong mock entry
    vi.mocked(productsApi.lookupByBarcodeScoped).mockImplementation(
      (_session: string, code: string) => {
        if (code === 'BARCODE-001')
          return Promise.resolve({
            sku: 'ITEM-001',
            name: 'Test Item',
            category: 'Test',
            price: { minor_units: 700, currency: 'USD' },
            barcode: 'BARCODE-001',
            in_stock: true,
            stock_qty: 100,
            tax_rate_ids: [],
            product_type: 'standard',
            created_at: '',
            price_updated_at: '',
          });
        if (code === 'BARCODE-002')
          return Promise.resolve({
            sku: 'ITEM-002',
            name: 'Second Item',
            category: 'Test',
            price: { minor_units: 300, currency: 'USD' },
            barcode: 'BARCODE-002',
            in_stock: true,
            stock_qty: 50,
            tax_rate_ids: [],
            product_type: 'standard',
            created_at: '',
            price_updated_at: '',
          });
        return Promise.resolve(null);
      },
    );

    await act(async () => {
      mockedBarcode.triggerScan('BARCODE-001');
    });
    await waitFor(() => {
      expect(screen.getByTestId('cart-panel-line-item')).toBeInTheDocument();
    });

    await act(async () => {
      mockedBarcode.triggerScan('BARCODE-002');
    });

    await waitFor(() => {
      const cartLines = screen.getAllByTestId('cart-panel-line-item');
      expect(cartLines.length).toBe(2);
    });

    // Focus first line (it should be focused by default or we focus it)
    const firstLine = screen.getAllByTestId('cart-panel-line-item')[0]!;
    await userEvent.tab(); // Focus the cart panel first
    firstLine.focus();

    // Press ArrowDown to move to second line
    await userEvent.keyboard('{ArrowDown}');

    // Second line should be focused
    const secondLine = screen.getAllByTestId('cart-panel-line-item')[1];
    expect(secondLine).toHaveFocus();
  });

  it('increases/decreases qty with +/- keys on focused line', async () => {
    await renderPosScreenWithShift();

    await waitFor(() => {
      expect(screen.getByText('0m')).toBeInTheDocument();
    });

    // Add product
    vi.mocked(productsApi.lookupByBarcodeScoped).mockResolvedValueOnce({
      sku: 'ITEM-001',
      name: 'Test Item',
      category: 'Test',
      price: { minor_units: 700, currency: 'USD' },
      barcode: 'BARCODE-001',
      in_stock: true,
      stock_qty: 100,
      tax_rate_ids: [],
      product_type: 'standard',
      created_at: '',
      price_updated_at: '',
    });

    await act(async () => {
      mockedBarcode.triggerScan('BARCODE-001');
    });

    await waitFor(() => {
      const cartLine = screen.getByTestId('cart-panel-line-item');
      expect(cartLine).toBeInTheDocument();
    });

    // Focus the cart line element (needs data-line-id for keyboard handler)
    const cartLine = screen.getByTestId('cart-panel-line-item');
    cartLine.focus();

    // Press + to increase qty
    await userEvent.keyboard('+');

    // Verify qty is now 2 (exact match avoids matching button aria-labels)
    await waitFor(() => {
      const qtyValue = screen.getByLabelText('Quantity: 2');
      expect(qtyValue).toBeInTheDocument();
    });
  });

  // ── Shift Close Tests ────────────────────────────────────────────────

  it('shows error when closing shift with non-empty cart', async () => {
    await renderPosScreenWithShift();

    await waitFor(() => {
      expect(screen.getByText('0m')).toBeInTheDocument();
    });

    // Add product
    vi.mocked(productsApi.lookupByBarcodeScoped).mockResolvedValueOnce({
      sku: 'ITEM-001',
      name: 'Test Item',
      category: 'Test',
      price: { minor_units: 700, currency: 'USD' },
      barcode: 'BARCODE-001',
      in_stock: true,
      stock_qty: 100,
      tax_rate_ids: [],
      product_type: 'standard',
      created_at: '',
      price_updated_at: '',
    });

    await act(async () => {
      mockedBarcode.triggerScan('BARCODE-001');
    });

    await waitFor(() => {
      const cartLine = screen.getByTestId('cart-panel-line-item');
      expect(cartLine).toBeInTheDocument();
    });

    // Click Close Shift button - aria-label is "Close current shift"
    const closeShiftBtn = screen.getByRole('button', { name: /close current shift/i });
    await userEvent.click(closeShiftBtn);

    // Debug: check if error rendered - search for pos-shift-error
    await waitFor(() => {
      const errorDiv = document.querySelector('.pos-shift-error');
      console.log('Error div:', errorDiv);
      if (errorDiv) {
        console.log('Error div text:', errorDiv.textContent);
      }
      // Also check for shiftErrorExit state
      console.log('closeShiftError in DOM:', document.body.innerHTML.includes('pos-shift-error'));
    }, { timeout: 2000 });

    // Error should appear (test FTL: 'Cart is not empty. Close or complete the sale first.')
    await waitFor(() => {
      expect(screen.getByText(/complete or clear the current sale/i)).toBeInTheDocument();
    });
  });

  // ── Lock Cart Tests ──────────────────────────────────────────────────

  it('locks cart on logout and restores on next mount', async () => {
    await renderPosScreenWithShift();

    await waitFor(() => {
      expect(screen.getByText('0m')).toBeInTheDocument();
    });

    // Add product
    vi.mocked(productsApi.lookupByBarcodeScoped).mockResolvedValueOnce({
      sku: 'ITEM-001',
      name: 'Test Item',
      category: 'Test',
      price: { minor_units: 700, currency: 'USD' },
      barcode: 'BARCODE-001',
      in_stock: true,
      stock_qty: 100,
      tax_rate_ids: [],
      product_type: 'standard',
      created_at: '',
      price_updated_at: '',
    });

    await act(async () => {
      mockedBarcode.triggerScan('BARCODE-001');
    });

    await waitFor(() => {
      const cartLine = screen.getByTestId('cart-panel-line-item');
      expect(cartLine).toBeInTheDocument();
    });

    // Click Lock button (locks cart and logs out)
    const lockBtn = screen.getByRole('button', { name: /lock/i });
    await userEvent.click(lockBtn);

    // Cart data should be in localStorage
    const lockedCart = localStorage.getItem('pos-locked-cart');
    expect(lockedCart).not.toBeNull();
    const data = JSON.parse(lockedCart!);
    expect(data.lines.length).toBe(1);
    expect(data.lines[0].sku).toBe('ITEM-001');
  });

  // ── Open Shift Tests ──────────────────────────────────────────────────

  it('opens shift with opening balance', async () => {
    // Render without active shift first
    vi.mocked(shiftsApi.getActiveShiftScoped).mockResolvedValueOnce(null);
    vi.mocked(settingsApi.getReceiptSettingsScoped).mockResolvedValueOnce(receiptSettingsFixture);
    vi.mocked(shiftsApi.openShiftScoped).mockResolvedValue({
      id: 'shift-1', userId: 'user-1', terminalId: null,
      openedAt: new Date().toISOString(), closedAt: null,
      openingBalanceMinor: 50000, closingBalanceMinor: null,
      expectedCashMinor: null, cashDifferenceMinor: null,
      totalSalesMinor: 0, totalCashMinor: 0, totalCardMinor: 0,
      totalOtherMinor: 0, totalVoidsMinor: 0, totalRefundsMinor: 0,
      totalPayoutsMinor: 0, notes: '', status: 'open',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    vi.mocked(salesApi.startSaleScoped).mockResolvedValue({
      cartId: 'test-cart-1' as CartId,
      deductionLocationId: 'loc-store-inventory',
    });
    vi.mocked(salesApi.getCartDeductionLocation).mockResolvedValue({
      locationId: 'loc-store-inventory',
      locationName: 'Store Inventory',
    });

    await renderWithProviders(
      <PosScreen />,
      salesFtl,
      productsFtl,
      inventoryFtl,
      settingsFtl,
      testCoreFtl,
    );

    // Wait for the no-shift state to appear, then click the open shift button
    await waitFor(() => {
      const shiftLabel = screen.getByText('No active shift');
      const shiftBar = shiftLabel.closest('.pos-cart-header-shift');
      expect(shiftBar).toBeTruthy();
    });
    const shiftBar = document.querySelector('.pos-cart-header-shift')!;
    const openShiftBtn = shiftBar.querySelector('.pos-shift-open-btn') as HTMLButtonElement;
    expect(openShiftBtn).toBeInTheDocument();
    await userEvent.click(openShiftBtn);

    // Open shift overlay should appear with balance input
    await waitFor(() => {
      expect(screen.getByLabelText(/opening balance/i)).toBeInTheDocument();
    });

    // Enter opening balance
    const balanceInput = screen.getByLabelText(/opening balance/i);
    await userEvent.type(balanceInput, '50000');

    // Click the confirm button inside the dialog
    const dialog = screen.getByRole('dialog', { name: /open/i });
    const confirmBtn = within(dialog).getByRole('button', { name: /open/i });
    await userEvent.click(confirmBtn);

    // Should show shift as open (0m elapsed)
    await waitFor(() => {
      expect(screen.getByText('0m')).toBeInTheDocument();
    });
  });

  // ── Deduction Badge / FastPIN Tests ──────────────────────────────────

  // A refused open-shift used to be swallowed: `catch { // Handled silently }`
  // in usePosShifts. The backend DOES refuse a second open shift
  // (crates/oz-core/src/db/shifts.rs:64-75), so this banner is the only signal
  // an operator ever gets that the click did anything.
  it('reports a refused shift open instead of failing silently', async () => {
    vi.mocked(shiftsApi.getActiveShiftScoped).mockResolvedValueOnce(null);
    vi.mocked(settingsApi.getReceiptSettingsScoped).mockResolvedValueOnce(receiptSettingsFixture);
    vi.mocked(shiftsApi.openShiftScoped).mockRejectedValueOnce(new Error('user already has an open shift'));

    await renderWithProviders(
      <PosScreen />,
      salesFtl,
      productsFtl,
      inventoryFtl,
      settingsFtl,
      testCoreFtl,
    );

    await waitFor(() => {
      expect(screen.getByText('No active shift')).toBeInTheDocument();
    });
    const shiftBar = document.querySelector('.pos-cart-header-shift')!;
    const openShiftBtn = shiftBar.querySelector('.pos-shift-open-btn') as HTMLButtonElement;
    await userEvent.click(openShiftBtn);
    const balanceInput = await screen.findByLabelText(/opening balance/i);
    await userEvent.type(balanceInput, '50000');

    const dialog = screen.getByRole('dialog', { name: /open/i });
    await userEvent.click(within(dialog).getByRole('button', { name: /open/i }));

    await waitFor(() => {
      const banner = document.querySelector('.pos-shift-error');
      expect(banner).not.toBeNull();
      expect(banner?.textContent).toContain('Failed to open shift');
    });
    expect(screen.getByRole('dialog', { name: /open/i })).toBeInTheDocument();
  });

  // ADR-19 §17: deduction badge → FastPIN overlay for manager override.
  // This flow requires ensureCart() which is only called from the price-override
  // handler, not during normal product add. A proper integration test needs
  // the full manager-override → PIN → override chain.
  it.skip('opens FastPIN overlay when deduction badge clicked', async () => {
    vi.mocked(productsApi.lookupByBarcodeScoped).mockResolvedValueOnce({
      sku: 'ITEM-001', name: 'Test Item', category: 'Test',
      price: { minor_units: 700, currency: 'USD' }, barcode: 'BARCODE-001',
      in_stock: true, stock_qty: 100, tax_rate_ids: [], product_type: 'standard',
      created_at: '', price_updated_at: '',
    });
    await renderPosScreenWithShift();
    await waitFor(() => {
      expect(screen.getByText('0m')).toBeInTheDocument();
    });
    // Scan a product — note: ensureCart is only called via price override,
    // not during normal add, so the deduction badge may never appear here.
    await act(async () => {
      mockedBarcode.triggerScan('BARCODE-001');
    });
    const deductionBadge = await screen.findByTestId('deduction-location-badge', {}, { timeout: 3000 });
    await userEvent.click(deductionBadge);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  // ── Workspace Settings Tests ──────────────────────────────────────────

  it('opens workspace settings via onNavigate', async () => {
    const onNavigate = vi.fn();
    await renderWithProviders(
      <PosScreen onNavigate={onNavigate} />,
      salesFtl,
      productsFtl,
      inventoryFtl,
      settingsFtl,
      testCoreFtl,
    );

    await waitFor(() => {
      expect(screen.getByText('0m')).toBeInTheDocument();
    });

    // Click settings button
    const settingsBtn = screen.getByRole('button', { name: /settings/i });
    await userEvent.click(settingsBtn);

    // onNavigate should be called with 'settings'
    expect(onNavigate).toHaveBeenCalledWith('settings');
  });

  // ── Table Management Tests ──────────────────────────────────────────

  it('opens table management sub-screen', async () => {
    await renderWithProviders(
      <PosScreen />,
      salesFtl,
      productsFtl,
      inventoryFtl,
      settingsFtl,
      testCoreFtl,
    );

    await waitFor(() => {
      expect(screen.getByText('0m')).toBeInTheDocument();
    });

    // Click tables button
    const tablesBtn = screen.getByRole('button', { name: /table management/i });
    await userEvent.click(tablesBtn);

    // Table management sub-screen should appear (it renders a back button)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
    });
  });

  // ── KDS Tests ────────────────────────────────────────────────────────

  it('opens KDS screen via onNavigate', async () => {
    const onNavigate = vi.fn();
    await renderWithProviders(
      <PosScreen onNavigate={onNavigate} />,
      salesFtl,
      productsFtl,
      inventoryFtl,
      settingsFtl,
      testCoreFtl,
    );

    await waitFor(() => {
      expect(screen.getByText('0m')).toBeInTheDocument();
    });

    // Click KDS button
    const kdsBtn = screen.getByRole('button', { name: /kitchen display/i });
    await userEvent.click(kdsBtn);

    // onNavigate should be called with 'kds'
    expect(onNavigate).toHaveBeenCalledWith('kds');
  });

  // ── Sales History Tests ──────────────────────────────────────────────

  it('opens sales history sub-screen', async () => {
    await renderWithProviders(
      <PosScreen />,
      salesFtl,
      productsFtl,
      inventoryFtl,
      settingsFtl,
      testCoreFtl,
    );

    await waitFor(() => {
      expect(screen.getByText('0m')).toBeInTheDocument();
    });

    // Click sales history button
    const historyBtn = screen.getByRole('button', { name: /history/i });
    await userEvent.click(historyBtn);

    // Sales history sub-screen should appear (renders a back button)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
    });
  });

  // ── Stock Inquiry Tests ──────────────────────────────────────────────

  it('opens stock inquiry sub-screen', async () => {
    await renderWithProviders(
      <PosScreen />,
      salesFtl,
      productsFtl,
      inventoryFtl,
      settingsFtl,
      testCoreFtl,
    );

    await waitFor(() => {
      expect(screen.getByText('0m')).toBeInTheDocument();
    });

    // Click stock inquiry button
    const stockBtn = screen.getByRole('button', { name: /stok/i });
    await userEvent.click(stockBtn);

    // Stock inquiry sub-screen should appear (renders a back button)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
    });
  });
});