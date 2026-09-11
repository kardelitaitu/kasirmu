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

use oz_core::permissions;
use oz_core::{Settings, Store, UserPreferences};

use platform_core::terminal_profile::TerminalProfile;

#[allow(unused_imports)] // the writer commands and sibling settings_tests.rs depend on it
use crate::commands::authz::require_permission_for_session;
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
    let session = state.resolve_session(&session_token)?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = oz_core::db::Store::new(&db);
    require_permission_for_user(&store, &session.user_id, permissions::SETTINGS_EDIT)?;
    run_set_receipt_settings(&db, &args)
}

/// Business logic for `set_receipt_settings` (extracted for testing).
fn run_set_receipt_settings(
    conn: &rusqlite::Connection,
    args: &ReceiptSettingsDto,
) -> Result<(), AppError> {
    let tx = conn.unchecked_transaction()?;

    Settings::set_receipt_show_currency(&tx, args.show_currency)?;
    Settings::set_receipt_decimal_separator(&tx, &args.decimal_separator)?;
    Settings::set_receipt_show_tax(&tx, args.show_tax)?;
    Settings::set_receipt_footer(&tx, &args.footer)?;
    Settings::set_receipt_paper_width(&tx, &args.paper_width)?;
    Settings::set_receipt_show_table_number(&tx, args.show_table_number)?;
    Settings::set_receipt_margin_top(&tx, args.margin_top)?;
    Settings::set_receipt_margin_bottom(&tx, args.margin_bottom)?;
    Settings::set_receipt_margin_left(&tx, args.margin_left)?;
    Settings::set_receipt_margin_right(&tx, args.margin_right)?;
    Settings::set_tax_rounding_mode_str(&tx, &args.tax_rounding_mode)?;

    tx.commit()?;

    Ok(())
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
    let session = state.resolve_session(&session_token)?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = oz_core::db::Store::new(&db);
    require_permission_for_user(&store, &session.user_id, permissions::SETTINGS_EDIT)?;
    run_set_store_settings(&db, &args)
}

