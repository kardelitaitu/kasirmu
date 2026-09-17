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
//!
//! Wave A / S6: the bodies now live in the headless `kasirmu_bridge::fiscal`
//! module. Each `#[tauri::command]` below keeps its exact name, parameter
//! list and `Result<_, AppError>` return so the registered IPC surface and
//! the serialized error shape are unchanged; it borrows a `BridgeCtx` from
//! `AppState`, calls the bridge, and maps `BridgeError` back to `AppError`
//! variant-for-variant. The write DTO moved with the bodies and is
//! re-exported so `use super::*` in `fiscal_tests.rs` still resolves it.
//!
//! The bridge owns the clock: the core upsert's RFC-3339 millisecond stamp
//! is computed inside `kasirmu_bridge::fiscal`. The permission gate (F-017) and
//! store resolution run inside the bridge, in the same order as before.

use tauri::State;

use kasirmu_core::db::fiscal::{DocumentNumberSequence, FiscalScheme};

use crate::error::AppError;
use crate::state::AppState;

// Retained for the sibling test module, which reaches these through
// `use super::*`; the command bodies themselves no longer name them.
#[allow(unused_imports)]
use kasirmu_core::db::Store;
#[allow(unused_imports)]
use kasirmu_core::db::fiscal::ResetPeriod;

pub use kasirmu_bridge::fiscal::UpsertDocumentNumberSequenceArgs;

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
    let ctx = state.bridge_ctx();
    kasirmu_bridge::fiscal::get_document_number_sequence_scoped(
        &ctx,
        &session_token,
        &legal_entity_id,
        &document_kind,
    )
    .await
    .map_err(Into::into)
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
    let ctx = state.bridge_ctx();
    kasirmu_bridge::fiscal::upsert_document_number_sequence_scoped(&ctx, &session_token, &args)
        .await
        .map_err(Into::into)
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
    let ctx = state.bridge_ctx();
    kasirmu_bridge::fiscal::list_document_number_sequences_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
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
    let ctx = state.bridge_ctx();
    kasirmu_bridge::fiscal::list_document_number_sequences_for_entity_scoped(
        &ctx,
        &session_token,
        &legal_entity_id,
    )
    .await
    .map_err(Into::into)
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
    let ctx = state.bridge_ctx();
    kasirmu_bridge::fiscal::list_fiscal_schemes_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}
