//! Kitchen Display System (KDS) commands.
//!
//! IPC surface for the kitchen order queue: list orders, update status,
//! create tickets from completed sales.
//!
//! ADR #7: session-scoped — every command resolves the store database
//! from the session token, and order reads/writes go through the
//! `*_for_instance` visibility filter so one KDS display cannot read or
//! transition another display's tickets (desktop parity; legacy tickets
//! without a target instance stay visible to every display).
//!
//! Mutating commands emit `kds:orders-changed` after the DB guard is
//! released so every KDS board push-refreshes (desktop parity — this
//! was previously missing on tablet, leaving stale boards after a
//! tablet-originated status change).

use tauri::{Emitter, State, command};

use oz_core::KdsOrder;
use oz_core::db::Store;
use oz_core::permissions;

use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;

/// Push a real-time update to all KDS displays (desktop event parity).
///
/// Called only after the store-DB guard has been released and the core
/// transaction has committed, so listeners never observe a phantom
/// change. Best-effort: a missing app handle (tests/headless) skips.
fn emit_orders_changed(app: Option<&tauri::AppHandle>) {
    if let Some(app) = app {
        let _ = app.emit("kds:orders-changed", ());
    }
}

/// Session-scoped list of KDS orders visible to the session's instance.
#[command]
pub async fn list_kds_orders_scoped(
    session_token: String,
    status: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<KdsOrder>, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::KDS_VIEW).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db_guard);
    let orders = store.list_kds_orders_for_instance(status.as_deref(), &session.instance_id)?;
    Ok(orders)
}

/// Session-scoped kitchen queue (pending + preparing + ready, oldest
/// first) visible to the session's instance, optionally zone-filtered.
#[command]
pub async fn get_kds_queue_scoped(
    session_token: String,
    kds_zone: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<KdsOrder>, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::KDS_VIEW).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db_guard);
    let orders = store.get_kds_queue_for_instance(kds_zone.as_deref(), &session.instance_id)?;
    Ok(orders)
}

/// Update a KDS order's status — only when the ticket targets the
/// session's instance. Sets the appropriate timestamp automatically and
/// pushes `kds:orders-changed` on success.
#[command]
pub async fn update_kds_status_scoped(
    session_token: String,
    id: String,
    status: String,
    state: State<'_, AppState>,
) -> Result<KdsOrder, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::KDS_UPDATE).await?;
    let order = {
        let db_guard = conn_arc
            .lock()
            .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
        let store = Store::new(&db_guard);
        store.update_kds_status_for_instance(&id, &status, &session.instance_id)?
    }; // guard released before the emit

    emit_orders_changed(state.app.as_ref());
    Ok(order)
}

/// Create KDS orders from a completed sale, tagged with the session's
/// store for defense-in-depth filtering (ADR #8). Returns one order per
/// kitchen zone; an empty vec when no restaurant items exist. Broadcasts
/// `kds:orders-changed` when tickets were created.
///
/// Note: ticket creation from tablet uses the legacy untargeted path
/// (visible to every KDS instance). Topology runtime-plan targeting and
/// chit auto-print remain desktop-only (`create_kds_order_from_sale_scoped`
/// in apps/desktop-client).
#[command]
pub async fn create_kds_order_from_sale_scoped(
    session_token: String,
    sale_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<KdsOrder>, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::KDS_UPDATE).await?;
    let orders = {
        let db_guard = conn_arc
            .lock()
            .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
        let store = Store::new(&db_guard);
        store.complete_sale_to_kds(&sale_id, Some(&session.store_id))?
    }; // guard released before the emit

    if !orders.is_empty() {
        emit_orders_changed(state.app.as_ref());
    }
    Ok(orders)
}

/// Get a single KDS order by id — only when the ticket targets the
/// session's instance (inaccessible tickets return `None`, matching the
/// desktop no-existence-oracle behaviour).
#[command]
pub async fn get_kds_order_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<KdsOrder>, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::KDS_VIEW).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db_guard);
    let order = store.get_kds_order_for_instance(&id, &session.instance_id)?;
    Ok(order)
}

#[cfg(test)]
#[path = "kds_tests.rs"]
mod tests;
