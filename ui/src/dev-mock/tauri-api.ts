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
import { MOCK_STORE } from './core/mockSeedData';
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
  createMockLocation,
  deleteMockLocation,
  getMockLocation,
  getMockLocationTicketPrefix,
  getMockPrimaryLocation,
  getMockStores,
  listMockLocations,
  setMockLocationTicketPrefix,
  setMockPrimaryLocation,
  unwrapArgs,
  updateMockLocation,
} from './handlers/locationState';
import { mockHandlerPayload, systemHandlers } from './handlers/system';
import { staffHandlers } from './handlers/staff';
import { workspaceHandlers } from './handlers/workspaces';
import { topologyHandlers } from './handlers/topology';
import { licenseHandlers, settingsHandlers, settingsWriteHandlers } from './handlers/settings';
import { floorplanHandlers } from './handlers/floorplan';
import { MOCK_CUSTOMERS, crmHandlers } from './handlers/crm';

// The mock's public surface is the three names the app actually imports through
// the vite alias on `@tauri-apps/api/core`. They are defined by the dispatcher
// and re-exported here so the alias target keeps answering for all of them.
export { convertFileSrc, invoke, isTauri };


// The location-profile list, the ticket-prefix pair and the unwrapArgs
// envelope helper lived here as module-private `let`s — that sharing is why
// -4:190 called this block the real blocker and deferred the consolidation.
// Phase 5.1 moved it verbatim to `handlers/locationState.ts`; the imports
// above are the only path in, and the regional / receipt reads below reach the
// list through getMockStores() until their own phases inject it.

// ═══════════════════════════════════════════════════════════════
// REGIONAL CONFIGURATION (regional slice 2, saas-2 design)
// ═══════════════════════════════════════════════════════════════
// Read model mirroring oz_core::RegionalConfig, which the command returns
// directly — snake_case fields, ConfigScope serde scope names ("location",
// "legal_entity", "organization", "built_in"). ADR #48: timezone.value is
// the STORED IANA name; offsets are derived at display/report time, never
// here.

/** One resolved regional axis as the dev mock serves it. */
interface MockRegionalValue {
  value: string;
  scope: 'location' | 'legal_entity' | 'organization' | 'built_in';
}

/** The effective regional configuration as the dev mock serves it. */
interface MockRegionalConfig {
  location_id: string;
  legal_entity_id: string | null;
  country_code: string | null;
  locale: MockRegionalValue;
  timezone: MockRegionalValue;
  currency: MockRegionalValue;
}

/** Written locale overrides per location id (slice 3 write model): the mock
 *  location rows predate the locale column, so writes land here instead of
 *  on the row. Blank = cleared (inherit). */
const mockRegionalLocale = new Map<string, string>();

/** The written market anchor (slice 3): the mock has no entity rows, so the
 *  entity-layer country_code is one module-level value. */
let mockRegionalCountryCode: string | null = null;

/** Resolve the regional config for a mock location: the location's own
 *  columns (plus slice-3 write overrides) first, then the built-in defaults
 *  — the same narrowest-first precedence the core resolver applies. The real
 *  backend also walks the legal-entity layer for its blank regional columns,
 *  which the mock cannot model: its LegalEntityDto (like the real one)
 *  carries no regional fields. */
function getMockRegionalConfig(args: unknown): MockRegionalConfig {
  const { locationId } = unwrapArgs<{ locationId?: string }>(args);
  const stores = getMockStores();
  const location = stores.find((loc) => loc.id === locationId) ?? stores[0] ?? MOCK_STORE;
  const axis = (value: string, fallback: string): MockRegionalValue =>
    value.trim() !== '' ? { value, scope: 'location' } : { value: fallback, scope: 'built_in' };
  const writtenLocale = mockRegionalLocale.get(location.id) ?? '';
  return {
    location_id: location.id,
    // The migration seed links every location to this entity id; the mock
    // has no entity rows to walk, so it is surfaced verbatim.
    legal_entity_id: 'default:default-legal-entity',
    country_code: mockRegionalCountryCode,
    locale: axis(writtenLocale, 'en-US'),
    timezone: axis(location.timezone, 'UTC'),
    currency: axis(location.currency, 'USD'),
  };
}

/** The slice-3 write: validate nothing here (the real backend validates in
 *  core; the mock's job is only to answer non-null), mutate the mock rows,
 *  and return the re-resolved config read-after-write. */
