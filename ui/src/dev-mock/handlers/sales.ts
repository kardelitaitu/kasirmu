/**
 * Dev-mock handlers — sales domain.
 *
 * The cart, held carts, the completed-sale store, promotion application, and
 * the checkout command surface (`start_sale`, `add_line`, `complete_sale`,
 * `hold_cart`, `list_open_bills`, refunds, voids). Extracted from
 * `tauri-api.ts` by the agent-2 work order
 * (`todo-refactor-devmock-agents-2.md`, phase 2.2); the code is moved
 * verbatim, comments included — only its location changes.
 *
 * Why this module is a factory. Three things it needs cannot be imported:
 *
 *   - `unwrapArgs` and `mockHandlerPayload` are the entry router's argument
 *     helpers, and importing them back would close a cycle
 *     (`tauri-api` → `handlers/sales` → `tauri-api`) — the hazard
 *     `core/mockDispatcher.ts` documents for itself.
 *   - `pushKdsOrderFromCart` stays in the router because it increments
 *     `kdsDisplayCounter`, a module-level scalar. Injecting the KDS state
 *     would capture the counter by value and silently drop every increment,
 *     so the function is injected whole and its closure keeps the scalar
 *     correct.
 *
 * `CartLine` is exported because `pushKdsOrderFromCart` is typed against it
 * and still lives in the router; the router imports the type from here.
 *
 * Promotion ownership. `MOCK_PROMOTIONS` and `mockSalePromotions` are read by
 * `list_promotions` and `get_sale_promotions`, which moved here so that the
 * promotion state stays private to this module. The promotion *CRUD* stubs
 * (`create_promotion`, `update_promotion`, `delete_promotion`,
 * `apply_promotion`) are literals with no state and stayed behind — they are
 * unowned by any fence and belong to the unassigned tail.
 */

import type { MockHandler } from '../core/mockDispatcher';
import {
  MOCK_CART_KEY,
  MOCK_HELD_CARTS_KEY,
  MOCK_SALES_KEY,
  readSlice,
  writeSlice,
} from '../core/mockDatabase';
import { MOCK_PRODUCTS } from './catalog';

/** Signature of the entry router's `{ args }`-envelope unwrapper. */
export type UnwrapArgs = <T extends Record<string, unknown> = Record<string, unknown>>(
  args: unknown,
) => T;

/** Dependencies the entry router lends to this module. */
export interface SalesDeps {
  unwrapArgs: UnwrapArgs;
  mockHandlerPayload: <T extends object>(args: unknown) => T;
  pushKdsOrderFromCart: (lines: CartLine[], storeId: string) => unknown;
}


// ═══════════════════════════════════════════════════════════════════
// CART, HELD CART, SALES AND PROMOTION STATE
// ═══════════════════════════════════════════════════════════════════

// ── Cart state (for realistic E2E totals) ───────────────────────
export interface CartLine {
  sku: string;
  name: string;
  price: { minor_units: number; currency: string };
  qty: number;
}
// Persisted so a reloaded preview keeps its in-progress cart — the real
// backend stores active-cart lines in the store DB. Same stateful pattern
// as the user-prefs / active-shift mocks below.
function loadMockCart(): { lines: CartLine[] } {
  return readSlice(MOCK_CART_KEY, () => ({ lines: [] }));
}
function saveMockCart(): void {
  writeSlice(MOCK_CART_KEY, cartState);
}
let cartState: { lines: CartLine[] } = loadMockCart();

