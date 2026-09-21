/**
 * Dev-mock handlers — System & Platform domain.
 *
 * Bootstrap, organizations, subscriptions, features, branding, document
 * numbers, fiscal schemes, hardware, backup, audit, offline queue, and
 * deployment. Extracted from  by the agent-4 work order
 * (, phase 4.4).
 *
 * Self-contained:  and  are duplicated here
 * to avoid an import cycle with the router.
 */

import type { MockHandler } from '../core/mockDispatcher';
import pkg from '../../../package.json';

function unwrapArgs<T extends Record<string, unknown> = Record<string, unknown>>(args: unknown): T {
  return ((args as Record<string, unknown>)?.['args'] ?? args ?? {}) as T;
}


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

// -- Mock statutory number series (W2-B: management half of the landed
//    fiscal core; claim_statutory_number_for_sale stays internal) ------

interface MockDocSequence {
  id: string;
  legalEntityId: string;
  documentKind: string;
  prefix: string;
  currentValue: number;
  resetPeriod: string;
  periodKey: string;
  padding: number;
  createdAt: string;
  updatedAt: string;
}

const mockDocSequences = new Map<string, MockDocSequence>();
let mockDocSeq = 0;
const MOCK_RESET_PERIODS = ["never", "daily", "monthly", "yearly"];

function mockDocKey(legalEntityId: string, documentKind: string): string {
  return legalEntityId + "|" + documentKind;
}

/** Read one series (null when the pair is unconfigured — the honest "no
 *  statutory numbering" answer). */
function getMockDocumentNumberSequence(args: unknown): MockDocSequence | null {
  const a = unwrapArgs<{ legalEntityId?: string; documentKind?: string }>(args);
  return mockDocSequences.get(mockDocKey(a.legalEntityId ?? "", a.documentKind ?? "")) ?? null;
}

/** Upsert one series: validates reset period + padding like the core, and
 *  NEVER touches current_value on reconfiguration (a statutory series
 *  must not gap). */
function upsertMockDocumentNumberSequence(args: unknown): null {
  const a = unwrapArgs<{
    legalEntityId?: string;
    documentKind?: string;
    prefix?: string;
    resetPeriod?: string;
    padding?: number;
  }>(args);
  const entity = a.legalEntityId ?? "";
  const kind = a.documentKind ?? "";
  const resetPeriod = a.resetPeriod ?? "";
  if (!MOCK_RESET_PERIODS.includes(resetPeriod)) {
    throw new Error("reset_period must be never, daily, monthly or yearly; got " + resetPeriod);
  }
  if ((a.padding ?? 0) < 0) {
    throw new Error("padding must not be negative, got " + (a.padding ?? 0));
  }
  const key = mockDocKey(entity, kind);
  const existing = mockDocSequences.get(key);
  if (existing != null) {
    existing.prefix = a.prefix ?? "";
    existing.resetPeriod = resetPeriod;
    existing.padding = a.padding ?? 0;
    existing.updatedAt = new Date().toISOString();
    return null;
  }
  mockDocSeq += 1;
  const now = new Date().toISOString();
  mockDocSequences.set(key, {
    id: "doc-seq-" + mockDocSeq,
    legalEntityId: entity,
    documentKind: kind,
    prefix: a.prefix ?? "",
    currentValue: 0,
    resetPeriod,
    periodKey: resetPeriod === "never" ? "" : now.slice(0, 7),
    padding: a.padding ?? 0,
    createdAt: now,
    updatedAt: now,
  });
  return null;
}

/** Session-local mock fiscal schemes (camelCase, mirroring the real
 *  client's serde — the 2be251ce2 snake/camel read-bug lesson). */
