//! Shared error types used across the kasir.mu framework.

use thiserror::Error;

/// A generic not-found error for any entity type.
#[derive(Debug, Error)]
#[error("{entity} not found: {id}")]
pub struct NotFoundError {
    /// The entity type name (e.g. `"product"`, `"user"`).
    pub entity: &'static str,
    /// The entity identifier that was not found.
    pub id: String,
}

/// A generic conflict error (e.g. duplicate key).
#[derive(Debug, Error)]
#[error("{entity} conflict on {field}")]
pub struct ConflictError {
    /// The entity type name.
    pub entity: &'static str,
    /// The field that caused the conflict.
    pub field: &'static str,
}

/// A generic validation error.
#[derive(Debug, Error)]
#[error("validation failed on {field}: {message}")]
pub struct ValidationError {
    /// The field that failed validation.
    pub field: &'static str,
    /// A human-readable validation message.
    pub message: String,
}

#[cfg(test)]
#[path = "errors_tests.rs"]
mod tests;