// ── Mock promotions + checkout-preview helpers (PROMO-3) ──────────
// Single source for both the list handlers and the checkout preview so
// E2E preview → complete totals stay coherent.
interface MockPromotion {
  id: string;
  name: string;
  description: string;
  promo_type: 'percentage' | 'fixed_amount' | 'buy_x_get_y';
  value_minor: number;
  min_qty: number | null;
  trigger_sku: string | null;
  reward_sku: string | null;
  reward_qty: number | null;
  starts_at: string;
  ends_at: string | null;
  min_order_minor: number;
  category_id: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

const mockPromotion = (p: Partial<MockPromotion> & { id: string; name: string }): MockPromotion => ({
  description: '',
  promo_type: 'percentage',
  value_minor: 0,
  min_qty: null,
  trigger_sku: null,
  reward_sku: null,
  reward_qty: null,
  starts_at: new Date().toISOString(),
  ends_at: null,
  min_order_minor: 0,
  category_id: null,
  active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...p,
});

const MOCK_PROMOTIONS: MockPromotion[] = [
  mockPromotion({ id: 'promo-1', name: 'Buy 1 Get 1', description: 'Free croissant with any latte', promo_type: 'buy_x_get_y', trigger_sku: 'LATTE', reward_sku: 'CROISS', min_qty: 1, reward_qty: 1 }),
  mockPromotion({ id: 'promo-2', name: 'Happy Hour 15%', description: '15% off the whole order', promo_type: 'percentage', value_minor: 15 }),
  mockPromotion({ id: 'promo-3', name: 'VIP 5000 Off', description: '5000 minor units off', promo_type: 'fixed_amount', value_minor: 5000, min_order_minor: 20000 }),
];

/**
 * Engine-mirror the checkout promotion math for the dev mock: percentage
 * of the remaining total, fixed amount capped at the remaining total,
 * same-SKU BXGY groups (floor(qty / (min+reward)) × reward free units).
 * The production backend is the money authority; this exists so the E2E
 * preview → complete totals are coherent.
 */
function applyMockPromotionDiscounts(
  promotionIds: string[],
  baseTotalMinor: number,
): { totalMinor: number; discounts: { promotionId: string; discountMinor: number; description: string }[] } {
  let remaining = baseTotalMinor;
  const discounts: { promotionId: string; discountMinor: number; description: string }[] = [];
  for (const pid of promotionIds) {
    const promo = MOCK_PROMOTIONS.find((p) => p.id === pid);
    if (!promo || remaining <= 0) continue;
    if (remaining < promo.min_order_minor) continue;
    let d = 0;
    if (promo.promo_type === 'percentage') {
      d = Math.floor((remaining * promo.value_minor) / 100);
    } else if (promo.promo_type === 'fixed_amount') {
      d = Math.min(promo.value_minor, remaining);
    } else if (promo.promo_type === 'buy_x_get_y' && promo.trigger_sku) {
      const line = cartState.lines.find((l) => l.sku === promo.trigger_sku);
      if (line) {
        const minQty = promo.min_qty ?? 1;
        const rewardQty = promo.reward_qty ?? 1;
        const applicable = Math.floor(line.qty / (minQty + rewardQty)) * rewardQty;
        d = applicable * line.price.minor_units;
      }
    }
    d = Math.min(d, remaining);
    if (d <= 0) continue;
    remaining -= d;
    discounts.push({ promotionId: pid, discountMinor: d, description: `${promo.name}: ${d} off` });
  }
  return { totalMinor: remaining, discounts };
}

/** Applications recorded per completed sale id (get_sale_promotions). */
const mockSalePromotions: Record<string, { id: string; promotion_id: string; sale_id: string; discount_minor: number; description: string; created_at: string }[]> = {};

// ── Held carts (persisted so hold/resume previews mirror SQLite) ──
interface MockHeldCart {
  id: string;
  label: string;
  cart_data: string;
  item_count: number;
  total_minor: number;
  currency: string;
  created_at: string;
  bill_type: string;
  customer_name: string | null;
  deduction_location_id: string | null;
}

function isMockHeldCart(value: unknown): value is MockHeldCart {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  const hasNullableString = (field: string): boolean =>
    row[field] === null || typeof row[field] === 'string';

  if (
    typeof row['id'] !== 'string' || row['id'].trim() === ''
    || typeof row['label'] !== 'string'
    || typeof row['cart_data'] !== 'string'
    || typeof row['item_count'] !== 'number' || !Number.isSafeInteger(row['item_count']) || row['item_count'] < 0
    || typeof row['total_minor'] !== 'number' || !Number.isSafeInteger(row['total_minor'])
    || typeof row['currency'] !== 'string' || row['currency'].trim() === ''
    || typeof row['created_at'] !== 'string' || Number.isNaN(Date.parse(row['created_at']))
    || typeof row['bill_type'] !== 'string' || row['bill_type'].trim() === ''
    || !hasNullableString('customer_name')
    || !hasNullableString('deduction_location_id')
  ) {
    return false;
  }

  try {
    const cart = JSON.parse(row['cart_data']);
    return cart !== null && typeof cart === 'object';
  } catch {
    return false;
  }
}

function loadMockHeldCarts(): MockHeldCart[] {
  // A stored array is filtered rather than rejected wholesale: one malformed
  // row must not cost the user the entire hold list.
  return readSlice(
    MOCK_HELD_CARTS_KEY,
    () => [],
    (value) => (Array.isArray(value) ? value.filter(isMockHeldCart) : null),
  );
}

function createMockHeldCartId(): string {
  try {
    return `held-mock-${crypto.randomUUID()}`;
  } catch {
    // Older preview runtimes may not expose randomUUID; retain uniqueness
    // with a timestamp plus a random suffix rather than array length, which
    // can repeat after a deletion in the same clock tick.
    return `held-mock-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

let mockHeldCarts: MockHeldCart[] = loadMockHeldCarts();

function saveMockHeldCarts(): void {
  writeSlice(MOCK_HELD_CARTS_KEY, mockHeldCarts);
}

function holdMockCart(unwrapArgs: UnwrapArgs, args: unknown): { id: string } {
  const input = unwrapArgs<{
    label?: unknown;
    cart_data?: unknown;
    item_count?: unknown;
    total_minor?: unknown;
    currency?: unknown;
    bill_type?: unknown;
    customer_name?: unknown;
    deduction_location_id?: unknown;
  }>(args);
  const id = createMockHeldCartId();
  mockHeldCarts.push({
    id,
    label: String(input.label ?? '').trim(),
    cart_data: String(input.cart_data ?? '{}'),
    item_count: Number(input.item_count ?? 0),
    total_minor: Number(input.total_minor ?? 0),
    currency: String(input.currency ?? 'IDR'),
    created_at: new Date().toISOString(),
    bill_type: String(input.bill_type ?? 'hold'),
    customer_name: typeof input.customer_name === 'string' ? input.customer_name : null,
    deduction_location_id: typeof input.deduction_location_id === 'string' ? input.deduction_location_id : null,
  });
  saveMockHeldCarts();
  return { id };
}

function heldCartSummary(cart: MockHeldCart): Omit<MockHeldCart, 'cart_data' | 'deduction_location_id'> {
  const { cart_data: _cartData, deduction_location_id: _deductionLocationId, ...summary } = cart;
  return summary;
}

// ── Completed sales (persisted so sales history + refund e2e work) ─
interface MockCompletedSale {
  id: string;
  total: { minor_units: number; currency: string };
  lineCount: number;
  status: string;
  paymentMethod: string;
  userId: string;
  createdAt: string;
}
interface MockSaleDetails extends MockCompletedSale {
  subtotal: { minor_units: number; currency: string };
  taxTotal: { minor_units: number; currency: string };
  tenderedMinor: number;
  lines: Array<{
    id: string;
    sku: string;
    name: string;
    qty: number;
    unit_price: { minor_units: number; currency: string };
    total_minor: number;
    tax_amount: null;
    tax_rate_id: null;
  }>;
}
// Persisted alongside the cart so sales history (and the per-sale detail
// view) survives a reload exactly like the store DB does.
function seedMockSalesStore(): { sales: MockCompletedSale[]; details: Record<string, MockSaleDetails> } {
  const createdAt = new Date(Date.now() - 3600000).toISOString();
  // Pre-seeded sale so sales history always has at least one row.
  const seed: MockCompletedSale = {
    id: 'seed-sale-001',
    total: { minor_units: 1250, currency: 'USD' },
    lineCount: 2,
    status: 'Completed',
    paymentMethod: 'cash',
    userId: 'admin-1',
    createdAt,
  };
  return {
    sales: [seed],
    details: {
      'seed-sale-001': {
        ...seed,
        subtotal: { minor_units: 1250, currency: 'USD' },
        taxTotal: { minor_units: 0, currency: 'USD' },
        tenderedMinor: 2000,
        lines: [
          { id: 'seed-line-1', sku: 'LATTE', name: 'Caffè Latte', qty: 1, unit_price: { minor_units: 450, currency: 'USD' }, total_minor: 450, tax_amount: null, tax_rate_id: null },
          { id: 'seed-line-2', sku: 'CROISS', name: 'Butter Croissant', qty: 2, unit_price: { minor_units: 320, currency: 'USD' }, total_minor: 640, tax_amount: null, tax_rate_id: null },
        ],
      },
    },
  };
}
function loadMockSalesStore(): { sales: MockCompletedSale[]; details: Record<string, MockSaleDetails> } {
  return readSlice(MOCK_SALES_KEY, seedMockSalesStore);
}
const mockSalesStore = loadMockSalesStore();
const completedSales: MockCompletedSale[] = mockSalesStore.sales;
const saleDetails: Record<string, MockSaleDetails> = mockSalesStore.details;
function saveMockSales(): void {
  writeSlice(MOCK_SALES_KEY, { sales: completedSales, details: saleDetails });
}
// ═══════════════════════════════════════════════════════════════════
// HANDLER MAP
// ═══════════════════════════════════════════════════════════════════

export function createSalesHandlers(deps: SalesDeps): Record<string, MockHandler> {
  const { unwrapArgs, mockHandlerPayload, pushKdsOrderFromCart } = deps;
  return {

  // ═══════════════════════════════════════════════════════════════
  // SALES / CART
  // ═══════════════════════════════════════════════════════════════

  'start_sale': () => { cartState = { lines: [] }; saveMockCart(); return { cartId: `mock-cart-${Date.now()}`, deduction_location_id: 'default-loc', deductionLocationId: 'default-loc' }; },
  'start_sale_scoped': () => { cartState = { lines: [] }; saveMockCart(); return { cartId: `mock-cart-${Date.now()}`, deduction_location_id: 'default-loc', deductionLocationId: 'default-loc' }; },

  'add_line': (args) => {
    // The API sends { args: { cartId, sku, qty, unitPriceMinor } } — read `sku`
    // (with a `productSku` fallback for older callers). Previously the mock only
    // read `productSku`, so cartState stayed empty and mock sale totals were 0.
    const raw = (args as { args?: { sku?: string; productSku?: string; qty?: number } })?.args ?? (args as { sku?: string; productSku?: string; qty?: number });
    const skuKey = raw?.sku ?? raw?.productSku;
    const qty = raw?.qty ?? 1;
    const product = MOCK_PRODUCTS.find(p => p.sku === skuKey);
    if (product) {
      const existing = cartState.lines.find(l => l.sku === skuKey);
      if (existing) {
        existing.qty += qty;
      } else {
        cartState.lines.push({ sku: product.sku, name: product.name, price: product.price, qty });
      }
    }
    saveMockCart();
    const lineTotal = product ? product.price.minor_units * qty : 0;
    return { lineId: `mock-line-${Date.now()}`, lineTotal };
  },
  'add_line_scoped': (args) => {
    const raw = (args as { args?: { sku?: string; productSku?: string; qty?: number } })?.args ?? (args as { sku?: string; productSku?: string; qty?: number });
    const skuKey = raw?.sku ?? raw?.productSku;
    const qty = raw?.qty ?? 1;
    const product = MOCK_PRODUCTS.find(p => p.sku === skuKey);
    if (product) {
      const existing = cartState.lines.find(l => l.sku === skuKey);
      if (existing) {
        existing.qty += qty;
      } else {
        cartState.lines.push({ sku: product.sku, name: product.name, price: product.price, qty });
      }
    }
    saveMockCart();
    const lineTotal = product ? product.price.minor_units * qty : 0;
    return { lineId: `mock-line-${Date.now()}`, lineTotal };
  },

  'complete_sale': () => {
    const minorTotal = cartState.lines.reduce((sum, l) => sum + l.price.minor_units * l.qty, 0);
    const lineCount = cartState.lines.length;
    // Currency follows the cart (products are IDR) so history totals and
    // receipts render correctly in E2E.
    const currency = cartState.lines[0]?.price.currency ?? 'IDR';
    const saleId = `mock-sale-${Date.now()}`;
    // Persist into completed sales so sales history / refund e2e work.
    const now = new Date().toISOString();
    completedSales.push({
      id: saleId, total: { minor_units: minorTotal, currency }, lineCount,
      status: 'Completed', paymentMethod: 'cash', userId: 'admin-1', createdAt: now,
    });
    saleDetails[saleId] = {
      id: saleId, total: { minor_units: minorTotal, currency },
      subtotal: { minor_units: minorTotal, currency },
      taxTotal: { minor_units: 0, currency }, lineCount, status: 'Completed',
      paymentMethod: 'cash', tenderedMinor: minorTotal + 500, userId: 'admin-1', createdAt: now,
      lines: cartState.lines.map((l, i) => ({
        id: `mock-line-${i}-${saleId}`, sku: l.sku, name: l.name, qty: l.qty,
        unit_price: l.price, total_minor: l.price.minor_units * l.qty,
        tax_amount: null, tax_rate_id: null,
      })),
    };
    // Push a KDS mock order so POS → KDS E2E flow works.
    pushKdsOrderFromCart(cartState.lines, 'store-1');
    // Persist the completed sale and the now-empty cart so a reload keeps
    // history and doesn't resurrect the just-completed cart.
    saveMockSales();
    cartState = { lines: [] };
    saveMockCart();
    return { saleId, total: { minor_units: minorTotal, currency }, lineCount };
  },
  'preview_promoted_total_scoped': (args) => {
    // PROMO-3: engine-mirrored preview over the mock cart (no mutation).
    const raw = (args as { args?: { promotionIds?: string[] } })?.args ?? (args as { promotionIds?: string[] });
    const ids = raw?.promotionIds ?? [];
    const baseTotal = cartState.lines.reduce((sum, l) => sum + l.price.minor_units * l.qty, 0);
    const { totalMinor, discounts } = applyMockPromotionDiscounts(ids, baseTotal);
    return { baseTotalMinor: baseTotal, totalMinor, discounts };
  },

  'complete_sale_scoped': (args) => {
    // PROMO-3: honor promotionIds so E2E preview → complete totals match.
    const raw = (args as { args?: { promotionIds?: string[] } })?.args ?? (args as { promotionIds?: string[] });
    const ids = raw?.promotionIds ?? [];
    const baseTotal = cartState.lines.reduce((sum, l) => sum + l.price.minor_units * l.qty, 0);
    const { totalMinor: promotedTotal, discounts } = applyMockPromotionDiscounts(ids, baseTotal);
    const minorTotal = promotedTotal;
    const lineCount = cartState.lines.length;
    const currency = cartState.lines[0]?.price.currency ?? 'IDR';
    const saleId = `mock-sale-${Date.now()}`;
    const now = new Date().toISOString();
    completedSales.push({
      id: saleId, total: { minor_units: minorTotal, currency }, lineCount,
      status: 'Completed', paymentMethod: 'cash', userId: 'admin-1', createdAt: now,
    });
    saleDetails[saleId] = {
      id: saleId, total: { minor_units: minorTotal, currency },
      subtotal: { minor_units: baseTotal, currency },
      taxTotal: { minor_units: 0, currency }, lineCount, status: 'Completed',
      paymentMethod: 'cash', tenderedMinor: minorTotal + 500, userId: 'admin-1', createdAt: now,
      lines: cartState.lines.map((l, i) => ({
        id: `mock-line-${i}-${saleId}`, sku: l.sku, name: l.name, qty: l.qty,
        unit_price: l.price, total_minor: l.price.minor_units * l.qty,
        tax_amount: null, tax_rate_id: null,
      })),
    };
    mockSalePromotions[saleId] = discounts.map((d) => ({
      id: `mock-app-${saleId}-${d.promotionId}`, promotion_id: d.promotionId,
      sale_id: saleId, discount_minor: d.discountMinor, description: d.description,
      created_at: now,
    }));
    pushKdsOrderFromCart(cartState.lines, 'store-1');
    // Persist the completed sale and the now-empty cart so a reload keeps
    // history and doesn't resurrect the just-completed cart.
    saveMockSales();
    cartState = { lines: [] };
    saveMockCart();
    return { saleId, total: { minor_units: minorTotal, currency }, lineCount };
  },
  'complete_sale_with_resolved_shortfalls_scoped': () => {
    const minorTotal = cartState.lines.reduce((sum, l) => sum + l.price.minor_units * l.qty, 0);
    const lineCount = cartState.lines.length;
    const currency = cartState.lines[0]?.price.currency ?? 'IDR';
    const saleId = `mock-sale-${Date.now()}`;
    const now = new Date().toISOString();
    completedSales.push({
      id: saleId, total: { minor_units: minorTotal, currency }, lineCount,
      status: 'Completed', paymentMethod: 'cash', userId: 'admin-1', createdAt: now,
    });
    saleDetails[saleId] = {
      id: saleId, total: { minor_units: minorTotal, currency },
      subtotal: { minor_units: minorTotal, currency },
      taxTotal: { minor_units: 0, currency }, lineCount, status: 'Completed',
      paymentMethod: 'cash', tenderedMinor: minorTotal + 500, userId: 'admin-1', createdAt: now,
      lines: cartState.lines.map((l, i) => ({
        id: `mock-line-${i}-${saleId}`, sku: l.sku, name: l.name, qty: l.qty,
        unit_price: l.price, total_minor: l.price.minor_units * l.qty,
        tax_amount: null, tax_rate_id: null,
      })),
    };
    pushKdsOrderFromCart(cartState.lines, 'store-1');
    // Persist the completed sale and the now-empty cart so a reload keeps
    // history and doesn't resurrect the just-completed cart.
    saveMockSales();
    cartState = { lines: [] };
    saveMockCart();
    return { saleId, total: { minor_units: minorTotal, currency }, lineCount };
  },

  'get_sale': (args) => {
    const { id } = (args as { id?: string }) ?? {};
    return id ? (saleDetails[id] ?? null) : null;
  },
  'get_sale_scoped': (args) => {
    const { id } = (args as { id?: string }) ?? {};
    return id ? (saleDetails[id] ?? null) : null;
  },

  'set_cart_discount': () => null,
  'set_cart_discount_scoped': () => null,

  'override_line_price': () => null,
  'override_line_price_scoped': () => null,

  'hold_cart': (args) => holdMockCart(unwrapArgs, args),
  'hold_cart_scoped': (args) => holdMockCart(unwrapArgs, args),
  'list_active_carts': () => ({ carts: [] }),
  'get_active_cart': () => null,
  'list_held_carts': () => mockHeldCarts.map(heldCartSummary),
  'list_held_carts_scoped': () => mockHeldCarts.map(heldCartSummary),
  'list_open_bills': () => mockHeldCarts.filter((cart) => cart.bill_type === 'open_bill').map(heldCartSummary),
  'list_open_bills_scoped': () => mockHeldCarts.filter((cart) => cart.bill_type === 'open_bill').map(heldCartSummary),
  'get_held_cart': (args) => {
    const id = (args as { id?: string })?.id;
    return id ? (mockHeldCarts.find((cart) => cart.id === id) ?? null) : null;
  },
  'get_held_cart_scoped': (args) => {
    const id = (args as { id?: string })?.id;
    return id ? (mockHeldCarts.find((cart) => cart.id === id) ?? null) : null;
  },
  'delete_held_cart': (args) => {
    const id = (args as { id?: string })?.id;
    const next = mockHeldCarts.filter((cart) => cart.id !== id);
    if (next.length !== mockHeldCarts.length) {
      mockHeldCarts = next;
      saveMockHeldCarts();
    }
    return null;
  },
  'delete_held_cart_scoped': (args) => {
    const id = (args as { id?: string })?.id;
    const next = mockHeldCarts.filter((cart) => cart.id !== id);
    if (next.length !== mockHeldCarts.length) {
      mockHeldCarts = next;
      saveMockHeldCarts();
    }
    return null;
  },

  'list_sales': () => ({ sales: [...completedSales], salesHistoryCapped: false }),
  'list_sales_scoped': () => ({ sales: [...completedSales], salesHistoryCapped: false }),
  'void_sale': () => ({ id: 'voided-sale', status: 'voided', total: { minor_units: 0, currency: 'IDR' }, line_count: 0, created_at: new Date().toISOString() }),
  'void_sale_scoped': () => ({ id: 'voided-sale', status: 'voided', total: { minor_units: 0, currency: 'IDR' }, line_count: 0, created_at: new Date().toISOString() }),

  'lookup_sale_by_receipt_barcode': () => null,
  'lookup_sale_by_receipt_barcode_scoped': () => null,

  'process_refund': (args) => {
    // mockHandlerPayload rather than a nested read: invoke() hands a handler
    // args?.['args'] ?? args, so the envelope is already unwrapped here. The
    // helper's own '?? {}' tail preserves the old third fallback exactly, so a
    // no-argument call still yields an empty object rather than undefined.
    const a = mockHandlerPayload<{ lines?: Array<{ lineTotalMinor: number }> }>(args);
    const lines = a.lines ?? [];
    const totalMinor = lines.reduce((sum, l) => sum + (l.lineTotalMinor ?? 0), 0);
    return { refundId: `refund-${Date.now()}`, totalMinor };
  },
  'process_refund_scoped': (args) => {
    // mockHandlerPayload rather than a nested read: invoke() hands a handler
    // args?.['args'] ?? args, so the envelope is already unwrapped here. The
    // helper's own '?? {}' tail preserves the old third fallback exactly, so a
    // no-argument call still yields an empty object rather than undefined.
    const a = mockHandlerPayload<{ lines?: Array<{ lineTotalMinor: number }> }>(args);
    const lines = a.lines ?? [];
    const totalMinor = lines.reduce((sum, l) => sum + (l.lineTotalMinor ?? 0), 0);
    return { refundId: `refund-${Date.now()}`, totalMinor };
  },
  'list_refunds': () => [],
  'list_refunds_scoped': () => [],

  'finalize_sale': () => null,
  'void_pending_sale': () => null,

  'list_promotions': () => MOCK_PROMOTIONS,
  'list_promotions_scoped': () => MOCK_PROMOTIONS,

  'get_sale_promotions': (args) => {
    const raw = (args as { args?: { saleId?: string } })?.args ?? (args as { saleId?: string });
    return mockSalePromotions[raw?.saleId ?? ''] ?? [];
  },
  'get_sale_promotions_scoped': (args) => {
    const raw = (args as { args?: { saleId?: string } })?.args ?? (args as { saleId?: string });
    return mockSalePromotions[raw?.saleId ?? ''] ?? [];
  },
  };
}
