/**
 * Dev-mock handlers — catalog domain.
 *
 * Products, product variants, barcode/SKU lookup, categories, currency and
 * exchange rates, and the session-local tax-rate store. Extracted from
 * `tauri-api.ts` by the agent-2 work order
 * (`todo-refactor-devmock-agents-2.md`, phase 2.1); the code is moved
 * verbatim, comments included — only its location changes.
 *
 * Fixture ownership. The product fixtures (`RAW_MOCK_PRODUCTS`,
 * `MOCK_PRODUCTS`) moved here with the handlers that consume them, exactly as
 * `core/mockSeedData.ts` promised they would: "They move when the handler
 * modules that consume them move." `MOCK_PRODUCTS` is re-exported because
 * three domains still read it from the entry router — the sales line builder,
 * the analytics reports, and the demo sale seeder. Those leave in later
 * phases; this re-export is what keeps them working until then.
 *
 * Why `unwrapArgs` is injected instead of imported. It lives in the entry
 * router and is called 32 times there. Importing it back would close a cycle
 * (`tauri-api` → `handlers/catalog` → `tauri-api`), which is the same hazard
 * `core/mockDispatcher.ts` documents for itself. So the three tax mutators
 * take it as their first parameter and are bound to the router's copy in
 * `createCatalogHandlers`.
 */

import type { MockHandler } from '../core/mockDispatcher';
import { MOCK_CATEGORIES, MOCK_CURRENCIES } from '../core/mockSeedData';

/** Signature of the entry router's `{ args }`-envelope unwrapper. */
export type UnwrapArgs = <T extends Record<string, unknown> = Record<string, unknown>>(
  args: unknown,
) => T;

/** Dependencies the entry router lends to this module. */
export interface CatalogDeps {
  unwrapArgs: UnwrapArgs;
}

// ═══════════════════════════════════════════════════════════════════
// PRODUCT FIXTURES
// ═══════════════════════════════════════════════════════════════════

