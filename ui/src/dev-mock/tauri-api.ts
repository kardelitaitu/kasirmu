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

import { emit } from './tauri-event';
// The real `version` command answers with `env!("CARGO_PKG_VERSION")`, so the
// browser preview must not invent its own number: the literal here went stale
// (still 0.0.9 while the app shipped 0.0.37) and made the lock-screen footer
// look wrong in dev. ui/package.json is bumped by scripts/bump-version.ps1
// alongside Cargo.toml/tauri.conf.json, so importing it keeps mock and app in
// lockstep.
import pkg from '../../package.json';

// ── Mock staff data ────────────────────────────────────────────
// Five-role taxonomy (ADR #35 D4 / spec 0048): owner, admin, manager,
// staff, auditor — mirroring platform-core `ROLE_PRESETS`. Cashier and
// kitchen were retired (0048 2c) and no longer exist; the mock must
// exercise the same model the real backend seeds so browser previews gate
// like production. Pins: 1234 for every account (dev convenience) except
// admin, which keeps the historical 9999 that the E2E suite logs in with.
const MOCK_STAFF: Record<string, {
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

/** Display name for a preset role id (the real seeded role names). */
function mockRoleName(role: string): string {
  switch (role) {
    case 'role-owner': return 'Owner';
    case 'role-admin': return 'Admin';
    case 'role-manager': return 'Manager';
    case 'role-staff': return 'Staff';
    case 'role-auditor': return 'Auditor';
    default: return role.replace('role-', '').charAt(0).toUpperCase() + role.replace('role-', '').slice(1);
  }
}

/**
 * A staff member row with the assignment the real backend resolves: preset
 * roles are global all/all (legacy users without an assignment row resolve
 * the same way per ADR #35 D5 / spec 0048).
 */
function mockStaffMember(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'staff-1',
    username: 'owner',
    display_name: 'Owner',
    role_id: 'role-owner',
    role_name: 'Owner',
    is_active: true,
    national_id_masked: '',
    is_profile_complete: true,
    assignment: {
      scope_mode: 'global',
      branches_all: true,
      branch_ids: [],
      workspaces_all: true,
      workspace_keys: [],
      scope_type: 'organization',
      scope_id: null,
    },
    ...overrides,
  };
}

/**
 * The staff rows the dev mock serves, in ONE place.
 *
 * Extracted because two commands now report the same people: list_staff_scoped
 * lists them, and list_role_holders_scoped counts and groups them per role. A
 * second literal copy would let the role screen claim one number of accounts
 * while its own expanded list named different ones -- the exact contradiction
 * the real backend was just fixed for, reproduced in the preview that exists
 * to catch it. One source, so the mock cannot show it.
 */
function mockStaffFixtures(): Array<Record<string, unknown>> {
  return [
    mockStaffMember({ id: 'staff-1', username: 'owner', display_name: 'Owner', role_id: 'role-owner', role_name: 'Owner' }),
    mockStaffMember({ id: 'staff-2', username: 'admin', display_name: 'Admin', role_id: 'role-admin', role_name: 'Admin' }),
    mockStaffMember({ id: 'staff-3', username: 'manager', display_name: 'Manager', role_id: 'role-manager', role_name: 'Manager' }),
    mockStaffMember({ id: 'staff-4', username: 'staff', display_name: 'Staff', role_id: 'role-staff', role_name: 'Staff' }),
    mockStaffMember({ id: 'staff-5', username: 'auditor', display_name: 'Auditor', role_id: 'role-auditor', role_name: 'Auditor' }),
  ];
}

/** Granted permission keys per preset, mirroring platform-core ROLE_PRESETS. */
const MOCK_ROLE_PERMISSIONS: Record<string, string[]> = {
  // Owner — global wildcard.
  'role-owner': ['*'],
  // Admin — everything except ownership transfer, billing, and irreversible
  // org actions (staff deletion is owner-only).
  'role-admin': [
    'sales:process', 'sales:void', 'sales:refund', 'sales:view', 'sales:discount', 'sales:split', 'sales:override_price',
    'products:create', 'products:read', 'products:update', 'products:delete', 'products:import', 'products:export', 'products:edit_cost',
    'inventory:view', 'inventory:adjust', 'inventory:transfer', 'inventory:count', 'inventory:locations_manage',
    'staff:read', 'staff:create', 'staff:update', 'staff:manage_roles', 'staff:read_identity', 'staff:read_payroll', 'staff:edit_notes',
    'settings:read', 'settings:edit', 'reports:view', 'reports:export', 'reports:schedule', 'analytics:view',
    'shifts:open', 'shifts:close', 'shifts:view_any', 'audit:view', 'audit:export',
    'payments:cash', 'payments:card', 'payments:refund', 'payments:settle',
    'customers:create', 'customers:view', 'customers:edit', 'customers:delete',
    'loyalty:view', 'loyalty:earn', 'loyalty:redeem', 'loyalty:manage',
    'tables:assign', 'tables:merge', 'tables:split', 'tables:close', 'tables:create', 'tables:edit', 'tables:delete',
    'discounts:apply', 'discounts:create', 'discounts:manage',
    'workspaces:switch', 'promotions:create', 'promotions:edit', 'promotions:delete', 'promotions:apply',
    'terminals:register', 'terminals:edit', 'terminals:delete', 'categories:manage', 'plugins:manage',
    'kds:view', 'kds:update',
  ],
  // Manager — products, inventory, sales, staff, and settings.
  'role-manager': [
    'sales:process', 'sales:void', 'sales:refund', 'sales:view', 'sales:discount', 'sales:split', 'sales:override_price',
    'products:create', 'products:read', 'products:update', 'products:delete', 'products:import', 'products:export', 'products:edit_cost',
    'inventory:view', 'inventory:adjust', 'inventory:transfer', 'inventory:count', 'inventory:locations_manage',
    'staff:read', 'staff:create', 'staff:update', 'staff:read_identity', 'staff:read_payroll', 'staff:edit_notes',
    'settings:read', 'settings:edit', 'reports:view', 'reports:export', 'reports:schedule', 'analytics:view',
    'shifts:open', 'shifts:close', 'shifts:view_any', 'audit:view', 'audit:export',
    'payments:cash', 'payments:card', 'payments:refund', 'payments:settle',
    'customers:create', 'customers:view', 'customers:edit', 'customers:delete',
    'loyalty:view', 'loyalty:earn', 'loyalty:redeem', 'loyalty:manage',
    'tables:assign', 'tables:merge', 'tables:split', 'tables:close', 'tables:create', 'tables:edit', 'tables:delete',
    'discounts:apply', 'discounts:create', 'discounts:manage',
    'workspaces:switch', 'promotions:create', 'promotions:edit', 'promotions:delete', 'promotions:apply',
    'terminals:register', 'terminals:edit', 'terminals:delete',
    'kds:view', 'kds:update',
  ],
  // Staff — checkout-operations only (the tightened preset): sales,
  // payments, in-cart discounts, customers/loyalty at the register,
  // shifts, table service, and KDS for assigned workspaces. No management.
  'role-staff': [
    'sales:process', 'sales:view', 'sales:discount', 'sales:split',
    'payments:cash', 'payments:card', 'payments:settle', 'discounts:apply',
    'customers:create', 'customers:view', 'loyalty:view', 'loyalty:earn', 'loyalty:redeem',
    'shifts:open', 'shifts:close',
    'tables:assign', 'tables:merge', 'tables:split', 'tables:close',
    'workspaces:switch', 'kds:view', 'kds:update',
  ],
  // Auditor — global read-only: view operational data and the audit log,
  // never manages and never sees sensitive profile fields.
  'role-auditor': [
    'sales:view', 'products:read', 'inventory:view', 'staff:read', 'settings:read',
    'reports:view', 'audit:view', 'shifts:view_any', 'customers:view', 'loyalty:view', 'kds:view',
  ],
};

/** The five preset roles, mirroring platform-core ROLE_PRESETS (0048 2c). */
const MOCK_ROLES = [
  { id: 'role-owner', name: 'Owner', description: 'Full access to all features and settings.', permissions: ['*'] },
  { id: 'role-admin', name: 'Admin', description: 'Global scope — everything except ownership transfer, billing, and irreversible org actions (staff deletion).', permissions: MOCK_ROLE_PERMISSIONS['role-admin'] ?? [] },
  { id: 'role-manager', name: 'Manager', description: 'Can manage products, inventory, sales, staff, and settings.', permissions: MOCK_ROLE_PERMISSIONS['role-manager'] ?? [] },
  { id: 'role-staff', name: 'Staff', description: 'Checkout-operations role — processes sales, payments, discounts, customers and loyalty at the register, opens and closes shifts, and operates assigned workspaces (including KDS). No management access.', permissions: MOCK_ROLE_PERMISSIONS['role-staff'] ?? [] },
  { id: 'role-auditor', name: 'Auditor', description: 'Global, read-only — views operational data and the audit log; never manages and never sees sensitive profile fields.', permissions: MOCK_ROLE_PERMISSIONS['role-auditor'] ?? [] },
] as const;

// Role authoring (ADR #47 ruling 4): mutable store for authored roles, plus
// the preset-id set the real backend refuses to author. seed_default_roles
// upserts preset ids and overwrites their grants, so the mock refuses edits
// to them too — a mock that accepted everything would let the dev screen be
// built against behaviour the backend does not have.
const MOCK_BUILTIN_ROLE_IDS = new Set<string>(MOCK_ROLES.map((r) => r.id));

interface MockAuthoredRole {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  is_builtin: boolean;
  reference_count: number;
}

const MOCK_AUTHORED_ROLES: MockAuthoredRole[] = [
  {
    id: 'role-night-manager',
    name: 'Night Manager',
    description: 'Overnight shift lead — register plus voids, no staff management.',
    permissions: ['sales:process', 'sales:void', 'reports:view'],
    is_builtin: false,
    reference_count: 0,
  },
];

const mockRoleList = () => [
  ...MOCK_ROLES.map((r) => ({
    ...r,
    is_builtin: true,
    reference_count: 1,
    ...mockRoleCounts(r.id),
  })),
  ...MOCK_AUTHORED_ROLES.map((r) => ({ ...r, ...mockRoleCounts(r.id) })),
];

/**
 * The two counts a role row must carry since RoleDto split them.
 *
 * holder_count is DERIVED from mockRoleHolders, so the number on a collapsed
 * row and the list it expands to are the same computation — the preview
 * cannot exhibit the disagreement the production surface was just fixed for.
 *
 * grant_count is a flat 0 because the mock has no workspace-grant fixtures at
 * all: the "and N workspace grants" branch, and a grants-only role (blocked
 * from deletion by configuration rather than by people), are therefore NOT
 * exercisable in browser preview. Recorded rather than glossed — a mock that
 * quietly returned 1 here would be inventing rows no other mock command
 * serves, which is worse than the gap.
 */
function mockRoleCounts(roleId: string): { holder_count: number; grant_count: number } {
  return { holder_count: mockRoleHolders(roleId).total, grant_count: 0 };
}

/**
 * The page size the real backend clamps to (`ROLE_HOLDERS_MAX`). Named here
 * rather than inlined so the reported `cap` and the slice cannot drift apart.
 */
const MOCK_ROLE_HOLDERS_CAP = 50;

/**
 * One role's holders, in exactly the `RoleHoldersDto` wire shape.
 *
 * Mirrors the real command on the three points a preview most easily gets
 * wrong:
 *
 * - An unknown role is a REFUSAL, not an empty list. The backend answers
 *   NotFound, because "nobody holds this" and "there is no such role" are
 *   different facts and only the first licenses a delete. A mock that
 *   returned [] would let a screen be built against a typo-tolerant backend.
 * - The page is capped and the ceiling is reported, so the surface learns to
 *   read `total` for "and N more" instead of `holders.length`.
 * - Every row carries `branch_scope` / `workspace_scope` NEXT TO the counts.
 *   `all` with a count of 0 means UNRESTRICTED, not "no branches"; the
 *   fixtures all use the global/organization shape `mockStaffMember` already
 *   carries, so this and `list_staff_scoped` describe the same people.
 *
 * Holders are DERIVED from mockStaffFixtures rather than restated, which is
 * the whole reason that list was extracted.
 */
function mockRoleHolders(roleId: string | undefined): {
  holders: Array<Record<string, unknown>>;
  total: number;
  cap: number;
} {
  const wanted = roleId ?? '';
  // Checked against the two role stores directly rather than against
  // mockRoleList(), which now calls back through mockRoleCounts ->
  // mockRoleHolders. Going through the list would recurse forever.
  const known = [...MOCK_ROLES.map((r) => r.id), ...MOCK_AUTHORED_ROLES.map((r) => r.id)];
  if (!known.includes(wanted)) {
    throw new Error(`role ${wanted || '(no id given)'} does not exist`);
  }
  // Bracket access throughout: mockStaffMember hands back a
  // Record<string, unknown>, and the repo's tsconfig forbids dot access on
  // index signatures (noPropertyAccessFromIndexSignature).
  const holders = mockStaffFixtures()
    .filter((member) => String(member['role_id'] ?? '') === wanted)
    .map((member) => {
      const asg = (member['assignment'] ?? {}) as {
        scope_mode?: string;
        scope_type?: string;
        scope_id?: string | null;
        branches_all?: boolean;
        branch_ids?: string[];
        workspaces_all?: boolean;
        workspace_keys?: string[];
      };
      return {
        user_id: member['id'],
        username: member['username'],
        display_name: member['display_name'],
        is_active: member['is_active'] !== false,
        has_assignment: member['assignment'] != null,
        scope_mode: asg.scope_mode ?? null,
        scope_type: asg.scope_type ?? null,
        scope_id: asg.scope_id ?? null,
        branch_scope: asg.branches_all === false ? 'list' : 'all',
        workspace_scope: asg.workspaces_all === false ? 'list' : 'all',
        branch_count: asg.branch_ids?.length ?? 0,
        workspace_count: asg.workspace_keys?.length ?? 0,
      };
    });
  return {
    holders: holders.slice(0, MOCK_ROLE_HOLDERS_CAP),
    total: holders.length,
    cap: MOCK_ROLE_HOLDERS_CAP,
  };
}

/**
 * A representative subset of the permission registry for the role editor.
 * The real command returns every registered key; this list is deliberately
 * short, so dev-mode authoring exercises the picker shape without implying
 * these are the only keys that exist.
 */
const MOCK_PERMISSION_KEYS = [
  { key: 'sales:process', family: 'sales', sensitive: false, description: 'Ring up a sale at the register.' },
  { key: 'sales:view', family: 'sales', sensitive: false, description: 'View sales records.' },
  { key: 'sales:void', family: 'sales', sensitive: true, description: 'Void a completed sale.' },
  { key: 'sales:refund', family: 'sales', sensitive: true, description: 'Refund a completed sale.' },
  { key: 'products:read', family: 'products', sensitive: false, description: 'View the product catalog.' },
  { key: 'products:create', family: 'products', sensitive: false, description: 'Add a product.' },
  { key: 'reports:view', family: 'reports', sensitive: false, description: 'View sales reports.' },
  { key: 'analytics:view', family: 'analytics', sensitive: false, description: 'View the analytics screen.' },
  { key: 'staff:read', family: 'staff', sensitive: false, description: 'View staff members.' },
  { key: 'staff:create', family: 'staff', sensitive: false, description: 'Add a staff member.' },
  { key: 'staff:manage_roles', family: 'staff', sensitive: true, description: 'Create, edit, or delete roles and their permission sets.' },
  { key: 'settings:read', family: 'settings', sensitive: false, description: 'View store and system settings.' },
  { key: 'settings:edit', family: 'settings', sensitive: true, description: 'Modify store settings.' },
];

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

const MOCK_CATEGORIES = [
  { id: 'cat-cpu', name: 'Processors (CPU)', colour: '#e74c3c', icon: 'cpu-1' },
  { id: 'cat-gpu', name: 'Graphics Cards (GPU)', colour: '#2ecc71', icon: 'gpu-1' },
  { id: 'cat-ram', name: 'Memory (RAM)', colour: '#9b59b6', icon: 'ram-1' },
  { id: 'cat-storage', name: 'Storage (SSD/HDD)', colour: '#3498db', icon: 'hdd-1' },
  { id: 'cat-mb', name: 'Motherboards', colour: '#f39c12', icon: 'mb-1' },
  { id: 'cat-psu', name: 'Power Supply', colour: '#1abc9c', icon: 'psu-1' },
  { id: 'cat-cooling', name: 'Cooling & Cases', colour: '#34495e', icon: 'cool-1' },
];

