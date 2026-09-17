/*
last audited 25-07-26 by RSA-Agent (oz-media slice A: pipeline deep read; M-1 FIXED 25-07-26)
crate: oz-media | status: SAFE | lint: CLEAN
findings: M-1 FIXED — transform() now probes image dimensions header-only (ImageReader::into_dimensions, no pixel allocation) BEFORE any decode and enforces BOTH MediaLimits.max_side and max_pixels, closing the decompression-bomb gap (previously only max_input_bytes was checked). 2 new guard tests use shrunken limits so no large allocations happen in tests (26 tests pass). M-2 FIXED — transform() now decodes the source exactly ONCE into a DynamicImage and runs crop/compress/thumbnails on in-memory frames via the new auto_crop_img/compress_img/thumbnail_img stage variants (pre-fix: crop 1x, compress 1x, dims 1x, then 2x per preset, each stage re-encoded to JPEG and re-decoded by the next). Storage stub returns NotImplemented everywhere; promotion note: enforce key sanitization (no path separators/dotdot) when LocalStorage lands
next: M-2 INFO | perf: decode once when perf matters
*/
//! Media pipeline orchestrator.
//!
//! The pipeline composes the media stages in the canonical order:
//!
//! ```text
//! ingest (decode + validate)
//!   → auto-crop (trim borders / centre-crop / smart)
//!   → thumbnail (per preset)
//!   → compress (format + quality)
//!   → store (MediaStorage trait)
//!   → DB metadata (media_assets / media_thumbnails rows)
//! ```
//!
//! **Order matters:** crop before resize before compress — never
//! compress-then-crop, which wastes quality on pixels that are discarded.
//!
//! The transform stages ([`crate::crop`], [`crate::thumbnail`],
//! [`crate::compress`]) are implemented. [`MediaPipeline::transform`]
//! composes them. [`MediaPipeline::process`] additionally persists the
//! variants through [`MediaStorage`] — still PLANNED (the storage
//! backends are stubs).

use crate::compress::Quality;
use crate::crop::CropMode;
use crate::storage::MediaStorage;
use crate::thumbnail::ThumbnailPreset;
use crate::{ImageDimensions, ImageFormat, MediaError};

/// Guardrails for image ingestion — protects against decompression bombs
/// and absurd dimensions.
#[derive(Debug, Clone, Copy)]
pub struct MediaLimits {
    /// Maximum decodable pixels (width × height). Default 40 MP.
    pub max_pixels: u64,
    /// Maximum file size in bytes before decoding. Default 20 MiB.
    pub max_input_bytes: u64,
    /// Maximum output side length in pixels. Default 8192.
    pub max_side: u32,
}

impl Default for MediaLimits {
    fn default() -> Self {
        Self {
            max_pixels: 40_000_000,
            max_input_bytes: 20 * 1024 * 1024,
            max_side: 8192,
        }
    }
}

/// A single output variant produced by the pipeline.
#[derive(Debug, Clone)]
pub struct MediaVariant {
    /// Storage key (e.g. `products/abc/photo_thumb.jpg`).
    pub key: String,
    /// Image format.
    pub format: ImageFormat,
    /// Resulting dimensions.
    pub dimensions: ImageDimensions,
}

/// Orchestrates ingest → crop → thumbnail → compress → store.
///
/// **PLANNED:** [`Self::process`] returns [`MediaError::NotImplemented`]
/// until the stages are implemented. The API is fixed now so callers and
/// the DB layer can be written against it.
pub struct MediaPipeline<S: MediaStorage> {
    storage: S,
    limits: MediaLimits,
}

impl<S: MediaStorage> MediaPipeline<S> {
    /// Create a pipeline over `storage` with the default limits.
    pub fn new(storage: S) -> Self {
        Self {
            storage,
            limits: MediaLimits::default(),
        }
    }

    /// Create a pipeline with custom ingestion limits.
    pub fn with_limits(storage: S, limits: MediaLimits) -> Self {
        Self { storage, limits }
    }

    /// Access the storage backend.
    pub fn storage(&self) -> &S {
        &self.storage
    }

    /// The configured ingestion limits.
    pub fn limits(&self) -> &MediaLimits {
        &self.limits
    }

