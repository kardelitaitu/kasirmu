//! Audit log commands.
//!
//! `list_audit_log` exposes the append-only audit log entries
//! stored in SQLite via `oz_core::db::Store::list_audit_entries`.
//!
//! Wave E / E5: every body lives in the headless `oz_bridge::audit` module.
//! Each `#[tauri::command]` below keeps its exact name, parameter list and
//! `Result<_, AppError>` return, so the registered IPC surface and the
//! serialized error shape are unchanged; it borrows a `BridgeCtx` from
//! `AppState`, calls the bridge, and maps `BridgeError` back to `AppError`
//! variant-for-variant. The DTOs and args structs moved with the bodies and
//! are re-exported here so `use super::*;` in `audit_tests.rs` and
//! `audit_security_events_tests.rs` keeps resolving them.
//!
//! Gate order runs inside the bridge, in the same order as before: resolve
//! the scope, enforce the Premium+ audit tier, then `audit:view` /
//! `audit:export` through the domain's own non-scope-aware gate pair, and
//! only then read or write.

#[allow(unused_imports)] // sibling audit_tests.rs depends on it
use serde::{Deserialize, Serialize};
use tauri::State;

#[allow(unused_imports)] // sibling audit_tests.rs depends on it
use oz_core::db::Store;

use crate::error::AppError;
use crate::state::AppState;

pub use oz_bridge::audit::{
    AuditEntryDto, AuditExportDto, AuditLogPageDto, AuditReviewStatusDto, ExportAuditLogArgs,
    ExportSecurityEventsArgs, ListAuditLogArgs, ListAuditLogScopedArgs,
    ListSecurityEventsScopedArgs, MarkAuditReviewedArgs, ReviewCheckpointDto,
};

/// Build an RFC-4180 CSV row from the given fields (quotes embedded quotes).
///
/// Thin adapter over `oz_bridge::audit::csv_row`: the name, parameter list
/// and return type are unchanged so the sibling test module keeps calling it.
#[allow(dead_code)] // retained by the Wave-E E5 extraction contract for sibling tests
fn csv_row(fields: &[&str]) -> String {
    oz_bridge::audit::csv_row(fields)
}

/// Fetch audit log entries scoped to the session's store (AUD-01).
#[tauri::command]
pub async fn list_audit_log_scoped(
    session_token: String,
    args: ListAuditLogScopedArgs,
    state: State<'_, AppState>,
) -> Result<AuditLogPageDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::audit::list_audit_log_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// Read the ORGANIZATION-level security trail from the GLOBAL identity
/// database (see `oz_bridge::audit::list_security_events_scoped`).
#[tauri::command]
pub async fn list_security_events_scoped(
    session_token: String,
    args: ListSecurityEventsScopedArgs,
    state: State<'_, AppState>,
) -> Result<AuditLogPageDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::audit::list_security_events_scoped(&ctx, &session_token, args)
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
    oz_bridge::audit::get_audit_review_status_scoped(&ctx, &session_token)
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
    oz_bridge::audit::mark_audit_reviewed_scoped(&ctx, &session_token, args)
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
    oz_bridge::audit::export_audit_log_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "audit_tests.rs"]
mod tests;

/// Export the ORGANIZATION-level security trail to CSV (owner ruling
/// D61-7, D84) — see `oz_bridge::audit::export_security_events_scoped`.
#[tauri::command]
pub async fn export_security_events_scoped(
    session_token: String,
    args: ExportSecurityEventsArgs,
    state: State<'_, AppState>,
) -> Result<AuditExportDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::audit::export_security_events_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

#[cfg(test)]
#[path = "audit_security_events_tests.rs"]
mod security_events_tests;
