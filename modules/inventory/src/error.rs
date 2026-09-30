/*
last audited 25-07-26 by RSA-Agent (modules-inventory slice A: error verified)
crate: modules-inventory | status: SAFE | lint: CLEAN
findings: clean thiserror inventory error taxonomy
next: none | perf: N/A
*/
//! Error type for the inventory domain.

use kasirmu_core::db::namespaced::NamespaceError;
use thiserror::Error;

/// Errors that can originate in the inventory domain.
#[derive(Debug, Error)]
pub enum InventoryError {
    /// A database operation failed.
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),

    /// A namespace check rejected the statement (Phase 3 P3.2).
    #[error("namespace error: {0}")]
    Namespace(#[from] NamespaceError),

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

impl InventoryError {
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
