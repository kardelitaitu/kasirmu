//! Product/Menu image ingest commands (spec 0046b §3.3).
//!
//! Wave A / S8: the ingest pipeline lives in the headless
//! `oz_bridge::products_images` module. Each `#[tauri::command]` below keeps
//! its exact name, parameter list (including the injected `app_handle`) and
//! `Result<_, AppError>` return so the registered IPC surface and the
//! serialized error shape are unchanged; the shim borrows a `BridgeCtx`,
//! injects the media root, and maps `BridgeError` back to `AppError`
//! variant-for-variant.
//!
//! `products_set_image_scoped` is the full ingest pipeline on the authoring
//! (desktop) device: it reads the source file chosen via the dialog plugin,
//! sniffs magic bytes, validates size/dimension caps, decodes, resizes to
//! 512 px longest edge, encodes as lossy WebP (adaptive q40 → q30 → q24 when
//! over the size cap), computes the SHA-256 content hash, atomically writes
//! `{hash16}.webp` under `images/` in the app cache (served by Tauri's asset
//! protocol), and finally assigns the hash to the product slot via
//! `Store::set_product_image`.
//!
//! The media root is INJECTED: `bridge_ctx()` resolves `app_cache_dir()` at
//! the tauri seam and carries it as `BridgeCtx::media_cache_dir`; the bridge
//! appends `images/{hash16}.webp` — the same layout the retained
//! `resolve_image_path` seam below documents. When the seam could not resolve
//! the cache dir (headless / degraded), the shim reports the same
//! `resolving app cache dir` error text the original pipeline produced.
//!
//! `products_clear_image_scoped` removes the DB assignment (the file lingers
//! until GC — content-addressed dedup means it may be referenced elsewhere).
//!
//! Per decision §5.6, the `image` + `webp` crates are now linked in
//! `oz-bridge` (which hosts the pipeline headlessly) and stay linked here for
//! the sibling test module. Tablet renders + downloads; cloud re-verifies
//! magic + sha-256 only.

use std::path::PathBuf;

// Retained for the sibling test module, which reaches the pure pipeline
// helpers and size caps through `use super::*`; the command bodies
// themselves delegate to the bridge.
#[allow(unused_imports)] // sibling products_images_tests.rs depends on it
use oz_bridge::products_images::{MAX_DIMENSION, SIZE_HARD_REJECT};
#[allow(unused_imports)] // sibling products_images_tests.rs depends on it
use oz_bridge::products_images::{sha256_hex16, sniff_format};

use tauri::Manager;
use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

pub use oz_bridge::products_images::ProductImageDto;

// ── Command: set image ─────────────────────────────────────────────────

/// Assign the image at `source_path` to `product_id` at `slot` (1..=5).
///
/// The ingest pipeline runs entirely in Rust: `source_path` is the file
/// chosen via the front-end dialog plugin, so zero image bytes cross the
/// IPC bridge. The pipeline itself lives in `oz_bridge::products_images`;
/// this shim injects the media root and maps the error back.
///
/// Returns the 16-hex-char content hash of the transcoded image.
#[tauri::command]
// `app_handle` is kept for IPC-contract parity (registered command
// signature); the media root itself is injected via BridgeCtx.
#[allow(unused_variables)]
pub async fn products_set_image_scoped(
    session_token: String,
    product_id: String,
    slot: i32,
    source_path: String,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<String, AppError> {
    let ctx = state.bridge_ctx();
    let image_root = ctx.media_cache_dir.clone().ok_or_else(|| {
        // `bridge_ctx()` degrades a failed `app_cache_dir()` resolution to
        // `None` (logging the underlying error there); surface the same
        // error text the original pipeline reported.
        AppError::Internal("resolving app cache dir: media root unavailable".into())
    })?;
    oz_bridge::products_images::set_image_scoped(
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

// ── Command: clear image ───────────────────────────────────────────────

/// Remove the image at `slot` for `product_id`.
///
/// Only the DB assignment is removed; the file on disk is left for the GC
/// sweep (P4) since content-addressed dedup means the same file may be
/// referenced by other products.
#[tauri::command]
pub async fn products_clear_image_scoped(
    session_token: String,
    product_id: String,
    slot: i32,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::products_images::clear_image_scoped(&ctx, &session_token, &product_id, slot)
        .await
        .map_err(Into::into)
}

// ── Command: list images ───────────────────────────────────────────────

/// List the image assignments for a product (slots 1..=5), ordered by slot.
///
/// The editor flow calls this on open to show the primary + alternatives.
#[tauri::command]
pub async fn products_list_images_scoped(
    session_token: String,
    product_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<ProductImageDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::products_images::list_images_scoped(&ctx, &session_token, &product_id)
        .await
        .map_err(Into::into)
}

// ── Pipeline adapter (test-compat) ─────────────────────────────────────

/// Transcode `input_bytes` to 512 px WebP at quality 40 with adaptive fallback.
///
/// Thin adapter over `oz_bridge::products_images::transcode_to_webp`: the
/// name, parameter list and `Result<_, AppError>` type are unchanged so the
/// sibling test module keeps matching on `AppError::Invalid`.
#[allow(dead_code)] // retained by the Wave-A S8 extraction contract for sibling tests
fn transcode_to_webp(input_bytes: &[u8]) -> Result<Vec<u8>, AppError> {
    oz_bridge::products_images::transcode_to_webp(input_bytes).map_err(AppError::from)
}

/// Resolve the filesystem path for the content-addressed image file.
///
/// The tauri seam of the ingest pipeline (S8): `app_cache_dir()` can only be
/// resolved through the `Manager` trait on the live handle, so this helper
/// stays in the shell. The bridge pipeline is root-agnostic and reproduces
/// this exact layout — `<image_root>/images/{hash16}.webp` — from the
/// injected root; retained as the layout record for non-bridge callers.
#[allow(dead_code)] // retained by the Wave-A S8 extraction contract (tauri seam)
fn resolve_image_path(app_handle: &tauri::AppHandle, hash16: &str) -> Result<PathBuf, AppError> {
    let cache_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| AppError::Internal(format!("resolving app cache dir: {e}")))?;
    Ok(cache_dir.join("images").join(format!("{hash16}.webp")))
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "products_images_tests.rs"]
mod tests;
