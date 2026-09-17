//! Fiscal-scheme and statutory-numbering management commands (regional
//! slice 5, W2-B API half) — tablet mirror of the desktop commands.
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
//! ADR #49: all five bodies are the bridge's. This module is the scope-aware
//! shape — the gate is `require_permission_for_session`, which is the same
//! scope-aware check (ADR #35 D5) as the bridge's
//! `BridgeCtx::require_session_permission`, and the order matches too:
//! `resolve_session` → gate → open the store → lock. Note the shell resolves the
//! session **twice** (`resolve_session` for the gate, then `resolve_scope`, which
//! re-resolves it) and the bridge does exactly the same (`resolve_store` is
//! `resolve_scope(..).map(|(_, conn)| conn)`), so the extra resolution is
//! preserved rather than tidied away.

use tauri::{State, command};

use kasirmu_core::db::fiscal::{DocumentNumberSequence, FiscalScheme};

use crate::error::AppError;
use crate::state::AppState;

// ADR #49: the argument struct is the bridge's, re-exported rather than restated.
// The two definitions were identical apart from the derive path
// (`serde::Deserialize` vs `Deserialize`) — same five fields, same doc comments,
// same `rename_all = "camelCase"` — so the wire is unchanged.
pub use kasirmu_bridge::fiscal::UpsertDocumentNumberSequenceArgs;

/// Read the statutory number series for one legal entity and document kind,
/// in the store resolved from a session token. ADR #7. Tablet mirror of the
/// desktop command.
///
/// `settings:read` on the backend; entity-scope resource, so no
/// location-resource gate. `None` = the entity/kind pair is not configured,
/// which is the honest "no statutory numbering" answer, not an error.
///
/// ADR #49: the body is the bridge's.
#[command]
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
/// Tablet mirror of the desktop command.
///
/// `settings:edit` on the backend. The upsert is keyed on
/// (legal_entity_id, document_kind) — the table's UNIQUE pair — so this one
/// command covers both create and reconfiguration; the counter is NEVER
/// reset by a reconfiguration (a statutory series must not gap).
///
/// ADR #49: the body is the bridge's. The RFC-3339 millisecond stamp that stood
/// here now comes from the bridge's `run_upsert`, which computes the same
/// `chrono::Utc::now()` value with the same `SecondsFormat::Millis` — the bridge
/// owns the clock, and its module note says so.
#[command]
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
/// token. ADR #7. Tablet mirror of the desktop command. W5-C.
///
/// `settings:read` on the backend; entity-scope resource, so no
/// location-resource gate. `current_value` is the LIVE counter — it never
/// resets on reconfiguration.
///
/// ADR #49: the body is the bridge's.
#[command]
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
/// Tablet mirror of the desktop command.
///
/// `settings:read` on the backend; ordered by document kind.
///
/// ADR #49: the body is the bridge's.
#[command]
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
/// (legal entity, scheme code). ADR #7. Tablet mirror of the desktop
/// command. W5-C.
///
/// `settings:read` on the backend. INACTIVE schemes are included: the
/// overview shows the full configuration surface; consumers filter by
/// `is_active` per their own contract.
///
/// ADR #49: the body is the bridge's.
#[command]
pub async fn list_fiscal_schemes_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<FiscalScheme>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::fiscal::list_fiscal_schemes_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "fiscal_tests.rs"]
mod tests;
