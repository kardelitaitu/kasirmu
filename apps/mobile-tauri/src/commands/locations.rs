//! Location commands — tenant location profiles and KDS ticket prefix.
//!
//! Multi-store location profiles and primary location resolution.
//! Delegates directly to `kasirmu_bridge::locations`.

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

pub use kasirmu_bridge::locations::{CreateLocationArgs, LocationProfileDto, UpdateLocationArgs};

/// List all location profiles for the session's tenant (ADR #7).
#[tauri::command]
pub async fn list_locations_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<LocationProfileDto>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::locations::list_locations_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Get a location profile by ID for the session's tenant (ADR #7).
#[tauri::command]
pub async fn get_location_profile_scoped(
    id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<LocationProfileDto>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::locations::get_location_profile_scoped(&ctx, &session_token, &id)
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
    kasirmu_bridge::locations::get_primary_location_scoped(&ctx, &session_token)
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
    kasirmu_bridge::locations::create_location_profile_scoped(&ctx, &session_token, &args)
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
    kasirmu_bridge::locations::update_location_profile_scoped(&ctx, &session_token, &args)
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
    kasirmu_bridge::locations::set_primary_location_scoped(&ctx, &session_token, &id)
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
    kasirmu_bridge::locations::delete_location_profile_scoped(&ctx, &session_token, &id)
        .await
        .map_err(Into::into)
}

/// Read one location's KDS ticket prefix for the session's tenant.
#[tauri::command]
pub async fn get_location_ticket_prefix_scoped(
    id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<String>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::locations::get_location_ticket_prefix_scoped(&ctx, &session_token, &id)
        .await
        .map_err(Into::into)
}

/// Set (or clear) one location's KDS ticket prefix.
#[tauri::command]
pub async fn set_location_ticket_prefix_scoped(
    id: String,
    prefix: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<String>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::locations::set_location_ticket_prefix_scoped(&ctx, &session_token, &id, &prefix)
        .await
        .map_err(Into::into)
}
