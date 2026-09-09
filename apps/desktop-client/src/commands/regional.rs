//! Regional-configuration commands (slices 2–3 of the saas-2 design slice
//! queue).
//!
//! Exposes the slice-1 core read model (`Store::regional_config_for_location`)
//! over IPC: the effective locale/timezone/currency for one location with
//! per-axis provenance — and, since slice 3, its transactional write
//! counterpart (`Store::update_regional_config_for_location`).
//!
//! Wire contract: the core `RegionalConfig` is returned **as-is** — its
//! fields are documented "serialized as snake_case so the IPC DTOs of later
//! slices reuse these names verbatim" (`oz_core::regional`), so there is no
//! shell-side mirror DTO to drift. `ConfigScope` rides along with its
//! serde names ("location", "legal_entity", "organization", "built_in").
//!
//! ADR #48 (87114abf6) settled the design's timezone-representation question:
//! storage is an IANA zone name and offsets are derived at display/report
//! time (`oz_core::timezone::business_date_in_zone`). This read model is
//! therefore a faithful pass-through of the **stored** string — it never
//! re-derives or formats an offset on this side of the boundary, and the
//! front-end must not either.

use oz_core::db::assignments::ScopeType;
use oz_core::{Store, permissions};
use tauri::State;

use crate::commands::authz::{
    require_permission_for_session, require_permission_for_session_resource,
};
use crate::error::AppError;
use crate::state::AppState;

/// Read the effective regional configuration for one location of the
/// session's store (regional slice 2, saas-2 design slice queue #2).
///
/// Resolves the session's store database (ADR #7), checks `settings:read`
/// inline, and walks Location → Legal Entity → Organization in core. The
/// location id is explicit — the caller knows which location it is asking
/// about (primary via `get_primary_location_scoped`, or the inspector's
/// selection) — so a read can never silently answer for a different
/// location than the caller meant. An unknown location is a typed
/// `CoreErrorKind::NotFound` — the walk refuses to invent defaults for a
/// typo'd id.
#[tauri::command]
pub async fn get_regional_config_scoped(
    location_id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<oz_core::RegionalConfig, AppError> {
    let (session, conn) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_READ).await?;
    let conn = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&conn);
    let config = store.regional_config_for_location(&location_id)?;
    Ok(config)
}

/// Write the regional configuration for one location of the session's
/// store (regional slice 3).
///
/// Resolves the session's store database (ADR #7) and checks `settings:edit`
/// scoped to the location resource (ADR #47: the settings domain has no
/// location-shaped permission, so the resource check carries the scoping).
/// All validation happens in core — `Store::update_regional_config_for_location`
/// enforces the ADR #48 timezone contract (the three Indonesian IANA presets
/// or the legacy `UTC` sentinel), ISO-4217 currency shape, BCP-47 locale
/// shape and ISO-3166 country shape, inside the same transaction that writes
/// the row; this command adds no validation of its own and never touches a
/// column directly. The payload reuses core serde names verbatim, mirroring
/// the read command.
///
/// Returns the freshly resolved effective config (read-after-write on the
/// same connection) so the card can re-render provenance without a second
/// round-trip.
#[tauri::command]
pub async fn set_regional_config_scoped(
    location_id: String,
    config: SetRegionalConfig,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<oz_core::RegionalConfig, AppError> {
    let (session, conn) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;
    require_permission_for_session_resource(
        &state,
        &session,
        permissions::SETTINGS_EDIT,
        ScopeType::Location,
        &location_id,
    )
    .await?;
    let conn = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&conn);
    let config = store.update_regional_config_for_location(
        &location_id,
        &config.locale,
        &config.timezone,
        &config.currency,
        &config.country_code,
    )?;
    Ok(config)
}

/// The write payload for `set_regional_config_scoped`. Field names match the
/// axis names in `locations`/`legal_entities` (snake_case on the wire, like
/// the read model); "" means "clear, inherit from the scope above".
#[derive(serde::Deserialize)]
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

#[cfg(test)]
#[path = "regional_tests.rs"]
mod tests;
