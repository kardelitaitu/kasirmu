// ── Shared retail POS test fixtures + module mocks ───────────────
//
// RetailPosScreen.test.tsx, RetailPosScreenInteractions.test.tsx and
// RetailPosScreenCheckout.test.tsx previously duplicated:
//   - the `mockProducts` / `mockCategories` fixtures
//   - the full `@/api/products` mock block (~28 lines)
//   - the `@/api/kds` mock block
//   - the `@/api/currency` mock block
//   - the `@/api/customers` mock block
//   - the three sub-view screen stubs (TableManagementScreen,
//     SalesHistoryScreen, ProductLookupScreen)
//
// This module hoists all of that into factories + fixtures so each
// test file just wires `vi.mock` with an async import.
//
// Usage:
//   vi.mock('@/api/products', async () => {
//     const { createRetailProductsApiMock } =
//       await import('@/__tests__/test-utils/mocks/retailPos');
//     return createRetailProductsApiMock();
//   });
//
//   vi.mock('@/features/tables/TableManagementScreen', async () => {
//     const { createTableManagementScreenStub } =
//       await import('@/__tests__/test-utils/mocks/retailPos');
//     return createTableManagementScreenStub();
//   });

import { vi } from 'vitest';

// ── Fixtures ──────────────────────────────────────────────────────

export const retailProducts = [
  { sku: 'SKU-001', name: 'Indomie Goreng', category: 'cat-food', price: { minor_units: 3500, currency: 'IDR' }, barcode: '8991002100110', in_stock: true, stock_qty: 100, tax_rate_ids: [], created_at: '',
    price_updated_at: '', product_type: 'retail' },
  { sku: 'SKU-002', name: 'Teh Botol Sosro', category: 'cat-drink', price: { minor_units: 5000, currency: 'IDR' }, barcode: '8991002100220', in_stock: true, stock_qty: 50, tax_rate_ids: [], created_at: '',
    price_updated_at: '', product_type: 'retail' },
  { sku: 'SKU-003', name: 'Nasi Goreng Spesial', category: 'cat-food', price: { minor_units: 15000, currency: 'IDR' }, barcode: null, in_stock: true, stock_qty: 20, tax_rate_ids: [], created_at: '',
    price_updated_at: '', product_type: 'retail' },
  { sku: 'SKU-004', name: 'Aqua 600ml', category: 'cat-drink', price: { minor_units: 3000, currency: 'IDR' }, barcode: '8991002100330', in_stock: true, stock_qty: 3, tax_rate_ids: [], created_at: '',
    price_updated_at: '', product_type: 'retail' },
];

export const retailCategories = [
  { id: 'cat-food', name: 'Makanan', colour: '#e74c3c' },
  { id: 'cat-drink', name: 'Minuman', colour: '#3498db' },
];

// ── products ──────────────────────────────────────────────────────

/** Full `@/api/products` module mock with the retail fixtures baked in. */
export function createRetailProductsApiMock() {
  return {
    listProducts: vi.fn(() => Promise.resolve(retailProducts)),
    listProductsScoped: vi.fn((_token: string) => Promise.resolve(retailProducts)),
    listCategories: vi.fn(() => Promise.resolve(retailCategories)),
    listCategoriesScoped: vi.fn((_token: string) => Promise.resolve(retailCategories)),
    lookupProductBySkuScoped: vi.fn((_token: string, _sku: string) => Promise.resolve(null)),
    lookupByBarcode: vi.fn(() => Promise.resolve(null)),
    lookupByBarcodeScoped: vi.fn((_token: string, _code: string) => Promise.resolve(null)),
    createProductScoped: vi.fn(),
    updateProductScoped: vi.fn(),
    deleteProductScoped: vi.fn(),
    adjustStock: vi.fn(),
    adjustStockScoped: vi.fn(),
    listProductVariants: vi.fn(() => Promise.resolve([])),
    getProductVariant: vi.fn(() => Promise.resolve(null)),
    createProductVariant: vi.fn(),
    updateProductVariant: vi.fn(),
    deleteProductVariant: vi.fn(),
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
    deleteCategory: vi.fn(),
    getProductTrackSerialScoped: vi.fn(() => Promise.resolve(false)),
    // ADR #37 D3: fire-and-forget popularity search signal (non-blocking).
    recordProductSearchScoped: vi.fn(() => Promise.resolve(undefined)),
  };
}

// ── kds ───────────────────────────────────────────────────────────

/**
 * `@/api/kds` mock for the retail POS screens.
 *
 * `actual` is the real module, passed from each site's `vi.mock` factory via
 * `importOriginal`. Spreading it means the mock always exposes the module's
 * full surface, so a new export can never be missing from a hand-written list
 * -- the shape this file previously had.
 *
 * The old version returned exactly one key and justified it with "RetailPosScreen
 * only calls createKdsOrderFromSale". That claim was inverted: RetailPosScreen
 * renders PaymentModal, which calls `createKdsOrderFromSaleScoped` (twice, at
 * PaymentModal.tsx:756 and :1030) and never calls the unscoped
 * `createKdsOrderFromSale` at all. So the mock supplied the one function nothing
 * uses and omitted the one that runs, and every retail checkout threw a
 * missing-export error that the caller's `.catch` turned into a log line -- the
 * KDS ticket was silently never created across five test files.
 */
export function createRetailKdsApiMock(
  actual: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...actual,
    createKdsOrderFromSale: vi.fn((_userId: string, _saleId: string) => Promise.resolve()),
    createKdsOrderFromSaleScoped: vi.fn((_sessionToken: string, _saleId: string) =>
      Promise.resolve()),
  };
}

// ── currency ──────────────────────────────────────────────────────

/** `@/api/currency` mock returning IDR as the default currency. */
export function createRetailCurrencyApiMock() {
  return {
    listCurrencies: vi.fn(() => Promise.resolve([])),
    listExchangeRates: vi.fn(() => Promise.resolve([])),
    getDefaultCurrency: vi.fn(() => Promise.resolve({ code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp', decimalPlaces: 2, isDefault: true })),
    // Scoped versions (ADR #7) — used by PaymentModal when sessionToken is present
    listCurrenciesScoped: vi.fn(() => Promise.resolve([])),
    listExchangeRatesScoped: vi.fn(() => Promise.resolve([])),
    listLatestExchangeRatesScoped: vi.fn(() => Promise.resolve([])),
    getDefaultCurrencyScoped: vi.fn(() => Promise.resolve('IDR')),
  };
}

// ── customers ─────────────────────────────────────────────────────

/** `@/api/customers` mock returning an empty customer list. */
export function createRetailCustomersApiMock() {
  return {
    listCustomersScoped: vi.fn(() => Promise.resolve([])),
    getCustomerScoped: vi.fn(() => Promise.resolve(null)),
    createCustomerScoped: vi.fn(),
    updateCustomerScoped: vi.fn(),
    deleteCustomerScoped: vi.fn(),
  };
}

// ── Sub-view screen stubs ─────────────────────────────────────────

/** Stub for `@/features/tables/TableManagementScreen`. */
export function createTableManagementScreenStub() {
  return {
    default: () => <div data-testid="table-management-screen">Table Management Floor Plan</div>,
  };
}

/** Stub for `@/features/sales/SalesHistoryScreen`. */
export function createSalesHistoryScreenStub() {
  return {
    default: () => <div data-testid="sales-history-screen">Sales History</div>,
  };
}

/** Stub for `@/features/products/ProductLookupScreen`. */
export function createProductLookupScreenStub() {
  return {
    default: () => <div data-testid="stock-inquiry-screen">Stock Inquiry</div>,
  };
}
