//! Receipt format commands (receipt-format axis) — tablet twin. The
//! tablet shell checks `settings:edit` on the session; the location-
//! resource scoping the desktop layers on top (ADR #47) has no tablet
//! helper yet, matching this shell's other scoped write commands.

use oz_core::db::receipt_formats::{EffectiveReceiptFormat, ReceiptLayout};
use oz_core::{Store, permissions};
use tauri::State;

use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;

/// Read the effective receipt format for the session's terminal.
#[tauri::command]
pub async fn get_receipt_format_scoped(
    terminal_id: Option<String>,
    workspace_id: Option<String>,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<EffectiveReceiptFormat, AppError> {
    let (session, conn) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_READ).await?;
    let conn = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&conn);
    Ok(store.effective_receipt_format(terminal_id.as_deref(), workspace_id.as_deref())?)
}

/// Replace the workspace-layer layout record for the session's store db
/// and return the freshly effective format.
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
    pub margin_bottom_mm: Option<i64>,
    pub margin_left_mm: Option<i64>,
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

#[cfg(test)]
#[path = "receipt_format_tests.rs"]
mod tests;