function setMockRegionalConfig(args: unknown): MockRegionalConfig {
  const { locationId, config } = unwrapArgs<{
    locationId?: string;
    config?: { locale?: string; timezone?: string; currency?: string; country_code?: string };
  }>(args);
  const stores = getMockStores();
  const location = stores.find((loc) => loc.id === locationId) ?? stores[0] ?? MOCK_STORE;
  if (config?.locale !== undefined) mockRegionalLocale.set(location.id, config.locale);
  if (config?.timezone !== undefined) {
    updateMockLocation({ id: location.id, timezone: config.timezone });
  }
  if (config?.currency !== undefined) {
    updateMockLocation({ id: location.id, currency: config.currency });
  }
  if (config?.country_code !== undefined) {
    mockRegionalCountryCode = config.country_code.trim() !== '' ? config.country_code : null;
  }
  return getMockRegionalConfig(args);
}



// ── Receipt format (regional receipt-format axis) ───────────────────
// One closed record per scope: content on the entity (statutory),
// layout on workspace/terminal (presentational, terminal over
// workspace over legacy). Session-local maps — the mock mirrors the
// core `Store::effective_receipt_format` semantics loosely, enough
// for the card's states.
interface MockReceiptLayout {
  paper_width_mm: number | null;
  margin_top_mm: number | null;
  margin_bottom_mm: number | null;
  margin_left_mm: number | null;
  margin_right_mm: number | null;
  show_logo: boolean | null;
  print_copies: number | null;
  show_table_number: boolean | null;
  footer_note: string | null;
}
interface MockReceiptContent {
  requiredFields: string[];
  footerText: string;
  showTax: boolean;
  showCurrency: boolean;
  decimalSeparator: string;
}
const mockReceiptLayouts = new Map<string, MockReceiptLayout>();
let mockReceiptContent: MockReceiptContent | null = null;

/** The effective read: content is unset in the mock (entity-layer
 *  authoring is a management surface), layout resolves terminal →
 *  workspace → built-in defaults with the same provenance names. */
function getMockReceiptFormat(args: unknown): {
  content: MockReceiptContent | null;
  content_source: string;
  layout: {
    paperWidthMm: number | null;
    marginTopMm: number | null;
    marginBottomMm: number | null;
    marginLeftMm: number | null;
    marginRightMm: number | null;
    showLogo: boolean | null;
    printCopies: number | null;
    showTableNumber: boolean | null;
    footerNote: string | null;
  };
  layout_source: string;
} {
  const { terminalId, workspaceId } = unwrapArgs<{
    terminalId?: string;
    workspaceId?: string;
  }>(args);
  const location =
    getMockStores().find((loc) => loc.id === workspaceId) ?? getMockStores()[0] ?? MOCK_STORE;
  const terminalKey = terminalId ? `terminal:${terminalId}` : null;
  const workspaceKey = `workspace:${workspaceId ?? location.id}`;
  const terminal = terminalKey ? mockReceiptLayouts.get(terminalKey) : undefined;
  const workspace = mockReceiptLayouts.get(workspaceKey);
  const layer = terminal ?? workspace;
  const source = terminal ? 'terminal' : workspace ? 'workspace' : 'unset';
  const pick = <T,>(terminalValue: T | null | undefined, workspaceValue: T | null | undefined): T | null =>
    terminal ? (terminalValue ?? null) : (workspaceValue ?? null);
  return {
    content: mockReceiptContent,
    content_source: mockReceiptContent ? 'entity' : 'unset',
    layout: {
      paperWidthMm: layer ? pick(terminal?.paper_width_mm, workspace?.paper_width_mm) : null,
      marginTopMm: pick(terminal?.margin_top_mm, workspace?.margin_top_mm),
      marginBottomMm: pick(terminal?.margin_bottom_mm, workspace?.margin_bottom_mm),
      marginLeftMm: pick(terminal?.margin_left_mm, workspace?.margin_left_mm),
      marginRightMm: pick(terminal?.margin_right_mm, workspace?.margin_right_mm),
      showLogo: pick(terminal?.show_logo, workspace?.show_logo),
      printCopies: pick(terminal?.print_copies, workspace?.print_copies),
      showTableNumber: pick(terminal?.show_table_number, workspace?.show_table_number),
      footerNote: pick(terminal?.footer_note, workspace?.footer_note),
    },
    layout_source: source,
  };
}

/** The card's write: replace the workspace-layer layout record (the card
 *  edits the whole record) and return the fresh effective read. */
