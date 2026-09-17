//! Brand / white-label Tauri commands (tablet mirror).
//!
//! Exposes brand settings (primary colour, logo path, store name) to the
//! front-end. Logo file-picking is unavailable on tablet (no dialog plugin).

use serde::{Deserialize, Serialize};
use tauri::State;
use tauri::command;

use oz_core::Settings;

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

/// Set the primary brand colour.
///
/// ADR #49: the body is the bridge's, and this delegation is a pure identity.
/// `kasirmu_bridge::branding::set_brand_primary_colour` locks `ctx.lock_global()`,
/// which `AppState::bridge_ctx` binds to this same `state.db` — the same lock on
/// the same connection — and calls the same `Settings::set_brand_primary_colour`.
/// Ledger-neutral by construction: this door resolves no session (it presents no
/// `session_token`), so the sweep's `resolves_session` arm is false for it
/// whatever the `kasirmu_bridge::` call says.
#[command]
pub async fn set_brand_primary_colour(
    colour: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::branding::set_brand_primary_colour(&ctx, &colour)
        .await
        .map_err(Into::into)
}

/// Set the filesystem path to the store logo.
///
/// ADR #49 NOT APPLIED, deliberately. The bridge twin does **more** than this
/// body: it validates the path first — inside the app data directory, with an
/// extension from `ALLOWED_LOGO_EXTENSIONS` — and writes the *canonicalised*
/// result (`crates/kasirmu-bridge/src/branding.rs:178-194`, H-3). This shell has
/// never validated, so delegating would either add a check that can start
/// refusing paths the tablet accepts today, or require passing `app_data: None`
/// to opt out of it — a security-relevant choice, not an extraction. §4 forbids
/// both inside a port, so the body stays and the difference is reported. The
/// tablet has no dialog plugin, so its logo path is set by other means.
#[command]
pub async fn set_brand_logo_path(path: String, state: State<'_, AppState>) -> Result<(), AppError> {
    let conn = state.db.lock().await;
    Ok(Settings::set_brand_logo_path(&conn, &path)?)
}

/// Set the brand store display name.
///
/// ADR #49: the body is the bridge's, and this delegation is a pure identity —
/// same `ctx.lock_global()` lock on the same `state.db`, same
/// `Settings::set_brand_store_name` call. Ledger-neutral by construction, since
/// this door resolves no session.
#[command]
pub async fn set_brand_store_name(
    name: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::branding::set_brand_store_name(&ctx, &name)
        .await
        .map_err(Into::into)
}

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
