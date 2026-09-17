use super::*;
use crate::DEFAULT_CORS_ORIGINS;
use axum::body::to_bytes;
use axum::extract::Path;
use axum::http::StatusCode;
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

fn create(from: &str, to: &str, rate: i64, date: Option<&str>) -> CreateExchangeRateRequest {
    CreateExchangeRateRequest {
        from_currency: from.into(),
        to_currency: to.into(),
        rate_millionths: rate,
        source: "e2e".into(),
        effective_date: date.map(|s| s.to_owned()),
    }
}

/// Non-terminal admin claims — passes the admin-write gate (dev mode,
/// no admin key configured).
fn admin_claims() -> Extension<ApiTokenClaims> {
    Extension(ApiTokenClaims {
        sub: "admin-test".into(),
        jti: "jti-admin".into(),
        exp: 9999999999,
        iat: 1000000000,
        tenant_id: Some("tenant-a".into()),
        terminal_id: None,
        permissions: None,
    })
}

fn empty_headers() -> HeaderMap {
    HeaderMap::new()
}

async fn json_body(resp: Response) -> serde_json::Value {
    let bytes = to_bytes(resp.into_body(), 16 * 1024).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

/// The migrations seed only USD and IDR; `exchange_rates` has FKs on
/// `currencies(code)` (both engines), so pair tests that use other ISO
/// codes must seed them first — mirroring the cloud's currency catalog.
async fn seed_currency(s: &AppState, code: &str, numeric: &str, name: &str) {
    let db = s.db.lock().await;
    let tx = db.unchecked_transaction().unwrap();
    tx.execute(
        "INSERT OR IGNORE INTO currencies (code, numeric_code, name, minor_exponent, symbol)
         VALUES (?1, ?2, ?3, 2, '$')",
        rusqlite::params![code, numeric, name],
    )
    .unwrap();
    tx.commit().unwrap();
}

// ── Happy path (SQLite fallback — the cloud's no-PG mode) ───────────

#[tokio::test]
async fn create_list_latest_delete_roundtrip() {
    let s = state();
    let resp = create_rate(
        State(s.clone()),
        empty_headers(),
        admin_claims(),
        Json(create("USD", "IDR", 16_000_000, Some("2026-08-01"))),
    )
    .await
    .into_response();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let created = json_body(resp).await;
    assert_eq!(created["from_currency"], "USD");
    assert_eq!(created["rate_millionths"], 16_000_000);
    let id = created["id"].as_str().unwrap().to_owned();

    let resp = list_rates(State(s.clone())).await.into_response();
    assert_eq!(resp.status(), StatusCode::OK);
    let rows = json_body(resp).await;
    assert_eq!(rows.as_array().unwrap().len(), 1);

    // CUR-11 bounded listing: two history rows, one per-pair row.
    let _ = create_rate(
        State(s.clone()),
        empty_headers(),
        admin_claims(),
        Json(create("USD", "IDR", 16_500_000, Some("2026-08-15"))),
    )
    .await
    .into_response();
    let resp = list_latest_rates(State(s.clone())).await.into_response();
    assert_eq!(resp.status(), StatusCode::OK);
    let latest = json_body(resp).await;
    let arr = latest.as_array().unwrap();
    assert_eq!(arr.len(), 1, "one row per pair");
    assert_eq!(
        arr[0]["rate_millionths"], 16_500_000,
        "newest effective_date"
    );

    let resp = latest_rate(State(s.clone()), Path(("USD".into(), "IDR".into())))
        .await
        .into_response();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(json_body(resp).await["effective_date"], "2026-08-15");

    let resp = delete_rate(State(s.clone()), empty_headers(), admin_claims(), Path(id))
        .await
        .into_response();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);
    let resp = list_rates(State(s.clone())).await.into_response();
    let rows = json_body(resp).await;
    let arr = rows.as_array().unwrap();
    assert_eq!(arr.len(), 1, "only the second history row remains");
    assert_eq!(arr[0]["rate_millionths"], 16_500_000);
    let id2 = arr[0]["id"].as_str().unwrap().to_owned();
    let resp = delete_rate(State(s.clone()), empty_headers(), admin_claims(), Path(id2))
        .await
        .into_response();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);
    let resp = list_rates(State(s.clone())).await.into_response();
    assert!(json_body(resp).await.as_array().unwrap().is_empty());
}

#[tokio::test]
async fn latest_rate_path_is_case_insensitive() {
    let s = state();
    seed_currency(&s, "EUR", "978", "Euro").await;
    let _ = create_rate(
        State(s.clone()),
        empty_headers(),
        admin_claims(),
        Json(create("USD", "EUR", 920_000, Some("2026-08-01"))),
    )
    .await
    .into_response();
    let resp = latest_rate(State(s.clone()), Path(("usd".into(), "eur".into())))
        .await
        .into_response();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(json_body(resp).await["to_currency"], "EUR");
}

