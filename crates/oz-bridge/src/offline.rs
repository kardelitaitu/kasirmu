//! Offline-queue command bodies (Wave F) — the tauri-free half of
//! `apps/desktop-client/src/commands/offline.rs`.
//!
//! Key items: the nine ADR #7 scoped offline-queue commands (enqueue, list,
//! list-all, status summary, count, retry-sync, delete, and the dead-letter
//! requeue/list pair), the queue DTOs, and the three `run_*` store helpers.
//!
//! Ports are verbatim: gate kind and ORDER (`SYNC_MANAGE` on the four gated
//! paths, still taken after `resolve_scope`), every store handle still comes
//! from [`BridgeCtx::resolve_scope`] and never `resolve_store` (the effective
//! store differs for restaurant-POS sessions), the single global-DB read keeps
//! its inner scope so the lock drops before the store connection is taken, the
//! sync round-trip and its plan-required early return are untouched, and every
//! log line and error string is identical apart from the 1:1 AppError ->
//! BridgeError rename.

use serde::{Deserialize, Serialize};

use oz_core::sync_client::{self, SyncAttemptResult, SyncConfig};

use oz_core::{OfflineQueueItem, RemoteSyncFailure, Store, SyncPriority};

use foundation::validate_not_empty;

use oz_core::permissions;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;
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
/// dead-lettered item (via `requeue_remote_failure`): the remote item id,
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
    /// The action to perform (e.g. "complete_sale", "void_sale").
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

/// List the parked (pending) offline-queue items held by `conn`.
pub fn run_list_pending_offline(
    conn: &rusqlite::Connection,
) -> Result<Vec<OfflineQueueItemDto>, BridgeError> {
    let store = Store::new(conn);
    let items = store.list_pending_offline()?;
    let dtos: Vec<OfflineQueueItemDto> = items.into_iter().map(OfflineQueueItemDto::from).collect();
    Ok(dtos)
}

/// Summary of offline queue status — counts by status and sync timing.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineQueueSummaryDto {
    /// Number of pending (unsynced) items.
    pub pending_count: i64,
    /// Number of successfully synced items.
    pub synced_count: i64,
    /// Number of failed items.
    pub failed_count: i64,
    /// Number of items resolved via conflict (P1-3).
    pub conflict_count: i64,
    /// ISO-8601 timestamp of the most recently synced item, if any.
    pub last_synced_at: Option<String>,
    /// ISO-8601 timestamp of the oldest pending item, if any.
    pub oldest_pending_at: Option<String>,
}

/// Arguments for `requeue_remote_failure`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequeueRemoteFailureArgs {
    /// Remote item id currently quarantined in `sync_remote_failures`.
    pub item_id: String,
}

/// Execute the requeue against a connection, extracted so the command
/// boundary is unit-testable without a Tauri runtime.
pub fn run_requeue_remote_failure(
    conn: &rusqlite::Connection,
    item_id: &str,
) -> Result<(), BridgeError> {
    let store = Store::new(conn);
    store.requeue_remote_failure(item_id)?;
    Ok(())
}

/// Execute the listing against a connection, extracted so the command
/// boundary is unit-testable without a Tauri runtime.
pub fn run_list_remote_failures(
    conn: &rusqlite::Connection,
) -> Result<Vec<RemoteSyncFailureDto>, BridgeError> {
    let store = Store::new(conn);
    let failures = store.list_remote_failures()?;
    Ok(failures
        .into_iter()
        .map(RemoteSyncFailureDto::from)
        .collect())
}

// ── Scoped variants (ADR #7) ────────────────────────────────────────

/// Enqueue a transaction for later sync (scoped).
pub async fn enqueue_offline_scoped(
    ctx: &BridgeCtx<'_>,
    args: EnqueueOfflineArgs,
    session_token: &str,
) -> Result<OfflineQueueItemDto, BridgeError> {
    validate_not_empty("action", &args.action).map_err(|e| BridgeError::Invalid(e.to_string()))?;
    validate_not_empty("payload", &args.payload)
        .map_err(|e| BridgeError::Invalid(e.to_string()))?;

    let tenant_id = args.tenant_id.as_deref().unwrap_or("default");
    let priority = args
        .priority
        .as_deref()
        .map(SyncPriority::from_str_lenient)
        .unwrap_or(SyncPriority::Normal);

    let (_session, conn) = ctx.resolve_scope(session_token)?;
    // §B read-only lock: sync queueing is an order mutation — a register
    // whose grace window has lapsed may not enqueue new offline work. The
    // tier is resolved from the global identity DB. This must run BEFORE
    // the store-db lock is taken: the MutexGuard is not Send and may not
    // be held across the global-db .await.
    {
        let global_db = ctx.lock_global().await;
        let sub = oz_core::TenantSubscription::load(&global_db, "default")?
            .ok_or_else(|| BridgeError::Internal("default tenant subscription not found".into()))?;
        sub.verify_signature()?;
        sub.enforce_pos_writable()?;
    }
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let item = store.enqueue_offline_scoped(&args.action, &args.payload, tenant_id, priority)?;
    drop(db);

    tracing::info!(id = %item.id, action = %item.action, tenant_id, "offline transaction enqueued (scoped)");
    Ok(item.into())
}

