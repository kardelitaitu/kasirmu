import { loggedInvoke } from '@/utils/logged-invoke';

// ── Workspace Instance DTO (ADR #4 Phase 1) ────────────────────────────

/**
 * Full workspace instance DTO returned by the backend.
 * Contains the resolution chain: store → instance → type.
 */
export interface WorkspaceDto {
  instance_id: string;
  type_key: string;
  store_id: string;
  store_name: string;
  /** Controlled business purpose, independent from type, label, and access policy. */
  purpose_key: string;
  name: string;
  description: string;
  icon: string;
  layout_mode: string;
  colour: string | null;
  is_default: boolean;
}

/** Screen (nav item) within a workspace type. */
export interface WorkspaceScreenDto {
  screen_key: string;
  sort_order: number;
}

/** Request body for creating a workspace instance. */
export interface CreateInstanceRequest {
  id: string;
  type_key: string;
  store_id: string;
  name: string;
  /** Controlled business purpose; omitted by legacy callers and defaults to `general`. */
  purpose_key?: string;
  description?: string;
  colour?: string;
}

// ── Legacy DTO (deprecated, kept for backward compat) ───────────────────

/** @deprecated Use WorkspaceDto instead (ADR #4). */
export interface WorkspaceTypeDto {
  key: string;
  name: string;
  description: string;
  icon: string;
}

// ── Boot Resolution (ADR #4 Phase 3) ──────────────────────────────────

/** DTO returned by resolve_boot_store. */
export interface BootResolution {
  is_bound: boolean;
  store_id: string;
  instance_id: string | null;
}

/**
 * Resolve the active store and instance from device binding at boot time.
 *
 * Called once before authentication to determine which store database
 * to open and whether to skip the workspace picker.
 *
 * Resolution:
 * 1. Looks up terminal by device_id (hostname).
 * 2. If terminal has valid HMAC-signed device binding:
 *    - If bound to both store + instance → returns both (skip pickers).
 *    - If bound to store only → returns store (skip store picker).
 * 3. Otherwise → returns the primary store.
 */
export async function resolveBootStore(
  deviceId?: string,
): Promise<BootResolution> {
  return loggedInvoke<BootResolution>('resolve_boot_store', { deviceId: deviceId ?? null });
}

// ── Scoped Commands (ADR #7) ───────────────────────────────────────────

/** List workspace instances for the session user within their store. ADR #7. */
export async function listWorkspacesScoped(
  sessionToken: string,
): Promise<WorkspaceDto[]> {
  return loggedInvoke<WorkspaceDto[]>('list_workspaces_scoped', { sessionToken });
}

/** Get a single workspace instance. `is_default` reflects the session user. ADR #7. */
export async function getWorkspaceInstanceScoped(
  sessionToken: string,
  instanceId: string,
): Promise<WorkspaceDto> {
  return loggedInvoke<WorkspaceDto>('get_workspace_instance_scoped', { sessionToken, instanceId });
}

/** Create a new workspace instance (admin). Permission from session. ADR #7. */
export async function createWorkspaceInstanceScoped(
  sessionToken: string,
  req: CreateInstanceRequest,
): Promise<WorkspaceDto> {
  return loggedInvoke<WorkspaceDto>('create_workspace_instance_scoped', { sessionToken, req });
}

/** Editable fields of a workspace instance. `type_key` and `store_id` are immutable. */
export interface UpdateInstanceFields {
  name: string;
  description?: string;
  colour?: string;
}

/** Update a workspace instance's name/description/colour (admin). ADR #7. */
export async function updateWorkspaceInstanceScoped(
  sessionToken: string,
  instanceId: string,
  fields: UpdateInstanceFields,
): Promise<void> {
  return loggedInvoke<void>('update_workspace_instance_scoped', {
    sessionToken,
    instanceId,
    name: fields.name,
    description: fields.description ?? null,
    colour: fields.colour ?? null,
  });
}

/** Archive (soft-delete) a workspace instance (admin). ADR #7. */
export async function archiveWorkspaceInstanceScoped(
  sessionToken: string,
  instanceId: string,
): Promise<void> {
  return loggedInvoke<void>('archive_workspace_instance_scoped', { sessionToken, instanceId });
}

/** List screens for a workspace type from the store-scoped database. ADR #7. */
export async function listWorkspaceScreensScoped(
  sessionToken: string,
  typeKey: string,
): Promise<WorkspaceScreenDto[]> {
  return loggedInvoke<WorkspaceScreenDto[]>('list_workspace_screens_scoped', { sessionToken, typeKey });
}

