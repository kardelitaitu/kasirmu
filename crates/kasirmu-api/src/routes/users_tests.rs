use super::*;
use crate::DEFAULT_CORS_ORIGINS;
use axum::body::to_bytes;
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use std::sync::Arc;
use tokio::sync::Mutex;

fn state() -> AppState {
    AppState {
        db: Arc::new(Mutex::new(oz_core::migrations::fresh_db())),
        pg: None,
        admin_key: None,
        api_secret: String::new(),
        allow_terminal_credentials: true,
        db_path: ":memory:".into(),
        port: 3099,
        cors_origins: DEFAULT_CORS_ORIGINS.iter().map(|s| s.to_string()).collect(),
        image_dir: std::path::PathBuf::from("./data/images"),
    }
}

fn claims(tenant_id: Option<&str>) -> ApiTokenClaims {
    ApiTokenClaims {
        sub: "test-token".into(),
        jti: "jti-1".into(),
        exp: 9999999999,
        iat: 1000000000,
        tenant_id: tenant_id.map(|s| s.to_owned()),
        terminal_id: None,
        permissions: None,
    }
}

fn body() -> CreateUserRequest {
    CreateUserRequest {
        username: "alice".into(),
        pin_hash: "hash123".into(),
        display_name: "Alice".into(),
        role_id: "role-staff".into(),
    }
}

/// Seed the role FK target so user creation can succeed.
fn seed_role(conn: &rusqlite::Connection, role_id: &str) {
    conn.execute(
        "INSERT OR IGNORE INTO roles (id, name, permissions) VALUES (?1, ?2, '[]')",
        rusqlite::params![role_id, role_id],
    )
    .unwrap();
}

// ── create_user handler ─────────────────────────────────────────

#[tokio::test]
async fn create_user_returns_201_with_default_tenant() {
    let app_state = state();
    {
        let db = app_state.db.lock().await;
        seed_role(&db, "role-staff");
    }
    let response = create_user(
        State(app_state),
        HeaderMap::new(),
        Extension(claims(None)),
        Json(body()),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::CREATED);

    let bytes = to_bytes(response.into_body(), 4096).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["username"], "alice");
    assert_eq!(json["display_name"], "Alice");
}

#[tokio::test]
async fn create_user_stamps_tenant_from_claims() {
    let app_state = state();
    {
        let db = app_state.db.lock().await;
        seed_role(&db, "role-staff");
    }
    let response = create_user(
        State(app_state.clone()),
        HeaderMap::new(),
        Extension(claims(Some("tenant-9"))),
        Json(body()),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::CREATED);

    let db = app_state.db.lock().await;
    let tenant: String = db
        .query_row(
            "SELECT tenant_id FROM users WHERE username = 'alice'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        tenant, "tenant-9",
        "tenant_id must be stamped from JWT claims"
    );
}

#[tokio::test]
async fn create_user_normalizes_username_to_lowercase() {
    let app_state = state();
    {
        let db = app_state.db.lock().await;
        seed_role(&db, "role-staff");
    }
    let body = CreateUserRequest {
        username: "  ALICE  ".into(), // trimmed + lowercased by the store
        pin_hash: "hash123".into(),
        display_name: "Alice".into(),
        role_id: "role-staff".into(),
    };
    let response = create_user(
        State(app_state.clone()),
        HeaderMap::new(),
        Extension(claims(None)),
        Json(body),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::CREATED);

    let db = app_state.db.lock().await;
    let username: String = db
        .query_row(
            "SELECT username FROM users WHERE id = (SELECT MAX(id) FROM users)",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(username, "alice", "username must be trimmed and lowercased");
}

#[tokio::test]
async fn create_user_returns_400_on_empty_username() {
    let app_state = state();
    {
        let db = app_state.db.lock().await;
        seed_role(&db, "role-staff");
    }
    let bad = CreateUserRequest {
        username: "   ".into(),
        pin_hash: "hash123".into(),
        display_name: "Alice".into(),
        role_id: "role-staff".into(),
    };
    let response = create_user(
        State(state()),
        HeaderMap::new(),
        Extension(claims(None)),
        Json(bad),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_user_returns_409_on_duplicate_username() {
    // users.username has a UNIQUE constraint and the store maps the
    // violation to CoreError::Conflict → the handler must return 409.
    let app_state = state();
    {
        let db = app_state.db.lock().await;
        seed_role(&db, "role-staff");
        let store = Store::new(&db);
        store
            .create_user("alice", "hash123", "Alice", "role-staff")
            .unwrap();
    }
    let response = create_user(
        State(app_state.clone()),
        HeaderMap::new(),
        Extension(claims(None)),
        Json(body()),
    )
    .await
    .into_response();
    assert_eq!(
        response.status(),
        StatusCode::CONFLICT,
        "duplicate username must surface as 409"
    );
}

// ── CreateUserRequest deserialization ───────────────────────

#[test]
fn create_user_request_minimal() {
    let json = r#"{"username":"alice","pin_hash":"hash123","display_name":"Alice","role_id":"role-staff"}"#;
    let req: CreateUserRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.username, "alice");
    assert_eq!(req.pin_hash, "hash123");
    assert_eq!(req.display_name, "Alice");
    assert_eq!(req.role_id, "role-staff");
}

#[test]
fn create_user_request_owner_role() {
    let json =
        r#"{"username":"owner","pin_hash":"abc","display_name":"Owner","role_id":"role-owner"}"#;
    let req: CreateUserRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.username, "owner");
    assert_eq!(req.role_id, "role-owner");
}

// ── API-4: terminal-scoped tokens must not mint users ──────────

/// A token minted through the terminal client-credentials path
/// (ADR sync-auth-hardening P3). `terminal_id: None` means admin-minted or
/// legacy; `Some` means a specific registered device holds it.
fn terminal_claims(tenant_id: &str, terminal_id: &str) -> ApiTokenClaims {
    ApiTokenClaims {
        sub: "terminal-device".into(),
        jti: "jti-term".into(),
        exp: 9999999999,
        iat: 1000000000,
        tenant_id: Some(tenant_id.to_owned()),
        terminal_id: Some(terminal_id.to_owned()),
        permissions: None,
    }
}

#[tokio::test]
async fn a_terminal_scoped_token_cannot_create_a_user() {
    // API-4: any valid token could POST /api/v1/users with any role_id,
    // including role-owner. A POS terminal is a device in the shop - if it
    // is rooted or its client_secret is lifted from storage, that is a
    // single credential between a tampered till and an owner session over
    // the tenant's whole dataset.
    let app_state = state();
    {
        let db = app_state.db.lock().await;
        seed_role(&db, "role-owner");
    }

    let response = create_user(
        State(app_state.clone()),
        HeaderMap::new(),
        Extension(terminal_claims("tenant-1", "term-7")),
        Json(CreateUserRequest {
            username: "intruder".into(),
            pin_hash: "hash123".into(),
            display_name: "Intruder".into(),
            role_id: "role-owner".into(),
        }),
    )
    .await
    .into_response();

    assert_eq!(
        response.status(),
        StatusCode::FORBIDDEN,
        "a device-scoped token must not be able to create users"
    );

    let bytes = to_bytes(response.into_body(), 4096).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        json["error"], "insufficient_scope",
        "the body must say why, got: {json}"
    );

    // And nothing was written: a 403 that still created the row would be
    // the worst possible outcome, since the caller could learn it worked
    // from a later login attempt.
    let db = app_state.db.lock().await;
    let count: i64 = db
        .query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 0, "a rejected request must not persist a user");
}

