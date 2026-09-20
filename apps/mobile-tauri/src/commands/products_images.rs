//! Product image write commands — the tablet half of the desktop's
//! `products_images.rs`.
//!
//! ## Why this module exists (b-full Phase 3, 2026-09-20)
//!
//! `ui/src/features/retail/EditProductModal.tsx` calls
//! `products_set_image_scoped` / `products_clear_image_scoped`, and the tablet
//! mounts that modal. Until this module existed, the tablet had **nothing
//! registered** to answer either name, so — after Phase 2 taught the modal to
//! pick an image at all — the pick succeeded and then the write failed as
//! "command not found". Phase 2 alone is therefore not a working feature; this
//! module is the other half of it.
//!
//! ## What `source_path` is on this shell
//!
//! The same field carries two different things, and the difference is invisible
//! from here:
//!
//! * desktop — the absolute path the dialog plugin returned;
//! * Android — the absolute path of a copy inside the app cache, made by
//!   `ui/src/api/file-bridge.ts` from the `content://` URI the Storage Access
//!   Framework returned. `tokio::fs` cannot open a URI, so the crossing happens
//!   in JS and this shim receives the ordinary path desktop always sent.
//!
//! The ingest pipeline then sniffs magic bytes and ignores the extension, so the
//! copy's name is irrelevant to correctness.
//!
//! ## The media root
//!
//! `AppState::bridge_ctx()` already injects `media_cache_dir`, resolved from
//! `AppHandle::path().app_cache_dir()` because no tauri type may enter
//! `kasirmu-bridge` (`apps/mobile-tauri/src/state.rs:449-458`). A failed
//! resolution degrades to `None` there, and is surfaced here with the same error
//! text the desktop pipeline reports.
//!
//! ## ADR #49
//!
//! The bodies are the bridge's. These shims borrow a `BridgeCtx` and map
//! `BridgeError` back to `AppError`; they hold no SQL, no gate and no lock.
//!
//! Classification, measured rather than assumed:
//! `crates/kasirmu-bridge/src/products_images.rs` names
//! `permissions::PRODUCTS_UPDATE` (`:196`, `:249`) and `permissions::PRODUCTS_READ`
//! (`:280`), so its file stem is in `gated_bridge_stems()` and a shim whose text
//! names `kasirmu_bridge::products_images` reads `Gated` — both doors are
//! ledger-neutral and add no debt row.
//!
//! ## One difference from desktop, deliberate
//!
//! Desktop's `products_set_image_scoped` also takes `app_handle: AppHandle`,
//! kept there purely for IPC-contract parity and unused in the body
//! (`#[allow(unused_variables)]`). It is omitted here: Tauri injects a handle
//! only when a parameter asks for one, nothing in the body wants it, and
//! carrying a dead parameter across two shells to preserve a signature the
//! renderer cannot see would be cargo-culting the desktop file.

use tauri::{State, command};

use crate::error::AppError;
use crate::state::AppState;

/// The error text both shells report when the media root cannot be resolved.
///
/// `bridge_ctx()` logs the underlying error and degrades to `None`; a caller
/// still has to be told, and told the same thing on both shells.
const MEDIA_ROOT_UNAVAILABLE: &str = "resolving app cache dir: media root unavailable";

// ── Command: set image ──────────────────────────────────────────

/// Assign the image at `source_path` to `product_id` at `slot` (1..=5).
///
/// The whole ingest pipeline runs in Rust — transcode, hash, content-addressed
/// store — so no image bytes cross the IPC boundary; `source_path` is all that
/// is sent.
///
/// Returns the 16-hex-char content hash of the transcoded image.
#[command]
pub async fn products_set_image_scoped(
    session_token: String,
    product_id: String,
    slot: i32,
    source_path: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let ctx = state.bridge_ctx();
    let image_root = ctx
        .media_cache_dir
        .clone()
        .ok_or_else(|| AppError::Internal(MEDIA_ROOT_UNAVAILABLE.into()))?;
    kasirmu_bridge::products_images::set_image_scoped(
        &ctx,
        &session_token,
        &product_id,
        slot,
        &source_path,
        &image_root,
    )
    .await
    .map_err(Into::into)
}

// ── Command: clear image ────────────────────────────────────────

/// Remove the image at `slot` for `product_id`.
///
/// Only the DB assignment is removed; the file on disk is left for the GC sweep,
/// because content-addressed dedup means the same file may still be referenced
/// by another product.
#[command]
pub async fn products_clear_image_scoped(
    session_token: String,
    product_id: String,
    slot: i32,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::products_images::clear_image_scoped(&ctx, &session_token, &product_id, slot)
        .await
        .map_err(Into::into)
}
