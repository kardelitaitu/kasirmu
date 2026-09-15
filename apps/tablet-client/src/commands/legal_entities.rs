//! Tauri commands for Organization/Tenant Legal Entity management.
//!
//! Legal Entities are Organization-level resources, so these commands read and
//! write the global identity database rather than a per-Location database. The
//! current staged tenant sentinel is `default`; future tenant claims can supply
//! the resolved tenant without changing the command DTOs.
//!
//! Every body delegates to `oz_bridge::legal_entities` (ADR #49), and so do the
//! three DTOs and the tenant sentinel: all re-exported from the bridge rather
//! than defined twice, after checking each field against the copies this shell
//! used to own. The gate is the scope-aware `require_permission_for_session`;
//! the bridge's `ctx.require_session_permission` is the same check, against the
//! same global identity database these commands then read through, in the same
//! order.

use tauri::State;

pub use oz_bridge::legal_entities::{
    CreateLegalEntityArgs, LegalEntityDto, UpdateLegalEntityArgs, DEFAULT_TENANT_ID,
};

use crate::error::AppError;
use crate::state::AppState;

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

#[cfg(test)]
#[path = "legal_entities_tests.rs"]
mod tests;