interface MockFiscalScheme {
  id: string;
  legalEntityId: string;
  schemeCode: string;
  name: string;
  parameters: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const mockFiscalSchemes: MockFiscalScheme[] = [
  {
    id: "scheme-1",
    legalEntityId: "default:default-legal-entity",
    schemeCode: "id-faktur-pajak",
    name: "Faktur Pajak",
    parameters: "{}",
    isActive: true,
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
  },
];

/** List all series, ordered (legalEntityId, documentKind) like the core. */
function listMockDocumentNumberSequences(args: unknown): MockDocSequence[] {
  void args;
  return [...mockDocSequences.values()].sort((a, b) =>
    a.legalEntityId === b.legalEntityId
      ? a.documentKind.localeCompare(b.documentKind)
      : a.legalEntityId.localeCompare(b.legalEntityId),
  );
}

/** One entity's series, ordered by document kind. */
function listMockDocumentNumberSequencesForEntity(args: unknown): MockDocSequence[] {
  const a = unwrapArgs<{ legalEntityId?: string }>(args);
  const entity = a.legalEntityId ?? "";
  return listMockDocumentNumberSequences(args).filter(
    (s) => s.legalEntityId === entity,
  );
}

/** All schemes, ordered (legalEntityId, schemeCode); inactive included. */
function listMockFiscalSchemes(args: unknown): MockFiscalScheme[] {
  void args;
  return [...mockFiscalSchemes].sort((a, b) =>
    a.legalEntityId === b.legalEntityId
      ? a.schemeCode.localeCompare(b.schemeCode)
      : a.legalEntityId.localeCompare(b.legalEntityId),
  );
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

export const systemHandlers: Record<string, MockHandler> = {

  // Local-IP banner for the boot/setup screen — moved verbatim from
  // `tauri-api.ts`'s entryHandlers literal (Phase 5.5): a pure self-contained
  // string stub, single-defined (git grep; other matches were prose). Home =
  // system, since it is a system/boot read.
  'get_local_ip': () => '192.168.1.100',

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

  // L194 (saas-3): multi-org switching (device-local) org enumeration + re-auth.
  // Mirrors staff_login / create_session so the browser dev preview can exercise
  // the org picker and switch flow without a real backend.
  'list_organizations': () => ([
    { id: 'default', name: 'Default Organization' },
  ]),

  'switch_organization': (args) => {
    const a = args as { sessionToken: string; orgId: string; pin: string };
    return {
      session_token: 'mock-session-' + Date.now(),
      context: {
        userId: 'owner-1',
        roleId: 'role-owner',
        storeId: 'store-1',
        instanceId: 'inst-1',
        typeKey: 'organization',
        terminalId: 'term-1',
        orgLabel: a.orgId,
      },
    };
  },

  // ADR #56 §2.1: the mock reports a PROVISIONED terminal so the dev shell
  // routes to a session rather than the first-run flow. `provision_device`
  // echoes what it was asked to create, matching the real command's idempotent
  // read-back shape.
  'get_first_run_state': () => ({
    state: 'provisioned',
    location_id: 'loc-1',
    owner_user_id: 'user-1',
    mode: 'local',
    home_region: 'global',
    tenant_id: null,
  }),
  'provision_device': (a: unknown) => {
    const args = (a as { args?: Record<string, unknown> })?.args ?? {};
    return {
      terminal_id: (args['terminal_id'] as string) ?? 'term-1',
      location_id: 'loc-1',
      owner_user_id: 'user-1',
      created: true,
      mode: (args['mode'] as string) ?? 'local',
      home_region: 'global',
    };
  },

  'version': () => ({ name: 'oz-pos', version: pkg.version, rustVersion: '1.80', target: 'x86_64' }),
  'version_scoped': () => ({ name: 'oz-pos', version: pkg.version, rustVersion: '1.80', target: 'x86_64' }),

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
  'get_machine_id': () => 'mock-machine-id-001',
  'get_hardware_fingerprint': () => 'hw_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
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
    status: 'active',
    state: 'active',
    // C+D-RES-1: trial state + feature-grant map ride the caps payload.
    // The mock tenant is a paid premium subscription: not a trial, no
    // payload feature overrides - exactly the null/empty-when-absent
    // shape the api-subscription-contract test pins (no invented defaults).
    isTrial: false,
    trialEndsAt: null,
    features: {},
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
    expiresAt: null,
    graceUntil: null,
    isExpired: false,
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
  'get_enabled_features': () => ({ features: ['sales', 'inventory', 'reporting', 'staff', 'settings'] }),

  // ═══════════════════════════════════════════════════════════════
  // SECURITY / ENCRYPTION
  // ═══════════════════════════════════════════════════════════════

  'get_key_rotation_info': () => ({
    last_rotated_at: null,
    rotation_due: false,
    key_algorithm: 'aes-256-gcm',
    can_rotate: true,
  }),

  // Key rotation is answerable ONLY under its gated name. The unscoped
  // `rotate_encryption_key` command was deleted (it was an ungated write -- see
  // `ui/src/api/security.ts:31` and the three closed cases at
  // `ui/src/__tests__/api-security-contract.test.ts:38-44`), but this file still
  // carried a handler for it, which the scoped-alias rule then copied onto
  // `rotate_encryption_key_scoped` -- the name the desktop actually registers
  // (`apps/desktop-tauri/src/lib.rs:1151`). Answering the dead name is what kept
  // the live one working in dev, so the handler moves here instead of being dropped:
  // a mock that fakes success for a command deleted as a bypass is a resurrection
  // hazard, and a mock that goes silent on the surviving gated command is the T5-5
  // failure all over again. No UI code names either yet ("key rotation has no front
  // door, which is the point"), so nothing regresses either way -- the shape chosen
  // here is the one that is true about which command exists.
  'rotate_encryption_key_scoped': () => ({
    success: true,
    rotated_at: new Date().toISOString(),
    key_algorithm: 'aes-256-gcm',
  }),
  'set_brand_primary_colour': () => null,
  'set_brand_logo_path': () => null,
  'set_brand_store_name': () => null,
  'pick_logo_file': () => null,
  // Tax rates → `handlers/catalog.ts` (phase 2.1).
  'get_document_number_sequence_scoped': getMockDocumentNumberSequence,
  'upsert_document_number_sequence_scoped': upsertMockDocumentNumberSequence,
  'list_document_number_sequences_scoped': listMockDocumentNumberSequences,
  'list_document_number_sequences_for_entity_scoped': listMockDocumentNumberSequencesForEntity,
  'list_fiscal_schemes_scoped': listMockFiscalSchemes,
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
  'export_data': () => ({ path: '/exports/data.kasirpkg', sizeBytes: 512, types: ['products'] }),
  'export_data_without_session': () => ({ path: '/exports/data.kasirpkg', sizeBytes: 512, types: ['products'] }),
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

  // Security-event export (ruling D61-7 / design D84): the SAME AuditExportDto
  // shape as export_audit_log_scoped, but restricted to the SECURITY_ACTIONS
  // allowlist (audit_security.rs:82-91) and honoring the exact actor plus
  // inclusive-from/exclusive-to date bounds. Date normalization to fixed-width
  // ISO bounds happens at the real IPC layer; comparing the YYYY-MM-DD prefix
  // of created_at mirrors that normalization's observable effect. No
  // security-action rows are seeded, so a fresh preview exports the header
  // only — the shape, not the row census, is what this handler pins. The
  // system.export self-audit row is deliberately not appended (same rationale
  // as the AUD-09 mock above).
  'export_security_events_scoped': (args: unknown) => {
    const f = mockHandlerPayload<{ actor?: string | null; dateFrom?: string | null; dateTo?: string | null }>(args);
    const securityActions = new Set([
      'login', 'login.failed', 'logout', 'user.create', 'user.update',
      'impersonate.start', 'impersonate.stop', 'org.switch',
    ]);
    const rows = mockAuditLogRows().filter((row) => {
      if (!securityActions.has(row.action)) return false;
      if (f.actor && row.user_id !== f.actor) return false;
      const day = row.created_at.slice(0, 10);
      if (f.dateFrom && day < f.dateFrom) return false;
      if (f.dateTo && day >= f.dateTo) return false;
      return true;
    });
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
  'delete_offline_item': () => null,
  'list_remote_failures': () => [],
  'requeue_remote_failure': () => null,
  'offline_queue_status_summary': () => ({ pendingCount: 0, syncedCount: 0, failedCount: 0, conflictCount: 0 }),
  'get_deployment_info': (_args) => {
    // Mirrors the real command (category 2 unscoped, gated on settings:read):
    // returns the running build version. The mock cannot read CARGO_PKG_VERSION
    // at runtime, so it mirrors ui/package.json (the single source the real
    // build is bumped from, per the `version` command contract in this file's
    // header) to stay in lockstep with the shipped app.
    return { appVersion: pkg.version };
  },
};

export { MOCK_ROLE_PERMISSIONS, mockHandlerPayload };