/// List all pending (unsynced) offline queue items (scoped).
pub async fn list_pending_offline_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<OfflineQueueItemDto>, BridgeError> {
    let (_session, conn) = ctx.resolve_scope(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    run_list_pending_offline(&db)
}

/// List all offline queue items (scoped).
pub async fn list_all_offline_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<OfflineQueueItemDto>, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    // F-017: enforce per-domain permission on this scoped command.
    ctx.require_session_permission(&session, permissions::SYNC_MANAGE)
        .await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let items = store.list_all_offline()?;
    let dtos: Vec<OfflineQueueItemDto> = items.into_iter().map(OfflineQueueItemDto::from).collect();
    Ok(dtos)
}

/// Get a summary of the offline queue status (scoped).
pub async fn offline_queue_status_summary_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<OfflineQueueSummaryDto, BridgeError> {
    let (_session, conn) = ctx.resolve_scope(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let summary = store.offline_queue_status_summary()?;
    drop(db);
    Ok(OfflineQueueSummaryDto {
        pending_count: summary.pending_count,
        synced_count: summary.synced_count,
        failed_count: summary.failed_count,
        conflict_count: summary.conflict_count,
        last_synced_at: summary.last_synced_at,
        oldest_pending_at: summary.oldest_pending_at,
    })
}

/// Get the count of pending offline items (scoped).
pub async fn pending_offline_count_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<i64, BridgeError> {
    let (_session, conn) = ctx.resolve_scope(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let count = store.pending_offline_count()?;
    drop(db);
    Ok(count)
}

/// Attempt to sync all pending offline items (scoped).
pub async fn retry_offline_sync_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<SyncResult, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    // F-017: enforce per-domain permission on this scoped command.
    ctx.require_session_permission(&session, permissions::SYNC_MANAGE)
        .await?;
    let (pending_items, config_opt) = {
        let db = conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
        let store = Store::new(&db);
        let pending = store.list_pending_offline()?;
        let config = SyncConfig::from_settings(&store)?;
        (pending, config)
    };

    let total_count = pending_items.len() as i64;
    let config = match config_opt {
        Some(c) => c,
        None => {
            return Err(BridgeError::Invalid(
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

    let mut pending_items = pending_items;
    pending_items.sort_by_key(|i| i.priority);

    let outcomes = sync_client::send_items_to_server(&config, &pending_items).await;

    let (_session, conn) = ctx.resolve_scope(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let attempt = match outcomes {
        Ok(outcomes) => sync_client::apply_sync_outcomes(&store, &pending_items, &outcomes)?,
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

/// Delete a processed offline queue item (scoped).
pub async fn delete_offline_item_scoped(
    ctx: &BridgeCtx<'_>,
    id: String,
    session_token: &str,
) -> Result<(), BridgeError> {
    validate_not_empty("id", &id).map_err(|e| BridgeError::Invalid(e.to_string()))?;

    let (session, conn) = ctx.resolve_scope(session_token)?;
    // F-017: enforce per-domain permission on this scoped command.
    ctx.require_session_permission(&session, permissions::SYNC_MANAGE)
        .await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    store.delete_offline_item(&id)?;
    drop(db);

    tracing::info!(id, "offline queue item deleted (scoped)");
    Ok(())
}

/// Requeue a dead-lettered remote item (scoped).
pub async fn requeue_remote_failure_scoped(
    ctx: &BridgeCtx<'_>,
    args: RequeueRemoteFailureArgs,
    session_token: &str,
) -> Result<(), BridgeError> {
    validate_not_empty("itemId", &args.item_id).map_err(|e| BridgeError::Invalid(e.to_string()))?;

    let (session, conn) = ctx.resolve_scope(session_token)?;
    // F-017: enforce per-domain permission on this scoped command.
    ctx.require_session_permission(&session, permissions::SYNC_MANAGE)
        .await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    run_requeue_remote_failure(&db, &args.item_id)?;
    drop(db);

    tracing::info!(item_id = %args.item_id, "dead-lettered remote item requeued (scoped)");
    Ok(())
}

/// List retained remote-application failures (scoped).
pub async fn list_remote_failures_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<RemoteSyncFailureDto>, BridgeError> {
    let (_session, conn) = ctx.resolve_scope(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let failures = run_list_remote_failures(&db)?;
    drop(db);
    Ok(failures)
}
