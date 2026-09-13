//! Brand / white-label Tauri commands.
//!
//! Exposes brand settings (primary colour, logo path, location name) to the
//! front-end and provides a file-picker for the logo image.

// Wave F: eight bodies moved to oz_bridge::branding. pick_logo_file and
// pick_logo_file_scoped keep their full bodies here, byte-identical: the
// tauri_plugin_dialog blocking pick takes a Rust closure callback and
// BridgeCtx carries no dialog seam — inventing one is a parked owner
// decision, so this follows the browser.rs open_in_browser precedent. The
// app-data directory threaded to the two logo-set bridge fns is resolved
// here (app_handle.path() is tauri-only); it is NOT the ctx media_cache_dir
// (settings.rs module-doc rationale).

#[allow(unused_imports)] // sibling branding_tests.rs depends on it
use std::path::Path;

use tauri::Manager;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;
use oz_core::permissions;

pub use oz_bridge::branding::{ALLOWED_LOGO_EXTENSIONS, BrandSettingsDto};

/// Load all brand settings resolved from a session token. ADR #7.
#[tauri::command]
pub async fn get_brand_settings_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<BrandSettingsDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::branding::get_brand_settings_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Load brand settings from the primary location **without a session**.
///
/// Pre-auth IPC surface for the lock/login screen, which shows the location
/// name, logo, and brand colour before any user is signed in. Branding is
/// non-sensitive and location-wide, so the primary location is the correct
/// source when no session scope exists yet.
#[tauri::command]
pub async fn get_brand_settings(state: State<'_, AppState>) -> Result<BrandSettingsDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::branding::get_brand_settings(&ctx)
        .await
        .map_err(Into::into)
}

/// Set the primary brand colour.
#[tauri::command]
pub async fn set_brand_primary_colour(
    colour: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::branding::set_brand_primary_colour(&ctx, &colour)
        .await
        .map_err(Into::into)
}

/// Set the filesystem path to the store logo.
///
/// The path is validated to ensure it:
/// - Is empty (clears the logo) or points to an accessible file
/// - Resides inside the application data directory (H-3)
/// - Has an allowed image file extension (png, jpg, jpeg, gif, svg, webp)
///
/// An empty string clears the stored logo path.
#[tauri::command]
pub async fn set_brand_logo_path(path: String, state: State<'_, AppState>) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    let app_data = state
        .app
        .as_ref()
        .map(|app_handle| app_handle.path().app_data_dir().map_err(|e| e.to_string()));
    oz_bridge::branding::set_brand_logo_path(&ctx, &path, app_data)
        .await
        .map_err(Into::into)
}

/// Set the brand store display name.
#[tauri::command]
pub async fn set_brand_store_name(
    name: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::branding::set_brand_store_name(&ctx, &name)
        .await
        .map_err(Into::into)
}

/// Open a native file picker filtered to image files and return the
/// chosen path, or `None` if the user cancelled.
#[tauri::command]
pub async fn pick_logo_file(app_handle: tauri::AppHandle) -> Result<Option<String>, AppError> {
    use tokio::sync::oneshot;

    let (tx, rx) = oneshot::channel();
    app_handle
        .dialog()
        .file()
        .add_filter("Images", &["png", "jpg", "jpeg", "gif", "svg", "webp"])
        .pick_file(move |file| {
            let _ = tx.send(file);
        });
    let file = rx.await.unwrap_or(None);
    Ok(file.map(|f| f.to_string()))
}

// ── Scoped variants (ADR #7) ────────────────────────────────────

/// Scoped variant of `set_brand_primary_colour` (ADR #7).
#[tauri::command]
pub async fn set_brand_primary_colour_scoped(
    colour: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::branding::set_brand_primary_colour_scoped(&ctx, &colour, &session_token)
        .await
        .map_err(Into::into)
}

/// Scoped variant of `set_brand_store_name` (ADR #7).
#[tauri::command]
pub async fn set_brand_store_name_scoped(
    name: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::branding::set_brand_store_name_scoped(&ctx, &name, &session_token)
        .await
        .map_err(Into::into)
}

/// Set the brand logo path (scoped — two-phase db access).
#[tauri::command]
pub async fn set_brand_logo_path_scoped(
    path: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    let app_data = state
        .app
        .as_ref()
        .map(|app_handle| app_handle.path().app_data_dir().map_err(|e| e.to_string()));
    oz_bridge::branding::set_brand_logo_path_scoped(&ctx, &path, &session_token, app_data)
        .await
        .map_err(Into::into)
}

/// Session-scoped variant of [`pick_logo_file`].
#[tauri::command]
pub async fn pick_logo_file_scoped(
    session_token: String,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<String>, AppError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;
    pick_logo_file(app_handle).await
}
