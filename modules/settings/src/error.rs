/*
last audited 25-07-26 by RSA-Agent (modules-settings slice A: error verified)
crate: modules-settings | status: SAFE | lint: CLEAN
findings: clean thiserror settings error taxonomy
next: none | perf: N/A
*/
//! Error type for the settings domain.

use thiserror::Error;

/// Errors that can originate in the settings domain.
#[derive(Debug, Error)]
pub enum SettingsError {
    /// A database operation failed.
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),

    /// A lookup by key returned no row.
    #[error("not found: {entity} {id}")]
    NotFound {
        /// The kind of entity that was being looked up.
        entity: &'static str,
        /// The key that was looked up.
        id: String,
    },

    /// Input validation failure.
    #[error("validation error on {field}: {message}")]
    Validation {
        /// The field that failed validation.
        field: &'static str,
        /// Human-readable description of the failure.
        message: String,
    },
}

impl SettingsError {
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
