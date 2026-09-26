/*
last audited 25-07-26 by RSA-Agent (platform-core slice E: error+lib verified)
crate: platform-core | status: SAFE | lint: CLEAN
findings: clean thiserror platform error taxonomy; lib re-exports only
next: none | perf: N/A
*/
//! Error type for `platform-core`.
//!
//! Uses `thiserror` so consumers can match on variants.
//! The enum is `#[non_exhaustive]` to allow adding variants
//! without breaking semver.

use thiserror::Error;

/// Errors that can originate in `platform-core` infrastructure.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum PlatformError {
    /// A database operation failed.
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),

    /// A setting key was not found.
    #[error("not found: {0}")]
    NotFound(String),

    /// An internal error (serialization, crypto, I/O, etc.).
    #[error("internal error: {0}")]
    Internal(String),
}

#[cfg(test)]
#[path = "error_tests.rs"]
mod tests;
