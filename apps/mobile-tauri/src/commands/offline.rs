//! Offline queue commands.
//!
//! These commands allow the front-end to enqueue, list, and sync
//! transactions that were created while the network was unavailable.
//!
//! # ADR #49 status — measured 2026-09-16, `verify-body-parity.py` → **8 / 12**
//!
//! Read the two filters in order, because they disagree here. The parity
//! instrument compares **bodies**: four of the eight doors are
//! statement-identical and four diverge. A body match is necessary but **not
//! sufficient** — §1's ledger rule filters next, and
//! `registration_gate_debt.generated.rs:170-182` lists **four** of these doors
//! as case 2: they resolve a session and name no permission. Delegating a case-2
//! door flips it to `Gated` and **erases debt**, so those stay put even though
//! their bodies already match the twin.
//!
//! **One door is ported.** [`list_all_offline_scoped`] is the only door that is
//! both body-identical *and* gated — it enforces `SYNC_MANAGE`
//! (`crates/kasirmu-bridge/src/offline.rs:266-268`), which is what makes the
//! delegation ledger-neutral. `OfflineQueueItemDto` crossed the boundary with it.
//!
//! **Seven doors are REFUSED, on four separate grounds.** This module is the
//! campaign's clearest evidence that §4's pinned surfaces are not only the SQL:
//!
//! - **Case 2, debt erasure** — [`enqueue_offline_scoped`],
//!   [`list_pending_offline_scoped`], [`pending_offline_count_scoped`] and
//!   [`list_remote_failures_scoped`]. Each resolves a session via
//!   `resolve_scope` and enforces nothing, so a delegation would silently
//!   retire a real ledger row. Gating them is an owner ruling, not part of an
//!   extraction.
//! - **Added statements** — [`enqueue_offline_scoped`] on a second, independent
//!   ground: the bridge runs three statements this shell never has,
//!   `TenantSubscription::load` against the global db then `verify_signature()`
//!   and `enforce_pos_writable()` (`crates/kasirmu-bridge/src/offline.rs:233-236`).
//! - **Storage source** — [`retry_offline_sync_scoped`]. Phase 1 reads the
//!   pending rows from the store database on both sides, but Phase 3 writes the
//!   outcomes to `state.db`, and on this shell `state.db` is the **global
//!   identity** database (`<app_data_dir>/kasir.db`), while the bridge
//!   re-resolves the session and writes to the store database
//!   (`<data_dir>/store-<id>.sqlite`, `platform/core/src/database/manager.rs:167`).
//!   Two different files — the `branding::get_brand_settings` refusal class.
//!   **It is also a defect**, filed in `docs/records/audit-open-findings.md`.
//! - **Log text** — [`delete_offline_item_scoped`] and
//!   [`requeue_remote_failure_scoped`], and *nothing else* differs. The bridge
//!   appends `" (scoped)"` where this shell says `"offline queue item deleted"`
//!   (`:359` vs `:403`) and `"dead-lettered remote item requeued for sync
//!   retry"` (`:382` vs `:425`). §4 pins log text byte-identical — the
//!   `resolve_boot_store` refusal set that precedent — so these two are a
//!   **decision rather than work**: reconcile the suffix and both doors become
//!   portable with no body left to change.

use tauri::{State, command};

use kasirmu_core::permissions;
use kasirmu_core::sync_client::{self, SyncAttemptResult, SyncConfig};
use kasirmu_core::{Store, SyncPriority};

use foundation::validate_not_empty;

use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;

// ── DTOs ──────────────────────────────────────────────────────────────

/// Offline queue item DTO for the front-end.
///
/// Re-exported from `kasirmu_bridge::offline` rather than declared here. The two
/// definitions were field-for-field identical, `#[serde(rename_all =
/// "camelCase")]` included, and `From<OfflineQueueItem>` crossed the boundary
/// with the struct — the orphan rule forbids a shell-side impl for a type this
/// crate does not own, so the conversion could not have stayed behind. Nothing
/// outside this module names the type.
pub use kasirmu_bridge::offline::OfflineQueueItemDto;

/// Retained remote-application failure DTO for the front-end.
///
/// Re-exported from `kasirmu_bridge::offline` for the same reason
/// [`OfflineQueueItemDto`] is: the definitions were identical, and
/// `From<RemoteSyncFailure>` is an impl this crate cannot write for a type it
/// does not own. It exposes everything an operator needs to decide whether to
/// requeue a dead-lettered item (via `requeue_remote_failure_scoped`): the
/// remote item id, action, retained payload for inspection, attempt count, the
/// latest error, and the dead-letter flag.
pub use kasirmu_bridge::offline::RemoteSyncFailureDto;