const RAW_MOCK_PRODUCTS = [
  { sku: 'CPU-R7-7800X3D', name: 'AMD Ryzen 7 7800X3D 8-Core', category: 'Processors (CPU)', price: { minor_units: 6250000, currency: 'IDR' }, barcode: '730143314930', in_stock: true, stock_qty: 15, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'retail' },
  { sku: 'CPU-I7-14700K', name: 'Intel Core i7-14700K 20-Core', category: 'Processors (CPU)', price: { minor_units: 6450000, currency: 'IDR' }, barcode: '503203727850', in_stock: true, stock_qty: 10, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'retail' },
  { sku: 'CPU-R5-7600', name: 'AMD Ryzen 5 7600 6-Core', category: 'Processors (CPU)', price: { minor_units: 3150000, currency: 'IDR' }, barcode: '730143314503', in_stock: true, stock_qty: 25, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'retail' },
  { sku: 'GPU-RTX4070TS', name: 'ASUS TUF RTX 4070 Ti Super 16GB', category: 'Graphics Cards (GPU)', price: { minor_units: 14850000, currency: 'IDR' }, barcode: '195553554890', in_stock: true, stock_qty: 8, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'retail' },
  { sku: 'GPU-RX7800XT', name: 'Sapphire PULSE RX 7800 XT 16GB', category: 'Graphics Cards (GPU)', price: { minor_units: 8450000, currency: 'IDR' }, barcode: '489517350567', in_stock: true, stock_qty: 12, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'retail' },
  { sku: 'GPU-RTX4060', name: 'MSI Ventus 2X RTX 4060 8GB', category: 'Graphics Cards (GPU)', price: { minor_units: 4750000, currency: 'IDR' }, barcode: '824142323456', in_stock: true, stock_qty: 20, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'retail' },
  { sku: 'RAM-D5-32GB-CR', name: 'Corsair Vengeance DDR5 32GB 6000MHz', category: 'Memory (RAM)', price: { minor_units: 1850000, currency: 'IDR' }, barcode: '840006698765', in_stock: true, stock_qty: 30, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'retail' },
  { sku: 'RAM-D5-64GB-GS', name: 'G.Skill Trident Z5 RGB 64GB DDR5', category: 'Memory (RAM)', price: { minor_units: 3450000, currency: 'IDR' }, barcode: '848354041234', in_stock: true, stock_qty: 14, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'retail' },
  { sku: 'RAM-D4-16GB-KF', name: 'Kingston Fury Beast 16GB DDR4 3200', category: 'Memory (RAM)', price: { minor_units: 680000, currency: 'IDR' }, barcode: '740617319800', in_stock: true, stock_qty: 45, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'retail' },
  { sku: 'SSD-990PRO-2TB', name: 'Samsung 990 PRO 2TB NVMe M.2 SSD', category: 'Storage (SSD/HDD)', price: { minor_units: 2750000, currency: 'IDR' }, barcode: '887276722340', in_stock: true, stock_qty: 22, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'retail' },
  { sku: 'SSD-P3P-1TB', name: 'Crucial P3 Plus 1TB M.2 NVMe SSD', category: 'Storage (SSD/HDD)', price: { minor_units: 1150000, currency: 'IDR' }, barcode: '649528918900', in_stock: true, stock_qty: 35, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'retail' },
  { sku: 'HDD-ST-4TB', name: 'Seagate BarraCuda 4TB 3.5" HDD', category: 'Storage (SSD/HDD)', price: { minor_units: 1350000, currency: 'IDR' }, barcode: '763649112340', in_stock: true, stock_qty: 18, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'retail' },
  { sku: 'MB-B650-ROG', name: 'ASUS ROG Strix B650-A Gaming WiFi', category: 'Motherboards', price: { minor_units: 3650000, currency: 'IDR' }, barcode: '195553948760', in_stock: true, stock_qty: 9, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'retail' },
  { sku: 'MB-Z790-MSI', name: 'MSI MAG Z790 Tomahawk WiFi LGA1700', category: 'Motherboards', price: { minor_units: 4250000, currency: 'IDR' }, barcode: '824142301230', in_stock: true, stock_qty: 7, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'retail' },
  { sku: 'PSU-RM850X', name: 'Corsair RM850x 850W 80+ Gold Modular', category: 'Power Supply', price: { minor_units: 2150000, currency: 'IDR' }, barcode: '840006601234', in_stock: true, stock_qty: 16, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'retail' },
  { sku: 'COOL-PA120', name: 'Thermalright Peerless Assassin 120 SE', category: 'Cooling & Cases', price: { minor_units: 580000, currency: 'IDR' }, barcode: '784562098120', in_stock: true, stock_qty: 40, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'retail' },
  { sku: 'COOL-KRAKEN360', name: 'NZXT Kraken Elite 360 RGB AIO Liquid', category: 'Cooling & Cases', price: { minor_units: 4450000, currency: 'IDR' }, barcode: '815671018900', in_stock: true, stock_qty: 12, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'retail' },
  { sku: 'PASTE-MX6', name: 'Arctic MX-6 Thermal Paste 4g', category: 'Cooling & Cases', price: { minor_units: 125000, currency: 'IDR' }, barcode: '872767004500', in_stock: true, stock_qty: 60, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'retail' },
  // Restaurant-menu items (product_type: 'restaurant') so the Restaurant POS
  // menu is populated in the E2E dev-mock and a completed restaurant sale
  // feeds the Kitchen Display (KDS) ticket queue. The retail grid also shows
  // these — harmless for the artificial mock catalog.
  // ── Hot Drinks ──
  { sku: 'LATTE', name: 'Caffè Latte', category: 'Hot Drinks', price: { minor_units: 45000, currency: 'IDR' }, barcode: '4901234567890', in_stock: true, stock_qty: 50, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'restaurant' },
  { sku: 'CAPPU', name: 'Cappuccino', category: 'Hot Drinks', price: { minor_units: 42000, currency: 'IDR' }, barcode: '4901234567891', in_stock: true, stock_qty: 40, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'restaurant' },
  { sku: 'ESPR', name: 'Espresso Shot', category: 'Hot Drinks', price: { minor_units: 28000, currency: 'IDR' }, barcode: '4901234567892', in_stock: true, stock_qty: 60, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'restaurant' },
  { sku: 'KOPI-T', name: 'Kopi Tubruk', category: 'Hot Drinks', price: { minor_units: 15000, currency: 'IDR' }, barcode: '4901234567900', in_stock: true, stock_qty: 80, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'restaurant' },
  { sku: 'TEH-T', name: 'Teh Tarik', category: 'Hot Drinks', price: { minor_units: 18000, currency: 'IDR' }, barcode: '4901234567901', in_stock: true, stock_qty: 70, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'restaurant' },
  // ── Cold Drinks ──
  { sku: 'ICED', name: 'Iced Coffee', category: 'Cold Drinks', price: { minor_units: 32000, currency: 'IDR' }, barcode: '4901234567893', in_stock: true, stock_qty: 50, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'restaurant' },
  { sku: 'MATCHA', name: 'Matcha Latte', category: 'Cold Drinks', price: { minor_units: 38000, currency: 'IDR' }, barcode: '4901234567895', in_stock: true, stock_qty: 35, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'restaurant' },
  { sku: 'ES-TEH', name: 'Es Teh Manis', category: 'Cold Drinks', price: { minor_units: 8000, currency: 'IDR' }, barcode: '4901234567902', in_stock: true, stock_qty: 100, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'restaurant' },
  { sku: 'ES-JERUK', name: 'Es Jeruk Peras', category: 'Cold Drinks', price: { minor_units: 12000, currency: 'IDR' }, barcode: '4901234567903', in_stock: true, stock_qty: 60, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'restaurant' },
  { sku: 'JUS-ALPUKAT', name: 'Jus Alpukat', category: 'Cold Drinks', price: { minor_units: 20000, currency: 'IDR' }, barcode: '4901234567904', in_stock: true, stock_qty: 40, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'restaurant' },
  { sku: 'SODA-GEMBIRA', name: 'Soda Gembira', category: 'Cold Drinks', price: { minor_units: 20000, currency: 'IDR' }, barcode: '4901234567905', in_stock: true, stock_qty: 45, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'restaurant' },
  { sku: 'AIR-MINERAL', name: 'Air Mineral', category: 'Cold Drinks', price: { minor_units: 5000, currency: 'IDR' }, barcode: '4901234567906', in_stock: true, stock_qty: 200, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'restaurant' },
  // ── Main Food ──
  { sku: 'NASI-GORENG', name: 'Nasi Goreng Spesial', category: 'Food', price: { minor_units: 35000, currency: 'IDR' }, barcode: '4901234567910', in_stock: true, stock_qty: 30, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'restaurant' },
  { sku: 'MIE-GORENG', name: 'Mie Goreng Jawa', category: 'Food', price: { minor_units: 28000, currency: 'IDR' }, barcode: '4901234567911', in_stock: true, stock_qty: 35, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'restaurant' },
  { sku: 'AYAM-BAKAR', name: 'Ayam Bakar Madu', category: 'Food', price: { minor_units: 38000, currency: 'IDR' }, barcode: '4901234567912', in_stock: true, stock_qty: 25, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'restaurant' },
  { sku: 'SATE-AYAM', name: 'Sate Ayam 10 Tusuk', category: 'Food', price: { minor_units: 32000, currency: 'IDR' }, barcode: '4901234567913', in_stock: true, stock_qty: 40, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'restaurant' },
  { sku: 'SOTO-AYAM', name: 'Soto Ayam', category: 'Food', price: { minor_units: 25000, currency: 'IDR' }, barcode: '4901234567914', in_stock: true, stock_qty: 30, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'restaurant' },
  { sku: 'RAWON', name: 'Rawon Daging', category: 'Food', price: { minor_units: 35000, currency: 'IDR' }, barcode: '4901234567915', in_stock: true, stock_qty: 20, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'restaurant' },
  { sku: 'GADO-GADO', name: 'Gado-Gado', category: 'Food', price: { minor_units: 22000, currency: 'IDR' }, barcode: '4901234567916', in_stock: true, stock_qty: 35, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'restaurant' },
  // ── Appetizers & Sides ──
  { sku: 'CROISS', name: 'Butter Croissant', category: 'Food', price: { minor_units: 35000, currency: 'IDR' }, barcode: '4901234567896', in_stock: true, stock_qty: 45, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'restaurant' },
  { sku: 'BAKWAN', name: 'Bakwan Sayur', category: 'Food', price: { minor_units: 10000, currency: 'IDR' }, barcode: '4901234567920', in_stock: true, stock_qty: 50, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'restaurant' },
  { sku: 'TAHU-GORENG', name: 'Tahu Goreng', category: 'Food', price: { minor_units: 12000, currency: 'IDR' }, barcode: '4901234567921', in_stock: true, stock_qty: 60, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'restaurant' },
  { sku: 'TEMPE-GORENG', name: 'Tempe Goreng', category: 'Food', price: { minor_units: 10000, currency: 'IDR' }, barcode: '4901234567922', in_stock: true, stock_qty: 60, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'restaurant' },
  // ── Desserts ──
  { sku: 'PISANG-GORENG', name: 'Pisang Goreng', category: 'Dessert', price: { minor_units: 15000, currency: 'IDR' }, barcode: '4901234567930', in_stock: true, stock_qty: 40, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'restaurant' },
  { sku: 'ES-KRIM', name: 'Es Krim Coklat', category: 'Dessert', price: { minor_units: 18000, currency: 'IDR' }, barcode: '4901234567931', in_stock: true, stock_qty: 30, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'restaurant' },
  { sku: 'KLEPON', name: 'Klepon', category: 'Dessert', price: { minor_units: 12000, currency: 'IDR' }, barcode: '4901234567932', in_stock: true, stock_qty: 50, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'restaurant' },
  { sku: 'ES-CAMPUR', name: 'Es Campur', category: 'Dessert', price: { minor_units: 18000, currency: 'IDR' }, barcode: '4901234567933', in_stock: true, stock_qty: 35, tax_rate_ids: [], created_at: new Date().toISOString(), price_updated_at: new Date().toISOString(), product_type: 'restaurant' },
];

