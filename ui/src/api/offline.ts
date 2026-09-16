// ── Offline Queue & Cloud Sync ────────────────────────────────────

import { loggedInvoke } from '@/utils/logged-invoke';

// ── Offline Queue ────────────────────────────────────────────────

/** An item in the offline action queue. */
export interface OfflineQueueItemDto {
  id: string;
  action: string;
  /**
   * JSON-serialized action payload (SYNC-11: present in the Rust
   * `OfflineQueueItemDto` serializer — must not be dropped here).
   */
  payload: string;
  status: string;
  retryCount: number;
  lastError: string | null;
  createdAt: string;
  syncedAt: string | null;
  /** Tenant / store ID for multi-store isolation (OFF-09). */
  tenantId: string;
  /** Sync priority tier: "critical" | "normal" | "low" (OFF-09). */
  priority: string;
}

/** Arguments for enqueuing an offline action. */
export interface EnqueueOfflineArgs {
  action: string;
  payload: string;
  /** Optional tenant / store ID (OFF-09). Defaults to "default". */
  tenantId?: string;
  /** Optional sync priority tier (OFF-09): "critical" | "normal" | "low". */
  priority?: 'critical' | 'normal' | 'low';
}

/**
 * Result of a manual retry of the pending offline queue.
 *
 * SYNC-04 / SYNC-11: matches the Rust `SyncResult` DTO exactly
 * (camelCase `syncedCount` / `failedCount` / `totalCount`).
 */
export interface SyncResult {
  /** Number of items successfully synced. */
  syncedCount: number;
  /** Number of items that failed to sync. */
  failedCount: number;
  /** Total number of items that were attempted. */
  totalCount: number;
  /** The server rejected the attempt because this tenant is on the free
   *  plan (ADR sync-plan-gating) — show an upgrade prompt. */
  planRequired?: boolean;
}

/** Summary of offline queue status (P1-6 sync observability). */
export interface OfflineQueueSummaryDto {
  pendingCount: number;
  syncedCount: number;
  failedCount: number;
  /** Number of items resolved via conflict during sync (P1-3). */
  conflictCount: number;
  lastSyncedAt: string | null;
  oldestPendingAt: string | null;
}

/** Get offline queue status summary (scoped — ADR #7). */
export const getOfflineQueueStatusSummaryScoped = (sessionToken: string): Promise<OfflineQueueSummaryDto> =>
  loggedInvoke<OfflineQueueSummaryDto>('offline_queue_status_summary_scoped', { sessionToken });

// ── Offline queue operations (scoped — ADR #7) ──────────────────────

/** List all offline actions (scoped — ADR #7). */
export const listAllOfflineScoped = (sessionToken: string): Promise<OfflineQueueItemDto[]> =>
  loggedInvoke<OfflineQueueItemDto[]>('list_all_offline_scoped', { sessionToken });

/** Get the count of pending offline actions (scoped — ADR #7). */
export const pendingOfflineCountScoped = (sessionToken: string): Promise<number> =>
  loggedInvoke<number>('pending_offline_count_scoped', { sessionToken });

/** Retry syncing all pending offline actions (scoped — ADR #7). */
export const retryOfflineSyncScoped = (sessionToken: string): Promise<SyncResult> =>
  loggedInvoke<SyncResult>('retry_offline_sync_scoped', { sessionToken });

/** Delete an offline queue item (scoped). */
export const deleteOfflineItemScoped = (sessionToken: string, id: string): Promise<void> =>
  // Both shells declare this command with a TOP-LEVEL `id` (`apps/desktop-client/.../offline.rs:118`
  // and `apps/tablet-client/.../offline.rs:391`), and Tauri matches command arguments at the top
  // level of the payload object -- so the `{ sessionToken, args: { id } }` shape this line used to
  // build was rejected by the IPC layer in either shell before any Rust body ran. The dev-mock
  // answers the name, which is why no screen ever showed it.
  loggedInvoke('delete_offline_item_scoped', { sessionToken, id });

