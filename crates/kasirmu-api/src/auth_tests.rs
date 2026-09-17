use super::*;
use crate::AppState;

#[tokio::test]
async fn create_and_validate() {
    let resp = create_token("test-script", Some(1), None, None).unwrap();
    let claims = validate_token(&resp.token).await.unwrap();
    assert_eq!(claims.sub, "test-script");
    assert_eq!(claims.jti, resp.token_id);
}

#[tokio::test]
async fn bad_token_is_rejected() {
    assert!(validate_token("not.a.jwt").await.is_err());
}

#[tokio::test]
async fn tampered_token_is_rejected() {
    let resp = create_token("tamper", Some(24), None, None).unwrap();
    // Append junk to invalidate the signature.
    let bad = format!("{}x", resp.token);
    assert!(validate_token(&bad).await.is_err());
}

#[tokio::test]
async fn expired_token_is_rejected() {
    // Create a token that was already expired 1 hour ago.
    let resp = create_token("expired", Some(-1), None, None).unwrap();
    let result = validate_token(&resp.token).await;
    assert!(result.is_err(), "expired token should be rejected");
}

#[tokio::test]
async fn empty_token_is_rejected() {
    assert!(validate_token("").await.is_err());
}

#[tokio::test]
async fn whitespace_only_token_is_rejected() {
    assert!(validate_token("   ").await.is_err());
}

#[tokio::test]
async fn create_token_default_expiry_works() {
    // None expiry should default to 24 hours and produce a valid token.
    let resp = create_token("default-exp", None, None, None).unwrap();
    assert!(!resp.token.is_empty());
    assert!(!resp.expires_at.is_empty());
    assert!(!resp.token_id.is_empty());
    let claims = validate_token(&resp.token).await.unwrap();
    assert_eq!(claims.sub, "default-exp");
}

#[test]
fn token_id_is_uuid_v4_format() {
    let resp = create_token("uuid-test", Some(1), None, None).unwrap();
    assert_eq!(resp.token_id.len(), 36, "UUID v4 should be 36 chars");
    assert_eq!(
        resp.token_id.chars().filter(|c| *c == '-').count(),
        4,
        "UUID should have 4 hyphens"
    );
}

#[test]
fn expires_at_is_valid_rfc3339() {
    let resp = create_token("rfc3339", Some(1), None, None).unwrap();
    // RFC 3339: "2025-01-15T10:30:00+00:00" or "2025-01-15T10:30:00Z"
    assert!(
        resp.expires_at.contains('T'),
        "should contain 'T' separator"
    );
    assert!(
        resp.expires_at.ends_with('Z') || resp.expires_at.contains('+'),
        "should end with Z or contain timezone offset"
    );
    // Should be parseable by chrono.
    let parsed = chrono::DateTime::parse_from_rfc3339(&resp.expires_at);
    assert!(
        parsed.is_ok(),
        "expires_at should parse as RFC 3339: {}",
        resp.expires_at
    );
}

#[tokio::test]
async fn claims_have_non_empty_fields() {
    let resp = create_token("fields", Some(1), None, None).unwrap();
    let claims = validate_token(&resp.token).await.unwrap();
    assert!(!claims.sub.is_empty());
    assert!(!claims.jti.is_empty());
    assert!(claims.exp > 0);
    assert!(claims.iat > 0);
}

#[tokio::test]
async fn claims_exp_is_after_iat() {
    let resp = create_token("time-order", Some(1), None, None).unwrap();
    let claims = validate_token(&resp.token).await.unwrap();
    assert!(claims.exp > claims.iat, "exp should be after iat");
}

#[test]
fn two_tokens_have_different_ids() {
    let a = create_token("a", Some(1), None, None).unwrap();
    let b = create_token("b", Some(1), None, None).unwrap();
    assert_ne!(a.token_id, b.token_id, "each token should have a unique ID");
    assert_ne!(a.token, b.token, "each token should have a unique JWT");
}

#[test]
fn token_response_serialization() {
    let resp = TokenResponse {
        token: "fake.jwt.here".into(),
        expires_at: "2025-06-15T12:00:00Z".into(),
        token_id: "550e8400-e29b-41d4-a716-446655440000".into(),
    };
    let json = serde_json::to_string(&resp).unwrap();
    assert!(json.contains("\"token\":\"fake.jwt.here\""));
    assert!(json.contains("\"expires_at\":\"2025-06-15T12:00:00Z\""));
    assert!(json.contains("\"token_id\":\"550e8400-e29b-41d4-a716-446655440000\""));
}

#[test]
fn token_with_zero_hour_expiry_is_well_formed() {
    // 0-hour expiry: token may or may not be valid depending on
    // clock precision, but it should always be structurally correct.
    let resp = create_token("zero", Some(0), None, None).unwrap();
    assert!(!resp.token.is_empty());
    assert!(!resp.token_id.is_empty());
    assert!(!resp.expires_at.is_empty());
}

// ── Per-state secret resolution (desktop local API) ─────────────────

#[tokio::test]
async fn custom_secret_roundtrip() {
    let secret = "per-install-secret-a7f3";
    let resp = create_token_full("custom", Some(1), None, None, None, Some(secret)).unwrap();
    let claims = validate_token_with_secret(&resp.token, Some(secret))
        .await
        .unwrap();
    assert_eq!(claims.sub, "custom");
}

#[tokio::test]
async fn custom_secret_token_rejected_by_default_resolution() {
    // A token signed with a per-install secret must NOT validate under
    // the env/dev-fallback resolution — otherwise the desktop secret
    // buys nothing against the known dev constant.
    let secret = "per-install-secret-b8e4";
    let resp = create_token_full("custom", Some(1), None, None, None, Some(secret)).unwrap();
    assert!(validate_token(&resp.token).await.is_err());
}

#[tokio::test]
async fn dev_secret_token_rejected_by_custom_secret() {
    // The reverse direction: a token forged with the known dev constant
    // must not pass validation on a server configured with a real secret.
    let secret = "per-install-secret-c9f5";
    let forged = create_token("forged", Some(1), None, None).unwrap();
    assert!(
        validate_token_with_secret(&forged.token, Some(secret))
            .await
            .is_err()
    );
}

#[tokio::test]
async fn stateful_middleware_uses_state_secret() {
    use axum::Router;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use axum::routing::get;
    use tower::ServiceExt;

    let secret = "middleware-secret-d1a6";
    let state = AppState {
        api_secret: secret.to_string(),
        allow_terminal_credentials: true,
        ..AppState::test(rusqlite::Connection::open_in_memory().unwrap())
    };
    async fn protected() -> &'static str {
        "ok"
    }
    let app = Router::new()
        .route("/x", get(protected))
        .layer(axum::middleware::from_fn_with_state(
            AuthState {
                secret: std::sync::Arc::new(secret.to_string()),
            },
            auth_middleware_with_state,
        ))
        .with_state(state);

    let good = create_token_full("ok", Some(1), None, None, None, Some(secret))
        .unwrap()
        .token;
    let forged = create_token("forged", Some(1), None, None).unwrap().token;

    let req = Request::builder()
        .uri("/x")
        .header("authorization", format!("Bearer {good}"))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK, "state-secret token accepted");

    let req = Request::builder()
        .uri("/x")
        .header("authorization", format!("Bearer {forged}"))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(
        resp.status(),
        StatusCode::UNAUTHORIZED,
        "dev-constant token rejected on a state-secret server"
    );

    let req = Request::builder().uri("/x").body(Body::empty()).unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}
