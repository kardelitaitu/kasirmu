//! Session-scoped Tauri commands for physical inventory / stock counting.
//!
//! ADR #49: nine of the ten doors below are thin shims over
//! `oz_bridge::inventory_counts` — the gate, the store construction, the
//! validation order and the error mapping live there now, and this shell keeps
//! only its `#[tauri::command]` signatures so the wire never moves.
//!
//! **Why this module ported.** None of the ten doors is on this shell's
//! registration-gate debt ledger: each resolves a session and gates through the
//! domain helper `require_inventory_count_permission`, which the sweep's
//! classifier reads as a gate, so the sweep already calls them `Gated` and the
//! delegation is ledger-neutral by construction. The gate is the **unscoped**
//! `Store::require_permission(user_id, inventory_count)` on both sides
//! (`crates/kasirmu-bridge/src/inventory_counts.rs:209-228` documents its helper as a
//! port of the shell's), so the gate *kind* matches too — had it been the
//! scope-aware form, this port would have tightened a gate and been refused.
//!
//! **The one door that could not move.** `update_stock_count_status_scoped` stays
//! here, because the bridge's twin accepts a transition this shell rejects — see
//! the comment on it. That is a pre-existing divergence between the two shells,
//! and §4 requires it be preserved and reported rather than smoothed over by an
//! extraction.
//!
//! **Test seams.** `validate_quantity` and `difference` survive under `#[cfg(test)]`
//! because `inventory_counts_tests.rs` drives them through `use super::*`. The
//! first is a forwarder, so the test exercises the bridge's real implementation;
//! the second has no bridge counterpart to forward to, because the bridge inlines
//! that rule inside `update_count_line_scoped`.

use tauri::{State, command};

use oz_core::{StockCount, StockCountStatus, Store};

use crate::commands::authz::require_permission_for_user;
use crate::error::AppError;
use crate::state::AppState;

// ADR #49: the three DTOs and the five argument structs are the bridge's,
// re-exported rather than restated. The definitions differ only in doc-comment
// wording and in `to_owned()` vs `to_string()` inside the `From` impls, so the
// wire shape is unchanged: the DTOs carry **no `rename_all`** on either side and
// the five `*Args` structs carry `rename_all = "camelCase"` on both.
pub use oz_bridge::inventory_counts::{
    AddCountLineArgs, CompleteStockCountArgs, CreateStockCountArgs, RemoveCountLineArgs,
    StockAdjustmentDto, StockCountDto, StockCountLineDto, UpdateCountLineArgs,
};

/// Test seam for the bridge's quantity guard.
///
/// ADR #49: the body is the bridge's, so the three cases in
/// `inventory_counts_tests.rs` exercise the implementation production uses rather
/// than a local copy of it.
#[cfg(test)]
fn validate_quantity(field: &'static str, quantity: i64) -> Result<(), AppError> {
    Ok(oz_bridge::inventory_counts::validate_quantity(
        field, quantity,
    )?)
}

/// Test seam for the counted-vs-expected difference.
///
/// ADR #49: the bridge has no function of this name — it inlines the rule inside
/// `update_count_line_scoped` (`crates/kasirmu-bridge/src/inventory_counts.rs:466-474`),
/// which is the same `checked_sub` → `counted_qty difference overflow` →
/// `unwrap_or(0)` sequence kept here. So this pins the *rule*, not the bridge's
/// copy of it; the overflow case is the one worth keeping either way.
#[cfg(test)]
fn difference(counted_qty: Option<i64>, expected_qty: i64) -> Result<i64, AppError> {
    counted_qty
        .map(|quantity| {
            quantity
                .checked_sub(expected_qty)
                .ok_or_else(|| AppError::Invalid("counted_qty difference overflow".into()))
        })
        .transpose()
        .map(|value| value.unwrap_or(0))
}

/// Verify that the authenticated user may manage physical inventory counts.
///
/// Kept because the one door that could not be delegated still calls it. The
/// bridge has the same helper for the nine that could.
async fn require_inventory_count_permission(
    state: &AppState,
    user_id: &str,
) -> Result<(), AppError> {
    let db = state.db.lock().await;
    require_permission_for_user(
        &Store::new(&db),
        user_id,
        oz_core::permissions::INVENTORY_COUNT,
    )
}

/// Read a count, requiring only that it exists.
fn get_count(store: &Store<'_>, id: &str) -> Result<StockCount, AppError> {
    store
        .get_stock_count(id)?
        .ok_or_else(|| AppError::Invalid("stock count not found".into()))
}

/// Require that a count exists and is still editable.
fn editable_count(store: &Store<'_>, id: &str) -> Result<StockCount, AppError> {
    let count = get_count(store, id)?;
    if matches!(
        count.status,
        StockCountStatus::Draft | StockCountStatus::InProgress
    ) {
        Ok(count)
    } else {
        Err(AppError::Invalid(
            "stock count is no longer editable".into(),
        ))
    }
}

