/*
last audited 31-08-26 by RSA-Agent (user-role campaign, Section H)
findings: clean IPC contract — every call through loggedInvoke (no direct invoke), scoped args carry sessionToken only (no forgeable caller_user_id), identity masked by default (ADR #35 D6), quota rejection surfaced as typed subscriptionLimitExceeded subKind, RoleDto permissions documented display-only
next: batch into the fix-order phase | perf: n/a (presentational)
*/
// ── Staff: Login, Bootstrap, CRUD ──────────────────────────────────

import { loggedInvoke } from '@/utils/logged-invoke';
import { appErrorSubKind, parseAppError } from '@/utils/app-error';

// ── Auth ──────────────────────────────────────────────────────────

/** Arguments for staff login with PIN. */
export interface StaffLoginArgs {
  username: string;
  pin: string;
  /** Optional device/terminal id for per-device abuse controls (STAFF-07). */
  device_id?: string;
}

/** A login session with user and role info. */
export interface LoginSessionDto {
  user_id: string;
  display_name: string;
  role_name: string;
  role_id: string;
  /**
   * Permission keys granted by the user's role, verbatim from the backend
   * registry (may include the `*` wildcard — use `hasGrantedPermission`
   * rather than a raw `includes` check). UI gates mirror the backend
   * instead of role-name strings.
   */
  permissions: string[];
}

/** Result of a successful staff login. */
export interface StaffLoginResult {
  session: LoginSessionDto;
  /**
   * Short-lived ticket for the pre-session workspace picker (audit-open-findings).
   * Passed to listWorkspaces / listWorkspaceScreens until createSession
   * returns the opaque session token.
   */
  picker_ticket: string;
}

/** Arguments for checking if a username exists. */
export interface CheckUsernameArgs {
  username: string;
}

/**
 * Result of the uniform username pre-check (STAFF-06).
 *
 * Always `{ proceed: true }` — the pre-check never reveals whether an
 * account exists or is active, so it cannot be used to enumerate staff.
 */
export interface CheckUsernameResult {
  proceed: boolean;
}

/** Check if a username exists and is active before proceeding to PIN. */
export const checkUsername = (args: CheckUsernameArgs): Promise<CheckUsernameResult> =>
  loggedInvoke<CheckUsernameResult>('staff_check_username', { args });

/** Authenticate a staff member with username and PIN. */
export const staffLogin = (args: StaffLoginArgs): Promise<StaffLoginResult> =>
  loggedInvoke<StaffLoginResult>('staff_login', { args });

/** Result of the `has_users` pre-auth check. */
export interface HasUsersResult {
  has_users: boolean;
}

/** Check whether any staff accounts exist (pre-auth, no details exposed). */
export const hasUsers = (): Promise<HasUsersResult> =>
  loggedInvoke<HasUsersResult>('has_users');

// ── Bootstrap (first-owner, no auth required) ─────────────────────

/** Arguments for bootstrapping the first owner account. */
export interface BootstrapOwnerArgs {
  username: string;
  pin: string;
  display_name: string;
}

/** Result of bootstrapping the first owner account. */
export interface BootstrapOwnerResult {
  session: LoginSessionDto;
  /** Short-lived ticket for the pre-session workspace picker (audit-open-findings). */
  picker_ticket: string;
}

/**
 * Create the first owner user in a fresh installation.
 *
 * Only succeeds when no staff accounts exist yet. Seeds default roles
 * automatically and returns a login session so the front-end can
 * auto-login immediately.
 */
export const bootstrapOwner = (args: BootstrapOwnerArgs): Promise<BootstrapOwnerResult> =>
  loggedInvoke<BootstrapOwnerResult>('bootstrap_owner', { args });

// ── Staff Management ──────────────────────────────────────────────

/**
 * A user's single effective assignment (ADR #35 D5 / spec 0048 + ADR #47):
 * scope mode, the per-dimension explicit-all flags and lists, and the
 * resource axis. Empty lists never mean "all" — the `*_all` flags are the
 * explicit marker, so `list` with no ids is a deny. Legacy users without an
 * assignment row resolve as global all/all organization.
 */
