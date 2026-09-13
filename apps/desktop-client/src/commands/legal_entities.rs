//! Tauri commands for Organization/Tenant Legal Entity management.
//!
//! Legal Entities are Organization-level resources, so these commands read and
//! write the global identity database rather than a per-Location database. The
//! current staged tenant sentinel is `default`; future tenant claims can supply
//! the resolved tenant without changing the command DTOs.
//!
//! Wave F: every body lives in the headless `oz_bridge::legal_entities`
//! module. Each `#[tauri::command]` below keeps its exact name, parameter list
//! and `Result<_, AppError>` return; it borrows a `BridgeCtx` from
//! `AppState`, calls the bridge and maps `BridgeError` back to `AppError`
//! variant-for-variant. The DTOs and args structs moved with the bodies and are
//! re-exported so `use super::*;` in `legal_entities_tests.rs` still resolves
//! them.

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

pub use oz_bridge::legal_entities::{
    CreateLegalEntityArgs, DEFAULT_TENANT_ID, LegalEntityDto, UpdateLegalEntityArgs,
};

/// List Legal Entities for the authenticated Organization/Tenant.
#[tauri::command]
pub async fn list_legal_entities_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<LegalEntityDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::legal_entities::list_legal_entities_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Get one Legal Entity for the authenticated Organization/Tenant.
#[tauri::command]
pub async fn get_legal_entity_scoped(
    id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<LegalEntityDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::legal_entities::get_legal_entity_scoped(&ctx, &session_token, &id)
        .await
        .map_err(Into::into)
}

/// Create a Legal Entity for the authenticated Organization/Tenant.
#[tauri::command]
pub async fn create_legal_entity_scoped(
    args: CreateLegalEntityArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<LegalEntityDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::legal_entities::create_legal_entity_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// Update a Legal Entity for the authenticated Organization/Tenant.
#[tauri::command]
pub async fn update_legal_entity_scoped(
    args: UpdateLegalEntityArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<LegalEntityDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::legal_entities::update_legal_entity_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}
