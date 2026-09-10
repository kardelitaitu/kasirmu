//! Product-image ingest command bodies (Wave A / S8) — the tauri-free half
//! of `apps/desktop-client/src/commands/products_images.rs`.
//!
//! [`set_image_scoped`] is the full ingest pipeline: read the source file,
//! sniff magic bytes, validate size/dimension caps, decode, resize to 512 px
//! longest edge, encode as lossy WebP (adaptive q40 → q30 → q24 when over
//! the size cap), compute the SHA-256 content hash, atomically write
//! `{hash16}.webp` under the INJECTED media root, and assign the hash to the
//! product slot via `Store::set_product_image`. [`clear_image_scoped`] and
//! [`list_images_scoped`] are the plain store writes/reads; the pure
//! pipeline helpers ([`sniff_format`], [`transcode_to_webp`],
//! [`sha256_hex16`]) are `pub` so the desktop shell's sibling test module
//! keeps its coverage.
//!
//! The filesystem root is injected, never resolved here: the shim passes the
//! app cache dir (`BridgeCtx::media_cache_dir`) as `image_root` and this
//! module appends `images/{hash16}.webp` — the exact layout the desktop
//! `resolve_image_path` seam produces. Gate order, store construction
//! (`Store::new`, cache-free — as the shell used) and every error message
//! are verbatim ports of the command body; the shim maps [`BridgeError`]
//! back to `AppError` variant-for-variant so the wire shape never moves.

use std::path::Path;

use serde::Serialize;
use sha2::{Digest, Sha256};

use oz_core::db::Store;
use oz_core::permissions;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

// ── Constants ──────────────────────────────────────────────────────────

/// Maximum raw input file size (5 MB).
const MAX_INPUT_BYTES: u64 = 5 * 1024 * 1024;

/// Maximum decoded pixel dimensions (4096²).
pub const MAX_DIMENSION: u32 = 4096;

/// Target longest edge after resize.
const TARGET_DIMENSION: u32 = 512;

/// Quality tiers for adaptive WebP encoding.
const QUALITY_PRIMARY: f32 = 40.0;
const QUALITY_FALLBACK: f32 = 30.0;
const QUALITY_FLOOR: f32 = 24.0;

/// Size thresholds for adaptive quality (hard reject at 48 KB).
pub const SIZE_HARD_REJECT: usize = 48 * 1024;

/// First 64 bits of the SHA-256 digest → 16 hex chars (≈1e-9 collision
/// probability at 300k images).
const HASH16_CHARS: usize = 16;

/// A product image assignment returned to the front-end.
#[derive(Debug, Serialize)]
pub struct ProductImageDto {
    /// Slot 1 = primary; slots 2..5 = alternatives.
    pub slot: i32,
    /// Content-addressed hash (first 16 hex chars of sha-256).
    pub hash: String,
    /// Display order of alternatives (0-based).
    pub position: i32,
}

// ── Command body: set image ────────────────────────────────────────────