export interface AssignmentDto {
  scope_mode: 'global' | 'scoped';
  /** Branch dimension is explicit `all`. */
  branches_all: boolean;
  /** Branch ids in scope when `branches_all` is false. */
  branch_ids: string[];
  /** Workspace dimension is explicit `all`. */
  workspaces_all: boolean;
  /** Workspace keys in scope when `workspaces_all` is false. */
  workspace_keys: string[];
  /** ADR #47 resource axis: which resource kind the assignment covers. */
  scope_type: 'organization' | 'legal_entity' | 'location';
  /** The resource id when the axis is not `organization`. */
  scope_id: string | null;
}

/**
 * The assignment scope carried by the staff create/edit IPC args (ADR #35
 * D5 / spec 0048 + ADR #47). Mirrors `AssignmentDto`; `scope_type`/`scope_id`
 * are optional — omitting them keeps the org-wide default.
 */
export interface AssignmentArgs {
  scope_mode: 'global' | 'scoped';
  branches_all: boolean;
  branch_ids: string[];
  workspaces_all: boolean;
  workspace_keys: string[];
  /** ADR #47 resource axis; omit (or `organization`) for org-wide. */
  scope_type?: 'organization' | 'legal_entity' | 'location';
  /** Required when `scope_type` is `legal_entity` or `location`. */
  scope_id?: string;
}

/** A staff member record. */
export interface StaffMemberDto {
  id: string;
  username: string;
  display_name: string;
  role_id: string;
  role_name: string;
  is_active: boolean;
  /** National id rendered last-4 masked (ADR #35 D6) — the full value never
   * appears in the list payload. */
  national_id_masked: string;
  /** Whether all 8 required profile fields are present — incomplete users
   * are flagged and management-role assignment is gated on this. */
  is_profile_complete: boolean;
  /** The user's single effective assignment (ADR #35 D5 / spec 0048). */
  assignment: AssignmentDto;
}

/**
 * ADR #35 D6 profile fields carried by the staff create/edit IPC args. All
 * optional on the wire — the form enforces the 9 required fields locally
 * with field-level errors before submission, and the backend validates
 * again at creation.
 */
export interface ProfileArgs {
  date_of_birth?: string;
  phone?: string;
  national_id_type?: string;
  national_id?: string;
  email?: string;
  monthly_take_home_minor?: number;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  job_title?: string;
  notes?: string;
  address?: string;
  language?: string;
  avatar?: string;
  tax_id?: string;
  national_id_expires_at?: string;
  emergency_contact_relationship?: string;
  hire_date?: string;
}

/**
 * A staff profile as seen by the caller (ADR #35 D6): full sensitive values
 * only when the explicit grants are held, national id always last-4 masked,
 * reads audited by the backend.
 */
export interface ProfileViewDto extends ProfileArgs {
  user_id: string;
  username: string;
  display_name: string;
  national_id_masked: string;
  is_complete: boolean;
}

/** A role definition with display name, description, and granted keys. */
export interface RoleDto {
  id: string;
  name: string;
  description: string;
  /**
   * Granted permission keys, verbatim from the role's permissions JSON
   * (may include the `*` wildcard — display as-is, do not gate on it).
   */
  permissions: string[];
  /**
   * Whether the preset seeder owns this row. True means the authoring
   * surface must not offer Edit or Delete: seed_default_roles upserts
   * preset ids and overwrites their grants, and it is reachable from the UI
   * (seedDefaultRolesScoped), so an accepted edit would be silently
   * destroyed later. Note role-custom is itself a preset — a role *called*
   * custom is not an authored row, so gate on this flag and never on name.
   */
  is_builtin: boolean;
  /**
   * Rows still pointing at this role (users, assignments, and the two
   * workspace-grant tables). Non-zero means the backend refuses Delete, so
   * disable it and say why rather than letting the click fail.
   *
   * FOREIGN-KEY truth and the ONLY field that may gate deletion. It is NOT a
   * count of accounts and must never be worded as one — `holder_count` is
   * that number, and it is not derivable from this one, because
   * `create_user` writes two rows per person and an account can reference a
   * role through its `users` row while resolving to a different one.
   */
  reference_count: number;
  /**
   * Accounts that resolve to this role — the only value that may read "used
   * by N accounts". Computed server-side from the same predicate
   * authorization uses (assignment first, `users.role_id` fallback), NOT by
   * summing `reference_count`.
   */
  holder_count: number;
  /**
   * Workspace configuration pointing at this role (`role_workspace_types` /
   * `role_workspaces`). Blocks a delete like a holder does, but no account
   * holds anything through it, so it gets its own wording.
   */
  grant_count: number;
}