function setMockReceiptLayout(args: unknown): {
  content: MockReceiptContent | null;
  content_source: string;
  layout: {
    paperWidthMm: number | null;
    marginTopMm: number | null;
    marginBottomMm: number | null;
    marginLeftMm: number | null;
    marginRightMm: number | null;
    showLogo: boolean | null;
    printCopies: number | null;
    showTableNumber: boolean | null;
    footerNote: string | null;
  };
  layout_source: string;
} {
  const { workspaceId, layout } = unwrapArgs<{
    workspaceId?: string;
    layout?: {
      paperWidthMm?: number | null;
      marginTopMm?: number | null;
      marginBottomMm?: number | null;
      marginLeftMm?: number | null;
      marginRightMm?: number | null;
      showLogo?: boolean | null;
      printCopies?: number | null;
      showTableNumber?: boolean | null;
      footerNote?: string | null;
    };
  }>(args);
  const location =
    getMockStores().find((loc) => loc.id === workspaceId) ?? getMockStores()[0] ?? MOCK_STORE;
  if (layout) {
    mockReceiptLayouts.set(`workspace:${location.id}`, {
      paper_width_mm: layout.paperWidthMm ?? null,
      margin_top_mm: layout.marginTopMm ?? null,
      margin_bottom_mm: layout.marginBottomMm ?? null,
      margin_left_mm: layout.marginLeftMm ?? null,
      margin_right_mm: layout.marginRightMm ?? null,
      show_logo: layout.showLogo ?? null,
      print_copies: layout.printCopies ?? null,
      show_table_number: layout.showTableNumber ?? null,
      footer_note: layout.footerNote ?? null,
    });
  }
  return getMockReceiptFormat(args);
}

/** The statutory-content write (W2-C): replaces the one content record
 *  and returns the fresh effective read. The mock mirrors the core
 *  upsert semantics session-locally — exactly one content row per
 *  entity, so a second write replaces the first. */
