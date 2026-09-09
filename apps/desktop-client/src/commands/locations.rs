//! Tauri commands for location-profile CRUD.
//!
//! Each command talks to the [`oz_core::Store`] facade via the shared
//! [`AppState`] database connection. The old store-profile command names
//! were retired once every client migrated to the canonical commands
//! (todo-global-saas-1.md, rename slice 1c/1d).

use oz_core::LocationProfile;
use oz_core::subscription::{SubscriptionTier, TenantSubscription};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::authz::{
    require_permission_for_session, require_permission_for_session_resource,
};
use crate::error::AppError;
use crate::state::AppState;
use oz_core::availability::UsageCounts;
use oz_core::entitlements::Entitlements;

use oz_core::db::assignments::ScopeType;
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
    // Quota tier now flows from the entitlements read model (Phase B one
    // limit table), so the gate and the caps projection share one source.
    let tier = Entitlements::from_subscription(&sub, UsageCounts::default()).tier;
    #[cfg(debug_assertions)]
    let tier = if tier == SubscriptionTier::Free {
        SubscriptionTier::Premium
    } else {
        tier
    };
    store.enforce_location_quota(&tier)?;

    // The database manager still uses the historical store-db abstraction;
    // it is a physical data-store name, not the site-unit hierarchy term.
    let _ = state.db_manager.create_store_db(&args.id);

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
    // ADR #47: the named location must be covered by the caller's
    // assignment — manager-of-A cannot update location B.
    require_permission_for_session_resource(
        &state,
        &session,
        permissions::SETTINGS_EDIT,
        ScopeType::Location,
        &args.id,
    )
    .await?;
    // ADR #48 (Decision 2): the slice-4 editor offers exactly the three
    // Indonesian IANA zones. Reject anything else at the regional write
    // boundary, fail-closed, so a malformed or legacy payload cannot persist an
    // unparseable timezone. UTC is the column default for un-migrated rows and
    // is allowed through so an unrelated field edit still saves; the editor UI
    // never offers it, so every new write carries a real zone.
    if !oz_core::regional::is_preset_location_timezone(&args.timezone)
        && !args.timezone.eq_ignore_ascii_case("UTC")
    {
        return Err(AppError::Invalid(format!(
            "timezone must be one of Asia/Jakarta, Asia/Makassar, Asia/Jayapura (got {})",
            args.timezone
        )));
    }
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
    // ADR #47: the named location must be covered by the caller's
    // assignment — manager-of-A cannot promote location B.
    require_permission_for_session_resource(
        &state,
        &session,
        permissions::SETTINGS_EDIT,
        ScopeType::Location,
        &id,
    )
    .await?;
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
    // ADR #47: the named location must be covered by the caller's
    // assignment — manager-of-A cannot delete location B.
    require_permission_for_session_resource(
        &state,
        &session,
        permissions::SETTINGS_EDIT,
        ScopeType::Location,
        &id,
    )
    .await?;
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

// ── KDS ticket prefix (W2-A consumer slice) ────────────────────
//
// Two commands over the landed core pair (`location_ticket_prefix` /
// `set_location_ticket_prefix`). The field deliberately does NOT ride on
// `LocationProfileDto`: the core slice chose the dedicated-getter shape (same
// row as `legal_entity_id`), so the profile DTO stays as wide as the table the
// settings screen reads and a prefix edit cannot fail an unrelated save.

/// Read one location's KDS ticket prefix for the session's tenant.
///
/// `None` means "no prefix" — the same sentinel the column stores as `''`.
/// There is no fallback to the legal entity's statutory fiscal prefix, by
/// design: a fiscal re-registration must not retitle kitchen tickets.
#[tauri::command]
pub async fn get_location_ticket_prefix_scoped(
    id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<String>, AppError> {
    let (session, _conn) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_READ).await?;
    let conn = _conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = oz_core::Store::new(&conn);
    Ok(store.location_ticket_prefix(&id)?)
}

/// Set (or clear) one location's KDS ticket prefix.
///
/// Returns the value AS STORED, after the core's normalization (trim +
/// ASCII-uppercase), so the caller echoes what will be enforced rather than
/// what was typed — `" kds-a "` comes back as `Some("KDS-A")`. An empty or
/// whitespace-only prefix clears it. Unknown ids are `NotFound`; a prefix
/// already used by another location of this tenant surfaces the partial
/// unique index's violation, unsmoothed.
#[tauri::command]
pub async fn set_location_ticket_prefix_scoped(
    id: String,
    prefix: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<String>, AppError> {
    let (session, _conn) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;
    // ADR #47: the named location must be covered by the caller's
    // assignment — manager-of-A cannot retitle location B's tickets.
    require_permission_for_session_resource(
        &state,
        &session,
        permissions::SETTINGS_EDIT,
        ScopeType::Location,
        &id,
    )
    .await?;
    let conn = _conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = oz_core::Store::new(&conn);
    store.set_location_ticket_prefix(&id, &prefix)?;
    Ok(store.location_ticket_prefix(&id)?)
}

#[cfg(test)]
#[path = "locations_tests.rs"]
mod tests;
