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
import {
  MOCK_LOGIN_ATTEMPTS_KEY,
  MOCK_TOPOLOGY_KEY,
  MOCK_TOPOLOGY_REVISIONS_KEY,
  MOCK_USER_PREFS_KEY,
  MOCK_WORKSPACES_KEY,
  readSlice,
  writeSlice,
} from './core/mockDatabase';
import {
  MOCK_STAFF,
  MOCK_STORE,
  MOCK_WORKSPACES_SEED,
} from './core/mockSeedData';
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
import { MOCK_ROLE_PERMISSIONS, mockHandlerPayload, systemHandlers } from './handlers/system';
import { floorplanHandlers } from './handlers/floorplan';
import { MOCK_CUSTOMERS, crmHandlers } from './handlers/crm';

// The mock's public surface is the three names the app actually imports through
// the vite alias on `@tauri-apps/api/core`. They are defined by the dispatcher
// and re-exported here so the alias target keeps answering for all of them.
export { convertFileSrc, invoke, isTauri };

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

/**
 * Session-local KDS ticket prefixes, keyed by location id. The mock profile
 * type is deliberately not widened (ui/src/api still exposes no such field);
 * an absent entry means '' — the core's no-prefix sentinel.
 */
const mockTicketPrefixes = new Map<string, string>();

/** Normalize exactly as oz_core's ticket-prefix setter does: trim + upper. */
function normalizeMockTicketPrefix(raw: string | undefined): string {
  return (raw ?? '').trim().toUpperCase();
}

/** Read a location's mock ticket prefix; '' resolves to null, as core does. */
function getMockLocationTicketPrefix(args: unknown): string | null {
  const { id } = unwrapArgs<{ id?: string }>(args);
  return normalizeMockTicketPrefix(mockTicketPrefixes.get(id ?? '')) || null;
}

/**
 * Set a location's mock ticket prefix and echo the normalized value back,
 * mirroring the real command so the UI sees post-normalization text, not
 * what was typed. Unknown ids throw — the real IPC returns NotFound.
 */
function setMockLocationTicketPrefix(args: unknown): string | null {
  const { id, prefix } = unwrapArgs<{ id?: string; prefix?: string }>(args);
  const key = id ?? '';
  if (!mockStores.some((location) => location.id === key)) {
    throw new Error(`location ${key} not found`);
  }
  const normalized = normalizeMockTicketPrefix(prefix);
  mockTicketPrefixes.set(key, normalized);
  return normalized || null;
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

/** Mutable Legal Entity list backing the dev mock — creates and updates
 *  persist for the session exactly like the real DB (dev preview parity). */
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
    mockStores.find((loc) => loc.id === workspaceId) ?? mockStores[0] ?? MOCK_STORE;
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
    mockStores.find((loc) => loc.id === workspaceId) ?? mockStores[0] ?? MOCK_STORE;
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


function loadMockWorkspaces(): typeof MOCK_WORKSPACES_SEED {
  return readSlice(MOCK_WORKSPACES_KEY, () => MOCK_WORKSPACES_SEED);
}
function saveMockWorkspaces(): void {
  writeSlice(MOCK_WORKSPACES_KEY, mockWorkspaces);
}
const mockWorkspaces: typeof MOCK_WORKSPACES_SEED = loadMockWorkspaces();

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
function loadMockLoginAttempts(): Record<string, number> {
  return readSlice(MOCK_LOGIN_ATTEMPTS_KEY, () => ({}));
}
function saveMockLoginAttempts(): void {
  writeSlice(MOCK_LOGIN_ATTEMPTS_KEY, loginAttempts);
}
const loginAttempts: Record<string, number> = loadMockLoginAttempts();
const LOCKOUT_THRESHOLD = 4;
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
function loadMockUserPrefs(): Record<string, string> {
  return readSlice(MOCK_USER_PREFS_KEY, () => ({}));
}
function saveMockUserPrefs(prefs: Record<string, string>): void {
  writeSlice(MOCK_USER_PREFS_KEY, prefs);
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
  return readSlice(MOCK_TOPOLOGY_KEY, () => MOCK_TOPOLOGY_SEED);
}
function saveMockTopology(topology: MockTopology): void {
  writeSlice(MOCK_TOPOLOGY_KEY, topology);
}
const mockTopology: MockTopology = loadMockTopology();

// ── Topology revision history (ADR #46) ───────────────────────
//
// The dev-mock mirrors the backend's append-only history so the version
// browser is reachable without a running desktop client. It also mirrors
// §4's DEFlation rule, not just the append — otherwise `restorable: false`
// is unreachable in the browser and the "record only — snapshot pruned"
// state the real sweep produces can never be exercised during development.
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
  return readSlice(MOCK_TOPOLOGY_REVISIONS_KEY, () => []);
}

function saveMockTopologyRevisions(rows: MockTopologyRevision[]): void {
  writeSlice(MOCK_TOPOLOGY_REVISIONS_KEY, rows);
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

const entryHandlers: Record<string, MockHandler> = {
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

  // ═══════════════════════════════════════════════════════════════
  // BOOT / SETUP
  // ═══════════════════════════════════════════════════════════════

  'resolve_boot_store': () => ({
    is_bound: true,
    store_id: 'store-1',
    instance_id: 'ws-1',
  }),

  // ═══════════════════════════════════════════════════════════════
  // SYSTEM / PING
  // ═══════════════════════════════════════════════════════════════

  'ping': () => 'pong',
  'get_local_ip': () => '192.168.1.100',

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
  'get_device_id': () => 'mock-device-id-001',
  'activate_license': () => true,
  'renew_license': () => true,

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
  'list_all_workspaces_scoped': () => [
    { key: 'store-pos', name: 'Store POS', description: 'Point of Sale', icon: 'shopping-cart' },
    { key: 'restaurant-pos', name: 'Restaurant POS', description: 'Table service', icon: 'restaurant' },
    { key: 'kds', name: 'Kitchen Display', description: 'Order display', icon: 'utensils' },
    { key: 'warehouse', name: 'Warehouse', description: 'Product and stock management', icon: 'package' },
    { key: 'admin', name: 'Admin', description: 'Settings & management', icon: 'settings' },
  ],
  'get_user_workspace_instances_scoped': () => [],
  'set_user_workspace_instances_scoped': () => null,
  'ping_terminal': () => null,
  'ping_terminal_scoped': () => null,
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

  'seed_default_roles_scoped': () => 3,

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
  'generate_kds_pairing_token_scoped': () => ({
    token: `mock-pairing-token-${Date.now()}`,
    expires_at: new Date(Date.now() + 300_000).toISOString(),
  }),
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