#[command]
/// Create a stock count in the session's store.
///
/// ADR #49: the body is the bridge's.
pub async fn create_stock_count_scoped(
    session_token: String,
    args: CreateStockCountArgs,
    state: State<'_, AppState>,
) -> Result<StockCountDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory_counts::create_stock_count_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

#[command]
/// Get a stock count from the session's store.
///
/// ADR #49: the body is the bridge's.
pub async fn get_stock_count_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<StockCountDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory_counts::get_stock_count_scoped(&ctx, &session_token, &id)
        .await
        .map_err(Into::into)
}

#[command]
/// List stock counts from the session's store.
///
/// ADR #49: the body is the bridge's.
pub async fn list_stock_counts_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<StockCountDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory_counts::list_stock_counts_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

#[command]
/// Get count lines from the session's store.
///
/// ADR #49: the body is the bridge's. The existence check that stood here
/// (`get_count`, now kept only for the refused door) is the bridge's
/// `editable_or_readable_count` — same `Invalid("stock count not found")` on a
/// miss, and deliberately *not* the editable variant, so completed counts stay
/// readable.
pub async fn get_count_lines_scoped(
    session_token: String,
    count_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<StockCountLineDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory_counts::get_count_lines_scoped(&ctx, &session_token, &count_id)
        .await
        .map_err(Into::into)
}

#[command]
/// Add a line to an editable count in the session's store.
///
/// ADR #49: the body is the bridge's, including the quantity guard that runs
/// **before** the session is resolved — so a negative quantity is still rejected
/// without touching the session store.
pub async fn add_count_line_scoped(
    session_token: String,
    args: AddCountLineArgs,
    state: State<'_, AppState>,
) -> Result<StockCountLineDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory_counts::add_count_line_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

#[command]
/// Update a line in an editable count in the session's store.
///
/// ADR #49: the body is the bridge's, including the guard-before-resolve order.
pub async fn update_count_line_scoped(
    session_token: String,
    args: UpdateCountLineArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory_counts::update_count_line_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

#[command]
/// Remove a line from an editable count in the session's store.
///
/// ADR #49: the body is the bridge's.
pub async fn remove_count_line_scoped(
    session_token: String,
    args: RemoveCountLineArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory_counts::remove_count_line_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

#[command]
/// Complete a count and attribute adjustments to the session user.
///
/// ADR #49: the body is the bridge's.
pub async fn complete_stock_count_scoped(
    session_token: String,
    args: CompleteStockCountArgs,
    state: State<'_, AppState>,
) -> Result<Vec<StockAdjustmentDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory_counts::complete_stock_count_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

#[command]
/// Update a stock-count lifecycle status in the session's store.
///
/// **ADR #49 NOT APPLIED, deliberately — the two shells disagree by one
/// transition.** This door is ledger-neutral (it gates through the domain helper,
/// so the sweep already calls it `Gated`) and every other line of its body matches
/// the bridge's twin: same `editable_count`, same
/// `StockCountStatus::from_db_str`, same `invalid status: {status}` message, same
/// `invalid stock count status transition` refusal, same `updated_at` stamp.
///
/// The allowed-transition set is not the same, though. This shell permits four
/// pairs — `Draft→InProgress`, `Draft→Cancelled`, `InProgress→Cancelled`,
/// `InProgress→InProgress` — while the bridge's twin permits those **plus
/// `Draft→Draft`** (`crates/kasirmu-bridge/src/inventory_counts.rs:563-570`). So
/// delegating would make a no-op `status: "draft"` on a draft count succeed where
/// this shell returns `Invalid`. That is a behaviour change, and §4 forbids one
/// inside an extraction; which set is correct is an owner decision, not a port.
/// Measured 2026-09-16 by reading both `matches!` arms rather than by diffing
/// files — the surrounding bodies are otherwise identical, so a file-level diff
/// would have buried it in doc-comment noise.
pub async fn update_stock_count_status_scoped(
    session_token: String,
    id: String,
    status: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let (session, conn) = state.resolve_scope(&session_token)?;
    require_inventory_count_permission(&state, &session.user_id).await?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let mut count = editable_count(&store, &id)?;
    let next = StockCountStatus::from_db_str(&status)
        .ok_or_else(|| AppError::Invalid(format!("invalid status: {status}")))?;
    let allowed = matches!(
        (count.status, next),
        (StockCountStatus::Draft, StockCountStatus::InProgress)
            | (StockCountStatus::Draft, StockCountStatus::Cancelled)
            | (StockCountStatus::InProgress, StockCountStatus::Cancelled)
            | (StockCountStatus::InProgress, StockCountStatus::InProgress)
    );
    if !allowed {
        return Err(AppError::Invalid(
            "invalid stock count status transition".into(),
        ));
    }
    count.status = next;
    count.updated_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    store.update_stock_count(&count)?;
    Ok(())
}

#[command]
/// List adjustments from the session's store.
///
/// ADR #49: the body is the bridge's.
pub async fn list_stock_adjustments_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<StockAdjustmentDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory_counts::list_stock_adjustments_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

#[cfg(test)]
#[path = "inventory_counts_tests.rs"]
mod tests;
