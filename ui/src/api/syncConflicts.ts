// ── Sync Conflicts ────────────────────────────────────────────────
//
// Client for the manager-facing conflict review surface. The severity
// vocabulary mirrors the `severity` CHECK constraint on `sync_conflicts`
// (`high` | `medium` | `low`) — no second vocabulary may be invented here,
// or the filter tabs would silently stop matching rows.

import { loggedInvoke } from '@/utils/logged-invoke';

/** How urgent a flagged conflict is. Mirrors the SQL CHECK constraint. */
export type ConflictSeverity = 'high' | 'medium' | 'low';

/** Lifecycle of a conflict row. Mirrors the SQL CHECK constraint. */
export type ConflictStatus = 'open' | 'resolved' | 'dismissed';

/** A flagged divergence between two mutations of the same entity. */
export interface SyncConflictDto {
  id: string;
  tenant_id: string;
  entity_type: string;
  entity_id: string;
  local_terminal_id: string;
  /** JSON version vector of the stored side. Never parsed here. */
  local_vector: string;
  /** JSON version vector of the incoming side. Never parsed here. */
  remote_vector: string;
  /** JSON body of the stored side. Never parsed here. */
  local_payload: string;
  /** JSON body of the incoming side. Never parsed here. */
  remote_payload: string;
  severity: ConflictSeverity;
  status: ConflictStatus;
  resolution: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

/** Optional filters for the list call. Omitted means "no filter". */
///
/// The `| undefined` union is required, not decorative: this project builds
/// with `exactOptionalPropertyTypes`, so a caller that computes a filter
/// conditionally (`cond ? value : undefined`) cannot assign to a plain
/// optional property.
export interface ListSyncConflictsArgs {
  status?: ConflictStatus | undefined;
  severity?: ConflictSeverity | undefined;
}

/** Arguments for resolving a conflict. */
export interface ResolveSyncConflictArgs {
  id: string;
  /** The chosen side, or a custom merge payload as text. */
  resolution: string;
}

/** Human-readable labels for the severity filter tabs. */
export const SEVERITY_ORDER: readonly ConflictSeverity[] = ['high', 'medium', 'low'];

/** Narrow an untrusted string to a valid severity, defaulting to `high`. */
///
/// Fail toward the most urgent bucket: an unrecognised label should make a
/// conflict MORE visible, never hide it.
export function asSeverity(value: string | null | undefined): ConflictSeverity {
  return value === 'medium' || value === 'low' ? value : 'high';
}

/** List the current store's conflicts, newest first. */
export function listSyncConflictsScoped(
  sessionToken: string,
  args: ListSyncConflictsArgs = {},
): Promise<SyncConflictDto[]> {
  return loggedInvoke<SyncConflictDto[]>('list_sync_conflicts_scoped', {
    sessionToken,
    args,
  });
}

/** Record a manager's decision on a conflict. */
export function resolveSyncConflictScoped(
  sessionToken: string,
  args: ResolveSyncConflictArgs,
): Promise<{ id: string; status: string; resolution: string }> {
  return loggedInvoke<{ id: string; status: string; resolution: string }>(
    'resolve_sync_conflict_scoped',
    { sessionToken, args },
  );
}
