//! Location-profile commands (Wave E / E7) — the tauri-free half of
//! `apps/desktop-client/src/commands/locations.rs`.
//!
//! Every operation talks to the [`oz_core::Store`] facade over the session's
//! store-scoped connection, exactly as the shell did: the store DB is opened
//! through [`BridgeCtx::resolve_scope`] and wrapped with `Store::new`
//! (cache-free), so location-row cache invalidation and location-scoped store
//! opening stay on the original code path. The unscoped [`get_primary_location`]
//! still reads the GLOBAL database, unchanged.
//!
//! Gate order is verbatim: resolve the session scope, authorize
//! `settings:read` / `settings:edit` against the GLOBAL identity DB (ADR #4/#7),
//! and — on the four location-named writes — the ADR #47 hierarchical
//! location-resource gate ([`BridgeCtx::require_permission_for_session_resource`],
//! the ctx port of `commands/authz.rs::require_permission_for_session_resource`)
//! before the store connection is locked. The create path keeps its C1.2
//! subscription-quota gate (including the debug Free -> Premium shim) and the
//! physical store-db creation; the delete path keeps its drop-then-delete-db
//! ordering and the warn-on-residue log. The ADR #48 timezone check keeps its
//! exact message, guard placement (before the store lock) and fail-closed shape.
//!
//! Wire contract is unchanged: `LocationProfileDto` keeps its snake_case field names;
//! the DTOs moved here with the bodies and are re-exported by the desktop
//! module, so `use super::*` in `locations_tests.rs` still resolves them.

use serde::{Deserialize, Serialize};

use oz_core::LocationProfile;
use oz_core::availability::UsageCounts;
use oz_core::db::Store;
use oz_core::db::assignments::ScopeType;
use oz_core::entitlements::Entitlements;
use oz_core::permissions;
use oz_core::subscription::{SubscriptionTier, TenantSubscription};

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

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

/// Get the primary location profile (global DB, unscoped).
///
/// # Errors
///
/// Returns [`BridgeError::Core`] on DB errors.
pub async fn get_primary_location(
    ctx: &BridgeCtx<'_>,
) -> Result<Option<LocationProfileDto>, BridgeError> {
    let conn = ctx.lock_global().await;
    let store = Store::new(&conn);
    let profile = store.get_primary_location()?;
    Ok(profile.map(LocationProfileDto::from))
}

/// List location profiles for the session's tenant (ADR #7).
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown/expired token,
/// [`BridgeError::PermissionDenied`] without `settings:read`,
/// [`BridgeError::Internal`] when the store lock is poisoned, and
/// [`BridgeError::Core`] on DB errors.
pub async fn list_locations_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<LocationProfileDto>, BridgeError> {
    let (session, _conn) = ctx.resolve_scope(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_READ)
        .await?;
    let conn = _conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&conn);
    let profiles = store.list_locations()?;
    Ok(profiles.into_iter().map(LocationProfileDto::from).collect())
}

/// Get a location profile for the session's tenant (ADR #7).
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown/expired token,
/// [`BridgeError::PermissionDenied`] without `settings:read`,
/// [`BridgeError::Internal`] when the store lock is poisoned, and
/// [`BridgeError::Core`] on DB errors.
pub async fn get_location_profile_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    id: &str,
) -> Result<Option<LocationProfileDto>, BridgeError> {
    let (session, _conn) = ctx.resolve_scope(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_READ)
        .await?;
    let conn = _conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&conn);
    let profile = store.get_location_profile(id)?;
    Ok(profile.map(LocationProfileDto::from))
}

/// Get the primary location for the session's tenant (ADR #7).
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown/expired token,
/// [`BridgeError::PermissionDenied`] without `settings:read`,
/// [`BridgeError::Internal`] when the store lock is poisoned, and
/// [`BridgeError::Core`] on DB errors.
pub async fn get_primary_location_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Option<LocationProfileDto>, BridgeError> {
    let (session, _conn) = ctx.resolve_scope(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_READ)
        .await?;
    let conn = _conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&conn);
    let profile = store.get_primary_location()?;
    Ok(profile.map(LocationProfileDto::from))
}

/// Create a location profile for the session's tenant (ADR #7).
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown/expired token,
/// [`BridgeError::PermissionDenied`] without `settings:edit`,
/// [`BridgeError::Internal`] when the store lock is poisoned or the default
/// tenant subscription row is missing, and [`BridgeError::Core`] on DB and
/// subscription-limit errors.
pub async fn create_location_profile_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: &CreateLocationArgs,
) -> Result<LocationProfileDto, BridgeError> {
    let (session, _conn) = ctx.resolve_scope(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_EDIT)
        .await?;
    let conn = _conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&conn);

    // C1.2: enforce the subscription tier's location-count limit before
    // creating a new location. Debug builds mirror the capability command's
    // bootstrap-Free development shim.
    let sub = TenantSubscription::load(&conn, "default")?
        .ok_or_else(|| BridgeError::Internal("default tenant subscription not found".into()))?;
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
    let _ = ctx.db_manager.create_store_db(&args.id);

    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let profile = LocationProfile {
        id: args.id.clone(),
        name: args.name.clone(),
        address: args.address.clone().unwrap_or_default(),
        tax_id: args.tax_id.clone().unwrap_or_default(),
        currency: args.currency.clone().unwrap_or_else(|| "USD".into()),
        timezone: args.timezone.clone().unwrap_or_else(|| "UTC".into()),
        is_primary: false,
        created_at: now.clone(),
        updated_at: now,
    };
    let created = store.create_location_profile(&profile)?;
    Ok(LocationProfileDto::from(created))
}