/// Result of a sync retry attempt.
///
/// Re-exported from `kasirmu_bridge::offline`: the two definitions were identical,
/// and [`retry_offline_sync_scoped`] is refused, so this type is shared purely
/// to keep one field list rather than two.
pub use kasirmu_bridge::offline::SyncResult;

/// Arguments for enqueuing an offline transaction.
///
/// Re-exported from `kasirmu_bridge::offline`: the field lists were identical,
/// `#[serde(default)]` on `tenant_id` and `priority` included, so the
/// wire shape cannot drift between the shells.
pub use kasirmu_bridge::offline::EnqueueOfflineArgs;

// ── Commands ──────────────────────────────────────────────────────────

fn run_list_pending_offline(
    conn: &rusqlite::Connection,
) -> Result<Vec<OfflineQueueItemDto>, AppError> {
    let store = Store::new(conn);
    let items = store.list_pending_offline()?;
    let dtos: Vec<OfflineQueueItemDto> = items.into_iter().map(OfflineQueueItemDto::from).collect();
    Ok(dtos)
}

/// Arguments for `requeue_remote_failure_scoped`.
///
/// Re-exported from `kasirmu_bridge::offline`; the single-field definition was
/// identical on both sides.
pub use kasirmu_bridge::offline::RequeueRemoteFailureArgs;

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
///
/// # ADR #49 NOT APPLIED, deliberately — refused twice over
///
/// Refused 2026-09-16 on two independent grounds.
///
/// 1. **Case 2, not case 1.** The door resolves a session (`resolve_scope`
///    below) and names **no** permission, so it is on the debt ledger
///    (`registration_gate_debt.generated.rs:170`). Its body already matches the
///    bridge twin, so a delegation would flip the ledger row to `Gated` and
///    **erase debt** rather than pay it (§1).
/// 2. **An added enforcement block.** The twin runs three statements this shell
///    has never executed — `TenantSubscription::load` against the global db,
///    then `verify_signature()` and `enforce_pos_writable()`
///    (`crates/kasirmu-bridge/src/offline.rs:233-236`). §4 forbids adding a statement
///    inside an extraction as plainly as removing one, and this one can start
///    refusing enqueues the shell accepts.
///
/// Ground 2 is a **parity gap rather than a policy question** — the desktop
/// shell already delegated this module, so the bridge's checks *are* desktop's
/// shipped behaviour. Whether an offline-first tablet should verify a cloud
/// subscription before queueing a sale it cannot yet send is an owner ruling;
/// it is not an extraction, and it must land in its own commit together with the
/// ledger row it pays.
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
///
/// # ADR #49 NOT APPLIED, deliberately
///
/// Refused 2026-09-16 — **case 2**. The body is already statement-identical to
/// [`kasirmu_bridge::offline::list_pending_offline_scoped`], so this looks portable
/// and is not: the door resolves a session via `resolve_scope` and names **no**
/// permission, so it sits on the debt ledger
/// (`registration_gate_debt.generated.rs:174`). Delegating would flip the row to
/// `Gated` and **erase debt** rather than pay it (§1), because the ledger
/// classifier reads this shell's own source and would no longer see the
/// `resolve_scope` call. Gating the command is an owner ruling, not an
/// extraction.
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
///
/// # ADR #49 — ported 2026-09-16
///
/// Delegates to [`kasirmu_bridge::offline::list_all_offline_scoped`]. The bodies were
/// statement-identical and the gate matches in kind and order (`resolve_scope` →
/// `SYNC_MANAGE` → store lock), so this is a whole-body move. Because the door
/// names a permission it is already `Gated`, which is what makes the delegation
/// ledger-neutral — the only door in this module where both filters agree.
#[command]
pub async fn list_all_offline_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<OfflineQueueItemDto>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::offline::list_all_offline_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Get the count of pending offline items resolved from a session token. ADR #7.
///
/// # ADR #49 NOT APPLIED, deliberately
///
/// Refused 2026-09-16 — **case 2**, on the same ground as
/// [`list_pending_offline_scoped`]: the body already matches its twin, but the
/// door resolves a session and names no permission
/// (`registration_gate_debt.generated.rs:182`), so delegating would erase a real
/// ledger row instead of paying it (§1).
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
///
/// # ADR #49 NOT APPLIED, deliberately — and this one is a defect, not just a fork
///
/// **Its twin is `kasirmu_bridge::offline::retry_offline_sync_scoped`
/// (`crates/kasirmu-bridge/src/offline.rs`), which the desktop command
/// (`apps/desktop-tauri/src/commands/offline.rs`) delegates to.** The two bodies are
/// one operation implemented twice; what differs and why is below, and the ordering
/// half is pinned by
/// `offline_tests::retry_offline_sync_scoped_pushes_critical_before_an_earlier_low_item`.
///
/// Refused 2026-09-16. The gate is fine (case 1: `SYNC_MANAGE`, same kind, same
/// order), but **Phase 3 writes to a different database than the twin's.**
///
/// Phase 1 reads the pending rows from the store database on both sides. Phase 3
/// then does `let db = state.db.lock().await;` (below, `:314`) and hands that to
/// `apply_sync_outcomes` / `mark_all_failed` — and on this shell `state.db` is
/// the **global identity** database (`<app_data_dir>/kasir.db`,
/// `AppState::new` → `state.rs:153-170`), not the store database Phase 1 read.
/// The bridge re-resolves the session and writes to
/// `<data_dir>/store-<id>.sqlite` (`platform/core/src/database/manager.rs:167`).
/// §4 pins the storage source, so the body stays tablet-native — the
/// `branding::get_brand_settings` refusal class.
///
/// **The divergence is also a live bug.** `mark_offline_synced` runs
/// `UPDATE offline_queue SET status = 'synced' … WHERE id = ?1` and returns
/// `CoreError::NotFound` when it affects no rows
/// (`crates/kasirmu-core/src/db/offline.rs:421-433`). Against the global db that id
/// does not exist, so the `?` inside `apply_sync_outcomes` aborts the command —
/// *after* Phase 2 has already pushed the items to the server. The store's rows
/// therefore stay `pending` and every retry re-sends them. Filed in
/// `docs/records/audit-open-findings.md`; it is **not** fixed here, because an
/// extraction preserves pre-existing defects and reports them (§4).
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

    // C49: critical-before-normal ordering, through the ONE shared rule
    // (`kasirmu_core::offline::order_for_push`). `Store::list_pending_offline`
    // returns created_at ASC, so without this a Critical item queued behind a
    // bulk one waits a whole cycle. The shared key is total — priority, then
    // created_at, then the UUID v7 id — so same-millisecond items do not fall
    // back to SQLite's unspecified row order.
    //
    // Sorted ONCE, before the push: Phase 3 below reuses this same vector, so
    // the server's index-aligned outcome list still lines up.
    let mut pending_items = pending_items;
    kasirmu_core::offline::order_for_push(&mut pending_items);

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

