/**
 * Dev-mode mock for @tauri-apps/api/core
 *
 * Provides minimal Tauri IPC stubs so the app can be previewed in a
 * browser without the Rust backend running.  Reload the page after
 * editing this file.
 *
 * Usage — add to vite.config.ts:
 *   resolve: {
 *     alias: [
 *       { find: /^@tauri-apps\/api\/core$/, replacement: '/src/dev-mock/tauri-api.ts' },
 *       ...existing aliases,
 *     ],
 *   },
 */

// The real `version` command answers with `env!("CARGO_PKG_VERSION")`, so the
// browser preview must not invent its own number: the literal here went stale
// (still 0.0.9 while the app shipped 0.0.37) and made the lock-screen footer
// look wrong in dev. ui/package.json is bumped by scripts/bump-version.ps1
// alongside Cargo.toml/tauri.conf.json, so importing it keeps mock and app in
// lockstep.
// MOCK_STORE fed the location list and the regional/receipt fallbacks; all
// of that state now lives in handlers/locationState.ts and handlers/regional.ts
// (Phase 5.1), which import it themselves — the router no longer names it.
import {
  applyScopedAliases,
  convertFileSrc,
  handlers,
  invoke,
  isTauri,
  registerHandlers,
  type MockHandler,
} from './core/mockDispatcher';
import { createCatalogHandlers, MOCK_PRODUCTS } from './handlers/catalog';
import { inventoryHandlers } from './handlers/inventory';
import { createSalesHandlers, type CartLine } from './handlers/sales';
import { shiftHandlers } from './handlers/shifts';
import { createPaymentHandlers } from './handlers/payment';
import { loyaltyHandlers } from './handlers/loyalty';
import { kdsDisplayCounter, kdsHandlers, mockKdsOrders, mockKdsLineItems, saveMockKdsState } from './handlers/kds';
import { analyticsHandlers } from './handlers/analytics';
import { createLocationsHandlers } from './handlers/locations';
import {
  createLocationProfileHandlers,
  getMockStores,
  unwrapArgs,
  updateMockLocation,
} from './handlers/locationState';
import { createRegionalHandlers } from './handlers/regional';
import { mockHandlerPayload, systemHandlers } from './handlers/system';
import { staffHandlers } from './handlers/staff';
import { workspaceHandlers } from './handlers/workspaces';
import { topologyHandlers } from './handlers/topology';
import { brandHandlers, licenseHandlers, settingsHandlers, settingsWriteHandlers } from './handlers/settings';
import { deviceBindingHandlers } from './handlers/terminals';
import { floorplanHandlers } from './handlers/floorplan';
import { MOCK_CUSTOMERS, crmHandlers } from './handlers/crm';
import { bundlesHandlers } from './handlers/bundles';
import { syncHandlers } from './handlers/sync';
import { kdsDeviceHandlers } from './handlers/kds-devices';

// The mock's public surface is the three names the app actually imports through
// the vite alias on `@tauri-apps/api/core`. They are defined by the dispatcher
// and re-exported here so the alias target keeps answering for all of them.
export { convertFileSrc, invoke, isTauri };


// The location-profile list, the ticket-prefix pair and the unwrapArgs
// envelope helper lived here as module-private `let`s — that sharing is why
// -4:190 called this block the real blocker and deferred the consolidation.
// Phase 5.1 moved them verbatim to `handlers/locationState.ts`, and the
// regional configuration pair plus the receipt-format trio that read the
// list — together with their session-local override state — to
// `handlers/regional.ts`. Both domains register below through their own
// factories; nothing in this file touches that state except through the
// injected deps.

/** A memo as the dev mock serves it. Mirrors `ui/src/api/memos.ts` `Memo`
 *  (camelCase wire shape). */