// ADR #36/#37: enrich the raw mock catalog with the retail attribute fields
// (brand/rack/notes/unit/cost) and a deterministic popularity score so the
// default popularity sort has visible ordering in dev/demo.
const MOCK_PRODUCTS = RAW_MOCK_PRODUCTS.map((p, i) => ({
  ...p,
  cost_minor: 0,
  brand: p.name.includes('AMD') || p.name.includes('Ryzen') ? 'AMD' : null,
  rack_location: `R-${String(Math.floor(i / 4) + 1).padStart(2, '0')}`, // R-01..R-05
  notes: null,
  unit: 'pcs',
  is_active: true,
  default_supplier_id: null,
  popularity_score: RAW_MOCK_PRODUCTS.length - i, // descending demo ranking
}));

// ═══════════════════════════════════════════════════════════════════
// TAX RATE STORE
// ═══════════════════════════════════════════════════════════════════

// -- Mock tax rates (B1 contract: session-local, scope/window echo) ----

interface MockTaxScope {
  scope: string;
  legalEntityId: string | null;
  locationId: string | null;
}

interface MockTaxWindow {
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

interface MockTaxRate {
  id: string;
  name: string;
  rate_bps: number;
  is_default: boolean;
  is_inclusive: boolean;
  display_rate: string;
  created_at: string;
  updated_at: string;
  scope: MockTaxScope | null;
  window: MockTaxWindow | null;
}

let mockTaxRates: MockTaxRate[] = [];
let mockTaxSeq = 0;

const GLOBAL_MOCK_SCOPE: MockTaxScope = {
  scope: "global",
  legalEntityId: null,
  locationId: null,
};

function mockTaxDisplayRate(rateBps: number): string {
  return (rateBps / 100).toFixed(2) + "%";
}

/** Map the optional scope args to a mock scope, refusing the both-set
 *  combination exactly like the typed backend validation. */
function mockScopeFromArgs(args: {
  legalEntityId?: string;
  locationId?: string;
}): MockTaxScope {
  if (args.legalEntityId != null && args.locationId != null) {
    throw new Error(
      "legal_entity_id and location_id are mutually exclusive: a tax rate is entity-scoped OR location-scoped OR tenant-global",
    );
  }
  if (args.legalEntityId != null) {
    return { scope: "legal_entity", legalEntityId: args.legalEntityId, locationId: null };
  }
  if (args.locationId != null) {
    return { scope: "location", legalEntityId: null, locationId: args.locationId };
  }
  return GLOBAL_MOCK_SCOPE;
}

/** Echo a stored rate row as the list DTO (top-level snake_case, inner
 *  scope/window camelCase — mirroring the Rust serde attributes). */
function mockTaxRateDto(row: MockTaxRate): MockTaxRate {
  return { ...row };
}

function createMockTaxRate(unwrapArgs: UnwrapArgs, args: unknown): MockTaxRate | null {
  const a = unwrapArgs<{
    name?: string;
    rateBps?: number;
    isDefault?: boolean;
    isInclusive?: boolean;
    legalEntityId?: string;
    locationId?: string;
    effectiveFrom?: string;
    effectiveTo?: string;
  }>(args);
  const scope = mockScopeFromArgs(a);
  const now = new Date().toISOString();
  mockTaxSeq += 1;
  const row: MockTaxRate = {
    id: "tax-rate-" + mockTaxSeq,
    name: a.name ?? "Rate " + mockTaxSeq,
    rate_bps: a.rateBps ?? 0,
    is_default: a.isDefault ?? false,
    is_inclusive: a.isInclusive ?? false,
    display_rate: mockTaxDisplayRate(a.rateBps ?? 0),
    created_at: now,
    updated_at: now,
    scope,
    window: {
      effectiveFrom: a.effectiveFrom ?? null,
      effectiveTo: a.effectiveTo ?? null,
    },
  };
  mockTaxRates.push(row);
  return mockTaxRateDto(row);
}

function listMockTaxRates(args: unknown): MockTaxRate[] {
  void args;
  return mockTaxRates.map(mockTaxRateDto);
}

function updateMockTaxRate(unwrapArgs: UnwrapArgs, args: unknown): MockTaxRate | null {
  const a = unwrapArgs<{
    id?: string;
    name?: string;
    rateBps?: number;
    isDefault?: boolean;
    isInclusive?: boolean;
    legalEntityId?: string;
    locationId?: string;
    effectiveFrom?: string;
    effectiveTo?: string;
  }>(args);
  const row = mockTaxRates.find((r) => r.id === (a.id ?? ""));
  if (row == null) {
    throw new Error("tax rate " + (a.id ?? "") + " not found");
  }
  if (a.name != null) row.name = a.name;
  if (a.rateBps != null) {
    row.rate_bps = a.rateBps;
    row.display_rate = mockTaxDisplayRate(a.rateBps);
  }
  if (a.isDefault != null) row.is_default = a.isDefault;
  if (a.isInclusive != null) row.is_inclusive = a.isInclusive;
  // Scope/window args present route to the tier-scoped write; absent
  // keeps the row's stored scope, mirroring the legacy global-arm update.
  const hasScopeArgs =
    a.legalEntityId != null || a.locationId != null ||
    a.effectiveFrom != null || a.effectiveTo != null;
  if (hasScopeArgs) {
    row.scope = mockScopeFromArgs(a);
    row.window = {
      effectiveFrom: a.effectiveFrom ?? null,
      effectiveTo: a.effectiveTo ?? null,
    };
  }
  row.updated_at = new Date().toISOString();
  return mockTaxRateDto(row);
}

function deleteMockTaxRate(unwrapArgs: UnwrapArgs, args: unknown): null {
  const a = unwrapArgs<{ id?: string }>(args);
  mockTaxRates = mockTaxRates.filter((r) => r.id !== (a.id ?? ""));
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// HANDLER MAP
// ═══════════════════════════════════════════════════════════════════

// Re-exported for the entry router's remaining product readers.
export { MOCK_PRODUCTS };

const catalogHandlers: Record<string, MockHandler> = {

  // ═══════════════════════════════════════════════════════════════
  // PRODUCTS
  // ═══════════════════════════════════════════════════════════════

  'list_products': () => MOCK_PRODUCTS,
  'list_products_scoped': () => MOCK_PRODUCTS,
  'create_product': () => ({ sku: 'SKU-NEW' }),
  'create_product_scoped': () => ({ sku: 'SKU-NEW' }),
  'update_product': () => ({ sku: 'SKU-UPD' }),
  'update_product_scoped': () => ({ sku: 'SKU-UPD' }),
  'delete_product': () => null,
  'delete_product_scoped': () => null,

  // ADR #37 D3: fire-and-forget popularity search signal.
  'record_product_search_scoped': () => null,

  // ADR #38 D3: browser opening — dev-mock keeps window.open fallback
  // client-side; the real backend performs the open in production.
  'open_product_images_scoped': () => null,

  'lookup_product_by_sku': (args) => {
    const { sku } = args as { sku: string };
    return MOCK_PRODUCTS.find(p => p.sku === sku) ?? null;
  },
  'lookup_product_by_sku_scoped': (args) => {
    const { sku } = args as { sku: string };
    return MOCK_PRODUCTS.find(p => p.sku === sku) ?? null;
  },
  'lookup_by_barcode': (args) => {
    const { barcode } = args as { barcode: string };
    return MOCK_PRODUCTS.find(p => p.barcode === barcode) ?? null;
  },
  'lookup_by_barcode_scoped': (args) => {
    const { barcode } = args as { barcode: string };
    return MOCK_PRODUCTS.find(p => p.barcode === barcode) ?? null;
  },

  'get_product_track_serial': () => false,
  'get_product_track_serial_scoped': () => false,
  'get_product_track_serial_batch': (args) => {
    const { skus } = args as { skus: string[] };
    return (skus ?? []).map((sku) => ({ sku, track_serial: false }));
  },
  'get_product_track_serial_batch_scoped': (args) => {
    const { skus } = args as { skus: string[] };
    return (skus ?? []).map((sku) => ({ sku, track_serial: false }));
  },

  'list_product_variants': () => [],
  'get_product_variant': () => null,
  'create_product_variant': () => ({ sku: 'VAR-NEW' }),
  'update_product_variant': () => ({ sku: 'VAR-UPD' }),
  'delete_product_variant': () => null,
  'list_product_variants_scoped': () => [],
  'get_product_variant_scoped': () => null,
  'create_product_variant_scoped': () => ({ sku: 'VAR-NEW' }),
  'update_product_variant_scoped': () => ({ sku: 'VAR-UPD' }),
  'delete_product_variant_scoped': () => null,

  // ═══════════════════════════════════════════════════════════════
  // CATEGORIES
  // ═══════════════════════════════════════════════════════════════

  'list_categories': () => MOCK_CATEGORIES,
  'list_categories_scoped': () => MOCK_CATEGORIES,
  'create_category': () => ({ id: 'cat-new' }),
  'update_category': () => ({ id: 'cat-upd' }),
  'delete_category': () => null,

  // ═══════════════════════════════════════════════════════════════
  // CURRENCY
  // ═══════════════════════════════════════════════════════════════

  'currency_info': () => ({ code: 'IDR', exponent: 0 }),
  'list_currencies': () => MOCK_CURRENCIES,
  'list_currencies_scoped': () => MOCK_CURRENCIES,
  'get_default_currency': () => 'IDR',
  'set_default_currency': () => null,
  'get_default_currency_scoped': () => 'IDR',
  'set_default_currency_scoped': () => null,
  'list_exchange_rates': () => [
    { id: 'rate-1', from_currency: 'USD', to_currency: 'IDR', rate_millionths: 1_6000000, source: 'manual', effective_date: '2026-08-01', created_at: new Date().toISOString() },
  ],
  'list_exchange_rates_scoped': () => [
    { id: 'rate-1', from_currency: 'USD', to_currency: 'IDR', rate_millionths: 1_6000000, source: 'manual', effective_date: '2026-08-01', created_at: new Date().toISOString() },
  ],
  'list_latest_exchange_rates_scoped': () => [
    { id: 'rate-1', from_currency: 'USD', to_currency: 'IDR', rate_millionths: 1_6000000, source: 'manual', effective_date: '2026-08-01', created_at: new Date().toISOString() },
  ],
  'create_exchange_rate': () => null,
  'create_exchange_rate_scoped': () => null,
  'delete_exchange_rate': () => null,
  'delete_exchange_rate_scoped': () => null,
  'get_latest_exchange_rate_scoped': () => ({ id: 'rate-1', from_currency: 'USD', to_currency: 'IDR', rate_millionths: 1_6000000, source: 'manual', effective_date: '2026-08-01', created_at: new Date().toISOString() }),

  // ═══════════════════════════════════════════════════════════════
  // TAX
  // ═══════════════════════════════════════════════════════════════

  'compute_cart_tax_scoped': () => ({ taxMinor: 0, hasExclusive: false }),
  'list_tax_rates_scoped': listMockTaxRates,
  // E1-5: the batch rounding-mode read. The mock tenant's rate rows
  // carry no statutory directive, so every id reads null — exactly the
  // core ''-column semantics (null = the store preference applies,
  // never a claimed directive).
  'list_tax_rate_rounding_modes_scoped': (raw) => {
    const { rateIds } = (raw as { rateIds?: string[] }) ?? {};
    const out: Record<string, null> = {};
    for (const id of Array.isArray(rateIds) ? rateIds : []) out[id] = null;
    return out;
  },

  'get_tax_rate_dependency_counts_scoped': () => ({ products: 0, categories: 0, sale_lines: 0 }),
  'list_category_tax_rates_scoped': () => [],
  'set_category_tax_rates_scoped': () => null,
};

/**
 * Build the catalog handler map with the entry router's unwrapper bound in.
 *
 * The three tax mutators cannot sit in the module-level map above: each calls
 * the injected unwrapper, which module-level code has no access to. They are
 * bound here instead, over the shared map.
 */
export function createCatalogHandlers(deps: CatalogDeps): Record<string, MockHandler> {
  return {
    ...catalogHandlers,
    'create_tax_rate_scoped': (args) => createMockTaxRate(deps.unwrapArgs, args),
    'update_tax_rate_scoped': (args) => updateMockTaxRate(deps.unwrapArgs, args),
    'delete_tax_rate_scoped': (args) => deleteMockTaxRate(deps.unwrapArgs, args),
  };
}
