//! Settings Tauri commands: get and persist receipt display options.
/*
last audited 25-07-26 by RSA-Agent (desktop-client UI-1 investigation + fix)
crate: desktop-client | status: SAFE | lint: CLEAN
findings: UI-1 FIXED 25-07-26 — SECRET_KEY_DENY_LIST extended with stripe.api_key, square.api_key, midtrans.server_key (payment credentials never reach the renderer); new gateway_status command computes configured/online booleans server-side; deny-list test extended with the three keys. Verified during UI-1: deny-list check on run_get_setting, scoped variants delegate to it
next: none | perf: N/A
*/
//!
//! This module exposes the receipt-related subset of the `settings` table
//! to the front-end. Other settings (store name, currency, features) are
//! managed by the setup wizard and may be exposed here in the future.

#[allow(unused_imports)] // sibling settings_tests.rs depends on the derives
use serde::{Deserialize, Serialize};
use tauri::State;

use std::collections::HashMap;

#[allow(unused_imports)]
// the write commands moved to oz_bridge::settings; the relocated test surface may still depend on it
use oz_core::permissions;
#[allow(unused_imports)]
// the write commands moved to oz_bridge::settings; the relocated test surface may still depend on it
use oz_core::{Settings, Store, UserPreferences};

#[allow(unused_imports)]
// the write commands moved to oz_bridge::settings; the relocated test surface may still depend on it
use platform_core::terminal_profile::TerminalProfile;

#[allow(unused_imports)] // the writer commands and sibling settings_tests.rs depend on it
use crate::commands::authz::require_permission_for_session;
#[allow(unused_imports)] // set_setting gate sites moved to ctx.require_permission_for_user
use crate::commands::authz::require_permission_for_user;
use crate::error::AppError;
use crate::state::AppState;

// The shared key guards, the DTOs and the read-side business logic live in
// oz_bridge::settings (Wave E). They are re-exported here so the sibling
// settings_tests.rs mount keeps resolving them by name and so commands/data.rs
// keeps reaching is_non_exportable_key without any edit on its side.
pub(crate) use oz_bridge::settings::is_non_exportable_key;
pub use oz_bridge::settings::{
    CreditSaleDto, CreditSettingsDto, DeploymentInfo, GatewayStatusEntry, HardwareSettingsDto,
    ReceiptSettingsDto, SECRET_KEY_DENY_LIST, StoreSettingsDto, UserPrefEntry, is_managed_key,
    is_secret_key, managed_key_owner,
};

// ── Receipt settings DTO ─────────────────────────────────

// ── Get receipt settings ──────────────────────────────────

#[tauri::command]
/// Get receipt settings.
pub async fn get_receipt_settings(
    state: State<'_, AppState>,
) -> Result<ReceiptSettingsDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::settings::get_receipt_settings(&ctx)
        .await
        .map_err(Into::into)
}

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

// ── Store info DTO ────────────────────────────────────────────

// ── Get store settings ────────────────────────────────────────

#[tauri::command]
/// Get store settings.
pub async fn get_store_settings(state: State<'_, AppState>) -> Result<StoreSettingsDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::settings::get_store_settings(&ctx)
        .await
        .map_err(Into::into)
}

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

// ── Credit Settings DTO ─────────────────────────────────────────

#[tauri::command]
/// Get credit settings.
pub async fn get_credit_settings(
    state: State<'_, AppState>,
) -> Result<CreditSettingsDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::settings::get_credit_settings(&ctx)
        .await
        .map_err(Into::into)
}

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

// ── Credit sale DTO ──────────────────────────────────────────────

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

/// Scoped variant of `get_credit_settings` (ADR #7).
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

// Adapters over the moved business logic.

// settings_tests.rs calls these by name and matches AppError variants, so they
// stay in this module as thin AppError-returning wrappers over the bridge. The
// write commands below still call run_set_setting and enqueue_settings_updates.

#[allow(dead_code)]
fn run_get_receipt_settings(conn: &rusqlite::Connection) -> Result<ReceiptSettingsDto, AppError> {
    oz_bridge::settings::run_get_receipt_settings(conn).map_err(Into::into)
}

#[allow(dead_code)]
fn run_get_store_settings(conn: &rusqlite::Connection) -> Result<StoreSettingsDto, AppError> {
    oz_bridge::settings::run_get_store_settings(conn).map_err(Into::into)
}

#[allow(dead_code)]
fn run_list_credit_sales(conn: &rusqlite::Connection) -> Result<Vec<CreditSaleDto>, AppError> {
    oz_bridge::settings::run_list_credit_sales(conn).map_err(Into::into)
}

#[allow(dead_code)]
fn run_get_setting(conn: &rusqlite::Connection, key: &str) -> Result<Option<String>, AppError> {
    oz_bridge::settings::run_get_setting(conn, key).map_err(Into::into)
}

#[allow(dead_code)]
fn run_set_setting(
    conn: &rusqlite::Connection,
    key: &str,
    value: &str,
    terminal_id: &str,
) -> Result<(), AppError> {
    oz_bridge::settings::run_set_setting(conn, key, value, terminal_id).map_err(Into::into)
}

#[allow(dead_code)]
fn enqueue_settings_updates(
    store: &Store,
    entries: &HashMap<String, String>,
    terminal_id: &str,
    tenant_id: &str,
) -> Result<(), AppError> {
    oz_bridge::settings::enqueue_settings_updates(store, entries, terminal_id, tenant_id)
        .map_err(Into::into)
}

#[allow(dead_code)]
fn build_deployment_info() -> DeploymentInfo {
    oz_bridge::settings::build_deployment_info()
}

#[allow(dead_code)]
fn run_set_receipt_settings(
    conn: &rusqlite::Connection,
    args: &ReceiptSettingsDto,
) -> Result<(), AppError> {
    oz_bridge::settings::run_set_receipt_settings(conn, args).map_err(Into::into)
}

#[allow(dead_code)]
fn run_set_store_settings(
    conn: &rusqlite::Connection,
    args: &StoreSettingsDto,
) -> Result<(), AppError> {
    oz_bridge::settings::run_set_store_settings(conn, args).map_err(Into::into)
}