// ── Mock KDS orders ──────────────────────────────────────────────
// Use let + mutable array so complete_sale can push new orders for E2E tests.
// 10 initial orders with realistic Indonesian food items, spread across
// statuses and timestamps for a live kitchen feel.
/** Auto-generate one order per interval (dev mode only). */
function pushKdsOrderFromCart(lines: CartLine[], storeId: string) {
  const displayNumber = kdsDisplayCounter.value++;
  const itemsSummary = lines.map((l) => `${l.qty}x ${l.name}`).join(', ');
  const itemCount = lines.reduce((sum, l) => sum + l.qty, 0);
  const now = new Date().toISOString();
  const orderId = `kds-order-e2e-${Date.now()}`;
  mockKdsOrders.push({
    id: orderId,
    display_number: displayNumber,
    status: 'pending',
    received_at: now,
    items_summary: itemsSummary,
    item_count: itemCount,
    order_type: 'dine_in',
    table_number: 'T' + (Math.floor(Math.random() * 20) + 1),
    notes: null,
    store_id: storeId,
  });
  // Seed course-grouped line items so the KDS ticket renders real item
  // names (KdsTicketCard fetches via get_kds_order_lines_scoped).
  // Derive the course from the product category — 'beverage' for hot
  // drinks, 'main' for food and everything else (incl. retail).
  const courseForSku = (sku: string): string => {
    const p = MOCK_PRODUCTS.find((prod) => prod.sku === sku);
    const category = p?.category ?? '';
    if (category === 'Hot Drinks' || category === 'Cold Drinks') return 'beverage';
    if (category === 'Dessert') return 'dessert';
    if (category === 'Food') return 'main';
    return 'main';
  };
  mockKdsLineItems[orderId] = lines.map((l, i) => ({
    id: `kds-line-e2e-${orderId}-${i}`,
    kds_order_id: orderId,
    sku: l.sku,
    display_name: l.name,
    qty: l.qty,
    course: courseForSku(l.sku),
    modifiers: [],
    line_position: i + 1,
    item_status: 'pending',
    started_at: null,
    ready_at: null,
    served_at: null,
    created_at: now,
  }));
  // Persist the new order + its line items so a reload keeps the queue.
  saveMockKdsState();
}

// ── Lockout state (for E2E rate-limit tests) ──────────────────
// The real backend persists login attempts (login_attempts 074 + device
// 111), so a reload cannot bypass an active lockout. Persist the flat
// attempt counter (same stateful pattern as the other mocks) so a
// reloaded preview keeps enforcing the threshold — previously a reload
// cleared the counter and defeated the lockout entirely.
// LOCKOUT_DURATION_MS = 30_000 is defined for documentation;
// the mock uses a simple attempt-count lockout that resets on
// successful login to keep the dev loop fast.


// ── Date helpers (for seeded report data) ───────────────────────
/** List every ISO date (YYYY-MM-DD) from startDate to endDate inclusive. */

/** Deterministic pseudo-random minor-unit value for mock revenue rows. */
// The real backend persists per-user preferences to the store-scoped
// `user_preferences` table. The mock previously returned static values
// while discarding writes, which made the restaurant-menu hamburger
// configuration (sort / card size / font size) revert on every reload.
// Seed from localStorage so previews behave like a real store DB.

