use super::*;
use crate::DEFAULT_CORS_ORIGINS;
use axum::body::to_bytes;
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use std::sync::Arc;
use tokio::sync::Mutex;

fn state_with_admin_key(key: Option<&str>) -> AppState {
    AppState {
        db: Arc::new(Mutex::new(oz_core::migrations::fresh_db())),
        pg: None,
        admin_key: key.map(|s| s.to_owned()),
        api_secret: String::new(),
        allow_terminal_credentials: true,
        db_path: ":memory:".into(),
        port: 3099,
        cors_origins: DEFAULT_CORS_ORIGINS.iter().map(|s| s.to_string()).collect(),
        image_dir: std::path::PathBuf::from("./data/images"),
    }
}

fn admin_headers(key: Option<&str>) -> HeaderMap {
    use axum::http::header;
    let mut headers = HeaderMap::new();
    if let Some(k) = key {
        headers.insert(
            header::HeaderName::from_static("x-admin-key"),
            k.parse().unwrap(),
        );
    }
    headers
}

fn register_request() -> RegisterTerminalRequest {
    RegisterTerminalRequest {
        terminal_id: "term-1".into(),
        label: Some("Front counter".into()),
        tenant_id: None,
    }
}

/// Read the device_secret from a registration response body.
async fn device_secret_from(response: axum::response::Response) -> String {
    let bytes = to_bytes(response.into_body(), 4096).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    json["device_secret"].as_str().unwrap().to_owned()
}

