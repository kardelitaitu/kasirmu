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

use tauri::{State, command};

use oz_core::db::Store;
use oz_core::db::fiscal::{DocumentNumberSequence, ResetPeriod};

use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;

/// Read the statutory number series for one legal entity and document kind,
/// in the store resolved from a session token. ADR #7. Tablet mirror of the
/// desktop command.
///
/// `settings:read` on the backend; entity-scope resource, so no
/// location-resource gate. `None` = the entity/kind pair is not configured,
/// which is the honest "no statutory numbering" answer, not an error.
#[command]
pub async fn get_document_number_sequence_scoped(
    session_token: String,
    legal_entity_id: String,
    document_kind: String,
    state: State<'_, AppState>,
) -> Result<Option<DocumentNumberSequence>, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, oz_core::permissions::SETTINGS_READ).await?;
    let (session, conn) = state.resolve_scope(&session_token)?;
    let _ = session;
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
/// Tablet mirror of the desktop command.
///
/// `settings:edit` on the backend. The upsert is keyed on
/// (legal_entity_id, document_kind) — the table's UNIQUE pair — so this one
/// command covers both create and reconfiguration; the counter is NEVER
/// reset by a reconfiguration (a statutory series must not gap).
#[command]
pub async fn upsert_document_number_sequence_scoped(
    session_token: String,
    args: UpsertDocumentNumberSequenceArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, oz_core::permissions::SETTINGS_EDIT).await?;
    let (session, conn) = state.resolve_scope(&session_token)?;
    let _ = session;
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

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "fiscal_tests.rs"]
mod tests;
