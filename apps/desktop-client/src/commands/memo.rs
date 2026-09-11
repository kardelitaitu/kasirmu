//! Tauri commands for the Memo lifecycle (Phase 2 P1).
//!
//! Memos are a tenant-level resource (Organization Memos span every location;
//! Location Memos target one), stored in the global identity database alongside
//! `locations` and `terminals` — the same database the Legal Entity commands
//! use. The staged tenant sentinel is `default`; future tenant claims can
//! supply the resolved tenant without changing these DTOs.
//!
//! Authorization split, deliberately:
//! - Authoring (`create`, `publish`) requires `memo:write`.
//! - Consumption (`list_active`, `acknowledge`) is scoped to the caller's own
//!   terminal via the session and requires no extra permission — a staff member
//!   must be able to see and acknowledge memos addressed to their terminal, and
//!   the recipient set is already terminal-scoped by the store's fan-out.
//! - Early stop (`stop`) is the 2026-09-07 A2 ruling: the AUTHOR of the memo
//!   may always stop it; anyone else must hold `memo:stop` (Owner/Admin
//!   presets; custom roles deny by default). "Higher role" is a registry
//!   grant, not a rank map — the rank-based `may_stop` helper was deleted
//!   with its tests when this ruling landed.
//!
//! Wave F: every body lives in the headless `oz_bridge::memo` module. Each
//! `#[tauri::command]` below keeps its exact name, parameter list and
//! `Result<_, AppError>` return, so the registered IPC surface and the
//! serialized error shape are unchanged; it borrows a `BridgeCtx` from
//! `AppState`, calls the bridge, and maps `BridgeError` back to `AppError`
//! variant-for-variant. The DTOs, the args structs and the tenant sentinel
//! moved with the bodies and are re-exported here so `use super::*;` in
//! `memo_tests.rs` keeps resolving them.

#[allow(unused_imports)] // sibling memo_tests.rs depends on it
use chrono::Utc;
#[allow(unused_imports)] // sibling memo_tests.rs depends on it
use oz_core::memo::{
    ActiveMemo, Memo, NOTIFICATION_BASE_INTERVAL_SECS, NewMemo, kds_notification_interval_secs,
};
#[allow(unused_imports)] // sibling memo_tests.rs depends on it
use oz_core::{Store, permissions};
use tauri::State;

#[allow(unused_imports)] // sibling memo_tests.rs depends on it
use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;

pub use oz_bridge::memo::{
    ActiveMemoDto, CreateMemoArgs, DEFAULT_TENANT_ID, MemoCadenceDto, MemoDisplayDto, MemoDto,
    ReviseMemoArgs,
};

/// Create a memo draft as the authenticated author. Requires `memo:write`.
#[tauri::command]
pub async fn create_memo_scoped(
    args: CreateMemoArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<MemoDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::memo::create_memo_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// Publish a draft memo. Requires `memo:write`.
#[tauri::command]
pub async fn publish_memo_scoped(
    memo_id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<MemoDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::memo::publish_memo_scoped(&ctx, &session_token, &memo_id)
        .await
        .map_err(Into::into)
}

/// List the memos the caller's terminal should display, newest tier-stacked,
/// plus the server-issued display cadence. Authenticated-only: the recipient
/// set is already terminal-scoped.
#[tauri::command]
pub async fn list_active_memos_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<MemoDisplayDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::memo::list_active_memos_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Acknowledge a memo on the caller's terminal. Authenticated-only.
#[tauri::command]
pub async fn acknowledge_memo_scoped(
    memo_id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::memo::acknowledge_memo_scoped(&ctx, &session_token, &memo_id)
        .await
        .map_err(Into::into)
}

/// List every memo authored by the session user, newest first — the
/// management read behind the authoring screen. Requires `memo:write`; the
/// store deliberately filters on authorship rather than org-wide authority
/// (a "manage all Memos" view waits for Phase 1 scoped authorization).
#[tauri::command]
pub async fn list_authored_memos_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<MemoDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::memo::list_authored_memos_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Early-stop a published memo (`published → stopped`): it leaves every
/// display surface immediately and `stopped_by` records who ended it.
///
/// Authorization is the 2026-09-07 A2 ruling, enforced in the bridge rather
/// than in the store: the memo's AUTHOR may always stop their own; any other
/// actor must hold `memo:stop`.
#[tauri::command]
pub async fn stop_memo_scoped(
    memo_id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<MemoDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::memo::stop_memo_scoped(&ctx, &session_token, &memo_id)
        .await
        .map_err(Into::into)
}

/// Revise an existing memo with new title and body. Requires `memo:write`.
#[tauri::command]
pub async fn revise_memo_scoped(
    memo_id: String,
    args: ReviseMemoArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<MemoDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::memo::revise_memo_scoped(&ctx, &session_token, &memo_id, args)
        .await
        .map_err(Into::into)
}

#[cfg(test)]
#[path = "memo_tests.rs"]
mod tests;
