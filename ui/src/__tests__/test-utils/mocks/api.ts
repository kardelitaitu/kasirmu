// ── Shared API mocks ────────────────────────────────────────────────
//
// Factory functions for commonly-mocked API modules. Each factory
// returns a vi.fn()-based mock object that matches the real module's
// exports. Pass overrides to customise return values for specific tests.
//
// Usage:
//   import { createSalesApiMock } from '@/__tests__/test-utils/mocks/api';
//   vi.mock('@/api/sales', () => createSalesApiMock());

import { vi } from 'vitest';

// ── sales ─────────────────────────────────────────────────────────

export interface SalesApiOverrides {
  completeSale?: ReturnType<typeof vi.fn>;
  startSale?: ReturnType<typeof vi.fn>;
  addLine?: ReturnType<typeof vi.fn>;
  holdCart?: ReturnType<typeof vi.fn>;
  printSalesReceipt?: ReturnType<typeof vi.fn>;
  getSale?: ReturnType<typeof vi.fn>;
  finalizeSale?: ReturnType<typeof vi.fn>;
  voidPendingSale?: ReturnType<typeof vi.fn>;
  holdCartScoped?: ReturnType<typeof vi.fn>;
  listHeldCartsScoped?: ReturnType<typeof vi.fn>;
  getHeldCartScoped?: ReturnType<typeof vi.fn>;
  deleteHeldCartScoped?: ReturnType<typeof vi.fn>;
  startSaleScoped?: ReturnType<typeof vi.fn>;
  addLineScoped?: ReturnType<typeof vi.fn>;
  setCartDiscountScoped?: ReturnType<typeof vi.fn>;
  completeSaleScoped?: ReturnType<typeof vi.fn>;
  listSalesScoped?: ReturnType<typeof vi.fn>;
  getCartDeductionLocationScoped?: ReturnType<typeof vi.fn>;
  getSaleScoped?: ReturnType<typeof vi.fn>;
  finalizeSaleScoped?: ReturnType<typeof vi.fn>;
  voidPendingSaleScoped?: ReturnType<typeof vi.fn>;
  voidSaleScoped?: ReturnType<typeof vi.fn>;
  processRefundScoped?: ReturnType<typeof vi.fn>;
  listRefundsScoped?: ReturnType<typeof vi.fn>;
  exportDailySummaryScoped?: ReturnType<typeof vi.fn>;
  exportSalesByHourScoped?: ReturnType<typeof vi.fn>;
  exportEodReportScoped?: ReturnType<typeof vi.fn>;
  listOpenBillsScoped?: ReturnType<typeof vi.fn>;
}