/**
 * Arguments for creating a custom role (ADR #47 ruling 4). Carries no id:
 * the backend generates one, because a row whose id the preset seeder owns
 * would be silently rewritten on the next re-seed.
 */
export interface CreateRoleArgs {
  name: string;
  description?: string;
  permissions?: string[];
}

/**
 * Arguments for rewriting a custom role. `permissions` replaces the grant
 * set wholesale — it is not merged with the previous one.
 */
export interface UpdateRoleArgs {
  id: string;
  name: string;
  description?: string;
  permissions?: string[];
}

/**
 * One account that resolves to a role. Mirrors `RoleHolderDto` (Rust).
 *
 * The scope fields are null TOGETHER, when the account has no assignment row
 * at all and resolves through its `users.role_id`. That is a different fact
 * from "scoped to nothing" — `has_assignment` is what tells them apart, so
 * render them apart rather than collapsing nulls into a blank cell.
 */
export interface RoleHolderDto {
  user_id: string;
  username: string;
  display_name: string;
  /** An inactive account still holds the role and still blocks deleting it. */
  is_active: boolean;
  /** False for a legacy account with no assignment row. */
  has_assignment: boolean;
  /** `global` | `scoped` (the branch/workspace dimension). */
  scope_mode: string | null;
  /** `organization` | `legal_entity` | `location` (the ADR #47 axis). */
  scope_type: string | null;
  /** The bound resource; null exactly when scope_type is `organization`. */
  scope_id: string | null;
  /**
   * `all` | `list` — read this BEFORE `branch_count`. A scoped assignment
   * with `all` covers every branch and so carries zero list rows: a count of
   * 0 there means UNRESTRICTED, not nothing. Rendering the count alone would
   * show an all-branches manager as having no branches at all.
   */
  branch_scope: string | null;
  /** `all` | `list`, for `workspace_count` — same caveat. */
  workspace_scope: string | null;
  /** Branch ids in scope; null when there is no assignment row. */
  branch_count: number | null;
  /** Workspace keys in scope; null when there is no assignment row. */
  workspace_count: number | null;
}

/**
 * A capped page of holders plus the uncapped total.
 *
 * `holders` may be shorter than `total` on purpose. The difference is what
 * the surface renders as "and N more" — never render `holders.length` as if
 * it were the whole set, and never hardcode the ceiling: `cap` carries it.
 */
export interface RoleHoldersDto {
  holders: RoleHolderDto[];
  /** Every holder, including those past `cap`. */
  total: number;
  /** The ceiling the backend actually applied. */
  cap: number;
}

/**
 * One registered permission key — the vocabulary the role editor offers,
 * read from the same registry enforcement consults (ADR #35). Never hardcode
 * this list in the UI: a copy drifts from the keys the gate actually honors.
 */
export interface PermissionKeyDto {
  key: string;
  family: string;
  /** Never grantable under a family wildcard, and blocked for an incomplete
   *  profile (ADR #35 D3/D6). */
  sensitive: boolean;
  description: string;
}

// ── Session-scoped Staff Management (ADR #7 · audit-open-findings STAFF-01) ───
//
// These are the secure replacements. The caller identity is resolved from
// the session token on the backend — the args carry NO caller_user_id.

