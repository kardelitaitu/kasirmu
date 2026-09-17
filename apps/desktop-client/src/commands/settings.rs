//! Settings Tauri commands: get and persist receipt display options.
/*
last audited 25-07-26 by RSA-Agent (desktop-client UI-1 investigation + fix)
crate: desktop-client | status: SAFE | lint: CLEAN
findings: UI-1 FIXED 25-07-26 — SECRET_KEY_DENY_LIST extended with stripe.api_key, square.api_key, midtrans.server_key (payment credentials never reach the renderer); gateway_status computes configured/online booleans server-side; deny-list test extended with the three keys. MOVED since (Wave E): the deny list, the key guards, run_get_setting and the extended test now live in crates/kasirmu-bridge/src/settings.rs (tests in crates/kasirmu-bridge/src/settings_tests.rs); every command in this file is a shim over that module
next: none | perf: N/A
*/
//!
//! This module exposes the receipt-related subset of the `settings` table
//! to the front-end. Other settings (store name, currency, features) are
//! managed by the setup wizard and may be exposed here in the future.

use tauri::State;

use std::collections::HashMap;

use crate::error::AppError;
use crate::state::AppState;

// The settings DTOs are defined in oz_bridge::settings (Wave E) and re-exported
// here because they name the types in the command signatures below, which are
// the IPC wire surface the renderer invokes.
pub use oz_bridge::settings::{
    CreditSaleDto, CreditSettingsDto, DeploymentInfo, GatewayStatusEntry, HardwareSettingsDto,
    ReceiptSettingsDto, StoreSettingsDto, UserPrefEntry,
};

// ── Get receipt settings ──────────────────────────────────

/// Get receipt settings resolved from a session token. ADR #7.
#[tauri::command]
pub async fn get_receipt_settings_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<ReceiptSettingsDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::settings::get_receipt_settings_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

// ── Set receipt settings ──────────────────────────────────

/// Set receipt settings resolved from a session token. ADR #7.
#[tauri::command]
pub async fn set_receipt_settings_scoped(
    session_token: String,
    args: ReceiptSettingsDto,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::settings::set_receipt_settings_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

// ── Get store settings ────────────────────────────────────────

/// Get store settings resolved from a session token. ADR #7.
#[tauri::command]
pub async fn get_store_settings_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<StoreSettingsDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::settings::get_store_settings_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

// ── Set store settings ────────────────────────────────────────

/// Set store settings resolved from a session token. ADR #7.
#[tauri::command]
pub async fn set_store_settings_scoped(
    session_token: String,
    args: StoreSettingsDto,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::settings::set_store_settings_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

// ── Credit settings ─────────────────────────────────────────────

/// Set credit settings resolved from a session token. ADR #7.
#[tauri::command]
pub async fn set_credit_settings_scoped(
    session_token: String,
    args: CreditSettingsDto,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::settings::set_credit_settings_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

// ── Credit sales ────────────────────────────────────────────────

/// List credit sales for the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn list_credit_sales_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<CreditSaleDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::settings::list_credit_sales_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Settle a credit sale resolved from a session token. ADR #7.
#[tauri::command]
pub async fn settle_credit_scoped(
    session_token: String,
    sale_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::settings::settle_credit_scoped(&ctx, &session_token, &sale_id)
        .await
        .map_err(Into::into)
}

// ── Hardware settings (printer + scanner + scale + localPrefs) ───

fn app_data_dir(state: &AppState) -> Result<std::path::PathBuf, AppError> {
    state
        .db_path
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| AppError::Internal("db_path has no parent directory".into()))
}

#[tauri::command]
/// Get hardware settings for the current terminal from the DB.
///
/// Read order:
/// 1. DB (`hardware_profiles` table) — canonical store (TODO 4e)
/// 2. JSON file (`terminal_profiles/<id>.json`) — fallback
/// 3. Old SQLite settings — legacy fallback
///
/// Returns defaults only when none of the above have saved values.
pub async fn get_hardware_settings(
    state: State<'_, AppState>,
) -> Result<HardwareSettingsDto, AppError> {
    let base_dir = app_data_dir(&state)?;
    let ctx = state.bridge_ctx();
    oz_bridge::settings::get_hardware_settings(&ctx, &base_dir)
        .await
        .map_err(Into::into)
}

/// Set hardware settings resolved from a session token. ADR #7.
///
/// Writes to both DB (canonical) and JSON file (fallback).
///
/// The `hardware_profiles` table lives in the global DB (not per-store)
/// since terminal hardware configuration is global across all stores.
/// Permission checking uses the store-scoped DB from the session.
#[tauri::command]
pub async fn set_hardware_settings_scoped(
    session_token: String,
    args: HardwareSettingsDto,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    let base_dir = app_data_dir(&state)?;
    oz_bridge::settings::set_hardware_settings_scoped(&ctx, &session_token, args, &base_dir)
        .await
        .map_err(Into::into)
}

// ── User preferences ───────────────────────────────────────────

/// Get user preferences resolved from a session token. ADR #7.
/// Uses `session.user_id` for the preference lookup.
#[tauri::command]
pub async fn get_user_preferences_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<HashMap<String, String>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::settings::get_user_preferences_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Set user preferences resolved from a session token. ADR #7.
/// Uses `session.user_id` for the preference write.
#[tauri::command]
pub async fn set_user_preferences_scoped(
    session_token: String,
    prefs: Vec<UserPrefEntry>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::settings::set_user_preferences_scoped(&ctx, &session_token, prefs)
        .await
        .map_err(Into::into)
}

// ── Generic key-value settings ────────────────────────────────

/// Read a single setting value by key.
///
/// Returns `None` when the key does not exist.
#[tauri::command]
pub async fn get_setting(
    key: String,
    state: State<'_, AppState>,
) -> Result<Option<String>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::settings::get_setting(&ctx, &key)
        .await
        .map_err(Into::into)
}

/// Report which payment gateways have credentials configured.
///
/// UI-1: computes the configured/online booleans server-side so the raw
/// credential values never leave the backend — the gateway keys are on
/// the `SECRET_KEY_DENY_LIST`, and the renderer only ever sees booleans.
#[tauri::command]
pub async fn gateway_status(
    state: State<'_, AppState>,
) -> Result<Vec<GatewayStatusEntry>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::settings::gateway_status(&ctx)
        .await
        .map_err(Into::into)
}

