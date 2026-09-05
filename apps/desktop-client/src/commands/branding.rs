//! Brand / white-label Tauri commands.
//!
//! Exposes brand settings (primary colour, logo path, store name) to the
//! front-end and provides a file-picker for the logo image.

use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

use oz_core::Settings;
use oz_core::db::Store;

use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;
use oz_core::permissions;

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

/// Load all brand settings resolved from a session token. ADR #7.
#[tauri::command]
pub async fn get_brand_settings_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<BrandSettingsDto, AppError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_READ).await?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    Ok(BrandSettingsDto {
        primary_colour: Settings::get_brand_primary_colour(&db)?,
        logo_path: Settings::get_brand_logo_path(&db)?,
        store_name: Settings::get_brand_store_name(&db)?,
    })
}

/// Load brand settings from the primary store **without a session**.
///
/// Pre-auth IPC surface for the lock/login screen, which shows the store
/// name, logo, and brand colour before any user is signed in. Branding is
/// non-sensitive and store-wide, so the primary store is the correct
/// source when no session scope exists yet.
#[tauri::command]
pub async fn get_brand_settings(state: State<'_, AppState>) -> Result<BrandSettingsDto, AppError> {
    let primary_id = {
        let db = state.db.lock().await;
        let store = Store::new(&db);
        // Prefer the primary store; fall back to the first profile so
        // installs whose seeding never promoted a primary (is_primary=0)
        // still get lock-screen branding instead of an error toast.
        match store.get_primary_store()? {
            Some(primary) => primary.id,
            None => {
                store
                    .list_store_profiles()?
                    .into_iter()
                    .next()
                    .ok_or_else(|| AppError::Internal("no store profile found".into()))?
                    .id
            }
        }
    };
    let conn = state
        .db_manager
        .open_store(&primary_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    Ok(BrandSettingsDto {
        primary_colour: Settings::get_brand_primary_colour(&db)?,
        logo_path: Settings::get_brand_logo_path(&db)?,
        store_name: Settings::get_brand_store_name(&db)?,
    })
}

/// Set the primary brand colour.
#[tauri::command]
pub async fn set_brand_primary_colour(
    colour: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let conn = state.db.lock().await;
    Ok(Settings::set_brand_primary_colour(&conn, &colour)?)
}

/// Allowed file extensions for the store logo image.
/// Matches the filter used by `pick_logo_file`.
const ALLOWED_LOGO_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "svg", "webp"];

/// Validate that `path` is a safe image path within the app data directory.
///
/// Returns the canonicalised path string on success, or an `AppError`
/// describing why the path was rejected.
fn validate_logo_path(app_handle: &tauri::AppHandle, path: &str) -> Result<String, AppError> {
    // Empty path is allowed — clears the logo.
    if path.is_empty() {
        return Ok(String::new());
    }

    // Resolve the app data directory.
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(format!("resolving app data dir: {e}")))?;

    // Canonicalise both paths to resolve symlinks and relative components.
    let canonical_path = std::fs::canonicalize(Path::new(path))
        .map_err(|e| AppError::Invalid(format!("logo path is not accessible: {e}")))?;

    let canonical_app_data = std::fs::canonicalize(&app_data)
        .map_err(|e| AppError::Internal(format!("app data dir not accessible: {e}")))?;

    // The logo path must be inside the app data directory.
    if !canonical_path.starts_with(&canonical_app_data) {
        return Err(AppError::Invalid(
            "logo path must be inside the application data directory".into(),
        ));
    }

    // Check the file extension is in the allowed list.
    let ext = canonical_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    if !ALLOWED_LOGO_EXTENSIONS.contains(&ext.as_str()) {
        return Err(AppError::Invalid(format!(
            "logo file type '.{ext}' is not allowed; accepted: {}",
            ALLOWED_LOGO_EXTENSIONS.join(", ")
        )));
    }

    // Convert back to a string for storage.
    canonical_path
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::Invalid("logo path contains non-UTF-8 characters".into()))
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
    // Validate the path against app data directory rules (H-3).
    if let Some(ref app_handle) = state.app {
        let validated = validate_logo_path(app_handle, &path)?;
        let conn = state.db.lock().await;
        Ok(Settings::set_brand_logo_path(&conn, &validated)?)
    } else {
        // No AppHandle available (test/headless context) — allow the write
        // without validation for backward compatibility.
        let conn = state.db.lock().await;
        Ok(Settings::set_brand_logo_path(&conn, &path)?)
    }
}

/// Set the brand store display name.
#[tauri::command]
pub async fn set_brand_store_name(
    name: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let conn = state.db.lock().await;
    Ok(Settings::set_brand_store_name(&conn, &name)?)
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
    // F-017: enforce per-domain permission on this scoped command.
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;
    let (_session, _conn) = state.resolve_scope(&session_token)?;
    let conn = _conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    Ok(Settings::set_brand_primary_colour(&conn, &colour)?)
}

/// Scoped variant of `set_brand_store_name` (ADR #7).
#[tauri::command]
pub async fn set_brand_store_name_scoped(
    name: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;
    let (_session, _conn) = state.resolve_scope(&session_token)?;
    let conn = _conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    Ok(Settings::set_brand_store_name(&conn, &name)?)
}

/// Set the brand logo path (scoped — two-phase db access).
#[tauri::command]
pub async fn set_brand_logo_path_scoped(
    path: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;
    state.resolve_scope(&session_token)?;
    if let Some(ref app_handle) = state.app {
        let validated = validate_logo_path(app_handle, &path)?;
        let conn = state.db.lock().await;
        Ok(Settings::set_brand_logo_path(&conn, &validated)?)
    } else {
        let conn = state.db.lock().await;
        Ok(Settings::set_brand_logo_path(&conn, &path)?)
    }
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

#[cfg(test)]
#[path = "branding_tests.rs"]
mod tests;