export function createSalesApiMock(overrides: SalesApiOverrides = {}) {
  return {
    holdCart: vi.fn(() => Promise.resolve({ id: 'held-1' })),
    listHeldCarts: vi.fn(() => Promise.resolve([])),
    getHeldCart: vi.fn(() => Promise.resolve(null)),
    deleteHeldCart: vi.fn(() => Promise.resolve()),
    startSale: vi.fn(() => Promise.resolve({ cartId: 'cart-1' })),
    getCartDeductionLocation: vi.fn(() => Promise.resolve(null)),
    addLine: vi.fn(() => Promise.resolve({ lineId: 'line-added-1', lineTotal: null })),
    setCartDiscount: vi.fn(() => Promise.resolve()),
    completeSale: vi.fn(() => Promise.resolve({ saleId: 'sale-1', total: { minor_units: 3500, currency: 'IDR' }, lineCount: 1 })),
    listSales: vi.fn(() => Promise.resolve({ sales: [], salesHistoryCapped: false })),
    getSale: vi.fn(() => Promise.resolve(null)),
    finalizeSale: vi.fn(() => Promise.resolve()),
    voidPendingSale: vi.fn(() => Promise.resolve()),
    voidSale: vi.fn(),
    processRefund: vi.fn(() => Promise.resolve({ refundId: 'refund-1', totalMinor: 0 })),
    listRefunds: vi.fn(() => Promise.resolve([])),
    exportDailySummary: vi.fn(() => Promise.resolve([])),
    exportSalesByHour: vi.fn(() => Promise.resolve([])),
    exportEodReport: vi.fn(() => Promise.resolve(null)),
    printSalesReceipt: vi.fn(() => Promise.resolve({ printed: true })),
    onReceiptPrinted: vi.fn(),
    getProductTrackSerialBatchScoped: vi.fn((_token: string, _skus: string[]) => Promise.resolve([])),
    holdCartScoped: vi.fn((_token: string) => Promise.resolve({ id: 'held-1' })),
    listHeldCartsScoped: vi.fn((_token: string) => Promise.resolve([])),
    getHeldCartScoped: vi.fn((_token: string, _id: string) => Promise.resolve(null)),
    deleteHeldCartScoped: vi.fn((_token: string, _id: string) => Promise.resolve()),
    listOpenBillsScoped: vi.fn((_token: string) => Promise.resolve([])),
    startSaleScoped: vi.fn((_token: string) => Promise.resolve({ cartId: 'cart-1' })),
    addLineScoped: vi.fn((_token: string) => Promise.resolve({ lineId: 'line-added-1', lineTotal: null })),
    setCartDiscountScoped: vi.fn((_token: string) => Promise.resolve()),
    completeSaleScoped: vi.fn((_token: string) => Promise.resolve({ saleId: 'sale-1', total: { minor_units: 3500, currency: 'IDR' }, lineCount: 1 })),
    // Must return the SAME shape as the ambient listSales above, not a bare array. It used to
    // resolve([]) while listSales resolves({ sales, salesHistoryCapped }), so any screen converted
    // from the ambient call to this scoped one got `response.sales === undefined` -- a mock that
    // silently changes the contract at the moment a test starts depending on it. Every other
    // *Scoped entry in this block mirrors its ambient twin; this was the lone divergence.
    listSalesScoped: vi.fn((_token: string) => Promise.resolve({ sales: [], salesHistoryCapped: false })),
    // Twin of the ambient getCartDeductionLocation. PosScreen reads deduction-location metadata
    // through this once it holds a session token; without an entry here the call resolves the
    // factory's proxy-less undefined and the screen's fallback masks the omission.
    getCartDeductionLocationScoped: vi.fn((_token: string, _cartId: string) => Promise.resolve(null)),
    getSaleScoped: vi.fn((_token: string, _id: string) => Promise.resolve(null)),
    finalizeSaleScoped: vi.fn((_token: string, _saleId: string) => Promise.resolve()),
    voidPendingSaleScoped: vi.fn((_token: string, _saleId: string) => Promise.resolve()),
    voidSaleScoped: vi.fn((_token: string, _saleId: string, _reason: string) => Promise.resolve()),
    processRefundScoped: vi.fn((_token: string) => Promise.resolve({ refundId: 'refund-1', totalMinor: 0 })),
    listRefundsScoped: vi.fn((_token: string, _saleId: string) => Promise.resolve([])),
    exportDailySummaryScoped: vi.fn((_token: string) => Promise.resolve([])),
    exportSalesByHourScoped: vi.fn((_token: string) => Promise.resolve([])),
    exportEodReportScoped: vi.fn((_token: string) => Promise.resolve(null)),
    ...overrides,
  };
}

// ── settings ──────────────────────────────────────────────────────

export interface SettingsApiOverrides {
  getStoreSettings?: ReturnType<typeof vi.fn>;
  getReceiptSettings?: ReturnType<typeof vi.fn>;
  getCreditSettings?: ReturnType<typeof vi.fn>;
  getEnabledFeatures?: ReturnType<typeof vi.fn>;
  getPresetFeatures?: ReturnType<typeof vi.fn>;
  getStoreSettingsScoped?: ReturnType<typeof vi.fn>;
  getSettingScoped?: ReturnType<typeof vi.fn>;
  setReceiptSettingsScoped?: ReturnType<typeof vi.fn>;
  setStoreSettingsScoped?: ReturnType<typeof vi.fn>;
  setCreditSettingsScoped?: ReturnType<typeof vi.fn>;
  listCreditSalesScoped?: ReturnType<typeof vi.fn>;
  settleCreditScoped?: ReturnType<typeof vi.fn>;
  setHardwareSettingsScoped?: ReturnType<typeof vi.fn>;
  setUserPreferencesScoped?: ReturnType<typeof vi.fn>;
}

