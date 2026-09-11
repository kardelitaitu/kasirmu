//! Brand / white-label command bodies (primary colour, logo path, location name).
//!
//! Wave F: extracted byte-for-byte from
//! `apps/desktop-client/src/commands/branding.rs`, except `pick_logo_file`
//! and `pick_logo_file_scoped`, which keep their full bodies desktop-side:
//! `tauri_plugin_dialog`'s blocking pick takes a Rust closure callback and
//! `BridgeCtx` carries no dialog seam (inventing one is a parked owner
//! decision) — the `browser.rs` open_in_browser pattern. The two logo-set
//! commands take the app-data directory as a trailing `app_data` parameter
//! resolved by the shim: it is NOT the ctx `media_cache_dir` (different
//! directory — see the settings.rs module-doc rationale), and the
//! `resolving app data dir: {e}` error text, empty-path early return and
//! canonicalisation order are preserved exactly.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use oz_core::Settings;
use oz_core::db::Store;
use oz_core::permissions;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// All brand settings in one shot.
#[derive(Debug, Serialize, Deserialize)]
pub struct BrandSettingsDto {
    /// Primary brand colour as a hex string (e.g. `"#147EFB"`).
    pub primary_colour: String,
    /// Filesystem path to the location logo, if set.
    pub logo_path: Option<String>,
    /// Display name shown in the header.
    pub store_name: String,
}

/// Allowed file extensions for the store logo image.
/// Matches the filter used by `pick_logo_file`.
///
/// pub: the sibling desktop test (branding_tests.rs) reads this list
/// directly through the shim's re-export (C5 widening precedent).
pub const ALLOWED_LOGO_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "svg", "webp"];

/// Validate that `path` is a safe image path within the app data directory.
///
/// Returns the canonicalised path string on success, or an error
/// describing why the path was rejected. `app_data` is the pre-mapped
/// result of the shim's `app_handle.path().app_data_dir()` (Err carries
/// the Display text so the original message is rebuilt verbatim).
fn validate_logo_path(
    app_data: &Result<PathBuf, String>,
    path: &str,
) -> Result<String, BridgeError> {
    // Empty path is allowed — clears the logo.
    if path.is_empty() {
        return Ok(String::new());
    }

    // Resolve the app data directory.
    let app_data = app_data
        .as_ref()
        .map_err(|e| BridgeError::Internal(format!("resolving app data dir: {e}")))?;

    // Canonicalise both paths to resolve symlinks and relative components.
    let canonical_path = std::fs::canonicalize(Path::new(path))
        .map_err(|e| BridgeError::Invalid(format!("logo path is not accessible: {e}")))?;

    let canonical_app_data = std::fs::canonicalize(app_data)
        .map_err(|e| BridgeError::Internal(format!("app data dir not accessible: {e}")))?;

    // The logo path must be inside the app data directory.
    if !canonical_path.starts_with(&canonical_app_data) {
        return Err(BridgeError::Invalid(
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
        return Err(BridgeError::Invalid(format!(
            "logo file type '.{ext}' is not allowed; accepted: {}",
            ALLOWED_LOGO_EXTENSIONS.join(", ")
        )));
    }

    // Convert back to a string for storage.
    canonical_path
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| BridgeError::Invalid("logo path contains non-UTF-8 characters".into()))
}

/// Load all brand settings resolved from a session token. ADR #7.
pub async fn get_brand_settings_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<BrandSettingsDto, BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_READ)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    Ok(BrandSettingsDto {
        primary_colour: Settings::get_brand_primary_colour(&db)?,
        logo_path: Settings::get_brand_logo_path(&db)?,
        store_name: Settings::get_brand_store_name(&db)?,
    })
}

