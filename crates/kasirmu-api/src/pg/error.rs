//! The Postgres REST data layer's error type.
//!
//! Every `pg` function returns this, and the route handlers match on it to
//! choose an HTTP status (`Conflict` → 409, `NotFound` → 404, `Validation` →
//! 400, `Db` → 500). It is module-wide rather than a settings concept, which
//! is why it lives here rather than inside any one domain submodule:
//! [`super::helpers`] and all five domain modules name it.

use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};

/// Error from the Postgres REST data layer, mapped to HTTP statuses the same
/// way the SQLite `Store` errors were.
#[derive(Debug)]
pub enum PgError {
    /// Unique-constraint violation → 409.
    Conflict,
    /// Missing row → 404.
    NotFound,
    /// Input validation failed → 400.
    Validation(String),
    /// Backend / connection failure → 500.
    Db(String),
}

impl std::fmt::Display for PgError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PgError::Conflict => write!(f, "resource already exists"),
            PgError::NotFound => write!(f, "not found"),
            PgError::Validation(m) => write!(f, "{m}"),
            PgError::Db(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for PgError {}

impl PgError {
    /// Convert into an axum [`Response`] with the matching status code.
    pub fn into_response(self) -> Response {
        match self {
            PgError::Conflict => (
                StatusCode::CONFLICT,
                Json(serde_json::json!({"error": "resource already exists"})),
            )
                .into_response(),
            PgError::NotFound => (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "not found"})),
            )
                .into_response(),
            PgError::Validation(message) => (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": message})),
            )
                .into_response(),
            PgError::Db(e) => {
                tracing::error!("postgres REST data layer error: {e}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": "internal error"})),
                )
                    .into_response()
            }
        }
    }
}