export function createSettingsApiMock(overrides: SettingsApiOverrides = {}) {
  return {
    getStoreSettings: vi.fn(() =>
      Promise.resolve({ name: '', address: '', taxId: '', currency: 'IDR', branch: '', logo: '' }),
    ),
    getReceiptSettings: vi.fn(() => Promise.resolve({
      showCurrency: true, decimalSeparator: 'dot', showTax: true,
      footer: '', paperWidth: 'standard', showTableNumber: false,
      marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
      taxRoundingMode: 'half_up',
    })),
    setReceiptSettings: vi.fn(),
    setStoreSettings: vi.fn(),
    getCreditSettings: vi.fn(() => Promise.resolve(
      { enabled: true, reminderIntervalHours: 24, maxLimitMinor: 500000 },
    )),
    setCreditSettings: vi.fn(),
    listCreditSales: vi.fn(() => Promise.resolve([])),
    settleCredit: vi.fn(),
    getHardwareSettings: vi.fn(() => Promise.resolve(
      { printerConnection: 'auto', printerDevicePath: '', printerPaperSize: '80',
        scannerDeviceId: '', scannerInputMode: 'auto' },
    )),
    // The preset→features lookup the first-run flow makes before submitting.
    // Defaults to the empty set, which is the pre-fix behaviour; a test that
    // cares about the derived set overrides it.
    getPresetFeatures: vi.fn(() => Promise.resolve({ features: [] })),
    getFirstRunState: vi.fn(() =>
      Promise.resolve({
        state: 'provisioned' as const,
        location_id: 'loc-1',
        owner_user_id: 'user-1',
        mode: 'local' as const,
        home_region: 'global',
        tenant_id: null,
      }),
    ),
    provisionDevice: vi.fn(() =>
      Promise.resolve({
        terminal_id: 'dev-1',
        location_id: 'loc-1',
        owner_user_id: 'user-1',
        created: true,
        mode: 'local' as const,
        home_region: 'global',
      }),
    ),
    getEnabledFeatures: vi.fn(),
    // @deprecated kept for backward compat; new callers should use getUserPreferencesScoped
    getUserPreferences: vi.fn(),
    getUserPreferencesScoped: vi.fn((_token: string) => Promise.resolve({})),
    getStoreSettingsScoped: vi.fn((_token: string) =>
      Promise.resolve({ name: '', address: '', taxId: '', currency: 'IDR', branch: '', logo: '' }),
    ),
    // Added 2026-09-16 because `PosScreen` began reading `restaurant.course_firing`
    // through it (`51936522f`), and the four PosScreen suites mock this module via
    // THIS factory -- so the missing key threw `No "getSettingScoped" export is
    // defined on the "@/api/settings" mock` for every test in them. The export has
    // existed since `6190dda4e` (2026-08-29); this factory never learned it because
    // nothing consumed it through the shared mock path until now, and
    // mockFactorySurface.test.ts only checks the other direction (see the gap case
    // added alongside this line).
    //
    // Resolves `null`, i.e. "setting unset", which is what the real call returns for
    // an absent key. Note the real `getSettingScoped` REJECTS on a null token
    // (`api/settings.ts:260`-`:262`), and PosScreen maps that rejection to its
    // tri-state `null` rather than `false`; a test that needs THAT distinction must
    // pass an override -- this default deliberately models the successful-read path.
    getSettingScoped: vi.fn((_token: string | null, _key: string) =>
      Promise.resolve<string | null>(null),
    ),
    getReceiptSettingsScoped: vi.fn((_token: string) => Promise.resolve({
      showCurrency: true, decimalSeparator: 'dot', showTax: true,
      footer: '', paperWidth: 'standard', showTableNumber: false,
      marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
      taxRoundingMode: 'half_up',
    })),
    setReceiptSettingsScoped: vi.fn((_token: string) => Promise.resolve()),
    setStoreSettingsScoped: vi.fn((_token: string) => Promise.resolve()),
    setCreditSettingsScoped: vi.fn((_token: string) => Promise.resolve()),
    listCreditSalesScoped: vi.fn((_token: string) => Promise.resolve([])),
    settleCreditScoped: vi.fn((_token: string, _saleId: string) => Promise.resolve()),
    setHardwareSettingsScoped: vi.fn((_token: string) => Promise.resolve()),
    setUserPreferencesScoped: vi.fn((_token: string) => Promise.resolve()),
    setUserPreferences: vi.fn(),
    ...overrides,
  };
}