const MOCK_STORE = {
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

/** Mutable store-profile list backing the mock — renames/creates persist
 *  for the session exactly like the real DB (dev preview parity). */
let mockStores: Array<typeof MOCK_STORE> = [{ ...MOCK_STORE }];

/** Unwrap the `{ args }` envelope the API wrappers send, tolerating a
 *  bare payload for direct calls. The real commands take a named `args`
 *  argument, so the envelope is the wire shape. */
function unwrapArgs<T extends Record<string, unknown> = Record<string, unknown>>(args: unknown): T {
  const boxed = (args ?? {}) as { args?: T };
  return boxed.args ?? ((args as T | undefined) ?? ({} as T));
}

/** List the mutable location-profile rows served by the dev mock. */
function listMockLocations(): Array<typeof MOCK_STORE> {
  return mockStores.map((location) => ({ ...location }));
}

/** Resolve one location profile using the mock's historical fallback behavior. */
function getMockLocation(args: unknown): typeof MOCK_STORE {
  const { id } = unwrapArgs<{ id?: string }>(args);
  return mockStores.find((location) => location.id === id) ?? MOCK_STORE;
}

/** Resolve the primary location profile from the mutable mock list. */
function getMockPrimaryLocation(): typeof MOCK_STORE {
  return mockStores.find((location) => location.is_primary) ?? mockStores[0] ?? MOCK_STORE;
}

/** Create a location profile and persist it in the session-local mock list. */
function createMockLocation(args: unknown): typeof MOCK_STORE {
  const payload = unwrapArgs<Partial<typeof MOCK_STORE>>(args);
  const created = {
    ...MOCK_STORE,
    ...payload,
    id: (payload.id as string | undefined) ?? `store-${Date.now()}`,
    is_primary: mockStores.length === 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  mockStores.push(created);
  return { ...created };
}

/** Update a location profile and persist it in the session-local mock list. */
function updateMockLocation(args: unknown): typeof MOCK_STORE {
  const { id, ...rest } = unwrapArgs<Partial<typeof MOCK_STORE> & { id?: string }>(args);
  // id-mismatch falls back to the first profile (mock laxness — the real
  // backend returns an error for unknown ids).
  const existing = mockStores.find((location) => location.id === id) ?? mockStores[0] ?? MOCK_STORE;
  const updated = { ...existing, ...rest, id: existing.id, updated_at: new Date().toISOString() };
  mockStores = mockStores.map((location) => (location.id === updated.id ? updated : location));
  if (!mockStores.some((location) => location.id === updated.id)) mockStores.push(updated);
  return { ...updated };
}

/** Make a location primary and persist the choice in the mock list. */
function setMockPrimaryLocation(args: unknown): typeof MOCK_STORE {
  const { id } = unwrapArgs<{ id?: string }>(args);
  mockStores = mockStores.map((location) => ({ ...location, is_primary: location.id === id }));
  return { ...getMockLocation({ id }) };
}

/** Delete a location profile from the session-local mock list. */
function deleteMockLocation(args: unknown): null {
  const { id } = unwrapArgs<{ id?: string }>(args);
  mockStores = mockStores.filter((location) => location.id !== id);
  return null;
}

/** Seed Legal Entity mirroring migration `20260908_legal_entities.sql`, which
 *  auto-creates one deterministic "Default Legal Entity" per existing tenant.
 *  `tenantId: 'default'` matches DEFAULT_TENANT_ID in
 *  apps/desktop-client/src/commands/legal_entities.rs, and the field names are
 *  camelCase because the Rust DTO uses `#[serde(rename_all = "camelCase")]`. */
const MOCK_LEGAL_ENTITY = {
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

/** Mutable Legal Entity list backing the dev mock — creates and updates
 *  persist for the session exactly like the real DB (dev preview parity). */
let mockLegalEntities: Array<typeof MOCK_LEGAL_ENTITY> = [{ ...MOCK_LEGAL_ENTITY }];

/** List the Legal Entity rows served by the dev mock. */
function listMockLegalEntities(): Array<typeof MOCK_LEGAL_ENTITY> {
  return mockLegalEntities.map((entity) => ({ ...entity }));
}

/** Resolve one Legal Entity by id.
 *  Unlike `getMockLocation`, an unknown id returns `null` rather than falling
 *  back to the first row: the real command returns `Option<LegalEntityDto>`
 *  and `ui/src/api/legalEntities.ts` declares `LegalEntity | null`, so callers
 *  branch on the empty case and the mock must be able to express it. */
function getMockLegalEntity(args: unknown): typeof MOCK_LEGAL_ENTITY | null {
  const { id } = unwrapArgs<{ id?: string }>(args);
  return mockLegalEntities.find((entity) => entity.id === id) ?? null;
}

/** Create a Legal Entity and persist it in the session-local mock list. */
function createMockLegalEntity(args: unknown): typeof MOCK_LEGAL_ENTITY {
  const payload = unwrapArgs<Partial<typeof MOCK_LEGAL_ENTITY>>(args);
  const now = new Date().toISOString();
  const created = {
    ...MOCK_LEGAL_ENTITY,
    ...payload,
    id: payload.id ?? `le-${Date.now()}`,
    // Organization-level resource: the staged tenant sentinel is fixed, so a
    // client-supplied tenantId is ignored exactly as the real command ignores it.
    tenantId: MOCK_LEGAL_ENTITY.tenantId,
    createdAt: now,
    updatedAt: now,
  };
  mockLegalEntities.push(created);
  return { ...created };
}

/** Update a Legal Entity and persist it in the session-local mock list.
 *  An unknown id returns `null`; the real command surfaces an error there, so
 *  this stays closer to the backend than the location mock's first-row
 *  fallback. `id` and `tenantId` are never taken from the payload. */
function updateMockLegalEntity(args: unknown): typeof MOCK_LEGAL_ENTITY | null {
  const { id, ...rest } = unwrapArgs<Partial<typeof MOCK_LEGAL_ENTITY> & { id?: string }>(args);
  const existing = mockLegalEntities.find((entity) => entity.id === id);
  if (!existing) return null;
  const updated = {
    ...existing,
    ...rest,
    id: existing.id,
    tenantId: existing.tenantId,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  mockLegalEntities = mockLegalEntities.map((entity) =>
    entity.id === updated.id ? updated : entity,
  );
  return { ...updated };
}

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
  const location = mockStores.find((loc) => loc.id === locationId) ?? mockStores[0] ?? MOCK_STORE;
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
  const location = mockStores.find((loc) => loc.id === locationId) ?? mockStores[0] ?? MOCK_STORE;
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

/** A memo as the dev mock serves it. Mirrors `ui/src/api/memos.ts` `Memo`
 *  (camelCase wire shape). */
interface MockMemo {
  id: string;
  tenantId: string;
  /** Locations the memo targets; empty ⇒ Organization Memo (all locations). */
  locationIds: string[];
  authorUserId: string;
  authorRole: string;
  title: string;
  body: string;
  status: string;
  duration: string;
  revision: number;
  publishedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

/** A memo plus this terminal's delivery state, as the dev mock serves it.
 *  Mirrors `ui/src/api/memos.ts` `ActiveMemo`. */
interface MockActiveMemo {
  memo: MockMemo;
  deliveryStatus: string;
}

/** Mutable memo list backing the dev mock — acknowledgements persist for the
 *  session exactly like the real recipient row (dev preview parity). Seeded
 *  with one Organization and one Location memo so the tier-stacking display
 *  has something to order. */
let mockMemos: MockActiveMemo[] = [
  {
    memo: {
      id: 'memo-org-1',
      tenantId: 'default',
      locationIds: [],
      authorUserId: 'user-owner',
      authorRole: 'role-owner',
      title: 'End-of-day checklist',
      body: 'Close the drawer, count the float, and log the safe before you leave.',
      status: 'published',
      duration: '24h',
      revision: 1,
      publishedAt: '2026-09-08T09:00:00.000Z',
      expiresAt: '2026-09-09T09:00:00.000Z',
      createdAt: '2026-09-08T09:00:00.000Z',
    },
    deliveryStatus: 'pending',
  },
  {
    memo: {
      id: 'memo-loc-1',
      tenantId: 'default',
      locationIds: ['loc-default'],
      authorUserId: 'user-manager',
      authorRole: 'role-manager',
      title: 'Restock aisle 3',
      body: 'Refill the front shelf before doors open.',
      status: 'published',
      duration: '12h',
      revision: 1,
      publishedAt: '2026-09-08T10:00:00.000Z',
      expiresAt: '2026-09-08T22:00:00.000Z',
      createdAt: '2026-09-08T10:00:00.000Z',
    },
    deliveryStatus: 'pending',
  },
];

/** Cadence served with the memo list — mirrors `oz_core::memo`:
 *  `NOTIFICATION_BASE_INTERVAL_SECS` (900s) and the derived
 *  `kds_notification_interval_secs()` (2 × base). Expressed as base × 2 so
 *  the multiplier intent survives a base change, exactly like the backend. */
const MEMO_CADENCE = { baseIntervalSecs: 900, kdsIntervalSecs: 2 * 900 };

/** List the active memos served by the dev mock (Location stacked above
 *  Organization, matching the real read path's ordering) plus the display
 *  cadence, matching the real command's `MemoDisplayDto` envelope. Only
 *  published memos reach terminals — drafts stay on the authoring side. */
function listMockActiveMemos(): {
  memos: MockActiveMemo[];
  cadence: { baseIntervalSecs: number; kdsIntervalSecs: number };
} {
  return {
    memos: mockMemos
      .filter((m) => m.memo.status === 'published')
      .sort((a, b) => Number(a.memo.locationIds.length === 0) - Number(b.memo.locationIds.length === 0))
      .map((m) => ({ ...m, memo: { ...m.memo } })),
    cadence: { ...MEMO_CADENCE },
  };
}

/** Acknowledge a memo on the caller's terminal in the session-local mock.
 *  Returns `null` to match the real command's `Result<(), AppError>` (void). */
function acknowledgeMockMemo(args: unknown): null {
  const { memoId } = unwrapArgs<{ memoId?: string }>(args);
  if (memoId) {
    mockMemos = mockMemos.map((m) =>
      m.memo.id === memoId ? { ...m, deliveryStatus: 'acknowledged' } : m,
    );
  }
  return null;
}

/** Display-duration to wall-clock offset, mirroring `MemoDuration`. */
const MEMO_DURATION_MS: Record<string, number> = {
  '12h': 12 * 3_600_000,
  '24h': 24 * 3_600_000,
  '3d': 72 * 3_600_000,
  '7d': 168 * 3_600_000,
  '30d': 720 * 3_600_000,
};

/** Create a memo draft in the session-local mock (dev preview parity with
 *  the real `create_memo_scoped` command). The draft is invisible to
 *  terminals until published. */
function createMockMemo(args: unknown): MockMemo {
  const payload = unwrapArgs<{
    locationIds?: string[];
    title?: string;
    body?: string;
    duration?: string;
  }>(args);
  const memo: MockMemo = {
    id: `memo-${Date.now()}`,
    tenantId: 'default',
    locationIds: payload.locationIds ?? [],
    authorUserId: 'user-1',
    authorRole: 'role-manager',
    title: payload.title ?? '(untitled)',
    body: payload.body ?? '',
    status: 'draft',
    duration: payload.duration ?? '24h',
    revision: 0,
    publishedAt: null,
    expiresAt: null,
    createdAt: new Date().toISOString(),
  };
  mockMemos.push({ memo, deliveryStatus: 'pending' });
  return { ...memo };
}

/** Publish a draft in the session-local mock: stamps publication/expiry and
 *  revision 1, matching the real `publish_memo_scoped` command. Unknown ids
 *  reject (the real command errors). */
function publishMockMemo(args: unknown): MockMemo {
  const { memoId } = unwrapArgs<{ memoId?: string }>(args);
  const found = mockMemos.find((m) => m.memo.id === memoId);
  if (!found) {
    throw new Error(`memo not found: ${memoId}`);
  }
  if (found.memo.status !== 'draft') {
    throw new Error(`memo ${memoId} is not a draft`);
  }
  const now = Date.now();
  const expiresMs = MEMO_DURATION_MS[found.memo.duration] ?? 24 * 3_600_000;
  found.memo = {
    ...found.memo,
    status: 'published',
    revision: 1,
    publishedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + expiresMs).toISOString(),
  };
  return { ...found.memo };
}

/** List every memo the session user authored, newest first — the read behind
 *  the authoring screen (matches `list_authored_memos_scoped`). The mock
 *  serves the whole list; single-user previews cannot exercise per-author
 *  filtering. */
function listMockAuthoredMemos(): MockMemo[] {
  return mockMemos
    .map((m) => ({ ...m.memo }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Early-stop a published memo in the session-local mock (dev preview parity
 *  with the real `stop_memo_scoped` command, A2 ruling: author or
 *  `memo:stop`). Unknown ids and non-published memos reject, matching the
 *  real command's state guard. */
function stopMockMemo(args: unknown): MockMemo {
  const { memoId } = unwrapArgs<{ memoId?: string }>(args);
  const found = mockMemos.find((m) => m.memo.id === memoId);
  if (!found) {
    throw new Error(`memo not found: ${memoId}`);
  }
  if (found.memo.status !== 'published') {
    throw new Error(`memo ${memoId} is not published`);
  }
  found.memo = {
    ...found.memo,
    status: 'stopped',
  };
  return { ...found.memo };
}

/** Revise a published memo in the session-local mock: bumps the revision
 *  with the corrected content (dev preview parity with the real
 *  `revise_memo_scoped`). Published-only, like the real command. */
function reviseMockMemo(args: unknown): MockMemo {
  const payload = unwrapArgs<{ memoId?: string; args?: { title?: string; body?: string } }>(args);
  const found = mockMemos.find((m) => m.memo.id === payload.memoId);
  if (!found) {
    throw new Error(`memo not found: ${payload.memoId}`);
  }
  if (found.memo.status !== 'published') {
    throw new Error(`memo ${payload.memoId} is not published`);
  }
  found.memo = {
    ...found.memo,
    title: payload.args?.title ?? found.memo.title,
    body: payload.args?.body ?? found.memo.body,
    revision: found.memo.revision + 1,
  };
  return { ...found.memo };
}

/** Live floor-plan snapshot for the analytics occupancy card: 5 of 12
 *  active tables occupied (2 seated, 1 reserved, 4 free, 1 cleaning). */
function tablesSnapshot(): Array<{
  id: string; name: string; capacity: number; pos_x: number; pos_y: number;
  shape: string; width: number; height: number; status: string;
  active_sale_id: string | null; section: string; active: boolean;
  sort_order: number;
}> {
  const statuses = [
    'occupied', 'occupied', 'occupied', 'occupied', 'occupied',
    'available', 'available', 'available', 'available',
    'reserved', 'cleaning', 'available',
  ];
  return statuses.map((status, i) => ({
    id: `table-${String(i + 1).padStart(2, '0')}`,
    name: `Table ${i + 1}`,
    capacity: i % 3 === 0 ? 6 : 4,
    pos_x: 10 + (i % 4) * 22,
    pos_y: 15 + Math.floor(i / 4) * 30,
    shape: 'circle',
    width: 8,
    height: 8,
    status,
    active_sale_id: status === 'occupied' ? `sale-table-${i + 1}` : null,
    section: i < 6 ? 'Indoor' : 'Patio',
    active: true,
    sort_order: i + 1,
  }));
}

const MOCK_CURRENCIES = [
  { code: 'IDR', name: 'Indonesian Rupiah', minor_exponent: 0, symbol: 'Rp' },
  { code: 'USD', name: 'US Dollar', minor_exponent: 2, symbol: '$' },
  { code: 'JPY', name: 'Japanese Yen', minor_exponent: 0, symbol: '¥' },
];

const MOCK_TERMINAL = {
  id: 'term-1',
  name: 'Terminal 1',
  deviceId: 'device-001',
  isActive: true,
  lastSeenAt: new Date().toISOString(),
  metadata: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const MOCK_CUSTOMERS = [
  { id: 'cust-1', name: 'John Doe', email: 'john@example.com', phone: '08123456789', notes: 'Regular customer', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: 'cust-2', name: 'Jane Smith', email: 'jane@example.com', phone: '08987654321', notes: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
];

const MOCK_INVENTORY_LOCATIONS = [
  { id: 'loc-1', name: 'Main Store', type: 'store' as const, description: 'Main retail location', is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: 'loc-2', name: 'Warehouse', type: 'warehouse' as const, description: 'Central warehouse', is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
];

// Stateful workspace instances — the real backend persists
// workspace_instances rows, and apply_topology_diff mutates them. Seed
// from localStorage so previews round-trip instance creates/archives the
// same way the real store DB does.
const MOCK_WORKSPACES_SEED = [
  { instance_id: 'ws-1', type_key: 'store-pos', store_id: 'store-1', store_name: 'TOKO TEST', name: 'Store POS', description: 'Point of Sale', icon: 'shopping-cart', layout_mode: 'default', colour: '#10b981', is_default: true },
  { instance_id: 'ws-2', type_key: 'restaurant-pos', store_id: 'store-1', store_name: 'TOKO TEST', name: 'Restaurant POS', description: 'Table service', icon: 'restaurant', layout_mode: 'fullscreen', colour: '#ef4444', is_default: false },
  { instance_id: 'ws-3', type_key: 'kds', store_id: 'store-1', store_name: 'TOKO TEST', name: 'Kitchen Display', description: 'Order display', icon: 'utensils', layout_mode: 'kds', colour: '#f59e0b', is_default: false },
  { instance_id: 'ws-4', type_key: 'warehouse', store_id: 'store-1', store_name: 'TOKO TEST', name: 'Warehouse', description: 'Product and stock management', icon: 'package', layout_mode: 'default', colour: '#3b82f6', is_default: false },
  { instance_id: 'ws-5', type_key: 'admin', store_id: 'store-1', store_name: 'TOKO TEST', name: 'Admin', description: 'Settings & management', icon: 'settings', layout_mode: 'default', colour: '#8b5cf6', is_default: false },
];
const MOCK_WORKSPACES_KEY = 'oz-dev-mock:workspaces';
function loadMockWorkspaces(): typeof MOCK_WORKSPACES_SEED {
  try {
    const raw = localStorage.getItem(MOCK_WORKSPACES_KEY);
    if (raw) return JSON.parse(raw) as typeof MOCK_WORKSPACES_SEED;
  } catch {
    // storage unavailable — start from seed
  }
  return MOCK_WORKSPACES_SEED;
}
function saveMockWorkspaces(): void {
  try {
    localStorage.setItem(MOCK_WORKSPACES_KEY, JSON.stringify(mockWorkspaces));
  } catch {
    // storage unavailable — keep in-memory copy for this session
  }
}
const mockWorkspaces: typeof MOCK_WORKSPACES_SEED = loadMockWorkspaces();

// ── Mock KDS orders ──────────────────────────────────────────────
// Use let + mutable array so complete_sale can push new orders for E2E tests.
// 10 initial orders with realistic Indonesian food items, spread across
// statuses and timestamps for a live kitchen feel.
const _initialKdsOrders = [
  {
    id: 'kds-order-1',
    display_number: 101,
    status: 'pending',
    received_at: new Date(Date.now() - 30000).toISOString(),
    items_summary: '2x Nasi Goreng Spesial, 1x Es Teh Manis',
    item_count: 3,
    order_type: 'dine_in',
    table_number: 'T3',
    notes: 'Pedas level 2',
    priority: false,
    store_id: 'store-1',
  },
  {
    id: 'kds-order-2',
    display_number: 102,
    status: 'pending',
    received_at: new Date(Date.now() - 90000).toISOString(),
    items_summary: '1x Ayam Bakar Madu, 1x Soto Ayam',
    item_count: 2,
    order_type: 'dine_in',
    table_number: 'T5',
    notes: null,
    priority: false,
    store_id: 'store-1',
  },
  {
    id: 'kds-order-3',
    display_number: 103,
    status: 'preparing',
    received_at: new Date(Date.now() - 240000).toISOString(),
    items_summary: '1x Sate Ayam 10 Tusuk, 2x Es Teh Manis',
    item_count: 3,
    order_type: 'dine_in',
    table_number: 'T7',
    notes: 'Sate tanpa kacang',
    priority: false,
    store_id: 'store-1',
  },
  {
    id: 'kds-order-4',
    display_number: 104,
    status: 'preparing',
    received_at: new Date(Date.now() - 360000).toISOString(),
    items_summary: '1x Rawon Daging, 1x Gado-Gado',
    item_count: 2,
    order_type: 'dine_in',
    table_number: 'T2',
    notes: null,
    priority: false,
    store_id: 'store-1',
  },
  {
    id: 'kds-order-5',
    display_number: 105,
    status: 'preparing',
    received_at: new Date(Date.now() - 480000).toISOString(),
    items_summary: '3x Mie Goreng Jawa, 2x Kopi Tubruk',
    item_count: 5,
    order_type: 'dine_in',
    table_number: 'T10',
    notes: 'Mie goreng setengah matang',
    priority: true,
    store_id: 'store-1',
  },
  {
    id: 'kds-order-6',
    display_number: 106,
    status: 'ready',
    received_at: new Date(Date.now() - 600000).toISOString(),
    items_summary: '2x Caffè Latte, 1x Cappuccino',
    item_count: 3,
    order_type: 'dine_in',
    table_number: 'T1',
    notes: null,
    priority: true,
    store_id: 'store-1',
  },
  {
    id: 'kds-order-7',
    display_number: 107,
    status: 'ready',
    received_at: new Date(Date.now() - 720000).toISOString(),
    items_summary: '1x Nasi Goreng Spesial, 1x Es Jeruk Peras',
    item_count: 2,
    order_type: 'takeaway',
    table_number: null,
    notes: 'Extra sambal',
    priority: true,
    store_id: 'store-1',
  },
  {
    id: 'kds-order-8',
    display_number: 108,
    status: 'pending',
    received_at: new Date(Date.now() - 15000).toISOString(),
    items_summary: '1x Pisang Goreng, 2x Teh Tarik',
    item_count: 3,
    order_type: 'dine_in',
    table_number: 'T4',
    notes: null,
    priority: false,
    store_id: 'store-1',
  },
  {
    id: 'kds-order-9',
    display_number: 109,
    status: 'pending',
    received_at: new Date(Date.now() - 120000).toISOString(),
    items_summary: '1x Ayam Bakar Madu, 1x Tahu Goreng, 1x Tempe Goreng',
    item_count: 3,
    order_type: 'dine_in',
    table_number: 'T8',
    notes: 'Ayam bakar tanpa kulit',
    priority: false,
    store_id: 'store-1',
  },
  {
    id: 'kds-order-10',
    display_number: 110,
    status: 'ready',
    received_at: new Date(Date.now() - 840000).toISOString(),
    items_summary: '1x Es Campur, 1x Klepon',
    item_count: 2,
    order_type: 'dine_in',
    table_number: 'T6',
    notes: null,
    priority: true,
    store_id: 'store-1',
  },
];
// ── Mock KDS line items (course-grouped for per-item advance) ──
const _initialKdsLineItems: Record<string, Array<Record<string, unknown>>> = {
  'kds-order-1': [
    { id: 'kds-line-1-1', kds_order_id: 'kds-order-1', sku: 'NASI-GORENG', display_name: 'Nasi Goreng Spesial', qty: 2, course: 'main', modifiers: [{ name: 'Level', choice: 'Pedas 2', price_minor: 0 }], line_position: 1, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
    { id: 'kds-line-1-2', kds_order_id: 'kds-order-1', sku: 'ES-TEH', display_name: 'Es Teh Manis', qty: 1, course: 'beverage', modifiers: [], line_position: 2, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
  ],
  'kds-order-2': [
    { id: 'kds-line-2-1', kds_order_id: 'kds-order-2', sku: 'AYAM-BAKAR', display_name: 'Ayam Bakar Madu', qty: 1, course: 'main', modifiers: [], line_position: 1, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
    { id: 'kds-line-2-2', kds_order_id: 'kds-order-2', sku: 'SOTO-AYAM', display_name: 'Soto Ayam', qty: 1, course: 'main', modifiers: [], line_position: 2, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
  ],
  'kds-order-3': [
    { id: 'kds-line-3-1', kds_order_id: 'kds-order-3', sku: 'SATE-AYAM', display_name: 'Sate Ayam 10 Tusuk', qty: 1, course: 'main', modifiers: [{ name: 'Sambal', choice: 'Tanpa Kacang', price_minor: 0 }], line_position: 1, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
    { id: 'kds-line-3-2', kds_order_id: 'kds-order-3', sku: 'ES-TEH', display_name: 'Es Teh Manis', qty: 2, course: 'beverage', modifiers: [], line_position: 2, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
  ],
  'kds-order-4': [
    { id: 'kds-line-4-1', kds_order_id: 'kds-order-4', sku: 'RAWON', display_name: 'Rawon Daging', qty: 1, course: 'main', modifiers: [], line_position: 1, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
    { id: 'kds-line-4-2', kds_order_id: 'kds-order-4', sku: 'GADO-GADO', display_name: 'Gado-Gado', qty: 1, course: 'main', modifiers: [], line_position: 2, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
  ],
  'kds-order-5': [
    { id: 'kds-line-5-1', kds_order_id: 'kds-order-5', sku: 'MIE-GORENG', display_name: 'Mie Goreng Jawa', qty: 3, course: 'main', modifiers: [{ name: 'Matang', choice: 'Setengah Matang', price_minor: 0 }], line_position: 1, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
    { id: 'kds-line-5-2', kds_order_id: 'kds-order-5', sku: 'KOPI-T', display_name: 'Kopi Tubruk', qty: 2, course: 'beverage', modifiers: [], line_position: 2, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
  ],
  'kds-order-6': [
    { id: 'kds-line-6-1', kds_order_id: 'kds-order-6', sku: 'LATTE', display_name: 'Caffè Latte', qty: 2, course: 'beverage', modifiers: [], line_position: 1, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
    { id: 'kds-line-6-2', kds_order_id: 'kds-order-6', sku: 'CAPPU', display_name: 'Cappuccino', qty: 1, course: 'beverage', modifiers: [], line_position: 2, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
  ],
  'kds-order-7': [
    { id: 'kds-line-7-1', kds_order_id: 'kds-order-7', sku: 'NASI-GORENG', display_name: 'Nasi Goreng Spesial', qty: 1, course: 'main', modifiers: [{ name: 'Sambal', choice: 'Extra Sambal', price_minor: 0 }], line_position: 1, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
    { id: 'kds-line-7-2', kds_order_id: 'kds-order-7', sku: 'ES-JERUK', display_name: 'Es Jeruk Peras', qty: 1, course: 'beverage', modifiers: [], line_position: 2, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
  ],
  'kds-order-8': [
    { id: 'kds-line-8-1', kds_order_id: 'kds-order-8', sku: 'PISANG-GORENG', display_name: 'Pisang Goreng', qty: 1, course: 'dessert', modifiers: [], line_position: 1, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
    { id: 'kds-line-8-2', kds_order_id: 'kds-order-8', sku: 'TEH-T', display_name: 'Teh Tarik', qty: 2, course: 'beverage', modifiers: [], line_position: 2, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
  ],
  'kds-order-9': [
    { id: 'kds-line-9-1', kds_order_id: 'kds-order-9', sku: 'AYAM-BAKAR', display_name: 'Ayam Bakar Madu', qty: 1, course: 'main', modifiers: [{ name: 'Kulit', choice: 'Tanpa Kulit', price_minor: 0 }], line_position: 1, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
    { id: 'kds-line-9-2', kds_order_id: 'kds-order-9', sku: 'TAHU-GORENG', display_name: 'Tahu Goreng', qty: 1, course: 'side', modifiers: [], line_position: 2, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
    { id: 'kds-line-9-3', kds_order_id: 'kds-order-9', sku: 'TEMPE-GORENG', display_name: 'Tempe Goreng', qty: 1, course: 'side', modifiers: [], line_position: 3, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
  ],
  'kds-order-10': [
    { id: 'kds-line-10-1', kds_order_id: 'kds-order-10', sku: 'ES-CAMPUR', display_name: 'Es Campur', qty: 1, course: 'dessert', modifiers: [], line_position: 1, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
    { id: 'kds-line-10-2', kds_order_id: 'kds-order-10', sku: 'KLEPON', display_name: 'Klepon', qty: 1, course: 'dessert', modifiers: [], line_position: 2, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
  ],
};

// The real backend persists the kitchen queue (kds_orders 032), per-item
// line statuses (kds_line_items 105), and a daily display counter
// (kds_daily_counters 032), so a restart resumes exactly where the kitchen
// left off. Persist the whole KDS state under one key (same stateful pattern
// as the cart / sales / active-shift mocks above) so previews mirror the DB
// across reloads — previously a reload wiped the queue, reverted every
// status, and restarted ticket numbering at 104.
const MOCK_KDS_KEY = 'oz-dev-mock:kds';
function loadMockKdsState(): {
  orders: Record<string, unknown>[];
  lineItems: Record<string, Array<Record<string, unknown>>>;
} {
  try {
    const raw = localStorage.getItem(MOCK_KDS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as {
        orders: Record<string, unknown>[];
        lineItems: Record<string, Array<Record<string, unknown>>>;
      };
      if (Array.isArray(parsed.orders) && parsed.lineItems && typeof parsed.lineItems === 'object') {
        return parsed;
      }
    }
  } catch {
    // storage unavailable or corrupt — fall through to the seed
  }
  // First load: seed the queue (and its line items) so the KDS preview
  // renders without a completed sale. Shallow-clone each line so mutations
  // never bleed into the seed literal.
  return {
    orders: [..._initialKdsOrders],
    lineItems: Object.fromEntries(
      Object.entries(_initialKdsLineItems).map(([orderId, lines]) => [
        orderId,
        lines.map((l) => ({ ...l })),
      ]),
    ),
  };
}
function saveMockKdsState(): void {
  try {
    localStorage.setItem(
      MOCK_KDS_KEY,
      JSON.stringify({ orders: mockKdsOrders, lineItems: mockKdsLineItems }),
    );
  } catch {
    // storage unavailable — keep the in-memory copies for this session
  }
}
const mockKdsState = loadMockKdsState();
const mockKdsOrders: Record<string, unknown>[] = mockKdsState.orders;
const mockKdsLineItems: Record<string, Array<Record<string, unknown>>> = mockKdsState.lineItems;
// Next ticket number = one past the highest persisted display_number (the
// backend's per-day counter), never below the seed baseline of 110.
const maxDisplay = mockKdsOrders.reduce((max, o) => {
  const n = Number(o['display_number']);
  return Number.isFinite(n) ? Math.max(max, n) : max;
}, 110);
let kdsDisplayCounter = maxDisplay + 1;

// ── Auto-generation: 1 new order per minute, max 20 active orders ──
// Provides a steady stream of kitchen orders in dev mode so the KDS
// screen looks alive. Removes served/cancelled orders to cap at 20.
const KDS_MAX_ACTIVE_ORDERS = 20;
const KDS_ORDER_INTERVAL_MS = 60_000; // 1 minute

/** Indonesian restaurant menu items for auto-generated orders. */
const KDS_MOCK_MENU: Array<{ sku: string; name: string; course: string; price: number }> = [
  // Hot Drinks
  { sku: 'LATTE', name: 'Caffè Latte', course: 'beverage', price: 45000 },
  { sku: 'CAPPU', name: 'Cappuccino', course: 'beverage', price: 42000 },
  { sku: 'ESPR', name: 'Espresso Shot', course: 'beverage', price: 28000 },
  { sku: 'KOPI-T', name: 'Kopi Tubruk', course: 'beverage', price: 15000 },
  { sku: 'TEH-T', name: 'Teh Tarik', course: 'beverage', price: 18000 },
  // Cold Drinks
  { sku: 'ICED', name: 'Iced Coffee', course: 'beverage', price: 32000 },
  { sku: 'MATCHA', name: 'Matcha Latte', course: 'beverage', price: 38000 },
  { sku: 'ES-TEH', name: 'Es Teh Manis', course: 'beverage', price: 8000 },
  { sku: 'ES-JERUK', name: 'Es Jeruk Peras', course: 'beverage', price: 12000 },
  { sku: 'JUS-ALPUKAT', name: 'Jus Alpukat', course: 'beverage', price: 20000 },
  { sku: 'SODA-GEMBIRA', name: 'Soda Gembira', course: 'beverage', price: 20000 },
  { sku: 'AIR-MINERAL', name: 'Air Mineral', course: 'beverage', price: 5000 },
  // Main Food
  { sku: 'NASI-GORENG', name: 'Nasi Goreng Spesial', course: 'main', price: 35000 },
  { sku: 'MIE-GORENG', name: 'Mie Goreng Jawa', course: 'main', price: 28000 },
  { sku: 'AYAM-BAKAR', name: 'Ayam Bakar Madu', course: 'main', price: 38000 },
  { sku: 'SATE-AYAM', name: 'Sate Ayam 10 Tusuk', course: 'main', price: 32000 },
  { sku: 'SOTO-AYAM', name: 'Soto Ayam', course: 'main', price: 25000 },
  { sku: 'RAWON', name: 'Rawon Daging', course: 'main', price: 35000 },
  { sku: 'GADO-GADO', name: 'Gado-Gado', course: 'main', price: 22000 },
  // Appetizers & Sides
  { sku: 'CROISS', name: 'Butter Croissant', course: 'main', price: 35000 },
  { sku: 'BAKWAN', name: 'Bakwan Sayur', course: 'side', price: 10000 },
  { sku: 'TAHU-GORENG', name: 'Tahu Goreng', course: 'side', price: 12000 },
  { sku: 'TEMPE-GORENG', name: 'Tempe Goreng', course: 'side', price: 10000 },
  // Desserts
  { sku: 'PISANG-GORENG', name: 'Pisang Goreng', course: 'dessert', price: 15000 },
  { sku: 'ES-KRIM', name: 'Es Krim Coklat', course: 'dessert', price: 18000 },
  { sku: 'KLEPON', name: 'Klepon', course: 'dessert', price: 12000 },
  { sku: 'ES-CAMPUR', name: 'Es Campur', course: 'dessert', price: 18000 },
];

const KDS_NOTES = [
  null, null, null, null, null, // 60% chance of no notes
  'Pedas level 2',
  'Extra sambal',
  'Tanpa es',
  'Setengah matang',
  'Kurang garam',
  'Tambah kecap',
  'Tanpa bawang',
  'Porsi besar',
  'Lekas!',
];

const KDS_TABLES = ['T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12'];

/** Pick a random element from an array. */
function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

/** Generate a random KDS order with 1-4 items. */
function generateRandomKdsOrder(): { order: Record<string, unknown>; lines: Array<Record<string, unknown>> } {
  const displayNumber = kdsDisplayCounter++;
  const now = new Date().toISOString();
  const orderId = `kds-order-auto-${Date.now()}-${displayNumber}`;
  const numItems = Math.floor(Math.random() * 4) + 1; // 1-4 items
  const picked: Array<typeof KDS_MOCK_MENU[0]> = [];
  while (picked.length < numItems) {
    const item = pickRandom(KDS_MOCK_MENU);
    if (!picked.some(p => p.sku === item.sku)) picked.push(item);
  }
  // Generate realistic quantities — beverages/sides often ordered in multiples
  const lines: Array<Record<string, unknown>> = picked.map((item, i) => {
    let qty = 1;
    if (item.course === 'beverage') {
      // Drinks: 55% ×1, 25% ×2, 15% ×3, 5% ×4
      const r = Math.random();
      if (r > 0.95) qty = 4;
      else if (r > 0.80) qty = 3;
      else if (r > 0.55) qty = 2;
    } else if (item.course === 'side') {
      // Sides: 55% ×1, 30% ×2, 15% ×3
      const r = Math.random();
      if (r > 0.85) qty = 3;
      else if (r > 0.55) qty = 2;
    } else {
      // Mains/desserts: mostly ×1, rarely ×2
      if (Math.random() > 0.85) qty = 2;
    }
    return {
      id: `kds-line-auto-${orderId}-${i}`,
      kds_order_id: orderId,
      sku: item.sku,
      display_name: item.name,
      qty,
      course: item.course,
      modifiers: [],
      line_position: i + 1,
      item_status: 'pending',
      started_at: null,
      ready_at: null,
      served_at: null,
      created_at: now,
    };
  });

  const itemCount = lines.reduce((sum, l) => sum + (l['qty'] as number), 0);
  const itemsSummary = lines.map(l => `${l['qty']}x ${l['display_name']}`).join(', ');
  const kdsTablesWithNull: (string | null)[] = [...KDS_TABLES, null];
  const tableNumber = pickRandom(kdsTablesWithNull);
  const orderType = tableNumber ? 'dine_in' : 'takeaway';

  const order: Record<string, unknown> = {
    id: orderId,
    display_number: displayNumber,
    status: 'pending',
    received_at: now,
    items_summary: itemsSummary,
    item_count: itemCount,
    order_type: orderType,
    table_number: tableNumber,
    notes: pickRandom(KDS_NOTES),
    store_id: 'store-1',
  };

  return { order, lines };
}

/** Evict served/cancelled orders when queue exceeds max. */
function evictCompletedOrders(): void {
  while (mockKdsOrders.length > KDS_MAX_ACTIVE_ORDERS) {
    const idx = mockKdsOrders.findIndex(o => o['status'] === 'served' || o['status'] === 'cancelled');
    if (idx === -1) break;
    const removed = mockKdsOrders.splice(idx, 1)[0];
    if (removed) delete mockKdsLineItems[removed['id'] as string];
  }
}

/** Auto-generate one order per interval (dev mode only). */
function startKdsAutoGeneration(): void {
  // Skip if already running or if we have too many orders on first load.
  if (mockKdsOrders.length > KDS_MAX_ACTIVE_ORDERS) {
    mockKdsOrders.length = KDS_MAX_ACTIVE_ORDERS;
  }

  setInterval(() => {
    const { order, lines } = generateRandomKdsOrder();
    mockKdsOrders.push(order);
    mockKdsLineItems[order['id'] as string] = lines;
    evictCompletedOrders();
    saveMockKdsState();
    // Notify KDS screens of new order.
    void emit('kds:orders-changed', null);
  }, KDS_ORDER_INTERVAL_MS);
}

// Start auto-generation on load.
startKdsAutoGeneration();

// ── Auto-progress: advance orders through stages ──
// pending → preparing (2-5 min), preparing → ready (3-8 min).
// Keeps the KDS screen alive by moving orders through the kitchen.
const KDS_PROGRESS_INTERVAL_MS = 10_000; // check every 10s
const KDS_PENDING_TO_PREPARING_MIN_MS = 120_000; // 2 min minimum before prep
const KDS_PENDING_TO_PREPARING_MAX_MS = 300_000; // 5 min
const KDS_PREPARING_TO_READY_MIN_MS = 180_000; // 3 min minimum before ready
const KDS_PREPARING_TO_READY_MAX_MS = 480_000; // 8 min

function startKdsAutoProgress(): void {
  setInterval(() => {
    let changed = false;
    const now = Date.now();
    for (const order of mockKdsOrders) {
      const status = order['status'] as string;
      const receivedAt = new Date(order['received_at'] as string).getTime();
      const elapsed = now - receivedAt;

      if (status === 'pending') {
        const threshold = KDS_PENDING_TO_PREPARING_MIN_MS +
          Math.random() * (KDS_PENDING_TO_PREPARING_MAX_MS - KDS_PENDING_TO_PREPARING_MIN_MS);
        if (elapsed >= threshold) {
          order['status'] = 'preparing';
          order['started_at'] = new Date().toISOString();
          // Progress some line items to 'cooking'
          const lines = mockKdsLineItems[order['id'] as string];
          if (lines) {
            for (const line of lines) {
              if (line['item_status'] === 'pending') {
                line['item_status'] = 'cooking';
                line['started_at'] = new Date().toISOString();
                break; // only start one item at a time
              }
            }
          }
          changed = true;
        }
      } else if (status === 'preparing') {
        const threshold = KDS_PREPARING_TO_READY_MIN_MS +
          Math.random() * (KDS_PREPARING_TO_READY_MAX_MS - KDS_PREPARING_TO_READY_MIN_MS);
        if (elapsed >= threshold) {
          order['status'] = 'ready';
          order['ready_at'] = new Date().toISOString();
          // Mark all line items as ready
          const lines = mockKdsLineItems[order['id'] as string];
          if (lines) {
            for (const line of lines) {
              if (line['item_status'] !== 'ready') {
                line['item_status'] = 'ready';
                line['ready_at'] = new Date().toISOString();
              }
            }
          }
          changed = true;
        }
      } else if (status === 'ready') {
        // Auto-serve after 5-10 minutes of being ready
        const readyAt = order['ready_at'] ? new Date(order['ready_at'] as string).getTime() : receivedAt;
        const readyElapsed = now - readyAt;
        if (readyElapsed >= 300_000 + Math.random() * 300_000) {
          order['status'] = 'served';
          order['served_at'] = new Date().toISOString();
          const lines = mockKdsLineItems[order['id'] as string];
          if (lines) {
            for (const line of lines) {
              line['item_status'] = 'served';
              line['served_at'] = new Date().toISOString();
            }
          }
          changed = true;
        }
      }

      // Escalate priority after 10 minutes total
      if (elapsed >= 600_000 && !order['priority']) {
        order['priority'] = true;
        changed = true;
      }
    }
    if (changed) {
      evictCompletedOrders();
      saveMockKdsState();
      void emit('kds:orders-changed', null);
    }
  }, KDS_PROGRESS_INTERVAL_MS);
}

startKdsAutoProgress();

/** Push a new KDS order derived from cart lines into the mock queue. */
function pushKdsOrderFromCart(lines: CartLine[], storeId: string) {
  const displayNumber = kdsDisplayCounter++;
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
const MOCK_LOGIN_ATTEMPTS_KEY = 'oz-dev-mock:login-attempts';
function loadMockLoginAttempts(): Record<string, number> {
  try {
    const raw = localStorage.getItem(MOCK_LOGIN_ATTEMPTS_KEY);
    if (raw) return JSON.parse(raw) as Record<string, number>;
  } catch {
    // storage unavailable or corrupt — start with a clean counter
  }
  return {};
}
function saveMockLoginAttempts(): void {
  try {
    localStorage.setItem(MOCK_LOGIN_ATTEMPTS_KEY, JSON.stringify(loginAttempts));
  } catch {
    // storage unavailable — keep the in-memory copy for this session
  }
}
const loginAttempts: Record<string, number> = loadMockLoginAttempts();
const LOCKOUT_THRESHOLD = 4;
// LOCKOUT_DURATION_MS = 30_000 is defined for documentation;
// the mock uses a simple attempt-count lockout that resets on
// successful login to keep the dev loop fast.

// ── Cart state (for realistic E2E totals) ───────────────────────
interface CartLine {
  sku: string;
  name: string;
  price: { minor_units: number; currency: string };
  qty: number;
}
// Persisted so a reloaded preview keeps its in-progress cart — the real
// backend stores active-cart lines in the store DB. Same stateful pattern
// as the user-prefs / active-shift mocks below.
const MOCK_CART_KEY = 'oz-dev-mock:cart';
function loadMockCart(): { lines: CartLine[] } {
  try {
    const raw = localStorage.getItem(MOCK_CART_KEY);
    if (raw) return JSON.parse(raw) as { lines: CartLine[] };
  } catch {
    // storage unavailable — start with an empty cart
  }
  return { lines: [] };
}
function saveMockCart(): void {
  try {
    localStorage.setItem(MOCK_CART_KEY, JSON.stringify(cartState));
  } catch {
    // storage unavailable — keep the in-memory copy for this session
  }
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

const MOCK_HELD_CARTS_KEY = 'oz-dev-mock:held-carts';

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
  try {
    const raw = localStorage.getItem(MOCK_HELD_CARTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed.filter(isMockHeldCart);
    }
  } catch {
    // storage unavailable or corrupt — start with an empty hold list
  }
  return [];
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
  try {
    localStorage.setItem(MOCK_HELD_CARTS_KEY, JSON.stringify(mockHeldCarts));
  } catch {
    // storage unavailable — keep the in-memory copy for this session
  }
}

function holdMockCart(args: unknown): { id: string } {
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
const MOCK_SALES_KEY = 'oz-dev-mock:sales';
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
  try {
    const raw = localStorage.getItem(MOCK_SALES_KEY);
    if (raw) return JSON.parse(raw) as { sales: MockCompletedSale[]; details: Record<string, MockSaleDetails> };
  } catch {
    // storage unavailable — fall through to the seed
  }
  return seedMockSalesStore();
}
const mockSalesStore = loadMockSalesStore();
const completedSales: MockCompletedSale[] = mockSalesStore.sales;
const saleDetails: Record<string, MockSaleDetails> = mockSalesStore.details;
function saveMockSales(): void {
  try {
    localStorage.setItem(MOCK_SALES_KEY, JSON.stringify({ sales: completedSales, details: saleDetails }));
  } catch {
    // storage unavailable — keep the in-memory copies for this session
  }
}

// ── Date helpers (for seeded report data) ───────────────────────
/** List every ISO date (YYYY-MM-DD) from startDate to endDate inclusive. */
function isoDays(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  const s = new Date(`${startDate}T00:00:00`);
  const e = new Date(`${endDate}T00:00:00`);
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Deterministic pseudo-random minor-unit value for mock revenue rows. */
function mockRevenue(i: number): number {
  return 2_500_000 + ((i * 7919) % 4_500_000);
}

// ── Active shift state (for pay-btn-enabled E2E test) ──────────
// The real backend persists the open shift (with its opened_at) to the
// store-scoped `shifts` table, so a restart resumes the elapsed clock from
// the original opening time. The mock previously built a fresh shift with
// `openedAt: new Date()` at module load — every page reload reset the
// resto-POS "Current Order" shift duration to 0m. Seed from localStorage
// (same stateful pattern as user prefs below) so previews behave like a
// real store DB across reloads.
const MOCK_ACTIVE_SHIFT_KEY = 'oz-dev-mock:active-shift';
// Persisted marker for an explicitly-closed shift. Without it, a reload
// after close would re-seed a fresh open shift (the demo convenience below
// applies only on the very first load) and resurrect the clock the user
// just stopped — the real DB returns no open shift after close.
const MOCK_SHIFT_CLOSED_SENTINEL = '__closed__';
function loadMockActiveShift(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(MOCK_ACTIVE_SHIFT_KEY);
    if (raw === MOCK_SHIFT_CLOSED_SENTINEL) return null;
    if (raw) return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // storage unavailable — fall through to the in-session default
  }
  return null;
}
function hasPersistedShiftState(): boolean {
  try {
    return localStorage.getItem(MOCK_ACTIVE_SHIFT_KEY) !== null;
  } catch {
    return false;
  }
}
function saveMockActiveShift(shift: Record<string, unknown> | null): void {
  try {
    if (shift) localStorage.setItem(MOCK_ACTIVE_SHIFT_KEY, JSON.stringify(shift));
    else localStorage.setItem(MOCK_ACTIVE_SHIFT_KEY, MOCK_SHIFT_CLOSED_SENTINEL);
  } catch {
    // storage unavailable — keep in-memory copy for this session
  }
}
let mockActiveShift: Record<string, unknown> | null = loadMockActiveShift();
if (!hasPersistedShiftState()) {
  // First-ever load in this browser (nothing persisted yet): seed an open
  // shift so the pay button and the "Current Order" shift duration render
  // in dev previews without a manual open/close cycle. Explicitly closing
  // it (or never opening one) leaves the sentinel, so reloads stay closed.
  mockActiveShift = {
    id: 'shift-1', userId: 'user-1', terminalId: null, openedAt: new Date().toISOString(), closedAt: null,
    openingBalanceMinor: 0, closingBalanceMinor: null, expectedCashMinor: null, cashDifferenceMinor: null,
    totalSalesMinor: 0, totalCashMinor: 0, totalCardMinor: 0, totalOtherMinor: 0,
    totalVoidsMinor: 0, totalRefundsMinor: 0, totalPayoutsMinor: 0, notes: '', status: 'open',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  saveMockActiveShift(mockActiveShift);
}
// Closed-shift history so the reconciliation spec can verify shifts appear
// in the Shift History table after closing. One pre-seeded closed shift
// guarantees the history table renders on every fresh page load (the older
// shift.spec asserts .shift-mgmt-table without running an open/close cycle).
// The real backend keeps closed shifts in the `shifts` table, so persist
// the history (same stateful pattern as the other mocks) — previously a
// reload reverted to just the seed and every reconciliation record
// vanished.
const MOCK_SHIFT_HISTORY_KEY = 'oz-dev-mock:shift-history';
const _initialShiftHistory: Array<Record<string, unknown>> = [
  {
    id: 'shift-seed-1', userId: 'user-1', terminalId: null,
    openedAt: new Date(Date.now() - 3600000).toISOString(), closedAt: new Date(Date.now() - 1800000).toISOString(),
    openingBalanceMinor: 100000, closingBalanceMinor: 150000, expectedCashMinor: 150000, cashDifferenceMinor: 0,
    totalSalesMinor: 50000, totalCashMinor: 50000, totalCardMinor: 0, totalOtherMinor: 0,
    totalVoidsMinor: 0, totalRefundsMinor: 0, totalPayoutsMinor: 0, notes: '', status: 'closed',
    createdAt: new Date(Date.now() - 3600000).toISOString(), updatedAt: new Date(Date.now() - 1800000).toISOString(),
  },
];
function loadMockShiftHistory(): Array<Record<string, unknown>> {
  try {
    const raw = localStorage.getItem(MOCK_SHIFT_HISTORY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // storage unavailable or corrupt — fall through to the seed
  }
  // First load: seed one closed shift so the history table renders without
  // an open/close cycle. Shallow-clone so pushes never bleed into the seed.
  return _initialShiftHistory.map((s) => ({ ...s }));
}
function saveMockShiftHistory(): void {
  try {
    localStorage.setItem(MOCK_SHIFT_HISTORY_KEY, JSON.stringify(mockShiftHistory));
  } catch {
    // storage unavailable — keep the in-memory copy for this session
  }
}
const mockShiftHistory: Array<Record<string, unknown>> = loadMockShiftHistory();
// ── User preferences (stateful mock) ─────────────────────────────
// The real backend persists per-user preferences to the store-scoped
// `user_preferences` table. The mock previously returned static values
// while discarding writes, which made the restaurant-menu hamburger
// configuration (sort / card size / font size) revert on every reload.
// Seed from localStorage so previews behave like a real store DB.
const MOCK_USER_PREFS_KEY = 'oz-dev-mock:user-prefs';
function loadMockUserPrefs(): Record<string, string> {
  try {
    const raw = localStorage.getItem(MOCK_USER_PREFS_KEY);
    if (raw) return JSON.parse(raw) as Record<string, string>;
  } catch {
    // storage unavailable — start empty
  }
  return {};
}
function saveMockUserPrefs(prefs: Record<string, string>): void {
  try {
    localStorage.setItem(MOCK_USER_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // storage unavailable — keep in-memory copy for this session
  }
}
const mockUserPrefs: Record<string, string> = loadMockUserPrefs();

// ── Topology diagram (stateful mock) ─────────────────────────────
// The real backend persists the node/wire diagram as JSON under the
// `oz-pos/topology` settings key. The mock previously returned hardcoded
// positions (and used the wrong payload shape: `label` instead of `name`,
// `from`/`to` instead of `from_node_id`/`to_node_id` — so wires never even
// loaded in the preview) while discarding saves, which made node locations
// revert on every reload. Seed from localStorage so previews round-trip
// positions exactly like a real store DB.
interface MockTopologyNode {
  id: string;
  type: string;
  name: string;
  subtitle?: string;
  x: number;
  y: number;
  tier_requirement?: string;
  telemetry_badge?: string;
  telemetry_status?: string;
  metadata?: Record<string, unknown>;
}
interface MockTopologyWire {
  id: string;
  from_node_id: string;
  to_node_id: string;
  direction: string;
  label?: string;
  from_port?: string;
  to_port?: string;
}
interface MockTopology {
  revision?: number;
  resolved_issue_keys?: string[];
  nodes: MockTopologyNode[];
  wires: MockTopologyWire[];
}

const MOCK_TOPOLOGY_KEY = 'oz-dev-mock:topology';

/** First-run canvas: matches the current preview's starting topology.
 *  Cards are 240px wide/tall, so positions sit on a spread grid (rows 80/320,
 *  columns 80/380) that never overlaps on load. Wires carry labels so the
 *  first-run canvas demonstrates the labeled-wire UX instead of empty pills. */
const MOCK_TOPOLOGY_SEED: MockTopology = {
  revision: 0,
  resolved_issue_keys: [],
  nodes: [
    { id: 'store-1', type: 'store', name: 'TOKO TEST', subtitle: 'Primary Store', x: 80, y: 80 },
    { id: 'ws-1', type: 'workspace', name: 'Store POS', subtitle: 'Point of Sale', x: 380, y: 80, metadata: { typeKey: 'store-pos', persisted: true } },
    { id: 'ws-2', type: 'workspace', name: 'Restaurant', subtitle: 'Table service', x: 380, y: 320, metadata: { typeKey: 'restaurant-pos', persisted: true } },
  ],
  wires: [
    { id: 'wire-1', from_node_id: 'store-1', from_port: 'right', to_node_id: 'ws-1', to_port: 'left', direction: 'one-way', label: 'Binds Store' },
    { id: 'wire-2', from_node_id: 'store-1', from_port: 'right', to_node_id: 'ws-2', to_port: 'left', direction: 'one-way', label: 'Binds Store' },
  ],
};

function loadMockTopology(): MockTopology {
  try {
    const raw = localStorage.getItem(MOCK_TOPOLOGY_KEY);
    if (raw) return JSON.parse(raw) as MockTopology;
  } catch {
    // storage unavailable — start from seed
  }
  return MOCK_TOPOLOGY_SEED;
}
function saveMockTopology(topology: MockTopology): void {
  try {
    localStorage.setItem(MOCK_TOPOLOGY_KEY, JSON.stringify(topology));
  } catch {
    // storage unavailable — keep in-memory copy for this session
  }
}
const mockTopology: MockTopology = loadMockTopology();

// ── Topology revision history (ADR #46) ───────────────────────
//
// The dev-mock mirrors the backend's append-only history so the version
// browser is reachable without a running desktop client. It also mirrors
// §4's DEFlation rule, not just the append — otherwise `restorable: false`
// is unreachable in the browser and the "record only — snapshot pruned"
// state the real sweep produces can never be exercised during development.
const MOCK_TOPOLOGY_REVISIONS_KEY = 'oz-dev-mock:topology-revisions';
/** Mirrors `TOPOLOGY_REVISION_RESTORABLE_KEEP` in revisions.rs. */
const MOCK_TOPOLOGY_REVISION_KEEP = 20;

interface MockTopologyRevision {
  /** The branch scope the row belongs to. Mirrors the real table's
   *  `branch_id` (empty string = the unscoped legacy graph, which is its own
   *  scope, not a catch-all). Without it the mock listed every branch's
   *  history for any query, so a UI that ignored branch scoping would pass in
   *  the browser and fail against the backend. */
  branchId: string;
  revision: number;
  changeNote: string;
  publishedAt: string;
  publishedBy: string;
  pinned: boolean;
  nodeCount: number;
  wireCount: number;
  workspaceCreations: number;
  workspaceUpdates: number;
  workspaceArchives: number;
  contractSchemaVersion: number;
  /** The stored envelope; deleted when the row is deflated. */
  diagram?: MockTopology;
}

function loadMockTopologyRevisions(): MockTopologyRevision[] {
  try {
    const raw = localStorage.getItem(MOCK_TOPOLOGY_REVISIONS_KEY);
    if (raw) return JSON.parse(raw) as MockTopologyRevision[];
  } catch {
    // storage unavailable — start empty
  }
  return [];
}

function saveMockTopologyRevisions(rows: MockTopologyRevision[]): void {
  try {
    localStorage.setItem(MOCK_TOPOLOGY_REVISIONS_KEY, JSON.stringify(rows));
  } catch {
    // storage unavailable — keep the in-memory copy for this session
  }
}

const mockTopologyRevisions: MockTopologyRevision[] = loadMockTopologyRevisions();

/** Append one immutable revision, then deflate anything past the budget.
 *  Deflation drops the diagram and keeps the record — never delete the row. */
function recordMockTopologyRevision(row: MockTopologyRevision): void {
  mockTopologyRevisions.push(row);
  // Ranked PER BRANCH: `cleanup_old_topology_revisions` gives each branch its
  // own budget, so a busy branch must not prune a quiet one.
  const unpinned = mockTopologyRevisions
    .filter((r) => !r.pinned && r.branchId === row.branchId)
    .sort((a, b) => b.revision - a.revision);
  for (const stale of unpinned.slice(MOCK_TOPOLOGY_REVISION_KEEP)) {
    delete stale.diagram;
  }
  saveMockTopologyRevisions(mockTopologyRevisions);
}

/** The metadata projection the list command returns — never the diagram. */
function summarizeMockTopologyRevision(r: MockTopologyRevision) {
  const { diagram, ...rest } = r;
  return { ...rest, restorable: diagram !== undefined };
}

// ── Audit mock: shapes the Rust commands actually serialize ───────
//
// These three handlers used to return `''`, `null` and a fixed pair. The first
// two are type mismatches against object DTOs, and the third was shape-correct
// but inert — it could never show the effect of a review. All three ignored the
// args the screen sends, so a filtered export previewed as an unfiltered
// artifact. verify-ipc-parity's dev_mock list cannot see any of that: it asks
// whether a command HAS a handler, not whether the handler answers with the
// right shape. Pinned by ui/src/__tests__/dev-mock-audit-shapes.test.ts.

type MockAuditRow = {
  id: string;
  user_id: string;
  action: string;
  target_type: string;
  target_id: string;
  details: string;
  outcome: string;
  created_at: string;
};

/**
 * Mirrors `AuditExportDto` in both shells' commands/audit.rs: `csv`,
 * `row_count`, `generated_at`, `requested_by` — snake_case, because the struct
 * carries no `rename_all` (only the ARGS structs do). Getting this wrong is
 * invisible to the mock and visible only to a screen reading a field that
 * arrives undefined.
 */
type MockReviewCheckpoint = {
  id: string;
  store_id: string;
  reviewer_user_id: string;
  reviewed_at: string;
  reviewed_through_created_at: string;
  reviewed_through_id: string;
};

// The exact column order and header `export_audit_log_scoped` writes
// (audit.rs:453), BOM included: the artifact is opened in spreadsheets, where
// the BOM is what stops UTF-8 details text from mojibake-ing.
const MOCK_AUDIT_CSV_COLUMNS = [
  'id',
  'created_at',
  'user_id',
  'action',
  'target_type',
  'target_id',
  'outcome',
  'details',
] as const;

function mockCsvField(value: string): string {
  return /[",\n\r]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
}

/** Newest first, matching the real export's ordering. */
function mockAuditLogRows(): MockAuditRow[] {
  const now = Date.now();
  return [
    { id: 'audit-1', user_id: 'admin-1', action: 'sale.completed', target_type: 'sale', target_id: 'seed-sale-001', details: 'Sale completed', outcome: 'success', created_at: new Date(now - 60000).toISOString() },
    { id: 'audit-2', user_id: 'owner-1', action: 'shift.opened', target_type: 'shift', target_id: 'shift-1', details: 'Shift opened', outcome: 'success', created_at: new Date(now - 120000).toISOString() },
  ];
}

/**
 * Read a handler's payload. invoke() calls handlers as
 * `handler(args?.['args'] ?? args)` — the { args } envelope an api wrapper sends
 * is UNWRAPPED before the handler sees it (see invoke below), so reading the
 * nested object directly is wrong twice over: a flat call leaves it undefined,
 * and an enveloped call receives an object whose own fields are absent. Unwrapping
 * the same way invoke does is the only reason the filter assertions in
 * dev-mock-audit-shapes.test.ts pass for the right reason instead of by returning
 * unfiltered rows that match an unfiltered expectation.
 */
function mockHandlerPayload<T extends object>(args: unknown): T {
  const holder = (args ?? {}) as { args?: T } & T;
  return ((holder.args ?? holder) ?? {}) as T;
}

function mockAuditFilterArgs(args: unknown): { outcome?: string; query?: string } {
  return mockHandlerPayload<{ outcome?: string; query?: string }>(args);
}

function mockAuditMatches(row: MockAuditRow, f: { outcome?: string; query?: string }): boolean {
  if (f.outcome && row.outcome !== f.outcome) return false;
  const q = (f.query ?? '').toLowerCase();
  if (!q) return true;
  return (row.action + ' ' + row.user_id + ' ' + row.target_id + ' ' + row.details)
    .toLowerCase()
    .includes(q);
}

// In-memory on purpose: the review checkpoint is preview state, not something to
// persist to localStorage like the workspace seed. A reload resetting it matches
// a browser preview starting over, and keeps a stale high-water mark from
// claiming a review that never happened on the tenant's real log.
const mockAuditReview: { checkpoint: MockReviewCheckpoint | null } = { checkpoint: null };
const handlers: Record<string, (args: unknown) => unknown> = {
  // ═══════════════════════════════════════════════════════════════
  // AUTH / STAFF
  // ═══════════════════════════════════════════════════════════════

  // STAFF-06: uniform pre-auth response — never reveals account existence or
  // activation state (enumeration oracle closed).
  'staff_check_username': (_args) => ({ proceed: true }),

  // Pre-auth check — the dev-mock always has seeded staff accounts.
  'has_users': () => ({ has_users: true }),

  'staff_login': (args) => {
    const { username, pin } = args as { username: string; pin: string };
    const key = username.toLowerCase();
    const staff = MOCK_STAFF[key];

    // Check lockout.
    const attempts = loginAttempts[key] ?? 0;
    if (attempts >= LOCKOUT_THRESHOLD) {
      throw new Error('Account locked. Too many failed attempts. Try again in 30s');
    }

    if (!staff || pin !== staff.pin_hash) {
      loginAttempts[key] = attempts + 1;
      saveMockLoginAttempts();
      throw new Error('Invalid credentials');
    }

    // Reset on success — persisted so a reloaded preview stays unlocked.
    delete loginAttempts[key];
    saveMockLoginAttempts();
    return {
      session: {
        user_id: staff.user_id,
        display_name: mockRoleName(staff.role),
        role_name: mockRoleName(staff.role),
        role_id: staff.role,
        // Granted keys mirror the role presets (Owner = global wildcard;
        // Staff = checkout-only; Auditor = read-only) so the dev preview
        // gates on permissions like the real backend.
        permissions: MOCK_ROLE_PERMISSIONS[staff.role] ?? [],
      },
      // audit-open-findings parity: the real backend mints a short-lived picker
      // ticket at login; without it the workspace picker never loads
      // (WorkspaceProvider bails when pickerTicket is null). The mock
      // must return one so browser dev previews work like the client.
      picker_ticket: `mock-picker-${staff.user_id}-${Date.now()}`,
    };
  },

  'bootstrap_owner': (_args) => {
    return {
      session: {
        user_id: 'owner-1',
        display_name: 'Owner',
        role_name: 'Owner',
        role_id: 'role-owner',
        permissions: MOCK_ROLE_PERMISSIONS['role-owner'] ?? [],
      },
      // audit-open-findings parity: the first-owner flow also mints a picker ticket.
      picker_ticket: `mock-picker-owner-1-${Date.now()}`,
    };
  },

  'create_session': (args) => {
    const a = args as { args: { user_id: string; role_id: string; store_id: string; instance_id: string; type_key: string; terminal_id: string } };
    const { user_id, role_id, store_id, instance_id, type_key, terminal_id } = a.args ?? a;
    return {
      session_token: `mock-session-${Date.now()}`,
      context: { userId: user_id, roleId: role_id, storeId: store_id, instanceId: instance_id, typeKey: type_key, terminalId: terminal_id },
    };
  },

  'destroy_session': () => null,

  'impersonate_user_scoped': (args) => {
    const a = args as { sessionToken: string; targetUserId: string };
    return {
      session_token: `mock-impersonation-${Date.now()}`,
      context: {
        userId: a.targetUserId,
        roleId: 'role-owner',
        storeId: 'store-1',
        instanceId: 'inst-1',
        typeKey: 'organization',
        terminalId: 'term-1',
      },
    };
  },

  'session_keepalive': () => ({ expires_at: Math.floor(Date.now() / 1000) + 86400 }),

  // ── EDC card-present terminal ──────────────────────────────────────
  'edc_terminal_status': () => ({ status: 'ready' }),
  'edc_sale': (args) => {
    const a = args as { args: { amountMinor: number; currency: string } };
    const { amountMinor, currency } = a.args ?? a;
    return {
      success: true,
      transactionId: `mock-edc-${Date.now()}`,
      authCode: 'MOCKAUTH',
      cardScheme: 'Visa',
      cardLast4: '1111',
      message: `approved ${amountMinor} ${currency}`,
    };
  },
  'edc_refund': (args) => {
    const a = args as { args: { transactionId: string; amountMinor: number; currency: string } };
    const { transactionId, amountMinor, currency } = a.args ?? a;
    return {
      success: true,
      transactionId,
      authCode: 'MOCKREF',
      cardScheme: null,
      cardLast4: null,
      message: `refund approved ${amountMinor} ${currency}`,
    };
  },
  'edc_void': (args) => {
    const a = args as { args: { transactionId: string } };
    const { transactionId } = a.args ?? a;
    return { success: true, transactionId, authCode: null, cardScheme: null, cardLast4: null, message: 'void approved' };
  },

  // ═══════════════════════════════════════════════════════════════
  // BOOT / SETUP
  // ═══════════════════════════════════════════════════════════════

  'resolve_boot_store': () => ({
    is_bound: true,
    store_id: 'store-1',
    instance_id: 'ws-1',
  }),

  'get_setup_status': () => ({ completed: true, preset: 'retail' }),
  'complete_setup': () => null,
  'dismiss_setup_wizard': () => null,

  // ═══════════════════════════════════════════════════════════════
  // SYSTEM / PING
  // ═══════════════════════════════════════════════════════════════

  'ping': () => 'pong',
  'version': () => ({ name: 'oz-pos', version: pkg.version, rustVersion: '1.80', target: 'x86_64' }),
  'version_scoped': () => ({ name: 'oz-pos', version: pkg.version, rustVersion: '1.80', target: 'x86_64' }),
  'get_local_ip': () => '192.168.1.100',

  // ═══════════════════════════════════════════════════════════════
  // LICENSE
  // ═══════════════════════════════════════════════════════════════

  'list_all_features': () => ({
    features: [
      { key: 'sales', name: 'Sales', description: 'Point of sale transactions', group: 'Core', enabled: true, dependencies: [] },
      { key: 'inventory', name: 'Inventory', description: 'Stock management', group: 'Core', enabled: true, dependencies: ['sales'] },
      { key: 'reporting', name: 'Reporting', description: 'Sales and inventory reports', group: 'Reporting', enabled: false, dependencies: ['sales'] },
      { key: 'staff', name: 'Staff', description: 'Staff management', group: 'Staff', enabled: true, dependencies: [] },
      { key: 'settings', name: 'Settings', description: 'System settings', group: 'Core', enabled: true, dependencies: [] },
    ],
  }),
  'set_feature': () => ({ success: true, features: [], auto_enabled: [] }),
  'set_features_bulk': () => ({ features: [] }),

  'plugin:updater|check': () => null,

  'get_license_status': () => ({ isActive: true, status: 'valid', tier: 'pro', payload: null, message: null }),
  'check_license_status': () => ({ tenantId: 'tenant-1', status: 'active', tier: 'Pro', active: true, expiresAt: null, graceUntil: null, maxLocations: 5 }),
  // Operational by default, matching a healthy server. `state` and `cause`
  // ride alongside `ok` because they answer a different question: a degraded
  // server sends ok:false AND state:'degraded'. Flip these two lines to
  // exercise the amber pill without a broken database.
  'test_auth_connection': () => ({
    ok: true,
    status: 'Connected (12ms)',
    latencyMs: 12,
    state: 'operational',
    cause: null,
  }),
  'get_machine_id': () => 'mock-machine-id-001',
  'get_hardware_fingerprint': () => 'hw_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  'get_device_id': () => 'mock-device-id-001',
  'activate_license': () => true,
  'renew_license': () => true,
  'pause_subscription': () => ({
    status: 'paused',
    tierKey: 'plus',
    pausedAt: new Date().toISOString(),
    pausedUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  }),
  'resume_subscription': () => ({
    status: 'active',
    tierKey: 'plus',
  }),
  'get_subscription_capabilities': () => ({
    tier: 'premium',
    state: 'active',
    maxLocations: null,
    maxPosInstances: null,
    maxWarehouses: null,
      // Per-location KDS cap; null = unlimited, matching the Premium fixture this
      // block returns (SubscriptionTier::max_kds_screens: Free/Plus 0, Pro 2,
      // Premium/Enterprise unlimited).
      maxKdsScreens: null,
    maxStaffUsers: null,
    salesHistoryDays: null,
    supportsQris: true,
    supportsAnalytics: true,
    supportsLoyalty: true,
    supportsDailyDashboard: true,
    supportsCloudSync: true,
    offlineGraceDays: 30,
    locationCount: 1,
    staffCount: 1,
    terminalCount: 1,
    addons: [],
  }),

  // Mock tenant is Premium + active with unlimited quotas, so every known
  // feature is available (reason null) — consistent with the premium caps
  // above. An unknown key is rejected rather than echoed back as available,
  // mirroring the real command's fail-closed AppError::Invalid.
  'explain_feature_availability_scoped': (raw) => {
    const { feature } = (raw as { feature?: string }) ?? {};
    const known: string[] = [
      'supports_qris',
      'supports_analytics',
      'supports_loyalty',
      'supports_daily_dashboard',
      'supports_cloud_sync',
      'sales_history_days',
      'locations',
      'staff_users',
      'pos_instances',
      'warehouses',
    ];
    if (!feature || !known.includes(feature)) {
      throw new Error(`unknown feature key ${JSON.stringify(feature)}`);
    }
    return {
      feature,
      available: true,
      reason: null,
      detail: {
        tier: 'premium',
        state: 'active',
        limit: null,
        usage: null,
        permission: null,
        scopeGranted: null,
        expiresAt: null,
        graceUntil: null,
      },
    };
  },

  // Over-quota assessment (§J remediation): the mock tenant is Premium
  // with unlimited quotas, so nothing is over — mirrors the premium caps
  // above and keeps the remediation view renderable in browser mode.
  'get_over_quota_report': () => ({
    tierKey: 'premium',
    tierName: 'Premium',
    usages: [
      { dimension: 'locations', limit: null, current: 1 },
      { dimension: 'pos_registers', limit: null, current: 1 },
      { dimension: 'warehouses', limit: null, current: 0 },
      { dimension: 'staff', limit: null, current: 1 },
      { dimension: 'products', limit: null, current: 0 },
    ],
    // section J B3: per-location marker rows are empty HERE ON PURPOSE, not
    // omitted. This fixture reports the Premium tier, whose caps are unlimited
    // (max_kds_screens and max_warehouses are both None), so the real fan-out
    // cannot legally emit a single row: an unlimited cap never produces a
    // marker. A mock that invented one to make the section visible would be worse
    // than no preview, because it would demonstrate a state the product cannot
    // reach. To see the section, change tierKey/tierName above to 'pro' and give
    // the caps finite limits, then add rows whose resourceType is 'kds_screen' or
    // 'warehouse' and whose resourceId is a mock location id.
    markers: [],
  }),

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

  // Legal Entity (Organization-level, Phase 1 §G). Registered here because
  // scripts/verify-ipc-parity.py treats a missing dev-mock handler as a hard
  // violation: invoke() would return null and the caller would silently render
  // its failure path instead of erroring.
  'list_legal_entities_scoped': listMockLegalEntities,
  'get_legal_entity_scoped': getMockLegalEntity,
  'create_legal_entity_scoped': createMockLegalEntity,
  'update_legal_entity_scoped': updateMockLegalEntity,

  // Regional configuration read model (regional slice 2). Registered here
  // because scripts/verify-ipc-parity.py treats a missing dev-mock handler
  // as a hard violation: invoke() would return null and the caller would
  // silently render its failure path instead of erroring.
  'get_regional_config_scoped': getMockRegionalConfig,

  // Regional configuration write path (regional slice 3) — same parity rule.
  'set_regional_config_scoped': setMockRegionalConfig,

  'list_active_memos_scoped': listMockActiveMemos,
  'acknowledge_memo_scoped': acknowledgeMockMemo,

  // Memo authoring (desktop management surface). The dev mock mirrors the
  // real commands: drafts are invisible to terminals until published.
  'create_memo_scoped': createMockMemo,
  'publish_memo_scoped': publishMockMemo,
  'stop_memo_scoped': stopMockMemo,
  'revise_memo_scoped': reviseMockMemo,
  'list_authored_memos_scoped': listMockAuthoredMemos,

  // ═════════════════════════════════════════════════════════
  // WORKSPACES (ADR #4 / #7)
  // ═══════════════════════════════════════════════════════════════

  'list_workspaces': () => mockWorkspaces,
  'list_workspaces_scoped': () => mockWorkspaces,
  'list_workspace_screens': () => [],
  'list_workspace_screens_scoped': () => [],
  'get_workspace_instance_scoped': (args) => {
    const { instanceId } = args as { instanceId: string };
    return mockWorkspaces.find(w => w.instance_id === instanceId) ?? mockWorkspaces[0];
  },
  'create_workspace_instance_scoped': (args) => {
    const req = (args as { req: Record<string, unknown> }).req;
    return { instance_id: `ws-${Date.now()}`, ...req };
  },
  // Renames mutate the stateful workspace list so a reload keeps the new
  // name — same persistence contract as the real workspace_instances row.
  'update_workspace_instance_scoped': (args) => {
    const { instanceId, name } = (args ?? {}) as { instanceId?: string; name?: string };
    const existing = mockWorkspaces.find((w) => w.instance_id === instanceId) ?? mockWorkspaces[0];
    if (existing && name !== undefined) existing.name = name;
    return existing ?? null;
  },
  'delete_workspace_instance_scoped': () => null,
  'archive_workspace_instance_scoped': () => null,
  'set_default_instance_scoped': () => null,
  'list_screens_scoped': () => [],
  'list_all_workspaces_scoped': () => [
    { key: 'store-pos', name: 'Store POS', description: 'Point of Sale', icon: 'shopping-cart' },
    { key: 'restaurant-pos', name: 'Restaurant POS', description: 'Table service', icon: 'restaurant' },
    { key: 'kds', name: 'Kitchen Display', description: 'Order display', icon: 'utensils' },
    { key: 'warehouse', name: 'Warehouse', description: 'Product and stock management', icon: 'package' },
    { key: 'admin', name: 'Admin', description: 'Settings & management', icon: 'settings' },
  ],
  'get_user_workspace_instances_scoped': () => [],
  'set_user_workspace_instances_scoped': () => null,

  // ═══════════════════════════════════════════════════════════════
  // TERMINALS
  // ═══════════════════════════════════════════════════════════════

  'list_terminals': () => [MOCK_TERMINAL],
  'list_terminals_scoped': () => [MOCK_TERMINAL],
  'get_terminal': () => MOCK_TERMINAL,
  'get_terminal_scoped': () => MOCK_TERMINAL,
  'register_terminal': () => ({ id: 'term-new' }),
  'register_terminal_scoped': () => ({ id: 'term-new' }),
  'update_terminal': () => ({ id: 'term-1' }),
  'update_terminal_scoped': () => ({ id: 'term-1' }),
  'ping_terminal': () => null,
  'ping_terminal_scoped': () => null,
  'delete_terminal': () => null,
  'delete_terminal_scoped': () => null,
  'get_terminal_profile': () => ({ terminalId: 'term-1', profileType: 'desktop', lockedScreen: null, updatedAt: new Date().toISOString() }),
  'get_terminal_profile_scoped': () => ({ terminalId: 'term-1', profileType: 'desktop', lockedScreen: null, updatedAt: new Date().toISOString() }),
  'set_terminal_profile': () => null,
  'set_terminal_profile_scoped': () => null,
  'list_terminal_profiles': () => [],
  'list_terminal_profiles_scoped': () => [],
  'delete_terminal_profile': () => null,
  'delete_terminal_profile_scoped': () => null,
  'list_terminal_overrides': () => [],
  'list_terminal_overrides_scoped': () => [],
  'set_terminal_override': () => null,
  'set_terminal_override_scoped': () => null,
  'delete_terminal_override': () => null,
  'delete_terminal_override_scoped': () => null,
  'get_device_binding': () => ({ bounded: true, boundStoreId: 'store-1', boundInstanceId: 'ws-1', signatureValid: true }),
  'get_device_binding_scoped': () => ({ bounded: true, boundStoreId: 'store-1', boundInstanceId: 'ws-1', signatureValid: true }),
  'set_device_binding': () => null,
  'set_device_binding_scoped': () => null,
  'clear_device_binding': () => null,
  'clear_device_binding_scoped': () => null,

  // ═══════════════════════════════════════════════════════════════
  // SETTINGS
  // ═══════════════════════════════════════════════════════════════

  'get_store_settings': () => ({
    name: 'TOKO TEST', address: 'Jl. Contoh No. 123', taxId: 'TAX-001', currency: 'IDR', branch: 'Cabang A', logo: '',
  }),
  'get_store_settings_scoped': () => ({
    name: 'TOKO TEST', address: 'Jl. Contoh No. 123', taxId: 'TAX-001', currency: 'IDR', branch: 'Cabang A', logo: '',
  }),
  'set_store_settings': () => null,
  'set_store_settings_scoped': () => null,

  'get_receipt_settings': () => ({
    showCurrency: true, decimalSeparator: 'dot', showTax: true, footer: 'Terima kasih',
    paperWidth: 'standard', showTableNumber: false,
    marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
  }),
  'get_receipt_settings_scoped': () => ({
    showCurrency: true, decimalSeparator: 'dot', showTax: true, footer: 'Terima kasih',
    paperWidth: 'standard', showTableNumber: false,
    marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
  }),
  'set_receipt_settings': () => null,
  'get_report_schedule': () => ({
    enabled: false,
    cadence: 'daily',
    report_types: ['daily_revenue', 'top_products'],
    recipients: ['admin@example.com'],
    send_at_time: '08:00',
    timezone: 'UTC',
    lookback_days: 1,
  }),
  'save_report_schedule': () => null,
  'send_test_report': () => 'Email sent',

  'can_save_topology': () => true,
  // The editor's Apply flow now confirms the operator PIN first (round 148).
  // The dev-mock accepts any PIN so the real Apply chain stays reachable in
  // the editor's integration tests.
  'verify_pin': () => true,
  'load_topology': () => ({
    revision: mockTopology.revision ?? 0,
    resolved_issue_keys: [...(mockTopology.resolved_issue_keys ?? [])],
    nodes: mockTopology.nodes.map((n) => ({ ...n })),
    wires: mockTopology.wires.map((w) => ({ ...w })),
  }),
  // The editor's Apply button saves through this command. Mirror the real
  // backend's atomic diff: apply instance creates/updates/archives AND
  // persist the diagram (node positions included) so reloads keep both the
  // node layout and the workspace instances.
  'apply_topology_diff': (args) => {
    const { workspaceCreations, workspaceUpdates, workspaceArchives, diagramNodes, diagramWires, resolvedIssueKeys, baseRevision, branchId, changeNote } = (args as {
      workspaceCreations?: Array<{ id: string; type_key: string; store_id: string; name: string; description?: string; colour?: string }>;
      workspaceUpdates?: Array<{ id: string; name: string }>;
      workspaceArchives?: string[];
      diagramNodes?: MockTopologyNode[];
      diagramWires?: MockTopologyWire[];
      resolvedIssueKeys?: string[];
      baseRevision?: number;
      branchId?: string;
      changeNote?: string;
    }) ?? {};
    // Mirror the backend's optimistic-concurrency gate (topology.rs, round
    // 133): a stale baseRevision can NEVER retry successfully, so reject
    // with the typed conflict the editor's recovery path detects (round
    // 137). Skipped when the field is absent — the real command requires
    // base_revision, so only callers that send it opt into the guard.
    const currentRevision = mockTopology.revision ?? 0;
    if (baseRevision !== undefined && baseRevision !== currentRevision) {
      throw {
        kind: 'topologyValidation',
        code: 'topology-revision-conflict',
        nodeId: null,
        wireId: null,
        portId: null,
        message: `topology revision conflict: expected ${baseRevision}, current ${currentRevision}`,
      };
    }
    for (const c of workspaceCreations ?? []) {
      mockWorkspaces.push({
        instance_id: c.id,
        type_key: c.type_key,
        store_id: c.store_id,
        store_name: 'TOKO TEST',
        name: c.name,
        description: c.description ?? '',
        icon: 'shopping-cart',
        layout_mode: 'default',
        colour: c.colour ?? '#10b981',
        is_default: false,
      });
    }
    for (const u of workspaceUpdates ?? []) {
      const inst = mockWorkspaces.find((w) => w.instance_id === u.id);
      if (inst) inst.name = u.name;
    }
    for (const id of workspaceArchives ?? []) {
      const idx = mockWorkspaces.findIndex((w) => w.instance_id === id);
      if (idx >= 0) mockWorkspaces.splice(idx, 1);
    }
    if (workspaceCreations?.length || workspaceUpdates?.length || workspaceArchives?.length) {
      saveMockWorkspaces();
    }
    if (diagramNodes) mockTopology.nodes = diagramNodes.map((n) => ({ ...n }));
    if (diagramWires) mockTopology.wires = diagramWires.map((w) => ({ ...w }));
    if (resolvedIssueKeys) mockTopology.resolved_issue_keys = [...resolvedIssueKeys];
    mockTopology.revision = (mockTopology.revision ?? 0) + 1;
    saveMockTopology(mockTopology);
    // ADR #46 §3: in the real backend this row is written INSIDE the same
    // transaction as the envelope, so a rejected Apply leaves no history. The
    // conflict throw above already mirrors that — control never reaches here
    // on a rejected Apply.
    recordMockTopologyRevision({
      branchId: branchId ?? '',
      revision: mockTopology.revision,
      changeNote: changeNote ?? '',
      publishedAt: new Date().toISOString(),
      publishedBy: 'dev-mock',
      pinned: false,
      nodeCount: mockTopology.nodes.length,
      wireCount: mockTopology.wires.length,
      workspaceCreations: workspaceCreations?.length ?? 0,
      workspaceUpdates: workspaceUpdates?.length ?? 0,
      workspaceArchives: workspaceArchives?.length ?? 0,
      contractSchemaVersion: 2,
      diagram: JSON.parse(JSON.stringify(mockTopology)) as MockTopology,
    });
    return { revision: mockTopology.revision };
  },

  // ADR #46 §4: pin/unpin. Mirrors the real command's three-way answer —
  // a pin on an already-deflated row succeeds but is not restorable, and an
  // unpin that leaves the row past the budget warns that the next tick prunes
  // it. Keeping the dev-mock honest here is what lets the browser states be
  // developed without a running desktop client.
  'pin_topology_revision': (args) => {
    const { revision, pinned, branchId } = (args as {
      revision?: number; pinned?: boolean; branchId?: string;
    }) ?? {};
    const row = mockTopologyRevisions.find(
      (r) => r.revision === revision && r.branchId === (branchId ?? ''),
    );
    if (!row || pinned === undefined) {
      return {
        status: 'not-found',
        revision: revision ?? 0,
        pinned: pinned ?? false,
        restorable: false,
        prunedByNextSweep: false,
      };
    }
    row.pinned = pinned;
    saveMockTopologyRevisions(mockTopologyRevisions);
    const unpinned = mockTopologyRevisions
      .filter((r) => !r.pinned && r.branchId === row.branchId)
      .sort((a, b) => b.revision - a.revision);
    const cutoff = unpinned.length > MOCK_TOPOLOGY_REVISION_KEEP
      ? unpinned[MOCK_TOPOLOGY_REVISION_KEEP]!.revision
      : null;
    return {
      status: 'updated',
      revision: row.revision,
      pinned: row.pinned,
      restorable: row.diagram !== undefined,
      prunedByNextSweep: cutoff !== null && row.pinned === false && row.revision <= cutoff,
    };
  },

  // ADR #46 §1/§8: metadata only, newest first — the diagram is fetched per
  // revision by `load_topology_revision`, mirroring the real payload bound.
  'list_topology_revisions': (args) => {
    const { limit, branchId } = (args as { limit?: number; branchId?: string }) ?? {};
    const budget = Math.min(Math.max(limit ?? 50, 1), 200);
    return mockTopologyRevisions
      .filter((r) => r.branchId === (branchId ?? ''))
      .slice()
      .sort((a, b) => b.revision - a.revision)
      .slice(0, budget)
      .map(summarizeMockTopologyRevision);
  },

  // `deflated` and `not-found` stay distinct (ADR #46 §4): a pruned deploy
  // still happened.
  'load_topology_revision': (args) => {
    const { revision, branchId } = (args as { revision?: number; branchId?: string }) ?? {};
    const row = mockTopologyRevisions.find(
      (r) => r.revision === revision && r.branchId === (branchId ?? ''),
    );
    if (!row) {
      return { status: 'not-found', revision: revision ?? 0, changeNote: '', publishedAt: '', publishedBy: '' };
    }
    if (row.diagram === undefined) {
      return {
        status: 'deflated',
        revision: row.revision,
        changeNote: row.changeNote,
        publishedAt: row.publishedAt,
        publishedBy: row.publishedBy,
      };
    }
    return {
      status: 'restorable',
      revision: row.revision,
      changeNote: row.changeNote,
      publishedAt: row.publishedAt,
      publishedBy: row.publishedBy,
      contractSchemaVersion: row.contractSchemaVersion,
      diagram: row.diagram,
    };
  },

  'set_receipt_settings_scoped': () => null,

  'get_enabled_features': () => ({ features: ['sales', 'inventory', 'reporting', 'staff', 'settings'] }),
  'get_setting': () => '',
  'set_setting_scoped': () => null,

  'get_user_preferences': () => ({ ...mockUserPrefs }),
  'get_user_preferences_scoped': () => ({ ...mockUserPrefs }),
  'set_user_preferences': (args) => {
    const { prefs } = (args as { prefs?: Array<{ key: string; value: string }> }) ?? {};
    for (const p of prefs ?? []) mockUserPrefs[p.key] = p.value;
    saveMockUserPrefs(mockUserPrefs);
    return null;
  },
  'set_user_preferences_scoped': (args) => {
    const { prefs } = (args as { prefs?: Array<{ key: string; value: string }> }) ?? {};
    for (const p of prefs ?? []) mockUserPrefs[p.key] = p.value;
    saveMockUserPrefs(mockUserPrefs);
    return null;
  },

  'get_hardware_settings': () => ({
    printerConnection: 'usb', printerDevicePath: '', printerPaperSize: '80mm',
    scannerDeviceId: '', scannerInputMode: 'usb',
  }),
  'set_hardware_settings': () => null,
  'set_hardware_settings_scoped': () => null,

  'get_credit_settings': () => ({ enabled: false, reminderIntervalHours: 24, maxLimitMinor: 1000000 }),
  'set_credit_settings': () => null,
  'set_credit_settings_scoped': () => null,
  'list_credit_sales': () => [],
  'list_credit_sales_scoped': () => [],
  'settle_credit': () => null,
  'settle_credit_scoped': () => null,

  'seed_default_roles_scoped': () => 3,

  // ═══════════════════════════════════════════════════════════════
  // SECURITY / ENCRYPTION
  // ═══════════════════════════════════════════════════════════════

  'get_key_rotation_info': () => ({
    last_rotated_at: null,
    rotation_due: false,
    key_algorithm: 'aes-256-gcm',
    can_rotate: true,
  }),
  'rotate_encryption_key': () => ({
    success: true,
    rotated_at: new Date().toISOString(),
    key_algorithm: 'aes-256-gcm',
  }),

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
  'set_brand_primary_colour': () => null,
  'set_brand_logo_path': () => null,
  'set_brand_store_name': () => null,
  'pick_logo_file': () => null,

  // ═══════════════════════════════════════════════════════════════
  // PRODUCTS
  // ═══════════════════════════════════════════════════════════════

  'list_products': () => MOCK_PRODUCTS,
  'list_products_scoped': () => MOCK_PRODUCTS,
  'get_products': () => ({ products: MOCK_PRODUCTS }),
  'search_products': (_args) => ({ products: MOCK_PRODUCTS }),
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
  'get_product_stock': () => ({ quantity: 50 }),

  'adjust_stock': () => 50,
  'adjust_stock_scoped': () => 50,

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

  'hold_cart': (args) => holdMockCart(args),
  'hold_cart_scoped': (args) => holdMockCart(args),
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
    const a = (args as { args?: { lines?: Array<{ lineTotalMinor: number }> } })?.args ?? (args as { lines?: Array<{ lineTotalMinor: number }> }) ?? {};
    const lines = a.lines ?? [];
    const totalMinor = lines.reduce((sum, l) => sum + (l.lineTotalMinor ?? 0), 0);
    return { refundId: `refund-${Date.now()}`, totalMinor };
  },
  'process_refund_scoped': (args) => {
    const a = (args as { args?: { lines?: Array<{ lineTotalMinor: number }> } })?.args ?? (args as { lines?: Array<{ lineTotalMinor: number }> }) ?? {};
    const lines = a.lines ?? [];
    const totalMinor = lines.reduce((sum, l) => sum + (l.lineTotalMinor ?? 0), 0);
    return { refundId: `refund-${Date.now()}`, totalMinor };
  },
  'list_refunds': () => [],
  'list_refunds_scoped': () => [],

  'export_daily_summary': () => [],
  'export_daily_summary_scoped': () => [],
  'export_sales_by_hour': () => [],
  'export_sales_by_hour_scoped': () => [],
  'export_eod_report': () => null,
  'export_eod_report_scoped': () => null,

  'print_sales_receipt': () => ({ printed: true }),
  'print_sales_receipt_scoped': () => ({ printed: true }),

  'get_cart_deduction_location': () => ({ locationId: 'loc-1', locationName: 'Main Store' }),
  'override_cart_deduction_location_scoped': () => null,

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
  // CUSTOMERS
  // ═══════════════════════════════════════════════════════════════

  'list_customers': () => MOCK_CUSTOMERS,
  'list_customers_scoped': () => MOCK_CUSTOMERS,
  'get_customer': (args) => {
    const { id } = args as { id: string };
    return MOCK_CUSTOMERS.find(c => c.id === id) ?? null;
  },
  'create_customer': () => ({ id: 'cust-new', name: 'New Customer', email: null, phone: null, notes: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  'update_customer': () => ({ id: 'cust-upd', name: 'Updated', email: null, phone: null, notes: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  'delete_customer': () => null,

  // ═══════════════════════════════════════════════════════════════
  // STAFF MANAGEMENT
  // ═══════════════════════════════════════════════════════════════

  'list_staff_scoped': () => mockStaffFixtures(),
  'list_roles_scoped': () => mockRoleList(),

  // Args are flat here, not boxed: the real command takes `id` as its own
  // named parameter (list_role_holders_scoped(session_token, id, state)) and
  // api/staff.ts invokes { sessionToken, id }. unwrapArgs tolerates either
  // envelope, so this keeps working if the wrapper is ever boxed.
  'list_role_holders_scoped': (args) => {
    const { id } = unwrapArgs<{ id?: string }>(args);
    return mockRoleHolders(id);
  },

  'list_permission_keys_scoped': () => MOCK_PERMISSION_KEYS.map((k) => ({ ...k })),

  'create_role_scoped': (args) => {
    // mockHandlerPayload, not `args.args`: invoke() hands a handler
    // `args?.['args'] ?? args`, so the envelope is already gone by the time this
    // runs. Reading `.args` here returned undefined, `name` became '', and the
    // handler then threw 'role name must not be empty' on EVERY browser-mode
    // role create — a live-screen failure that looked like operator error.
    const a = mockHandlerPayload<{
      name?: string;
      description?: string;
      permissions?: string[];
    }>(args);
    const name = (a.name ?? '').trim();
    if (!name) throw new Error('role name must not be empty');
    const role: MockAuthoredRole = {
      id: `role-${Date.now()}`,
      name,
      description: a.description ?? '',
      permissions: [...(a.permissions ?? [])],
      is_builtin: false,
      reference_count: 0,
    };
    MOCK_AUTHORED_ROLES.push(role);
    return { ...role };
  },

  'update_role_scoped': (args) => {
    // Same envelope trap as create_role_scoped: without the unwrap, `id` was
    // undefined and the update silently matched no role.
    const a = mockHandlerPayload<{
      id?: string;
      name?: string;
      description?: string;
      permissions?: string[];
    }>(args);
    // Mirrors the backend refusal: a preset row is owned by the seeder.
    if (a.id && MOCK_BUILTIN_ROLE_IDS.has(a.id)) {
      throw new Error(`${a.id} is a built-in preset role and cannot be authored`);
    }
    const role = MOCK_AUTHORED_ROLES.find((r) => r.id === a.id);
    if (!role) throw new Error(`role ${a.id ?? '?'} not found`);
    const name = (a.name ?? '').trim();
    if (!name) throw new Error('role name must not be empty');
    role.name = name;
    role.description = a.description ?? '';
    // Replace, never merge — a grant silently carried over would be a
    // privilege nobody asked for.
    role.permissions = [...(a.permissions ?? [])];
    return { ...role };
  },

  'delete_role_scoped': (raw) => {
    const id = (raw as { id?: string })?.id ?? '';
    if (MOCK_BUILTIN_ROLE_IDS.has(id)) {
      throw new Error(`${id} is a built-in preset role and cannot be deleted`);
    }
    const idx = MOCK_AUTHORED_ROLES.findIndex((r) => r.id === id);
    if (idx < 0) throw new Error(`role ${id} not found`);
    const existing = MOCK_AUTHORED_ROLES[idx];
    if (!existing) throw new Error(`role ${id} not found`);
    if (existing.reference_count > 0) {
      throw new Error(`role ${id} is still referenced; reassign those rows first`);
    }
    MOCK_AUTHORED_ROLES.splice(idx, 1);
    return null;
  },
  'create_staff_scoped': (args) => {
    const a = (args as { username?: string; display_name?: string; role_id?: string; pin?: string }) ?? {};
    const roleId = a.role_id && MOCK_ROLE_PERMISSIONS[a.role_id] ? a.role_id : 'role-staff';
    return mockStaffMember({
      id: `staff-${Date.now()}`,
      username: a.username ?? 'newstaff',
      display_name: a.display_name ?? 'New Staff',
      role_id: roleId,
      role_name: mockRoleName(roleId),
    });
  },
  'update_staff_scoped': (args) => {
    const a = (args as { id?: string; username?: string; display_name?: string; role_id?: string; is_active?: boolean }) ?? {};
    const roleId = a.role_id && MOCK_ROLE_PERMISSIONS[a.role_id] ? a.role_id : 'role-owner';
    return mockStaffMember({
      id: a.id ?? 'staff-1',
      username: a.username ?? 'owner',
      display_name: a.display_name ?? 'Owner',
      role_id: roleId,
      role_name: mockRoleName(roleId),
      is_active: a.is_active ?? true,
    });
  },

  // ═══════════════════════════════════════════════════════════════
  // SHIFTS
  // ═══════════════════════════════════════════════════════════════

  'get_active_shift': () => mockActiveShift,
  'get_active_shift_scoped': () => mockActiveShift,
  'open_shift': () => {
    mockActiveShift = {
      id: 'shift-1', userId: 'user-1', terminalId: null, openedAt: new Date().toISOString(), closedAt: null,
      openingBalanceMinor: 0, closingBalanceMinor: null, expectedCashMinor: null, cashDifferenceMinor: null,
      totalSalesMinor: 0, totalCashMinor: 0, totalCardMinor: 0, totalOtherMinor: 0,
      totalVoidsMinor: 0, totalRefundsMinor: 0, totalPayoutsMinor: 0, notes: '', status: 'open',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    saveMockActiveShift(mockActiveShift);
    return mockActiveShift;
  },
  'open_shift_scoped': () => {
    mockActiveShift = {
      id: 'shift-1', userId: 'user-1', terminalId: null, openedAt: new Date().toISOString(), closedAt: null,
      openingBalanceMinor: 0, closingBalanceMinor: null, expectedCashMinor: null, cashDifferenceMinor: null,
      totalSalesMinor: 0, totalCashMinor: 0, totalCardMinor: 0, totalOtherMinor: 0,
      totalVoidsMinor: 0, totalRefundsMinor: 0, totalPayoutsMinor: 0, notes: '', status: 'open',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    saveMockActiveShift(mockActiveShift);
    return mockActiveShift;
  },
  'close_shift': () => {
    mockActiveShift = null;
    saveMockActiveShift(null);
    const closed: Record<string, unknown> = {
      id: `shift-${mockShiftHistory.length + 1}`, userId: 'user-1', terminalId: null, openedAt: new Date().toISOString(), closedAt: new Date().toISOString(),
      openingBalanceMinor: 100000, closingBalanceMinor: 150000, expectedCashMinor: 150000, cashDifferenceMinor: 0,
      totalSalesMinor: 50000, totalCashMinor: 50000, totalCardMinor: 0, totalOtherMinor: 0,
      totalVoidsMinor: 0, totalRefundsMinor: 0, totalPayoutsMinor: 0, notes: '', status: 'closed',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    mockShiftHistory.push(closed);
    // Persist the closed shift so a reload keeps the reconciliation record.
    saveMockShiftHistory();
    return closed;
  },
  'close_shift_scoped': () => {
    mockActiveShift = null;
    saveMockActiveShift(null);
    const closed: Record<string, unknown> = {
      id: `shift-${mockShiftHistory.length + 1}`, userId: 'user-1', terminalId: null, openedAt: new Date().toISOString(), closedAt: new Date().toISOString(),
      openingBalanceMinor: 100000, closingBalanceMinor: 150000, expectedCashMinor: 150000, cashDifferenceMinor: 0,
      totalSalesMinor: 50000, totalCashMinor: 50000, totalCardMinor: 0, totalOtherMinor: 0,
      totalVoidsMinor: 0, totalRefundsMinor: 0, totalPayoutsMinor: 0, notes: '', status: 'closed',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    mockShiftHistory.push(closed);
    // Persist the closed shift so a reload keeps the reconciliation record.
    saveMockShiftHistory();
    return closed;
  },
  'list_shifts': () => mockShiftHistory,
  'list_shifts_scoped': () => mockShiftHistory,
  'get_shift': () => null,
  'get_shift_report': () => null,
  'create_cash_payout': () => null,

  // ═══════════════════════════════════════════════════════════════
  // INVENTORY
  // ═══════════════════════════════════════════════════════════════

  'create_inventory_location': () => 'loc-new',
  'list_inventory_locations': () => MOCK_INVENTORY_LOCATIONS,
  'update_inventory_location': () => null,
  'deactivate_inventory_location': () => null,

  'set_workspace_inventory_locations': () => null,
  'get_workspace_inventory_locations': () => [],
  'get_workspace_locations_scoped': () => [],
  'invalidate_location_cache_scoped': () => null,
  'get_low_stock_alerts_at_location_scoped': () => [],
  'active_stock_alerts_scoped': () => [],
  'acknowledge_stock_alert_scoped': () => null,

  'start_inventory_shift': () => ({
    id: 'inv-shift-1', user_id: 'user-1', location_id: 'loc-1', terminal_id: null,
    started_at: new Date().toISOString(), ended_at: null, status: 'active', notes: '',
  }),
  'end_inventory_shift': () => null,
  'get_active_inventory_shift': () => null,
  'list_inventory_shifts': () => [],

  'create_inventory_transaction': () => 'txn-new',
  'list_inventory_transactions': () => [],
  'list_inventory_transactions_for_shift': () => [],
  'get_inventory_transaction': () => null,

  'set_stock_threshold': () => null,
  'get_stock_thresholds': () => [],
  'delete_stock_threshold': () => null,

  'finalize_sale': () => null,
  'void_pending_sale': () => null,

  // ═══════════════════════════════════════════════════════════════
  // INVENTORY COUNTS
  // ═══════════════════════════════════════════════════════════════

  'create_stock_count': () => ({ id: 'count-1', count_number: 'SC-001', status: 'draft', count_type: 'full', notes: '', counted_by: null, created_at: new Date().toISOString(), completed_at: null, updated_at: new Date().toISOString() }),
  'get_stock_count': () => null,
  'list_stock_counts': () => [],
  'get_count_lines': () => [],
  'add_count_line': () => null,
  'update_count_line': () => null,
  'remove_count_line': () => null,
  'complete_stock_count': () => [],
  'update_stock_count_status': () => null,
  'list_stock_adjustments': () => [
    { id: 'adj-1', sku: 'CPU-R7-7800X3D', product_name: 'AMD Ryzen 7 7800X3D', qty_change: 5, reason: 'restock', created_at: new Date().toISOString() },
  ],
  'list_stock_adjustments_scoped': () => [
    { id: 'adj-1', sku: 'CPU-R7-7800X3D', product_name: 'AMD Ryzen 7 7800X3D', qty_change: 5, reason: 'restock', created_at: new Date().toISOString() },
  ],

  // ═══════════════════════════════════════════════════════════════
  // STOCK TRANSFERS
  // ═══════════════════════════════════════════════════════════════

  'create_stock_transfer_scoped': () => ({
    id: `mock-trf-${Date.now()}`,
    transfer_number: `TRF-${Date.now().toString(36).toUpperCase()}`,
    status: 'draft',
    source_location: 'Warehouse A',
    destination_location: 'Store B',
    source_terminal_id: null,
    destination_terminal_id: null,
    notes: '',
    created_by: 'admin-1',
    received_by: null,
    created_at: new Date().toISOString(),
    sent_at: null,
    received_at: null,
    updated_at: new Date().toISOString(),
  }),
  'get_stock_transfer_scoped': () => null,
  'list_stock_transfers_scoped': () => [
    { id: 'st-1', transfer_number: 'ST-001', status: 'draft', source_location: 'Warehouse A', destination_location: 'Store B', source_terminal_id: null, destination_terminal_id: null, notes: '', created_by: 'admin-1', received_by: null, created_at: new Date().toISOString(), sent_at: null, received_at: null, updated_at: new Date().toISOString() },
  ],
  'get_stock_transfer_lines_scoped': () => [],
  'add_stock_transfer_line_scoped': () => null,
  'remove_stock_transfer_line_scoped': () => null,
  'send_stock_transfer_scoped': () => null,
  'receive_stock_transfer_scoped': () => null,
  'cancel_stock_transfer_scoped': () => null,

  // ═══════════════════════════════════════════════════════════════
  // KDS
  // ═══════════════════════════════════════════════════════════════

  'list_kds_orders': () => mockKdsOrders,
  'list_kds_orders_scoped': (args: unknown) => {
    let status: string | undefined;
    if (Array.isArray(args)) {
      [, status] = args as [string, string | undefined];
    } else {
      const obj = (args ?? {}) as Record<string, unknown>;
      status = obj['status'] as string | undefined;
    }
    return mockKdsOrders.filter(order => !status || order['status'] === status);
  },
  'get_kds_queue': (args: unknown) => {
    let kdsZone: string | undefined;
    if (Array.isArray(args)) {
      [, kdsZone] = args as [string, string | undefined];
    } else {
      const obj = (args ?? {}) as Record<string, unknown>;
      kdsZone = obj['kdsZone'] as string | undefined;
    }
    return mockKdsOrders.filter(order => !kdsZone || order['kitchen_zone'] === kdsZone);
  },
  'get_kds_queue_scoped': (args: unknown) => {
    let kdsZone: string | undefined;
    if (Array.isArray(args)) {
      [, kdsZone] = args as [string, string | undefined];
    } else {
      const obj = (args ?? {}) as Record<string, unknown>;
      kdsZone = obj['kdsZone'] as string | undefined;
    }
    return mockKdsOrders.filter(order => !kdsZone || order['kitchen_zone'] === kdsZone);
  },
  'update_kds_status': (args) => {
    const { id, status } = (args as { id?: string; status?: string }) ?? {};
    const order = mockKdsOrders.find((o) => o['id'] === id);
    if (order && status) {
      order['status'] = status;
      saveMockKdsState();
      void emit('kds:orders-changed', null);
    }
    return order ?? null;
  },
  'update_kds_status_scoped': (args) => {
    const { id, status } = (args as { id?: string; status?: string }) ?? {};
    const order = mockKdsOrders.find((o) => o['id'] === id);
    if (order && status) {
      order['status'] = status;
      saveMockKdsState();
      void emit('kds:orders-changed', null);
    }
    return order ?? null;
  },
  'create_kds_order_from_sale': () => [],
  'create_kds_order_from_sale_scoped': () => [],
  'get_kds_order': () => null,
  'get_kds_order_scoped': () => null,
  'get_kds_order_lines': (args) => {
    const { id } = (args as { id?: string }) ?? {};
    return (id ? mockKdsLineItems[id] : undefined) ?? [];
  },
  'get_kds_order_lines_scoped': (args) => {
    const { orderId } = (args as { orderId?: string }) ?? {};
    return (orderId ? mockKdsLineItems[orderId] : undefined) ?? [];
  },
  'update_kds_line_item_status': (args) => {
    const { itemId, status } = (args as { itemId?: string; status?: string }) ?? {};
    const item = Object.values(mockKdsLineItems).flat().find((i) => i['id'] === itemId);
    if (item && status) {
      item['item_status'] = status;
      saveMockKdsState();
      void emit('kds:orders-changed', null);
    }
    return item ?? null;
  },
  'update_kds_line_item_status_scoped': (args) => {
    const { itemId, status } = (args as { itemId?: string; status?: string }) ?? {};
    const item = Object.values(mockKdsLineItems).flat().find((i) => i['id'] === itemId);
    if (item && status) {
      item['item_status'] = status;
      saveMockKdsState();
      void emit('kds:orders-changed', null);
    }
    return item ?? null;
  },

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
  'ack_kds_order_scoped': () => true,
  'resolve_kds_targets_scoped': () => [] as string[],
  'generate_kds_pairing_token_scoped': () => ({
    token: `mock-pairing-token-${Date.now()}`,
    expires_at: new Date(Date.now() + 300_000).toISOString(),
  }),
  'print_kds_chit_scoped': () => true,

  // ═══════════════════════════════════════════════════════════════
  // PROMOTIONS
  // ═══════════════════════════════════════════════════════════════

  'list_promotions': () => MOCK_PROMOTIONS,
  'list_promotions_scoped': () => MOCK_PROMOTIONS,
  'get_promotion': () => null,
  'get_promotion_scoped': () => null,
  'create_promotion': () => null,
  'create_promotion_scoped': () => null,
  'update_promotion': () => null,
  'update_promotion_scoped': () => null,
  'delete_promotion': () => null,
  'delete_promotion_scoped': () => null,
  'apply_promotion': () => null,
  'apply_promotion_scoped': () => null,
  'get_sale_promotions': (args) => {
    const raw = (args as { args?: { saleId?: string } })?.args ?? (args as { saleId?: string });
    return mockSalePromotions[raw?.saleId ?? ''] ?? [];
  },
  'get_sale_promotions_scoped': (args) => {
    const raw = (args as { args?: { saleId?: string } })?.args ?? (args as { saleId?: string });
    return mockSalePromotions[raw?.saleId ?? ''] ?? [];
  },

  // ═══════════════════════════════════════════════════════════════
  // PURCHASING / SUPPLIERS
  // ═══════════════════════════════════════════════════════════════

  'list_suppliers': () => [
    { id: 'supplier-1', name: 'PT Teknologi Maju', contact_person: 'Budi', phone: '021-1234567', email: 'budi@teknologi.com', address: 'Jl. Merdeka No. 1', is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: 'supplier-2', name: 'CV Distribusi Utama', contact_person: 'Siti', phone: '021-7654321', email: 'siti@distribusi.com', address: 'Jl. Sudirman No. 45', is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  ],
  'list_suppliers_scoped': () => [
    { id: 'supplier-1', name: 'PT Teknologi Maju', contact_person: 'Budi', phone: '021-1234567', email: 'budi@teknologi.com', address: 'Jl. Merdeka No. 1', is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: 'supplier-2', name: 'CV Distribusi Utama', contact_person: 'Siti', phone: '021-7654321', email: 'siti@distribusi.com', address: 'Jl. Sudirman No. 45', is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  ],
  'get_supplier': () => null,
  'create_supplier': () => null,
  'update_supplier': () => null,
  'get_supplier_scoped': () => null,
  'create_supplier_scoped': () => null,
  'update_supplier_scoped': () => null,
  'list_purchase_orders': () => [
    { id: 'po-1', po_number: 'PO-001', supplier_id: 'supplier-1', supplier_name: 'PT Teknologi Maju', status: 'pending', order_date: new Date().toISOString(), expected_date: new Date(Date.now() + 86400000).toISOString(), received_date: null, subtotal_minor: 5000000, tax_minor: 0, total_minor: 5000000, notes: '', created_by: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), lines: [{ id: 'po-line-1', po_id: 'po-1', sku: 'CPU-R7-7800X3D', product_name: 'AMD Ryzen 7 7800X3D 8-Core', qty: 2, unit_cost_minor: 2500000, line_total_minor: 5000000 }] },
  ],
  'list_purchase_orders_scoped': () => [
    { id: 'po-1', po_number: 'PO-001', supplier_id: 'supplier-1', supplier_name: 'PT Teknologi Maju', status: 'pending', order_date: new Date().toISOString(), expected_date: new Date(Date.now() + 86400000).toISOString(), received_date: null, subtotal_minor: 5000000, tax_minor: 0, total_minor: 5000000, notes: '', created_by: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), lines: [{ id: 'po-line-1', po_id: 'po-1', sku: 'CPU-R7-7800X3D', product_name: 'AMD Ryzen 7 7800X3D 8-Core', qty: 2, unit_cost_minor: 2500000, line_total_minor: 5000000 }] },
  ],
  'get_purchase_order': () => null,
  'create_purchase_order': () => null,
  'update_po_status': () => null,
  'receive_purchase_order': () => null,
  'get_purchase_order_scoped': () => null,
  'create_purchase_order_scoped': () => null,
  'update_po_status_scoped': () => null,
  'receive_purchase_order_scoped': () => null,
  'receive_purchase_order_with_lines_scoped': () => null,

  // ═══════════════════════════════════════════════════════════════
  // REPORTS
  // ═══════════════════════════════════════════════════════════════

  // Seeded with realistic rows (not empty arrays) so dashboard/report
  // charts actually render in browser-mode E2E. The screens guard .length
  // so empty arrays are safe, but the dashboard weekly chart is an empty
  // 0-height div ("hidden") when there are no rows.
  'get_daily_revenue': (args) => {
    const { startDate, endDate } = (args ?? {}) as { startDate?: string; endDate?: string };
    const days = isoDays(startDate ?? '2026-01-01', endDate ?? '2026-01-07');
    return days.map((date, i) => ({
      date,
      total_minor: mockRevenue(i),
      currency: 'IDR',
      sale_count: 6 + (i % 12),
    }));
  },
  'get_weekly_revenue': (args) => {
    const { startDate, endDate } = (args ?? {}) as { startDate?: string; endDate?: string };
    const days = isoDays(startDate ?? '2026-01-01', endDate ?? '2026-01-28');
    // One row per ISO week (Monday start) within the range.
    const weeks = new Map<string, { week_start: string; total_minor: number; sale_count: number }>();
    days.forEach((date, i) => {
      const d = new Date(`${date}T00:00:00`);
      const dow = (d.getDay() + 6) % 7; // Monday = 0
      const monday = new Date(d);
      monday.setDate(d.getDate() - dow);
      const key = monday.toISOString().slice(0, 10);
      const existing = weeks.get(key);
      const total = mockRevenue(i);
      if (existing) {
        existing.total_minor += total;
        existing.sale_count += 1;
      } else {
        weeks.set(key, { week_start: key, total_minor: total, sale_count: 1 });
      }
    });
    return [...weeks.values()].map((w) => ({ ...w, currency: 'IDR' }));
  },
  'get_monthly_revenue': (args) => {
    const { startDate, endDate } = (args ?? {}) as { startDate?: string; endDate?: string };
    const days = isoDays(startDate ?? '2026-01-01', endDate ?? '2026-06-01');
    const months = new Map<string, { month: string; total_minor: number; sale_count: number }>();
    days.forEach((date, i) => {
      const key = date.slice(0, 7); // YYYY-MM
      const total = mockRevenue(i);
      const existing = months.get(key);
      if (existing) {
        existing.total_minor += total;
        existing.sale_count += 1;
      } else {
        months.set(key, { month: key, total_minor: total, sale_count: 1 });
      }
    });
    return [...months.values()].map((m) => ({ ...m, currency: 'IDR' }));
  },
  'get_top_products': (args) => {
    const { orderBy } = (args ?? {}) as { orderBy?: 'revenue' | 'profit' };
    const rows = MOCK_PRODUCTS.slice(0, 5).map((p, i) => {
      const qty = 3 + (i * 7) % 30;
      const total_minor = p.price.minor_units * qty;
      const cogs_minor = (p.cost_minor ?? 0) * qty;
      return {
        product_id: p.sku,
        sku: p.sku,
        name: p.name,
        total_qty: qty,
        total_minor,
        cogs_minor,
        gross_profit_minor: total_minor - cogs_minor,
        gross_margin_percent: total_minor > 0
          ? ((total_minor - cogs_minor) / total_minor) * 100
          : 0,
      };
    });
    return orderBy === 'profit'
      ? rows.sort((a, b) => b.gross_profit_minor - a.gross_profit_minor)
      : rows;
  },
  'get_category_popularity': (args) => {
    const { topPerCategory } = (args ?? {}) as { topPerCategory?: number };
    const top = Math.max(1, Math.min(topPerCategory ?? 3, 20));
    // Deterministic pseudo-scores so the mock preview looks alive: earlier
    // products (higher stock) get higher popularity.
    const scored = MOCK_PRODUCTS.map((p, i) => ({
      sku: p.sku,
      name: p.name,
      category: p.category ?? '',
      popularity_score: Math.round((10 - (i % 10)) * 10) / 10,
    }));
    const byCat = new Map<string, typeof scored>();
    for (const s of scored) {
      const list = byCat.get(s.category) ?? [];
      list.push(s);
      byCat.set(s.category, list);
    }
    const all = scored.map((s) => s.popularity_score);
    const catalogMean = all.length
      ? all.reduce((a, b) => a + b, 0) / all.length
      : 0;
    const rows = [...byCat.entries()].map(([category, items]) => {
      items.sort((a, b) => b.popularity_score - a.popularity_score);
      const mean = items.reduce((s, it) => s + it.popularity_score, 0) / items.length;
      return {
        category_id: category || '',
        category_name: category || null,
        product_count: items.length,
        mean_score: Math.round(mean * 10) / 10,
        catalog_ratio: catalogMean > 0 ? Math.round((mean / catalogMean) * 10) / 10 : 0,
        top_products: items.slice(0, top).map((it, i) => ({
          sku: it.sku,
          name: it.name,
          popularity_score: it.popularity_score,
          rank: i + 1,
          percentile: items.length > 1
            ? Math.round(((items.length - 1 - i) / (items.length - 1)) * 100) / 100
            : 1,
        })),
      };
    });
    rows.sort((a, b) => b.mean_score - a.mean_score);
    return rows;
  },
  'get_category_popularity_trend': (args) => {
    const { startDate, endDate, granularity, topCategories } = (args ?? {}) as {
      startDate?: string;
      endDate?: string;
      granularity?: string;
      topCategories?: number;
    };
    const top = Math.max(1, Math.min(topCategories ?? 5, 10));
    // Reuse the same pseudo-scores as the standings handler, then draw a
    // small rising/falling series per category across the requested range.
    const cats = MOCK_CATEGORIES.slice(0, top).map((c, i) => ({
      id: c.id,
      name: c.name,
      base: 10 - i * 2,
    }));
    const start = new Date(startDate ?? new Date().toISOString().slice(0, 10));
    const end = new Date(endDate ?? start.toISOString().slice(0, 10));
    const step = granularity === 'monthly' ? 30 : granularity === 'weekly' ? 7 : 1;
    const points = [];
    const cursor = new Date(start);
    let guard = 0;
    while (cursor <= end && guard < 60) {
      for (const c of cats) {
        const wave = Math.sin((guard + c.base) / 3) * 2;
        points.push({
          period_start: cursor.toISOString().slice(0, 10),
          category_id: c.id,
          category_name: c.name,
          score: Math.max(0.5, Math.round((c.base + wave) * 10) / 10),
          units_sold: Math.max(0, Math.round(c.base * 3 + wave * 2)),
          distinct_transactions: Math.max(0, Math.round(c.base + wave)),
          searches: Math.max(0, Math.round(c.base / 2)),
          edits: Math.max(0, Math.round(c.base / 4)),
        });
      }
      cursor.setDate(cursor.getDate() + step);
      guard += 1;
    }
    return points;
  },
  'get_category_forecast': (args) => {
    const { startDate, endDate, granularity, topCategories } = (args ?? {}) as {
      startDate?: string;
      endDate?: string;
      granularity?: string;
      topCategories?: number;
    };
    const top = Math.max(1, Math.min(topCategories ?? 5, 10));
    // Forecast from the same pseudo-series as the trend handler: each
    // category's slope over its generated points, projected one period.
    const trend = handlers['get_category_popularity_trend']!({
      startDate,
      endDate,
      granularity,
      topCategories: top,
    }) as Array<{
      category_id: string;
      category_name: string | null;
      units_sold: number;
      score: number;
    }>;
    const byCat = new Map<string, { name: string | null; units: number[] }>();
    for (const p of trend) {
      const e = byCat.get(p.category_id) ?? { name: p.category_name, units: [] };
      e.units.push(p.units_sold);
      byCat.set(p.category_id, e);
    }
    const rows = [...byCat.entries()].map(([category_id, e]) => {
      const units = e.units;
      const n = units.length;
      const avg = n ? units.reduce((a, b) => a + b, 0) / n : 0;
      // Least-squares slope over period indices.
      const meanX = (n - 1) / 2;
      let num = 0;
      let den = 0;
      for (let i = 0; i < n; i++) {
        num += (i - meanX) * (units[i]! - avg);
        den += (i - meanX) * (i - meanX);
      }
      const slope = den > 0 ? num / den : 0;
      const forecast = Math.max(0, Math.round(avg + slope * ((n - 1) / 2)));
      return {
        category_id,
        category_name: e.name,
        forecast_units: n ? forecast : 0,
        trend_per_period: Math.round(slope * 10) / 10,
        recent_avg_units: Math.round(avg * 10) / 10,
      };
    });
    rows.sort((a, b) => b.forecast_units - a.forecast_units);
    return rows;
  },
  'get_hourly_heatmap': () => [0, 3, 5, 8, 11].flatMap((day) =>
    [9, 12, 15, 18].map((hour, i) => ({
      day_of_week: day,
      hour,
      total_minor: mockRevenue(day * 24 + hour) % 3_000_000,
      sale_count: (i * 3) % 14,
    })),
  ),
  'get_low_stock_alerts': () => [
    { product_id: 'RAM-D4-16GB-KF', sku: 'RAM-D4-16GB-KF', name: 'Kingston Fury Beast 16GB DDR4 3200', current_qty: 3, threshold: 10, currency: 'IDR', price_minor: 450000, cost_minor: 390000 },
    { product_id: 'MB-B650-ROG', sku: 'MB-B650-ROG', name: 'ASUS ROG Strix B650-A Gaming WiFi', current_qty: 5, threshold: 10, currency: 'IDR', price_minor: 2850000, cost_minor: 2500000 },
    { product_id: 'SSD-NV2-1TB', sku: 'SSD-NV2-1TB', name: 'Kingston NV2 1TB NVMe SSD', current_qty: 4, threshold: 8, currency: 'IDR', price_minor: 950000, cost_minor: 820000 },
    { product_id: 'PSU-RM750', sku: 'PSU-RM750', name: 'Corsair RM750e 80+ Gold PSU', current_qty: 6, threshold: 10, currency: 'IDR', price_minor: 1850000, cost_minor: 1650000 },
    { product_id: 'GPU-RTX4070', sku: 'GPU-RTX4070', name: 'MSI RTX 4070 Ventus 2X', current_qty: 2, threshold: 5, currency: 'IDR', price_minor: 8900000, cost_minor: 8100000 },
    { product_id: 'CPU-7800X3D', sku: 'CPU-7800X3D', name: 'AMD Ryzen 7 7800X3D', current_qty: 8, threshold: 10, currency: 'IDR', price_minor: 5400000, cost_minor: 4900000 },
  ],
  'get_category_breakdown': () => {
    // Category breakdown feeds the retail-only "Sales by Category" card —
    // filter to retail products so restaurant categories (Hot Drinks, Food)
    // don't leak into the retail view.
    const byCat = new Map<string, { category_id: string | null; category_name: string; total_minor: number; sale_count: number }>();
    MOCK_PRODUCTS.forEach((p, i) => {
      if (p.product_type !== 'retail') return;
      const total = mockRevenue(i) % 4_000_000;
      const existing = byCat.get(p.category);
      if (existing) {
        existing.total_minor += total;
        existing.sale_count += 1;
      } else {
        byCat.set(p.category, { category_id: p.category, category_name: p.category, total_minor: total, sale_count: 1 });
      }
    });
    const rows = [...byCat.values()];
    const grand = rows.reduce((s, r) => s + r.total_minor, 0) || 1;
    return rows.map((r) => ({ ...r, percentage: (r.total_minor / grand) * 100 }));
  },
  'get_menu_engineering': () => {
    // Menu engineering is a restaurant-only card — the mock must return
    // restaurant products, not the retail catalog (which would show CPUs
    // under "Top Menu Items").
    const items = MOCK_PRODUCTS.filter((p) => p.product_type === 'restaurant');
    return {
      rows: items.slice(0, 6).map((p, i) => ({
        product_id: p.sku,
        sku: p.sku,
        name: p.name,
        total_volume: 2 + (i * 5) % 40,
        unit_price_minor: p.price.minor_units,
        unit_cost_minor: Math.floor(p.price.minor_units * 0.6),
        margin_per_unit: Math.floor(p.price.minor_units * 0.4),
        total_margin_minor: Math.floor(p.price.minor_units * 0.4) * (2 + (i * 5) % 40),
        total_revenue_minor: p.price.minor_units * (2 + (i * 5) % 40),
      })),
      median_volume: 15,
      median_margin: 500_000,
    };
  },
  'build_custom_report': () => ({
    rows: [], columns: [], total: 0, page: 1, pageSize: 50, totalPages: 1,
  }),

  // ═══════════════════════════════════════════════════════════════
  // TAX
  // ═══════════════════════════════════════════════════════════════

  'compute_cart_tax_scoped': () => ({ taxMinor: 0, hasExclusive: false }),
  'list_tax_rates_scoped': () => [],
  'create_tax_rate_scoped': () => null,
  'update_tax_rate_scoped': () => null,
  'delete_tax_rate_scoped': () => null,
  'get_tax_rate_dependency_counts_scoped': () => ({ products: 0, categories: 0, sale_lines: 0 }),
  'list_category_tax_rates_scoped': () => [],
  'set_category_tax_rates_scoped': () => null,

  // ═══════════════════════════════════════════════════════════════
  // TABLES (restaurant floor plan)
  // ═══════════════════════════════════════════════════════════════

  // Live snapshot: 5 of 12 active tables occupied → ~42% occupancy for
  // the analytics occupancy card in browser mode.
  'list_tables': () => tablesSnapshot(),
  'list_tables_scoped': () => tablesSnapshot(),
  'get_table': () => null,
  'get_table_scoped': () => null,
  'create_table': () => null,
  'create_table_scoped': () => null,
  'update_table': () => null,
  'update_table_scoped': () => null,
  'delete_table': () => null,
  'delete_table_scoped': () => null,
  'update_table_status': () => null,
  'update_table_status_scoped': () => null,
  'assign_table_order': () => null,
  'assign_table_order_scoped': () => null,
  'release_table': () => null,
  'release_table_scoped': () => null,
  'list_sections': () => [],
  'list_sections_scoped': () => [],

  // ═══════════════════════════════════════════════════════════════
  // LOYALTY
  // ═══════════════════════════════════════════════════════════════

  'get_loyalty_account_scoped': () => null,
  // One seeded account + tiers so the Loyalty screen's real table renders
  // deterministically (the table only exists when accounts.length > 0;
  // otherwise the empty state shows and the E2E races the loading skeleton).
  'list_loyalty_accounts_scoped': () => [
    {
      account: {
        id: 'loyalty-acc-1', customer_id: 'cust-1', points: 250, lifetime_points: 1200,
        tier_id: 'tier-1', updated_at: new Date().toISOString(), created_at: new Date().toISOString(),
      },
      tier: {
        id: 'tier-1', name: 'Gold', min_points: 100, points_per_unit: 1000,
        earn_multiplier_millionths: 1_500_000, colour: '#f59e0b', sort_order: 1, created_at: new Date().toISOString(),
      },
      recent_transactions: [],
      next_tier: null,
      points_to_next_tier: 0,
    },
  ],
  'earn_loyalty_points_scoped': () => null,
  'redeem_loyalty_points_scoped': () => null,
  'list_loyalty_tiers_scoped': () => [
    {
      id: 'tier-1', name: 'Gold', min_points: 100, points_per_unit: 1000,
      earn_multiplier_millionths: 1_500_000, colour: '#f59e0b', sort_order: 1, created_at: new Date().toISOString(),
    },
    {
      id: 'tier-2', name: 'Platinum', min_points: 500, points_per_unit: 1000,
      earn_multiplier_millionths: 2_000_000, colour: '#8b5cf6', sort_order: 2, created_at: new Date().toISOString(),
    },
  ],
  'update_loyalty_tier_scoped': () => null,
  'get_points_value_scoped': () => 0,
  'get_or_create_loyalty_account_scoped': () => null,

  // ═══════════════════════════════════════════════════════════════
  // GIFT CARDS
  // ═══════════════════════════════════════════════════════════════

  'issue_gift_card': () => null,
  'get_gift_card': () => null,
  'list_gift_cards': () => [],
  'get_gift_card_balance': () => null,
  'redeem_gift_card': () => null,
  'top_up_gift_card': () => null,
  'freeze_gift_card': () => null,
  'unfreeze_gift_card': () => null,
  'issue_gift_card_scoped': () => null,
  'get_gift_card_scoped': () => null,
  'list_gift_cards_scoped': () => [],
  'get_gift_card_balance_scoped': () => null,
  'redeem_gift_card_scoped': () => null,
  'top_up_gift_card_scoped': () => null,
  'freeze_gift_card_scoped': () => null,
  'unfreeze_gift_card_scoped': () => null,

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
  'list_scanners': () => [{ id: 'scanner-1' }],
  'list_displays': () => ['display-1', 'display-2'],
  'display_show': () => null,
  'display_clear': () => null,
  'read_scale_weight': () => ({ grams: 150, stable: true }),
  'discover_hardware': () => [],
  'start_scanner': () => null,
  'stop_scanner': () => null,

  // ═══════════════════════════════════════════════════════════════
  // DATA MANAGEMENT
  // ═══════════════════════════════════════════════════════════════

  'get_backup_status': () => ({ lastBackup: null, lastBackupSize: null }),
  'create_backup': () => ({ path: '/backups/backup.db', sizeBytes: 1024 }),
  'export_data': () => ({ path: '/exports/data.ozpkg', sizeBytes: 512, types: ['products'] }),
  'import_preview': () => ({ storeName: 'Test Store', appVersion: pkg.version, exportedAt: new Date().toISOString(), types: ['products'], productCount: 10, categoryCount: 2, saleCount: null, customerCount: null, userCount: null, settingCount: null }),
  'import_data': () => ({ productsImported: 10, categoriesImported: 2, salesImported: 0, customersImported: 0, usersImported: 0, settingsImported: 0 }),

  // ═══════════════════════════════════════════════════════════════
  // AUDIT
  // ═══════════════════════════════════════════════════════════════

  'list_audit_log': () => [],
  // Must return the AuditLogPageDto shape ({ items, total, has_more }) — the
  // screen calls setEntries(page.items), so an array return would make items
  // undefined and crash the render on entries.length (flippy E2E: passes only
  // when the loading skeleton is caught before the crash lands).
  'list_audit_log_scoped': () => {
    const items = mockAuditLogRows();
    return { items, total: items.length, has_more: false };
  },
  // The organization security trail: tenant-global authentications, so these
  // entries name no store. Filtering is honored rather than ignored — the
  // screen's outcome chips and search box are wired to the ARGS, and a mock that
  // returns the same list regardless would preview a filter that does nothing
  // while the real command filters server-side. That is the failure this file's
  // own header warns about: a browser preview that passes while the IPC is wrong.
  //
  // Actions are the seven SECURITY_ACTION_* strings the backend emits, so every
  // row here has a catalog label — including logout and impersonate.*, which are
  // why the action catalog grew three entries alongside this screen.
  'list_security_events_scoped': (args: unknown) => {
    const a = mockAuditFilterArgs(args);
    const securitySeed = [
      { id: 'sec-1', user_id: 'admin-1', action: 'login', target_type: 'session', target_id: 'sess-1', details: 'PIN login', outcome: 'success', created_at: new Date(Date.now() - 90000).toISOString() },
      { id: 'sec-2', user_id: 'cashier-1', action: 'login.failed', target_type: 'session', target_id: 'sess-2', details: 'Wrong PIN', outcome: 'failure', created_at: new Date(Date.now() - 120000).toISOString() },
      { id: 'sec-3', user_id: 'admin-1', action: 'impersonate.start', target_type: 'user', target_id: 'cashier-1', details: 'Support session', outcome: 'success', created_at: new Date(Date.now() - 300000).toISOString() },
      { id: 'sec-4', user_id: 'admin-1', action: 'impersonate.stop', target_type: 'user', target_id: 'cashier-1', details: 'Support session ended', outcome: 'success', created_at: new Date(Date.now() - 400000).toISOString() },
      { id: 'sec-5', user_id: 'admin-1', action: 'user.update', target_type: 'user', target_id: 'cashier-1', details: 'Role changed', outcome: 'success', created_at: new Date(Date.now() - 500000).toISOString() },
      { id: 'sec-6', user_id: 'cashier-1', action: 'logout', target_type: 'session', target_id: 'sess-2', details: 'Lock screen', outcome: 'success', created_at: new Date(Date.now() - 600000).toISOString() },
    ];
    const q = (a.query ?? '').toLowerCase();
    const filtered = securitySeed.filter((e) => {
      if (a.outcome && e.outcome !== a.outcome) return false;
      if (!q) return true;
      return (e.action + ' ' + e.user_id + ' ' + (e.target_id ?? '') + ' ' + e.details).toLowerCase().includes(q);
    });
    return { items: filtered, total: filtered.length, has_more: false };
  },
  // AuditReviewStatusDto is { checkpoint: ReviewCheckpointDto | null, unreviewed_count
  // } — the previous handler had that exact shape, so it was never the type mismatch
  // it was recorded as being. What it could not do is answer a review: the checkpoint
  // was hard-coded null and the count hard-coded 0, so the screen's unreviewed badge
  // and its "Mark reviewed" action could not both be previewed. Now it reads the same
  // in-memory state the mark handler writes.
  'get_audit_review_status_scoped': () => {
    const cp = mockAuditReview.checkpoint;
    return {
      checkpoint: cp,
      unreviewed_count: cp ? 0 : mockAuditLogRows().length,
    };
  },
  // Returns the persisted ReviewCheckpointDto, not null: marking a review always
  // produces one. Args arrive camelCase (MarkAuditReviewedArgs is
  // #[serde(rename_all = "camelCase")]) and the response goes back snake_case — the
  // asymmetry is the real command's, so the mock reproduces it rather than tidying
  // it away, and a screen that reads either side wrongly fails in preview too.
  'mark_audit_reviewed_scoped': (args: unknown) => {
    const a = mockHandlerPayload<{
      reviewedThroughCreatedAt?: string;
      reviewedThroughId?: string;
    }>(args);
    const now = new Date().toISOString();
    const cp: MockReviewCheckpoint = {
      id: 'cp-' + now,
      store_id: 'default',
      reviewer_user_id: 'admin-1',
      reviewed_at: now,
      reviewed_through_created_at: a.reviewedThroughCreatedAt ?? now,
      reviewed_through_id: a.reviewedThroughId ?? '',
    };
    mockAuditReview.checkpoint = cp;
    return cp;
  },
  // AuditExportDto, honoring the filters the screen forwards. The real command also
  // writes an `system.export` audit event into the store log; this mock deliberately
  // does not, so a preview's row_count stays stable across exports rather than
  // growing by one each press.
  'export_audit_log_scoped': (args: unknown) => {
    const f = mockAuditFilterArgs(args);
    const rows = mockAuditLogRows().filter((row) => mockAuditMatches(row, f));
    const header = MOCK_AUDIT_CSV_COLUMNS.join(',');
    const body = rows.map((row) =>
      MOCK_AUDIT_CSV_COLUMNS.map((col) => mockCsvField(String(row[col] ?? ''))).join(','),
    );
    const csv =
      '\uFEFF' + header + '\n' + (body.length > 0 ? body.join('\n') + '\n' : '');
    return {
      csv,
      row_count: rows.length,
      generated_at: new Date().toISOString(),
      requested_by: 'admin-1',
    };
  },

  // ═══════════════════════════════════════════════════════════════
  // OFFLINE / SYNC
  // ═══════════════════════════════════════════════════════════════

  'enqueue_offline': () => null,
  'list_pending_offline': () => [],
  'list_all_offline': () => [],
  'pending_offline_count': () => 0,
  'retry_offline_sync': () => ({ syncedCount: 0, failedCount: 0, totalCount: 0 }),
  'delete_offline_item': () => null,
  'list_remote_failures': () => [],
  'requeue_remote_failure': () => null,

  'get_sync_settings': () => ({ serverUrl: null, hasApiKey: false, enabled: false }),
  'get_sync_settings_scoped': () => ({ serverUrl: null, hasApiKey: false, enabled: false }),
  'update_sync_settings': () => null,
  'sync_run': () => ({ synced: 0, failed: 0, error: null }),
  'offline_queue_status_summary': () => ({ pendingCount: 0, syncedCount: 0, failedCount: 0, conflictCount: 0 }),

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
  'get_deployment_info': (_args) => {
    // Mirrors the real command (category 2 unscoped, gated on settings:read):
    // returns the running build version. The mock cannot read CARGO_PKG_VERSION
    // at runtime, so it mirrors ui/package.json (the single source the real
    // build is bumped from, per the `version` command contract in this file's
    // header) to stay in lockstep with the shipped app.
    return { appVersion: pkg.version };
  },

};

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
handlers['print_kds_chit_scoped'] = () => true;
// HPP exposure: no historical sale lines exist in the mock, so the margin
// report is empty (the UI hides the Cost/Margin columns when it is).
handlers['get_sale_line_margins_scoped'] = () => [];
// Analytics dashboard cards — scoped commands with no unscoped twin.
// Plausible fixed shapes so the analytics grid renders in browser mode
// instead of resolving null and crashing card layouts.
handlers['get_staff_analytics_scoped'] = () => [
  { user_id: 'u1', display_name: 'Rina W.', shift_count: 12, closed_shift_count: 11, shift_sales_minor: 48000000, sale_count: 96, sale_total_minor: 92000000 },
  { user_id: 'u2', display_name: 'Budi S.', shift_count: 11, closed_shift_count: 10, shift_sales_minor: 43000000, sale_count: 88, sale_total_minor: 86000000 },
  { user_id: 'u3', display_name: 'Sari A.', shift_count: 9, closed_shift_count: 9, shift_sales_minor: 38000000, sale_count: 74, sale_total_minor: 74000000 },
  { user_id: 'u4', display_name: 'Andi P.', shift_count: 8, closed_shift_count: 7, shift_sales_minor: 31000000, sale_count: 63, sale_total_minor: 63000000 },
];
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
handlers['update_kds_order_items_scoped'] = (args) => {
  const raw = (args ?? {}) as { id?: string; args?: { id?: string } };
  const id = raw.id ?? raw.args?.id ?? '';
  return mockKdsOrders.find((o) => o['id'] === id) ?? null;
};

// ── Remaining uncovered commands (14 total) ───────────────────────
// Staff profile
handlers['get_staff_profile_scoped'] = (args) => {
  const { userId } = (args ?? {}) as { userId?: string };
  return {
    user_id: userId ?? 'owner-1',
    username: 'owner',
    display_name: 'Owner',
    date_of_birth: '1990-01-15',
    phone: '+628123456789',
    national_id_type: 'nik',
    national_id: null,
    national_id_masked: '****-****-****-1234',
    email: 'owner@example.com',
    monthly_take_home_minor: 5000000,
    emergency_contact_name: 'Spouse',
    emergency_contact_phone: '+628987654321',
    job_title: 'Owner',
    notes: '',
    address: null,
    language: null,
    avatar: null,
    tax_id: null,
    national_id_expires_at: null,
    emergency_contact_relationship: 'spouse',
    hire_date: '2026-01-01',
    is_complete: true,
  };
};

// KDS order item updates (non-scoped)
handlers['update_kds_order_items'] = handlers['update_kds_order_items_scoped'];

// Settings writes (non-scoped + scoped)
handlers['set_setting'] = () => true;
handlers['set_settings'] = () => true;
handlers['set_settings_scoped'] = () => true;

// PG sync
handlers['get_sync_plan'] = () => ({ pushed: 0, pulled: 0, conflicts: 0 });
handlers['get_pg_sync_settings'] = () => ({
  enabled: false, host: '', port: '5432', dbname: '', user: '',
});
handlers['update_pg_sync_settings'] = () => true;
handlers['pg_sync_status'] = () => ({
  running: false, last_error: null, last_sync_at: null,
});
handlers['pg_sync_start'] = () => true;
handlers['pg_sync_stop'] = () => true;

// Analytics daily staff breakdown
handlers['get_staff_analytics_daily_scoped'] = () => [];

// Workspace store listing (multi-store picker)
handlers['list_workspaces_for_store_scoped'] = () => [];

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

/**
 * True when running inside a real Tauri webview (packaged app or `tauri dev`).
 *
 * The mock is aliased in for the dev server, but a real webview provides
 * `window.__TAURI_INTERNALS__` — in that case we MUST delegate to the actual
 * Rust backend instead of serving mock data (the Jul 2026 regression where
 * the unconditional alias shipped mock IPC into production builds).
 */
function hasTauriInternals(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof (window as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } })
        .__TAURI_INTERNALS__?.invoke === 'function'
    );
  } catch {
    return false;
  }
}

// ── General scoped aliasing ───────────────────────────────────────
//
// This replaces SCOPED_ALIASES, a hand-maintained list that had fallen 115 entries behind:
// the ADR #7 migration moved the api layer to the `_scoped` spelling of commands while
// the mock kept registering the unscoped names, so every scoped name outside the curated
// list fell through to `return null` in invoke() below. That fails silently, not loudly —
// the component swallows the null and the test still passes while asserting against the
// failure path, which is the exact defect invokeCoverage.ts documents for hand-written
// mock chains (R36-02). Measured on the tree: 217 calls across 4 commands were landing
// there, including get_hardware_settings_scoped since 1fbcc8a0, so ~78 terminal-hardware
// test invocations were exercising the catch-and-default branch while reading as if the
// DTO had loaded.
//
// So alias by rule instead of by list: any registered command whose name does not already
// end in `_scoped` gets a `_scoped` alias unless one is genuinely registered. This runs
// here, after every registration in the file, so it sees the complete registry — the
// curated loop above ran before the direct stubs and could not have.
//
// It deliberately does NOT invent handlers for names with no base: an unknown command
// must still warn, because keeping the truly-unknown case loud is the whole point.
for (const base of Object.keys(handlers)) {
  if (base.endsWith('_scoped')) continue;
  const scoped = `${base}_scoped`;
  // Bound to a local: `handlers[base]` is `T | undefined` under noUncheckedIndexedAccess,
  // and the guard below narrows `handlers[scoped]`, not this.
  const twin = handlers[base];
  if (twin !== undefined && handlers[scoped] === undefined) {
    handlers[scoped] = twin;
  }
}

/** Mock Tauri invoke — delegates to real IPC in a webview, else mock data. */
export async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
  options?: unknown,
): Promise<T> {
  if (hasTauriInternals()) {
    // Real Tauri webview — pass straight through to the Rust backend.
    // Default args to {} like the real invoke(cmd, args = {}, options).
    return (window as unknown as {
      __TAURI_INTERNALS__: { invoke: (c: string, a?: Record<string, unknown>, o?: unknown) => Promise<T> };
    }).__TAURI_INTERNALS__.invoke(cmd, args ?? {}, options);
  }

  console.log('[TAURI MOCK] invoke:', cmd, args);

  // Small delay to simulate async IPC
  await new Promise((r) => setTimeout(r, 50));

  const handler = handlers[cmd];
  if (handler) {
    return handler(args?.['args'] ?? args) as T;
  }

  console.warn('[TAURI MOCK] Unhandled command:', cmd);
  return null as T;
}

/** Mock convertFileSrc — delegates to real IPC in a webview, else path as-is. */
export function convertFileSrc(path: string, protocol = 'asset'): string {
  if (hasTauriInternals()) {
    return (window as unknown as {
      __TAURI_INTERNALS__: { convertFileSrc: (p: string, pr: string) => string };
    }).__TAURI_INTERNALS__.convertFileSrc(path, protocol);
  }
  return path;
}

export function isTauri(): boolean {
  return hasTauriInternals();
}

export class Resource {}
export class Channel {}
