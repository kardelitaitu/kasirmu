//! Fiscal command bodies (Wave A / S6) — the tauri-free half of
//! `apps/desktop-client/src/commands/fiscal.rs`.
//!
//! Key functions: [`run_upsert`] (the pure `&Connection` body of the upsert)
//! and the five session-scoped operations
//! [`get_document_number_sequence_scoped`],
//! [`upsert_document_number_sequence_scoped`],
//! [`list_document_number_sequences_scoped`],
//! [`list_document_number_sequences_for_entity_scoped`] and
//! [`list_fiscal_schemes_scoped`], each consuming a [`BridgeCtx`].
//!
//! Gate order and store construction (`Store::new`, cache-free — as the shell
//! used) are verbatim ports of the command bodies: resolve the session,
//! authorize `settings:read` / `settings:edit` against the GLOBAL identity DB
//! (ADR #4/#7), then open the store connection and act. Entity-scope
//! resources, so no location-resource gate applies anywhere here.
//!
//! Time: the bridge owns the clock — [`run_upsert`] computes the core
//! upsert's RFC-3339 millisecond stamp internally (`chrono::Utc::now()`
//! formatted with `SecondsFormat::Millis`), byte-identical to the expression
//! the command body used.

use serde::Deserialize;

use oz_core::db::Store;
use oz_core::db::fiscal::{DocumentNumberSequence, FiscalScheme, ResetPeriod};
use oz_core::permissions;
use rusqlite::Connection;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// Arguments for upserting one statutory number series.
#[derive(Debug, Deserialize)]
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

/// Business logic of the fiscal upsert over a locked store connection.
///
/// The write is keyed on the (legal entity, document kind) UNIQUE pair, so
/// one call covers both create and reconfiguration; the counter is NEVER
/// reset by a reconfiguration (a statutory series must not gap). The
/// RFC-3339 millisecond stamp is computed here — see the module note on
/// time.
///
/// # Errors
///
/// Returns [`BridgeError::Core`] for an unparseable `reset_period` (core
/// `Validation`), a negative padding, or any DB failure.
pub fn run_upsert(
    conn: &Connection,
    args: &UpsertDocumentNumberSequenceArgs,
) -> Result<(), BridgeError> {
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let store = Store::new(conn);
    let reset_period = ResetPeriod::parse(&args.reset_period)?;
    store.upsert_document_number_sequence(
        &args.legal_entity_id,
        &args.document_kind,
        &args.prefix,
        reset_period,
        args.padding,
        &now,
    )?;
    Ok(())
}

/// Read the statutory number series for one legal entity and document kind,
/// in the store resolved from a session token. ADR #7.
///
/// `settings:read` on the backend. `None` = the entity/kind pair is not
/// configured, which is the honest "no statutory numbering" answer, not an
/// error.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown/expired token,
/// [`BridgeError::PermissionDenied`] without `settings:read`,
/// [`BridgeError::Internal`] when the store lock is poisoned, and
/// [`BridgeError::Core`] on DB errors.
pub async fn get_document_number_sequence_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    legal_entity_id: &str,
    document_kind: &str,
) -> Result<Option<DocumentNumberSequence>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_READ)
        .await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    Ok(store.document_number_sequence(legal_entity_id, document_kind)?)
}

/// Create or update the statutory number series for one legal entity and
/// document kind, in the store resolved from a session token. ADR #7.
///
/// `settings:edit` on the backend, then [`run_upsert`] over the resolved
/// store connection — the same gate order the command body used.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`]
/// or [`BridgeError::Core`] (validation / DB).
pub async fn upsert_document_number_sequence_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: &UpsertDocumentNumberSequenceArgs,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_EDIT)
        .await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    run_upsert(&db, args)
}

/// List every statutory number series configured for the tenant, ordered by
/// (legal entity, document kind), in the store resolved from a session
/// token. ADR #7. W5-C: the management overview's read surface.
///
/// `current_value` is the LIVE counter — it never resets on
/// reconfiguration, so what this reports is what the next statutory number
/// continues from.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`]
/// or [`BridgeError::Core`] (DB).
pub async fn list_document_number_sequences_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<DocumentNumberSequence>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_READ)
        .await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    Ok(store.list_document_number_sequences()?)
}

/// The configured series for ONE legal entity (the overview's per-entity
/// drill-down), in the store resolved from a session token. ADR #7.
///
/// `settings:read` on the backend; ordered by document kind.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`]
/// or [`BridgeError::Core`] (DB).
pub async fn list_document_number_sequences_for_entity_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    legal_entity_id: &str,
) -> Result<Vec<DocumentNumberSequence>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_READ)
        .await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    Ok(store.document_number_sequences_for_entity(legal_entity_id)?)
}

/// List the tenant's fiscal schemes — the entity-level statutory
/// configuration anchor the number series hang off — ordered by
/// (legal entity, scheme code). ADR #7. W5-C.
///
/// `settings:read` on the backend. INACTIVE schemes are included: the
/// overview shows the full configuration surface; consumers filter by
/// `is_active` per their own contract.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`]
/// or [`BridgeError::Core`] (DB).
pub async fn list_fiscal_schemes_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<FiscalScheme>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_READ)
        .await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    Ok(store.list_fiscal_schemes()?)
}

#[cfg(test)]
#[path = "fiscal_tests.rs"]
mod tests;
