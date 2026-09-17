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
//! slices reuse these names verbatim" (`kasirmu_core::regional`), so there is no
//! shell-side mirror DTO to drift. `ConfigScope` rides along with its
//! serde names ("location", "legal_entity", "organization", "built_in").
//!
//! ADR #48 (87114abf6) settled the design's timezone-representation question:
//! storage is an IANA zone name and offsets are derived at display/report
//! time (`kasirmu_core::timezone::business_date_in_zone`). This read model is
//! therefore a faithful pass-through of the **stored** string — it never
//! re-derives or formats an offset on this side of the boundary, and the
//! front-end must not either.
//!
//! Wave A / S6: the bodies now live in the headless `kasirmu_bridge::regional`
//! module. Each `#[tauri::command]` below keeps its exact name, parameter
//! list and `Result<_, AppError>` return so the registered IPC surface and
//! the serialized error shape are unchanged; it borrows a `BridgeCtx` from
//! `AppState`, calls the bridge, and maps `BridgeError` back to `AppError`
//! variant-for-variant. The write payload moved with the body and is
//! re-exported so `use super::*` in `regional_tests.rs` still resolves it.
//! The `settings:read` / `settings:edit` gates — including the ADR #47
//! location-resource scoping on the write — run inside the bridge, in the
//! same order as before.

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

// Retained for the sibling test module, which reaches it through
// `use super::*`; the command bodies no longer name it.
#[allow(unused_imports)]
use kasirmu_core::Store;

pub use kasirmu_bridge::regional::SetRegionalConfig;

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
) -> Result<kasirmu_core::RegionalConfig, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::regional::get_scoped(&ctx, &session_token, &location_id)
        .await
        .map_err(Into::into)
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
) -> Result<kasirmu_core::RegionalConfig, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::regional::set_scoped(&ctx, &session_token, &location_id, &config)
        .await
        .map_err(Into::into)
}
