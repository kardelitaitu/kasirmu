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
mod tests {
    use super::*;

    #[test]
    fn not_found_error_display() {
        let err = NotFoundError {
            entity: "product",
            id: "SKU-999".into(),
        };
        assert_eq!(err.to_string(), "product not found: SKU-999");
    }

    #[test]
    fn not_found_error_debug() {
        let err = NotFoundError {
            entity: "product",
            id: "SKU-999".into(),
        };
        assert!(!format!("{err:?}").is_empty());
    }

    #[test]
    fn conflict_error_display() {
        let err = ConflictError {
            entity: "product",
            field: "sku",
        };
        assert_eq!(err.to_string(), "product conflict on sku");
    }

    #[test]
    fn conflict_error_debug() {
        let err = ConflictError {
            entity: "category",
            field: "name",
        };
        assert!(!format!("{err:?}").is_empty());
    }

    #[test]
    fn validation_error_display() {
        let err = ValidationError {
            field: "price",
            message: "must be positive".into(),
        };
        assert_eq!(
            err.to_string(),
            "validation failed on price: must be positive"
        );
    }

    #[test]
    fn validation_error_debug() {
        let err = ValidationError {
            field: "email",
            message: "invalid format".into(),
        };
        assert!(!format!("{err:?}").is_empty());
    }

    #[test]
    fn not_found_error_fields() {
        let err = NotFoundError {
            entity: "user",
            id: "user-42".into(),
        };
        assert_eq!(err.entity, "user");
        assert_eq!(err.id, "user-42");
    }

    #[test]
    fn conflict_error_fields() {
        let err = ConflictError {
            entity: "role",
            field: "id",
        };
        assert_eq!(err.entity, "role");
        assert_eq!(err.field, "id");
    }

    #[test]
    fn validation_error_fields() {
        let err = ValidationError {
            field: "name",
            message: "too short".into(),
        };
        assert_eq!(err.field, "name");
        assert_eq!(err.message, "too short");
    }

    #[test]
    fn not_found_error_implements_std_error() {
        let err = NotFoundError {
            entity: "x",
            id: "y".into(),
        };
        let _: &dyn std::error::Error = &err;
    }

    #[test]
    fn conflict_error_implements_std_error() {
        let err = ConflictError {
            entity: "x",
            field: "y",
        };
        let _: &dyn std::error::Error = &err;
    }

    #[test]
    fn validation_error_implements_std_error() {
        let err = ValidationError {
            field: "x",
            message: "y".into(),
        };
        let _: &dyn std::error::Error = &err;
    }
}
