//! Offline queue commands.
//!
//! These commands allow the front-end to enqueue, list, and sync
//! transactions that were created while the network was unavailable.

use serde::{Deserialize, Serialize};
use tauri::{State, command};

use oz_core::permissions;
use oz_core::sync_client::{self, SyncAttemptResult, SyncConfig};
use oz_core::{OfflineQueueItem, RemoteSyncFailure, Store, SyncPriority};

use foundation::validate_not_empty;

use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;

// ── DTOs ──────────────────────────────────────────────────────────────

/// Offline queue item DTO for the front-end.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineQueueItemDto {
    /// Unique identifier.
    pub id: String,
    /// Action.
    pub action: String,
    /// Payload.
    pub payload: String,
    /// Current status.
    pub status: String,
    /// Retry Count.
    pub retry_count: i64,
    /// Last Error.
    pub last_error: Option<String>,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// Synced At.
    pub synced_at: Option<String>,
    /// Tenant / store ID for multi-store isolation (OFF-09).
    pub tenant_id: String,
    /// Sync priority tier: "critical" | "normal" | "low" (OFF-09).
    pub priority: String,
}

impl From<OfflineQueueItem> for OfflineQueueItemDto {
    fn from(item: OfflineQueueItem) -> Self {
        Self {
            id: item.id,
            action: item.action,
            payload: item.payload,
            status: item.status.as_stored_str().to_owned(),
            retry_count: item.retry_count,
            last_error: item.last_error,
            created_at: item.created_at,
            synced_at: item.synced_at,
            tenant_id: item.tenant_id,
            priority: item.priority.as_str().to_owned(),
        }
    }
}

/// Retained remote-application failure DTO for the front-end.
///
/// Exposes everything an operator needs to decide whether to requeue a
/// dead-lettered item (via `requeue_remote_failure_scoped`): the remote item id,
/// action, retained payload for inspection, attempt count, the latest
/// error, and the dead-letter flag.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSyncFailureDto {
    /// Remote item identifier.
    pub item_id: String,
    /// Remote action name.
    pub action: String,
    /// Original payload retained for operator inspection.
    pub payload: String,
    /// Number of failed application attempts.
    pub attempts: i64,
    /// Most recent application error.
    pub last_error: String,
    /// Whether retry is exhausted and the item is quarantined.
    pub dead_lettered: bool,
}

impl From<RemoteSyncFailure> for RemoteSyncFailureDto {
    fn from(failure: RemoteSyncFailure) -> Self {
        Self {
            item_id: failure.item_id,
            action: failure.action,
            payload: failure.payload,
            attempts: failure.attempts,
            last_error: failure.last_error,
            dead_lettered: failure.dead_lettered,
        }
    }
}

/// Result of a sync retry attempt.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    /// Number of items successfully synced.
    pub synced_count: i64,
    /// Number of items that failed to sync.
    pub failed_count: i64,
    /// Total number of items that were attempted.
    pub total_count: i64,
    /// The server rejected the attempt because this tenant is on the
    /// `free` plan (ADR sync-plan-gating). Items stay `pending` and sync
    /// automatically after an upgrade.
    #[serde(default)]
    pub plan_required: bool,
}

/// Arguments for enqueuing an offline transaction.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnqueueOfflineArgs {
    /// The action to perform (e.g. "complete_sale_scoped", "void_sale_scoped").
    pub action: String,
    /// JSON-serialized payload for the action.
    pub payload: String,
    /// Optional tenant / store ID (OFF-09). Defaults to "default" for
    /// single-store deployments.
    #[serde(default)]
    pub tenant_id: Option<String>,
    /// Optional sync priority tier (OFF-09): "critical" | "normal" | "low".
    #[serde(default)]
    pub priority: Option<String>,
}

// ── Commands ──────────────────────────────────────────────────────────

fn run_list_pending_offline(
    conn: &rusqlite::Connection,
) -> Result<Vec<OfflineQueueItemDto>, AppError> {
    let store = Store::new(conn);
    let items = store.list_pending_offline()?;
    let dtos: Vec<OfflineQueueItemDto> = items.into_iter().map(OfflineQueueItemDto::from).collect();
    Ok(dtos)
}

/// Get the count of pending offline items.
#[command]
pub async fn pending_offline_count(state: State<'_, AppState>) -> Result<i64, AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    let count = store.pending_offline_count()?;
    drop(db);
    Ok(count)
}

/// Delete a processed offline queue item.
#[command]
pub async fn delete_offline_item(id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    validate_not_empty("id", &id).map_err(|e| AppError::Invalid(e.to_string()))?;

    let db = state.db.lock().await;
    let store = Store::new(&db);
    store.delete_offline_item(&id)?;
    drop(db);

    tracing::info!(id, "offline queue item deleted");
    Ok(())
}

/// Arguments for `requeue_remote_failure_scoped`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequeueRemoteFailureArgs {
    /// Remote item id currently quarantined in `sync_remote_failures`.
    pub item_id: String,
}

/// Execute the requeue against a connection, extracted so the command
/// boundary is unit-testable without a Tauri runtime.
fn run_requeue_remote_failure(conn: &rusqlite::Connection, item_id: &str) -> Result<(), AppError> {
    let store = Store::new(conn);
    store.requeue_remote_failure(item_id)?;
    Ok(())
}

/// Execute the listing against a connection, extracted so the command
/// boundary is unit-testable without a Tauri runtime.
fn run_list_remote_failures(
    conn: &rusqlite::Connection,
) -> Result<Vec<RemoteSyncFailureDto>, AppError> {
    let store = Store::new(conn);
    let failures = store.list_remote_failures()?;
    Ok(failures
        .into_iter()
        .map(RemoteSyncFailureDto::from)
        .collect())
}

