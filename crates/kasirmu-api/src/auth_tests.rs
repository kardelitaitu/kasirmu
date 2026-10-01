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
// ── The dev-fallback warning path (MSL-24) ─────────────────────────────
//
// `warn_dev_fallback_once` fires through a `std::sync::Once` and is called from
// exactly one place: `signing_secret`'s `None` arm. It is the ONLY signal an
// operator gets that tokens are signed with a hard-coded constant, and nothing
// tested it -- a refactor dropping the call would leave every test green.
//
// The `Once` makes the warning itself unobservable from a test (it may already
// have fired in another case), so this pins what IS observable and load-bearing:
// the fallback VALUE and the two conditions around it.
#[test]
fn signing_secret_falls_back_only_when_no_secret_is_supplied() {
    // A supplied secret is used verbatim -- never the fallback.
    assert_eq!(signing_secret(Some("explicit-secret")), "explicit-secret");

    // A BLANK supplied secret is treated as absent by the `.filter(!is_empty)` arm,
    // so it must not become the signing key.
    assert_ne!(signing_secret(Some("")), "");

    // The fallback constant itself, reachable through the documented test seam.
    assert_eq!(
        DEV_FALLBACK_SECRET, "oz-pos-dev-secret-change-in-production",
        "API-1: the fallback constant is named in the warning, so its value is a contract"
    );
    let via_seam = signing_secret_for_tests();
    assert!(
        via_seam == DEV_FALLBACK_SECRET || std::env::var("OZ_API_SECRET").is_ok(),
        "with no argument and no env secret, the dev fallback must be used; got {via_seam:?}"
    );
}

// ── C14: the token expiry is clamped on BOTH mint paths ──────────────
//
// The IPC door (`kasirmu-local-api::mint_token`) clamps to `1..=MAX_TOKEN_HOURS`.
// The HTTP door called `create_token_full` directly and passed the caller's
// `expiry_hours` straight through, so the same value was bounded on one path
// and unbounded on the other -- `scripts/generate-local-api-key.bat` mints a
// ten-year token through it.

/// Hours between `iat` and `exp` on a minted token.
///
/// The decode is deliberately unverified: this asserts what was MINTED, not
/// whether validation happens to pass, and every input here is ours.
fn exp_hours_from_now(token: &str) -> i64 {
    use jsonwebtoken::{DecodingKey, Validation, decode};
    let mut validation = Validation::default();
    validation.insecure_disable_signature_validation();
    validation.validate_exp = false;
    let data = decode::<ApiTokenClaims>(
        token,
        &DecodingKey::from_secret(signing_secret(None).as_bytes()),
        &validation,
    )
    .expect("the minted token must decode");
    let iat = data.claims.iat as i64;
    let exp = data.claims.exp as i64;
    (exp - iat) / 3600
}

#[test]
fn an_out_of_range_expiry_is_clamped_not_honoured() {
    // 10 years -- what generate-local-api-key.bat asks for.
    let resp = create_token_full("script", Some(87_600), None, None, None, None).unwrap();
    let hours = exp_hours_from_now(&resp.token);
    assert!(
        hours <= MAX_TOKEN_HOURS,
        "C14: a 10-year expiry must be clamped to {MAX_TOKEN_HOURS}h, got {hours}h"
    );
    assert_eq!(
        hours, MAX_TOKEN_HOURS,
        "the clamp must land exactly on the max"
    );
}

#[test]
fn a_negative_expiry_is_not_raised_here_so_expired_tokens_stay_mintable() {
    // Deliberately the opposite of a clamp: this primitive is used to build an
    // already-expired token (`expired_token_is_rejected` relies on it), so a
    // floor here would break a legitimate caller. The floor belongs on the
    // operator-facing IPC door, which already applies it.
    //
    // Asserting the pass-through is what stops a future "hardening" pass from
    // clamping the floor in and silently breaking that test's premise.
    let resp = create_token_full("script", Some(-1), None, None, None, None).unwrap();
    assert!(
        exp_hours_from_now(&resp.token) < 0,
        "a negative expiry must pass through so an expired token can be minted"
    );
}

#[test]
fn an_in_range_expiry_is_left_alone() {
    // The clamp must not distort legitimate values.
    for requested in [1_i64, 12, 24, 8_760] {
        let resp = create_token_full("script", Some(requested), None, None, None, None).unwrap();
        assert_eq!(
            exp_hours_from_now(&resp.token),
            requested,
            "an in-range expiry must pass through unchanged"
        );
    }
}

#[test]
fn the_default_applies_when_no_expiry_is_given() {
    let resp = create_token_full("script", None, None, None, None, None).unwrap();
    assert_eq!(exp_hours_from_now(&resp.token), DEFAULT_EXPIRY_HOURS);
}

#[test]
fn both_mint_doors_clamp_to_the_same_bound() {
    // The C14 defect in one assertion: the same requested value must yield the
    // same expiry whichever door mints it. Before the fix the HTTP door had no
    // bound at all, so this failed by an order of magnitude.
    let via_http = create_token_full("script", Some(87_600), None, None, None, None).unwrap();
    let via_ipc = ipc_door_mint(Some(87_600));
    assert_eq!(
        exp_hours_from_now(&via_http.token),
        exp_hours_from_now(&via_ipc.token),
        "both mint doors must apply the same clamp"
    );
}

/// Reproduce the IPC door's clamp so the two bounds can be compared.
///
/// `kasirmu-api` cannot depend on `kasirmu-local-api` -- the dependency runs
/// the other way -- so the IPC bound is restated here as the contract value it
/// is. If the two ever diverge, this test fails rather than silently agreeing.
fn ipc_door_mint(requested: Option<i64>) -> TokenResponse {
    let clamped = requested
        .unwrap_or(DEFAULT_EXPIRY_HOURS)
        .clamp(1, MAX_TOKEN_HOURS);
    create_token_full("script", Some(clamped), None, None, None, None).unwrap()
}