const entryHandlers: Record<string, MockHandler> = {

  // ═══════════════════════════════════════════════════════════════
  // BOOT / SETUP
  // ═══════════════════════════════════════════════════════════════

  'get_local_ip': () => '192.168.1.100',

  ...licenseHandlers,

  // ═══════════════════════════════════════════════════════════════
  // LOCATIONS / REGIONAL CONFIG / RECEIPT FORMAT — Phase 5.1 conversion.
  // The nine location/prefix commands (Location is the canonical site-unit
  // term; the old store-profile names stay registered while clients
  // migrate) now come from createLocationProfileHandlers(), and the
  // regional pair plus the receipt-format trio from createRegionalHandlers()
  // — both registered straight below the literal. They all stay registered
  // because scripts/verify-ipc-parity.py treats a missing dev-mock handler
  // as a hard violation: invoke() would return null and the caller would
  // silently render its failure path instead of erroring. (Legal Entity,
  // Organization-level Phase 1 §G, lives in handlers/locations.ts.)
  // ═══════════════════════════════════════════════════════════════

  // ═════════════════════════════════════════════════════════
  // WORKSPACES (ADR #4 / #7)
  // ═══════════════════════════════════════════════════════════════
  // The six device-binding entries moved verbatim to handlers/terminals.ts
  // (Phase 5.1 conversion); that file's header records why this banner was
  // never their home — handlers/workspaces.ts:17-19 declined them as a
  // separate (terminals) command family. Registered below.

  // ═══════════════════════════════════════════════════════════════
  // SETTINGS
  // ═══════════════════════════════════════════════════════════════

  ...settingsHandlers,

  // ═══════════════════════════════════════════════════════════════
  // BRANDING
  // ═══════════════════════════════════════════════════════════════
  // (the two static brand-settings entries moved verbatim to
  //  handlers/settings.ts as brandHandlers — Phase 5.1 conversion;
  //  registered below)

  'print_sales_receipt': () => ({ printed: true }),
  'print_sales_receipt_scoped': () => ({ printed: true }),

  // ═══════════════════════════════════════════════════════════════
  // KDS DEVICE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════

  // (the five KDS device-management handlers moved verbatim to ./handlers/kds-devices.ts
  //  — Phase 5.4; registered below. Kept out of handlers/kds.ts (order workflow), see that file.)
  'get_low_stock_alerts': () => [
    { product_id: 'RAM-D4-16GB-KF', sku: 'RAM-D4-16GB-KF', name: 'Kingston Fury Beast 16GB DDR4 3200', current_qty: 3, threshold: 10, currency: 'IDR', price_minor: 450000, cost_minor: 390000 },
    { product_id: 'MB-B650-ROG', sku: 'MB-B650-ROG', name: 'ASUS ROG Strix B650-A Gaming WiFi', current_qty: 5, threshold: 10, currency: 'IDR', price_minor: 2850000, cost_minor: 2500000 },
    { product_id: 'SSD-NV2-1TB', sku: 'SSD-NV2-1TB', name: 'Kingston NV2 1TB NVMe SSD', current_qty: 4, threshold: 8, currency: 'IDR', price_minor: 950000, cost_minor: 820000 },
    { product_id: 'PSU-RM750', sku: 'PSU-RM750', name: 'Corsair RM750e 80+ Gold PSU', current_qty: 6, threshold: 10, currency: 'IDR', price_minor: 1850000, cost_minor: 1650000 },
    { product_id: 'GPU-RTX4070', sku: 'GPU-RTX4070', name: 'MSI RTX 4070 Ventus 2X', current_qty: 2, threshold: 5, currency: 'IDR', price_minor: 8900000, cost_minor: 8100000 },
    { product_id: 'CPU-7800X3D', sku: 'CPU-7800X3D', name: 'AMD Ryzen 7 7800X3D', current_qty: 8, threshold: 10, currency: 'IDR', price_minor: 5400000, cost_minor: 4900000 },
  ],

  // ═══════════════════════════════════════════════════════════════
  // BUNDLES
  // ═══════════════════════════════════════════════════════════════

  // (the twelve bundle handlers moved verbatim to ./handlers/bundles.ts — Phase 5.2;
  //  registered right below, so the registry position these keys held is unchanged)

  // ═══════════════════════════════════════════════════════════════
  // HARDWARE
  // ═══════════════════════════════════════════════════════════════

  // (the sync / cash-drawer / receipt hardware stubs moved verbatim to
  //  ./handlers/sync.ts — Phase 5.3; registered right below. `get_local_ip` and
  //  `get_low_stock_alerts` stay here pending properly-named homes — see sync.ts)
};

// Merge this file's handlers into the registry the dispatcher routes through.
// The sibling work orders move whole domains out of this literal and into
// `handlers/*`; until they land, the literal remains the registry's main
// source, and everything below patches it in place.
registerHandlers(entryHandlers);
// Phase 5.1 conversions, registered in the slots their keys held inside the
// literal: the nine location/prefix commands of handlers/locationState.ts,
// and the regional pair + receipt-format trio of handlers/regional.ts —
// the latter receives the relocated state as deps (the catalog/sales/
// payment/locations factory precedent) rather than importing the list.
registerHandlers(createLocationProfileHandlers());
registerHandlers(createRegionalHandlers({ unwrapArgs, getMockStores, updateMockLocation }));
// The two stateless Phase 5.1 moves: the terminals family and branding,
// registered as their own named maps for the same slot their entries held.
registerHandlers(deviceBindingHandlers);
registerHandlers(brandHandlers);
// Bundles (Phase 5.2) moved verbatim to `handlers/bundles.ts`; registered here so
// the twelve keys keep the registry position they held inside the entry literal.
registerHandlers(bundlesHandlers);
// Sync / cash-drawer / receipt hardware stubs (Phase 5.3) moved verbatim to
// `handlers/sync.ts`; registered here so the eleven keys keep their registry position.
registerHandlers(syncHandlers);
// KDS device-management keys (Phase 5.4) moved verbatim to `handlers/kds-devices.ts`.
registerHandlers(kdsDeviceHandlers);
// Topology handlers (the diagram read, the editor's atomic diff apply, and the
// ADR #46 revision reads) live in `handlers/topology.ts`, which owns the
// `mockTopology` diagram slice and mutates the `mockWorkspaces` list that
// `handlers/workspaces.ts` exports. Registered straight after the literal, in
// the slot these five keys occupied inside it, so the registry order is
// unchanged for every other domain that follows.
registerHandlers(topologyHandlers);
// Workspace handlers (boot resolution, instances, screens, the type picker and
// the multi-store listing) live in `handlers/workspaces.ts`, which also owns
// the `mockWorkspaces` list the topology diff in `handlers/topology.ts`
// mutates. Registered straight after the literal so these keys keep the
// registry position they had as entries inside it.
registerHandlers(workspaceHandlers);
// Catalog handlers (products, variants, categories, currency, tax) live in
// `handlers/catalog.ts` and are merged here. Registered before the scoped-alias
// pass below, and before the in-place `handlers[...] = …` patches that follow,
// so those patches keep overriding catalog entries exactly as they did when the
// entries sat in the literal above.
registerHandlers(createCatalogHandlers({ unwrapArgs }));
registerHandlers(inventoryHandlers);
registerHandlers(shiftHandlers);
registerHandlers(createSalesHandlers({ unwrapArgs, mockHandlerPayload, pushKdsOrderFromCart }));
registerHandlers(createPaymentHandlers({ unwrapArgs }));
registerHandlers(loyaltyHandlers);
registerHandlers(kdsHandlers);
registerHandlers(analyticsHandlers);
registerHandlers(createLocationsHandlers({ unwrapArgs }));
registerHandlers(systemHandlers);
registerHandlers(staffHandlers);
registerHandlers(floorplanHandlers);
registerHandlers(crmHandlers);

