//! Tauri commands for Organization/Tenant Legal Entity management.
//!
//! Legal Entities are Organization-level resources, so these commands read and
//! write the global identity database rather than a per-Location database. The
//! current staged tenant sentinel is `default`; future tenant claims can supply
//! the resolved tenant without changing the command DTOs.

use chrono::Utc;
use oz_core::{LegalEntity, Store, UpdateLegalEntity, permissions};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;

const DEFAULT_TENANT_ID: &str = "default";

/// JSON representation of a Legal Entity returned to the front-end.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegalEntityDto {
    /// Stable entity identifier.
    pub id: String,
    /// Organization/Tenant owner.
    pub tenant_id: String,
    /// Operator-facing name.
    pub name: String,
    /// Registered legal name.
    pub legal_name: String,
    /// Company or government registration number.
    pub registration_number: String,
    /// Tax registration identifier.
    pub tax_id: String,
    /// Lifecycle status.
    pub status: String,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// ISO-8601 last-update timestamp.
    pub updated_at: String,
}

impl From<LegalEntity> for LegalEntityDto {
    fn from(entity: LegalEntity) -> Self {
        Self {
            id: entity.id,
            tenant_id: entity.tenant_id,
            name: entity.name,
            legal_name: entity.legal_name,
            registration_number: entity.registration_number,
            tax_id: entity.tax_id,
            status: entity.status,
            created_at: entity.created_at,
            updated_at: entity.updated_at,
        }
    }
}

/// Arguments for creating an Organization/Tenant Legal Entity.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLegalEntityArgs {
    /// Stable entity identifier.
    pub id: String,
    /// Operator-facing name.
    pub name: String,
    /// Registered legal name.
    pub legal_name: String,
    /// Company or government registration number.
    pub registration_number: String,
    /// Tax registration identifier.
    pub tax_id: String,
    /// Lifecycle status, usually `active`.
    pub status: String,
}

/// Arguments for updating an Organization/Tenant Legal Entity.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLegalEntityArgs {
    /// Stable entity identifier.
    pub id: String,
    /// Operator-facing name.
    pub name: String,
    /// Registered legal name.
    pub legal_name: String,
    /// Company or government registration number.
    pub registration_number: String,
    /// Tax registration identifier.
    pub tax_id: String,
    /// Lifecycle status.
    pub status: String,
}

/// List Legal Entities for the authenticated Organization/Tenant.
#[tauri::command]
pub async fn list_legal_entities_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<LegalEntityDto>, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_READ).await?;
    let conn = state.db.lock().await;
    let store = Store::new(&conn);
    Ok(store
        .list_legal_entities(DEFAULT_TENANT_ID)?
        .into_iter()
        .map(LegalEntityDto::from)
        .collect())
}

/// Get one Legal Entity for the authenticated Organization/Tenant.
#[tauri::command]
pub async fn get_legal_entity_scoped(
    id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<LegalEntityDto>, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_READ).await?;
    let conn = state.db.lock().await;
    let store = Store::new(&conn);
    Ok(store
        .get_legal_entity(DEFAULT_TENANT_ID, &id)?
        .map(LegalEntityDto::from))
}

/// Create a Legal Entity for the authenticated Organization/Tenant.
#[tauri::command]
pub async fn create_legal_entity_scoped(
    args: CreateLegalEntityArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<LegalEntityDto, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;
    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let entity = LegalEntity {
        id: args.id,
        tenant_id: DEFAULT_TENANT_ID.into(),
        name: args.name,
        legal_name: args.legal_name,
        registration_number: args.registration_number,
        tax_id: args.tax_id,
        status: args.status,
        created_at: now.clone(),
        updated_at: now,
    };
    let conn = state.db.lock().await;
    let store = Store::new(&conn);
    Ok(LegalEntityDto::from(store.create_legal_entity(&entity)?))
}

/// Update a Legal Entity for the authenticated Organization/Tenant.
#[tauri::command]
pub async fn update_legal_entity_scoped(
    args: UpdateLegalEntityArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<LegalEntityDto, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;
    let update = UpdateLegalEntity {
        name: args.name,
        legal_name: args.legal_name,
        registration_number: args.registration_number,
        tax_id: args.tax_id,
        status: args.status,
    };
    let conn = state.db.lock().await;
    let store = Store::new(&conn);
    Ok(LegalEntityDto::from(store.update_legal_entity(
        DEFAULT_TENANT_ID,
        &args.id,
        &update,
    )?))
}

#[cfg(test)]
#[path = "legal_entities_tests.rs"]
mod tests;