/// Update a location profile for the session's tenant (ADR #7).
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown/expired token,
/// [`BridgeError::PermissionDenied`] without `settings:edit` or when the
/// caller's assignment does not COVER the named location (ADR #47),
/// [`BridgeError::Invalid`] for a timezone outside the presets,
/// [`BridgeError::Internal`] when the store lock is poisoned, and
/// [`BridgeError::Core`] on DB errors.
pub async fn update_location_profile_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: &UpdateLocationArgs,
) -> Result<LocationProfileDto, BridgeError> {
    let (session, _conn) = ctx.resolve_scope(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_EDIT)
        .await?;
    // ADR #47: the named location must be covered by the caller's
    // assignment — manager-of-A cannot update location B.
    ctx.require_permission_for_session_resource(
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
        return Err(BridgeError::Invalid(format!(
            "timezone must be one of Asia/Jakarta, Asia/Makassar, Asia/Jayapura (got {})",
            args.timezone
        )));
    }
    let conn = _conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&conn);
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
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown/expired token,
/// [`BridgeError::PermissionDenied`] without `settings:edit` or when the
/// caller's assignment does not COVER the named location (ADR #47),
/// [`BridgeError::Internal`] when the store lock is poisoned, and
/// [`BridgeError::Core`] on DB errors.
pub async fn set_primary_location_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    id: &str,
) -> Result<LocationProfileDto, BridgeError> {
    let (session, _conn) = ctx.resolve_scope(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_EDIT)
        .await?;
    // ADR #47: the named location must be covered by the caller's
    // assignment — manager-of-A cannot promote location B.
    ctx.require_permission_for_session_resource(
        &session,
        permissions::SETTINGS_EDIT,
        ScopeType::Location,
        id,
    )
    .await?;
    let conn = _conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&conn);
    let profile = store.set_primary_location(id)?;
    Ok(LocationProfileDto::from(profile))
}

/// Delete a location profile for the session's tenant (ADR #7).
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown/expired token,
/// [`BridgeError::PermissionDenied`] without `settings:edit` or when the
/// caller's assignment does not COVER the named location (ADR #47),
/// [`BridgeError::Internal`] when the store lock is poisoned, and
/// [`BridgeError::Core`] on DB errors.
pub async fn delete_location_profile_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    id: &str,
) -> Result<(), BridgeError> {
    let (session, _conn) = ctx.resolve_scope(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_EDIT)
        .await?;
    // ADR #47: the named location must be covered by the caller's
    // assignment — manager-of-A cannot delete location B.
    ctx.require_permission_for_session_resource(
        &session,
        permissions::SETTINGS_EDIT,
        ScopeType::Location,
        id,
    )
    .await?;
    let conn = _conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&conn);
    store.delete_location_profile(id)?;
    drop(conn);
    if let Err(e) = ctx.db_manager.delete_store_db(id) {
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
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown/expired token,
/// [`BridgeError::PermissionDenied`] without `settings:read`,
/// [`BridgeError::Internal`] when the store lock is poisoned, and
/// [`BridgeError::Core`] on DB errors.
pub async fn get_location_ticket_prefix_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    id: &str,
) -> Result<Option<String>, BridgeError> {
    let (session, _conn) = ctx.resolve_scope(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_READ)
        .await?;
    let conn = _conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&conn);
    Ok(store.location_ticket_prefix(id)?)
}

/// Set (or clear) one location's KDS ticket prefix.
///
/// Returns the value AS STORED, after the core's normalization (trim +
/// ASCII-uppercase), so the caller echoes what will be enforced rather than
/// what was typed — `" kds-a "` comes back as `Some("KDS-A")`. An empty or
/// whitespace-only prefix clears it. Unknown ids are `NotFound`; a prefix
/// already used by another location of this tenant surfaces the partial
/// unique index's violation, unsmoothed.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown/expired token,
/// [`BridgeError::PermissionDenied`] without `settings:edit` or when the
/// caller's assignment does not COVER the named location (ADR #47),
/// [`BridgeError::Internal`] when the store lock is poisoned, and
/// [`BridgeError::Core`] on DB errors.
pub async fn set_location_ticket_prefix_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    id: &str,
    prefix: &str,
) -> Result<Option<String>, BridgeError> {
    let (session, _conn) = ctx.resolve_scope(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_EDIT)
        .await?;
    // ADR #47: the named location must be covered by the caller's
    // assignment — manager-of-A cannot retitle location B's tickets.
    ctx.require_permission_for_session_resource(
        &session,
        permissions::SETTINGS_EDIT,
        ScopeType::Location,
        id,
    )
    .await?;
    let conn = _conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&conn);
    store.set_location_ticket_prefix(id, prefix)?;
    Ok(store.location_ticket_prefix(id)?)
}

#[cfg(test)]
#[path = "locations_tests.rs"]
mod locations_tests;