// ── shifts ────────────────────────────────────────────────────────

export interface ShiftsApiOverrides {
  getActiveShift?: ReturnType<typeof vi.fn>;
  openShift?: ReturnType<typeof vi.fn>;
  getActiveShiftScoped?: ReturnType<typeof vi.fn>;
  openShiftScoped?: ReturnType<typeof vi.fn>;
  closeShiftScoped?: ReturnType<typeof vi.fn>;
  listShiftsScoped?: ReturnType<typeof vi.fn>;
}

const defaultShift = {
  id: 'shift-1', userId: 'user-1', terminalId: null,
  openedAt: new Date().toISOString(), closedAt: null,
  openingBalanceMinor: 0, closingBalanceMinor: null,
  expectedCashMinor: null, cashDifferenceMinor: null,
  totalSalesMinor: 0, totalCashMinor: 0, totalCardMinor: 0,
  totalOtherMinor: 0, totalVoidsMinor: 0, totalRefundsMinor: 0,
  totalPayoutsMinor: 0, notes: '', status: 'open' as const,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};

export function createShiftsApiMock(overrides: ShiftsApiOverrides = {}) {
  return {
    getActiveShift: vi.fn(() => Promise.resolve(defaultShift)),
    openShift: vi.fn(() => Promise.resolve({ ...defaultShift, openingBalanceMinor: 100000 })),
    closeShift: vi.fn(),
    listShifts: vi.fn(() => Promise.resolve([])),
    getShift: vi.fn(() => Promise.resolve(null)),
    createCashPayout: vi.fn(),
    getShiftReport: vi.fn(),
    getActiveShiftScoped: vi.fn((_token: string) => Promise.resolve(defaultShift)),
    openShiftScoped: vi.fn((_token: string, _openingBalanceMinor: number) => Promise.resolve({ ...defaultShift, openingBalanceMinor: 100000 })),
    closeShiftScoped: vi.fn((_token: string, _id: string, _closingBalanceMinor: number) => Promise.resolve()),
    listShiftsScoped: vi.fn((_token: string) => Promise.resolve([])),
    ...overrides,
  };
}

// ── hardware ──────────────────────────────────────────────────────

export function createHardwareApiMock() {
  // `listScanners` / `startScanner` / `stopScanner` left this factory together with the
  // `@/api/hardware` exports they imitated (T21 b2): those three commands are registered in
  // neither shell, so a test arranging on them was configuring a call that cannot be made.
  // mockFactorySurface.test.ts caught the mismatch, and the cleanup it asks for is here rather
  // than a new KNOWN_DEAD entry.
  return {
    listDisplays: vi.fn(() => Promise.resolve([])),
    displayShow: vi.fn(() => Promise.resolve()),
    displayClear: vi.fn(() => Promise.resolve()),
    onBarcodeScanned: vi.fn(),
    onBarcodeError: vi.fn(),
  };
}

// ── products ──────────────────────────────────────────────────────

export interface ProductsApiOverrides {
  lookupProductBySku?: ReturnType<typeof vi.fn>;
  listProductsScoped?: ReturnType<typeof vi.fn>;
  listCategoriesScoped?: ReturnType<typeof vi.fn>;
  lookupByBarcodeScoped?: ReturnType<typeof vi.fn>;
  lookupProductBySkuScoped?: ReturnType<typeof vi.fn>;
  createProductScoped?: ReturnType<typeof vi.fn>;
  updateProductScoped?: ReturnType<typeof vi.fn>;
  deleteProductScoped?: ReturnType<typeof vi.fn>;
  adjustStockScoped?: ReturnType<typeof vi.fn>;
}

