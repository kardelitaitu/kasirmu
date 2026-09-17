//! Health check endpoint.
//!
//! `GET /api/v1/health` — returns the server status and version.
//! Not protected by auth; used for monitoring and readiness probes.

use axum::{Json, response::IntoResponse};
use serde::Serialize;

/// Response body for the health check endpoint.
#[derive(Serialize)]
pub struct HealthResponse {
    /// Server status string (e.g. `"ok"`).
    pub status: &'static str,
    /// Server version from `CARGO_PKG_VERSION`.
    pub version: &'static str,
}

/// `GET /api/v1/health` — return server status and version.
pub async fn health() -> impl IntoResponse {
    Json(HealthResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
    })
}

#[cfg(test)]
#[path = "health_tests.rs"]
mod tests;
