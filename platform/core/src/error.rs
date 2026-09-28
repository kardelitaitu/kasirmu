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
/// Errors that can originate in the currency/exchange-rate domain.
///
/// Lives here rather than in the currency module so `kasirmu-core` can name it
/// without depending on a business module (ADR-61 / C26). It carries a
/// `rusqlite::Error`, which is why the other candidate home -- `foundation`, the
/// dependency-light contracts crate -- could not take it: this crate already
/// depends on rusqlite, and so do both of its consumers.
#[derive(Debug, Error)]
pub enum CurrencyError {
    /// A database operation failed.
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),

    /// A platform infrastructure error.
    #[error("platform error: {0}")]
    Platform(#[from] PlatformError),

    /// Input validation failure.
    #[error("validation error on {field}: {message}")]
    Validation {
        /// The field that failed validation.
        field: &'static str,
        /// Human-readable description of the failure.
        message: String,
    },

    /// A lookup by id returned no row.
    #[error("not found: {entity} {id}")]
    NotFound {
        /// The kind of entity that was being looked up.
        entity: &'static str,
        /// The id that was looked up.
        id: String,
    },
}

impl CurrencyError {
    /// Create a validation error for a specific field.
    pub fn validation(field: &'static str, message: impl Into<String>) -> Self {
        Self::Validation {
            field,
            message: message.into(),
        }
    }
}

#[cfg(test)]
#[path = "error_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "currency_error_tests.rs"]
mod currency_tests;