export function createProductsApiMock(overrides: ProductsApiOverrides = {}) {
  return {
    adjustStock: vi.fn(),
    listProductVariants: vi.fn(() => Promise.resolve([])),
    getProductVariant: vi.fn(() => Promise.resolve(null)),
    createProductVariant: vi.fn(),
    updateProductVariant: vi.fn(),
    deleteProductVariant: vi.fn(),
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
    deleteCategory: vi.fn(),
    listProductsScoped: vi.fn((_token: string) => Promise.resolve([])),
    listCategoriesScoped: vi.fn((_token: string) => Promise.resolve([])),
    lookupByBarcodeScoped: vi.fn((_token: string, _barcode: string) => Promise.resolve(null)),
    lookupProductBySkuScoped: vi.fn((_token: string, _sku: string) => Promise.resolve(null)),
    createProductScoped: vi.fn((_token: string) => Promise.resolve({ sku: 'new-sku' })),
    updateProductScoped: vi.fn((_token: string) => Promise.resolve({ sku: 'updated' })),
    deleteProductScoped: vi.fn((_token: string, _sku: string) => Promise.resolve()),
    adjustStockScoped: vi.fn((_token: string) => Promise.resolve(0)),
    ...overrides,
  };
}

// ── KDS (Kitchen Display System) ──────────────────────────────────

export interface KdsApiOverrides {
  listKdsOrders?: ReturnType<typeof vi.fn>;
  listKdsOrdersScoped?: ReturnType<typeof vi.fn>;
  getKdsQueue?: ReturnType<typeof vi.fn>;
  getKdsQueueScoped?: ReturnType<typeof vi.fn>;
  updateKdsStatus?: ReturnType<typeof vi.fn>;
  updateKdsStatusScoped?: ReturnType<typeof vi.fn>;
  createKdsOrderFromSale?: ReturnType<typeof vi.fn>;
  createKdsOrderFromSaleScoped?: ReturnType<typeof vi.fn>;
  getKdsOrder?: ReturnType<typeof vi.fn>;
  getKdsOrderScoped?: ReturnType<typeof vi.fn>;
}

const defaultKdsOrder = {
  id: 'kds-1', sale_id: 'sale-1', store_id: 'default',
  status: 'pending' as const, items_summary: 'Item 1, Item 2',
  item_count: 2, display_number: 101,
  received_at: new Date().toISOString(), started_at: null,
  ready_at: null, served_at: null, prep_time_seconds: 0,
  kitchen_zone: null, notes: '',
    table_number: null,
};

export function createKdsApiMock(overrides: KdsApiOverrides = {}) {
  return {
    listKdsOrders: vi.fn((_userId: string, _status?: string) => Promise.resolve([defaultKdsOrder])),
    listKdsOrdersScoped: vi.fn((_token: string, _status?: string) => Promise.resolve([defaultKdsOrder])),
    getKdsQueue: vi.fn((_userId: string, _kdsZone?: string) => Promise.resolve([defaultKdsOrder])),
    getKdsQueueScoped: vi.fn((_token: string, _kdsZone?: string) => Promise.resolve([defaultKdsOrder])),
    updateKdsStatus: vi.fn((_userId: string, _id: string, _status: string) => Promise.resolve({ ...defaultKdsOrder, status: _status })),
    updateKdsStatusScoped: vi.fn((_token: string, _id: string, _status: string) => Promise.resolve({ ...defaultKdsOrder, status: _status })),
    createKdsOrderFromSale: vi.fn((_userId: string, _saleId: string) => Promise.resolve([defaultKdsOrder])),
    createKdsOrderFromSaleScoped: vi.fn((_token: string, _saleId: string) => Promise.resolve([defaultKdsOrder])),
    getKdsOrder: vi.fn((_userId: string, _id: string) => Promise.resolve(defaultKdsOrder)),
    getKdsOrderScoped: vi.fn((_token: string, _id: string) => Promise.resolve(defaultKdsOrder)),
    ...overrides,
  };
}

// ── Gift Cards ─────────────────────────────────────────────────────

export interface GiftCardsApiOverrides {
  issueGiftCard?: ReturnType<typeof vi.fn>;
  getGiftCard?: ReturnType<typeof vi.fn>;
  listGiftCards?: ReturnType<typeof vi.fn>;
  getGiftCardBalance?: ReturnType<typeof vi.fn>;
  redeemGiftCard?: ReturnType<typeof vi.fn>;
  topUpGiftCard?: ReturnType<typeof vi.fn>;
  freezeGiftCard?: ReturnType<typeof vi.fn>;
  unfreezeGiftCard?: ReturnType<typeof vi.fn>;
}

