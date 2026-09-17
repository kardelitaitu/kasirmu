//! Regional-configuration command bodies (Wave A / S6) — the tauri-free half
//! of `apps/desktop-client/src/commands/regional.rs`.
//!
//! Key functions: [`get_scoped`] (the slice-2 read model) and [`set_scoped`]
//! (the slice-3 write counterpart), each consuming a [`BridgeCtx`], plus the
//! [`SetRegionalConfig`] write payload.
//!
//! Gate order and store construction (`Store::new`, cache-free — as the shell
//! used) are verbatim ports of the command bodies: resolve the session scope,
//! authorize `settings:read` / `settings:edit` against the GLOBAL identity DB
//! (ADR #4/#7), and — for the write only — the ADR #47 location-resource
//! gate, before the store connection is opened.
//!
//! Wire contract is unchanged: the core `RegionalConfig` is returned as-is
//! (its snake_case field names are the IPC contract, `kasirmu_core::regional`), and
//! every axis value is validated by the core, which also owns the ADR #48
//! IANA-timezone contract. This module adds no validation of its own and
//! never touches a column directly.

use serde::Deserialize;

use kasirmu_core::RegionalConfig;
use kasirmu_core::db::Store;
use kasirmu_core::db::assignments::ScopeType;
use kasirmu_core::permissions;
use kasirmu_core::session::SessionContext;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// The write payload for the regional-config set command. Field names match
/// the axis names in `locations`/`legal_entities` (snake_case on the wire, like
/// the read model); "" means "clear, inherit from the scope above".
#[derive(Deserialize)]
pub struct SetRegionalConfig {
    /// Locale override (BCP-47); blank to inherit.
    #[serde(default)]
    pub locale: String,
    /// Timezone (IANA preset or the legacy `UTC` sentinel); blank clears
    /// the column so the chain inherits from the scope above.
    #[serde(default)]
    pub timezone: String,
    /// Currency override (ISO-4217 alpha-3); blank to inherit.
    #[serde(default)]
    pub currency: String,
    /// Market anchor (ISO-3166 alpha-2), resolved through the linked legal
    /// entity; blank leaves the entity's anchor untouched.
    #[serde(default)]
    pub country_code: String,
}

/// Map a gate denial to the client's `permissionDenied` wire shape.
///
/// Local mirror of the private helper in [`crate::ctx`]: the ADR #47
/// resource gate is the one check `BridgeCtx` does not expose, so it is
/// carried here with the same `PermissionDenied` → [`BridgeError::PermissionDenied`]
/// translation the authz seam applies.
fn map_gate_error(e: kasirmu_core::CoreError) -> BridgeError {
    match e {
        kasirmu_core::CoreError::PermissionDenied(message) => BridgeError::PermissionDenied(message),
        other => BridgeError::from(other),
    }
}

/// The ADR #47 hierarchical-resource session gate, against the GLOBAL
/// identity DB.
///
/// Port of `commands/authz.rs::require_permission_for_session_resource`:
/// everything [`BridgeCtx::require_session_permission`] enforces, PLUS the
/// caller's assignment must COVER the named resource (downward-only
/// inheritance; sibling and upward access deny, unknown locations deny
/// fail-closed). Legacy users without an assignment row are not
/// scope-restricted; the permission itself is enforced on every path.
///
/// # Errors
///
/// Returns [`BridgeError::PermissionDenied`] on any denial,
/// [`BridgeError::Core`] on DB errors.
async fn require_session_resource_permission(
    ctx: &BridgeCtx<'_>,
    session: &SessionContext,
    required: &str,
    scope_type: ScopeType,
    scope_id: &str,
) -> Result<(), BridgeError> {
    let db = ctx.lock_global().await;
    let store = Store::new(&db);
    ctx.require_user_permission_scoped(
        &store,
        &session.user_id,
        required,
        Some(&session.store_id),
        Some(&session.type_key),
    )?;
    store
        .require_permission_for_resource(&session.user_id, required, scope_type, scope_id)
        .map_err(map_gate_error)
}

/// Read the effective regional configuration for one location of the
/// session's store (regional slice 2). ADR #7.
///
/// The location id is explicit — the caller knows which location it is
/// asking about — so a read can never silently answer for a different
/// location. An unknown location is a typed `CoreErrorKind::NotFound`: the
/// Location → Legal Entity → Organization walk in core refuses to invent
/// defaults for a typo'd id.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown/expired token,
/// [`BridgeError::PermissionDenied`] without `settings:read`,
/// [`BridgeError::Internal`] when the store lock is poisoned, and
/// [`BridgeError::Core`] on DB errors.
pub async fn get_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    location_id: &str,
) -> Result<RegionalConfig, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_READ)
        .await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    Ok(store.regional_config_for_location(location_id)?)
}

/// Write the regional configuration for one location of the session's store
/// (regional slice 3). ADR #7.
///
/// Checks `settings:edit` and the ADR #47 location-resource scoping (the
/// settings domain has no location-shaped permission, so the resource check
/// carries the scoping), then delegates to
/// `Store::update_regional_config_for_location`, which validates every axis
/// inside the same transaction that writes the row.
///
/// Returns the freshly resolved effective config (read-after-write on the
/// same connection) so the card can re-render provenance without a second
/// round-trip.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`]
/// or [`BridgeError::Core`] (core validation / DB).
pub async fn set_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    location_id: &str,
    config: &SetRegionalConfig,
) -> Result<RegionalConfig, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_EDIT)
        .await?;
    require_session_resource_permission(
        ctx,
        &session,
        permissions::SETTINGS_EDIT,
        ScopeType::Location,
        location_id,
    )
    .await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    Ok(store.update_regional_config_for_location(
        location_id,
        &config.locale,
        &config.timezone,
        &config.currency,
        &config.country_code,
    )?)
}

#[cfg(test)]
#[path = "regional_tests.rs"]
mod tests;