/// Delete a processed offline queue item resolved from a session token. ADR #7.
///
/// # ADR #49 NOT APPLIED, deliberately — the log line is the only obstacle
///
/// Refused 2026-09-16. The body is otherwise statement-identical to
/// [`kasirmu_bridge::offline::delete_offline_item_scoped`]: same gate
/// (`SYNC_MANAGE`), same order, same SQL. The one delta is the log text — this
/// shell logs `"offline queue item deleted"` (`:359`) where the bridge logs
/// `"offline queue item deleted (scoped)"`
/// (`crates/kasirmu-bridge/src/offline.rs:403`). §4 pins log text byte-identical, and
/// the `resolve_boot_store` refusal set that precedent.
///
/// This is a **decision rather than work**: reconcile the `(scoped)` suffix on
/// one side and the door becomes a whole-body move with nothing left to rewrite.
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
///
/// # ADR #49 NOT APPLIED, deliberately — the log line is the only obstacle
///
/// Refused 2026-09-16 on the same ground as [`delete_offline_item_scoped`]. The
/// SQL is already shared — this door calls `run_requeue_remote_failure`, the
/// bridge's own helper — and the gate matches, so nothing but the log text
/// differs: `"dead-lettered remote item requeued for sync retry"` here (`:382`)
/// against `"dead-lettered remote item requeued (scoped)"` in the twin
/// (`crates/kasirmu-bridge/src/offline.rs:425`). §4 pins log text byte-identical.
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
///
/// # ADR #49 NOT APPLIED, deliberately
///
/// Refused 2026-09-16 — **case 2**, on the same ground as
/// [`list_pending_offline_scoped`]. The body already matches the twin, but the
/// door resolves a session via `resolve_scope` and names no permission
/// (`registration_gate_debt.generated.rs:178`), so delegating would flip the row
/// to `Gated` and **erase debt** instead of paying it (§1).
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
