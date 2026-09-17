//! Analytics commands (analytics:view — owner/admin/manager only).
//!
//! Per-staff shift + completed-sales aggregates for the session's store,
//! enriched with display names from the GLOBAL identity DB. The gate is
//! scope-aware (ADR #35 D5 / spec 0048): `require_permission_for_session`
//! evaluates the session's store against the caller's assignment, so a
//! scoped member only sees analytics for branches they are assigned to
//! (an out-of-scope session is denied fail-closed).
//!
//! Wave E slice E8: command bodies live in `kasirmu_bridge::analytics`; these
//! are thin shims that build a `BridgeCtx` and map `BridgeError` back to
//! `AppError` (wire shape unchanged).

use tauri::State;

#[allow(unused_imports)] // sibling analytics_tests.rs depends on it
use oz_core::db::Store;

use crate::error::AppError;
use crate::state::AppState;

pub use kasirmu_bridge::analytics::{StaffAnalyticsDailyDto, StaffAnalyticsDto};

/// Per-staff shift + sales summary for the session's store over `[from, to]`.
#[tauri::command]
pub async fn get_staff_analytics_scoped(
    session_token: String,
    from: String,
    to: String,
    state: State<'_, AppState>,
) -> Result<Vec<StaffAnalyticsDto>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::analytics::get_staff_analytics_scoped(&ctx, &session_token, from, to)
        .await
        .map_err(Into::into)
}

/// Per-day shift + sales series for one staff member over `[from, to]`.
#[tauri::command]
pub async fn get_staff_analytics_daily_scoped(
    session_token: String,
    user_id: String,
    from: String,
    to: String,
    state: State<'_, AppState>,
) -> Result<Vec<StaffAnalyticsDailyDto>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::analytics::get_staff_analytics_daily_scoped(&ctx, &session_token, user_id, from, to)
        .await
        .map_err(Into::into)
}
