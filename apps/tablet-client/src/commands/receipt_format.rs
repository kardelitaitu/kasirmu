//! Receipt format commands (receipt-format axis) — tablet twin.
//!
//! # ADR #49 status — measured 2026-09-16, `verify-body-parity.py` → **1 / 3**
//!
//! **One door is ported.** [`get_receipt_format_scoped`] delegates to
//! [`kasirmu_bridge::receipt_format::get_receipt_format_scoped`]: the bodies were
//! statement-identical, and the door names a permission (`SETTINGS_READ`), so
//! the move is ledger-neutral. The twin takes `session_token` **last**.
//!
//! **Two doors are REFUSED, on an added gate.** [`set_receipt_layout_scoped`] and
//! [`set_receipt_content_scoped`] gate on the session alone here
//! (`SETTINGS_EDIT`, `require_permission_for_session`), while the bridge twins
//! layer an ADR #47 location-resource check on top —
//! `require_permission_for_session_resource(&session, SETTINGS_EDIT,
//! ScopeType::Location, …)` (`crates/kasirmu-bridge/src/receipt_format.rs:65-70` and
//! `:150-155`) — which this shell has never enforced. §4 forbids adding a gate
//! inside an extraction as plainly as removing one, and a stricter gate can start
//! refusing writes the shell accepts today.
//!
//! That is precisely why the location-resource scoping the desktop layers on top
//! (ADR #47) still has **no tablet helper**: adopting it is a gating change, so it
//! must land in its own commit rather than inside an extraction.

use oz_core::db::receipt_formats::{EffectiveReceiptFormat, ReceiptContent, ReceiptLayout};
use oz_core::{Store, permissions};
use tauri::State;

use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;

/// Read the effective receipt format for the session's terminal.
///
/// # ADR #49 — ported 2026-09-16
///
/// Delegates to [`kasirmu_bridge::receipt_format::get_receipt_format_scoped`]. The
/// body was statement-identical and the gate is `SETTINGS_READ` on both sides, so
/// the move is ledger-neutral. Argument order follows the twin: `terminal_id`,
/// `workspace_id`, then `session_token`.
#[tauri::command]
pub async fn get_receipt_format_scoped(
    terminal_id: Option<String>,
    workspace_id: Option<String>,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<EffectiveReceiptFormat, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::receipt_format::get_receipt_format_scoped(
        &ctx,
        terminal_id,
        workspace_id,
        &session_token,
    )
    .await
    .map_err(Into::into)
}

/// Replace the workspace-layer layout record for the session's store db
/// and return the freshly effective format.
///
/// # ADR #49 NOT APPLIED, deliberately — delegating would ADD a gate
///
/// Refused 2026-09-16. This shell gates on the session alone (`SETTINGS_EDIT`).
/// The bridge twin adds an ADR #47 location-resource check —
/// `require_permission_for_session_resource(&session, SETTINGS_EDIT,
/// ScopeType::Location, workspace_id)`
/// (`crates/kasirmu-bridge/src/receipt_format.rs:65-70`) — which has never run here.
/// §4 forbids adding a gate inside an extraction, and the added check can start
/// refusing writes this shell accepts today.
#[tauri::command]
pub async fn set_receipt_layout_scoped(
    layout: ReceiptLayoutArgs,
    workspace_id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<EffectiveReceiptFormat, AppError> {
    let (session, conn) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;
    let conn = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
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
        footer_note: layout.footer_note,
    };
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    store.set_receipt_layout_for_scope("workspace", &workspace_id, &core_layout, &now)?;
    Ok(store.effective_receipt_format(None, Some(&workspace_id))?)
}

/// One layout submission from the card.
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

/// Replace the primary legal entity's statutory content record and
/// return the freshly effective format. The tablet shell checks
/// `settings:edit` on the session (no location-resource helper here,
/// matching this shell's other scoped write commands); the entity is
/// resolved server-side through the store's primary location and the
/// write fails closed without one.
///
/// # ADR #49 NOT APPLIED, deliberately — delegating would ADD a gate
///
/// Refused 2026-09-16, on the same ground as [`set_receipt_layout_scoped`]: the
/// bridge twin adds an ADR #47 location-resource check —
/// `require_permission_for_session_resource(&session, SETTINGS_EDIT,
/// ScopeType::Location, &primary_location_id(&conn)?)`
/// (`crates/kasirmu-bridge/src/receipt_format.rs:150-155`) — which this shell has
/// never enforced, and §4 forbids adding a gate inside an extraction.
#[tauri::command]
pub async fn set_receipt_content_scoped(
    content: ReceiptContentArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<EffectiveReceiptFormat, AppError> {
    let (session, conn) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;
    let conn = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&conn);
    let primary = store.get_primary_location()?.ok_or_else(|| {
        AppError::Invalid("no primary location to resolve the entity from".into())
    })?;
    let entity_id = store
        .location_legal_entity_id(&primary.id)?
        .ok_or_else(|| {
            AppError::Invalid("no legal entity linked to the primary location".into())
        })?;
    let core_content = ReceiptContent {
        required_fields: content.required_fields,
        footer_text: content.footer_text,
        show_tax: content.show_tax,
        show_currency: content.show_currency,
        decimal_separator: content.decimal_separator,
    };
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    store.set_receipt_content_for_entity(&entity_id, &core_content, &now)?;
    Ok(store.effective_receipt_format(None, None)?)
}

/// One statutory-content submission from the card.
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
mod tests;
