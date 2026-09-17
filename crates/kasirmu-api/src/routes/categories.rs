//! Category endpoints.
//!
//! `GET /api/v1/categories` — list all product categories.

use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};

use kasirmu_core::CoreError;
use kasirmu_core::db::Store;

use crate::AppState;

/// Convert a Store error into an HTTP response.
fn store_error_response(e: CoreError) -> Response {
    match e {
        CoreError::Validation { message, .. } => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": message})),
        )
            .into_response(),
        CoreError::Conflict { .. } => (
            StatusCode::CONFLICT,
            Json(serde_json::json!({"error": "resource already exists"})),
        )
            .into_response(),
        CoreError::NotFound { .. } => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "not found"})),
        )
            .into_response(),
        e => {
            tracing::error!("unexpected store error: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal error"})),
            )
                .into_response()
        }
    }
}

/// List all categories, ordered by name.
pub async fn list_categories(State(state): State<AppState>) -> Response {
    if let Some(pool) = &state.pg {
        return match crate::pg::list_categories(pool).await {
            Ok(categories) => Json(categories).into_response(),
            Err(e) => e.into_response(),
        };
    }
    let db = state.db.lock().await;
    let store = Store::new(&db);

    match store.list_categories() {
        Ok(categories) => Json(categories).into_response(),
        Err(e) => store_error_response(e),
    }
}

#[cfg(test)]
#[path = "categories_tests.rs"]
mod tests;
