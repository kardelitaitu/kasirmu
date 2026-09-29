/*
last audited (date unknown) by DSH-Agent
crate: kasirmu-media | status: SAFE | lint: CLEAN
findings: 0 unsafe blocks (earlier risk sweep counted comment text "no unsafe" — corrected); transforms guarded: decompression-bomb caps (max_pixels/max_side/max_input_bytes) enforced via header-only probe before decode, zero-size sources rejected, crop math saturating with solid-colour trim guard, single-decode pipeline (M-2). Storage backends documented PLANNED stubs returning NotImplemented. No defects found. NOTE 2026-09-30: the `#![deny(unsafe_code)]` below this stamp was INERT until that date — a malformed comment merge (a closing delimiter immediately followed by an opening one, on line 6) had swallowed the attribute into a block comment, so the crate compiled with no unsafe lint at all. Restored as a real inner attribute; the `0 unsafe blocks` above is now enforced rather than asserted.
next: none — storage persistence still planned | perf: decode-once pipeline; N/A elsewhere
*/
#![deny(unsafe_code)]

//! Image processing utilities for kasir.mu.
//!
//! `kasirmu-media` provides image thumbnail generation, compression, and
//! auto-crop operations for product photos, category icons, and
//! store logos, plus a pipeline orchestrator and metrics.
//!
//! Depends on the `image` crate (0.25) for pixel-level operations.
//!
//! # Status
//!
//! The transform functions are **implemented**: thumbnail generation
//! ([`thumbnail`], aspect-ratio preserving with preset sizes), image compression
//! ([`compress`], JPEG quality / WebP pass-through / PNG) and auto-crop
//! ([`crop`], border trim / centre-crop / smart bias).
//!
//! Storage backends and DB metadata persistence are **PLANNED** stubs
//! ([`storage`], [`MediaPipeline::process`]): image storage (local filesystem,
//! object storage, DB metadata) and pipeline persistence (store + record
//! `media_assets` rows) return `NotImplemented`.
//!
//! # Wiring status: implemented, and reached by nothing
//!
//! **No crate in the workspace depends on this one.** Measured 2026-09-30
//! (C29 / decision D13): outside its own directory the only references to
//! `kasirmu-media` are its declaration in the root `Cargo.toml`, its `deny.toml`
//! licence entry, and its row in `ARCHITECTURE.md` — zero `*.rs` call sites.
//!
//! It is **kept** under D13's rule — *redundant-and-inert is deleted;
//! unwired-but-implemented is kept and labelled honestly*. It falls on the KEEP
//! side because its transforms are implemented and audited, it is the only image
//! pipeline in the tree, and product photos are a real product need whether or
//! not a plan currently schedules the storage half: deleting it would discard
//! capability rather than resolve a contradiction. This note is the "labelled
//! honestly" half of that ruling, not an oversight.

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
