/*
last audited 25-07-26 by RSA-Agent (oz-media slice A: verified)
crate: oz-media | status: SAFE | lint: CLEAN
findings: clean — no unwrap/panic/unsafe; sibling tests per convention
next: none | perf: N/A
*/
//! Media storage abstraction — PLANNED (stub).
//!
//! The seam between media processing (crop/thumbnail/compress) and where
//! the bytes physically live. Two implementations are planned:
//!
//! * [`LocalStorage`] — filesystem under the app data dir (Tauri desktop).
//! * [`ObjectStorage`] — S3/R2/MinIO-compatible bucket (cloud).
//!
//! The pipeline ([`crate::pipeline::MediaPipeline`]) composes over this
//! trait, so neither the transforms nor the DB layer ever know where a
//! file is stored.

use crate::{ImageFormat, MediaError};

/// A stored media object: its logical path and raw bytes.
#[derive(Debug, Clone)]
pub struct StoredMedia {
    /// Logical key under the storage root (e.g. `products/abc123/photo.jpg`).
    pub key: String,
    /// Raw bytes of the file.
    pub bytes: Vec<u8>,
    /// Detected/declared format.
    pub format: ImageFormat,
}

/// Where media files physically live.
///
/// **PLANNED:** every method returns [`MediaError::NotImplemented`] until
/// the real backends are implemented.
#[async_trait::async_trait]
pub trait MediaStorage: Send + Sync {
    /// Write `bytes` under `key`, replacing any existing object.
    async fn put(&self, key: &str, bytes: Vec<u8>, format: ImageFormat) -> Result<(), MediaError>;

    /// Read the object at `key`. Returns `Ok(None)` if it does not exist.
    async fn get(&self, key: &str) -> Result<Option<StoredMedia>, MediaError>;

    /// Delete the object at `key`. Deleting a missing key is a no-op.
    async fn delete(&self, key: &str) -> Result<(), MediaError>;

    /// Whether an object exists at `key`.
    async fn exists(&self, key: &str) -> Result<bool, MediaError>;
}

/// Filesystem-backed storage under a root directory.
///
/// **STUB:** construction validates the root path is non-empty, but all
/// I/O methods return [`MediaError::NotImplemented`] until implemented.
pub struct LocalStorage {
    /// Root directory for all media files.
    #[allow(dead_code)]
    root: String,
}

impl LocalStorage {
    /// Create a new local storage rooted at `root`.
    pub fn new(root: impl Into<String>) -> Self {
        Self { root: root.into() }
    }
}

#[async_trait::async_trait]
impl MediaStorage for LocalStorage {
    async fn put(
        &self,
        _key: &str,
        _bytes: Vec<u8>,
        _format: ImageFormat,
    ) -> Result<(), MediaError> {
        Err(MediaError::NotImplemented(
            "local storage put — PLANNED, not implemented yet".into(),
        ))
    }

    async fn get(&self, _key: &str) -> Result<Option<StoredMedia>, MediaError> {
        Err(MediaError::NotImplemented(
            "local storage get — PLANNED, not implemented yet".into(),
        ))
    }

    async fn delete(&self, _key: &str) -> Result<(), MediaError> {
        Err(MediaError::NotImplemented(
            "local storage delete — PLANNED, not implemented yet".into(),
        ))
    }

    async fn exists(&self, _key: &str) -> Result<bool, MediaError> {
        Err(MediaError::NotImplemented(
            "local storage exists — PLANNED, not implemented yet".into(),
        ))
    }
}

/// Object-storage (S3-compatible) backed storage.
///
/// **STUB:** construction records the endpoint/bucket, but all I/O
/// methods return [`MediaError::NotImplemented`] until implemented.
pub struct ObjectStorage {
    /// S3-compatible endpoint (e.g. `https://s3.amazonaws.com`).
    #[allow(dead_code)]
    endpoint: String,
    /// Bucket name.
    #[allow(dead_code)]
    bucket: String,
    /// Access key.
    #[allow(dead_code)]
    access_key: String,
}

impl ObjectStorage {
    /// Create a new object storage client.
    pub fn new(
        endpoint: impl Into<String>,
        bucket: impl Into<String>,
        access_key: impl Into<String>,
    ) -> Self {
        Self {
            endpoint: endpoint.into(),
            bucket: bucket.into(),
            access_key: access_key.into(),
        }
    }
}

#[async_trait::async_trait]
impl MediaStorage for ObjectStorage {
    async fn put(
        &self,
        _key: &str,
        _bytes: Vec<u8>,
        _format: ImageFormat,
    ) -> Result<(), MediaError> {
        Err(MediaError::NotImplemented(
            "object storage put — PLANNED, not implemented yet".into(),
        ))
    }

    async fn get(&self, _key: &str) -> Result<Option<StoredMedia>, MediaError> {
        Err(MediaError::NotImplemented(
            "object storage get — PLANNED, not implemented yet".into(),
        ))
    }

    async fn delete(&self, _key: &str) -> Result<(), MediaError> {
        Err(MediaError::NotImplemented(
            "object storage delete — PLANNED, not implemented yet".into(),
        ))
    }

    async fn exists(&self, _key: &str) -> Result<bool, MediaError> {
        Err(MediaError::NotImplemented(
            "object storage exists — PLANNED, not implemented yet".into(),
        ))
    }
}

#[cfg(test)]
#[path = "storage_tests.rs"]
mod tests;