/** Arguments for creating a staff member via a session-scoped command. */
export interface CreateStaffScopedArgs {
  username: string;
  pin: string;
  display_name: string;
  role_id: string;
  /** ADR #35 D6 profile fields — creation requires the 9 mandatory fields. */
  profile: ProfileArgs;
  /**
   * Optional assignment scope (spec 0048). When present, the user is created
   * with this scope instead of the default global all/all.
   */
  assignment?: AssignmentArgs;
}

/** Arguments for updating a staff member via a session-scoped command. */
export interface UpdateStaffScopedArgs {
  id: string;
  username: string;
  display_name: string;
  role_id: string;
  is_active: boolean;
  /** STAFF-03: optional new PIN; hashed server-side. Omit to keep current. */
  pin?: string;
  /**
   * ADR #35 D6 profile fields (validated + encrypted at rest by the backend).
   * Omit to leave the profile columns untouched.
   */
  profile?: ProfileArgs;
  /**
   * Optional assignment scope (ADR #35 D5 / spec 0048). When present, it is
   * written atomically with the user + profile update. Omit to leave the
   * assignment scope untouched.
   */
  assignment?: AssignmentArgs;
}

/** List all staff members (caller resolved from session token). */
export const listStaffScoped = (sessionToken: string): Promise<StaffMemberDto[]> =>
  loggedInvoke<StaffMemberDto[]>('list_staff_scoped', { sessionToken });

/** List all roles (caller resolved from session token). */
export const listRolesScoped = (sessionToken: string): Promise<RoleDto[]> =>
  loggedInvoke<RoleDto[]>('list_roles_scoped', { sessionToken });

// ── Role authoring (ADR #47 ruling 4) ─────────────────────────────────────
//
// Every arg key below is the camelCase form of the Rust parameter name —
// Tauri binds by that name and the invoke args object is an untyped
// literal, so a wrong key fails at runtime while typecheck stays green
// (todo-global-saas-3.md Amendment 3, defect 1).

/**
 * List the registered permission keys — the vocabulary the role editor
 * offers. Read from the same registry enforcement consults, so the picker
 * can never offer a key the gate would deny.
 */
export const listPermissionKeysScoped = (
  sessionToken: string,
): Promise<PermissionKeyDto[]> =>
  loggedInvoke<PermissionKeyDto[]>('list_permission_keys_scoped', { sessionToken });

/** Create a custom role. The backend generates the id. */
export const createRoleScoped = (
  sessionToken: string,
  args: CreateRoleArgs,
): Promise<RoleDto> =>
  loggedInvoke<RoleDto>('create_role_scoped', { sessionToken, args });

/** Rewrite a custom role. Refused for preset ids. */
export const updateRoleScoped = (
  sessionToken: string,
  args: UpdateRoleArgs,
): Promise<RoleDto> =>
  loggedInvoke<RoleDto>('update_role_scoped', { sessionToken, args });

/** Delete a custom role. Refused for preset ids and while referenced. */
export const deleteRoleScoped = (
  sessionToken: string,
  id: string,
): Promise<null> => loggedInvoke<null>('delete_role_scoped', { sessionToken, id });

/**
 * The accounts that resolve to one role, org-wide, capped server-side.
 *
 * Not store-filtered, unlike most of this API: users, assignments and roles
 * are tenant-global identity records (ADR #4 / #7), so a session standing in
 * one location still sees every holder in the organization. That is the
 * honest answer to "who holds this", and filtering it per store would
 * under-report a role the caller is about to delete.
 */
export const listRoleHoldersScoped = (
  sessionToken: string,
  id: string,
): Promise<RoleHoldersDto> =>
  loggedInvoke<RoleHoldersDto>('list_role_holders_scoped', { sessionToken, id });

/** Create a new staff member (caller resolved from session token). */
export const createStaffScoped = (
  sessionToken: string,
  args: CreateStaffScopedArgs,
): Promise<StaffMemberDto> =>
  loggedInvoke<StaffMemberDto>('create_staff_scoped', { sessionToken, args });

/** Update an existing staff member (caller resolved from session token). */
export const updateStaffScoped = (
  sessionToken: string,
  args: UpdateStaffScopedArgs,
): Promise<StaffMemberDto> =>
  loggedInvoke<StaffMemberDto>('update_staff_scoped', { sessionToken, args });

