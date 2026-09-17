/**
 * Dev-mock seed fixtures.
 *
 * The literals the browser preview starts from: the sample store, the default
 * staff roster, the category tree, the terminal and currency tables, the
 * auto-created legal entity, the inventory locations, and the initial workspace
 * instances.
 *
 * These were declared in `tauri-api.ts` and are relocated here unchanged, values
 * and comments included, so that the entry router stops being the place where
 * both the fixtures and the routing live. Nothing about how they are consumed
 * changes: every one of them is read at module load by the same code as before.
 *
 * Two clusters deliberately stayed behind, because they are owned by sibling
 * work orders rather than by the core extraction:
 *
 *   - the catalog fixtures (`RAW_MOCK_PRODUCTS`, `MOCK_PRODUCTS`), and
 *   - the authorization fixtures (`MOCK_ROLES`, `MOCK_ROLE_PERMISSIONS`,
 *     `MOCK_AUTHORED_ROLES`, `MOCK_PERMISSION_KEYS`).
 *
 * They move when the handler modules that consume them move.
 */

// ── Staff ─────────────────────────────────────────────────────────
// Five-role taxonomy (ADR #35 D4 / spec 0048): owner, admin, manager,
// staff, auditor — mirroring platform-core `ROLE_PRESETS`. Cashier and
// kitchen were retired (0048 2c) and no longer exist; the mock must
// exercise the same model the real backend seeds so browser previews gate
// like production. Pins: 1234 for every account (dev convenience) except
// admin, which keeps the historical 9999 that the E2E suite logs in with.
export const MOCK_STAFF: Record<string, {
  user_id: string;
  pin_hash: string;
  role: string;
  is_active: boolean;
}> = {
  'owner':   { user_id: 'owner-1',   pin_hash: '1234', role: 'role-owner',   is_active: true },
  'admin':   { user_id: 'admin-1',   pin_hash: '9999', role: 'role-admin',   is_active: true },
  'manager': { user_id: 'manager-1', pin_hash: '1234', role: 'role-manager', is_active: true },
  'staff':   { user_id: 'staff-1',   pin_hash: '1234', role: 'role-staff',   is_active: true },
  'auditor': { user_id: 'auditor-1', pin_hash: '1234', role: 'role-auditor', is_active: true },
};

// ── Catalog shape ─────────────────────────────────────────────────

export const MOCK_CATEGORIES = [
  { id: 'cat-cpu', name: 'Processors (CPU)', colour: '#e74c3c', icon: 'cpu-1' },
  { id: 'cat-gpu', name: 'Graphics Cards (GPU)', colour: '#2ecc71', icon: 'gpu-1' },
  { id: 'cat-ram', name: 'Memory (RAM)', colour: '#9b59b6', icon: 'ram-1' },
  { id: 'cat-storage', name: 'Storage (SSD/HDD)', colour: '#3498db', icon: 'hdd-1' },
  { id: 'cat-mb', name: 'Motherboards', colour: '#f39c12', icon: 'mb-1' },
  { id: 'cat-psu', name: 'Power Supply', colour: '#1abc9c', icon: 'psu-1' },
  { id: 'cat-cooling', name: 'Cooling & Cases', colour: '#34495e', icon: 'cool-1' },
];

// ── Store, terminal, money ────────────────────────────────────────

export const MOCK_STORE = {
  id: 'store-1',
  name: 'TOKO TEST',
  address: 'Jl. Contoh No. 123',
  tax_id: 'TAX-001',
  currency: 'IDR',
  timezone: '+07:00',
  is_primary: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

export const MOCK_CURRENCIES = [
  { code: 'IDR', name: 'Indonesian Rupiah', minor_exponent: 0, symbol: 'Rp' },
  { code: 'USD', name: 'US Dollar', minor_exponent: 2, symbol: '$' },
  { code: 'JPY', name: 'Japanese Yen', minor_exponent: 0, symbol: '¥' },
];

export const MOCK_TERMINAL = {
  id: 'term-1',
  name: 'Terminal 1',
  deviceId: 'device-001',
  isActive: true,
  lastSeenAt: new Date().toISOString(),
  metadata: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// ── Legal entity ──────────────────────────────────────────────────

/** Seed Legal Entity mirroring migration `20260908_legal_entities.sql`, which
 *  auto-creates one deterministic "Default Legal Entity" per existing tenant.
 *  `tenantId: 'default'` matches DEFAULT_TENANT_ID in
 *  apps/desktop-tauri/src/commands/legal_entities.rs, and the field names are
 *  camelCase because the Rust DTO uses `#[serde(rename_all = "camelCase")]`. */
export const MOCK_LEGAL_ENTITY = {
  id: 'le-default',
  tenantId: 'default',
  name: 'Default Legal Entity',
  legalName: 'Default Legal Entity',
  registrationNumber: '',
  taxId: '',
  status: 'active' as 'active' | 'inactive',
  createdAt: '2026-09-08T00:00:00.000Z',
  updatedAt: '2026-09-08T00:00:00.000Z',
};

// ── Inventory locations ───────────────────────────────────────────

export const MOCK_INVENTORY_LOCATIONS = [
  { id: 'loc-1', name: 'Main Store', type: 'store' as const, description: 'Main retail location', is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: 'loc-2', name: 'Warehouse', type: 'warehouse' as const, description: 'Central warehouse', is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
];

// ── Workspace instances ───────────────────────────────────────────

// Stateful workspace instances — the real backend persists
// workspace_instances rows, and apply_topology_diff mutates them. Seed
// from localStorage so previews round-trip instance creates/archives the
// same way the real store DB does.
export const MOCK_WORKSPACES_SEED = [
  { instance_id: 'ws-1', type_key: 'store-pos', store_id: 'store-1', store_name: 'TOKO TEST', name: 'Store POS', description: 'Point of Sale', icon: 'shopping-cart', layout_mode: 'default', colour: '#10b981', is_default: true },
  { instance_id: 'ws-2', type_key: 'restaurant-pos', store_id: 'store-1', store_name: 'TOKO TEST', name: 'Restaurant POS', description: 'Table service', icon: 'restaurant', layout_mode: 'fullscreen', colour: '#ef4444', is_default: false },
  { instance_id: 'ws-3', type_key: 'kds', store_id: 'store-1', store_name: 'TOKO TEST', name: 'Kitchen Display', description: 'Order display', icon: 'utensils', layout_mode: 'kds', colour: '#f59e0b', is_default: false },
  { instance_id: 'ws-4', type_key: 'warehouse', store_id: 'store-1', store_name: 'TOKO TEST', name: 'Warehouse', description: 'Product and stock management', icon: 'package', layout_mode: 'default', colour: '#3b82f6', is_default: false },
  { instance_id: 'ws-5', type_key: 'admin', store_id: 'store-1', store_name: 'TOKO TEST', name: 'Admin', description: 'Settings & management', icon: 'settings', layout_mode: 'default', colour: '#8b5cf6', is_default: false },
];
