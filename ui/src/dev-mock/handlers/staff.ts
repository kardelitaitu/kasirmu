/**
 * Dev-mock handlers — Staff domain.
 *
 * Staff profiles, authentication, roles, permissions, sessions, and PIN
 * verification. Extracted from `tauri-api.ts` by the agent-3 work order
 * (`todo-refactor-devmock-agents-3.md`, phase 3.1).
 *
 * Self-contained: `unwrapArgs` is duplicated here to avoid an import cycle.
 */

import type { MockHandler } from '../core/mockDispatcher';
import { MOCK_STAFF } from '../core/mockSeedData';
import { MOCK_LOGIN_ATTEMPTS_KEY, MOCK_USER_PREFS_KEY, readSlice, writeSlice } from '../core/mockDatabase';
import { MOCK_ROLE_PERMISSIONS, mockHandlerPayload } from './system';
import {
  MOCK_TOPOLOGY_REVISION_KEEP,
  mockTopologyRevisions,
  saveMockTopologyRevisions,
} from './topology-state';

function unwrapArgs<T extends Record<string, unknown> = Record<string, unknown>>(args: unknown): T {
  return ((args as Record<string, unknown>)?.['args'] ?? args ?? {}) as T;
}

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

function loadMockLoginAttempts(): Record<string, number> {
  return readSlice(MOCK_LOGIN_ATTEMPTS_KEY, () => ({}));
}
function saveMockLoginAttempts(): void {
  writeSlice(MOCK_LOGIN_ATTEMPTS_KEY, loginAttempts);
}
const loginAttempts: Record<string, number> = loadMockLoginAttempts();
const LOCKOUT_THRESHOLD = 4;

function loadMockUserPrefs(): Record<string, string> {
  return readSlice(MOCK_USER_PREFS_KEY, () => ({}));
}
function saveMockUserPrefs(prefs: Record<string, string>): void {
  writeSlice(MOCK_USER_PREFS_KEY, prefs);
}
const mockUserPrefs: Record<string, string> = loadMockUserPrefs();

export const staffHandlers: Record<string, MockHandler> = {
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

  // The picker-ticket refresh. The key is `picker_ticket` (snake) on purpose:
  // `RefreshPickerTicketResult` in `crates/kasirmu-bridge/src/auth.rs` carries no
  // `rename_all`, and `ui/src/api/staff.ts:556` declares the same snake key --
  // a camelCase mock here would agree with itself and disagree with both shells.
  'refresh_picker_ticket': () => ({ picker_ticket: 'mock-picker-ticket' }),


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
  // SYSTEM / PING
  // ═══════════════════════════════════════════════════════════════

  'ping': () => 'pong',
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
  'get_user_workspace_instances_scoped': () => [],
  'set_user_workspace_instances_scoped': () => null,
  'ping_terminal': () => null,
  'ping_terminal_scoped': () => null,
  // The editor's Apply flow now confirms the operator PIN first (round 148).
  // The dev-mock accepts any PIN so the real Apply chain stays reachable in
  // the editor's integration tests.
  'verify_pin': () => true,

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

  'seed_default_roles_scoped': () => 3,

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
  'get_staff_analytics_scoped': () => [
  { user_id: 'u1', display_name: 'Rina W.', shift_count: 12, closed_shift_count: 11, shift_sales_minor: 48000000, sale_count: 96, sale_total_minor: 92000000 },
  { user_id: 'u2', display_name: 'Budi S.', shift_count: 11, closed_shift_count: 10, shift_sales_minor: 43000000, sale_count: 88, sale_total_minor: 86000000 },
  { user_id: 'u3', display_name: 'Sari A.', shift_count: 9, closed_shift_count: 9, shift_sales_minor: 38000000, sale_count: 74, sale_total_minor: 74000000 },
  { user_id: 'u4', display_name: 'Andi P.', shift_count: 8, closed_shift_count: 7, shift_sales_minor: 31000000, sale_count: 63, sale_total_minor: 63000000 },
],

  'get_staff_profile_scoped': (args) => {
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
},

  'get_staff_analytics_daily_scoped': () => [],

  // Avatars. The real pipeline sniffs, transcodes, hashes and writes in Rust,
  // so there is nothing to mock beyond the return shape: a 16-hex-char
  // content hash. `ProductThumb` resolves that hash against the app cache
  // dir, which the dev server cannot provide, so it falls back to the
  // initials tile either way — the mock keeps the IPC contract honest rather
  // than pretending to render a photo.
  'set_avatar_scoped': () => '0123456789abcdef',
  'clear_avatar_scoped': () => undefined,
  'get_own_avatar_scoped': () => null,
};
