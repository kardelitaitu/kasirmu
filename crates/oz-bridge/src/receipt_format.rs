//! Receipt format commands (regional receipt-format axis — the LAST
//! missing saas-2 L167 axis).
//!
//! Wire contract: the core `EffectiveReceiptFormat` model is returned
//! as-is (camelCase serde). Content (statutory, entity scope) is read-
//! only on this surface — authoring it is a management surface, deferred
//! like fiscal/payment entity-layer authoring. Layout (presentational)
//! is writable at the workspace layer of the session's store db.
//!
//! Read: `settings:read`. Write: `settings:edit` + the ADR #47
//! location-resource gate (the workspace layer is keyed by the session's
//! primary location id).
//!
//! Wave D / D4b: the bodies moved here from
//! `apps/desktop-client/src/commands/receipt_format.rs`; shims keep the
//! exact `#[tauri::command]` names/signatures/`Result<_, AppError>`
//! wire contract.

use oz_core::db::assignments::ScopeType;
use oz_core::db::receipt_formats::{EffectiveReceiptFormat, ReceiptContent, ReceiptLayout};
use oz_core::{Store, permissions};

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// Read the effective receipt format for the session's terminal (or the
/// store default when no terminal is bound): statutory content from the
/// linked legal entity as-is, layout merged terminal → workspace →
/// legacy with provenance.
pub async fn get_receipt_format_scoped(
    ctx: &BridgeCtx<'_>,
    terminal_id: Option<String>,
    workspace_id: Option<String>,
    session_token: &str,
) -> Result<EffectiveReceiptFormat, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_READ)
        .await?;
    let conn = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&conn);
    Ok(store.effective_receipt_format(terminal_id.as_deref(), workspace_id.as_deref())?)
}

/// Replace the workspace-layer layout record for the session's store db
/// (the card's write; terminal-layer overrides ride the terminal's own
/// settings surface, not this command). Returns the freshly effective
/// format.
///
/// Checks `settings:edit` scoped to the location resource (ADR #47).
/// Validation happens in core — closed element enum (content, on its own
/// write path), width/margin/copies ranges, footer caps — inside the same
/// transaction that rewrites the row; this command adds no validation of
/// its own.
pub async fn set_receipt_layout_scoped(
    ctx: &BridgeCtx<'_>,
    layout: &ReceiptLayoutArgs,
    workspace_id: &str,
    session_token: &str,
) -> Result<EffectiveReceiptFormat, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_EDIT)
        .await?;
    ctx.require_permission_for_session_resource(
        &session,
        permissions::SETTINGS_EDIT,
        ScopeType::Location,
        workspace_id,
    )
    .await?;
    let conn = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&conn);
    let core_layout = ReceiptLayout {
        paper_width_mm: layout.paper_width_mm,
        margin_top_mm: layout.margin_top_mm,
        margin_bottom_mm: layout.margin_bottom_mm,
        margin_left_mm: layout.margin_left_mm,
        margin_right_mm: layout.margin_right_mm,
        show_logo: layout.show_logo,
        print_copies: layout.print_copies,
        show_table_number: layout.show_table_number,
        footer_note: layout.footer_note.clone(),
    };
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    store.set_receipt_layout_for_scope("workspace", workspace_id, &core_layout, &now)?;
    Ok(store.effective_receipt_format(None, Some(workspace_id))?)
}

/// One layout submission from the card (all fields optional — the card
/// edits the whole record).
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptLayoutArgs {
    /// Paper width in mm (20–120).
    pub paper_width_mm: Option<i64>,
    /// Margins in mm (≥ 0).
    pub margin_top_mm: Option<i64>,
    /// Bottom margin in mm (≥ 0).
    pub margin_bottom_mm: Option<i64>,
    /// Left margin in mm (≥ 0).
    pub margin_left_mm: Option<i64>,
    /// Right margin in mm (≥ 0).
    pub margin_right_mm: Option<i64>,
    /// Whether the store logo prints.
    pub show_logo: Option<bool>,
    /// How many copies to print (≥ 0).
    pub print_copies: Option<i64>,
    /// Whether the table number line prints.
    pub show_table_number: Option<bool>,
    /// Optional presentational footer note (≤ 500 chars).
    pub footer_note: Option<String>,
}

/// The id of the store's primary location (the ADR #47 resource id the
/// entity-layer write is gated on; the entity is reached through that
/// location row, mirroring how `effective_receipt_format` reads it).
fn primary_location_id(
    conn: &std::sync::Mutex<rusqlite::Connection>,
) -> Result<String, BridgeError> {
    let guard = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&guard);
    store.get_primary_location()?.map(|p| p.id).ok_or_else(|| {
        BridgeError::Invalid("no primary location to resolve the entity from".into())
    })
}

/// Replace the primary legal entity's statutory content record and
/// return the freshly effective format.
///
/// Content is the ENTITY-layer half of the format (statutory, never
/// overridden downstream). It carries the same `settings:edit` gate as
/// the layout setter plus the ADR #47 location-resource check on the
/// session's primary location — the entity is reached through that
/// location row, mirroring how `effective_receipt_format` reads it.
/// No linked entity → fail closed. Validation happens in core (closed
/// element enum) inside the write transaction.
pub async fn set_receipt_content_scoped(
    ctx: &BridgeCtx<'_>,
    content: &ReceiptContentArgs,
    session_token: &str,
) -> Result<EffectiveReceiptFormat, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_EDIT)
        .await?;
    ctx.require_permission_for_session_resource(
        &session,
        permissions::SETTINGS_EDIT,
        ScopeType::Location,
        &primary_location_id(&conn)?,
    )
    .await?;
    let conn = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&conn);
    let primary = store.get_primary_location()?.ok_or_else(|| {
        BridgeError::Invalid("no primary location to resolve the entity from".into())
    })?;
    let entity_id = store
        .location_legal_entity_id(&primary.id)?
        .ok_or_else(|| {
            BridgeError::Invalid("no legal entity linked to the primary location".into())
        })?;
    let core_content = ReceiptContent {
        required_fields: content.required_fields.clone(),
        footer_text: content.footer_text.clone(),
        show_tax: content.show_tax,
        show_currency: content.show_currency,
        decimal_separator: content.decimal_separator.clone(),
    };
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    store.set_receipt_content_for_entity(&entity_id, &core_content, &now)?;
    Ok(store.effective_receipt_format(None, None)?)
}

/// One statutory-content submission from the card (whole-record write;
/// `required_fields` is validated against the closed element enum in core).
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptContentArgs {
    /// Market-mandated element codes (closed enum).
    pub required_fields: Vec<String>,
    /// Footer text (empty = none).
    pub footer_text: String,
    /// Whether the tax line prints.
    pub show_tax: bool,
    /// Whether amounts carry the currency symbol prefix.
    pub show_currency: bool,
    /// `dot` | `comma` | `none`.
    pub decimal_separator: String,
}

#[cfg(test)]
#[path = "receipt_format_tests.rs"]
mod receipt_format_tests;
