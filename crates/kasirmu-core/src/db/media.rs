//! Media asset (image) CRUD — PLANNED (stubs).
/*
last audited 25-07-26 by RSA-Agent (oz-core slice B5: trivial stub file)
crate: oz-core | status: SAFE | lint: CLEAN
findings: honest fail-fast stubs + schema-mirroring struct; zero logic; no risk
next: none | perf: N/A
*/
//!
//! These methods are stubs until the media/image processing pipeline is
//! implemented. The `media_assets` and `media_thumbnails` tables are
//! created by migration `20260824_media_edc.sql` but the Rust methods
//! below are not yet functional.

use super::Store;
use crate::error::CoreError;

/// PLANNED: create a media asset record.
pub fn create_media_asset(_store: &Store<'_>) -> Result<(), CoreError> {
    Err(CoreError::Internal(
        "create_media_asset — PLANNED, not implemented yet".into(),
    ))
}

/// PLANNED: list media assets for a given owner.
pub fn list_media_assets(_store: &Store<'_>) -> Result<Vec<MediaAsset>, CoreError> {
    Err(CoreError::Internal(
        "list_media_assets — PLANNED, not implemented yet".into(),
    ))
}

/// PLANNED: delete a media asset and its thumbnails.
pub fn delete_media_asset(_store: &Store<'_>) -> Result<(), CoreError> {
    Err(CoreError::Internal(
        "delete_media_asset — PLANNED, not implemented yet".into(),
    ))
}

/// A media asset row (from `media_assets`).
#[derive(Debug, Clone)]
pub struct MediaAsset {
    /// UUID v7.
    pub id: String,
    /// Owning entity type (e.g. "product", "category").
    pub owner_type: String,
    /// Owning entity ID.
    pub owner_id: String,
    /// Relative path under the media root.
    pub file_path: String,
    /// MIME type (e.g. "image/jpeg").
    pub mime_type: String,
    /// SHA-256 content hash for dedup (nullable until indexed).
    pub content_hash: Option<String>,
    /// Pixel width, if known.
    pub width: Option<i64>,
    /// Pixel height, if known.
    pub height: Option<i64>,
    /// File size in bytes.
    pub size_bytes: i64,
    /// User-supplied file name.
    pub original_name: Option<String>,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// ISO-8601 update timestamp.
    pub updated_at: String,
}
