// ── PosScreen TDD: Core Sale Flow (Red → Green → Refactor) ─────────────
//
// Target: Exercise the critical path: add product → cart → pay → complete
// Current coverage: ~52% statements, ~55% branches
// Goal: Push to >80% by covering uncovered branches in this flow

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
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
    wsState.activeWorkspace = 'restaurant-pos';

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
      readNo += 1;
      // Read 1 (held) answers ON; read 2 answers OFF after the store switch.
      return readNo === 1 ? firstRead : Promise.resolve('false');
    }) as never);

    const courseFiringCalls = () =>
      vi.mocked(settingsApi.getSettingScoped).mock.calls.filter(
        (c) => c[1] === 'restaurant.course_firing',
      ).length;

    // The cart line, seeded BEFORE the render: the restore effect runs on mount.
    localStorage.setItem(
      `pos-active-draft:${STORE_ID}`,
      JSON.stringify({
        lines: [
          {
            sku: 'ITEM-CF',
            name: 'Course Item',
            category: 'Main',
            qty: 1,
            unit_price: { minor_units: 15000, currency: 'USD' },
          },
        ],
        orderType: 'dine_in',
      }),
    );

    const view = renderWithProvidersSync(<PosScreen />, salesFtl, productsFtl, inventoryFtl,
      settingsFtl);
    await waitFor(() => expect(courseFiringCalls()).toBe(1));

    // Read 1 answers ON, and the seeded line satisfies the container's own gate.
    await waitFor(() => {
      expect(document.querySelector('.pos-cart-course-bar')).not.toBeNull();
    });

    // Store switch: read 2 is issued and settles with DISABLED.
    await act(async () => {
      wsState.sessionToken = 'mock-session-token-course';
    });
    rerenderWithProviders(view, <PosScreen />, salesFtl, productsFtl, inventoryFtl,
      settingsFtl);
    await waitFor(() => expect(courseFiringCalls()).toBe(2));
    await waitFor(() => {
      expect(document.querySelector('.pos-cart-course-bar')).toBeNull();
    });

    // Read 1 settles NOW -- after read 2 already won -- with the opposite value.
    await act(async () => {
      releaseFirst('true');
      await firstRead;
    });

    expect(
      document.querySelector('.pos-cart-course-bar'),
      "the superseded course_firing read restored the course bar after the current " +
        "store's read had already disabled it -- this store shows a POS capability " +
        'it does not have.',
    ).toBeNull();

    localStorage.removeItem(`pos-active-draft:${STORE_ID}`);
    view.unmount();
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
  // Observable: `div.pos-cart-order-type-row` (CartPanel.tsx:804), gated on
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
    await waitFor(() => expect(screen.getByText('0m')).toBeInTheDocument());

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
      expect(screen.getByText('0m')).toBeInTheDocument();
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
          unit_price: { minor_units: 700, currency: 'USD' },
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
      expect(screen.getByText('0m')).toBeInTheDocument();
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
});