const defaultGiftCard = {
  id: 'gc-1', card_number: '1234-5678-9012-3456', pin: '0000',
  initial_balance_minor: 100000, current_balance_minor: 75000,
  currency: 'IDR', status: 'active', issued_to: 'Test Customer',
  issue_date: new Date().toISOString(), expiry_date: null,
  created_by: 'user-1', updated_at: new Date().toISOString(),
};

const defaultGiftCardTransaction = {
  id: 'gctx-1', gift_card_id: 'gc-1', sale_id: null,
  txn_type: 'issue', amount_minor: 100000, balance_after_minor: 100000,
  notes: '', created_at: new Date().toISOString(),
};

const defaultGiftCardWithTransactions = {
  card: defaultGiftCard,
  transactions: [defaultGiftCardTransaction],
};

export function createGiftCardsApiMock(overrides: GiftCardsApiOverrides = {}) {
  return {
    issueGiftCard: vi.fn(() => Promise.resolve(defaultGiftCardWithTransactions)),
    getGiftCard: vi.fn((_cardNumberOrId: string) => Promise.resolve(defaultGiftCardWithTransactions)),
    listGiftCards: vi.fn((_filter: Record<string, unknown>) => Promise.resolve([defaultGiftCardWithTransactions])),
    getGiftCardBalance: vi.fn((_cardNumberOrId: string) => Promise.resolve({ balance_minor: 75000, currency: 'IDR', status: 'active' })),
    redeemGiftCard: vi.fn((_cardNumberOrId: string, _amountMinor: number, _saleId: string) => Promise.resolve({
      card: defaultGiftCard,
      transaction: { ...defaultGiftCardTransaction, txn_type: 'redeem', amount_minor: -25000, balance_after_minor: 50000, sale_id: 'sale-1' },
    })),
    topUpGiftCard: vi.fn((_cardNumberOrId: string, _amountMinor: number) => Promise.resolve(defaultGiftCardWithTransactions)),
    freezeGiftCard: vi.fn((_cardNumberOrId: string) => Promise.resolve({ ...defaultGiftCard, status: 'frozen' })),
    unfreezeGiftCard: vi.fn((_cardNumberOrId: string) => Promise.resolve({ ...defaultGiftCard, status: 'active' })),
    ...overrides,
  };
}

// ── Loyalty ────────────────────────────────────────────────────────

export interface LoyaltyApiOverrides {
  getLoyaltyAccount?: ReturnType<typeof vi.fn>;
  listLoyaltyAccounts?: ReturnType<typeof vi.fn>;
  earnLoyaltyPoints?: ReturnType<typeof vi.fn>;
  redeemLoyaltyPoints?: ReturnType<typeof vi.fn>;
  listLoyaltyTiers?: ReturnType<typeof vi.fn>;
  updateLoyaltyTier?: ReturnType<typeof vi.fn>;
  getPointsValue?: ReturnType<typeof vi.fn>;
  getOrCreateLoyaltyAccount?: ReturnType<typeof vi.fn>;
}

const loyaltyTier = {
  id: 'tier-1', name: 'Silver', min_points: 0,
  points_per_unit: 10, earn_multiplier_millionths: 1_000_000,
  colour: '#C0C0C0', sort_order: 1,
  created_at: new Date().toISOString(),
};

const loyaltyAccount = {
  id: 'loyalty-1', customer_id: 'cust-1', points: 500,
  lifetime_points: 1500, tier_id: 'tier-1',
  updated_at: new Date().toISOString(), created_at: new Date().toISOString(),
};

const loyaltyAccountWithDetails = {
  account: loyaltyAccount,
  tier: loyaltyTier,
  recent_transactions: [],
  next_tier: null,
  points_to_next_tier: 500,
};