/// Assign the image at `source_path` to `product_id` at `slot` (1..=5).
///
/// `image_root` is the INJECTED media root (the shell's resolved app cache
/// dir); the transcoded file lands at `image_root/images/{hash16}.webp`.
///
/// Gate order mirrors the command body: resolve the session, enforce
/// `products:update` scope-aware against the global identity DB, then
/// validate, transcode, write and assign. Returns the 16-hex-char content
/// hash of the transcoded image.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown/expired token,
/// [`BridgeError::PermissionDenied`] without `products:update`,
/// [`BridgeError::Invalid`] for bad slots/paths/formats/oversized input,
/// and [`BridgeError::Internal`] for filesystem or store failures.
pub async fn set_image_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    product_id: &str,
    slot: i32,
    source_path: &str,
    image_root: &Path,
) -> Result<String, BridgeError> {
    // Resolve session + permission
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::PRODUCTS_UPDATE)
        .await?;

    // Validate slot
    if !(1..=5).contains(&slot) {
        return Err(BridgeError::Invalid(format!(
            "slot must be between 1 and 5, got {slot}"
        )));
    }
    if source_path.is_empty() {
        return Err(BridgeError::Invalid("source_path must not be empty".into()));
    }

    // Read the source file
    let raw_bytes = tokio::fs::read(source_path)
        .await
        .map_err(|e| BridgeError::Invalid(format!("reading source file: {e}")))?;

    if raw_bytes.len() as u64 > MAX_INPUT_BYTES {
        return Err(BridgeError::Invalid(format!(
            "input exceeds {} bytes (got {})",
            MAX_INPUT_BYTES,
            raw_bytes.len()
        )));
    }

    // --- Sniff magic bytes (extension is ignored) ---
    let _input_format = sniff_format(&raw_bytes)
        .map_err(|e| BridgeError::Invalid(format!("unsupported or corrupt image format: {e}")))?;

    // --- Transcode & resize ---
    let webp_bytes = transcode_to_webp(&raw_bytes)?;

    // --- Hash ---
    let hash16 = sha256_hex16(&webp_bytes);

    // --- Atomic write to the injected media root ---
    let store_path = image_root.join("images").join(format!("{hash16}.webp"));
    let parent_dir = store_path
        .parent()
        .ok_or_else(|| BridgeError::Internal("image store path has no parent".into()))?;

    tokio::fs::create_dir_all(parent_dir)
        .await
        .map_err(|e| BridgeError::Internal(format!("creating image store dir: {e}")))?;

    // Only write if the file doesn't exist (dedupe hit).
    if !tokio::fs::try_exists(&store_path).await.unwrap_or(false) {
        // Write to a temp path first, then atomically rename
        let temp_path = parent_dir.join(format!(".{}.tmp", hash16));
        {
            let mut tmp = tokio::fs::File::create(&temp_path)
                .await
                .map_err(|e| BridgeError::Internal(format!("creating temp file: {e}")))?;
            tokio::io::AsyncWriteExt::write_all(&mut tmp, &webp_bytes)
                .await
                .map_err(|e| BridgeError::Internal(format!("writing temp file: {e}")))?;
        }
        tokio::fs::rename(&temp_path, &store_path)
            .await
            .map_err(|e| BridgeError::Internal(format!("renaming image file: {e}")))?;
    }

    // --- DB assignment ---
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    store.set_product_image(product_id, slot, &hash16)?;

    // Enqueue for the cloud push scheduler (spec 0046b §3.6). The bytes are
    // already transcoded + content-hashed; only the pending-upload bookkeeping
    // happens here — the network leg never blocks the editor.
    store.enqueue_image_push(&hash16, webp_bytes.len() as i64)?;

    tracing::info!(product_id, slot, hash = %hash16, "product image set");
    Ok(hash16)
}

// ── Command body: clear image ──────────────────────────────────────────

/// Remove the image at `slot` for `product_id`.
///
/// Only the DB assignment is removed; the file on disk is left for the GC
/// sweep (P4) since content-addressed dedup means the same file may be
/// referenced by other products.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`],
/// [`BridgeError::PermissionDenied`] without `products:update`, and
/// [`BridgeError::Core`]/[`BridgeError::Internal`] on store failures.
pub async fn clear_image_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    product_id: &str,
    slot: i32,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::PRODUCTS_UPDATE)
        .await?;

    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    store.clear_product_image(product_id, slot)?;

    tracing::info!(product_id, slot, "product image cleared");
    Ok(())
}

// ── Command body: list images ──────────────────────────────────────────

/// List the image assignments for a product (slots 1..=5), ordered by slot.
///
/// The editor flow calls this on open to show the primary + alternatives.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`],
/// [`BridgeError::PermissionDenied`] without `products:read`, and
/// [`BridgeError::Core`]/[`BridgeError::Internal`] on store failures.
pub async fn list_images_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    product_id: &str,
) -> Result<Vec<ProductImageDto>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::PRODUCTS_READ)
        .await?;

    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let images = store.list_product_images(product_id)?;
    Ok(images
        .into_iter()
        .map(|img| ProductImageDto {
            slot: img.slot,
            hash: img.hash,
            position: img.position,
        })
        .collect())
}

// ── Image pipeline helpers ─────────────────────────────────────────────

