//! Tauri commands for store-profile CRUD — multi-store management.
//!
//! Each command talks to the `Store` facade via the shared `AppState`
//! database connection.

use oz_core::StoreProfile;
use oz_core::subscription::{SubscriptionTier, TenantSubscription};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;
use oz_core::permissions;

// ── DTOs ───────────────────────────────────────────────────────────

/// JSON-safe representation of a store profile for the front-end.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoreProfileDto {
    /// Unique identifier.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Street address.
    pub address: String,
    /// ID of the associated tax.
    pub tax_id: String,
    /// ISO-4217 currency code.
    pub currency: String,
    /// Timezone.
    pub timezone: String,
    /// Whether this is primary.
    pub is_primary: bool,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// ISO-8601 last-update timestamp.
    pub updated_at: String,
}

impl From<StoreProfile> for StoreProfileDto {
    fn from(p: StoreProfile) -> Self {
        Self {
            id: p.id,
            name: p.name,
            address: p.address,
            tax_id: p.tax_id,
            currency: p.currency,
            timezone: p.timezone,
            is_primary: p.is_primary,
            created_at: p.created_at,
            updated_at: p.updated_at,
        }
    }
}

#[derive(Debug, Deserialize)]
/// Createstoreprofileargs.
pub struct CreateStoreProfileArgs {
    /// Unique identifier.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Street address.
    pub address: Option<String>,
    /// ID of the associated tax.
    pub tax_id: Option<String>,
    /// ISO-4217 currency code.
    pub currency: Option<String>,
    /// Timezone.
    pub timezone: Option<String>,
}

#[derive(Debug, Deserialize)]
/// Updatestoreprofileargs.
pub struct UpdateStoreProfileArgs {
    /// Unique identifier.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Street address.
    pub address: String,
    /// ID of the associated tax.
    pub tax_id: String,
    /// ISO-4217 currency code.
    pub currency: String,
    /// Timezone.
    pub timezone: String,
}

// ── Commands ───────────────────────────────────────────────────────

/// Get the primary store profile.
#[tauri::command]
pub async fn get_primary_store(
    state: State<'_, AppState>,
) -> Result<Option<StoreProfileDto>, AppError> {
    let conn = state.db.lock().await;
    let store = oz_core::Store::new(&conn);
    let profile = store.get_primary_store()?;
    Ok(profile.map(StoreProfileDto::from))
}

// The core store profile CRUD logic is tested in oz-core's
// `db::locations` module (13 tests). This module only
// provides Tauri command wrappers; the facade-level tests in
// `oz-core` already validate all error paths and edge cases.

// ── Tests ──────────────────────────────────────────────────────────────

// ── Scoped variants (ADR #7) ────────────────────────────────────

/// Scoped variant of `list_store_profiles` (ADR #7).
#[tauri::command]
pub async fn list_store_profiles_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<StoreProfileDto>, AppError> {
    let (session, _conn) = state.resolve_scope(&session_token)?;
    // F-017: enforce per-domain permission on this scoped command.
    require_permission_for_session(&state, &session, permissions::SETTINGS_READ).await?;
    let conn = _conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = oz_core::Store::new(&conn);
    let profiles = store.list_store_profiles()?;
    Ok(profiles.into_iter().map(StoreProfileDto::from).collect())
}