export function createLoyaltyApiMock(overrides: LoyaltyApiOverrides = {}) {
  return {
    getLoyaltyAccount: vi.fn((_token: string, _customerId: string) => Promise.resolve(loyaltyAccountWithDetails)),
    listLoyaltyAccounts: vi.fn((_token: string) => Promise.resolve([loyaltyAccountWithDetails])),
    earnLoyaltyPoints: vi.fn((_token: string, _customerId: string, _saleId: string, _totalMinor: number) => Promise.resolve({
      id: 'loyaltytx-1', account_id: 'loyalty-1', sale_id: 'sale-1',
      points: 100, txn_type: 'earn', description: 'Points earned',
      created_at: new Date().toISOString(),
    })),
    redeemLoyaltyPoints: vi.fn((_token: string, _customerId: string, _points: number, _saleId: string) => Promise.resolve({
      transaction: {
        id: 'loyaltytx-2', account_id: 'loyalty-1', sale_id: 'sale-1',
        points: -200, txn_type: 'redeem', description: 'Points redeemed',
        created_at: new Date().toISOString(),
      },
      discount_minor: 50000,
    })),
    listLoyaltyTiers: vi.fn((_token: string) => Promise.resolve([loyaltyTier])),
    updateLoyaltyTier: vi.fn((_token: string, _tier: Record<string, unknown>) => Promise.resolve(loyaltyTier)),
    getPointsValue: vi.fn((_token: string, _points: number) => Promise.resolve(25000)),
    getOrCreateLoyaltyAccount: vi.fn((_token: string, _customerId: string) => Promise.resolve(loyaltyAccount)),
    ...overrides,
  };
}

// ── Reports ────────────────────────────────────────────────────────

export interface ReportsApiOverrides {
  getDailyRevenue?: ReturnType<typeof vi.fn>;
  getWeeklyRevenue?: ReturnType<typeof vi.fn>;
  getMonthlyRevenue?: ReturnType<typeof vi.fn>;
  getTopProducts?: ReturnType<typeof vi.fn>;
  getHourlyHeatmap?: ReturnType<typeof vi.fn>;
  getLowStockAlerts?: ReturnType<typeof vi.fn>;
  getCategoryBreakdown?: ReturnType<typeof vi.fn>;
  getMenuEngineering?: ReturnType<typeof vi.fn>;
  buildCustomReport?: ReturnType<typeof vi.fn>;
}

const dailyRevenueRow = { date: '2026-07-27', total_minor: 1250000, currency: 'IDR', sale_count: 12 };
const topProductRow = { product_id: 'prod-1', sku: 'SKU-001', name: 'Test Product', total_qty: 5, total_minor: 500000 };
const hourlyRow = { day_of_week: 1, hour: 10, total_minor: 350000, sale_count: 3 };
const categoryRow = { category_id: 'cat-1', category_name: 'Food', total_minor: 500000, sale_count: 8, percentage: 40 };

export function createReportsApiMock(overrides: ReportsApiOverrides = {}) {
  return {
    getDailyRevenue: vi.fn((_start: string, _end: string) => Promise.resolve([dailyRevenueRow])),
    getWeeklyRevenue: vi.fn((_start: string, _end: string) => Promise.resolve([{ week_start: '2026-07-21', total_minor: 8500000, currency: 'IDR', sale_count: 65 }])),
    getMonthlyRevenue: vi.fn((_start: string, _end: string) => Promise.resolve([{ month: '2026-07', total_minor: 35000000, currency: 'IDR', sale_count: 280 }])),
    getTopProducts: vi.fn((_start: string, _end: string, _limit: number) => Promise.resolve([topProductRow])),
    getHourlyHeatmap: vi.fn((_start: string, _end: string) => Promise.resolve([hourlyRow])),
    getLowStockAlerts: vi.fn((_threshold: number) => Promise.resolve([])),
    getCategoryBreakdown: vi.fn((_start: string, _end: string) => Promise.resolve([categoryRow])),
    getMenuEngineering: vi.fn((_start: string, _end: string) => Promise.resolve({
      rows: [{ product_id: 'prod-1', sku: 'SKU-001', name: 'Test', total_volume: 50, unit_price_minor: 10000, unit_cost_minor: 4000, margin_per_unit: 6000, total_margin_minor: 300000, total_revenue_minor: 500000 }],
      median_volume: 25,
      median_margin: 5000,
    })),
    buildCustomReport: vi.fn((_request: Record<string, unknown>) => Promise.resolve({ columns: ['SKU', 'Name'], rows: [['SKU-001', 'Test']] })),
    ...overrides,
  };
}