/** Replace all instance assignments for a user. Caller permission from session. ADR #7. */
export async function setUserWorkspaceInstancesScoped(
  sessionToken: string,
  userId: string,
  instanceIds: string[],
  defaultInstanceId?: string,
): Promise<void> {
  return loggedInvoke<void>('set_user_workspace_instances_scoped', {
    sessionToken,
    userId,
    instanceIds,
    defaultInstanceId: defaultInstanceId ?? null,
  });
}

/** Get instance IDs assigned to a user. Permission check from session. ADR #7. */
export async function getUserWorkspaceInstancesScoped(
  sessionToken: string,
  userId: string,
): Promise<string[]> {
  return loggedInvoke<string[]>('get_user_workspace_instances_scoped', { sessionToken, userId });
}

// ── Original Commands (deprecated for multi-store — ADR #7) ────────────

/**
 * @deprecated Required only during pre-session workspace selection. Once a
 * session exists, use listWorkspacesScoped so the store and permissions are
 * resolved from the session token.
 *
 * audit-open-findings: the backend resolves the caller's REAL role from the picker
 * ticket — caller-supplied role/user are no longer accepted.
 */
export async function listWorkspaces(
  pickerTicket: string,
  storeId: string,
): Promise<WorkspaceDto[]> {
  return loggedInvoke<WorkspaceDto[]>('list_workspaces', {
    ticket: pickerTicket,
    storeId,
  });
}

/**
 * List workspace instances in an explicitly named store for the session
 * user (audit-open-findings). Authenticated replacement for the terminal-management
 * screen's cross-store instance picker.
 */
export async function listWorkspacesForStoreScoped(
  sessionToken: string,
  storeId: string,
): Promise<WorkspaceDto[]> {
  return loggedInvoke<WorkspaceDto[]>('list_workspaces_for_store_scoped', {
    sessionToken,
    storeId,
  });
}

/**
 * List screens during pre-session workspace selection.
 *
 * The explicit store ID keeps this bootstrap read on the selected store
 * database, but only after the picker ticket (audit-open-findings) proves a real login.
 * Authenticated callers should use listWorkspaceScreensScoped.
 */
export async function listWorkspaceScreens(
  pickerTicket: string,
  typeKey: string,
  storeId: string,
): Promise<WorkspaceScreenDto[]> {
  return loggedInvoke<WorkspaceScreenDto[]>('list_workspace_screens', {
    ticket: pickerTicket,
    typeKey,
    storeId,
  });
}

// ── Instance Assignment Commands ────────────────────────────────────────

// ── Legacy Commands (backward compatible, deprecated) ──────────────────

/** List all workspace types (scoped — ADR #7). */
export async function listAllWorkspacesScoped(
  sessionToken: string,
): Promise<WorkspaceTypeDto[]> {
  return loggedInvoke<WorkspaceTypeDto[]>('list_all_workspaces_scoped', { sessionToken });
}

// ── §J Quota Remediation (over-quota suspend / recover) ─────────────────

/**
 * Suspend a store's surplus workspace instances after a tier downgrade
 * (ADR #5 Phase 3c, the §J remediation path). Least-recently-used instances are
 * moved to `quota_suspended`; resolves to the count actually suspended.
 *
 * `storeId` is optional and that optionality is the point: omitted, the command
 * acts on the caller's own store (its historical behaviour). Passed, it acts on
 * that location instead — which is what the owner-facing over-quota card needs,
 * because the card reports the whole tenant while the session is bound to a
 * single store. The backend validates the id against `locations` before opening
 * any store database and rejects an unknown one, so a typo is an error rather
 * than a silent no-op on a freshly created empty store.
 *
 * Desktop-only: not registered on tablet (recorded product choice, the same
 * precedent as memo authoring and payables).
 */
export async function suspendSurplusWorkspaceInstancesScoped(
  sessionToken: string,
  storeId?: string,
): Promise<number> {
  return loggedInvoke<number>('suspend_surplus_workspace_instances_scoped', {
    sessionToken,
    storeId: storeId ?? null,
  });
}

/**
 * Recover a store's `quota_suspended` workspace instances after a tier upgrade
 * (ADR #5 Phase 3b) — the inverse of {@link suspendSurplusWorkspaceInstancesScoped}
 * and the reason suspension is a safe remediation to offer: nothing is destroyed,
 * so an upgrade can hand the instances back. Returns the count restored.
 *
 * Same optional `storeId` semantics and the same desktop-only registration.
 */
export async function recoverWorkspaceInstancesScoped(
  sessionToken: string,
  storeId?: string,
): Promise<number> {
  return loggedInvoke<number>('recover_workspace_instances_scoped', {
    sessionToken,
    storeId: storeId ?? null,
  });
}