/// Detect the image format from magic bytes. Returns the format name on
/// success; rejects everything that is not WebP, JPEG, or PNG.
///
/// # Errors
///
/// Returns the rejection reason when the header is too short or the magic
/// bytes name a format that is not accepted.
pub fn sniff_format(bytes: &[u8]) -> Result<&'static str, &'static str> {
    if bytes.len() < 12 {
        return Err("file too small to contain a valid image header");
    }
    // WebP: RIFF header + WEBP magic
    if bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return Ok("webp");
    }
    // JPEG: starts with FFD8FF
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Ok("jpeg");
    }
    // PNG: starts with 89504E47
    if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        return Ok("png");
    }
    Err("unsupported format: only WebP, JPEG, and PNG are accepted \
         (HEIC, AVIF, BMP, GIF, TIFF and others are rejected)")
}

/// Transcode `input_bytes` to 512 px WebP at quality 40 with adaptive fallback.
///
/// Pipeline: decode → resize to 512 px longest edge → encode as lossy
/// WebP q40 (adaptive q40→q30→q24). Hard-rejects if the result exceeds
/// 48 KB. EXIF orientation handling is intentionally deferred to P4
/// (the vast majority of POS product images are already correctly
/// oriented by the source device).
///
/// # Errors
///
/// Returns [`BridgeError::Invalid`] for decompression-bomb dimensions,
/// undecodable bytes, encoder failures, or output still over the size cap
/// at the floor quality.
pub fn transcode_to_webp(input_bytes: &[u8]) -> Result<Vec<u8>, BridgeError> {
    // Decompression-bomb dimension check before full decode
    let (width, height) = {
        let reader = image::ImageReader::new(std::io::Cursor::new(input_bytes))
            .with_guessed_format()
            .map_err(|e| BridgeError::Invalid(format!("reading image format: {e}")))?;
        reader
            .into_dimensions()
            .map_err(|e| BridgeError::Invalid(format!("reading image dimensions: {e}")))?
    };

    if width > MAX_DIMENSION || height > MAX_DIMENSION {
        return Err(BridgeError::Invalid(format!(
            "image dimensions {width}×{height} exceed max {MAX_DIMENSION}"
        )));
    }

    let pixels = width as u64 * height as u64;
    if pixels > (MAX_DIMENSION as u64 * MAX_DIMENSION as u64) {
        return Err(BridgeError::Invalid(format!(
            "image has {pixels} pixels, exceeding MAX_DIMENSION²"
        )));
    }

    // Decode
    let img = image::load_from_memory(input_bytes)
        .map_err(|e| BridgeError::Invalid(format!("decoding image: {e}")))?;

    // Resize to 512 px longest edge, preserving aspect ratio
    let (w, h) = (img.width(), img.height());
    let (new_w, new_h) = if w > h {
        (
            TARGET_DIMENSION,
            (h as u64 * TARGET_DIMENSION as u64 / w as u64).max(1) as u32,
        )
    } else {
        (
            (w as u64 * TARGET_DIMENSION as u64 / h as u64).max(1) as u32,
            TARGET_DIMENSION,
        )
    };
    let img = img.resize_exact(new_w, new_h, image::imageops::FilterType::Triangle);

    // Adaptive quality encoding via libwebp
    let qualities = [QUALITY_PRIMARY, QUALITY_FALLBACK, QUALITY_FLOOR];
    for &quality in &qualities {
        let encoder = webp::Encoder::from_image(&img)
            .map_err(|e| BridgeError::Invalid(format!("creating webp encoder: {e}")))?;
        let encoded = encoder.encode(quality);
        let bytes = encoded.to_vec();

        if bytes.len() <= SIZE_HARD_REJECT {
            return Ok(bytes);
        }
    }

    Err(BridgeError::Invalid(format!(
        "image exceeds {SIZE_HARD_REJECT} bytes even at quality {QUALITY_FLOOR} — \
         try a smaller or simpler image"
    )))
}

/// Compute the first 16 hex characters of the SHA-256 digest.
#[must_use]
pub fn sha256_hex16(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    hex::encode(&digest[..HASH16_CHARS / 2]) // 8 bytes → 16 hex chars
}
