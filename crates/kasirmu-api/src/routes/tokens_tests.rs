use super::*;
use crate::DEFAULT_CORS_ORIGINS;
use axum::body::to_bytes;
use axum::http::StatusCode;
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

fn request_body() -> CreateTokenRequest {
    CreateTokenRequest {
        label: "test-client".into(),
        expiry_hours: Some(24),
        tenant_id: None,
        client_id: None,
        client_secret: None,
        read_preset: None,
        read_permissions: None,
    }
}

fn register_terminal(conn: &rusqlite::Connection, id: &str, secret: &str) {
    conn.execute(
        "INSERT INTO sync_terminals (terminal_id, secret_hash, label)
         VALUES (?1, ?2, 'front')
         ON CONFLICT(terminal_id) DO UPDATE SET secret_hash = excluded.secret_hash",
        rusqlite::params![id, crate::routes::terminals::hash_secret(secret)],
    )
    .unwrap();
}

fn body_with_credentials(label: &str, client_id: &str, client_secret: &str) -> CreateTokenRequest {
    CreateTokenRequest {
        label: label.into(),
        expiry_hours: Some(24),
        tenant_id: None,
        client_id: Some(client_id.into()),
        client_secret: Some(client_secret.into()),
        read_preset: None,
        read_permissions: None,
    }
}

fn request_with_header(key: Option<&str>) -> HeaderMap {
    let mut headers = HeaderMap::new();
    if let Some(k) = key {
        headers.insert(
            header::HeaderName::from_static(ADMIN_KEY_HEADER),
            k.parse().unwrap(),
        );
    }
    headers
}

#[tokio::test]
async fn token_minting_is_open_when_no_admin_key_configured() {
    let response = create_token_handler(
        State(state_with_admin_key(None)),
        HeaderMap::new(),
        Json(request_body()),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::OK);

    let bytes = to_bytes(response.into_body(), 4096).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert!(json["token"]["token"].as_str().unwrap().len() > 20);
}

