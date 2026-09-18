//! User-avatar commands.
//!
//! The command bodies live in the headless `kasirmu_bridge::avatars` module;
//! each `#[tauri::command]` here is a shim that borrows a `BridgeCtx`, injects
//! the media root, and maps `BridgeError` back to `AppError`.
//!
//! `users.avatar` stores the 16-hex-char content hash of an image in the
//! content-addressed store — the same value and the same on-disk layout the
//! product images use, because `set_avatar_scoped` shares their ingest
//! pipeline. The renderer resolves it through `ProductThumb`, which falls back
//! to an initials tile when the column is NULL.
//!
//! The media root is INJECTED: `bridge_ctx()` resolves `app_cache_dir()` at
//! the tauri seam and carries it as `BridgeCtx::media_cache_dir`. When that
//! resolution failed (headless / degraded) the shim reports the same
//! `resolving app cache dir` error text the product-image shim produces.

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

// ── Command: set avatar ────────────────────────────────────────────────

/// Set `user_id`'s avatar from the image at `source_path`.
///
/// `source_path` is the file chosen via the front-end dialog plugin, so zero
/// image bytes cross the IPC bridge. Self-writes (a cashier setting their own
/// photo) need no grant; writing another user's avatar requires `staff:update`.
///
/// Returns the 16-hex-char content hash now stored in `users.avatar`.
#[tauri::command]
pub async fn set_avatar_scoped(
    session_token: String,
    user_id: String,
    source_path: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let ctx = state.bridge_ctx();
    let image_root = ctx.media_cache_dir.clone().ok_or_else(|| {
        // `bridge_ctx()` degrades a failed `app_cache_dir()` resolution to
        // `None` (logging the underlying error there); surface the same
        // error text the product-image pipeline reported.
        AppError::Internal("resolving app cache dir: media root unavailable".into())
    })?;
    kasirmu_bridge::avatars::set_avatar_scoped(
        &ctx,
        &session_token,
        &user_id,
        &source_path,
        &image_root,
    )
    .await
    .map_err(Into::into)
}

// ── Command: clear avatar ──────────────────────────────────────────────

/// Clear `user_id`'s avatar back to the initials fallback.
///
/// Only the column is cleared; the file on disk is left for the GC sweep,
/// since content-addressed dedup means the same bytes may still be referenced
/// by a product or another user.
#[tauri::command]
pub async fn clear_avatar_scoped(
    session_token: String,
    user_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::avatars::clear_avatar_scoped(&ctx, &session_token, &user_id)
        .await
        .map_err(Into::into)
}

// ── Command: read own avatar ───────────────────────────────────────────

/// Read the SESSION user's own avatar hash, or null when none is set.
///
/// Takes no `user_id`: the subject is always the caller, so there is nothing
/// to forge and no grant to check beyond a valid session. This is what the
/// sidebar header reads, because `get_staff_profile_scoped` requires
/// `staff:read` and a cashier does not hold it.
#[tauri::command]
pub async fn get_own_avatar_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<String>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::avatars::get_own_avatar_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}