/// Scoped variant of `get_store_profile` (ADR #7).
#[tauri::command]
pub async fn get_store_profile_scoped(
    id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<StoreProfileDto>, AppError> {
    let (session, _conn) = state.resolve_scope(&session_token)?;
    // F-017: enforce per-domain permission on this scoped command.
    require_permission_for_session(&state, &session, permissions::SETTINGS_READ).await?;
    let conn = _conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = oz_core::Store::new(&conn);
    let profile = store.get_store_profile(&id)?;
    Ok(profile.map(StoreProfileDto::from))
}

/// Scoped variant of `get_primary_store` (ADR #7).
#[tauri::command]
pub async fn get_primary_store_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<StoreProfileDto>, AppError> {
    let (session, _conn) = state.resolve_scope(&session_token)?;
    // F-017: enforce per-domain permission on this scoped command.
    require_permission_for_session(&state, &session, permissions::SETTINGS_READ).await?;
    let conn = _conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = oz_core::Store::new(&conn);
    let profile = store.get_primary_store()?;
    Ok(profile.map(StoreProfileDto::from))
}

/// Scoped variant of `create_store_profile` (ADR #7).
#[tauri::command]
pub async fn create_store_profile_scoped(
    args: CreateStoreProfileArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<StoreProfileDto, AppError> {
    let (session, _conn) = state.resolve_scope(&session_token)?;

    // F-017: enforce per-domain permission on this scoped command.

    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;
    let conn = _conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = oz_core::Store::new(&conn);

    // C1.2: enforce the subscription tier's store-count limit before creating
    // a new store — Free/Plus allow 1, Pro allows 2, Premium allows 10.
    //
    // The gate tier mirrors `get_subscription_capabilities`'s dev shim: in
    // debug builds the bootstrap Free tier is upgraded to Premium so all
    // features (including multi-branch creation) stay available during
    // development — otherwise the capabilities read reported unlimited
    // stores while this gate still rejected at 1, leaving the UI with no
    // banner and the user a dead-end error. Release enforces the real tier
    // signed by the license server.
    let sub = TenantSubscription::load(&conn, "default")?
        .ok_or_else(|| AppError::Internal("default tenant subscription not found".into()))?;
    sub.verify_signature()?;
    let tier = sub.effective_tier();
    #[cfg(debug_assertions)]
    let tier = if tier == SubscriptionTier::Free {
        SubscriptionTier::Premium
    } else {
        tier
    };
    store.enforce_store_quota(&tier)?;

    // Create the store's database file only after every gate has passed —
    // it used to run first, so every rejected create leaked an orphan
    // `store-<id>.sqlite` in the data dir (found in the wild). If DB
    // creation still fails, we insert the profile anyway — the DB can be
    // created lazily by open_store() later.
    let _ = state.db_manager.create_store_db(&args.id);

    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    let profile = StoreProfile {
        id: args.id,
        name: args.name,
        address: args.address.unwrap_or_default(),
        tax_id: args.tax_id.unwrap_or_default(),
        currency: args.currency.unwrap_or_else(|| "USD".into()),
        timezone: args.timezone.unwrap_or_else(|| "UTC".into()),
        is_primary: false,
        created_at: now.clone(),
        updated_at: now,
    };
    let created = store.create_store_profile(&profile)?;
    Ok(StoreProfileDto::from(created))
}

/// Scoped variant of `update_store_profile` (ADR #7).
#[tauri::command]
pub async fn update_store_profile_scoped(
    args: UpdateStoreProfileArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<StoreProfileDto, AppError> {
    let (session, _conn) = state.resolve_scope(&session_token)?;
    // F-017: enforce per-domain permission on this scoped command.
    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;
    let conn = _conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = oz_core::Store::new(&conn);
    let updated = store.update_store_profile(
        &args.id,
        &args.name,
        &args.address,
        &args.tax_id,
        &args.currency,
        &args.timezone,
    )?;
    Ok(StoreProfileDto::from(updated))
}

/// Scoped variant of `set_primary_store` (ADR #7).
#[tauri::command]
pub async fn set_primary_store_scoped(
    id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<StoreProfileDto, AppError> {
    let (session, _conn) = state.resolve_scope(&session_token)?;
    // F-017: enforce per-domain permission on this scoped command.
    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;
    let conn = _conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = oz_core::Store::new(&conn);
    let profile = store.set_primary_store(&id)?;
    Ok(StoreProfileDto::from(profile))
}

/// Scoped variant of `delete_store_profile` (ADR #7).
#[tauri::command]
pub async fn delete_store_profile_scoped(
    id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let (session, _conn) = state.resolve_scope(&session_token)?;
    // F-017: enforce per-domain permission on this scoped command.
    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;
    let conn = _conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = oz_core::Store::new(&conn);
    store.delete_store_profile(&id)?;
    // Release the connection before touching the filesystem.
    drop(conn);
    // The row is gone, so nothing can reach this store's database again. Deleting
    // a profile used to stop at the row and leave a multi-megabyte
    // `store-<id>.sqlite` plus its WAL/SHM sidecars orphaned in the data directory
    // with nothing pointing at it.
    //
    // A failed removal is logged rather than propagated: the profile *is* deleted,
    // and returning an error would tell the user the delete did not happen when it
    // did. A leftover file is a leak, not corruption.
    if let Err(e) = state.db_manager.delete_store_db(&id) {
        tracing::warn!(
            store_id = %id,
            error = %e,
            "store profile deleted but its database file remains"
        );
    }
    Ok(())
}

#[cfg(test)]
#[path = "store_profiles_tests.rs"]
mod tests;
