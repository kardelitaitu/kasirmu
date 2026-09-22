//! Brand / white-label Tauri commands (tablet mirror).
//!
//! Exposes brand settings (primary colour, logo path, store name) to the
//! front-end. Logo file-picking is unavailable on tablet (no dialog plugin).

use serde::{Deserialize, Serialize};
use tauri::State;
use tauri::command;

use kasirmu_core::Settings;

use crate::error::AppError;
use crate::state::AppState;

/// All brand settings in one shot.
#[derive(Debug, Serialize, Deserialize)]
pub struct BrandSettingsDto {
    /// Primary brand colour as a hex string (e.g. `"#147EFB"`).
    pub primary_colour: String,
    /// Filesystem path to the store logo, if set.
    pub logo_path: Option<String>,
    /// Display name shown in the header.
    pub store_name: String,
}

/// Load all brand settings at once.
///
/// ADR #49 NOT APPLIED, deliberately — and not for the ledger's usual reason.
/// The ledger lists this door as `no_session_resolution`, so delegating would be
/// ledger-neutral; what stops it is the **storage source**. This body reads the
/// shell's `state.db`. The bridge twin reads a different database: it takes the
/// global lock, resolves the primary location (`get_primary_location`, falling
/// back to the first profile) and then opens **that location's store db** to read
/// the same three keys (`crates/kasirmu-bridge/src/branding.rs:128-159`). On a
/// multi-location install those are different rows, so delegating would change
/// what the header renders — a behaviour change, which §4 forbids inside an
/// extraction. Which store is canonical here is the same owner question T4-3
/// raises for hardware.
#[command]
pub async fn get_brand_settings(state: State<'_, AppState>) -> Result<BrandSettingsDto, AppError> {
    let conn = state.db.lock().await;
    Ok(BrandSettingsDto {
        primary_colour: Settings::get_brand_primary_colour(&conn)?,
        logo_path: Settings::get_brand_logo_path(&conn)?,
        store_name: Settings::get_brand_store_name(&conn)?,
    })
}

// ── The three unscoped setters are RETIRED (C17, 2026-09-22) ─────
//
// `set_brand_primary_colour`, `set_brand_logo_path` and `set_brand_store_name`
// used to sit here as class-1 debt: registered doors that resolve no session at
// all. Their session-scoped twins below were already registered and the UI had
// already moved to them (ui/src/api/branding.ts:32,39,46), so the unscoped doors
// were dead weight whose only measurable effect was to hold the debt ceiling up.
// They were removed by deletion, exactly as `settings::set_hardware_settings`
// was in T11 — the ratchet pays the debt by retiring the door, not by excusing it.
// The getter `get_brand_settings` above stays: it is still registered and still
// class 1, for the reason its own doc comment gives.

// ── Scoped variants: all four are case 2, and stay ──────────────
//
// `get_brand_settings_scoped`, `set_brand_primary_colour_scoped`,
// `set_brand_logo_path_scoped` and `set_brand_store_name_scoped` each resolve a
// session and then drop it (`_session`) without asking for a permission. All four
// are on this shell's debt ledger as `resolves_session_names_no_permission`, while
// the bridge's twins **do** gate: `get_brand_settings_scoped` on `settings:read`
// and the three setters on `settings:edit`
// (`crates/kasirmu-bridge/src/branding.rs:106, 212, 229, 247`). Delegating any of them
// would therefore make the sweep read the `kasirmu_bridge::` call as proof the shared
// funnel owns the RBAC, flipping four real ledger entries to "gated" without a
// permission being added — erasing debt rather than paying it, which §4 forbids.
// **Gating them is an owner ruling, not part of an extraction.**

/// Session-scoped variant of `get_brand_settings`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn get_brand_settings_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<BrandSettingsDto, AppError> {
    let (_session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let conn = &*db_guard;
    Ok(BrandSettingsDto {
        primary_colour: Settings::get_brand_primary_colour(&conn)?,
        logo_path: Settings::get_brand_logo_path(&conn)?,
        store_name: Settings::get_brand_store_name(&conn)?,
    })
}

/// Session-scoped variant of `set_brand_primary_colour`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn set_brand_primary_colour_scoped(
    session_token: String,
    colour: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let (_session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let conn = &*db_guard;
    Ok(Settings::set_brand_primary_colour(&conn, &colour)?)
}

/// Session-scoped variant of `set_brand_logo_path`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn set_brand_logo_path_scoped(
    session_token: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let (_session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let conn = &*db_guard;
    Ok(Settings::set_brand_logo_path(&conn, &path)?)
}

/// Session-scoped variant of `set_brand_store_name`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn set_brand_store_name_scoped(
    session_token: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let (_session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let conn = &*db_guard;
    Ok(Settings::set_brand_store_name(&conn, &name)?)
}

#[cfg(test)]
#[path = "branding_tests.rs"]
mod tests;
