//! Analytics commands (analytics:view — owner/admin/manager only).
//!
//! Per-staff shift + completed-sales aggregates for the session's store,
//! enriched with display names from the GLOBAL identity DB. Parity with the
//! desktop client; the gate is scope-aware (ADR #35 D5 / spec 0048).
//!
//! ADR #49: both doors delegate to `kasirmu_bridge::analytics` — the bodies are
//! statement-identical (verified, not eyeballed), the gate kind matches
//! (scope-aware on both sides) and so does the order: `resolve_session` →
//! gate → `open_store`. The two DTOs are re-exported from the bridge; they are
//! byte-identical and the orphan rule forbids a shell-side `From` impl.

use tauri::{State, command};

use crate::error::AppError;
use crate::state::AppState;

pub use kasirmu_bridge::analytics::{StaffAnalyticsDailyDto, StaffAnalyticsDto};

/// Per-staff shift + sales summary for the session's store over `[from, to]`.
#[command]
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
#[command]
pub async fn get_staff_analytics_daily_scoped(
    session_token: String,
    user_id: String,
    from: String,
    to: String,
    state: State<'_, AppState>,
) -> Result<Vec<StaffAnalyticsDailyDto>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::analytics::get_staff_analytics_daily_scoped(
        &ctx,
        &session_token,
        user_id,
        from,
        to,
    )
    .await
    .map_err(Into::into)
}

#[cfg(test)]
#[path = "analytics_tests.rs"]
mod tests;
