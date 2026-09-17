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
//!
//! ADR #49: four of the five doors below are thin adapters over
//! `kasirmu_bridge::kds::*`, so this shell and the desktop call one
//! implementation. `create_kds_order_from_sale_scoped` is deliberately
//! **not** delegated — see its own doc comment for the measured reason.

use tauri::{Emitter, State, command};

use kasirmu_core::KdsOrder;
use kasirmu_core::db::Store;
use kasirmu_core::permissions;

use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;

/// Push a real-time update to all KDS displays (desktop event parity).
///
/// Retained for `create_kds_order_from_sale_scoped`, the one door not
/// delegated to `kasirmu_bridge::kds`; the four delegated doors emit the same
/// event through `BridgeCtx::emitter` instead.
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
///
/// ADR #49: the body is the bridge's, and the delegation is a pure identity.
/// `kasirmu_bridge::kds::list_kds_orders_scoped` resolves the session, applies the
/// same `permissions::KDS_VIEW` gate through the same scope-aware check
/// (`require_session_permission` -> `require_user_permission_scoped` over
/// `session.store_id` and `session.type_key`, which is what
/// `require_permission_for_session` does here), locks the same global DB and
/// calls the same `list_kds_orders_for_instance` in the same order. What stood
/// here was a byte-identical second copy of that body.
#[command]
pub async fn list_kds_orders_scoped(
    session_token: String,
    status: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<KdsOrder>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::kds::list_kds_orders_scoped(&ctx, &session_token, status)
        .await
        .map_err(Into::into)
}

/// Session-scoped kitchen queue (pending + preparing + ready, oldest
/// first) visible to the session's instance, optionally zone-filtered.
///
/// ADR #49: as with `list_kds_orders_scoped`, a pure identity — same
/// `KDS_VIEW` gate, same scope arguments, same `get_kds_queue_for_instance`.
#[command]
pub async fn get_kds_queue_scoped(
    session_token: String,
    kds_zone: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<KdsOrder>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::kds::get_kds_queue_scoped(&ctx, &session_token, kds_zone)
        .await
        .map_err(Into::into)
}

/// Update a KDS order's status — only when the ticket targets the
/// session's instance. Sets the appropriate timestamp automatically and
/// pushes `kds:orders-changed` on success.
///
/// ADR #49: a pure identity. Same `KDS_UPDATE` gate, same
/// `update_kds_status_for_instance`, and the bridge releases the store-DB
/// guard before emitting exactly as this body did — so the event still
/// cannot be observed before the transaction commits. The emit itself moves
/// from `app.emit` to `ctx.emitter`, which is the same `TauriEventSink`
/// this shell already installs (`commands/authz.rs`), with the same event
/// name and a payload that serialises identically (`Value::Null` for `()`).
#[command]
pub async fn update_kds_status_scoped(
    session_token: String,
    id: String,
    status: String,
    state: State<'_, AppState>,
) -> Result<KdsOrder, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::kds::update_kds_status_scoped(&ctx, &session_token, &id, &status)
        .await
        .map_err(Into::into)
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
///
/// ADR #49 — deliberately NOT delegated, and §4 is the reason. The bridge's
/// door of this name reads the store's runtime KDS plan first, then (a) fans
/// each zone ticket out to the topology-selected instances and (b) auto-prints
/// the resulting chits. Delegating would therefore change this shell's
/// behaviour rather than extract it: with a plan present the tickets become
/// targeted where they are currently untargeted, and an empty target list
/// suppresses them entirely (`should_create_kds_tickets` returns false) where
/// today they are still created; and every call would gain a hardware side
/// effect this shell has never had. Measured, not inferred: the current body
/// is `complete_sale_to_kds`, which is literally
/// `complete_sale_to_kds_routed(.., None)` -> `complete_sale_to_kds_fanout(.., &[])`,
/// so the two agree only in the no-plan case. An owner decision on tablet
/// topology targeting is required before this door moves.
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
///
/// ADR #49: a pure identity — same `KDS_VIEW` gate, same scope arguments,
/// same `get_kds_order_for_instance`, so the no-existence-oracle behaviour
/// is preserved rather than reimplemented.
#[command]
pub async fn get_kds_order_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<KdsOrder>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::kds::get_kds_order_scoped(&ctx, &session_token, &id)
        .await
        .map_err(Into::into)
}

#[cfg(test)]
#[path = "kds_tests.rs"]
mod tests;
