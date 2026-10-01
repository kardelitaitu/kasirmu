/*
last audited 31-08-26 by RSA-Agent (user-role campaign, Section E)
crate: modules-staff | status: SAFE | lint: CLEAN
findings: clean thiserror taxonomy (Db/Platform/NotFound/Validation), no sensitive data in error payloads (ids + static entity names only)
next: none | perf: N/A
*/

//! Error type for the staff domain.

use kasirmu_core::db::namespaced::NamespaceError;
use thiserror::Error;

/// Errors that can originate in the staff/user domain.
#[derive(Debug, Error)]
pub enum StaffError {
    /// A database operation failed.
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),

    /// A namespace check rejected the statement (Phase 3 P3.2).
    #[error("namespace error: {0}")]
    Namespace(#[from] NamespaceError),

    /// A platform infrastructure error.
    #[error("platform error: {0}")]
    Platform(#[from] platform_core::PlatformError),

    /// A lookup by id returned no row.
    #[error("not found: {entity} {id}")]
    NotFound {
        /// The kind of entity that was being looked up.
        entity: &'static str,
        /// The id that was looked up.
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

impl StaffError {
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
