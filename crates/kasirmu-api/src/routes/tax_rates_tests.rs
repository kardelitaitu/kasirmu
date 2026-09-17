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

fn body() -> CreateTaxRateRequest {
    CreateTaxRateRequest {
        name: "VAT 10%".into(),
        rate_bps: 1000,
        is_default: true,
        is_inclusive: false,
        legal_entity_id: None,
        location_id: None,
        effective_from: None,
        effective_to: None,
        rounding_mode: None,
    }
}

// ── store_error_response mapping ───────────────────────────────

#[test]
fn store_error_response_maps_validation_to_400() {
    let resp = store_error_response(CoreError::Validation {
        message: "bad input".into(),
        field: "name",
    })
    .into_response();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[test]
fn store_error_response_maps_conflict_to_409() {
    let resp = store_error_response(CoreError::Conflict {
        entity: "tax_rate",
        field: "name",
    })
    .into_response();
    assert_eq!(resp.status(), StatusCode::CONFLICT);
}

#[test]
fn store_error_response_maps_not_found_to_404() {
    let resp = store_error_response(CoreError::NotFound {
        entity: "tax_rate",
        id: "x".into(),
    })
    .into_response();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[test]
fn store_error_response_maps_unknown_to_500() {
    let resp = store_error_response(CoreError::Internal("boom".into())).into_response();
    assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

// ── create_tax_rate handler ────────────────────────────────────

#[tokio::test]
async fn create_tax_rate_returns_201_with_default_tenant() {
    let response = create_tax_rate(
        State(state()),
        HeaderMap::new(),
        Extension(claims(None)),
        Json(body()),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::CREATED);

    let bytes = to_bytes(response.into_body(), 4096).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["name"], "VAT 10%");
    assert_eq!(json["rate_bps"], 1000);
    assert!(json["is_default"].as_bool().unwrap());
}

#[tokio::test]
async fn create_tax_rate_stamps_tenant_from_claims() {
    let app_state = state();
    let response = create_tax_rate(
        State(app_state.clone()),
        HeaderMap::new(),
        Extension(claims(Some("tenant-42"))),
        Json(body()),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::CREATED);

    let db = app_state.db.lock().await;
    let tenant: String = db
        .query_row(
            "SELECT tenant_id FROM tax_rates WHERE name = 'VAT 10%'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        tenant, "tenant-42",
        "tenant_id must be stamped from JWT claims"
    );
}

#[tokio::test]
async fn create_tax_rate_returns_400_on_validation_error() {
    let bad = CreateTaxRateRequest {
        name: "".into(), // empty name → store validation error
        rate_bps: 1000,
        is_default: false,
        is_inclusive: false,
        legal_entity_id: None,
        location_id: None,
        effective_from: None,
        effective_to: None,
        rounding_mode: None,
    };
    let response = create_tax_rate(
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
async fn create_tax_rate_allows_duplicate_name() {
    // The store has NO uniqueness constraint on tax_rates.name (verified:
    // no UNIQUE index and no CoreError::Conflict in the tax store), so a
    // duplicate-name create is legal and must return 201. This pins the
    // current contract — if name uniqueness is added later, this test
    // will fail and force the handler's 409 path to be exercised.
    let app_state = state();
    {
        let db = app_state.db.lock().await;
        let store = Store::new(&db);
        store
            .create_tax_rate("VAT 10%", 1000, false, false)
            .unwrap();
    }
    let response = create_tax_rate(
        State(app_state.clone()),
        HeaderMap::new(),
        Extension(claims(None)),
        Json(body()),
    )
    .await
    .into_response();
    assert_eq!(
        response.status(),
        StatusCode::CREATED,
        "duplicate tax-rate names are currently legal (no unique constraint)"
    );
}

// ── CreateTaxRateRequest deserialization ────────────────────

#[test]
fn create_tax_rate_request_minimal() {
    let json = r#"{"name":"VAT 10%","rate_bps":1000,"is_default":true,"is_inclusive":false}"#;
    let req: CreateTaxRateRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.name, "VAT 10%");
    assert_eq!(req.rate_bps, 1000);
    assert!(req.is_default);
    assert!(!req.is_inclusive);
}

#[test]
fn create_tax_rate_request_inclusive() {
    let json = r#"{"name":"GST 5%","rate_bps":500,"is_default":false,"is_inclusive":true}"#;
    let req: CreateTaxRateRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.name, "GST 5%");
    assert_eq!(req.rate_bps, 500);
    assert!(!req.is_default);
    assert!(req.is_inclusive);
}

// ── scoped-authoring boundary (D8: the hub is the authoring door) ──

#[tokio::test]
async fn create_tax_rate_accepts_scope_and_window_fields() {
    let mut scoped = body();
    scoped.location_id = Some("default".into());
    scoped.effective_from = Some("2026-10-01".into());
    scoped.effective_to = Some("2027-10-01".into());
    let response = create_tax_rate(
        State(state()),
        HeaderMap::new(),
        Extension(claims(None)),
        Json(scoped),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::CREATED);
}

#[tokio::test]
async fn create_tax_rate_refuses_both_scope_arms_with_400() {
    let mut ambiguous = body();
    ambiguous.legal_entity_id = Some("whatever".into());
    ambiguous.location_id = Some("default".into());
    let response = create_tax_rate(
        State(state()),
        HeaderMap::new(),
        Extension(claims(None)),
        Json(ambiguous),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_tax_rate_refuses_empty_period_with_400() {
    // effective_to == effective_from covers no day at all (exclusive end),
    // which core's writers refuse and the hub boundary must refuse too.
    let mut empty = body();
    empty.location_id = Some("default".into());
    empty.effective_from = Some("2026-10-01".into());
    empty.effective_to = Some("2026-10-01".into());
    let response = create_tax_rate(
        State(state()),
        HeaderMap::new(),
        Extension(claims(None)),
        Json(empty),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_tax_rate_refuses_malformed_window_date_with_400() {
    let mut malformed = body();
    malformed.effective_from = Some("01-10-2026".into());
    let response = create_tax_rate(
        State(state()),
        HeaderMap::new(),
        Extension(claims(None)),
        Json(malformed),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_tax_rate_refuses_unknown_location_scope_with_400() {
    // The target row does not exist in the hub's shared database — the
    // boundary check (not the FK) must produce the typed 400.
    let mut unknown = body();
    unknown.location_id = Some("no-such-location".into());
    let response = create_tax_rate(
        State(state()),
        HeaderMap::new(),
        Extension(claims(None)),
        Json(unknown),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

// ── E1-9: rounding_mode on the authoring door ───────────────────
//
// The hub carries the statutory rounding mode (D8 hub-only authoring):
// accept the three CHECK values, refuse anything else with a clean 400,
// and read the stored value back through the SQLite arm mirror stamp.

#[tokio::test]
async fn create_tax_rate_accepts_half_up_and_stores_it() {
    let app_state = state();
    let mut req = body();
    req.rounding_mode = Some("half_up".into());
    let response = create_tax_rate(
        State(app_state.clone()),
        HeaderMap::new(),
        Extension(claims(None)),
        Json(req),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::CREATED);

    let db = app_state.db.lock().await;
    let mode: String = db
        .query_row(
            "SELECT rounding_mode FROM tax_rates WHERE name = 'VAT 10%'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(mode, "half_up", "hub-authored mode must be stored as TEXT");
}

#[tokio::test]
async fn create_tax_rate_accepts_truncate_and_stores_it() {
    let app_state = state();
    let mut req = body();
    req.rounding_mode = Some("truncate".into());
    let response = create_tax_rate(
        State(app_state.clone()),
        HeaderMap::new(),
        Extension(claims(None)),
        Json(req),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::CREATED);

    let db = app_state.db.lock().await;
    let mode: String = db
        .query_row(
            "SELECT rounding_mode FROM tax_rates WHERE name = 'VAT 10%'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(mode, "truncate");
}

#[tokio::test]
async fn create_tax_rate_omitted_mode_stays_store_preference() {
    // Omitted / '' = store preference: the column keeps its '' default and
    // the mirror stamp never fires.
    let app_state = state();
    let response = create_tax_rate(
        State(app_state.clone()),
        HeaderMap::new(),
        Extension(claims(None)),
        Json(body()),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::CREATED);

    let db = app_state.db.lock().await;
    let mode: String = db
        .query_row(
            "SELECT rounding_mode FROM tax_rates WHERE name = 'VAT 10%'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(mode, "");
}

#[tokio::test]
async fn create_tax_rate_refuses_unknown_mode_with_400() {
    // 'bankers' is not one of the three CHECK values — a hub-authored mode
    // the branch CHECK would refuse must die at the boundary, clean 400.
    let mut bad = body();
    bad.rounding_mode = Some("bankers".into());
    let response = create_tax_rate(
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
async fn create_tax_rate_refuses_wrong_case_mode_with_400() {
    // Exactly 'half_up' — the CHECK is byte-exact, so 'HALF_UP' is a
    // second spelling the boundary must refuse, not normalize.
    let mut bad = body();
    bad.rounding_mode = Some("HALF_UP".into());
    let response = create_tax_rate(
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
async fn update_tax_rate_carries_rounding_mode() {
    let app_state = state();
    let created = create_tax_rate(
        State(app_state.clone()),
        HeaderMap::new(),
        Extension(claims(None)),
        Json(body()),
    )
    .await
    .into_response();
    assert_eq!(created.status(), StatusCode::CREATED);
    let bytes = to_bytes(created.into_body(), 4096).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let id = json["id"].as_str().expect("created id").to_owned();

    let update = UpdateTaxRateRequest {
        name: "VAT 10%".into(),
        rate_bps: 1100,
        is_default: true,
        is_inclusive: false,
        legal_entity_id: None,
        location_id: None,
        effective_from: None,
        effective_to: None,
        rounding_mode: Some("truncate".into()),
    };
    let response = update_tax_rate(
        State(app_state.clone()),
        HeaderMap::new(),
        Extension(claims(None)),
        axum::extract::Path(id),
        Json(update),
    )
    .await
    .into_response();
    assert_eq!(response.status(), StatusCode::OK);

    let db = app_state.db.lock().await;
    let (mode, rate_bps): (String, i64) = db
        .query_row(
            "SELECT rounding_mode, rate_bps FROM tax_rates WHERE name = 'VAT 10%' AND is_active = 1",
            [],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
        )
        .unwrap();
    assert_eq!(mode, "truncate");
    assert_eq!(rate_bps, 1100, "update rewrote the row in place");
}
