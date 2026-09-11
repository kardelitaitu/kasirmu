//! Email report commands — send test reports and manage SMTP config.
//!
//! These commands allow the settings UI to validate SMTP connectivity
//! by sending a test report email immediately.

// Wave F: the bodies moved to oz_bridge::email. get_report_schedule stays
// gate-free on both sides; its scoped sibling gates first and then delegates
// inside the bridge module (two distinct bridge fns, no shared entry point).
use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

/// Send a test report email using the currently configured SMTP
/// settings and report schedule.
///
/// Uses [`oz_core::export::email_sender::generate_filtered_report_email`]
/// so that the user's report_type checkbox selections are respected.
///
/// # Returns
///
/// A success message string on completion, or an [`AppError`] on
/// failure (invalid config, SMTP connection refused, etc.).
#[tauri::command]
pub async fn send_test_report(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::email::send_test_report(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Get the current report schedule configuration.
///
/// Returns the saved [`ReportScheduleConfig`](oz_core::export::ReportScheduleConfig) or a default if none
/// has been persisted yet.
#[tauri::command]
pub async fn get_report_schedule(
    state: State<'_, AppState>,
) -> Result<oz_core::export::ReportScheduleConfig, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::email::get_report_schedule(&ctx)
        .await
        .map_err(Into::into)
}

/// Save the report schedule configuration.
#[tauri::command]
pub async fn save_report_schedule(
    session_token: String,
    state: State<'_, AppState>,
    config: oz_core::export::ReportScheduleConfig,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::email::save_report_schedule(&ctx, &session_token, config)
        .await
        .map_err(Into::into)
}

/// Session-scoped variant of [`get_report_schedule`].
#[tauri::command]
pub async fn get_report_schedule_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<oz_core::export::ReportScheduleConfig, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::email::get_report_schedule_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

#[cfg(test)]
#[path = "email_tests.rs"]
mod tests;