/**
 * Load a staff member's full profile as the session user sees it (ADR #35
 * D6). Sensitive fields are withheld/masked without the explicit grants and
 * reads are audited by the backend.
 */
export const getStaffProfileScoped = (
  sessionToken: string,
  userId: string,
): Promise<ProfileViewDto> =>
  loggedInvoke<ProfileViewDto>('get_staff_profile_scoped', { sessionToken, userId });

// ── Avatars ────────────────────────────────────────────────────────
//
// `users.avatar` holds the 16-hex-char content hash of an image in the
// content-addressed store — the same value `ProductThumb` resolves to
// `$APPCACHE/images/{hash}.webp`. Only the source file PATH crosses IPC; the
// sniff / transcode / hash / write pipeline runs entirely in Rust and is
// shared with the product images (spec 0046b).

/**
 * Set a user's avatar from the image at `sourcePath`.
 *
 * Self-writes need no grant; writing another user's avatar requires
 * `staff:update`. Returns the content hash now stored in `users.avatar`.
 */
export const setAvatarScoped = (
  sessionToken: string,
  userId: string,
  sourcePath: string,
): Promise<string> =>
  loggedInvoke<string>('set_avatar_scoped', { sessionToken, userId, sourcePath });

/**
 * Clear a user's avatar, falling back to the initials tile.
 *
 * Only the column is cleared; the file is left for the GC sweep, since
 * content-addressed dedup means the bytes may still be referenced elsewhere.
 */
export const clearAvatarScoped = (
  sessionToken: string,
  userId: string,
): Promise<void> =>
  loggedInvoke<void>('clear_avatar_scoped', { sessionToken, userId });

/**
 * Read the SESSION user's own avatar hash, or null when none is set.
 *
 * Takes no user id: the subject is always the caller, so there is nothing to
 * forge. The sidebar header reads this rather than the staff profile, because
 * `get_staff_profile_scoped` requires `staff:read` and a cashier does not
 * hold it.
 */
export const getOwnAvatarScoped = (
  sessionToken: string,
): Promise<string | null> =>
  loggedInvoke<string | null>('get_own_avatar_scoped', { sessionToken });

// ── Session Token (ADR #4 / ADR #7) ───────────────────────────────

/** Arguments for creating a session token after login + workspace selection. */
export interface CreateSessionArgs {
  user_id: string;
  role_id: string;
  store_id: string;
  instance_id: string;
  type_key: string;
  terminal_id: string;
  /** HMAC-signed picker ticket from staff_login / bootstrap_owner. */
  picker_ticket: string;
  /**
   * Optional Organization (legal entity) routing hint for SaaS-3 L194.
   * Display-only: the backend fails closed by re-deriving the org from the
   * user assignment (assignment_covers_resource) — this value is never
   * trusted as authority. Omit for the default org.
   */
  org_id?: string;
}

/** Session context DTO returned alongside the opaque token. */
export interface SessionContextDto {
  userId: string;
  roleId: string;
  storeId: string;
  instanceId: string;
  typeKey: string;
  terminalId: string;
  /**
   * Display-only label of the Organization (legal entity) the session is
   * scoped to, when the user picked a non-default org at login or switched
   * after login (SaaS-3 L194). Never used as an auth input.
   */
  orgLabel?: string;
}

/** Result of create_session — opaque token + resolved context. */
export interface CreateSessionResult {
  session_token: string;
  context: SessionContextDto;
}

/**
 * Create a new session token after authentication and workspace selection.
 *
 * The returned token must be passed to every subsequent Tauri command
 * as the `sessionToken` parameter. The backend resolves the caller's
 * scope (store, instance, type, user, role, terminal) from this token.
 */
export const createSession = (args: CreateSessionArgs): Promise<CreateSessionResult> =>
  loggedInvoke<CreateSessionResult>('create_session', { args });

/** Summary of an Organization (legal entity) available on this device. */
export interface OrganizationSummary {
  id: string;
  name: string;
}