#[tokio::test]
async fn the_scope_check_runs_before_the_store_is_touched() {
    // Ordering matters. With an unseeded role, a request that reaches the
    // store fails with a FK/validation error - so if the handler returned
    // 403 here we know the gate ran first. If it ever returns 400/409/500,
    // the gate has moved behind the write and the device token is back in
    // play for every valid role_id.
    let app_state = state();
    let response = create_user(
        State(app_state),
        HeaderMap::new(),
        Extension(terminal_claims("tenant-1", "term-7")),
        Json(body()),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn an_admin_minted_token_still_creates_users() {
    // The boundary, from the other side: the fix must not break the token
    // type that is actually meant to manage users. Same body, same state,
    // terminal_id None.
    let app_state = state();
    {
        let db = app_state.db.lock().await;
        seed_role(&db, "role-staff");
    }
    let response = create_user(
        State(app_state),
        HeaderMap::new(),
        Extension(claims(None)),
        Json(body()),
    )
    .await
    .into_response();
    assert_eq!(
        response.status(),
        StatusCode::CREATED,
        "admin-minted tokens must keep working"
    );
}

#[tokio::test]
async fn create_user_requires_admin_key_when_configured() {
    // G-1: user creation is an operator-tier action. With an admin key
    // configured, a plain tenant JWT must be rejected before anything
    // touches the store - otherwise a Plus-tier tenant could bypass the
    // C1.1 staff cap its desktop enforces by creating staff via the API.
    let app_state = AppState {
        admin_key: Some("operator-key".into()),
        ..state()
    };
    {
        let db = app_state.db.lock().await;
        seed_role(&db, "role-staff");
    }

    // No admin key header -> 401, nothing written.
    let response = create_user(
        State(app_state.clone()),
        HeaderMap::new(),
        Extension(claims(Some("tenant-1"))),
        Json(body()),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let bytes = to_bytes(response.into_body(), 4096).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["error"], "invalid_admin_key");

    // Wrong admin key -> 401 as well.
    let mut wrong = HeaderMap::new();
    wrong.insert(
        axum::http::header::HeaderName::from_static("x-admin-key"),
        "nope".parse().unwrap(),
    );
    let response = create_user(
        State(app_state.clone()),
        wrong,
        Extension(claims(Some("tenant-1"))),
        Json(body()),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    // Correct admin key -> 201 (dev claim set, no terminal binding).
    let mut ok = HeaderMap::new();
    ok.insert(
        axum::http::header::HeaderName::from_static("x-admin-key"),
        "operator-key".parse().unwrap(),
    );
    let response = create_user(
        State(app_state.clone()),
        ok,
        Extension(claims(Some("tenant-1"))),
        Json(body()),
    )
    .await
    .into_response();
    assert_eq!(
        response.status(),
        StatusCode::CREATED,
        "the operator admin key must authorise user creation"
    );
}