// ── Remote Dead-Letter (quarantined pulls) ────────────────────────

/**
 * A remote sync item that repeatedly failed to apply during a pull and
 * was quarantined in `sync_remote_failures` (SYNC-09 / SYNC-11).
 *
 * Matches the Rust `RemoteSyncFailureDto` serializer exactly
 * (camelCase `itemId` / `deadLettered`).
 */
export interface RemoteSyncFailureDto {
  /** Remote item identifier. */
  itemId: string;
  /** Remote action name. */
  action: string;
  /** Original payload retained for operator inspection. */
  payload: string;
  /** Number of failed application attempts. */
  attempts: number;
  /** Most recent application error. */
  lastError: string;
  /** Whether retry is exhausted and the item is quarantined. */
  deadLettered: boolean;
}

/** List remote failures (scoped — ADR #7). */
export const listRemoteFailuresScoped = (sessionToken: string): Promise<RemoteSyncFailureDto[]> =>
  loggedInvoke<RemoteSyncFailureDto[]>('list_remote_failures_scoped', { sessionToken });

/** Requeue a dead-lettered remote item (scoped). */
export const requeueRemoteFailureScoped = (sessionToken: string, itemId: string): Promise<void> =>
  loggedInvoke('requeue_remote_failure_scoped', { sessionToken, args: { itemId } });

// ── Cloud Sync Settings ──────────────────────────────────────────

/** Cloud sync configuration. */
export interface SyncSettingsDto {
  serverUrl: string | null;
  hasApiKey: boolean;
  enabled: boolean;
}

/** Arguments for updating cloud sync settings. */
export interface UpdateSyncSettingsArgs {
  serverUrl?: string | null;
  apiKey?: string | null;
  enabled: boolean;
}

/** Result of a sync run, including per-batch success/failure counts. */
export interface SyncAttemptResult {
  synced: number;
  failed: number;
  error: string | null;
  /** The server rejected the attempt because this tenant is on the free
   *  plan (ADR sync-plan-gating) — show an upgrade prompt. */
  planRequired?: boolean;
}

/** Result of pulling data from the cloud server. */
export interface PullResult {
  productsPulled: number;
  taxRatesPulled: number;
  usersPulled: number;
  error: string | null;
}

/** Get cloud sync settings resolved from a session token. ADR #7. */
export const getSyncSettingsScoped = (sessionToken: string): Promise<SyncSettingsDto> =>
  loggedInvoke<SyncSettingsDto>('get_sync_settings_scoped', { sessionToken });

/** Update the cloud sync settings (scoped — ADR #7). */
export const updateSyncSettingsScoped = (sessionToken: string, args: UpdateSyncSettingsArgs): Promise<void> =>
  loggedInvoke<void>('update_sync_settings_scoped', { sessionToken, args });

/** Run a sync cycle (scoped — ADR #7). */
export const syncRunScoped = (sessionToken: string): Promise<SyncAttemptResult> =>
  loggedInvoke<SyncAttemptResult>('sync_run_scoped', { sessionToken });

// ── PostgreSQL sync settings & daemon ──────────────────────────────

/** PostgreSQL sync configuration (the PG transport's connection settings). */
export interface PgSyncSettingsDto {
  enabled: boolean;
  host: string | null;
  port: string | null;
  dbname: string | null;
  user: string | null;
  hasPassword: boolean;
}

/** Arguments for updating PostgreSQL sync settings. `password` is only
 *  written when provided — omit it to keep the stored secret untouched
 *  (the UI sends `undefined` for the unmasked field). */
export interface UpdatePgSyncSettingsArgs {
  enabled: boolean;
  host?: string | null;
  port?: string | null;
  dbname?: string | null;
  user?: string | null;
  password?: string | null;
}

/** Snapshot of the PG sync daemon's state (camelCase mirror of the Rust
 *  `PgDaemonStatus` serializer). */
