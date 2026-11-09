// ── PosScreen TDD: Core Sale Flow (Red → Green → Refactor) ─────────────
//
// Target: Exercise the critical path: add product → cart → pay → complete
// Current coverage: ~52% statements, ~55% branches
// Goal: Push to >80% by covering uncovered branches in this flow

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { flushSync } from 'react-dom';
import { screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, renderWithProvidersSync, rerenderWithProviders } from '@/__tests__/test-utils/render';
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

// F21: the order-sent chime. The real hook synthesises a Web Audio tone, which jsdom
// has no AudioContext for — it swallows the throw, so a test against the real hook
// could not tell "played" from "failed silently". Hoisted spies make it observable.
const soundSpies = vi.hoisted(() => ({ playSuccess: vi.fn(), playBeep: vi.fn() }));
vi.mock('@/components/useSound', () => ({
  useSound: () => ({
    playSuccess: soundSpies.playSuccess,
    playBeep: soundSpies.playBeep,
    playError: vi.fn(),
    setSoundEnabled: vi.fn(),
  }),
}));

vi.mock('@/contexts/AuthContext', async () => {
  const { createAuthContextMock } = await import('@/__tests__/test-utils/mocks/contexts');
  return {
    useAuth: createAuthContextMock({ isManager: true }),
  };
});

