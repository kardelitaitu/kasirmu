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
}

/** Session context DTO returned alongside the opaque token. */
export interface SessionContextDto {
  userId: string;
  roleId: string;
  storeId: string;
  instanceId: string;
  typeKey: string;
  terminalId: string;
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