#[tokio::test]
async fn token_minting_rejects_missing_admin_key_when_configured() {
    let response = create_token_handler(
        State(state_with_admin_key(Some("sekret"))),
        HeaderMap::new(),
        Json(request_body()),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn token_minting_rejects_wrong_admin_key() {
    let response = create_token_handler(
        State(state_with_admin_key(Some("sekret"))),
        request_with_header(Some("wrong-key")),
        Json(request_body()),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn token_minting_allows_matching_admin_key() {
    let response = create_token_handler(
        State(state_with_admin_key(Some("sekret"))),
        request_with_header(Some("sekret")),
        Json(request_body()),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn create_token_returns_200_with_jwt() {
    let response = create_token_handler(
        State(state_with_admin_key(None)),
        HeaderMap::new(),
        Json(request_body()),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::OK);

    let bytes = to_bytes(response.into_body(), 4096).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert!(json["token"]["token"].as_str().unwrap().len() > 20);
    assert_eq!(json["token"]["token_id"].as_str().unwrap().len(), 36); // UUID
}

#[tokio::test]
async fn terminal_credentials_mint_token_without_admin_key() {
    // ADR sync-auth-hardening P3: a registered terminal mints its own
    // scoped token with client credentials — even when the server is
    // gated with an admin key and none is presented.
    let state = state_with_admin_key(Some("sekret"));
    {
        let conn = state.db.lock().await;
        register_terminal(&conn, "term-1", "device-secret-abc");
    }

    let response = create_token_handler(
        State(state),
        HeaderMap::new(), // no admin key
        Json(body_with_credentials(
            "pos-terminal",
            "term-1",
            "device-secret-abc",
        )),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::OK);

    let bytes = to_bytes(response.into_body(), 4096).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert!(json["token"]["token"].as_str().unwrap().len() > 20);
}

#[tokio::test]
async fn terminal_credentials_rejected_when_secret_wrong() {
    let state = state_with_admin_key(None);
    {
        let conn = state.db.lock().await;
        register_terminal(&conn, "term-1", "device-secret-abc");
    }

    let response = create_token_handler(
        State(state),
        HeaderMap::new(),
        Json(body_with_credentials(
            "pos-terminal",
            "term-1",
            "wrong-secret",
        )),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn terminal_credentials_rejected_for_unknown_terminal() {
    let response = create_token_handler(
        State(state_with_admin_key(None)),
        HeaderMap::new(),
        Json(body_with_credentials("pos-terminal", "ghost", "any-secret")),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn create_token_defaults_expiry() {
    let body = CreateTokenRequest {
        label: "default-expiry".into(),
        expiry_hours: None,
        tenant_id: None,
        client_id: None,
        client_secret: None,
        read_preset: None,
        read_permissions: None,
    };
    let response = create_token_handler(
        State(state_with_admin_key(None)),
        HeaderMap::new(),
        Json(body),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::OK);

    let bytes = to_bytes(response.into_body(), 4096).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    // expires_at should be present and non-empty
    assert!(!json["token"]["expires_at"].as_str().unwrap().is_empty());
}

#[test]
fn create_token_request_deserialization() {
    let json = r#"{"label":"my-token","expiry_hours":12}"#;
    let req: CreateTokenRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.label, "my-token");
    assert_eq!(req.expiry_hours, Some(12));
    assert_eq!(req.tenant_id, None);
}

#[test]
fn create_token_response_is_serializable() {
    let resp = CreateTokenResponse {
        token: TokenResponse {
            token: "fake.jwt.token".into(),
            expires_at: "2026-07-07T00:00:00Z".into(),
            token_id: "abc-123".into(),
        },
    };
    let json = serde_json::to_string(&resp).unwrap();
    assert!(json.contains("fake.jwt.token"));
}

// ── API-2: constant-time admin-key comparison ─────────────────────

#[test]
fn admin_key_compare_accepts_exact_match() {
    let headers = request_with_header(Some("sekret"));
    assert!(admin_key_authorised(&headers, Some("sekret")));
}

#[test]
fn admin_key_compare_rejects_wrong_key_and_prefixes() {
    // Wrong key of the same length, and shorter prefixes/suffixes of the
    // real key — all must be rejected (the HMAC compare makes the timing
    // of these branches uniform).
    for probe in ["wrong-key-length", "sek", "sekret-extra", ""] {
        let headers = request_with_header(Some(probe));
        assert!(
            !admin_key_authorised(&headers, Some("sekret")),
            "probe '{probe}' must be rejected"
        );
    }
}

#[test]
fn admin_key_compare_dev_mode_still_open_without_configured_key() {
    let headers = request_with_header(Some("anything"));
    assert!(admin_key_authorised(&headers, None));
    let empty = request_with_header(None);
    assert!(admin_key_authorised(&empty, None));
}

#[test]
fn admin_key_compare_rejects_missing_header_when_configured() {
    let headers = request_with_header(None);
    assert!(!admin_key_authorised(&headers, Some("sekret")));
}

// ── Read-tier mint authz (spec 0047 F2) ─────────────────────────────

#[tokio::test]
async fn admin_mint_with_read_preset_carries_permissions() {
    let state = state_with_admin_key(None);
    let body = CreateTokenRequest {
        label: "dashboard-client".into(),
        expiry_hours: Some(1),
        tenant_id: Some("tenant-a".into()),
        client_id: None,
        client_secret: None,
        read_preset: Some("dashboard".into()),
        read_permissions: None,
    };
    let response = create_token_handler(State(state), HeaderMap::new(), Json(body))
        .await
        .into_response();
    assert_eq!(response.status(), StatusCode::OK);

    let bytes = to_bytes(response.into_body(), 4096).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let token_str = json["token"]["token"].as_str().unwrap();
    let claims = crate::auth::validate_token(token_str).await.unwrap();
    let perms = claims.permissions.unwrap();
    assert!(perms.contains(&"products:read".to_string()));
    assert!(perms.contains(&"reports:view".to_string()));
    assert!(perms.contains(&"analytics:view".to_string()));
    assert!(!perms.contains(&"sales:view".to_string())); // PII-excluded
}

#[tokio::test]
async fn admin_mint_with_unknown_preset_returns_422() {
    let state = state_with_admin_key(None);
    let body = CreateTokenRequest {
        label: "bad-client".into(),
        expiry_hours: Some(1),
        tenant_id: None,
        client_id: None,
        client_secret: None,
        read_preset: Some("superuser".into()),
        read_permissions: None,
    };
    let response = create_token_handler(State(state), HeaderMap::new(), Json(body))
        .await
        .into_response();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let bytes = to_bytes(response.into_body(), 4096).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["error"], "unknown_preset");
}

#[tokio::test]
async fn admin_mint_with_unknown_permission_returns_422() {
    let state = state_with_admin_key(None);
    let body = CreateTokenRequest {
        label: "bad-client".into(),
        expiry_hours: Some(1),
        tenant_id: None,
        client_id: None,
        client_secret: None,
        read_preset: None,
        read_permissions: Some(vec!["products:read".into(), "not:a_key".into()]),
    };
    let response = create_token_handler(State(state), HeaderMap::new(), Json(body))
        .await
        .into_response();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let bytes = to_bytes(response.into_body(), 4096).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["error"], "unknown_permission");
}

#[tokio::test]
async fn terminal_mint_binds_terminal_preset() {
    let state = state_with_admin_key(Some("sekret"));
    {
        let conn = state.db.lock().await;
        register_terminal(&conn, "term-1", "device-secret-abc");
    }

    let response = create_token_handler(
        State(state),
        HeaderMap::new(), // no admin key — terminal path
        Json(body_with_credentials(
            "pos-terminal",
            "term-1",
            "device-secret-abc",
        )),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::OK);

    let bytes = to_bytes(response.into_body(), 4096).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let token_str = json["token"]["token"].as_str().unwrap();
    let claims = crate::auth::validate_token(token_str).await.unwrap();
    let perms = claims
        .permissions
        .expect("terminal token must carry permissions");
    assert!(perms.contains(&"products:read".to_string()));
    assert!(perms.contains(&"categories:read".to_string()));
    assert!(perms.contains(&"reference:read".to_string()));
    assert!(perms.contains(&"plan:read".to_string()));
    // Terminal preset must never carry PII-scoped keys.
    assert!(!perms.contains(&"sales:view".to_string()));
}
