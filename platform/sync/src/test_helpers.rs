//! Shared test helpers for the sync crate.
//!
//! These helpers are re-exported from the crate root under `#[cfg(test)]`
//! so every test module can use them without duplication.
//!
//! ## Why [`scratch_dir`] exists
//!
//! `std::env::temp_dir()` resolves `TEMP`/`TMP`, and on this project's Windows
//! machines the MACHINE-level value is `C:\WINDOWS\TEMP` — a directory an ordinary
//! user may create inside but cannot delete from. A fixture there can never be
//! cleaned up, and once a stale entry exists the create itself fails with
//! `PermissionDenied`, which reads as a broken test rather than as a hostile
//! environment. Measured 2026-10-21: three `image_push` tests failed that way.
//!
//! `target/` is already gitignored (`.gitignore:2`), so nothing created here can be
//! committed, and the per-call UUID keeps parallel tests apart. The workspace root is
//! found by walking up from `CARGO_MANIFEST_DIR` rather than from the process CWD,
//! because tests run from the crate directory while `target/` lives at the root.

use std::path::PathBuf;

/// A fresh, uniquely-named scratch directory under the gitignored `target/` tree.
///
/// Use this instead of `std::env::temp_dir()` or `tempfile::tempdir()` for any
/// fixture that needs a real path on disk. See the module docs for why.
///
/// # Panics
///
/// Panics if the directory cannot be created: a test that cannot obtain its scratch
/// space has nothing further it can usefully do.
pub fn scratch_dir(prefix: &str) -> PathBuf {
    // Delegates to the shared helper rather than carrying a fifth copy of the
    // workspace-root walk-up. The copy that used to live here drifted from the
    // others (no ScratchDir guard available, its own ancestor search) and was
    // one of four places the same "find target/ above CARGO_MANIFEST_DIR" logic
    // was written out by hand. kasirmu_test_support is the one definition;
    // see its module docs for the Windows TEMP trap these all exist to avoid.
    kasirmu_test_support::scratch_dir(prefix)
}

/// Spawn a mock server that returns HTTP 421 + `server_migrated` JSON on
/// the push, pull, and snapshot endpoints (ADR #11).
///
/// Returns the server's URL (e.g. `http://localhost:12345`).
pub async fn spawn_redirect_server(new_url: &str) -> String {
    use axum::{
        Json, Router,
        http::StatusCode,
        response::IntoResponse,
        routing::{get, post},
    };

    let listener = tokio::net::TcpListener::bind("localhost:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let redirect_url = new_url.to_owned();

    async fn handler(axum::extract::State(url): axum::extract::State<String>) -> impl IntoResponse {
        (
            StatusCode::MISDIRECTED_REQUEST,
            Json(serde_json::json!({
                "error": "server_migrated",
                "new_url": url,
            })),
        )
    }

    async fn health_handler() -> impl IntoResponse {
        (StatusCode::OK, Json(serde_json::json!({"status": "ok"})))
    }

    let app = Router::new()
        .route("/api/health", get(health_handler))
        .route("/api/sync/push", post(handler))
        .route("/api/sync/pull", post(handler))
        .route("/api/sync/snapshot", get(handler))
        .with_state(redirect_url);

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    format!("http://localhost:{port}")
}

/// Spawn a mock server that returns HTTP 410 Gone on the pull endpoint
/// (to trigger `AnchorExpired`) and HTTP 421 on the snapshot endpoint
/// (to trigger `ServerMigrated`). The push endpoint also returns 421.
///
/// Used to test that `run_sync_cycle` propagates `ServerMigrated`
/// through the snapshot recovery path (ADR #11).
///
/// Returns the server's URL.
pub async fn spawn_anchor_then_redirect_server(new_url: &str) -> String {
    use axum::{
        Json, Router,
        http::StatusCode,
        response::IntoResponse,
        routing::{get, post},
    };

    let listener = tokio::net::TcpListener::bind("localhost:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let redirect_url = new_url.to_owned();

    async fn push_handler(Json(items): Json<Vec<serde_json::Value>>) -> impl IntoResponse {
        // Accept all items so push succeeds — we want to exercise the
        // pull→AnchorExpired→snapshot→ServerMigrated chain.
        Json(serde_json::json!({
            "results": vec![serde_json::json!({"outcome": "accepted"}); items.len()]
        }))
    }

    async fn pull_handler() -> impl IntoResponse {
        // Return 410 Gone to trigger AnchorExpired → snapshot path.
        (
            StatusCode::GONE,
            Json(serde_json::json!({
                "oldest_available": "2026-01-01T00:00:00Z"
            })),
        )
    }

    async fn snapshot_handler(
        axum::extract::State(url): axum::extract::State<String>,
    ) -> impl IntoResponse {
        (
            StatusCode::MISDIRECTED_REQUEST,
            Json(serde_json::json!({
                "error": "server_migrated",
                "new_url": url,
            })),
        )
    }

    async fn health_handler() -> impl IntoResponse {
        (StatusCode::OK, Json(serde_json::json!({"status": "ok"})))
    }

    let app = Router::new()
        .route("/api/health", get(health_handler))
        .route("/api/sync/push", post(push_handler))
        .route("/api/sync/pull", post(pull_handler))
        .route("/api/sync/snapshot", get(snapshot_handler))
        .with_state(redirect_url);

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    format!("http://localhost:{port}")
}

/// Spawn a mock server like [`spawn_redirect_server`] but answering with **an
/// arbitrary status code** instead of always 421, still carrying the ADR #11
/// `{"error":"server_migrated","new_url":...}` body.
///
/// Additive on purpose: the existing ADR #11 tests depend on
/// [`spawn_redirect_server`]'s exact shape, so this sibling exists to let a test
/// ask the one question that helper cannot — does the client check the status at
/// all? Returns the server's URL.
pub async fn spawn_status_migration_server(new_url: &str, status: u16) -> String {
    use axum::{
        Json, Router,
        http::StatusCode,
        response::IntoResponse,
        routing::{get, post},
    };

    let listener = tokio::net::TcpListener::bind("localhost:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let state = (new_url.to_owned(), status);

    async fn handler(
        axum::extract::State((url, status)): axum::extract::State<(String, u16)>,
    ) -> impl IntoResponse {
        (
            StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
            Json(serde_json::json!({
                "error": "server_migrated",
                "new_url": url,
            })),
        )
    }

    async fn health_handler() -> impl IntoResponse {
        (StatusCode::OK, Json(serde_json::json!({"status": "ok"})))
    }

    let app = Router::new()
        .route("/api/health", get(health_handler))
        .route("/api/sync/push", post(handler))
        .route("/api/sync/pull", post(handler))
        .route("/api/sync/snapshot", get(handler))
        .with_state(state);

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    format!("http://localhost:{port}")
}