export interface PgDaemonStatusDto {
  running: boolean;
  lastSyncAt: string | null;
  lastPushed: number;
  lastPulled: number;
  lastError: string | null;
  pendingCount: number;
}

/** Get the PostgreSQL sync settings (scoped — ADR #7). */
export const getPgSyncSettingsScoped = (sessionToken: string): Promise<PgSyncSettingsDto> =>
  loggedInvoke<PgSyncSettingsDto>('get_pg_sync_settings_scoped', { sessionToken });

/** Update the PostgreSQL sync settings (scoped — ADR #7). */
export const updatePgSyncSettingsScoped = (sessionToken: string, args: UpdatePgSyncSettingsArgs): Promise<void> =>
  loggedInvoke<void>('update_pg_sync_settings_scoped', { sessionToken, args });

/** Get the PG sync daemon's current status (scoped — ADR #7). */
export const pgSyncStatusScoped = (sessionToken: string): Promise<PgDaemonStatusDto> =>
  loggedInvoke<PgDaemonStatusDto>('pg_sync_status_scoped', { sessionToken });

/** Start the background PG sync daemon (scoped — ADR #7; no-op when already running). */
export const pgSyncStartScoped = (sessionToken: string): Promise<void> =>
  loggedInvoke<void>('pg_sync_start_scoped', { sessionToken });

/** Stop the background PG sync daemon (scoped — ADR #7; no-op when not running). */
export const pgSyncStopScoped = (sessionToken: string): Promise<void> =>
  loggedInvoke<void>('pg_sync_stop_scoped', { sessionToken });

/**
 * Arguments for a destructive snapshot pull.
 *
 * SYNC-03: `confirmDestructive` must be `true` for the backend command
 * to proceed — it rejects any call without explicit user consent.
 */
export interface SyncPullArgs {
  confirmDestructive: boolean;
}

/**
 * Pull data (products, tax rates, users) from the cloud server.
 *
 * SYNC-03: the destructive consent is part of the IPC contract — the
 * caller must pass `{ confirmDestructive: true }` after showing a
 * confirmation dialog. (scoped — ADR #7)
 */
export const syncPullScoped = (sessionToken: string, args: SyncPullArgs): Promise<PullResult> =>
  loggedInvoke<PullResult>('sync_pull_scoped', { sessionToken, args });

// ── Tenant plan (ADR sync-plan-gating) ─────────────────────────

/** Result of reading the caller's own sync plan from the server. */
export interface SyncPlanResult {
  ok: boolean;
  /** Effective plan: `free` | `pro` — present when the read succeeded. */
  plan: 'free' | 'pro' | null;
  status: string;
}

/** Get sync plan (scoped — ADR #7). */
export const getSyncPlanScoped = (sessionToken: string): Promise<SyncPlanResult> =>
  loggedInvoke<SyncPlanResult>('get_sync_plan_scoped', { sessionToken });

// ── Connection Test ──────────────────────────────────────────────

/** Result of pinging the cloud server's health endpoint. */
export interface PingResult {
  ok: boolean;
  status: string;
  latencyMs: number | null;
}

/** Test connectivity to the configured cloud server (H-6: URL always resolved from saved settings). */
export const testSyncConnection = (): Promise<PingResult> =>
  loggedInvoke<PingResult>('test_sync_connection');

/** Test connectivity (scoped — ADR #7). */
export const testSyncConnectionScoped = (sessionToken: string): Promise<PingResult> =>
  loggedInvoke<PingResult>('test_sync_connection_scoped', { sessionToken });

// ── Token Request ────────────────────────────────────────────────

/** Result of requesting a new JWT API token from the cloud server. */
export interface TokenResult {
  ok: boolean;
  token: string | null;
  status: string;
  expiresAt: string | null;
}

/** Request a new JWT token (scoped — ADR #7). */
export const requestSyncTokenScoped = (sessionToken: string): Promise<TokenResult> =>
  loggedInvoke<TokenResult>('request_sync_token_scoped', { sessionToken });