// ── Scoped aliases (ADR #7) ──────────────────────────────────────
// The API layer calls the *_scoped variant for nearly every command, but most were only
// ever registered unscoped. Without aliasing, invoke() returns `null` and report/inventory
// screens crash on `.length` reads (e.g. revenueData.length in DashboardScreen /
// SalesReportScreen), surfacing as error-boundary failures in browser-mode E2E.
//
// This used to be a hand-maintained SCOPED_ALIASES list of 34 pairs. It is now derived by
// rule in the pass just above invoke(), which subsumes every one of those pairs: all 34
// were of the form (X_scoped, X) with X registered, verified before deletion, and pinned
// by name in __tests__/dev-mock-scoped-aliases.test.ts so a future change to the rule
// fails on the specific command rather than crashing a screen at runtime.

// Scoped commands without an unscoped twin get minimal direct stubs.
handlers['search_customers_scoped'] = (args) => {
  const { query } = (args ?? {}) as { query?: string };
  const q = (query ?? '').toLowerCase();
  const items = MOCK_CUSTOMERS.filter(
    (c) => !q || c.name.toLowerCase().includes(q),
  );
  return { items, total: items.length };
};
handlers['get_customer_history_scoped'] = (args) => {
  const { customerId } = (args ?? {}) as { customerId?: string };
  const customer =
    MOCK_CUSTOMERS.find((c) => c.id === customerId) ?? MOCK_CUSTOMERS[0]!;
  return { customer, loyalty: null, sales: [], sales_total: 0 };
};
handlers['list_in_transit_transfers_scoped'] = () => [];
// Sync conflict review. The mock has no cloud to ask, so it reports "nothing
// flagged" — the screen must render its empty state rather than crash. The
// resolve stub returns false, the honest answer for a row that does not exist:
// callers treat it as "already resolved elsewhere", which is exactly what an
// empty mock is.
handlers['list_sync_conflicts_scoped'] = () => [];
handlers['resolve_sync_conflict_scoped'] = () => false;
// HPP exposure: no historical sale lines exist in the mock, so the margin
// report is empty (the UI hides the Cost/Margin columns when it is).
handlers['get_sale_line_margins_scoped'] = () => [];
// Analytics dashboard cards — scoped commands with no unscoped twin.
// Plausible fixed shapes so the analytics grid renders in browser mode
// instead of resolving null and crashing card layouts.
handlers['get_customer_split_scoped'] = () => ({ new_count: 84, returning_count: 47 });
handlers['get_payment_method_breakdown_scoped'] = () => [
  { payment_method: 'qris', total_minor: 98000000, sale_count: 142 },
  { payment_method: 'cash', total_minor: 74000000, sale_count: 118 },
  { payment_method: 'card', total_minor: 61000000, sale_count: 89 },
  { payment_method: 'ewallet', total_minor: 39000000, sale_count: 57 },
];
handlers['get_discounts_summary_scoped'] = () => ({
  sale_count: 406,
  discounted_sale_count: 96,
  share_percent: 6.4,
  codes: [
    { label: 'WELCOME10', redeemed_count: 41 },
    { label: 'PROMO8.8', redeemed_count: 28 },
    { label: 'LOYALTY15', redeemed_count: 17 },
    { label: 'FREESHIP', redeemed_count: 10 },
  ],
});
handlers['get_voided_sales_summary_scoped'] = () => ({ void_count: 23, void_total_minor: 5400000 });
handlers['get_basket_size_scoped'] = () => ({ sale_count: 406, avg_line_count: 3.2 });
// Per-day basket size for the trend card — a week of plausible averages.
handlers['get_basket_size_trend_scoped'] = () => {
  const days: { date: string; sale_count: number; avg_line_count: number }[] = [];
  const avgs = [3.1, 3.4, 2.9, 3.6, 3.2, 3.8, 3.3];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push({
      date: d.toISOString().slice(0, 10),
      sale_count: 55 + ((i * 13) % 20),
      avg_line_count: avgs[i]!,
    });
  }
  return days;
};
handlers['get_inventory_turnover_scoped'] = () => ({ units_sold: 1280, stock_on_hand: 340, sku_count: 486, range_days: 30 });
handlers['get_inventory_trend_scoped'] = () => {
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days.map((date, i) => ({ date, units_sold: 30 + ((i * 17) % 40) }));
};
// Restaurant table turnover: 7 days of completed table-bound orders.
// ~18–31 turns/day → average turn 46–80 minutes (plausible service pace).
handlers['get_table_turnover_scoped'] = () => {
  const days: { date: string; table_orders: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push({ date: d.toISOString().slice(0, 10), table_orders: 18 + ((i * 7) % 14) });
  }
  return days;
};
// Restaurant hourly table activity: twin-peak service shape (lunch ≈ 12:00,
// dinner ≈ 19:00) across the service day — feeds the occupancy curve.
handlers['get_hourly_occupancy_scoped'] = () => {
  const shape = [0, 0, 0, 0, 0, 0, 4, 9, 18, 30, 42, 55, 62, 48, 34, 30, 38, 52, 64, 70, 58, 36, 18, 6];
  return shape.map((count, hour) => ({ hour, table_orders: count }));
};
handlers['get_voided_items_scoped'] = () => [
  { name: 'Caffè Latte', qty: 6 },
  { name: 'Iced Coffee', qty: 5 },
  { name: 'Avocado Toast', qty: 4 },
  { name: 'Smoothie', qty: 3 },
];
// ── Remaining uncovered commands (14 total) ───────────────────────
// Staff profile