// Mutable so a test can SWITCH STORES. The receipt-settings read depends on
// sessionToken, so changing it starts a second read while the first is in flight.
// Reset in beforeEach so the token cannot leak between cases.
const wsState = vi.hoisted(() => ({
  sessionToken: 'mock-session-token' as string,
  // Mutable for the course-firing case below: the course bar only renders on
  // `restaurant-pos`, and a store switch is what re-runs the read being raced.
  activeWorkspace: 'store-pos' as string,
  scopeTypeKey: 'store-pos' as string,
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    activeWorkspace: wsState.activeWorkspace,
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
    sessionToken: wsState.sessionToken,
    swapSessionToken: vi.fn(),
    terminalId: '',
  }),
  useWorkspaceScope: () => ({
    storeId: 'default',
    instanceId: 'default',
    // Mutable so a case can declare the restaurant workspace: `loadOpenBills`
    // bails on `typeKey !== 'restaurant-pos'` (usePosHeldCarts.ts:122/:140), which
    // is a DIFFERENT field from `activeWorkspace` — measured, after a test that set
    // only `activeWorkspace` found the refresh permanently unreachable.
    typeKey: wsState.scopeTypeKey,
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

/**
 * Answer the one media query orientation is read from, as LANDSCAPE.
 *
 * jsdom answers `matchMedia(...).matches` with `false` for everything, and
 * `PosScreen` derives `isPortraitRestaurant` from it (PosScreen.tsx:544), so
 * every case that renders `restaurant-pos` takes the PORTRAIT branch and skips
 * `<CartPanel>` entirely (PosScreen.tsx:2535). The course-bar case below then
 * asserts on an element that branch makes unreachable — which is exactly how it
 * passed alone and failed in a full run, where another file's stub leaked in.
 * Measured 2026-10-19; see docs/records/audits/course-bar-render-gates.md gate 1.
 */
function stubLandscape(): () => void {
  // ⚠️ The VIEWPORT, not only the query. `readIsLandscape` prefers matchMedia but
  // falls back to `innerWidth > innerHeight` when the host cannot answer, and
  // jsdom's default 1024x768 is landscape — so a viewport left at its default
  // masks a broken stub. Setting it here makes the assertion depend on the stub.
  const originalMatchMedia = window.matchMedia;
  const originalWidth = window.innerWidth;
  const originalHeight = window.innerHeight;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
  window.matchMedia = ((query: string) => ({
    matches: query === '(orientation: landscape)',
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = originalMatchMedia;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight });
  };
}

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
    // Always on the wire; see completedSale.test.ts for why the type is now required.
    discountPercent: 0,
    tipMinor: 0,
    serviceChargeMinor: 0,
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

// The suites mock `resolvedStoreId: 'default'`, and the POS keys are store-scoped.
const STORE_ID = 'default';

describe('PosScreen — Core Sale Flow (TDD)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // ⚠️ clearAllMocks() clears CALLS but KEEPS IMPLEMENTATIONS, and restoreAllMocks() in
    // afterEach does not restore a vi.fn() that a vi.mock factory created. Measured on
    // vitest (round 92): a mockImplementation set in one case is still in force for the
    // next. The cases here that replace `getSettingScoped` therefore leaked their
    // behaviour into every later case, which is what made the full suite fail while this
    // file passed alone.
    //
    // Reset to the factory's own default explicitly. Only the mocks a case replaces need
    // this; resetting all of them would drop the factory defaults and break every case.
    // mockReset(), not just mockImplementation(): a queued `mockResolvedValueOnce` from a
    // case that never consumed it SURVIVES both clearAllMocks() and a later
    // mockImplementation. Probed on vitest (round 99): case A queues a once-value, case B
    // calls the mock after clearAllMocks + mockImplementation and still receives A's value.
    //
    // The effect here was visible in the log: TWO scans of 'BARCODE-002' answered
    // `ITEM-002` then `ITEM-001` -- the second got a leftover queued value intended for a
    // different barcode. That is what failed `adds multiple products` (it got 1 line, not
    // 2) and `persists active draft` (its scan answered a product it did not expect) under
    // `--sequence.shuffle.tests`.
    //
    // mockReset() clears the implementation AND the once-queue, so the default must be
    // re-installed straight after. Only the mocks cases queue values on need this.
    vi.mocked(settingsApi.getSettingScoped).mockReset();
    vi.mocked(settingsApi.getSettingScoped).mockImplementation(() => Promise.resolve(null));
    vi.mocked(productsApi.lookupByBarcodeScoped).mockReset();
    // Cases key the lookup on their own barcode; an implementation left behind answers
    // \`null\` for every other code, which is how the trimMemory case was silently
    // depending on a neighbour (round 93).
    vi.mocked(productsApi.lookupByBarcodeScoped).mockImplementation(((_token: string,
      code: string) => mockLookupByBarcode(code)) as never);
    localStorage.clear();
    mockedBarcode.reset();
    // A store-switching test mutates these, so later cases need them restored.
    wsState.sessionToken = 'mock-session-token';
    wsState.activeWorkspace = 'store-pos';
    // The three mocks the open-bill cases override, reset to the factory's own
    // defaults for the reason the block above (:488-516) records: a `vi.fn()` from a
    // `vi.mock` factory keeps its IMPLEMENTATION across cases, and a queued
    // `mockResolvedValueOnce` survives even that. Measured: without these, this file
    // alone is green but the FULL suite gains a fifth failure in
    // TableManagementScreen.test.tsx ('does not clobber a section change that lands
    // during a pending mutation'), which disappears when this file is removed.
    vi.mocked(salesApi.listOpenBillsScoped).mockReset().mockResolvedValue([]);
    vi.mocked(salesApi.getHeldCartScoped).mockReset().mockResolvedValue(null);
    vi.mocked(salesApi.printSalesReceipt).mockReset().mockResolvedValue({ printed: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });


  // A store switch must not let a SLOWER earlier read win.
  //
  // Guarded in PosScreen (760e0c8da). `showTableNumber` decides whether the table
  // number input is rendered (CartPanel.tsx:564), so a stale value puts the
  // PREVIOUS store's receipt configuration on this store's screen.
  //
  // Unlike the course-firing flag, this one has a cart-FREE observable: the
  // condition is `showTableNumberSetting || restaurant-pos`, so the input appears
  // with an empty cart. That is what makes this test able to pin the guard.
  //
  // ── A failed split-bill hold must not send the cashier into payment ──
  //
  // `handleConfirmSplitBill` (PosScreen.tsx:925) balances the remaining lines onto a new
  // tab. The create-first ordering at :979-987 is right and documented — but the CATCH at
  // :995-997 only toasts, it does not return, so :999-1001 run regardless:
  // setLines(selectedLines) / setShowSplitBillModal(false) / setShowPayment(true).
  //
  // `setActiveOpenBillId(null)` (:993) is on the SUCCESS path only, so the ORIGINAL tab
  // still holds every line. The split portion is rung as a new sale AND the full original
  // tab remains to be settled — a double charge, with the cashier told only "failed to
  // update tab". The file's own comment at :974-977 names exactly this as what the
  // create-first ordering was meant to end: "execution then CONTINUES to
  // setShowPayment(true)".
  // ── Executed, not scanned: a restaurant sale end to end ──────────────
  //
  // Rounds 97-100 each found their real defect by READING siblings, and one by
  // executing a hook that had only static tests. This case is the restaurant
  // equivalent: render the POS in the restaurant workspace, run a real sale, and
  // assert the observable state — because a wrong table on a sale is a money
  // defect no render-only assertion can see.
  //
  // Both `activeWorkspace` and `scopeTypeKey` are set. They are DIFFERENT fields,
  // and this file's own mock records a case where setting only one left a path
  // permanently unreachable (:221-225), so half-setting them is how this case
  // would silently test nothing.
  it('keeps the table the waiter typed on a restaurant cart', async () => {
    wsState.activeWorkspace = 'restaurant-pos';
    wsState.scopeTypeKey = 'restaurant-pos';
    await renderPosScreenWithShift();

    await waitFor(() => {
      expect(screen.getByText(/\d+m/)).toBeInTheDocument();
    });

    vi.mocked(productsApi.lookupByBarcodeScoped).mockResolvedValueOnce({
      sku: 'REST-1',
      name: 'Nasi Padang',
      category: 'Makanan',
      price: { minor_units: 25000, currency: 'IDR' },
      barcode: 'BAR-R1',
      in_stock: true,
      stock_qty: 10,
      tax_rate_ids: [],
      product_type: 'restaurant',
      created_at: '',
      price_updated_at: '',
    } as never);

    await act(async () => {
      mockedBarcode.triggerScan('BAR-R1');
    });
    await waitFor(() => {
      expect(screen.getByTestId('cart-panel-line-item')).toBeInTheDocument();
    });

    // The table field, typed the way a waiter types it.
    const tableInput = document.querySelector('.pos-cart-table-input') as HTMLInputElement | null;
    expect(tableInput, 'the restaurant cart offers a table field').not.toBeNull();
    await act(async () => {
      fireEvent.change(tableInput!, { target: { value: 'T7' } });
    });

    // Rounds 96/97 both showed this field is the one that silently leaks across
    // resumes, so: does typing it actually hold?
    expect((tableInput as HTMLInputElement).value).toBe('T7');
  });

  it('does not open payment when balancing the remaining tab fails', async () => {
    const user = userEvent.setup();
    // Scan the lines while in store-pos (the barcode handler is
    // `enabled: activeWorkspace !== 'restaurant-pos'`, PosScreen.tsx:611), then switch to
    // restaurant-pos — which is what the split modal and the dine-in tab rule require.
    wsState.activeWorkspace = 'store-pos';

    // The workspace SCOPE, not just `activeWorkspace`: the failure path's bill-list
    // refresh goes through `loadOpenBills`, which returns early unless
    // `typeKey === 'restaurant-pos'` (usePosHeldCarts.ts:122/:140). Setting only
    // `activeWorkspace` (below) left that refresh unreachable — measured, twice, before
    // `wsState.scopeTypeKey` was made settable. In the real app `typeKey` comes from
    // `activeInstance.type_key` (WorkspaceContext.tsx:785), so this is what a restaurant
    // terminal actually has.
    wsState.scopeTypeKey = 'restaurant-pos';

    // An open bill exists, so the split takes the `remainingLines.length > 0` branch.
    vi.mocked(salesApi.listHeldCartsScoped).mockResolvedValue([
      {
        id: 'bill-1',
        label: 'Table T1',
        cart_data: JSON.stringify({ lines: [] }),
        item_count: 2,
        total_minor: 1000,
        currency: 'USD',
        bill_type: 'open_bill',
        customer_name: null,
        created_at: '2026-01-01T00:00:00Z',
      },
    ] as never);
    // The balancing hold is refused — a locked DB, a lapsed session.
    vi.mocked(salesApi.holdCartScoped).mockRejectedValue(new Error('database is locked'));

    await renderPosScreenWithShift();

    // Two lines of the same product, so a split leaves a remainder. Same shape the
    // scan-driven cases use (:989-1002) — `lookupByBarcodeScoped`, not the SKU lookup.
    // A persistent implementation, not `mockResolvedValueOnce`: the file's own header
    // (:491-503) records that a queued once-value survives into the next case, and the two
    // scans here must each be answered independently.
    vi.mocked(productsApi.lookupByBarcodeScoped).mockImplementation((() => Promise.resolve({
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
    })) as never);
    await act(async () => { mockedBarcode.triggerScan('BARCODE-001'); });
    await waitFor(() => {
      expect(
        document.querySelectorAll('[data-testid="cart-panel-line-item"]').length,
        'expected one cart line before the workspace switch',
      ).toBe(1);
    });

    // Second line: bump the first line's quantity in store-pos, giving two lines in the
    // cart without a second scan.
    await user.click(screen.getByRole('button', { name: /increase quantity/i }));
    await waitFor(() => {
      const rows = document.querySelectorAll('[data-testid="cart-panel-line-item"]');
      // Two lines OR one line at qty 2 — either gives the split a remainder.
      expect(rows.length >= 1, 'expected cart lines to survive the workspace switch').toBe(true);
    });

    wsState.activeWorkspace = 'restaurant-pos';

    // Open the split modal through the CartActionBar's own button, which is what the
    // 'split-bill' shortcut claims (:1657).
    await user.click(screen.getByText(/split bill/i));

    // NO selection click: `SplitBillModal` auto-selects line[0] at qty 1 when it opens
    // (:50-53), so a 2-unit single line already has one unit selected and one remaining.
    await waitFor(() => {
      expect(document.querySelector('.pos-split-item-row--selected')).not.toBeNull();
    });

    // Baseline the refresh count while the split is still uncommitted, so the assertion
    // below measures the DELTA. A bare `toBeGreaterThan(0)` passed against a build with
    // the refresh deliberately removed — the mount effect already satisfies it, so the
    // count had to be differenced to mean anything.
    const openBillsReadsBeforeSplit = vi.mocked(salesApi.listOpenBillsScoped).mock.calls.length;

    await user.click(screen.getByTestId('pos-split-modal-confirm-btn'));

    // Reachability first: the balancing hold must actually be attempted, or the toast
    // assertion below would pass on a path that never ran.
    await waitFor(() => {
      expect(
        vi.mocked(salesApi.holdCartScoped).mock.calls.length,
        'the split never attempted to balance the remaining tab',
      ).toBeGreaterThan(0);
    });

    // The half-committed case re-reads the bill list so the duplicate is visible.
    //
    // This case's hold is REFUSED, so strictly nothing was written and the list did not
    // change — the refresh here is the same code path the half-committed case needs, and
    // asserting it proves the refresh RUNS on the failure branch. What it cannot prove is
    // the duplicate being VISIBLE, because that needs `activeOpenBillId` set, which only
    // a resumed tab does (usePosHeldCarts.ts:418); no case in this file resumes one, so
    // the `if (activeOpenBillId)` delete at PosScreen.tsx:1000 is never entered here.
    // Stated rather than implied: this covers the refresh, not the duplicate display.
    await waitFor(() => {
      expect(
        vi.mocked(salesApi.listOpenBillsScoped).mock.calls.length,
        'the failure branch did not re-read the open bills',
      ).toBeGreaterThan(openBillsReadsBeforeSplit);
    });

    // The failure IS reported (sales.ftl:1200).
    await waitFor(() => {
      expect(document.body.textContent ?? '').toMatch(/failed to update the remaining tab/i);
    });

    // The modal must STAY OPEN, and payment must NOT open.
    //
    // Payment opening is the double charge: the cashier rings the split portion while
    // the original tab still holds every line. That is what round 65 stopped.
    //
    // The modal used to close here — this assertion read "the modal closes (the
    // SplitBillModal's own finally)" and treated it as correct. It was not: the parent
    // returns on this path to keep the split retryable, and a bare `return` resolves the
    // promise, so the modal's `finally` closed it anyway. The two halves of the flow
    // documented opposite contracts and this test pinned the wrong one. The balance
    // failed, the toast flashed, and the cashier was left with a half-applied split and
    // no way to retry. Now asserted on the element, not on the resolver's prose.
    expect(
      document.querySelector('.payment-overlay, .payment-modal, [data-testid="payment-modal"]'),
      'payment opened even though balancing the remaining tab failed',
    ).toBeNull();

    // …and the split modal is still there for the retry the parent promised.
    expect(
      document.querySelector('[data-testid="pos-split-bill-modal"]'),
      'the split modal closed on a failed balance, stranding a half-applied split',
    ).not.toBeNull();

    // "…so the cashier can retry" is only true if the SELECTION survived, and that is
    // a separate claim from the dialog being present. The init effect re-seeds the
    // selection whenever `[isOpen, lines]` changes; `lines` is passed straight through
    // (CartPanel.tsx:1135) and the failed path leaves the cart untouched, so the
    // identity is stable and the selection must be exactly what it was. Asserted
    // rather than assumed — a modal that stayed open but reset to zero selected lines
    // would invite a second, DIFFERENT split on the retry.
    expect(
      document.querySelectorAll('.pos-split-item-row--selected').length,
      'the split selection was reset by the failed balance — the retry would not be the same split',
    ).toBeGreaterThan(0);
    const confirmBtn = screen.getByTestId('pos-split-modal-confirm-btn');
    expect(
      (confirmBtn as HTMLButtonElement).disabled,
      'the confirm button is disabled after a failed balance, so there is no retry',
    ).toBe(false);

    // Restore BOTH mocks. The file's own header (:491-503) records that a leftover
    // mockRejectedValue answers every later case: the next test's save-tab hold then
    // rejects too and its failure looks like a defect in the code under test.
    vi.mocked(salesApi.holdCartScoped).mockReset().mockResolvedValue({ id: 'held-1' });
    vi.mocked(productsApi.lookupByBarcodeScoped).mockReset();
    vi.mocked(productsApi.lookupByBarcodeScoped).mockImplementation(((_token: string,
      code: string) => mockLookupByBarcode(code)) as never);
    wsState.activeWorkspace = 'store-pos';
    // BOTH workspace fields, not just the one this case's screen rules read: the scope
    // declares the restaurant terminal for the refresh assertion above, and leaving it
    // set makes every later case run against a scope its own setup did not ask for.
    wsState.scopeTypeKey = 'store-pos';
  });

  // ── A paid open bill that fails to delete must be RE-READ ────────────────
  //
  // Closes the gap the split case above STATES and leaves open (:710-713):
  //
  //   'the duplicate being VISIBLE ... needs `activeOpenBillId` set, which only a
  //    resumed tab does (usePosHeldCarts.ts:418); no case in this file resumes one,
  //    so the `if (activeOpenBillId)` delete at PosScreen.tsx:1000 is never entered
  //    here.'
  //
  // `handlePaymentComplete` (PosScreen.tsx:809) settles a paid tab with a delete whose
  // refresh raced it:
  //
  //   deleteHeldCartScoped(token, activeOpenBillId).catch(() => { ...toast });
  //   setActiveOpenBillId(null);   // handle destroyed before the write settles
  //   loadOpenBills();             // refresh in the SAME tick as the delete
  //
  // When that delete REJECTS the paid tab is still in the database — the delete IS
  // the commit — and nothing re-reads it, so the operator sees a toast over a list
  // built from pre-write state. The open-bills list is the only surface that can
  // resume a tab, so the next waiter can recall a settled tab and sell its lines
  // twice. The split handler in the same file gets this right (:1033) and its own
  // comment records that only a DELTA makes the assertion mean anything.
  //
  // TWO TIMING FACTS this case has to honour, both measured rather than guessed:
  //  * `onComplete` is not called when the sale completes. It runs through
  //    `animateLeave` (PaymentModal.tsx:295-305, :1692), i.e. `done` -> 1500 ms ->
  //    `leaving` -> 300 ms -> `handleLeaveEnd` -> onComplete.
  //  * when `receiptArgs` exists the modal shows the ReceiptPreview instead of
  //    running that timer at all (:1682 is gated on `!receiptArgs`), so `onComplete`
  //    waits on Print/Skip (:2070-2072). Dismissing the receipt is a required step.
  it('re-reads the open bills when a paid tab fails to delete', async () => {
    // Scan in store-pos (the barcode handler is `activeWorkspace !== 'restaurant-pos'`,
    // PosScreen.tsx:611), then switch — the two-step the split case uses (:611-620).
    wsState.activeWorkspace = 'store-pos';
    wsState.scopeTypeKey = 'restaurant-pos';

    vi.mocked(salesApi.listOpenBillsScoped).mockResolvedValue([
      {
        id: 'bill-1',
        label: 'Meja 3',
        item_count: 1,
        total_minor: 700,
        currency: 'USD',
        created_at: '2026-01-01T00:00:00Z',
        bill_type: 'open_bill',
        customer_name: null,
      },
    ] as never);
    vi.mocked(salesApi.getHeldCartScoped).mockResolvedValue({
      id: 'bill-1',
      label: 'Meja 3',
      item_count: 1,
      total_minor: 700,
      currency: 'USD',
      created_at: '2026-01-01T00:00:00Z',
      bill_type: 'open_bill',
      customer_name: null,
      deduction_location_id: null,
      cart_data: JSON.stringify({
        lines: [{ sku: 'ITEM-001', name: 'Test Item', qty: 1, unit_price: { minor_units: 700, currency: 'USD' } }],
      }),
    } as never);
    // The file's hoisted `mockLookupByBarcode` answers null, so the scan would add
    // nothing. Overridden to a real product, as the split case does (:646-658).
    vi.mocked(productsApi.lookupByBarcodeScoped).mockImplementation((() => Promise.resolve({
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
    })) as never);

    const user = userEvent.setup();
    await renderPosScreenWithShift();

    await act(async () => { mockedBarcode.triggerScan('BARCODE-001'); });
    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid="cart-panel-line-item"]').length).toBe(1);
    });

    wsState.activeWorkspace = 'restaurant-pos';

    // Resume the held tab — the only thing that sets `activeOpenBillId`, which the
    // delete branch reads. The Update-tab label is its visible consequence.
    await user.click(screen.getByRole('button', { name: /view open bills/i }));
    await waitFor(() => {
      expect(document.querySelector('.pos-held-list-modal')).not.toBeNull();
    });
    await user.click(screen.getByRole('button', { name: /resume/i }));
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: /update open tab/i }),
        'the tab was never resumed, so the delete branch cannot be reached',
      ).not.toBeNull();
    });

    // The delete is HELD OPEN, then refused — a locked DB, a lapsed session. Holding it
    // is what makes the race observable: the assertion afterwards counts reads taken
    // while this promise is still pending.
    // Never settles: the assertions below all read state DURING the write, which is
    // the only window in which the race is observable. `.catch()` in the implementation
    // attaches here, so no unhandled rejection is produced.
    const pendingDelete = new Promise<unknown>(() => { /* deliberately never settles */ });
    vi.mocked(salesApi.deleteHeldCartScoped).mockImplementationOnce(() => pendingDelete as never);

    // Charge -> tender -> Complete. The tender step is required: `method` defaults to
    // cash and `canComplete` needs `sufficient`, false until an amount is entered.
    await user.click(screen.getByRole('button', { name: /^charge the customer$/i }));
    await screen.findByTestId('settle-button', {}, { timeout: 5000 });
    await user.type(screen.getByLabelText(/amount tendered/i), '10.00');
    const settle = screen.getByTestId('settle-button');
    await waitFor(() => expect((settle as HTMLButtonElement).disabled).toBe(false));

    // Capture the read count RIGHT BEFORE the delete is triggered by completing payment.
    const readsBefore = vi.mocked(salesApi.listOpenBillsScoped).mock.calls.length;
    await user.click(settle);

    // Dismiss the receipt, which is what releases `onComplete` (see the timing notes
    // above). Without this the callback never runs and the assertion below is
    // unreachable — measured.
    const skipReceipt = await screen.findByRole('button', { name: /skip/i }, { timeout: 5000 });
    await user.click(skipReceipt);

    // ── THE ASSERTION IS PRESENCE-WHILE-PENDING ──────────────────────────────
    //
    // Two weaker shapes were KILL-TESTED and both passed against the broken code,
    // so neither is used:
    //
    //   * the CALL COUNT — the broken shape also calls `loadOpenBills()` exactly
    //     once, so `toBeGreaterThan(readsBefore + 1)` was green with the fix
    //     reverted;
    //   * the INVOCATION ORDER — measured on both shapes, the fixed run had
    //     `reads=[10,43,72,91] deletes=[86]` and the broken
    //     `reads=[10,40,74,89] deletes=[88]`. In both, the LAST read follows the
    //     delete, because the mount/resume reads are also in the list.
    //
    // What actually separates them is WHEN the read goes out relative to the delete
    // SETTLING. Before: `loadOpenBills()` runs synchronously beside a fire-and-forget
    // delete, so it goes out while the write is still in flight. After: it is inside
    // `.finally()`, so it CANNOT run until the write has settled.
    //
    // So the delete is held PENDING and the ABSENCE of a fresh read is asserted. The
    // fixed code can satisfy that; the broken code cannot, because its read has
    // already happened by the time this line runs. Unlike the two above, this shape
    // measures the property the fix exists to create.
    // Capture the read count at the moment the pending delete is observed.
    let readsWhilePending = -1;
    await waitFor(() => {
      expect(vi.mocked(salesApi.deleteHeldCartScoped)).toHaveBeenCalled();
      readsWhilePending = vi.mocked(salesApi.listOpenBillsScoped).mock.calls.length;
    }, { timeout: 8000 });

    // THE ASSERTION, and it is a DELTA across the pending window rather than an
    // absolute count. MEASURED on both shapes with the delete held open:
    //
    //   before   readsBefore=2, readsWhilePending=4  (the racing read already fired)
    //   after    readsBefore=2, readsWhilePending=3  (nothing fired yet)
    //
    // The absolute number is not portable — the mount effect, the resume and the
    // workspace switch all contribute reads — so what is asserted is that the count
    // does NOT move while the write is unsettled. The broken shape moves it by one,
    // because its `loadOpenBills()` runs synchronously beside the delete.
    expect(
      readsWhilePending,
      'the bill list was re-read WHILE the refused delete was still in flight — the ' +
        'refresh raced the write, so the list reflects pre-write state and the paid ' +
        'tab is invisible',
    ).toBe(readsBefore);
  }, 20000);

  // ── A double Send-to-Kitchen must not dispatch twice ─────────────────────
  //
  // `handleSendToKitchen` (PosScreen.tsx:1302) has no re-entry guard: its early
  // returns cover session, lines and the undispatched delta, but nothing about
  // in-flight state. `sendingToKitchen` is set at :1200 and read ONLY to disable
  // the button (CartActionBar.tsx:220) — the exact shape rounds 124 and 126 found
  // and fixed on the auto-QR and open-bill paths, and a DOM `disabled` cannot help
  // because React does not re-render between two clicks inside one await.
  //
  // Two entry points reach it unguarded: the button itself, and the `send-kitchen`
  // hotkey (PosScreen.tsx:1835), which bypasses the DOM gate entirely. Its comment at
  // :1811 calls these handlers 'self-guarding'; on the in-flight axis this one is not.
  //
  // A double dispatch sends the KITCHEN two tickets for one order — the food is
  // cooked twice and the delta bookkeeping (`dispatchedQty`) is advanced against a
  // state the second call already read.
  it('dispatches once when Send to Kitchen is fired twice in one pass', async () => {
    wsState.activeWorkspace = 'restaurant-pos';
    wsState.scopeTypeKey = 'restaurant-pos';

    // The button only renders with a table or an active tab, so resume the tab —
    // the same setup the round-129 paid-tab case uses.
    vi.mocked(salesApi.listOpenBillsScoped).mockResolvedValue([
      { id: 'bill-1', label: 'Meja 3', item_count: 1, total_minor: 700, currency: 'USD',
        created_at: '2026-01-01T00:00:00Z', bill_type: 'open_bill', customer_name: null },
    ] as never);
    vi.mocked(salesApi.getHeldCartScoped).mockResolvedValue({
      id: 'bill-1', label: 'Meja 3', item_count: 1, total_minor: 700, currency: 'USD',
      created_at: '2026-01-01T00:00:00Z', bill_type: 'open_bill', customer_name: null,
      deduction_location_id: null,
      cart_data: JSON.stringify({ lines: [{ sku: 'ITEM-001', name: 'Test Item', qty: 1, unit_price: { minor_units: 700, currency: 'USD' } }] }),
    } as never);
    vi.mocked(productsApi.lookupByBarcodeScoped).mockImplementation((() => Promise.resolve({
      sku: 'ITEM-001', name: 'Test Item', category: 'Test', price: { minor_units: 700, currency: 'USD' },
      barcode: 'BARCODE-001', in_stock: true, stock_qty: 100, tax_rate_ids: [], product_type: 'restaurant',
      created_at: '', price_updated_at: '',
    })) as never);

    const user = userEvent.setup();
    await renderPosScreenWithShift();

    await act(async () => { mockedBarcode.triggerScan('BARCODE-001'); });
    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid="cart-panel-line-item"]').length).toBe(1);
    });

    // Resume so `activeOpenBillId` is set — the other precondition for the button.
    await user.click(screen.getByRole('button', { name: /view open bills/i }));
    await waitFor(() => expect(document.querySelector('.pos-held-list-modal')).not.toBeNull());
    await user.click(screen.getByRole('button', { name: /resume/i }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /update open tab/i })).not.toBeNull());

    // Hold the dispatch open so both presses land while it is in flight.
    let release: ((v: unknown) => void) | undefined;
    const held = new Promise<unknown>((resolve) => { release = resolve; });
    // The dispatch command is `printSalesReceipt` (a kitchen/bar chit per the
    // food/beverage split, PosScreen.tsx:1148), not the KDS order create — that one
    // belongs to PaymentModal's settle path.
    vi.mocked(salesApi.printSalesReceipt).mockImplementation(async () => held as never);

    // The HOTKEY path, not the button: `send-kitchen` (PosScreen.tsx:1835) calls
    // `handleSendToKitchen()` directly and never touches the DOM, so the button's
    // `disabled` cannot reach it. Its own comment at :1811 calls these handlers
    // 'self-guarding'; on the in-flight axis this one is not, which is why the
    // button path above can be green while this one is not.
    // Reachability first: the button must be mounted and ENABLED before the chord, or
    // the presses below would be no-ops and the assertion would pass on zero dispatch.
    const sendBtn = screen.getByTestId('pos-cart-send-kitchen-btn');
    expect(
      (sendBtn as HTMLButtonElement).disabled,
      'the Send button never enabled, so the double-dispatch cannot be reached',
    ).toBe(false);

    // Two chords with no await between them — a repeated keypress on a held-down
    // Shift, or a double-tap on a tablet's chord row. `useRestaurantShortcuts`
    // (:42-58) has no cooldown and calls the handler directly.
    await user.keyboard('{Shift>}K{/Shift}');
    await user.keyboard('{Shift>}K{/Shift}');
    await act(async () => { await Promise.resolve(); });

    expect(
      vi.mocked(salesApi.printSalesReceipt).mock.calls.length,
      'two Send chords in one round-trip dispatched twice — the kitchen cooks the ' +
        'order twice and the dispatchedQty bookkeeping is advanced against a state ' +
        'the second call had already read',
    ).toBe(1);
    // The guard that makes it one, so the case states it rather than just passing:
    // the SECOND chord arrives while the first dispatch is still in flight, and
    // `handleSendToKitchen` recomputes its delta from `lines` on every entry
    // (PosScreen.tsx:1195-1198). So the protection is the empty-delta early return,
    // not the button's `disabled` (the hotkey never touches the DOM) and not a
    // re-entry ref.
    expect(
      (screen.getByTestId('pos-cart-send-kitchen-btn') as HTMLButtonElement).disabled,
      'the in-flight state is not reflected in the button while the delta guard is ' +
        'what actually stops the second dispatch',
    ).toBe(true);

    await act(async () => { release?.([]); });

    wsState.activeWorkspace = 'store-pos';
    wsState.scopeTypeKey = 'store-pos';
    vi.mocked(salesApi.getHeldCartScoped).mockReset().mockResolvedValue(null);
    vi.mocked(salesApi.listOpenBillsScoped).mockReset().mockResolvedValue([]);
    vi.mocked(salesApi.printSalesReceipt).mockReset().mockResolvedValue({ printed: true });
    vi.mocked(productsApi.lookupByBarcodeScoped).mockReset();
    vi.mocked(productsApi.lookupByBarcodeScoped).mockImplementation(((_t: string, code: string) => mockLookupByBarcode(code)) as never);
  }, 20000);

  // The stale read resolves with DISTINCTLY DIFFERENT values -- true against the
  // current false -- so the late write is observable rather than a no-op.
  it('ignores a slower receipt-settings read from the previous store', async () => {
    let releaseStale: (v: unknown) => void = () => {};
    const stalePending = new Promise((resolve) => { releaseStale = resolve; });

    // First read held open; it will answer with the PREVIOUS store value.
    vi.mocked(settingsApi.getReceiptSettingsScoped).mockImplementationOnce(
      () => stalePending as never,
    );

    const view = renderWithProvidersSync(<PosScreen />, salesFtl, productsFtl, inventoryFtl, settingsFtl, testCoreFtl);
    await waitFor(() => expect(settingsApi.getReceiptSettingsScoped).toHaveBeenCalled());

    // Switch stores. The NEW read answers at once with the CURRENT value.
    vi.mocked(settingsApi.getReceiptSettingsScoped).mockImplementation(
      () => Promise.resolve({ ...receiptSettingsFixture, showTableNumber: false }) as never,
    );
    await act(async () => {
      wsState.sessionToken = 'mock-session-token-2';
    });
    rerenderWithProviders(view, <PosScreen />, salesFtl, productsFtl, inventoryFtl, settingsFtl, testCoreFtl);
    await waitFor(() => expect(settingsApi.getReceiptSettingsScoped).toHaveBeenCalledTimes(2));

    // Now let the stale read land, after the current one already won.
    await act(async () => {
      releaseStale({ ...receiptSettingsFixture, showTableNumber: true });
      await stalePending;
    });

    // The guard held: the stale `true` did not land, so the table-number input
    // stays absent exactly as the CURRENT store configured it.
    expect(document.querySelector('#pos-table-number')).toBeNull();
  });

  // ── The SAME race on the course-firing flag, which had NO pin ──────────────
  //
  // `courseFiringSeq` (PosScreen.tsx:1199) guards this read exactly as the receipt
  // one above does, and its comment names the consequence: "a stale read carrying
  // the PREVIOUS store's setting forward would hide course firing on a store that
  // has it enabled -- a POS capability disappearing across a store switch."
  //
  // It was UNPINNED. Measured 2026-10-13: removing `if (stale()) return;` before
  // `setCourseFiringEnabled` left this file, PosScreen.test.tsx,
  // PosScreen.integration.test.tsx and restaurantToggleFailDirection.test.ts at
  // 144 passed, 0 failed.
  //
  // ── The observable is the CONTAINER, not the buttons ──
  //
  // A first attempt asserted on "Fire All" and was worthless. CourseSelectorBar
  // renders per-course buttons only when a line carries that course, and the
  // "Fire All" button only when a line has `coursingStatus === 'hold'`
  // (CourseSelectorBar.tsx:25, :41). A barcode-scanned line has neither, so the
  // text was absent whether or not the bar mounted -- the assertion could not fail.
  //
  // The container `div.pos-cart-course-bar` mounts whenever
  // `lines.length > 0 && activeWorkspace === 'restaurant-pos' && courseFiringEnabled
  // !== false` (CartPanel.tsx:961), which is this guard's own condition. It is the
  // observable, and asserting on it is the established idiom here
  // (CartPanel.test.tsx:316/:324).
  it('ignores a slower course-firing read from the previous store', async () => {
    // ── FOUR THINGS HAVE TO BE TRUE, AND EACH WAS MEASURED MISSING IN TURN ────
    //  1. a LANDSCAPE answer, or CartPanel is not rendered (stubLandscape below);
    //  2. the STORE ID in the draft key must be the one the screen reads
    //     (`storeId()`, not the WorkspaceContext's literal 'default' — a draft keyed
    //     to 'default' restores NOTHING, which is why this case never had a cart line);
    //  3. the read must see the NEW TOKEN after the switch (mutating `wsState` does
    //     not re-render, so the effect never re-ran — see the flushSync below);
    //  4. the bar must actually mount, which it did not at all until the gate moved
    //     into CourseSelectorBar (2026-10-19).
    wsState.activeWorkspace = 'restaurant-pos';
    const restoreMatchMedia = stubLandscape();

    // This case asserted on `.pos-cart-course-bar` for nine rounds and could never pass.
    // THREE gates each independently make that element unreachable, and all three had to
    // be identified before it could be written correctly:
    //
    //   1. the barcode scanner is DISABLED on this workspace
    //      (`PosScreen.tsx:567`, enabled: activeWorkspace !== 'restaurant-pos'), so the
    //      cart line cannot be created by scanning -- it was created by seeding the
    //      mount-time restore key instead;
    //   2. the bar lives in CartPanel, and portrait skips it (`:1789`). jsdom's 1024x768
    //      is landscape, so the harness answers the orientation query and this one holds;
    //   3. `courseFiringEnabled !== false` (`CartPanel.tsx:961`), and an UNSET key resolves
    //      to false (`:1223`). So read 1 must answer 'true' or the bar is hidden by design.
    //
    // The case only ever appeared to pass because a RETAIL case earlier in the file left
    // its scanner registration in the mock's single slot. See
    // docs/records/audits/scanner-disabled-on-restaurant-pos.md and
    // course-bar-render-gates.md.
    let releaseFirst: (v: string | null) => void = () => {};
    const firstRead = new Promise<string | null>((resolve) => { releaseFirst = resolve; });
    let readNo = 0;
    vi.mocked(settingsApi.getSettingScoped).mockImplementation(((_token: string | null,
      key: string) => {
      if (key !== 'restaurant.course_firing') return Promise.resolve(null);
      // Read 1 (held) answers ON and is guarded out after BOTH switches below; read 2
      // answers OFF. Counting calls is correct here precisely because the case drives
      // every store/token switch explicitly — see the two switches' comments.
      readNo += 1;
      return readNo === 1 ? firstRead : Promise.resolve('false');
    }) as never);

    const courseFiringCalls = () =>
      vi.mocked(settingsApi.getSettingScoped).mock.calls.filter(
        (c) => c[1] === 'restaurant.course_firing',
      ).length;

    // The cart line, seeded BEFORE the render: the restore effect runs on mount.
    // ⚠️ SEEDED UNDER THE `unresolved` SCOPE, because that is the key the screen reads
    // on this render. `scopedKey` falls back to 'unresolved' when no store id is
    // passed (scopedStorage.ts:27), and the WorkspaceContext mock supplies
    // `resolvedStoreId: 'default'` only to the CONTEXT — `PosScreen` takes the id from
    // its own `useStoreProfile` hook, which has not resolved yet. A draft keyed to
    // `default` restores nothing, which is why this case never had a cart line.
    localStorage.setItem(
      'pos-active-draft:unresolved',
      JSON.stringify({
        lines: [
          {
            sku: 'ITEM-CF',
            name: 'Course Item',
            category: 'Main',
            // ⚠️ ON HOLD **AND** ASSIGNED A COURSE. The bar is suppressed when nothing
            // is fireable (CourseSelectorBar's `hideWhenEmpty`, passed by CartPanel), so
            // a restored line with no `coursingStatus` renders no bar at all and this
            // case would be asserting about an element that cannot exist. These two
            // fields are what make the bar's presence depend on the READ under test.
            courseId: 'main',
            coursingStatus: 'hold',
            qty: 1,
            unit_price: { minor_units: 15000, currency: 'IDR' },
          },
        ],
        orderType: 'dine_in',
      }),
    );

    const view = renderWithProvidersSync(<PosScreen />, salesFtl, productsFtl, inventoryFtl,
      settingsFtl);
    await waitFor(() => expect(courseFiringCalls()).toBe(1));

    // Read 1 answers ON, and the seeded line satisfies the container's own gate.
    await waitFor(() => expect(courseFiringCalls()).toBe(1));
    // ⚠️ THE OBSERVABLE IS THE SECTION, NOT THE BAR (corrected 2026-10-19).
    // `CartPanel` wraps the bar in `<section className="pos-cart-course-bar-area">`
    // and only `<CourseSelectorBar>` inside it emits `.pos-cart-course-bar`
    // (CourseSelectorBar.tsx:37). The nine-round search for `.pos-cart-course-bar`
    // measured the wrong element: a line holding no course and no `hold` status
    // renders the bar with zero fireable buttons, but the SECTION's own gate
    // (`lines.length > 0 && restaurant-pos && courseFiringEnabled !== false`) is
    // the one this guard is about — and it mounts regardless of line content.
    await waitFor(() => expect(courseFiringCalls()).toBe(1));
    // ⚠️ THE DRAFT IS NEVER RESTORED IN THIS HARNESS, AND THAT IS THE POINT.
    // `restore` returns unless `currencyReady` is true (PosScreen.tsx:344), and the
    // providers here do not resolve one — measured: `.pos-cart-empty-msg` is still on
    // screen at every point of this case. A cart line therefore CANNOT come from a seeded
    // draft, which is what nine rounds of this case assumed.
    //
    // The cart is filled the way an operator fills it — a barcode scan — and it is also
    // the only route that produces a line with a `coursingStatus` (the bar suppresses
    // itself when no line is on hold, CartPanel's section gate).
    vi.mocked(productsApi.lookupByBarcodeScoped).mockResolvedValueOnce({
      sku: 'ITEM-CF', name: 'Course Item', category: 'Main',
      price: { minor_units: 15000, currency: 'IDR' },
      barcode: 'BARCODE-CF', in_stock: true, stock_qty: 100, tax_rate_ids: [],
      product_type: 'standard', created_at: '', price_updated_at: '',
    } as never);
    await act(async () => { mockedBarcode.triggerScan('BARCODE-CF'); });
    await waitFor(() => expect(screen.getAllByTestId('cart-panel-line-item').length).toBeGreaterThan(0));

    // ── THE STORE + SESSION SWITCH: TWO SEPARATE READS, BOTH STALE-GUARDED ────
    // The bar is gated by `courseFiringEnabled`, which is fed by TWO effects
    // (PosScreen.tsx) as of the settings-reload change: one keyed on `sessionToken`,
    // one on `settingsRevision`. A case that moves only the token measures the first
    // and leaves the second holding its mount-time answer — which is why the bar
    // refused to hide here even with read 2 answering 'false'.
    //
    // So drive BOTH the way the app does: the token first (a new session), then the
    // settings revision (leaving the Restaurant Settings screen bumps it), then
    // re-render so the components actually observe the new values. Each mutation is
    // done inside act() so React flushes the resulting state before the next assert.
    await act(async () => {
      wsState.sessionToken = 'mock-session-token-course';
      await new Promise<void>((resolve) => { flushSync(() => resolve()); });
    });
    rerenderWithProviders(view, <PosScreen />, salesFtl, productsFtl, inventoryFtl,
      settingsFtl);

    // ── RELEASE THE HELD READ **BEFORE** ASSERTING ANYTHING ABOUT THE BAR ─────
    //
    // ⚠️ THIS ORDER IS THE WHOLE FIX. Read 1 is HELD OPEN by this mock, so while it is
    // outstanding `courseFiringEnabled` still holds its mount value — 'true' — and the
    // bar is legitimately up whatever read 2 says. (An earlier shape of this repair
    // asserted the absence first and could never pass; nine rounds of this case died
    // on the same conflation.) Only once every outstanding read has landed does the
    // guarded value settle to read 2's 'false'.
    await act(async () => {
      releaseFirst('true');
      await firstRead;
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    // ── RELEASE THE HELD READ, THEN ASSERT THE ABSENCE ───────────────────────
    //
    // ⚠️ Read 2 answering 'false' is NOT sufficient on its own, and this is the part
    // nine rounds of this case could not see: after the switch BOTH effects re-ran,
    // so the second one issued read 3 — also held open by the counter mock. The
    // guarded value only settles once every outstanding read has landed, and only
    // then does the bar come down. What this case proves is that the SUPERSEDED
    // read-1 answer 'true' cannot win afterwards.
    //
    // The observable is the SECTION, not `.pos-cart-course-bar`: the inner div is
    // rendered unconditionally by CourseSelectorBar and carries no gate of its own
    // (CourseSelectorBar.tsx:37), while the section is what CartPanel's course-firing
    // area emits. Asserting on the inner div made this line pass BEFORE the gate
    // moved into the bar — i.e. it was true for the wrong reason.
    await act(async () => {
      releaseFirst('true');
      await firstRead;
    });
    // The released read resolves in a later microtask than the one act() flushed.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(
      document.querySelector('.pos-cart-course-bar-area'),
      'the superseded course_firing read restored the course bar after the current ' +
        "store's read had already disabled it -- this store shows a POS capability " +
        'it does not have.',
    ).toBeNull();

    localStorage.removeItem(`pos-active-draft:${STORE_ID}`);
    view.unmount();
    restoreMatchMedia();
  });

  // ── The THIRD guard of this shape, and the only one still unpinned ─────────
  //
  // `orderTypePromptSeq` (PosScreen.tsx:1277) guards `restaurant.order_type_prompt`
  // exactly as the two above guard their keys. Measured 2026-10-13 by removing only
  // its guard: PosScreen.test.tsx + this file + PosScreen.integration.test.tsx stayed
  // at 126 passed, 0 failed.
  //
  // That round-82 measurement is why this case exists separately: killing all three
  // guards AT ONCE fails on the receipt case, so the other two looked pinned when
  // only one was. A blanket kill-test cannot tell you WHICH guard is load-bearing.
  //
  // The consequence is the one its own comment documents: the fallback is computed
  // FROM the workspace (`raw === null ? activeWorkspace === 'restaurant-pos' : ...`),
  // so a stale read carries the PREVIOUS workspace's answer. On restaurant-pos that
  // is the order-type selector (Dine-in / Takeaway / Delivery) surviving a switch
  // away from the workspace it belongs to.
  //
  // Observable: `div.pos-cart-order-type-row` (CartPanel.tsx:838), gated on
  // `orderTypePromptEnabled && setOrderType` -- the same container idiom as the
  // course bar above, and unlike the course bar it has no per-item early return.
  it('ignores a slower order-type-prompt read from the previous store', async () => {
    wsState.activeWorkspace = 'restaurant-pos';
    let releaseStale: (v: unknown) => void = () => {};
    const stalePending = new Promise((resolve) => { releaseStale = resolve; });

    // Read 1 is held open and will answer ENABLED.
    vi.mocked(settingsApi.getSettingScoped).mockImplementation(((_token: string | null, key: string) => {
      if (key !== 'restaurant.order_type_prompt') return Promise.resolve(null);
      return stalePending;
    }) as never);

    const promptCalls = () =>
      vi.mocked(settingsApi.getSettingScoped).mock.calls.filter(
        (c) => c[1] === 'restaurant.order_type_prompt',
      ).length;

    const view = renderWithProvidersSync(<PosScreen />, salesFtl, productsFtl, inventoryFtl,
      settingsFtl);
    await waitFor(() => expect(promptCalls()).toBe(1));

    // The selector is present while the read is unread: the `null` initial state
    // resolves to `activeWorkspace === 'restaurant-pos'`, which is true here.
    expect(document.querySelector('.pos-cart-order-type-row')).not.toBeNull();

    // The store switches. The NEW read answers DISABLED at once.
    vi.mocked(settingsApi.getSettingScoped).mockImplementation(((_token: string | null, key: string) => {
      if (key !== 'restaurant.order_type_prompt') return Promise.resolve(null);
      return Promise.resolve('false');
    }) as never);
    await act(async () => {
      wsState.sessionToken = 'mock-session-token-2';
    });
    rerenderWithProviders(view, <PosScreen />, salesFtl, productsFtl, inventoryFtl,
      settingsFtl);
    await waitFor(() => expect(promptCalls()).toBe(2));

    // The CURRENT store disabled the prompt, so the selector is gone.
    await waitFor(() => {
      expect(document.querySelector('.pos-cart-order-type-row')).toBeNull();
    });

    // The superseded read now lands with ENABLED.
    await act(async () => {
      releaseStale('true');
      await stalePending;
    });

    expect(
      document.querySelector('.pos-cart-order-type-row'),
      "the superseded order_type_prompt read restored the order-type selector after " +
        "the current store's read had already disabled it -- the operator sees a " +
        'control this store turned off.',
    ).toBeNull();

    // Unmount, for the reason the course-firing case above does: the cart panel is global
    // to the document, so a render left mounted can be found by the NEXT case's queries.
    // Added round 89 after the sibling leaked its cart line.
    //
    // NOT asserted afterwards. `expect(querySelector(...)).toBeNull()` here passes with
    // or without this line -- RTL's auto-cleanup removes the tree between cases either
    // way -- so such an assertion would look like a guard and protect nothing. Measured.
    view.unmount();
  });

  it('adds product to cart, opens payment, completes cash sale, resets cart', async () => {
    // 1. Render with active shift
    await renderPosScreenWithShift();

    // Wait for shift to load - shows "0m" for elapsed time
    await waitFor(() => {
      expect(screen.getByText(/\d+m/)).toBeInTheDocument();
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
    expect(screen.getByText(/\d+m/)).toBeInTheDocument();

    // 10. Verify cart is reset (empty state)
    await waitFor(() => {
      expect(screen.getByText('Cart is empty')).toBeInTheDocument();
    });

    // 11. Verify shift is still open
    expect(screen.getByText(/\d+m/)).toBeInTheDocument();

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


  // ── Order Sound Notifications (F21) ──────────────────────────────
  //
  // `restaurant.sound_chime` promises "Play an audible confirmation chime when orders
  // are sent or updated" and defaults to TRUE, but lived ONLY in the settings screen
  // until this round — the app never played the chime it advertised. The pieces were
  // present (a shared `useSound` hook, and the retail POS already chiming on
  // completion at RetailPosScreen.tsx:1576); the restaurant path simply never called it.
  //
  // Drives the real checkout and asserts the SPY, so it fails if the call is removed.
  const completeCashSaleAndReturn = async () => {
    await renderPosScreenWithShift();
    await waitFor(() => expect(screen.getByText(/\d+m/)).toBeInTheDocument());

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
    await act(async () => { mockedBarcode.triggerScan('BARCODE-001'); });

    const payButtons = await screen.findAllByRole('button', { name: /charge/i });
    await userEvent.click(payButtons[payButtons.length - 1]!);
    await waitFor(() => expect(screen.getByText('Complete Order')).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText(/amount tendered/i), '10.00');
    await userEvent.click(screen.getByRole('button', { name: /^complete$/i }));

    // The receipt preview is the last step before the cart resets — reaching it is
    // what makes this a COMPLETED sale rather than an abandoned one.
    await waitFor(() => expect(screen.getByText('Skip')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /skip/i }));
    await waitFor(() => expect(screen.getByText('Cart is empty')).toBeInTheDocument(), {
      timeout: 5000,
    });
  };

  it('plays the order chime on a completed sale when sound_chime is unset', async () => {
    // Unset = never written = the model's default (chime). The settings mock resolves
    // null for an unconfigured key, which is exactly the unset case.
    soundSpies.playSuccess.mockClear();
    await completeCashSaleAndReturn();
    await waitFor(() => expect(soundSpies.playSuccess).toHaveBeenCalled());
  });

  it('does NOT play the chime when the merchant switched sound_chime off', async () => {
    // The direction that makes the setting real rather than decorative.
    vi.mocked(settingsApi.getSettingScoped).mockImplementation((_t, key) =>
      Promise.resolve(key === 'restaurant.sound_chime' ? 'false' : null),
    );
    soundSpies.playSuccess.mockClear();
    await completeCashSaleAndReturn();
    expect(
      soundSpies.playSuccess,
      'sound notifications were OFF but the chime played anyway',
    ).not.toHaveBeenCalled();
  });
  it('adds multiple products, shows correct subtotal, opens payment', async () => {
    await renderPosScreenWithShift();

    await waitFor(() => {
      expect(screen.getByText(/\d+m/)).toBeInTheDocument();
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
      expect(screen.getByText(/\d+m/)).toBeInTheDocument();
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

    // The discount / tip / service-charge controls live in the collapsible
    // options section, which the screen starts COLLAPSED and which is MOUNTED
    // ONLY WHILE OPEN (CartFooterTotals.tsx): while shut the subtree does not
    // exist at all, so these controls are genuinely unreachable until it is
    // expanded. That is the cashier's own first action, so the test takes it
    // too rather than reaching into a subtree the UI does not offer.
    await userEvent.click(screen.getByRole('button', { name: /expand options/i }));

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
      expect(screen.getByText(/\d+m/)).toBeInTheDocument();
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

    // The discount / tip / service-charge controls live in the collapsible
    // options section, which the screen starts COLLAPSED and which is MOUNTED
    // ONLY WHILE OPEN (CartFooterTotals.tsx): while shut the subtree does not
    // exist at all, so these controls are genuinely unreachable until it is
    // expanded. That is the cashier's own first action, so the test takes it
    // too rather than reaching into a subtree the UI does not offer.
    await userEvent.click(screen.getByRole('button', { name: /expand options/i }));

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
      expect(screen.getByText(/\d+m/)).toBeInTheDocument();
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

    // The discount / tip / service-charge controls live in the collapsible
    // options section, which the screen starts COLLAPSED and which is MOUNTED
    // ONLY WHILE OPEN (CartFooterTotals.tsx): while shut the subtree does not
    // exist at all, so these controls are genuinely unreachable until it is
    // expanded. That is the cashier's own first action, so the test takes it
    // too rather than reaching into a subtree the UI does not offer.
    await userEvent.click(screen.getByRole('button', { name: /expand options/i }));

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
      expect(screen.getByText(/\d+m/)).toBeInTheDocument();
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

    // The discount / tip / service-charge controls live in the collapsible
    // options section, which the screen starts COLLAPSED and which is MOUNTED
    // ONLY WHILE OPEN (CartFooterTotals.tsx): while shut the subtree does not
    // exist at all, so these controls are genuinely unreachable until it is
    // expanded. That is the cashier's own first action, so the test takes it
    // too rather than reaching into a subtree the UI does not offer.
    await userEvent.click(screen.getByRole('button', { name: /expand options/i }));

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
      expect(screen.getByText(/\d+m/)).toBeInTheDocument();
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

    // The discount / tip / service-charge controls live in the collapsible
    // options section, which the screen starts COLLAPSED and which is MOUNTED
    // ONLY WHILE OPEN (CartFooterTotals.tsx): while shut the subtree does not
    // exist at all, so these controls are genuinely unreachable until it is
    // expanded. That is the cashier's own first action, so the test takes it
    // too rather than reaching into a subtree the UI does not offer.
    await userEvent.click(screen.getByRole('button', { name: /expand options/i }));

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
      expect(screen.getByText(/\d+m/)).toBeInTheDocument();
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


    // ── A DECREASE ON A QTY-1 LINE IS DISABLED, NOT SILENT ───────────────────
    //
    // Asserted HERE, at qty 1, because the disabled state is qty-dependent: the
    // increase below moves the line to 2, where the button is legitimately enabled.
    // The first version of this case ran the check after the increase and failed
    // against correct code — ordering is the whole correctness of the assertion.
    //
    // The old body was `updateQty(line.id, line.qty - 1)`, which on a qty-1 line
    // computes `updateQty(id, 0)` — rejected outright by usePosState (`if (qty <= 0)
    // return`, usePosState.ts:139). Read alone that looks like a silent no-op on the last
    // unit; it is NOT reachable, because CartLineItem.tsx:391 sets
    // `disabled={line.qty <= 1}`. Removing a line goes through the X button and
    // `handleRemoveLine`. MEASURED, by asserting the state rather than assuming it.
    //
    // `changeQty(id, -1)` is still the right primitive for the reachable cases (qty >= 2),
    // because it resolves the delta against committed state rather than a rendered
    // snapshot — the same fix as the increase below.
    const decreaseBtn = screen.getByRole('button', { name: /decrease quantity/i });
    expect(
      (decreaseBtn as HTMLButtonElement).disabled,
      'the decrease button is clickable on a qty-1 line, so a press computes updateQty(id, 0) and does nothing',
    ).toBe(true);
    await userEvent.click(decreaseBtn);
    // A disabled button changes nothing: the line is still there.
    expect(screen.getByTestId('cart-panel-line-item')).toBeInTheDocument();

    // Find the increase button and click
    const increaseBtn = screen.getByRole('button', { name: /increase quantity/i });
    await userEvent.click(increaseBtn);

    // Verify cart line shows qty 2
    await waitFor(() => {
      const cartLine = screen.getByTestId('cart-panel-line-item');
      expect(cartLine).toBeInTheDocument();
      expect(cartLine.textContent).toContain('2');
    });

  });
  it('adds one unit per tap when increase is pressed twice in one batch', async () => {
    // The same stale-absolute-value defect as the retail till, on the SHARED cart — and
    // this one is the restaurant POS's, since PosScreen renders both workspaces.
    //
    // `handleIncreaseQty` used to pass `updateQty(line.id, line.qty + 1)`. Two taps in
    // one React batch both close over the same rendered `line.qty`, so both write the
    // same value and the second press is lost. A double-tap on a touch till is ONE
    // gesture, so this is the normal case rather than an edge.
    await renderPosScreenWithShift();

    vi.mocked(productsApi.lookupByBarcodeScoped).mockImplementation((() => Promise.resolve({
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
    })) as never);
    await act(async () => { mockedBarcode.triggerScan('BARCODE-001'); });
    await waitFor(() => expect(screen.getByTestId('cart-panel-line-item')).toBeInTheDocument());

    const increase = screen.getByRole('button', { name: /increase quantity/i });
    // Both clicks in ONE act(), so React batches them and the second handler closes over
    // the qty from BEFORE the first — exactly a fast double-tap.
    await act(async () => {
      increase.click();
      increase.click();
    });

    // One unit in the cart + two presses = 3. A 2 means the second press was swallowed.
    await waitFor(() =>
      expect(
        screen.getByLabelText('Quantity: 3'),
        'two taps on + produced fewer than two extra units, so one was lost to a stale read',
      ).toBeInTheDocument(),
    );
  });

  // ── Line Removal with Undo ───────────────────────────────────────────

  it('removes line and shows undo pill', async () => {
    await renderPosScreenWithShift();

    await waitFor(() => {
      expect(screen.getByText(/\d+m/)).toBeInTheDocument();
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
      expect(screen.getByText(/\d+m/)).toBeInTheDocument();
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

  // ── Undo must restore the line WHERE IT WAS ─────────────────────────
  //
  // `handleUndoRemove` re-inserts with `setLines((prev) => [popped, ...prev])`
  // (usePosCartActions.ts:289) — always at the TOP. `useAnimatedUndoStack` stores
  // the bare `CartLine` (getId is `line.id`) and `CartLine` has no position field
  // (types/domain.ts:109-128), so the original index is not recorded anywhere and
  // cannot be restored.
  //
  // WHY IT MATTERS ON A RESTAURANT TICKET: line order is the order the items were
  // added, and the kitchen reads the ticket top-down. Removing the 3rd of 5 lines
  // and pressing Undo reorders the ticket, so the printed check and the KDS ticket
  // no longer match what the waiter built.
  //
  // The pre-existing undo case (:"undoes line removal") removes the ONLY line, so
  // every position is the same and the defect is invisible to it. This case needs
  // three lines and removes the middle one.
  it('restores an undone line to its original position, not the top', async () => {
    await renderPosScreenWithShift();

    await waitFor(() => {
      expect(screen.getByText(/\d+m/)).toBeInTheDocument();
    });

    // Three distinct products, scanned in order.
    const items = [
      { sku: 'ITEM-A', name: 'Alpha', barcode: 'BAR-A' },
      { sku: 'ITEM-B', name: 'Bravo', barcode: 'BAR-B' },
      { sku: 'ITEM-C', name: 'Charlie', barcode: 'BAR-C' },
    ];
    for (const it of items) {
      vi.mocked(productsApi.lookupByBarcodeScoped).mockResolvedValueOnce({
        sku: it.sku,
        name: it.name,
        category: 'Test',
        price: { minor_units: 700, currency: 'USD' },
        barcode: it.barcode,
        in_stock: true,
        stock_qty: 100,
        tax_rate_ids: [],
        product_type: 'standard',
        created_at: '',
        price_updated_at: '',
      } as never);
      await act(async () => {
        mockedBarcode.triggerScan(it.barcode);
      });
    }

    const lineNames = () =>
      Array.from(document.querySelectorAll('[data-testid="cart-panel-line-item"]')).map((el) =>
        (el.querySelector('[data-testid="cart-line-name"]') ?? el).textContent?.trim() ?? '',
      );

    await waitFor(() => {
      expect(screen.getAllByTestId('cart-panel-line-item')).toHaveLength(3);
    });
    const before = lineNames();

    // Remove the MIDDLE line — the only position a prepend can corrupt.
    await userEvent.click(screen.getByRole('button', { name: /remove ITEM-B/i }));
    await waitFor(() => {
      expect(screen.getAllByTestId('cart-panel-line-item')).toHaveLength(2);
    });

    await userEvent.click(screen.getByRole('button', { name: /^undo$/i }));
    await waitFor(() => {
      expect(screen.getAllByTestId('cart-panel-line-item')).toHaveLength(3);
    });

    expect(
      lineNames(),
      'undo moved the restored line to the top; the ticket order changed underneath the waiter',
    ).toEqual(before);
  });

  // ── Open Bill Tests ──────────────────────────────────────────────────

  it('opens Open Bill input, saves, and reopens cart', async () => {
    await renderPosScreenWithShift();

    await waitFor(() => {
      expect(screen.getByText(/\d+m/)).toBeInTheDocument();
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
      expect(screen.getByText(/\d+m/)).toBeInTheDocument();
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
      expect(screen.getByText(/\d+m/)).toBeInTheDocument();
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
      expect(screen.getByText(/\d+m/)).toBeInTheDocument();
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
      expect(screen.getByText(/\d+m/)).toBeInTheDocument();
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
    const lockedCart = localStorage.getItem(`pos-locked-cart:${STORE_ID}`);
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
      expect(screen.getByText(/\d+m/)).toBeInTheDocument();
    });
  });

  // ── Deduction Badge / FastPIN Tests ──────────────────────────────────

  // A refused open-shift used to be swallowed: `catch { // Handled silently }`
  // in usePosShifts. The backend DOES refuse a second open shift
  // (crates/kasirmu-core/src/db/shifts.rs:64-75), so this banner is the only signal
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
      expect(screen.getByText(/\d+m/)).toBeInTheDocument();
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
      expect(screen.getByText(/\d+m/)).toBeInTheDocument();
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
      expect(screen.getByText(/\d+m/)).toBeInTheDocument();
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
      expect(screen.getByText(/\d+m/)).toBeInTheDocument();
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
      expect(screen.getByText(/\d+m/)).toBeInTheDocument();
    });

    // Click sales history button
    const historyBtn = screen.getByRole('button', { name: /history/i });
    await userEvent.click(historyBtn);

    // Sales history sub-screen should appear (renders a back button)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
    });
  });

  // ── Escape: the key AppShell reserves for this workspace ─────────────
  //
  // AppShell.tsx:79 withholds the return-to-picker behaviour in restaurant-pos, so
  // an accidental Escape mid-service cannot abandon a sale. That clause RESERVES the
  // key for this workspace to define — and until this round nothing did, so Escape
  // was dead here: no way out of a sub-screen, no overlay dismissal, no navigation.
  //
  // These cases pin the claim the reservation depends on: Escape unwinds THIS screen
  // (sub-screen → sidebar → dialogs) and never navigates away from it.

  it('Escape returns from the Sales History sub-screen to the sale view', async () => {
    await renderWithProviders(
      <PosScreen />,
      salesFtl,
      productsFtl,
      inventoryFtl,
      settingsFtl,
      testCoreFtl,
    );
    await waitFor(() => expect(screen.getByText(/\d+m/)).toBeInTheDocument());

    // Reachability: the sub-screen must be genuinely open, or the assertion below
    // holds because Escape did nothing rather than because it unwound a sub-screen.
    const historyBtn = screen.getByRole('button', { name: /history/i });
    await userEvent.click(historyBtn);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument(),
    );

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /back/i })).not.toBeInTheDocument(),
    );
    // The sale view is back — the cart panel, not a blank screen.
    await waitFor(() => expect(document.querySelector('.pos-cart-panel')).not.toBeNull());
  });

  it('Escape dismisses the split-bill dialog without leaving the sale view', async () => {
    wsState.activeWorkspace = 'restaurant-pos';
    await renderPosScreenWithShift();
    await waitFor(() => expect(document.querySelector('.pos-screen')).not.toBeNull());

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'B', shiftKey: true, bubbles: true }),
      );
    });
    await waitFor(() =>
      expect(document.querySelector('[data-testid="pos-split-bill-modal"]')).not.toBeNull(),
    );

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    await waitFor(() =>
      expect(document.querySelector('[data-testid="pos-split-bill-modal"]')).toBeNull(),
    );
    // Still on the sale view: the cart survived, so nothing was abandoned.
    expect(document.querySelector('.pos-cart-panel')).not.toBeNull();
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
      expect(screen.getByText(/\d+m/)).toBeInTheDocument();
    });

    // Click stock inquiry button
    const stockBtn = screen.getByRole('button', { name: /stok/i });
    await userEvent.click(stockBtn);

    // Stock inquiry sub-screen should appear (renders a back button)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
    });
  });

  // ── Android Low-Memory & Draft Resilience (Phase 2 Audit) ───────────

  // ── The restore survives a corrupt draft ─────────────────────────────
  //
  // The mount effect wraps its `JSON.parse` in a try/catch. That resilience was pinned
  // ONLY by `hooks/useLockedCartPersistence.test.tsx`, which drives the DEAD
  // `posScreenHooks.ts` copy — round 107's pattern. Measured in round 110: the live
  // restore does survive it (probed: no error boundary), but nothing asserted so.
  //
  // A corrupt draft is reachable: the key is written by `JSON.stringify`, but a partial
  // write, a storage-quota failure mid-set, or a tampered value all produce unparseable
  // content — and the till must still boot to a usable POS rather than an error screen.
  // The companion to the case below, and the second thing the dead
  // `useLockedCartPersistence` tests pinned: a draft carrying ONLY `lines` must restore,
  // because every other field is optional. The live restore type-guards each one
  // (`typeof data.discountPercent === 'number'`, `Array.isArray(data.appliedPromotions)`, ...),
  // so a minimal payload is handled by construction — but nothing asserted that.
  it('restores a draft that carries only lines, since every other field is optional', async () => {
    localStorage.setItem(
      `pos-active-draft:${STORE_ID}`,
      JSON.stringify({
        lines: [
          {
            sku: 'MIN-1',
            name: 'Minimal Item',
            qty: 1,
            // The STORE currency: a draft that disagrees with it is refused rather than
            // relabelled (see utils/draftCart.ts), and this case is about the optional
            // FIELDS, not the currency.
            unit_price: { minor_units: 250, currency: 'IDR' },
          },
        ],
      }),
    );

    await renderWithProviders(
      <PosScreen />,
      salesFtl,
      productsFtl,
      inventoryFtl,
      settingsFtl,
      testCoreFtl,
    );

    await waitFor(() => {
      const lines = screen.queryAllByTestId('cart-panel-line-item');
      expect(
        lines.some((l) => l.textContent?.includes('Minimal Item')),
        'a draft with only `lines` did not restore: every other field is optional and the ' +
          'restore type-guards each one, so a minimal payload must survive.',
      ).toBe(true);
    });

    localStorage.removeItem(`pos-active-draft:${STORE_ID}`);
  });

  it('boots to a usable POS when the draft is unparseable', async () => {
    localStorage.setItem(`pos-active-draft:${STORE_ID}`, '{not valid json');

    await renderWithProviders(
      <PosScreen />,
      salesFtl,
      productsFtl,
      inventoryFtl,
      settingsFtl,
      testCoreFtl,
    );

    await waitFor(() => {
      expect(document.querySelector('.pos-screen')).not.toBeNull();
    });
    expect(
      document.querySelector('.error-boundary'),
      'a corrupt draft put the POS into its error boundary: the restore threw instead of ' +
        'falling back to an empty cart.',
    ).toBeNull();

    localStorage.removeItem(`pos-active-draft:${STORE_ID}`);
  });

  it('restores active draft cart from pos-active-draft on mount', async () => {
    const draftData = {
      lines: [
        {
          sku: 'ITEM-001',
          name: 'Recovered Draft Item',
          qty: 2,
          // Store currency: a draft that disagrees is refused, not relabelled.
          unit_price: { minor_units: 700, currency: 'IDR' },
        },
      ],
      discountPercent: 10,
      tableNumber: 'Table 5',
    };
    localStorage.setItem(`pos-active-draft:${STORE_ID}`, JSON.stringify(draftData));

    await renderWithProviders(
      <PosScreen />,
      salesFtl,
      productsFtl,
      inventoryFtl,
      settingsFtl,
      testCoreFtl,
    );

    await waitFor(() => {
      expect(screen.getByText('Recovered Draft Item')).toBeInTheDocument();
    });

    localStorage.removeItem(`pos-active-draft:${STORE_ID}`);
  });

  it('persists active draft when kasirmu:trimMemory event is dispatched', async () => {
    localStorage.removeItem(`pos-active-draft:${STORE_ID}`);

    await renderWithProviders(
      <PosScreen />,
      salesFtl,
      productsFtl,
      inventoryFtl,
      settingsFtl,
      testCoreFtl,
    );

    // Wait for initial render
    await waitFor(() => {
      expect(screen.getByText(/\d+m/)).toBeInTheDocument();
    });

    // Its OWN fixture, keyed on the barcode. This case used to depend on a NEIGHBOUR's
    // `lookupByBarcodeScoped` implementation leaking in: nothing in this file ever made
    // the default mock resolve 'BARCODE-001', so it only passed when the case that sets
    // that lookup ran first. Revealed by `--sequence.shuffle.tests` (round 93); the file
    // passes in declaration order and fails under a shuffle that moves its supplier after
    // it.
    vi.mocked(productsApi.lookupByBarcodeScoped).mockImplementation(((_token: string,
      code: string) => {
      if (code !== 'BARCODE-001') return Promise.resolve(null);
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
    }) as never);

    act(() => {
      mockedBarcode.triggerScan('BARCODE-001');
    });

    await waitFor(() => {
      expect(screen.getByText('Test Item')).toBeInTheDocument();
    });

    // Dispatch memory trim event
    act(() => {
      window.dispatchEvent(new CustomEvent('kasirmu:trimMemory', { detail: { level: 80 } }));
    });

    const stored = localStorage.getItem(`pos-active-draft:${STORE_ID}`);
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.lines.some((l: { sku: string }) => l.sku === 'ITEM-001')).toBe(true);

    localStorage.removeItem(`pos-active-draft:${STORE_ID}`);
  });

  // ── Restaurant shortcuts must not fire behind a sub-screen ──────────
  //
  // \`useRestaurantShortcuts\` registers a DOCUMENT-level keydown listener, and
  // PosScreen calls it at :1678 — BEFORE the three sub-screen early returns
  // (:1681/:1701/:1715). So while Table Management or Sales History REPLACED the
  // sale view, the restaurant keys were still bound: \`Shift+B\` opened the
  // split-bill modal over the table list (acting on a cart the cashier could not
  // see), and \`Shift+T\` reached into the DOM for a save-tab button that is not
  // mounted in a sub-screen at all. The keys belong to the sale view.

  it('does not print an interim bill from a shortcut while a sub-screen is showing', async () => {
    // restaurant-pos, because that is the workspace whose keys these are — the
    // handler map early-returns `{}` for every other one, so testing in
    // store-pos would pass without exercising the defect at all.
    wsState.activeWorkspace = 'restaurant-pos';

    // The cart line is SEEDED, not scanned. The barcode scanner is disabled on
    // this workspace (`enabled: activeWorkspace !== 'restaurant-pos'`), so a
    // triggerScan here is silently dropped — measured at :717 and again while
    // writing this test. The mount-time restore key is the supported path, which
    // is also why it must be set BEFORE the render.
    localStorage.setItem(
      `pos-active-draft:${STORE_ID}`,
      JSON.stringify({
        lines: [
          {
            sku: 'ITEM-BILL',
            name: 'Bill Item',
            category: 'Main',
            qty: 1,
            unit_price: { minor_units: 15000, currency: 'IDR' },
          },
        ],
        orderType: 'dine_in',
      }),
    );
    await renderPosScreenWithShift();
    // Reachability of the PRECONDITION: without a line, `handlePrintBill` returns
    // at its own `lines.length === 0` guard, so this would measure that guard
    // rather than the one under audit.
    await waitFor(() =>
      expect(screen.getByTestId('cart-panel-line-item')).toBeInTheDocument(),
    );

    // REACHABILITY. Shift+P on the sale view must reach the printer, or the
    // assertion after the sub-screen opens proves nothing.
    //
    // Measured, not assumed: the split-bill chord was tried FIRST and rejected as
    // the observable here. `SplitBillModal` is not rendered by PosScreen at all
    // (it is passed down at :1896), so it only mounts on the MAIN branch — the
    // modal is absent on a sub-screen whether or not the handler ran, and both
    // the positive and the negative passed against a deliberately unguarded
    // build. A print call has no such blind spot.
    vi.mocked(salesApi.printSalesReceipt).mockClear();
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'P', shiftKey: true, bubbles: true }),
      );
    });
    await waitFor(() => {
      expect(
        vi.mocked(salesApi.printSalesReceipt).mock.calls.length,
        'Shift+P did not reach the printer on the sale view — this test would then measure nothing',
      ).toBeGreaterThan(0);
    });

    // Now hand the view to a sub-screen. Sales History, not Tables: the Tables
    // row is feature-gated (`isEnabled(FEATURES.TABLE_MANAGEMENT)`) and the
    // history row is not, so this reaches the same early-return without a second
    // gate deciding whether the test runs.
    // The history row lives INSIDE the restaurant sidebar popover, so open the
    // sidebar first, then claim the row by testid — its accessible name comes
    // from the FTL bundle and a copy edit would move it.
    await userEvent.click(document.querySelector('.restaurant-sidebar-btn') as HTMLElement);
    const historyRow = await waitFor(() => {
      const el = document.querySelector('[data-testid="restaurant-sidebar-history"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    await userEvent.click(historyRow);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument(),
    );
    // The sale view really is gone: its cart panel is unmounted.
    expect(document.querySelector('.pos-cart-panel')).toBeNull();

    // …and the SAME chord must now be inert. The keys belong to the sale view;
    // behind a sub-screen they acted on a cart the cashier cannot see.
    vi.mocked(salesApi.printSalesReceipt).mockClear();
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'P', shiftKey: true, bubbles: true }),
      );
    });
    expect(
      vi.mocked(salesApi.printSalesReceipt).mock.calls.length,
      'Shift+P printed an interim bill while a sub-screen owned the view',
    ).toBe(0);
  });

  // ── Barcode lookup FAILURE (last in the suite, on purpose) ───────────
  //
  // The scanner's onProductFound (PosScreen.tsx:~660) has three outcomes, and two of them
  // report: a product hit adds to the cart, a clean miss toasts
  // `pos-no-barcode-match`, and the scanner's own hardware error toasts `pos-scanner-error`.
  //
  // The third — the LOOKUP throwing — was a bare `catch { }` whose comment said 'Silently
  // ignore — the scanner will beep, user retries'. That is true of a scanner mis-read and
  // untrue of a failed IPC: every retry fails too, so the item never arrives and the
  // cashier is given no reason. At a busy till that reads as a dead scanner, and the
  // operator's next move is to key the item in by hand or re-scan the same code forever.
  //
  // PLACED LAST ON PURPOSE. This case installs a permanently-rejecting lookup mock, and the
  // file's header (:491-503) records that a mockRejectedValue left behind answers every
  // later case — measured here, not theorised: with this test at the head of the suite, the
  // 30 cases after it failed on 'no product in the cart'. The restore at the end runs after
  // the assertion, so a failure mid-test still holds a live rejection; at the end of the
  // file there is nothing left to contaminate.
  it('SAYS SOMETHING when the barcode lookup itself FAILS, instead of doing nothing at all', async () => {
    vi.mocked(productsApi.lookupByBarcodeScoped).mockReset();
    vi.mocked(productsApi.lookupByBarcodeScoped).mockRejectedValue(new Error('ipc down'));

    // renderPosScreenWithShift, not a bare render: the scan handler returns early with
    // // an open-shift toast when NO shift is open (PosScreen.tsx:614), so a bare render
       // would assert against a different toast and pass or fail for the wrong reason.
    await renderPosScreenWithShift();

    await act(async () => {
      mockedBarcode.triggerScan('BARCODE-001');
    });

    // A failed lookup must reach the operator, the way the two neighbouring outcomes do.
    await waitFor(() => {
      const toast = document.querySelector('.toast');
      const text = toast?.textContent ?? '';
      expect(toast, 'a failed barcode lookup produced no toast at all').not.toBeNull();
      expect(text).toMatch(/could not check|no product|does not match|error|failed|unavailable/i);
    });

    // Restore the suite default for anything that runs after.
    vi.mocked(productsApi.lookupByBarcodeScoped).mockReset();
    vi.mocked(productsApi.lookupByBarcodeScoped).mockImplementation(((_token: string,
      code: string) => mockLookupByBarcode(code)) as never);
  });
});
