//! Audit log commands.
//!
//! `list_audit_log` exposes the append-only audit log entries
//! stored in SQLite via `kasirmu_core::db::Store::list_audit_entries`.
//!
//! Wave E / E5: every body lives in the headless `kasirmu_bridge::audit` module.
//! Each `#[tauri::command]` below keeps its exact name, parameter list and
//! `Result<_, AppError>` return, so the registered IPC surface and the
//! serialized error shape are unchanged; it borrows a `BridgeCtx` from
//! `AppState`, calls the bridge, and maps `BridgeError` back to `AppError`
//! variant-for-variant. The DTOs and args structs moved with the bodies and
//! are re-exported here for the IPC surface.
//!
//! **This shell has no audit test module.** The tablet's `audit.rs` re-exports
//! the same names for its `audit_tests.rs`, but nothing under
//! `apps/desktop-client` declares one, so the re-export here serves the
//! registered commands alone.
//!
//! Gate order runs inside the bridge, in the same order as before: resolve
//! the scope, enforce the Premium+ audit tier, then `audit:view` /
//! `audit:export` through the domain's own non-scope-aware gate pair, and
//! only then read or write.

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

pub use kasirmu_bridge::audit::{
    AuditEntryDto, AuditExportDto, AuditLogPageDto, AuditReviewStatusDto, ExportAuditLogArgs,
    ExportSecurityEventsArgs, ListAuditLogArgs, ListAuditLogScopedArgs,
    ListSecurityEventsScopedArgs, MarkAuditReviewedArgs, ReviewCheckpointDto,
};

/// Fetch audit log entries scoped to the session's store (AUD-01).
#[tauri::command]
pub async fn list_audit_log_scoped(
    session_token: String,
    args: ListAuditLogScopedArgs,
    state: State<'_, AppState>,
) -> Result<AuditLogPageDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::audit::list_audit_log_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// Read the ORGANIZATION-level security trail from the GLOBAL identity
/// database (see `kasirmu_bridge::audit::list_security_events_scoped`).
#[tauri::command]
pub async fn list_security_events_scoped(
    session_token: String,
    args: ListSecurityEventsScopedArgs,
    state: State<'_, AppState>,
) -> Result<AuditLogPageDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::audit::list_security_events_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// Fetch the session store's latest review checkpoint + unreviewed count
/// (AUD-04).
#[tauri::command]
pub async fn get_audit_review_status_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<AuditReviewStatusDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::audit::get_audit_review_status_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Persist a server-side review checkpoint for the session's store (AUD-04).
#[tauri::command]
pub async fn mark_audit_reviewed_scoped(
    session_token: String,
    args: MarkAuditReviewedArgs,
    state: State<'_, AppState>,
) -> Result<ReviewCheckpointDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::audit::mark_audit_reviewed_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// Export the session store's audit log to CSV (AUD-09).
#[tauri::command]
pub async fn export_audit_log_scoped(
    session_token: String,
    args: ExportAuditLogArgs,
    state: State<'_, AppState>,
) -> Result<AuditExportDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::audit::export_audit_log_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// Export the ORGANIZATION-level security trail to CSV (owner ruling
/// D61-7, D84) — see `kasirmu_bridge::audit::export_security_events_scoped`.
#[tauri::command]
pub async fn export_security_events_scoped(
    session_token: String,
    args: ExportSecurityEventsArgs,
    state: State<'_, AppState>,
) -> Result<AuditExportDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::audit::export_security_events_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}