async fn body_json(response: axum::response::Response) -> serde_json::Value {
    let bytes = to_bytes(response.into_body(), 4096).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

// ── register_terminal_handler paths ────────────────────────────────

#[tokio::test]
async fn register_terminal_rejects_missing_admin_key_when_configured() {
    let response = register_terminal_handler(
        State(state_with_admin_key(Some("sekret"))),
        HeaderMap::new(),
        Json(register_request()),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn register_terminal_rejects_wrong_admin_key() {
    let response = register_terminal_handler(
        State(state_with_admin_key(Some("sekret"))),
        admin_headers(Some("wrong-key")),
        Json(register_request()),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn register_terminal_allows_matching_admin_key() {
    let response = register_terminal_handler(
        State(state_with_admin_key(Some("sekret"))),
        admin_headers(Some("sekret")),
        Json(register_request()),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn register_terminal_is_open_when_no_admin_key() {
    let response = register_terminal_handler(
        State(state_with_admin_key(None)),
        HeaderMap::new(),
        Json(register_request()),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn register_terminal_rejects_blank_terminal_id() {
    let body = RegisterTerminalRequest {
        terminal_id: "   ".into(), // whitespace-only → trims to empty
        label: None,
        tenant_id: None,
    };
    let response = register_terminal_handler(
        State(state_with_admin_key(None)),
        HeaderMap::new(),
        Json(body),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn register_terminal_rejects_invalid_terminal_id_charset() {
    let body = RegisterTerminalRequest {
        terminal_id: "bad/terminal!".into(),
        label: None,
        tenant_id: None,
    };
    let response = register_terminal_handler(
        State(state_with_admin_key(None)),
        HeaderMap::new(),
        Json(body),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let json = body_json(response).await;
    assert_eq!(json["error"], "invalid_terminal_id");
}

#[tokio::test]
async fn register_terminal_rejects_overlong_terminal_id() {
    let body = RegisterTerminalRequest {
        terminal_id: "t".repeat(65),
        label: None,
        tenant_id: None,
    };
    let response = register_terminal_handler(
        State(state_with_admin_key(None)),
        HeaderMap::new(),
        Json(body),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn register_terminal_rejects_overlong_label() {
    let body = RegisterTerminalRequest {
        terminal_id: "term-ok".into(),
        label: Some("l".repeat(129)),
        tenant_id: None,
    };
    let response = register_terminal_handler(
        State(state_with_admin_key(None)),
        HeaderMap::new(),
        Json(body),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn register_terminal_rejects_invalid_tenant_id() {
    let body = RegisterTerminalRequest {
        terminal_id: "term-ok".into(),
        label: None,
        tenant_id: Some("bad tenant!".into()),
    };
    let response = register_terminal_handler(
        State(state_with_admin_key(None)),
        HeaderMap::new(),
        Json(body),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let json = body_json(response).await;
    assert_eq!(json["error"], "invalid_tenant");
}

#[tokio::test]
async fn register_terminal_returns_high_entropy_uuid_secret() {
    let response = register_terminal_handler(
        State(state_with_admin_key(None)),
        HeaderMap::new(),
        Json(register_request()),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::OK);
    let secret = device_secret_from(response).await;
    // UUID v4 without dashes: 32 hex chars.
    assert_eq!(secret.len(), 32);
    assert!(secret.chars().all(|c| c.is_ascii_hexdigit()));
}

#[tokio::test]
async fn register_terminal_persists_secret_hash_not_plaintext() {
    let state = state_with_admin_key(None);
    let response = register_terminal_handler(
        State(state.clone()),
        HeaderMap::new(),
        Json(register_request()),
    )
    .await
    .into_response();
    let secret = device_secret_from(response).await;

    let conn = state.db.lock().await;
    let stored: String = conn
        .query_row(
            "SELECT secret_hash FROM sync_terminals WHERE terminal_id = 'term-1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        stored,
        hash_secret(&secret),
        "must store the SHA-256 digest"
    );
    assert_ne!(stored, secret, "plaintext must never be stored");
    assert!(!stored.contains(&secret), "hash must not embed the secret");
}

#[tokio::test]
async fn register_terminal_rotation_invalidates_old_secret() {
    let state = state_with_admin_key(None);
    let response = register_terminal_handler(
        State(state.clone()),
        HeaderMap::new(),
        Json(register_request()),
    )
    .await
    .into_response();
    let first_secret = device_secret_from(response).await;
    let first_hash = hash_secret(&first_secret);

    // Re-register the same terminal: secret must rotate.
    let response2 = register_terminal_handler(
        State(state.clone()),
        HeaderMap::new(),
        Json(register_request()),
    )
    .await
    .into_response();
    let second_secret = device_secret_from(response2).await;
    assert_ne!(
        second_secret, first_secret,
        "re-registration must rotate the secret"
    );

    let conn = state.db.lock().await;
    let stored: String = conn
        .query_row(
            "SELECT secret_hash FROM sync_terminals WHERE terminal_id = 'term-1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(stored, hash_secret(&second_secret));
    assert_ne!(
        stored, first_hash,
        "old secret's hash must be gone — old credentials stop working"
    );
}

#[tokio::test]
async fn register_terminal_trims_terminal_id() {
    let state = state_with_admin_key(None);
    let body = RegisterTerminalRequest {
        terminal_id: "  term-padded  ".into(),
        label: None,
        tenant_id: None,
    };
    let response = register_terminal_handler(State(state.clone()), HeaderMap::new(), Json(body))
        .await
        .into_response();
    assert_eq!(response.status(), StatusCode::OK);

    let conn = state.db.lock().await;
    let stored: String = conn
        .query_row(
            "SELECT terminal_id FROM sync_terminals WHERE terminal_id = 'term-padded'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        stored, "term-padded",
        "terminal_id must be trimmed before insert"
    );
}

#[test]
fn hash_secret_is_stable_hex() {
    let a = hash_secret("secret-1");
    let b = hash_secret("secret-1");
    assert_eq!(a, b);
    assert_eq!(a.len(), 64);
    assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    assert_ne!(a, hash_secret("secret-2"));
    assert!(!a.contains("secret"));
}

#[test]
fn verify_terminal_credentials_matches_only_correct_secret() {
    let conn = oz_core::migrations::fresh_db();
    let secret = generate_device_secret();
    conn.execute(
        "INSERT INTO sync_terminals (terminal_id, secret_hash, label)
         VALUES ('term-1', ?1, 'front')",
        rusqlite::params![hash_secret(&secret)],
    )
    .unwrap();

    assert!(
        verify_terminal_credentials(&conn, "term-1", &secret)
            .unwrap()
            .is_some()
    );
    assert!(
        verify_terminal_credentials(&conn, "term-1", "wrong-secret")
            .unwrap()
            .is_none()
    );
    assert!(
        verify_terminal_credentials(&conn, "unknown", &secret)
            .unwrap()
            .is_none()
    );
}
