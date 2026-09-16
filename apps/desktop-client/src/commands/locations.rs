//! Tauri commands for location-profile CRUD.
//!
//! Wire contract: each command talks to the `oz_core::Store` facade via the shared
//! `AppState` database connection. The old store-profile command names
//! were retired once every client migrated to the canonical commands
//! (todo-global-saas-1.md, rename slice 1c/1d).
//!
//! Wave E / E7: the bodies now live in the headless `oz_bridge::locations` module.
//! Each `#[tauri::command]` below keeps its exact name, parameter list, attributes
//! and `Result<_, AppError>` wire contract; it builds a `BridgeCtx` from `AppState` and
//! delegates, preserving resolve/gate order, the ADR #47 location-resource
//! checks, the C1.2 quota gate and the drop-then-delete-db ordering. The DTOs
//! moved with the bodies and are re-exported so `use super::*` in
//! `locations_tests.rs` still resolves them.

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

pub use oz_bridge::locations::{CreateLocationArgs, LocationProfileDto, UpdateLocationArgs};

/// List location profiles for the session's tenant (ADR #7).
#[tauri::command]
pub async fn list_locations_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<LocationProfileDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::locations::list_locations_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Get a location profile for the session's tenant (ADR #7).
#[tauri::command]
pub async fn get_location_profile_scoped(
    id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<LocationProfileDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::locations::get_location_profile_scoped(&ctx, &session_token, &id)
        .await
        .map_err(Into::into)
}

/// Get the primary location for the session's tenant (ADR #7).
#[tauri::command]
pub async fn get_primary_location_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<LocationProfileDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::locations::get_primary_location_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Create a location profile for the session's tenant (ADR #7).
#[tauri::command]
pub async fn create_location_profile_scoped(
    args: CreateLocationArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<LocationProfileDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::locations::create_location_profile_scoped(&ctx, &session_token, &args)
        .await
        .map_err(Into::into)
}

/// Update a location profile for the session's tenant (ADR #7).
#[tauri::command]
pub async fn update_location_profile_scoped(
    args: UpdateLocationArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<LocationProfileDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::locations::update_location_profile_scoped(&ctx, &session_token, &args)
        .await
        .map_err(Into::into)
}

/// Set a location as primary for the session's tenant (ADR #7).
#[tauri::command]
pub async fn set_primary_location_scoped(
    id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<LocationProfileDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::locations::set_primary_location_scoped(&ctx, &session_token, &id)
        .await
        .map_err(Into::into)
}

/// Delete a location profile for the session's tenant (ADR #7).
#[tauri::command]
pub async fn delete_location_profile_scoped(
    id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::locations::delete_location_profile_scoped(&ctx, &session_token, &id)
        .await
        .map_err(Into::into)
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
    let ctx = state.bridge_ctx();
    oz_bridge::locations::get_location_ticket_prefix_scoped(&ctx, &session_token, &id)
        .await
        .map_err(Into::into)
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
    let ctx = state.bridge_ctx();
    oz_bridge::locations::set_location_ticket_prefix_scoped(&ctx, &session_token, &id, &prefix)
        .await
        .map_err(Into::into)
}