    /// Run the full transform pipeline on `input_bytes` without
    /// persisting: crop → thumbnail (per preset) → compress.
    ///
    /// Returns the processed variants (original + one per preset). The
    /// caller decides where to store the bytes.
    ///
    /// # Errors
    ///
    /// [`MediaError::InvalidDimensions`] if the input exceeds the ingest
    /// guardrails, or any stage error ([`MediaError::InvalidImage`]).
    pub fn transform(
        &self,
        file_name: &str,
        input_bytes: &[u8],
        crop_mode: CropMode,
        target_format: ImageFormat,
        quality: Quality,
        presets: &[ThumbnailPreset],
    ) -> Result<Vec<MediaVariant>, MediaError> {
        if input_bytes.len() as u64 > self.limits.max_input_bytes {
            return Err(MediaError::InvalidDimensions(format!(
                "input exceeds {} bytes",
                self.limits.max_input_bytes
            )));
        }

        // M-1 fix: enforce the decompression-bomb dimension caps BEFORE any
        // full decode. `max_input_bytes` alone left dimension bombs to the
        // image crate's default allocation cap; this header-only probe
        // (`ImageReader::into_dimensions` reads no pixel data) rejects
        // oversized frames without allocating the pixel buffer.
        {
            let cursor = std::io::Cursor::new(input_bytes);
            let (width, height) = image::ImageReader::new(cursor)
                .with_guessed_format()
                .map_err(|e| MediaError::InvalidImage(format!("reading format: {e}")))?
                .into_dimensions()
                .map_err(|e| MediaError::InvalidImage(format!("reading dimensions: {e}")))?;
            if width > self.limits.max_side || height > self.limits.max_side {
                return Err(MediaError::InvalidDimensions(format!(
                    "image dimensions {width}x{height} exceed max_side {}",
                    self.limits.max_side
                )));
            }
            let pixels = width as u64 * height as u64;
            if pixels > self.limits.max_pixels {
                return Err(MediaError::InvalidDimensions(format!(
                    "image has {pixels} pixels, exceeding max_pixels {}",
                    self.limits.max_pixels
                )));
            }
        }

        // M-2 fix: decode the source exactly ONCE into a `DynamicImage`
        // and run every stage on in-memory frames — the pre-fix flow
        // re-encoded each stage to JPEG and re-decoded it in the next
        // (crop 1×, compress 1×, dims 1×, then 2× per preset), wasting
        // CPU and quantising the frame through repeated JPEG cycles.
        // The M-1 header-only probe above still runs first, so the full
        // decode only happens on frames that already passed the
        // decompression-bomb guardrails.
        let img = image::load_from_memory(input_bytes)
            .map_err(|e| MediaError::InvalidImage(format!("decode: {e}")))?;

        // 1. Crop (normalise the frame first — cheap when no crop needed).
        let cropped = crate::crop::auto_crop_img(img, crop_mode, None)?;
        let dims = ImageDimensions::new(cropped.width(), cropped.height());

        // 2. Original variant at the target format/quality.
        // PLANNED: the compressed bytes will be persisted with the variant
        // once the storage backends land; for now the encode itself is
        // exercised so encode errors surface here.
        let _original_bytes = crate::compress::compress_img(&cropped, target_format, quality)?;

        let mut variants = Vec::with_capacity(presets.len() + 1);
        variants.push(MediaVariant {
            key: file_name.to_owned(),
            format: target_format,
            dimensions: dims,
        });

        // 3. One thumbnail per preset.
        for preset in presets {
            let (thumb_img, thumb_dims) =
                crate::thumbnail::thumbnail_img(&cropped, preset.max_dimensions())?;
            // PLANNED: persist the compressed thumbnail bytes with the
            // variant once storage lands.
            let _thumb_bytes = crate::compress::compress_img(&thumb_img, target_format, quality)?;
            let suffix = preset_suffix(*preset);
            variants.push(MediaVariant {
                key: format!("{file_name}{suffix}"),
                format: target_format,
                dimensions: thumb_dims,
            });
        }

        Ok(variants)
    }

    /// Run the full pipeline on `input_bytes` and persist the variants
    /// through the storage backend.
    ///
    /// # STUB
    ///
    /// The transforms are real ([`Self::transform`]) and are applied;
    /// persistence is PLANNED — the storage backends are stubs, and the
    /// variant model does not yet carry the transformed bytes. Returns
    /// the same variants as [`Self::transform`].
    #[allow(clippy::too_many_arguments)]
    pub async fn process(
        &self,
        owner_key: &str,
        file_name: &str,
        input_bytes: &[u8],
        crop_mode: CropMode,
        target_format: ImageFormat,
        quality: Quality,
        presets: &[ThumbnailPreset],
    ) -> Result<Vec<MediaVariant>, MediaError> {
        let _ = owner_key;
        let _ = self.storage();
        self.transform(
            file_name,
            input_bytes,
            crop_mode,
            target_format,
            quality,
            presets,
        )
    }
}

/// Map a preset to its file-name suffix.
fn preset_suffix(preset: ThumbnailPreset) -> &'static str {
    match preset {
        ThumbnailPreset::Icon => "_icon",
        ThumbnailPreset::Small => "_small",
        ThumbnailPreset::Medium => "_medium",
        ThumbnailPreset::Large => "_large",
    }
}

/// Compute the SHA-256 content hash of `bytes` — used for dedup.
///
/// Functional today (no stub): hashing is pure and dependency-light, and
/// dedup logic can be written and tested against it immediately.
pub fn content_hash(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(64);
    for b in digest {
        use std::fmt::Write;
        let _ = write!(hex, "{b:02x}");
    }
    hex
}

#[cfg(test)]
#[path = "pipeline_tests.rs"]
mod tests;