#[tokio::test]
async fn latest_rate_created_lowercase_is_visible_to_uppercase_lookup() {
    let s = state();
    seed_currency(&s, "EUR", "978", "Euro").await;
    // M1 regression: uppercase-normalization of the write site. Creating a
    // rate with lowercase codes must NOT store raw lowercase, or the pair
    // becomes invisible to the (uppercase) GET /latest lookup.
    let _ = create_rate(
        State(s.clone()),
        empty_headers(),
        admin_claims(),
        Json(create("usd", "eur", 920_000, Some("2026-08-01"))),
    )
    .await
    .into_response();
    let resp = latest_rate(State(s.clone()), Path(("USD".into(), "EUR".into())))
        .await
        .into_response();
    assert_eq!(resp.status(), StatusCode::OK);
    let json = json_body(resp).await;
    assert_eq!(json["from_currency"], "USD");
    assert_eq!(json["to_currency"], "EUR");
}

#[tokio::test]
async fn latest_rate_unknown_pair_is_404() {
    // EUR→JPY: both valid ISO codes, but no seeded rate — the 404 path
    // (not the 400 validation path).
    let resp = latest_rate(State(state()), Path(("EUR".into(), "JPY".into())))
        .await
        .into_response();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

// ── Validation (CUR-05 parity with the IPC command layer) ───────────

#[tokio::test]
async fn create_rejects_non_positive_rate() {
    let resp = create_rate(
        State(state()),
        empty_headers(),
        admin_claims(),
        Json(create("USD", "IDR", 0, None)),
    )
    .await
    .into_response();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_rejects_same_currency_pair() {
    let resp = create_rate(
        State(state()),
        empty_headers(),
        admin_claims(),
        Json(create("USD", "USD", 1_000_000, None)),
    )
    .await
    .into_response();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_rejects_non_iso_codes() {
    let resp = create_rate(
        State(state()),
        empty_headers(),
        admin_claims(),
        Json(create("US", "IDR", 1_000_000, None)),
    )
    .await
    .into_response();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let resp = create_rate(
        State(state()),
        empty_headers(),
        admin_claims(),
        Json(create("DOLLAR", "IDR", 1_000_000, None)),
    )
    .await
    .into_response();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_rejects_malformed_effective_date() {
    // "2026-8-1" is NOT rejected: the command layer's chrono %Y-%m-%d
    // parser accepts non-zero-padded dates, and REST mirrors it.
    let resp = create_rate(
        State(state()),
        empty_headers(),
        admin_claims(),
        Json(create("USD", "IDR", 1_000_000, Some("not-a-date"))),
    )
    .await
    .into_response();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let resp = create_rate(
        State(state()),
        empty_headers(),
        admin_claims(),
        Json(create("USD", "IDR", 1_000_000, Some("2026-13-01"))),
    )
    .await
    .into_response();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_defaults_effective_date_to_today_and_source_to_manual() {
    let mut req = create("USD", "IDR", 149_000_000, None);
    req.source = String::new();
    let resp = create_rate(State(state()), empty_headers(), admin_claims(), Json(req))
        .await
        .into_response();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let created = json_body(resp).await;
    // Today (UTC) as YYYY-MM-DD — shape pin, not an exact clock pin.
    let date = created["effective_date"].as_str().unwrap();
    assert_eq!(date.len(), 10);
    assert_eq!(&date[4..5], "-");
    assert_eq!(created["source"], "manual");
}

#[tokio::test]
async fn create_duplicate_pair_date_is_409() {
    let s = state();
    seed_currency(&s, "SGD", "702", "Singapore Dollar").await;
    let _ = create_rate(
        State(s.clone()),
        empty_headers(),
        admin_claims(),
        Json(create("USD", "SGD", 1_300_000, Some("2026-08-01"))),
    )
    .await
    .into_response();
    let resp = create_rate(
        State(s),
        empty_headers(),
        admin_claims(),
        Json(create("USD", "SGD", 1_350_000, Some("2026-08-01"))),
    )
    .await
    .into_response();
    assert_eq!(resp.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn delete_unknown_id_is_404() {
    let resp = delete_rate(
        State(state()),
        empty_headers(),
        admin_claims(),
        Path("no-such-id".into()),
    )
    .await
    .into_response();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

// ── Request deserialization ──────────────────────────────────────────

#[test]
fn create_request_minimal_json_parses() {
    let json = r#"{"from_currency":"USD","to_currency":"IDR","rate_millionths":16000000}"#;
    let req: CreateExchangeRateRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.from_currency, "USD");
    assert_eq!(req.rate_millionths, 16_000_000);
    assert!(req.source.is_empty());
    assert!(req.effective_date.is_none());
}