function setMockReceiptContent(args: unknown): ReturnType<typeof getMockReceiptFormat> {
  const { content } = unwrapArgs<{
    content?: {
      requiredFields?: string[];
      footerText?: string;
      showTax?: boolean;
      showCurrency?: boolean;
      decimalSeparator?: string;
    };
  }>(args);
  if (content) {
    mockReceiptContent = {
      requiredFields: content.requiredFields ?? [],
      footerText: content.footerText ?? '',
      showTax: content.showTax ?? true,
      showCurrency: content.showCurrency ?? false,
      decimalSeparator: content.decimalSeparator ?? 'dot',
    };
  }
  return getMockReceiptFormat(args);
}

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
  // LOCATIONS / DEPRECATED STORE PROFILE ALIASES
  // ═══════════════════════════════════════════════════════════════
  // Location is the canonical site-unit term. The old command names stay
  // available while clients migrate, but both families share the same
  // stateful mock list so browser-mode behavior matches the real IPC surface.

  'list_locations_scoped': listMockLocations,
  'get_location_profile_scoped': getMockLocation,
  'get_primary_location_scoped': getMockPrimaryLocation,
  'create_location_profile_scoped': createMockLocation,
  'update_location_profile_scoped': updateMockLocation,
  'set_primary_location_scoped': setMockPrimaryLocation,
  'delete_location_profile_scoped': deleteMockLocation,
  'get_location_ticket_prefix_scoped': getMockLocationTicketPrefix,
  'set_location_ticket_prefix_scoped': setMockLocationTicketPrefix,

  // Legal Entity (Organization-level, Phase 1 §G). Registered here because
  // scripts/verify-ipc-parity.py treats a missing dev-mock handler as a hard
  // violation: invoke() would return null and the caller would silently render
  // its failure path instead of erroring.

  // Regional configuration read model (regional slice 2). Registered here
  // because scripts/verify-ipc-parity.py treats a missing dev-mock handler
  // as a hard violation: invoke() would return null and the caller would
  // silently render its failure path instead of erroring.
  'get_regional_config_scoped': getMockRegionalConfig,

  // Regional configuration write path (regional slice 3) — same parity rule.
  'set_regional_config_scoped': setMockRegionalConfig,

  // Receipt format (regional receipt-format axis) — same parity rule.
  'get_receipt_format_scoped': getMockReceiptFormat,
  'set_receipt_layout_scoped': setMockReceiptLayout,
  'set_receipt_content_scoped': setMockReceiptContent,

  // ═════════════════════════════════════════════════════════
  // WORKSPACES (ADR #4 / #7)
  // ═══════════════════════════════════════════════════════════════

  'get_device_binding': () => ({ bounded: true, boundStoreId: 'store-1', boundInstanceId: 'ws-1', signatureValid: true }),
  'get_device_binding_scoped': () => ({ bounded: true, boundStoreId: 'store-1', boundInstanceId: 'ws-1', signatureValid: true }),
  'set_device_binding': () => null,
  'set_device_binding_scoped': () => null,
  'clear_device_binding': () => null,
  'clear_device_binding_scoped': () => null,

  // ═══════════════════════════════════════════════════════════════
  // SETTINGS
  // ═══════════════════════════════════════════════════════════════

  ...settingsHandlers,

  // ═══════════════════════════════════════════════════════════════
  // BRANDING
  // ═══════════════════════════════════════════════════════════════

  'get_brand_settings': () => ({
    primary_colour: '#147EFB',
    logo_path: null,
    store_name: 'OZ-POS Demo',
    colour_hover: null,
  }),
  'get_brand_settings_scoped': () => ({
    primary_colour: '#147EFB',
    logo_path: null,
    store_name: 'OZ-POS Demo',
    colour_hover: null,
  }),

  'print_sales_receipt': () => ({ printed: true }),
  'print_sales_receipt_scoped': () => ({ printed: true }),

  // ═══════════════════════════════════════════════════════════════
  // KDS DEVICE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════

  'list_kds_devices_scoped': () => [] as unknown[],
  'register_kds_device_scoped': (args: unknown) => {
    const input = (args as { input?: Record<string, unknown> })?.input ?? {};
    return {
      id: `kds-device-mock-${Date.now()}`,
      name: input['name'] ?? 'Mock KDS Device',
      restaurant_pos_id: input['restaurant_pos_id'] ?? 'resto-1',
      station_ids: input['station_ids'] ?? [],
      is_active: true,
      last_seen_at: new Date().toISOString(),
      connection_status: 'connected',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  },
  'get_kds_device_scoped': () => null,
  'update_kds_device_status_scoped': () => {},
  'deactivate_kds_device_scoped': () => {},
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

  'list_bundles': () => [
    {
      bundle: {
        id: 'bundle-1', bundle_sku: 'BNDL-PC-1', name: 'PC Starter Bundle',
        description: 'CPU + RAM + SSD combo', bundle_price_minor: 11500000, currency: 'IDR',
        active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      },
      items: [
        { id: 'bundle-item-1', bundle_id: 'bundle-1', sku: 'CPU-R5-7600', qty: 1, unit_price_minor: 3150000 },
        { id: 'bundle-item-2', bundle_id: 'bundle-1', sku: 'RAM-D5-32GB-CR', qty: 1, unit_price_minor: 1850000 },
      ],
    },
  ],
  'list_bundles_scoped': () => [
    {
      bundle: {
        id: 'bundle-1', bundle_sku: 'BNDL-PC-1', name: 'PC Starter Bundle',
        description: 'CPU + RAM + SSD combo', bundle_price_minor: 11500000, currency: 'IDR',
        active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      },
      items: [
        { id: 'bundle-item-1', bundle_id: 'bundle-1', sku: 'CPU-R5-7600', qty: 1, unit_price_minor: 3150000 },
        { id: 'bundle-item-2', bundle_id: 'bundle-1', sku: 'RAM-D5-32GB-CR', qty: 1, unit_price_minor: 1850000 },
      ],
    },
  ],
  'get_bundle': () => null,
  'get_bundle_scoped': () => null,
  'create_bundle': () => null,
  'create_bundle_scoped': () => null,
  'update_bundle': () => null,
  'update_bundle_scoped': () => null,
  'delete_bundle': () => null,
  'delete_bundle_scoped': () => null,
  'lookup_bundle_by_sku': () => null,
  'lookup_bundle_by_sku_scoped': () => null,

  // ═══════════════════════════════════════════════════════════════
  // HARDWARE
  // ═══════════════════════════════════════════════════════════════

  'open_cash_drawer': () => ({ opened: true }),
  'print_receipt': () => ({ printedLines: 3 }),
  'retry_offline_sync': () => ({ syncedCount: 0, failedCount: 0, totalCount: 0 }),

  'get_sync_settings': () => ({ serverUrl: null, hasApiKey: false, enabled: false }),
  'get_sync_settings_scoped': () => ({ serverUrl: null, hasApiKey: false, enabled: false }),
  'update_sync_settings': () => null,
  'sync_run': () => ({ synced: 0, failed: 0, error: null }),

  'pending_sync_count': () => 0,
  'sync_pull': (args: unknown) => {
    // SYNC-03: reject without explicit destructive consent, mirroring the
    // backend command contract so dev-mode behaviour matches production.
    const a = (args ?? {}) as { confirmDestructive?: boolean };
    if (!a.confirmDestructive) {
      throw new Error('confirmDestructive must be true to proceed with sync pull');
    }
    return { productsPulled: 0, taxRatesPulled: 0, usersPulled: 0, error: null };
  },
  'test_sync_connection': () => ({ ok: true, status: 'connected', latencyMs: 12 }),
  'request_sync_token': () => ({ ok: true, token: 'mock-jwt-token', status: 'issued', expiresAt: new Date(Date.now() + 86400000).toISOString() }),
};

// Merge this file's handlers into the registry the dispatcher routes through.
// The sibling work orders move whole domains out of this literal and into
// `handlers/*`; until they land, the literal remains the registry's main
// source, and everything below patches it in place.
registerHandlers(entryHandlers);
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