/**
 * Enumerate the Organizations (legal entities) this device knows about.
 *
 * SaaS-3 L194 (pre-login org selector source). Device-local enumeration —
 * returns the legal_entities for the device tenant and nothing else. Callable
 * before authentication (reveals only org ids/names, not account secrets),
 * and it is the enumerated allow-list that create_session and
 * switch_organization constrain org selection to.
 */
export const listOrganizations = (): Promise<OrganizationSummary[]> =>
  loggedInvoke<OrganizationSummary[]>('list_organizations', {});

/**
 * Switch the active Organization (legal entity) for an authenticated session.
 *
 * SaaS-3 L194. Invalidate-then-mint: the backend kills the current token
 * before minting the new one, re-derives tenant authority from the user
 * assignment (fail-closed), and re-runs tenant integrity on the opened DB.
 * Requires a FULL PIN re-auth — no credential carryover.
 */
export const switchOrganization = ({
  sessionToken,
  orgId,
  pin,
}: {
  sessionToken: string;
  orgId: string;
  pin: string;
}): Promise<CreateSessionResult> =>
  loggedInvoke<CreateSessionResult>('switch_organization', { sessionToken, orgId, pin });

/** Result of refreshing a picker ticket. */
export interface RefreshPickerTicketResult {
  /** Fresh picker ticket valid for another 5 minutes. */
  picker_ticket: string;
}

/**
 * Mint a fresh picker ticket for a caller who already holds a valid session token.
 *
 * Used when the UI returns to the workspace picker (e.g. Back button from KDS)
 * and the original picker ticket from login has expired (>5 min).
 * The backend verifies the session token and re-mints a fresh ticket bound
 * to the same user.
 */
export const refreshPickerTicket = (
  sessionToken: string,
): Promise<RefreshPickerTicketResult> =>
  loggedInvoke<RefreshPickerTicketResult>('refresh_picker_ticket', {
    sessionToken,
  });

/**
 * Destroy an active session token (logout or store switch).
 *
 * After this call, any command using the old token will fail
 * with InvalidSession.
 */
export const destroySession = (sessionToken: string): Promise<void> =>
  loggedInvoke<void>('destroy_session', { sessionToken });

/**
 * Act as another user within the operator's authorized scope, for support
 * (operator:impersonate). Returns a fresh session token scoped to the target
 * user — the operator's own grants are NOT merged (no privilege amplification);
 * the produced token carries only the target's scope/grants.
 */
export const impersonateUserScoped = (
  sessionToken: string,
  targetUserId: string,
): Promise<CreateSessionResult> =>
  loggedInvoke<CreateSessionResult>('impersonate_user_scoped', { sessionToken, targetUserId });

/**
 * Heartbeat the active session (F-007: previously invoked directly from
 * `useSessionKeepalive`, bypassing the api layer).
 *
 * Extends the session's sliding expiry so idle-but-open POS terminals
 * are not logged out while the app is in the foreground.
 */
export const sessionKeepalive = (sessionToken: string): Promise<void> =>
  loggedInvoke<void>('session_keepalive', { sessionToken });

/**
 * Verify the current session user's PIN.
 * Used by destructive operations (topology Apply, void, etc.) to
 * confirm the operator's identity before committing.
 */
export const verifyPin = (
  sessionToken: string,
  pin: string,
): Promise<boolean> =>
  loggedInvoke<boolean>('verify_pin', { sessionToken, pin });

// ── C1.1 staff-quota upgrade detection ─────────────────────────────
//
// The backend rejects staff creation past the tier's `max_staff_users()`
// cap with `CoreError::SubscriptionLimitExceeded` — wire subKind
// `subscriptionLimitExceeded`. Screens branch on this to show the
// localized quota message + upgrade CTA instead of the generic error.

/**
 * True when an IPC failure is the C1.1 staff-user quota rejection.
 */
export const isStaffQuotaLimitError = (err: unknown): boolean => {
  const parsed = parseAppError(err);
  return parsed !== null && appErrorSubKind(parsed) === 'subscriptionLimitExceeded';
};