/// **Deprecated — use `set_setting_scoped` (ADR #7).**
///
/// Write (or overwrite) a single setting value.
///
/// Pass an empty string to store an empty value.
#[tauri::command]
pub async fn set_setting(
    key: String,
    value: String,
    user_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::settings::set_setting(&ctx, &key, &value, &user_id)
        .await
        .map_err(Into::into)
}

/// Write (or overwrite) a single setting value resolved from a session token. ADR #7.
///
/// Pass an empty string to store an empty value.
/// Writes a delta record and publishes a `SettingsUpdated` event (ADR #22).
#[tauri::command]
pub async fn set_setting_scoped(
    session_token: String,
    key: String,
    value: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::settings::set_setting_scoped(&ctx, &session_token, &key, &value)
        .await
        .map_err(Into::into)
}

// ── Batch key-value settings (single transaction) ───────────────

/// Write (or overwrite) multiple settings in a single transaction, resolved from a session token. ADR #7.
///
/// All entries are written atomically — either all succeed or none
/// do. A single `SettingsUpdated` event is published with all changed
/// keys after the transaction commits.
#[tauri::command]
pub async fn set_settings_scoped(
    session_token: String,
    entries: HashMap<String, String>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::settings::set_settings_scoped(&ctx, &session_token, entries)
        .await
        .map_err(Into::into)
}

// ── Scoped variants (ADR #7) ────────────────────────────────────

/// Get credit settings resolved from a session token. ADR #7.
#[tauri::command]
pub async fn get_credit_settings_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<CreditSettingsDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::settings::get_credit_settings_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Scoped variant of `get_setting` (ADR #7).
#[tauri::command]
pub async fn get_setting_scoped(
    key: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<String>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::settings::get_setting_scoped(&ctx, &key, &session_token)
        .await
        .map_err(Into::into)
}

/// Get hardware settings (scoped — multi-phase with session validation).
#[tauri::command]
pub async fn get_hardware_settings_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<HardwareSettingsDto, AppError> {
    let base_dir = app_data_dir(&state)?;
    let ctx = state.bridge_ctx();
    oz_bridge::settings::get_hardware_settings_scoped(&ctx, &session_token, &base_dir)
        .await
        .map_err(Into::into)
}

// ── Deployment / version read (operator tooling, saas-3 L162) ─────

/// Read-only deployment metadata for the signed-in operator. Authenticates the
/// session and checks `settings:read` inline (category 2 unscoped command).
#[tauri::command]
pub async fn get_deployment_info(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<DeploymentInfo, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::settings::get_deployment_info(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

#[cfg(test)]
#[path = "settings_tests.rs"]
mod tests;
