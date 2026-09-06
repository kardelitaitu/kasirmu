//! Tauri commands for location-profile CRUD.
//!
//! Each command talks to the [`oz_core::Store`] facade via the shared
//! [`AppState`] database connection. The old store-profile command names remain
//! as deprecated wire-compatible aliases until all clients migrate.

use oz_core::LocationProfile;
use oz_core::subscription::{SubscriptionTier, TenantSubscription};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;
use oz_core::permissions;

// ── DTOs ───────────────────────────────────────────────────────────

/// JSON-safe representation of a location profile for the front-end.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocationProfileDto {
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

impl From<LocationProfile> for LocationProfileDto {
    fn from(p: LocationProfile) -> Self {
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

/// Deprecated compatibility alias for the pre-Phase 1 DTO name.
#[deprecated(note = "use LocationProfileDto; Store is now Location")]
pub type StoreProfileDto = LocationProfileDto;

/// Arguments for creating a location profile.
#[derive(Debug, Deserialize)]
pub struct CreateLocationArgs {
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

/// Deprecated compatibility alias for the pre-Phase 1 argument name.
#[deprecated(note = "use CreateLocationArgs; Store is now Location")]
pub type CreateStoreProfileArgs = CreateLocationArgs;

/// Arguments for updating a location profile.
#[derive(Debug, Deserialize)]
pub struct UpdateLocationArgs {
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

/// Deprecated compatibility alias for the pre-Phase 1 argument name.
#[deprecated(note = "use UpdateLocationArgs; Store is now Location")]
pub type UpdateStoreProfileArgs = UpdateLocationArgs;

// ── Canonical commands ─────────────────────────────────────────────

/// Get the primary location profile.
#[tauri::command]
pub async fn get_primary_location(
    state: State<'_, AppState>,
) -> Result<Option<LocationProfileDto>, AppError> {
    let conn = state.db.lock().await;
    let store = oz_core::Store::new(&conn);
    let profile = store.get_primary_location()?;
    Ok(profile.map(LocationProfileDto::from))
}

/// List location profiles for the session's tenant (ADR #7).
#[tauri::command]
pub async fn list_locations_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<LocationProfileDto>, AppError> {
    let (session, _conn) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_READ).await?;
    let conn = _conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = oz_core::Store::new(&conn);
    let profiles = store.list_locations()?;
    Ok(profiles.into_iter().map(LocationProfileDto::from).collect())
}

/// Get a location profile for the session's tenant (ADR #7).
#[tauri::command]
pub async fn get_location_profile_scoped(
    id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<LocationProfileDto>, AppError> {
    let (session, _conn) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_READ).await?;
    let conn = _conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = oz_core::Store::new(&conn);
    let profile = store.get_location_profile(&id)?;
    Ok(profile.map(LocationProfileDto::from))
}

/// Get the primary location for the session's tenant (ADR #7).
#[tauri::command]
pub async fn get_primary_location_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<LocationProfileDto>, AppError> {
    let (session, _conn) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_READ).await?;
    let conn = _conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = oz_core::Store::new(&conn);
    let profile = store.get_primary_location()?;
    Ok(profile.map(LocationProfileDto::from))
}

/// Create a location profile for the session's tenant (ADR #7).
#[tauri::command]
pub async fn create_location_profile_scoped(
    args: CreateLocationArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<LocationProfileDto, AppError> {
    let (session, _conn) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;
    let conn = _conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = oz_core::Store::new(&conn);

    // C1.2: enforce the subscription tier's location-count limit before
    // creating a new location. Debug builds mirror the capability command's
    // bootstrap-Free development shim.
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
    store.enforce_location_quota(&tier)?;

    // The database manager still uses the historical store-db abstraction;
    // it is a physical data-store name, not the site-unit hierarchy term.
    // A failed side-car database is not fatal to the profile row itself,
    // but it must not pass silently (mirrors the delete-path warning below).
    if let Err(e) = state.db_manager.create_store_db(&args.id) {
        tracing::warn!(
            location_id = %args.id,
            error = %e,
            "location profile created but its database file could not be created"
        );
    }

    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let profile = LocationProfile {
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
    let created = store.create_location_profile(&profile)?;
    Ok(LocationProfileDto::from(created))
}

/// Update a location profile for the session's tenant (ADR #7).
#[tauri::command]
pub async fn update_location_profile_scoped(
    args: UpdateLocationArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<LocationProfileDto, AppError> {
    let (session, _conn) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;
    let conn = _conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = oz_core::Store::new(&conn);
    let updated = store.update_location_profile(
        &args.id,
        &args.name,
        &args.address,
        &args.tax_id,
        &args.currency,
        &args.timezone,
    )?;
    Ok(LocationProfileDto::from(updated))
}

/// Set a location as primary for the session's tenant (ADR #7).
#[tauri::command]
pub async fn set_primary_location_scoped(
    id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<LocationProfileDto, AppError> {
    let (session, _conn) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;
    let conn = _conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = oz_core::Store::new(&conn);
    let profile = store.set_primary_location(&id)?;
    Ok(LocationProfileDto::from(profile))
}

/// Delete a location profile for the session's tenant (ADR #7).
#[tauri::command]
pub async fn delete_location_profile_scoped(
    id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let (session, _conn) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;
    let conn = _conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = oz_core::Store::new(&conn);
    store.delete_location_profile(&id)?;
    drop(conn);
    if let Err(e) = state.db_manager.delete_store_db(&id) {
        tracing::warn!(
            location_id = %id,
            error = %e,
            "location profile deleted but its database file remains"
        );
    }
    Ok(())
}

// ── Deprecated wire-compatible aliases ─────────────────────────────

/// Deprecated alias for [`get_primary_location`].
#[deprecated(note = "use get_primary_location")]
#[tauri::command]
pub async fn get_primary_store(
    state: State<'_, AppState>,
) -> Result<Option<LocationProfileDto>, AppError> {
    get_primary_location(state).await
}

/// Deprecated alias for [`list_locations_scoped`].
#[deprecated(note = "use list_locations_scoped")]
#[tauri::command]
pub async fn list_store_profiles_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<LocationProfileDto>, AppError> {
    list_locations_scoped(session_token, state).await
}

/// Deprecated alias for [`get_location_profile_scoped`].
#[deprecated(note = "use get_location_profile_scoped")]
#[tauri::command]
pub async fn get_store_profile_scoped(
    id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<LocationProfileDto>, AppError> {
    get_location_profile_scoped(id, session_token, state).await
}

/// Deprecated alias for [`get_primary_location_scoped`].
#[deprecated(note = "use get_primary_location_scoped")]
#[tauri::command]
pub async fn get_primary_store_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<LocationProfileDto>, AppError> {
    get_primary_location_scoped(session_token, state).await
}

/// Deprecated alias for [`create_location_profile_scoped`].
#[deprecated(note = "use create_location_profile_scoped")]
#[tauri::command]
pub async fn create_store_profile_scoped(
    args: CreateLocationArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<LocationProfileDto, AppError> {
    create_location_profile_scoped(args, session_token, state).await
}

/// Deprecated alias for [`update_location_profile_scoped`].
#[deprecated(note = "use update_location_profile_scoped")]
#[tauri::command]
pub async fn update_store_profile_scoped(
    args: UpdateLocationArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<LocationProfileDto, AppError> {
    update_location_profile_scoped(args, session_token, state).await
}

/// Deprecated alias for [`set_primary_location_scoped`].
#[deprecated(note = "use set_primary_location_scoped")]
#[tauri::command]
pub async fn set_primary_store_scoped(
    id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<LocationProfileDto, AppError> {
    set_primary_location_scoped(id, session_token, state).await
}

/// Deprecated alias for [`delete_location_profile_scoped`].
#[deprecated(note = "use delete_location_profile_scoped")]
#[tauri::command]
pub async fn delete_store_profile_scoped(
    id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    delete_location_profile_scoped(id, session_token, state).await
}

#[cfg(test)]
#[path = "locations_tests.rs"]
mod tests;
