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
//! Wave D / D4b: the bodies now live in the headless
//! `oz_bridge::receipt_format` module. Each `#[tauri::command]` below
//! keeps its exact name, parameter list, attributes and
//! `Result<_, AppError>` wire contract; it builds a `BridgeCtx` from
//! `AppState` and delegates, preserving gate order and the ADR #47
//! location-resource checks. The args DTOs moved with the bodies and are
//! re-exported so `use super::*` in `receipt_format_tests.rs` still
//! resolves them.

use tauri::State;

use oz_core::db::receipt_formats::EffectiveReceiptFormat;

use crate::error::AppError;
use crate::state::AppState;

pub use oz_bridge::receipt_format::{ReceiptContentArgs, ReceiptLayoutArgs};

/// Read the effective receipt format for the session's terminal (or the
/// store default when no terminal is bound): statutory content from the
/// linked legal entity as-is, layout merged terminal → workspace →
/// legacy with provenance.
#[tauri::command]
pub async fn get_receipt_format_scoped(
    terminal_id: Option<String>,
    workspace_id: Option<String>,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<EffectiveReceiptFormat, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::receipt_format::get_receipt_format_scoped(
        &ctx,
        terminal_id,
        workspace_id,
        &session_token,
    )
    .await
    .map_err(Into::into)
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
#[tauri::command]
pub async fn set_receipt_layout_scoped(
    layout: ReceiptLayoutArgs,
    workspace_id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<EffectiveReceiptFormat, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::receipt_format::set_receipt_layout_scoped(
        &ctx,
        &layout,
        &workspace_id,
        &session_token,
    )
    .await
    .map_err(Into::into)
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
#[tauri::command]
pub async fn set_receipt_content_scoped(
    content: ReceiptContentArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<EffectiveReceiptFormat, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::receipt_format::set_receipt_content_scoped(&ctx, &content, &session_token)
        .await
        .map_err(Into::into)
}
