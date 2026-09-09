//! Fiscal-scheme and statutory-numbering management commands (regional
//! slice 5, W2-B API half).
//!
//! Exposes the management half of the landed core surface
//! (`db::fiscal`): read one statutory number series for a legal entity +
//! document kind, and upsert its parameters (prefix, reset policy,
//! padding). `claim_statutory_number_for_sale` is deliberately NOT
//! exposed — it stamps inside the checkout transaction and is not a
//! management surface. Gated like sibling settings commands:
//! `settings:read` for the read, `settings:edit` for the upsert — these
//! are entity-scope resources, so no location-resource gate applies.

use tauri::State;

use oz_core::db::Store;
use oz_core::db::fiscal::{DocumentNumberSequence, FiscalScheme, ResetPeriod};

use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;

/// Read the statutory number series for one legal entity and document kind,
/// in the store resolved from a session token. ADR #7.
///
/// `settings:read` on the backend; entity-scope resource, so no
/// location-resource gate. `None` = the entity/kind pair is not configured,
/// which is the honest "no statutory numbering" answer, not an error.
#[tauri::command]
pub async fn get_document_number_sequence_scoped(
    session_token: String,
    legal_entity_id: String,
    document_kind: String,
    state: State<'_, AppState>,
) -> Result<Option<DocumentNumberSequence>, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, oz_core::permissions::SETTINGS_READ).await?;
    let conn = state.resolve_store(&session_token)?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    Ok(store.document_number_sequence(&legal_entity_id, &document_kind)?)
}

/// Arguments for upserting one statutory number series.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertDocumentNumberSequenceArgs {
    /// The owning legal entity.
    pub legal_entity_id: String,
    /// The document kind this series numbers (e.g. `receipt`, `invoice`).
    pub document_kind: String,
    /// Statutory prefix, emitted verbatim before the number.
    pub prefix: String,
    /// Reset policy: `never` | `daily` | `monthly` | `yearly` (the core
    /// parser validates the keyword).
    pub reset_period: String,
    /// Zero-pad width for the issued ordinal (0 = no padding, negative
    /// refused by the core).
    pub padding: i64,
}

/// Create or update the statutory number series for one legal entity and
/// document kind, in the store resolved from a session token. ADR #7.
///
/// `settings:edit` on the backend. The upsert is keyed on
/// (legal_entity_id, document_kind) — the table's UNIQUE pair — so this one
/// command covers both create and reconfiguration; the counter is NEVER
/// reset by a reconfiguration (a statutory series must not gap).
#[tauri::command]
pub async fn upsert_document_number_sequence_scoped(
    session_token: String,
    args: UpsertDocumentNumberSequenceArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, oz_core::permissions::SETTINGS_EDIT).await?;
    let conn = state.resolve_store(&session_token)?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let reset_period = ResetPeriod::parse(&args.reset_period)?;
    store.upsert_document_number_sequence(
        &args.legal_entity_id,
        &args.document_kind,
        &args.prefix,
        reset_period,
        args.padding,
        &chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    )?;
    Ok(())
}

/// List every statutory number series configured for the tenant, ordered by
/// (legal entity, document kind), in the store resolved from a session
/// token. ADR #7. W5-C: the management overview's read surface.
///
/// `settings:read` on the backend; entity-scope resource, so no
/// location-resource gate. `current_value` is the LIVE counter — it never
/// resets on reconfiguration, so what this reports is what the next
/// statutory number continues from.
#[tauri::command]
pub async fn list_document_number_sequences_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<DocumentNumberSequence>, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, oz_core::permissions::SETTINGS_READ).await?;
    let conn = state.resolve_store(&session_token)?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    Ok(store.list_document_number_sequences()?)
}

/// The configured series for ONE legal entity (the overview's per-entity
/// drill-down), in the store resolved from a session token. ADR #7.
///
/// `settings:read` on the backend; ordered by document kind.
#[tauri::command]
pub async fn list_document_number_sequences_for_entity_scoped(
    session_token: String,
    legal_entity_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<DocumentNumberSequence>, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, oz_core::permissions::SETTINGS_READ).await?;
    let conn = state.resolve_store(&session_token)?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    Ok(store.document_number_sequences_for_entity(&legal_entity_id)?)
}

/// List the tenant's fiscal schemes — the entity-level statutory
/// configuration anchor the number series hang off — ordered by
/// (legal entity, scheme code). ADR #7. W5-C.
///
/// `settings:read` on the backend. INACTIVE schemes are included: the
/// overview shows the full configuration surface; consumers filter by
/// `is_active` per their own contract.
#[tauri::command]
pub async fn list_fiscal_schemes_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<FiscalScheme>, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, oz_core::permissions::SETTINGS_READ).await?;
    let conn = state.resolve_store(&session_token)?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    Ok(store.list_fiscal_schemes()?)
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "fiscal_tests.rs"]
mod tests;