/// Manually enqueue a transaction for later sync resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn enqueue_offline_scoped(
    session_token: String,
    args: EnqueueOfflineArgs,
    state: State<'_, AppState>,
) -> Result<OfflineQueueItemDto, AppError> {
    validate_not_empty("action", &args.action).map_err(|e| AppError::Invalid(e.to_string()))?;
    validate_not_empty("payload", &args.payload).map_err(|e| AppError::Invalid(e.to_string()))?;

    // OFF-09: preserve tenant isolation and priority tier at the command
    // boundary. `enqueue_offline_scoped` records both in the row; a missing
    // tenant falls back to the "default" single-store tenant and a missing
    // priority to Normal (never escalated from a stale front-end).
    let tenant_id = args.tenant_id.as_deref().unwrap_or("default");
    let priority = args
        .priority
        .as_deref()
        .map(SyncPriority::from_str_lenient)
        .unwrap_or(SyncPriority::Normal);

    let (_session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let item = store.enqueue_offline_scoped(&args.action, &args.payload, tenant_id, priority)?;
    drop(db);

    tracing::info!(id = %item.id, action = %item.action, tenant_id, "offline transaction enqueued");
    Ok(item.into())
}

/// List all pending (unsynced) offline queue items, oldest first resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn list_pending_offline_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<OfflineQueueItemDto>, AppError> {
    let (_session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    run_list_pending_offline(&db)
}

/// List all offline queue items (most recent first) resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn list_all_offline_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<OfflineQueueItemDto>, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SYNC_MANAGE).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let items = store.list_all_offline()?;
    let dtos: Vec<OfflineQueueItemDto> = items.into_iter().map(OfflineQueueItemDto::from).collect();
    Ok(dtos)
}

/// Session-scoped variant of `pending_offline_count`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn pending_offline_count_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<i64, AppError> {
    let (_session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let count = store.pending_offline_count()?;
    drop(db);
    Ok(count)
}

/// Attempt to sync all pending offline items through the real cloud sync resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn retry_offline_sync_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<SyncResult, AppError> {
    // Phase 1: Read pending items and config from DB (brief lock).
    let (pending_items, config_opt) = {
        let (session, conn_arc) = state.resolve_scope(&session_token)?;
        require_permission_for_session(&state, &session, permissions::SYNC_MANAGE).await?;
        let db_guard = conn_arc
            .lock()
            .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
        let db = &*db_guard;
        let store = Store::new(&db);
        let pending = store.list_pending_offline()?;
        let config = SyncConfig::from_settings(&store)?;
        (pending, config)
    };

    let total_count = pending_items.len() as i64;
    let config = match config_opt {
        Some(c) => c,
        None => {
            // SYNC-04: never fabricate a successful retry when sync is
            // unconfigured — surface the error so the UI catch handler
            // shows the honest failure and the items stay pending.
            return Err(AppError::Invalid(
                "Sync is not configured or disabled — items remain pending".into(),
            ));
        }
    };

    if pending_items.is_empty() {
        return Ok(SyncResult {
            synced_count: 0,
            failed_count: 0,
            total_count: 0,
            plan_required: false,
        });
    }

    // OFF-09: critical-before-normal ordering. `Store::list_pending_offline`
    // returns created_at ASC, so re-order the batch so Critical items
    // always transmit before Normal/Low.
    let mut pending_items = pending_items;
    pending_items.sort_by_key(|i| i.priority);

    // Phase 2: Async HTTP push (no DB lock held).
    let outcomes = sync_client::send_items_to_server(&config, &pending_items).await;

    // Phase 3: Write outcomes back to DB (brief lock).
    let db = state.db.lock().await;
    let store = Store::new(&db);
    let attempt = match outcomes {
        Ok(outcomes) => sync_client::apply_sync_outcomes(&store, &pending_items, &outcomes)?,
        // ADR sync-plan-gating: a free tenant is gated, not broken. Do NOT
        // mark the items failed — they stay `pending` and sync automatically
        // once the tenant upgrades.
        Err(sync_client::SyncHttpError::PlanRequired) => SyncAttemptResult {
            synced: 0,
            failed: 0,
            error: Some("cloud sync requires a paid plan".into()),
            plan_required: true,
        },
        Err(e) => sync_client::mark_all_failed(&store, &pending_items, &e.to_string())?,
    };
    drop(db);

    Ok(SyncResult {
        synced_count: attempt.synced as i64,
        failed_count: attempt.failed as i64,
        total_count,
        plan_required: attempt.plan_required,
    })
}

/// Session-scoped variant of `delete_offline_item`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn delete_offline_item_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    validate_not_empty("id", &id).map_err(|e| AppError::Invalid(e.to_string()))?;

    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SYNC_MANAGE).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    store.delete_offline_item(&id)?;
    drop(db);

    tracing::info!(id, "offline queue item deleted");
    Ok(())
}

/// Requeue a dead-lettered remote item so the next sync cycle retries it resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn requeue_remote_failure_scoped(
    session_token: String,
    args: RequeueRemoteFailureArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    validate_not_empty("itemId", &args.item_id).map_err(|e| AppError::Invalid(e.to_string()))?;

    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SYNC_MANAGE).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    run_requeue_remote_failure(&db, &args.item_id)?;
    drop(db);

    tracing::info!(item_id = %args.item_id, "dead-lettered remote item requeued for sync retry");
    Ok(())
}

/// List retained remote-application failures (dead-letter discovery) resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn list_remote_failures_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<RemoteSyncFailureDto>, AppError> {
    let (_session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let failures = run_list_remote_failures(&db)?;
    drop(db);
    Ok(failures)
}

#[cfg(test)]
#[path = "offline_tests.rs"]
mod tests;
