//! Avatar command bodies — the tauri-free half of the desktop shell's
//! `set_avatar_scoped` / `clear_avatar_scoped`.
//!
//! `users.avatar` holds the 16-hex-char content hash of an image in the
//! content-addressed store (spec 0046b) — the same value `ProductThumb`
//! resolves to `$APPCACHE/images/{hash16}.webp`. `NULL` means "no photo" and
//! the renderer falls back to an initials tile, so clearing is a real state
//! rather than a broken image.
//!
//! The ingest is NOT duplicated here. [`set_avatar_scoped`] calls
//! [`crate::products_images::ingest_to_store`], the shared DB-free half of the
//! product-image pipeline, so an avatar is transcoded, capped and hashed by
//! exactly the same code path as a product photo. This module owns only the
//! permission rule and the reference write.
//!
//! The media root is INJECTED (`BridgeCtx::media_cache_dir`), never resolved
//! here, so the on-disk layout is byte-identical to the product images'.
//!
//! `users.avatar` is an IDENTITY column, so all three bodies read and write
//! the GLOBAL identity DB (`BridgeCtx::lock_global`) — the same connection
//! `update_staff_scoped` and `get_staff_profile_scoped` use. The per-store
//! `users` table holds a different row for the same person, and is not where
//! the staff list looks; `resolve_store` there would file the photo out of
//! sight.
//!
//! ## Permission rule
//!
//! Self-write (`user_id == session.user_id`) is allowed without any grant: a
//! cashier owns their own face. Writing someone ELSE's avatar requires
//! `staff:update`, which is the manager path the staff drawer uses. There is
//! deliberately no third case — a caller who is neither the subject nor a
//! staff editor is denied.

use std::path::Path;

use kasirmu_core::db::Store;
use kasirmu_core::permissions;
use kasirmu_core::session::SessionContext;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;
use crate::products_images::ingest_to_store;

/// Gate a write to `user_id`'s avatar.
///
/// Returns `Ok(())` for a self-write, otherwise enforces `staff:update`
/// scope-aware against the global identity DB.
///
/// # Errors
///
/// Returns [`BridgeError::PermissionDenied`] when the caller is neither the
/// subject nor a holder of `staff:update`.
async fn require_avatar_write(
    ctx: &BridgeCtx<'_>,
    session: &SessionContext,
    user_id: &str,
) -> Result<(), BridgeError> {
    if session.user_id == user_id {
        return Ok(());
    }
    ctx.require_session_permission(session, permissions::STAFF_UPDATE)
        .await
}

/// Set `user_id`'s avatar from the image at `source_path`.
///
/// `source_path` is a filesystem path chosen by the caller (the desktop shell
/// hands it the value the dialog plugin returned). The ingest is shared with
/// the product-image pipeline, so the same format, size and dimension caps
/// apply: WebP/JPEG/PNG in, 512 px WebP out.
///
/// `image_root` is the INJECTED media root; the transcoded file lands at
/// `image_root/images/{hash16}.webp`.
///
/// Returns the 16-hex-char content hash now stored in `users.avatar`.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown/expired token,
/// [`BridgeError::PermissionDenied`] when the caller is neither the subject
/// nor a `staff:update` holder, [`BridgeError::Invalid`] for an empty path or
/// an image the pipeline rejects, and [`BridgeError::Core`] /
/// [`BridgeError::Internal`] on store or filesystem failures.
pub async fn set_avatar_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    user_id: &str,
    source_path: &str,
    image_root: &Path,
) -> Result<String, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_avatar_write(ctx, &session, user_id).await?;

    let ingested = ingest_to_store(source_path, image_root).await?;
    let hash16 = ingested.hash16;

    // The GLOBAL identity DB, not the per-store one: `users.avatar` is an
    // identity column, and `update_staff_scoped` / `get_staff_profile_scoped`
    // read it through `ctx.lock_global()`. Writing the store-scoped `users`
    // table would file the photo somewhere the staff list never looks.
    //
    // The lock is taken AFTER the ingest so the guard never spans the
    // transcode, and everything below stays free of `.await`.
    let db = ctx.lock_global().await;
    let store = Store::new(&db);
    store.set_user_avatar(user_id, Some(hash16.as_str()))?;

    // Enqueue for the cloud push scheduler (spec 0046b §3.6). The bytes are
    // already transcoded + content-hashed; only the pending-upload bookkeeping
    // happens here, so the picker never waits on the network.
    store.enqueue_image_push(&hash16, ingested.byte_len as i64)?;

    tracing::info!(user_id, hash = %hash16, "avatar set");
    Ok(hash16)
}

/// Clear `user_id`'s avatar back to the initials fallback.
///
/// Only the column is cleared; the file on disk is left for the GC sweep, for
/// the same reason the product images are: content-addressed dedup means the
/// bytes may still be referenced by a product or another user.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`]
/// on the same rule as [`set_avatar_scoped`], and [`BridgeError::Core`] /
/// [`BridgeError::Internal`] on store failures.
pub async fn clear_avatar_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    user_id: &str,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_avatar_write(ctx, &session, user_id).await?;

    let db = ctx.lock_global().await;
    let store = Store::new(&db);
    store.set_user_avatar(user_id, None)?;

    tracing::info!(user_id, "avatar cleared");
    Ok(())
}

// ── Command body: read own avatar ──────────────────────────────────────

/// Read the SESSION user's own avatar hash.
///
/// No permission beyond a valid session, and no `user_id` parameter — the
/// subject is the caller, so there is no id to forge. This is why it is not
/// `get_staff_profile_scoped`: that read requires `staff:read`, which a
/// cashier does not hold, and it would fail closed on an undecryptable
/// sensitive column that has nothing to do with a photo.
///
/// Returns `None` when no photo is set, which the renderer shows as the
/// initials fallback.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown/expired token and
/// [`BridgeError::Core`] / [`BridgeError::Internal`] on store failures.
pub async fn get_own_avatar_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Option<String>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;

    let db = ctx.lock_global().await;
    let store = Store::new(&db);
    store.get_user_avatar(&session.user_id).map_err(Into::into)
}

#[cfg(test)]
#[path = "avatars_tests.rs"]
mod avatars_tests;