// KDS order item updates (non-scoped)
// Settings writes (non-scoped + scoped)
registerHandlers(settingsWriteHandlers);

// Analytics daily staff breakdown

// §J quota remediation. Both commands return Result<u32> — a COUNT of affected
// instances, not a row set. suspend_surplus_workspace_instances_scoped used to
// answer `[]` here because it had been parked in the picker group above and
// copied its neighbour's shape, so the mock contradicted the contract by type.
// A wired-up button would have rendered a blank count in browser preview while
// behaving correctly in the shell, which is the worst direction for a mock to
// be wrong in: it hides the real path and invents a phantom.
//
// Both answer 0 rather than an invented number. `MOCK_WORKSPACES_SEED` carries no
// `status` column (so no instance is representable as `quota_suspended`) and the
// mock holds no signed tier payload, so "surplus" is genuinely undefined here —
// 0 is the only honest answer, and it is the correct answer for the seed data.
// The count is therefore not stateful: nothing here can ever become suspended.
handlers['suspend_surplus_workspace_instances_scoped'] = () => 0;
handlers['recover_workspace_instances_scoped'] = () => 0;

// Warehouse products at a specific location
handlers['list_warehouse_products_at_location'] = (args) => {
  const { locationId: _locationId } = (args ?? {}) as { locationId?: string };
  // Return mock products with stock at the given location
  return MOCK_PRODUCTS.slice(0, 12).map((p, i) => ({
    ...p,
    stock_qty: 10 + ((i * 7) % 40),
  }));
};

// ── General scoped aliasing ───────────────────────────────────────
//
// The rule that mirrors every registered command onto its `_scoped` twin lives
// in `core/mockDispatcher.ts`; the reasoning is documented there. It is invoked
// from here because it has to run AFTER every registration in this file — the
// 460-entry literal, the direct stubs above, and the `handlers['x'] = …`
// patches — so that it sees the complete registry. A pass placed earlier, as
// the retired curated loop was, cannot.
applyScopedAliases();

export class Resource {}
export class Channel {}
