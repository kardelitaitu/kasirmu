/*
last audited DD-MM-YY by DSH-Agent
crate: oz-media | status: SAFE | lint: CLEAN
findings: 0 unsafe blocks (earlier risk sweep counted comment text "no unsafe" — corrected); transforms guarded: decompression-bomb caps (max_pixels/max_side/max_input_bytes) enforced via header-only probe before decode, zero-size sources rejected, crop math saturating with solid-colour trim guard, single-decode pipeline (M-2). Storage backends documented PLANNED stubs returning NotImplemented. No defects found.
next: none — storage persistence still planned | perf: decode-once pipeline; N/A elsewhere
*//*
Media & image processing crate for OZ-POS.

Status: transform stages (thumbnail / compress / crop) IMPLEMENTED.
Persistence (MediaStorage backends + DB metadata) PLANNED.

Implemented:
- Thumbnail generation (maintain aspect ratio, preset sizes)
- Image compression (JPEG quality / WebP pass-through / PNG)
- Auto-crop (border trim / centre-crop / smart bias)

PLANNED:
- Image storage (local filesystem + object storage + DB metadata)
- Pipeline persistence (store + record media_assets rows)

Depends on the `image` crate (0.25) for pixel-level operations.
*/

//! Image processing utilities for OZ-POS.
//!
//! `oz-media` provides image thumbnail generation, compression, and
//! auto-crop operations for product photos, category icons, and
//! store logos, plus a pipeline orchestrator and metrics.
//!
//! # Status
//!
//! The transform functions ([`thumbnail`], [`compress`], [`crop`]) are
//! implemented. Storage backends and DB metadata persistence are
//! PLANNED stubs ([`storage`], [`MediaPipeline::process`]).

pub mod compress;
pub mod crop;
pub mod metrics;
pub mod pipeline;
pub mod storage;
pub mod thumbnail;

pub use metrics::{MEDIA_METRICS, MediaMetrics, MediaMetricsSnapshot};
pub use pipeline::{MediaLimits, MediaPipeline, MediaVariant};
pub use storage::{LocalStorage, MediaStorage, ObjectStorage, StoredMedia};

use thiserror::Error;

/// Errors that can originate in media / image processing.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum MediaError {
    /// The requested operation is not yet implemented.
    #[error("not implemented: {0}")]
    NotImplemented(String),

    /// The input image data could not be decoded.
    #[error("invalid image data: {0}")]
    InvalidImage(String),

    /// An I/O error occurred while reading or writing the image file.
    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),

    /// The image dimensions are too large/small for the requested operation.
    #[error("invalid dimensions: {0}")]
    InvalidDimensions(String),
}

/// Image dimensions in pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ImageDimensions {
    /// Width in pixels.
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
}

impl ImageDimensions {
    /// Create a new dimensions struct.
    pub fn new(width: u32, height: u32) -> Self {
        Self { width, height }
    }
}

/// Image format (mime type).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageFormat {
    /// JPEG.
    Jpeg,
    /// PNG.
    Png,
    /// WebP.
    WebP,
}

impl ImageFormat {
    /// Guess the format from the file extension.
    pub fn from_extension(ext: &str) -> Option<Self> {
        match ext.to_lowercase().as_str() {
            "jpg" | "jpeg" => Some(Self::Jpeg),
            "png" => Some(Self::Png),
            "webp" => Some(Self::WebP),
            _ => None,
        }
    }

    /// The MIME type string for this format.
    pub fn mime(&self) -> &'static str {
        match self {
            Self::Jpeg => "image/jpeg",
            Self::Png => "image/png",
            Self::WebP => "image/webp",
        }
    }
}
