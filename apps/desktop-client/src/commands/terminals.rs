//! Terminal management Tauri commands.
//!
//! CRUD operations for registered POS terminals. Each POS device
//! registers itself with a unique name and device identifier.
//!
//! All commands have scoped variants (ADR #7) that use the session token
//! pattern. Old commands are preserved with deprecation notices.
//!
//! Wave F: every command body lives in `oz_bridge::terminals`. What remains here
//! is the tauri-facing half — the `#[tauri::command]` shims (names, attributes,
//! params and return types unchanged), the DTO re-exports, and the one `run_*`
//! adapter that `terminals_tests.rs` still calls directly.

use tauri::State;

// `Store` and `Terminal` are no longer referenced once the bodies moved, but
// `terminals_tests.rs` reaches for them through `use super::*`.
#[allow(unused_imports)] // sibling terminals_tests.rs depends on them
use oz_core::{Store, Terminal, TerminalFeatureOverride, TerminalProfile};

use crate::error::AppError;
use crate::state::AppState;

pub use oz_bridge::terminals::{
    DEVICE_BINDING_KEYRING_NAME, DeviceBindingDto, RegisterTerminalArgs, RegisterTerminalResult,
    SetDeviceBindingArgs, SetTerminalProfileArgs, TerminalDto, TerminalProfileDto,
    UpdateTerminalArgs, UpdateTerminalResult,
};

/// List terminals from the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn list_terminals_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<TerminalDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::terminals::list_terminals_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Get a terminal from the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn get_terminal_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<TerminalDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::terminals::get_terminal_scoped(&ctx, &session_token, id)
        .await
        .map_err(Into::into)
}

/// Ping a terminal in the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn ping_terminal_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::terminals::ping_terminal_scoped(&ctx, &session_token, id)
        .await
        .map_err(Into::into)
}

/// List terminal overrides from the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn list_terminal_overrides_scoped(
    session_token: String,
    terminal_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<TerminalFeatureOverride>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::terminals::list_terminal_overrides_scoped(&ctx, &session_token, terminal_id)
        .await
        .map_err(Into::into)
}

/// List terminal profiles from the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn list_terminal_profiles_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<TerminalProfileDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::terminals::list_terminal_profiles_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Get a terminal profile from the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn get_terminal_profile_scoped(
    session_token: String,
    terminal_id: String,
    state: State<'_, AppState>,
) -> Result<Option<TerminalProfileDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::terminals::get_terminal_profile_scoped(&ctx, &session_token, terminal_id)
        .await
        .map_err(Into::into)
}

/// Get device binding from the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn get_device_binding_scoped(
    session_token: String,
    terminal_id: String,
    state: State<'_, AppState>,
) -> Result<DeviceBindingDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::terminals::get_device_binding_scoped(&ctx, &session_token, terminal_id)
        .await
        .map_err(Into::into)
}

/// Register a new terminal.
///
/// **Deprecated for multi-store (ADR #7):** Use `register_terminal_scoped`.
#[tauri::command]
pub async fn register_terminal(
    user_id: String,
    args: RegisterTerminalArgs,
    state: State<'_, AppState>,
) -> Result<RegisterTerminalResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::terminals::register_terminal(&ctx, user_id, args)
        .await
        .map_err(Into::into)
}

/// Register a terminal in the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn register_terminal_scoped(
    session_token: String,
    args: RegisterTerminalArgs,
    state: State<'_, AppState>,
) -> Result<RegisterTerminalResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::terminals::register_terminal_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// Update a terminal in the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn update_terminal_scoped(
    session_token: String,
    args: UpdateTerminalArgs,
    state: State<'_, AppState>,
) -> Result<UpdateTerminalResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::terminals::update_terminal_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// Delete a terminal in the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn delete_terminal_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::terminals::delete_terminal_scoped(&ctx, &session_token, id)
        .await
        .map_err(Into::into)
}

/// Set a terminal override in the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn set_terminal_override_scoped(
    session_token: String,
    terminal_id: String,
    feature: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::terminals::set_terminal_override_scoped(
        &ctx,
        &session_token,
        terminal_id,
        feature,
        enabled,
    )
    .await
    .map_err(Into::into)
}

/// Delete a terminal override in the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn delete_terminal_override_scoped(
    session_token: String,
    terminal_id: String,
    feature: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::terminals::delete_terminal_override_scoped(
        &ctx,
        &session_token,
        terminal_id,
        feature,
    )
    .await
    .map_err(Into::into)
}

/// Set a terminal profile in the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn set_terminal_profile_scoped(
    session_token: String,
    args: SetTerminalProfileArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::terminals::set_terminal_profile_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// Delete a terminal profile in the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn delete_terminal_profile_scoped(
    session_token: String,
    terminal_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::terminals::delete_terminal_profile_scoped(&ctx, &session_token, terminal_id)
        .await
        .map_err(Into::into)
}

/// Set a device binding in the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn set_device_binding_scoped(
    session_token: String,
    args: SetDeviceBindingArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::terminals::set_device_binding_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// Clear a device binding in the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn clear_device_binding_scoped(
    session_token: String,
    terminal_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::terminals::clear_device_binding_scoped(&ctx, &session_token, terminal_id)
        .await
        .map_err(Into::into)
}

// ── Test-facing adapter ──────────────────────────────────────────────

// Kept because terminals_tests.rs calls this helper directly; production reads
// now go through the bridge, so nothing in this module calls it.
#[allow(dead_code)]
fn run_list_terminals(conn: &rusqlite::Connection) -> Result<Vec<TerminalDto>, AppError> {
    oz_bridge::terminals::run_list_terminals(conn).map_err(Into::into)
}

#[cfg(test)]
#[path = "terminals_tests.rs"]
mod tests;