/// Business logic for `set_store_settings` (extracted for testing).
fn run_set_store_settings(
    conn: &rusqlite::Connection,
    args: &StoreSettingsDto,
) -> Result<(), AppError> {
    let tx = conn.unchecked_transaction()?;

    Settings::set_store_name(&tx, &args.name)?;
    Settings::set_store_address(&tx, &args.address)?;
    Settings::set_store_tax_id(&tx, &args.tax_id)?;
    Settings::set_default_currency(&tx, &args.currency)?;
    Settings::set_store_branch(&tx, &args.branch)?;
    Settings::set_store_logo(&tx, &args.logo)?;

    tx.commit()?;

    Ok(())
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
    let session = state.resolve_session(&session_token)?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = oz_core::db::Store::new(&db);
    require_permission_for_user(&store, &session.user_id, permissions::SETTINGS_EDIT)?;
    let tx = db.unchecked_transaction()?;
    Settings::set_credit_enabled(&tx, args.enabled)?;
    Settings::set_credit_reminder_interval(&tx, args.reminder_interval_hours)?;
    Settings::set_credit_max_limit(&tx, args.max_limit_minor)?;
    tx.commit()?;
    Ok(())
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
    let session = state.resolve_session(&session_token)?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = oz_core::db::Store::new(&db);
    require_permission_for_user(&store, &session.user_id, permissions::SETTINGS_EDIT)?;
    let tx = db.unchecked_transaction()?;
    let now = chrono::Utc::now().to_rfc3339();
    tx.execute(
        "UPDATE payments SET settled_at = ?1 WHERE sale_id = ?2 AND method = 'credit'",
        rusqlite::params![now, sale_id],
    )?;
    tx.commit()?;
    Ok(())
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
    let session = state.resolve_session(&session_token)?;

    // Extract terminal_id before locking DB (avoids Send guard across .await).
    let terminal_id = state
        .terminal_id
        .lock()
        .await
        .clone()
        .unwrap_or_else(|| "unknown".to_string());

    // Permission check requires the store-scoped DB.
    {
        let conn = state
            .db_manager
            .open_store(&session.store_id)
            .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
        let db = conn
            .lock()
            .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
        let store = oz_core::db::Store::new(&db);
        require_permission_for_user(&store, &session.user_id, permissions::SETTINGS_EDIT)?;
    }

    let profile = TerminalProfile::from(args);
    let json = serde_json::to_string(&profile)
        .map_err(|e| AppError::Internal(format!("serializing profile: {e}")))?;

    // Write to DB (canonical store).
    // We use the global DB since hardware_profiles is a global table.
    {
        let conn = state.db.lock().await;
        conn.execute(
            "INSERT OR REPLACE INTO hardware_profiles (terminal_id, profile_json, schema_version, updated_at)
             VALUES (?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
            rusqlite::params![&terminal_id, &json, profile.schema_version],
        )?;
    }

    // Write to JSON file (backward compat fallback).
    let base_dir = app_data_dir(&state)?;
    let path = TerminalProfile::profile_path(&base_dir, &terminal_id);
    if let Err(e) = profile.save(&path) {
        tracing::warn!(
            terminal_id = %terminal_id,
            error = %e,
            "failed to save hardware settings to JSON — DB write succeeded"
        );
    }

    Ok(())
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
    let session = state.resolve_session(&session_token)?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let pairs: Vec<(String, String)> = prefs.into_iter().map(|e| (e.key, e.value)).collect();
    Ok(UserPreferences::set_batch(&db, &session.user_id, &pairs)?)
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
    // Extract terminal_id first.
    let terminal_id = state
        .terminal_id
        .lock()
        .await
        .clone()
        .unwrap_or_else(|| "unknown".to_string());

    // Scope block: drop sync guards before .await below.
    {
        let conn = state.db.lock().await;
        let store = oz_core::db::Store::new(&conn);
        require_permission_for_user(&store, &user_id, permissions::SETTINGS_EDIT)?;
        run_set_setting(&conn, &key, &value, &terminal_id)?;
        if let Err(e) = enqueue_settings_updates(
            &store,
            &HashMap::from([(key.clone(), value.clone())]),
            &terminal_id,
            "default",
        ) {
            tracing::warn!(key = %key, error = %e, "failed to enqueue settings.update sync item");
        }
    } // conn, store dropped here

    // Publish SettingsUpdated event for cross-terminal reactivity (ADR #22).
    let kernel = state.kernel.lock().await;
    let bus = kernel.event_bus();
    let event = oz_core::events::SettingsUpdated {
        changed_keys: vec![key.clone()],
        terminal_id,
    };
    if let Err(e) = bus.publish(&event) {
        tracing::warn!(key = %key, error = %e, "failed to publish SettingsUpdated event");
    }

    Ok(())
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
    let session = state.resolve_session(&session_token)?;

    // Extract terminal_id before locking the store DB to avoid
    // holding a non-Send MutexGuard across an .await point.
    let terminal_id = state
        .terminal_id
        .lock()
        .await
        .clone()
        .unwrap_or_else(|| "unknown".to_string());

    // Scope block: all sync guards (MutexGuard, Store) must be
    // dropped before any .await below.
    {
        let conn = state
            .db_manager
            .open_store(&session.store_id)
            .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
        let db = conn
            .lock()
            .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
        let store = oz_core::db::Store::new(&db);
        require_permission_for_user(&store, &session.user_id, permissions::SETTINGS_EDIT)?;
        run_set_setting(&db, &key, &value, &terminal_id)?;
    } // db, store, conn dropped here — safe to .await below

    // Enqueue `settings.update` sync items on the GLOBAL db — the sync
    // daemon only watches the global queue, so a store-scoped write must
    // fan out from here (SYNC-10 enqueue side).
    {
        let conn = state.db.lock().await;
        let store = oz_core::db::Store::new(&conn);
        if let Err(e) = enqueue_settings_updates(
            &store,
            &HashMap::from([(key.clone(), value.clone())]),
            &terminal_id,
            &session.store_id,
        ) {
            tracing::warn!(key = %key, error = %e, "failed to enqueue settings.update sync item");
        }
    } // conn dropped — safe to .await below

    // Publish SettingsUpdated event for cross-terminal reactivity (ADR #22).
    let kernel = state.kernel.lock().await;
    let bus = kernel.event_bus();
    let event = oz_core::events::SettingsUpdated {
        changed_keys: vec![key.clone()],
        terminal_id,
    };
    if let Err(e) = bus.publish(&event) {
        tracing::warn!(key = %key, error = %e, "failed to publish SettingsUpdated event");
    }

    Ok(())
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
    let session = state.resolve_session(&session_token)?;

    // Managed keys are rejected batch-wide before any write so the
    // all-or-nothing transaction semantics hold (same guard as
    // `run_set_setting`; the batch loop below bypasses it by design).
    if let Some(key) = entries.keys().find(|k| is_managed_key(k)) {
        let owner = managed_key_owner(key).unwrap_or("a dedicated");
        return Err(AppError::Invalid(format!(
            "{key} is managed by the {owner} controls — use those"
        )));
    }

    let terminal_id = state
        .terminal_id
        .lock()
        .await
        .clone()
        .unwrap_or_else(|| "unknown".to_string());

    let keys: Vec<String> = entries.keys().cloned().collect();

    {
        let conn = state
            .db_manager
            .open_store(&session.store_id)
            .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
        let db = conn
            .lock()
            .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
        let store = oz_core::db::Store::new(&db);
        require_permission_for_user(&store, &session.user_id, permissions::SETTINGS_EDIT)?;
        let tx = db.unchecked_transaction()?;
        for (key, value) in &entries {
            Settings::set_tracked(&tx, key, value, &terminal_id)?;
        }
        tx.commit()?;
    }

    // Enqueue `settings.update` sync items on the GLOBAL db — the sync
    // daemon only watches the global queue, so a store-scoped write must
    // fan out from here (SYNC-10 enqueue side).
    {
        let conn = state.db.lock().await;
        let store = oz_core::db::Store::new(&conn);
        if let Err(e) = enqueue_settings_updates(&store, &entries, &terminal_id, &session.store_id)
        {
            tracing::warn!(key_count = entries.len(), error = %e, "failed to enqueue settings.update sync items");
        }
    } // conn dropped — safe to .await below

    // Publish a single SettingsUpdated event for all changed keys.
    let kernel = state.kernel.lock().await;
    let bus = kernel.event_bus();
    let event = oz_core::events::SettingsUpdated {
        changed_keys: keys,
        terminal_id,
    };
    if let Err(e) = bus.publish(&event) {
        tracing::warn!(
            key_count = entries.len(),
            error = %e,
            "failed to publish SettingsUpdated event"
        );
    }

    Ok(())
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

#[cfg(test)]
#[path = "settings_tests.rs"]
mod tests;