/// Load brand settings from the primary location **without a session**.
///
/// Pre-auth IPC surface for the lock/login screen, which shows the location
/// name, logo, and brand colour before any user is signed in. Branding is
/// non-sensitive and location-wide, so the primary location is the correct
/// source when no session scope exists yet.
pub async fn get_brand_settings(ctx: &BridgeCtx<'_>) -> Result<BrandSettingsDto, BridgeError> {
    let primary_id = {
        let db = ctx.lock_global().await;
        let store = Store::new(&db);
        // Prefer the primary location; fall back to the first profile so
        // installs whose seeding never promoted a primary (is_primary=0)
        // still get lock-screen branding instead of an error toast.
        match store.get_primary_location()? {
            Some(primary) => primary.id,
            None => {
                store
                    .list_locations()?
                    .into_iter()
                    .next()
                    .ok_or_else(|| BridgeError::Internal("no location profile found".into()))?
                    .id
            }
        }
    };
    let conn = ctx
        .db_manager
        .open_store(&primary_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    Ok(BrandSettingsDto {
        primary_colour: Settings::get_brand_primary_colour(&db)?,
        logo_path: Settings::get_brand_logo_path(&db)?,
        store_name: Settings::get_brand_store_name(&db)?,
    })
}

/// Set the primary brand colour.
pub async fn set_brand_primary_colour(
    ctx: &BridgeCtx<'_>,
    colour: &str,
) -> Result<(), BridgeError> {
    let conn = ctx.lock_global().await;
    Ok(Settings::set_brand_primary_colour(&conn, colour)?)
}

/// Set the filesystem path to the store logo.
///
/// The path is validated to ensure it:
/// - Is empty (clears the logo) or points to an accessible file
/// - Resides inside the application data directory (H-3)
/// - Has an allowed image file extension (png, jpg, jpeg, gif, svg, webp)
///
/// An empty string clears the stored logo path.
pub async fn set_brand_logo_path(
    ctx: &BridgeCtx<'_>,
    path: &str,
    app_data: Option<Result<PathBuf, String>>,
) -> Result<(), BridgeError> {
    // Validate the path against app data directory rules (H-3).
    if let Some(ref app_data) = app_data {
        let validated = validate_logo_path(app_data, path)?;
        let conn = ctx.lock_global().await;
        Ok(Settings::set_brand_logo_path(&conn, &validated)?)
    } else {
        // No AppHandle available (test/headless context) — allow the write
        // without validation for backward compatibility.
        let conn = ctx.lock_global().await;
        Ok(Settings::set_brand_logo_path(&conn, path)?)
    }
}

/// Set the brand store display name.
pub async fn set_brand_store_name(ctx: &BridgeCtx<'_>, name: &str) -> Result<(), BridgeError> {
    let conn = ctx.lock_global().await;
    Ok(Settings::set_brand_store_name(&conn, name)?)
}

// ── Scoped variants (ADR #7) ────────────────────────────────────

/// Scoped variant of `set_brand_primary_colour` (ADR #7).
pub async fn set_brand_primary_colour_scoped(
    ctx: &BridgeCtx<'_>,
    colour: &str,
    session_token: &str,
) -> Result<(), BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_EDIT)
        .await?;
    let (_session, _conn) = ctx.resolve_scope(session_token)?;
    let conn = _conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    Ok(Settings::set_brand_primary_colour(&conn, colour)?)
}

/// Scoped variant of `set_brand_store_name` (ADR #7).
pub async fn set_brand_store_name_scoped(
    ctx: &BridgeCtx<'_>,
    name: &str,
    session_token: &str,
) -> Result<(), BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_EDIT)
        .await?;
    let (_session, _conn) = ctx.resolve_scope(session_token)?;
    let conn = _conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    Ok(Settings::set_brand_store_name(&conn, name)?)
}

/// Set the brand logo path (scoped — two-phase db access).
pub async fn set_brand_logo_path_scoped(
    ctx: &BridgeCtx<'_>,
    path: &str,
    session_token: &str,
    app_data: Option<Result<PathBuf, String>>,
) -> Result<(), BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_EDIT)
        .await?;
    ctx.resolve_scope(session_token)?;
    if let Some(ref app_data) = app_data {
        let validated = validate_logo_path(app_data, path)?;
        let conn = ctx.lock_global().await;
        Ok(Settings::set_brand_logo_path(&conn, &validated)?)
    } else {
        let conn = ctx.lock_global().await;
        Ok(Settings::set_brand_logo_path(&conn, path)?)
    }
}
