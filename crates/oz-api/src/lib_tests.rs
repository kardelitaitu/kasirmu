use super::*;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

/// Helper: open an in-memory connection with all migrations pre-applied.
fn fresh_conn() -> Connection {
    oz_core::migrations::fresh_db()
}

/// Helper: build a router backed by an empty in-memory database.
fn test_app() -> Router {
    let state = AppState::test(fresh_conn());
    router(state)
}

/// Helper: build a router with an operator admin key configured (D1
/// residual — master-data writes require `X-Admin-Key` when set).
fn test_app_with_admin_key() -> Router {
    let mut state = AppState::test(fresh_conn());
    state.admin_key = Some("operator-key".into());
    router(state)
}

/// Helper: build a router with seeded products, categories, and inventory.
fn test_app_seeded() -> Router {
    let conn = fresh_conn();
    conn.execute_batch(
        "INSERT INTO categories (id, name, colour) VALUES
            ('cat-drinks', 'Drinks',  '#06b6d4'),
            ('cat-food',   'Food',    '#f97316');
         INSERT INTO products (id, sku, name, price_minor, currency, category_id) VALUES
            ('prod-1', 'DRINK-001', 'Espresso',        350, 'USD', 'cat-drinks'),
            ('prod-2', 'FOOD-001',  'Bagel',           450, 'USD', 'cat-food'),
            ('prod-3', 'DRINK-002', 'Green Tea',       275, 'USD', 'cat-drinks');
         INSERT INTO inventory (product_id, qty) VALUES
            ('prod-1', 50),
            ('prod-2', 12);",
    )
    .unwrap();
    let state = AppState {
        db: Arc::new(Mutex::new(conn)),
        pg: None,
        admin_key: None,
        api_secret: String::new(),
        allow_terminal_credentials: true,
        db_path: ":memory:".into(),
        port: 3099,
        cors_origins: DEFAULT_CORS_ORIGINS.iter().map(|s| s.to_string()).collect(),
        image_dir: std::path::PathBuf::from("./data/images"),
    };
    router(state)
}

// ── Helpers ───────────────────────────────────────────────────

async fn body_json(resp: axum::response::Response) -> Value {
    let bytes = resp
        .into_body()
        .collect()
        .await
        .expect("collect body")
        .to_bytes();
    serde_json::from_slice(&bytes).expect("parse JSON body")
}

fn auth_get(uri: &str, token: &str) -> Request<Body> {
    Request::builder()
        .uri(uri)
        .header("Authorization", format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap()
}

fn post_json(uri: &str, body: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header("Content-Type", "application/json")
        .body(Body::from(body.to_owned()))
        .unwrap()
}

// ── Health endpoint ──────────────────────────────────────────

#[tokio::test]
async fn health_returns_ok() {
    let req = Request::builder()
        .uri("/api/v1/health")
        .body(Body::empty())
        .unwrap();
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn health_returns_json_with_status_and_version() {
    let req = Request::builder()
        .uri("/api/v1/health")
        .body(Body::empty())
        .unwrap();
    let resp = test_app().oneshot(req).await.unwrap();
    let json = body_json(resp).await;
    assert_eq!(json["status"], "ok");
    assert!(json["version"].is_string(), "version should be a string");
}

// ── Token endpoint ───────────────────────────────────────────

#[tokio::test]
async fn token_creation_returns_200() {
    let req = post_json("/api/v1/tokens", r#"{"label":"test","expiry_hours":1}"#);
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn token_creation_returns_token_fields() {
    let req = post_json(
        "/api/v1/tokens",
        r#"{"label":"my-script","expiry_hours":8}"#,
    );
    let resp = test_app().oneshot(req).await.unwrap();
    let json = body_json(resp).await;
    let token = &json["token"];
    assert!(token["token"].is_string(), "token field should be a string");
    assert!(
        token["expires_at"].is_string(),
        "expires_at should be a string"
    );
    assert!(token["token_id"].is_string(), "token_id should be a string");
}

#[tokio::test]
async fn token_creation_with_default_expiry() {
    let req = post_json("/api/v1/tokens", r#"{"label":"no-expiry"}"#);
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    assert!(json["token"]["token"].is_string());
}

#[tokio::test]
async fn token_creation_missing_label_returns_error() {
    let req = post_json("/api/v1/tokens", r#"{}"#);
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn token_creation_invalid_json() {
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/tokens")
        .header("Content-Type", "application/json")
        .body(Body::from("not json"))
        .unwrap();
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn token_creation_wrong_method_get() {
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/tokens")
        .body(Body::empty())
        .unwrap();
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::METHOD_NOT_ALLOWED);
}

#[tokio::test]
async fn token_creation_empty_body() {
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/tokens")
        .header("Content-Type", "application/json")
        .body(Body::empty())
        .unwrap();
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn token_creation_wrong_content_type() {
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/tokens")
        .header("Content-Type", "text/plain")
        .body(Body::from(r#"{"label":"test"}"#))
        .unwrap();
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
}

#[tokio::test]
async fn two_tokens_have_different_values() {
    let app = test_app();
    let req1 = post_json("/api/v1/tokens", r#"{"label":"a"}"#);
    let req2 = post_json("/api/v1/tokens", r#"{"label":"b"}"#);
    let json1 = body_json(app.clone().oneshot(req1).await.unwrap()).await;
    let json2 = body_json(app.oneshot(req2).await.unwrap()).await;
    assert_ne!(
        json1["token"]["token"].as_str(),
        json2["token"]["token"].as_str(),
        "two tokens should have different JWT strings"
    );
    assert_ne!(
        json1["token"]["token_id"].as_str(),
        json2["token"]["token_id"].as_str(),
        "two tokens should have different IDs"
    );
}

// ── Auth middleware ───────────────────────────────────────────

#[tokio::test]
async fn protected_route_rejects_without_token() {
    let req = Request::builder()
        .uri("/api/v1/products")
        .body(Body::empty())
        .unwrap();
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn protected_route_accepts_valid_token() {
    let token = auth::create_token("test", Some(1), None, None).unwrap();
    let req = auth_get("/api/v1/products", &token.token);
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn protected_route_rejects_expired_token() {
    let token = auth::create_token("expired", Some(-1), None, None).unwrap();
    let req = auth_get("/api/v1/products", &token.token);
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn protected_route_rejects_malformed_header() {
    let req = Request::builder()
        .uri("/api/v1/products")
        .header("Authorization", "NotBearer xyz")
        .body(Body::empty())
        .unwrap();
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn protected_route_rejects_empty_auth_header() {
    let req = Request::builder()
        .uri("/api/v1/products")
        .header("Authorization", "")
        .body(Body::empty())
        .unwrap();
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn protected_route_rejects_garbage_token() {
    let req = auth_get("/api/v1/products", "not.a.real.jwt");
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn protected_route_rejects_tampered_token() {
    let token = auth::create_token("tamper", Some(24), None, None).unwrap();
    let req = auth_get("/api/v1/products", &format!("{}x", token.token));
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

// ── Structured 401 bodies (ADR sync-auth-hardening P4) ────────

#[tokio::test]
async fn missing_token_reports_missing_token_body() {
    let req = Request::builder()
        .uri("/api/v1/products")
        .body(Body::empty())
        .unwrap();
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let json = body_json(resp).await;
    assert_eq!(
        json["error"], "missing_token",
        "no header must report missing_token, not token_expired"
    );
}

#[tokio::test]
async fn expired_token_reports_token_expired_body() {
    let token = auth::create_token("expired", Some(-1), None, None).unwrap();
    let req = auth_get("/api/v1/products", &token.token);
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let json = body_json(resp).await;
    assert_eq!(
        json["error"], "token_expired",
        "an expired signature must report token_expired so the client refreshes"
    );
}

#[tokio::test]
async fn garbage_token_reports_invalid_token_body() {
    let req = auth_get("/api/v1/products", "not.a.real.jwt");
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let json = body_json(resp).await;
    assert_eq!(
        json["error"], "invalid_token",
        "a malformed token must NOT report token_expired"
    );
}

#[tokio::test]
async fn tampered_token_reports_invalid_token_body() {
    let token = auth::create_token("tamper", Some(24), None, None).unwrap();
    let req = auth_get("/api/v1/products", &format!("{}x", token.token));
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let json = body_json(resp).await;
    assert_eq!(
        json["error"], "invalid_token",
        "a tampered signature must NOT report token_expired"
    );
}

#[tokio::test]
async fn expired_token_response_carries_www_authenticate() {
    let token = auth::create_token("expired", Some(-1), None, None).unwrap();
    let req = auth_get("/api/v1/products", &token.token);
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(
        resp.headers().get(axum::http::header::WWW_AUTHENTICATE),
        Some(&axum::http::HeaderValue::from_static("Bearer")),
        "P4 responses must advertise Bearer auth"
    );
}

// ── Product endpoints (empty DB) ─────────────────────────────

#[tokio::test]
async fn products_list_returns_empty_array() {
    let token = auth::create_token("test", Some(1), None, None).unwrap();
    let req = auth_get("/api/v1/products", &token.token);
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    // Spec 0046b §3.4: the snapshot is wrapped with the missing_hashes nudge.
    assert!(
        json["products"].is_array(),
        "should return a products array"
    );
    assert_eq!(
        json["products"].as_array().unwrap().len(),
        0,
        "should be empty"
    );
    assert!(json["missing_hashes"].is_null() || json["missing_hashes"].is_array());
}

#[tokio::test]
async fn product_get_by_sku_requires_auth() {
    let req = Request::builder()
        .uri("/api/v1/products/ABC123")
        .body(Body::empty())
        .unwrap();
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn product_get_by_sku_returns_null_for_unknown() {
    let token = auth::create_token("test", Some(1), None, None).unwrap();
    let req = auth_get("/api/v1/products/ABC123", &token.token);
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    assert!(json.is_null(), "should return null for unknown SKU");
}

// ── Product endpoints (seeded DB) ────────────────────────────

#[tokio::test]
async fn products_list_returns_seeded_products() {
    let token = auth::create_token("test", Some(1), None, None).unwrap();
    let req = auth_get("/api/v1/products", &token.token);
    let resp = test_app_seeded().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    let arr = json["products"].as_array().unwrap();
    assert_eq!(arr.len(), 3, "should return 3 seeded products");
    assert!(json["missing_hashes"].is_null() || json["missing_hashes"].is_array());
}

#[tokio::test]
async fn product_get_by_sku_returns_detail_with_stock() {
    let token = auth::create_token("test", Some(1), None, None).unwrap();
    let req = auth_get("/api/v1/products/DRINK-001", &token.token);
    let resp = test_app_seeded().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    assert_eq!(json["sku"], "DRINK-001");
    assert_eq!(json["name"], "Espresso");
    assert_eq!(json["price"]["minor_units"], 350);
    assert_eq!(json["price"]["currency"], "USD");
    assert_eq!(json["category_id"], "cat-drinks");
    assert_eq!(json["category_name"], "Drinks");
    assert_eq!(json["stock_qty"], 50);
    // New fields from the Product domain type.
    assert_eq!(json["id"], "prod-1");
    assert!(json["barcode"].is_null());
    assert!(json["created_at"].is_string());
    assert!(json["updated_at"].is_string());
}

#[tokio::test]
async fn product_get_by_sku_returns_null_for_existing_but_unstocked() {
    let token = auth::create_token("test", Some(1), None, None).unwrap();
    // DRINK-002 exists but has no inventory row.
    let req = auth_get("/api/v1/products/DRINK-002", &token.token);
    let resp = test_app_seeded().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    assert_eq!(json["sku"], "DRINK-002");
    assert_eq!(json["name"], "Green Tea");
    assert_eq!(json["price"]["minor_units"], 275);
    assert!(json["stock_qty"].is_null(), "no inventory row → null stock");
}

// ── Product creation endpoint ───────────────────────────────

fn auth_post_json(uri: &str, token: &str, body: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .body(Body::from(body.to_owned()))
        .unwrap()
}

#[tokio::test]
async fn create_product_returns_201() {
    let token = auth::create_token("test", Some(1), None, None).unwrap();
    let body =
        r#"{"sku":"NEW-001","name":"New Item","price":{"minor_units":199,"currency":"USD"}}"#;
    let req = auth_post_json("/api/v1/products", &token.token, body);
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
}

#[tokio::test]
async fn create_product_returns_fields() {
    let token = auth::create_token("test", Some(1), None, None).unwrap();
    let body = r#"{"sku":"NEW-002","name":"Widget","price":{"minor_units":499,"currency":"USD"},"category_id":"cat-drinks","barcode":"5901234123457"}"#;
    let req = auth_post_json("/api/v1/products", &token.token, body);
    let resp = test_app_seeded().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let json = body_json(resp).await;
    assert_eq!(json["sku"], "NEW-002");
    assert_eq!(json["name"], "Widget");
    assert_eq!(json["price"]["minor_units"], 499);
    assert_eq!(json["price"]["currency"], "USD");
    assert_eq!(json["category_id"], "cat-drinks");
    assert_eq!(json["barcode"], "5901234123457");
    assert!(json["id"].is_string());
    assert!(json["created_at"].is_string());
    assert!(json["updated_at"].is_string());
}

#[tokio::test]
async fn create_product_with_initial_stock() {
    let token = auth::create_token("test", Some(1), None, None).unwrap();
    let body = r#"{"sku":"STOCKED-1","name":"Stocked","price":{"minor_units":100,"currency":"USD"},"initial_stock":25}"#;
    let req = auth_post_json("/api/v1/products", &token.token, body);
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let json = body_json(resp).await;
    assert_eq!(json["stock_qty"], 25);
}

#[tokio::test]
async fn create_product_with_zero_stock_no_inventory_row() {
    let token = auth::create_token("test", Some(1), None, None).unwrap();
    let body = r#"{"sku":"NOSTOCK-1","name":"NoStock","price":{"minor_units":100,"currency":"USD"},"initial_stock":0}"#;
    let req = auth_post_json("/api/v1/products", &token.token, body);
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let json = body_json(resp).await;
    assert!(json["stock_qty"].is_null(), "zero stock → no inventory row");
}

#[tokio::test]
async fn create_product_duplicate_sku_returns_409() {
    let token = auth::create_token("test", Some(1), None, None).unwrap();
    let body =
        r#"{"sku":"DRINK-001","name":"Duplicate","price":{"minor_units":100,"currency":"USD"}}"#;
    let req = auth_post_json("/api/v1/products", &token.token, body);
    let resp = test_app_seeded().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn create_product_requires_auth() {
    let body = r#"{"sku":"NEW-001","name":"New","price":{"minor_units":100,"currency":"USD"}}"#;
    let req = post_json("/api/v1/products", body);
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn create_product_empty_sku_returns_400() {
    let token = auth::create_token("test", Some(1), None, None).unwrap();
    let body = r#"{"sku":"   ","name":"Bad","price":{"minor_units":100,"currency":"USD"}}"#;
    let req = auth_post_json("/api/v1/products", &token.token, body);
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_product_empty_name_returns_400() {
    let token = auth::create_token("test", Some(1), None, None).unwrap();
    let body = r#"{"sku":"SKU-OK","name":"","price":{"minor_units":100,"currency":"USD"}}"#;
    let req = auth_post_json("/api/v1/products", &token.token, body);
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_product_negative_price_returns_400() {
    let token = auth::create_token("test", Some(1), None, None).unwrap();
    let body = r#"{"sku":"SKU-OK","name":"Bad Price","price":{"minor_units":-1,"currency":"USD"}}"#;
    let req = auth_post_json("/api/v1/products", &token.token, body);
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_product_negative_initial_stock_returns_400() {
    let token = auth::create_token("test", Some(1), None, None).unwrap();
    let body = r#"{"sku":"SKU-OK","name":"Bad Stock","price":{"minor_units":100,"currency":"USD"},"initial_stock":-5}"#;
    let req = auth_post_json("/api/v1/products", &token.token, body);
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

// ── Stock adjustment endpoint ───────────────────────────────

fn auth_patch_json(uri: &str, token: &str, body: &str) -> Request<Body> {
    Request::builder()
        .method("PATCH")
        .uri(uri)
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .body(Body::from(body.to_owned()))
        .unwrap()
}

#[tokio::test]
async fn patch_stock_sell_reduces_qty() {
    let token = auth::create_token("test", Some(1), None, None).unwrap();
    let body = r#"{"delta":-10}"#;
    let req = auth_patch_json("/api/v1/products/DRINK-001/stock", &token.token, body);
    let resp = test_app_seeded().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    assert_eq!(json["sku"], "DRINK-001");
    assert_eq!(json["previous_qty"], 50);
    assert_eq!(json["new_qty"], 40);
}

#[tokio::test]
async fn patch_stock_restock_increases_qty() {
    let token = auth::create_token("test", Some(1), None, None).unwrap();
    let body = r#"{"delta":25}"#;
    let req = auth_patch_json("/api/v1/products/DRINK-001/stock", &token.token, body);
    let resp = test_app_seeded().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    assert_eq!(json["previous_qty"], 50);
    assert_eq!(json["new_qty"], 75);
}

#[tokio::test]
async fn patch_stock_oversell_returns_422() {
    let token = auth::create_token("test", Some(1), None, None).unwrap();
    let body = r#"{"delta":-100}"#;
    let req = auth_patch_json("/api/v1/products/DRINK-001/stock", &token.token, body);
    let resp = test_app_seeded().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn patch_stock_unknown_product_returns_404() {
    let token = auth::create_token("test", Some(1), None, None).unwrap();
    let body = r#"{"delta":10}"#;
    let req = auth_patch_json("/api/v1/products/NOPE-999/stock", &token.token, body);
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn patch_stock_no_inventory_row_treats_as_zero() {
    let token = auth::create_token("test", Some(1), None, None).unwrap();
    // DRINK-002 exists but has no inventory row.
    let body = r#"{"delta":30}"#;
    let req = auth_patch_json("/api/v1/products/DRINK-002/stock", &token.token, body);
    let resp = test_app_seeded().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    assert_eq!(json["previous_qty"], 0);
    assert_eq!(json["new_qty"], 30);
}

#[tokio::test]
async fn patch_stock_requires_auth() {
    let body = r#"{"delta":10}"#;
    let req = Request::builder()
        .method("PATCH")
        .uri("/api/v1/products/DRINK-001/stock")
        .header("Content-Type", "application/json")
        .body(Body::from(body.to_owned()))
        .unwrap();
    let resp = test_app_seeded().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

// ── Tax rate creation endpoint ──────────────────────────────

#[tokio::test]
async fn create_tax_rate_returns_201() {
    let token = auth::create_token("test", Some(1), None, None).unwrap();
    let body = r#"{"name":"VAT 10%","rate_bps":1000,"is_default":true,"is_inclusive":false}"#;
    let req = auth_post_json("/api/v1/tax-rates", &token.token, body);
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
}

#[tokio::test]
async fn create_tax_rate_returns_fields() {
    let token = auth::create_token("test", Some(1), None, None).unwrap();
    let body = r#"{"name":"GST 5%","rate_bps":500,"is_default":false,"is_inclusive":true}"#;
    let req = auth_post_json("/api/v1/tax-rates", &token.token, body);
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let json = body_json(resp).await;
    assert_eq!(json["name"], "GST 5%");
    assert_eq!(json["rate_bps"], 500);
    assert_eq!(json["is_default"], false);
    assert_eq!(json["is_inclusive"], true);
    assert!(json["id"].is_string());
    assert!(json["created_at"].is_string());
}

#[tokio::test]
async fn create_tax_rate_requires_auth() {
    let body = r#"{"name":"Tax","rate_bps":100,"is_default":false,"is_inclusive":false}"#;
    let req = post_json("/api/v1/tax-rates", body);
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

// ── User creation endpoint ───────────────────────────────────

/// Helper: build a router with seeded roles (required for user creation).
fn test_app_with_roles() -> Router {
    let conn = fresh_conn();
    oz_core::db::Store::new(&conn).seed_default_roles().unwrap();
    let state = AppState {
        db: Arc::new(Mutex::new(conn)),
        pg: None,
        admin_key: None,
        api_secret: String::new(),
        allow_terminal_credentials: true,
        db_path: ":memory:".into(),
        port: 3099,
        cors_origins: DEFAULT_CORS_ORIGINS.iter().map(|s| s.to_string()).collect(),
        image_dir: std::path::PathBuf::from("./data/images"),
    };
    router(state)
}

#[tokio::test]
async fn create_user_returns_201() {
    let token = auth::create_token("test", Some(1), None, None).unwrap();
    let body = r#"{"username":"newstaff","pin_hash":"abc123","display_name":"New Staff","role_id":"role-staff"}"#;
    let req = auth_post_json("/api/v1/users", &token.token, body);
    let resp = test_app_with_roles().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
}

#[tokio::test]
async fn create_user_returns_fields() {
    let token = auth::create_token("test", Some(1), None, None).unwrap();
    let body = r#"{"username":"staff-user","pin_hash":"hash456","display_name":"Staff User","role_id":"role-owner"}"#;
    let req = auth_post_json("/api/v1/users", &token.token, body);
    let resp = test_app_with_roles().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let json = body_json(resp).await;
    assert_eq!(json["username"], "staff-user");
    assert_eq!(json["display_name"], "Staff User");
    assert_eq!(json["role_id"], "role-owner");
    assert_eq!(json["is_active"], true);
    assert!(json["id"].is_string());
    assert!(json["created_at"].is_string());
}

#[tokio::test]
async fn create_user_requires_auth() {
    let body =
        r#"{"username":"staff","pin_hash":"hash","display_name":"Staff","role_id":"role-staff"}"#;
    let req = post_json("/api/v1/users", body);
    let resp = test_app_with_roles().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

// ── Category endpoints ───────────────────────────────────────

#[tokio::test]
async fn categories_list_requires_auth() {
    let req = Request::builder()
        .uri("/api/v1/categories")
        .body(Body::empty())
        .unwrap();
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn categories_list_returns_empty_array() {
    let token = auth::create_token("test", Some(1), None, None).unwrap();
    let req = auth_get("/api/v1/categories", &token.token);
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    assert!(json.is_array(), "should return a JSON array");
    assert_eq!(json.as_array().unwrap().len(), 0, "should be empty");
}

#[tokio::test]
async fn categories_list_returns_seeded_categories() {
    let token = auth::create_token("test", Some(1), None, None).unwrap();
    let req = auth_get("/api/v1/categories", &token.token);
    let resp = test_app_seeded().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    let arr = json.as_array().unwrap();
    assert_eq!(arr.len(), 2, "should return 2 seeded categories");
    assert_eq!(arr[0]["name"], "Drinks");
    assert_eq!(arr[0]["colour"], "#06b6d4");
    assert_eq!(arr[1]["name"], "Food");
    assert_eq!(arr[1]["colour"], "#f97316");
}

// ── Sale endpoints ───────────────────────────────────────────

#[tokio::test]
async fn create_sale_returns_201() {
    let token = auth::create_token("test", Some(1), None, None).unwrap();
    let body = r#"{
        "lines": [
            {"sku": "COFFEE", "qty": 2, "unit_price": {"minor_units": 350, "currency": "USD"}}
        ]
    }"#;
    let req = auth_post_json("/api/v1/sales", &token.token, body);
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let json = body_json(resp).await;
    assert_eq!(json["status"], "pending");
    assert_eq!(json["line_count"], 1);
    assert_eq!(json["total"]["minor_units"], 700);
    assert!(json["id"].is_string());
    assert!(json["lines"].is_array());
    assert_eq!(json["lines"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn create_sale_multi_line() {
    let token = auth::create_token("test", Some(1), None, None).unwrap();
    let body = r#"{
        "lines": [
            {"sku": "COFFEE", "qty": 2, "unit_price": {"minor_units": 350, "currency": "USD"}},
            {"sku": "BAGEL",  "qty": 1, "unit_price": {"minor_units": 450, "currency": "USD"}}
        ]
    }"#;
    let req = auth_post_json("/api/v1/sales", &token.token, body);
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let json = body_json(resp).await;
    assert_eq!(json["line_count"], 2);
    assert_eq!(json["total"]["minor_units"], 1150);
    let lines = json["lines"].as_array().unwrap();
    assert_eq!(lines[0]["line_position"], 1);
    assert_eq!(lines[1]["line_position"], 2);
    assert_eq!(lines[0]["sku"], "COFFEE");
    assert_eq!(lines[1]["sku"], "BAGEL");
}

#[tokio::test]
async fn create_sale_empty_lines_rejected() {
    let token = auth::create_token("test", Some(1), None, None).unwrap();
    let body = r#"{"lines": []}"#;
    let req = auth_post_json("/api/v1/sales", &token.token, body);
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn create_sale_requires_auth() {
    let body =
        r#"{"lines": [{"sku":"X","qty":1,"unit_price":{"minor_units":100,"currency":"USD"}}]}"#;
    let req = post_json("/api/v1/sales", body);
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn get_sale_returns_detail() {
    let token = auth::create_token("test", Some(1), None, None).unwrap();
    // Create a sale first.
    let create_body = r#"{
        "lines": [
            {"sku": "COFFEE", "qty": 2, "unit_price": {"minor_units": 350, "currency": "USD"}}
        ]
    }"#;
    let app = test_app();
    let create_req = auth_post_json("/api/v1/sales", &token.token, create_body);
    let create_resp = app.clone().oneshot(create_req).await.unwrap();
    let create_json = body_json(create_resp).await;
    let sale_id = create_json["id"].as_str().unwrap().to_string();

    // Fetch the sale.
    let get_req = auth_get(&format!("/api/v1/sales/{sale_id}"), &token.token);
    let get_resp = app.oneshot(get_req).await.unwrap();
    assert_eq!(get_resp.status(), StatusCode::OK);
    let json = body_json(get_resp).await;
    assert_eq!(json["id"], sale_id);
    assert_eq!(json["status"], "pending");
    assert_eq!(json["line_count"], 1);
}

#[tokio::test]
async fn get_sale_not_found_returns_null() {
    let token = auth::create_token("test", Some(1), None, None).unwrap();
    let req = auth_get("/api/v1/sales/nonexistent-id", &token.token);
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    assert!(json.is_null());
}

#[tokio::test]
async fn get_sale_requires_auth() {
    let req = Request::builder()
        .uri("/api/v1/sales/some-id")
        .body(Body::empty())
        .unwrap();
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn update_sale_status_pending_to_active() {
    let token = auth::create_token("test", Some(1), None, None).unwrap();
    let app = test_app();

    // Create a sale.
    let create_body = r#"{
        "lines": [{"sku": "TEA", "qty": 1, "unit_price": {"minor_units": 200, "currency": "USD"}}]
    }"#;
    let create_req = auth_post_json("/api/v1/sales", &token.token, create_body);
    let create_resp = app.clone().oneshot(create_req).await.unwrap();
    let sale_id = body_json(create_resp).await["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Transition to active.
    let patch_body = r#"{"status": "active"}"#;
    let patch_req = auth_patch_json(
        &format!("/api/v1/sales/{sale_id}/status"),
        &token.token,
        patch_body,
    );
    let patch_resp = app.clone().oneshot(patch_req).await.unwrap();
    assert_eq!(patch_resp.status(), StatusCode::OK);
    let json = body_json(patch_resp).await;
    assert_eq!(json["status"], "active");
    assert!(json["updated_at"].is_string());
}

#[tokio::test]
async fn update_sale_status_full_flow() {
    let token = auth::create_token("test", Some(1), None, None).unwrap();
    let app = test_app();

    let create_body = r#"{
        "lines": [{"sku": "A", "qty": 1, "unit_price": {"minor_units": 100, "currency": "USD"}}]
    }"#;
    let create_req = auth_post_json("/api/v1/sales", &token.token, create_body);
    let create_resp = app.clone().oneshot(create_req).await.unwrap();
    let sale_id = body_json(create_resp).await["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Active -> Completed.
    let r1 = auth_patch_json(
        &format!("/api/v1/sales/{sale_id}/status"),
        &token.token,
        r#"{"status": "active"}"#,
    );
    let resp1 = app.clone().oneshot(r1).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::OK);

    let r2 = auth_patch_json(
        &format!("/api/v1/sales/{sale_id}/status"),
        &token.token,
        r#"{"status": "completed"}"#,
    );
    let resp2 = app.clone().oneshot(r2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::OK);
    assert_eq!(body_json(resp2).await["status"], "completed");
}

#[tokio::test]
async fn update_sale_status_invalid_transition_returns_422() {
    let token = auth::create_token("test", Some(1), None, None).unwrap();
    let app = test_app();

    let create_body = r#"{
        "lines": [{"sku": "B", "qty": 1, "unit_price": {"minor_units": 100, "currency": "USD"}}]
    }"#;
    let create_req = auth_post_json("/api/v1/sales", &token.token, create_body);
    let create_resp = app.clone().oneshot(create_req).await.unwrap();
    let sale_id = body_json(create_resp).await["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Pending -> Completed is invalid.
    let req = auth_patch_json(
        &format!("/api/v1/sales/{sale_id}/status"),
        &token.token,
        r#"{"status": "completed"}"#,
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn update_sale_status_not_found_returns_404() {
    let token = auth::create_token("test", Some(1), None, None).unwrap();
    let req = auth_patch_json(
        "/api/v1/sales/nope-999/status",
        &token.token,
        r#"{"status": "active"}"#,
    );
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn update_sale_status_requires_auth() {
    let req = Request::builder()
        .method("PATCH")
        .uri("/api/v1/sales/some-id/status")
        .header("Content-Type", "application/json")
        .body(Body::from(r#"{"status": "active"}"#))
        .unwrap();
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

// ── Memo serving layer (2026-09-07 cloud-read ruling) ─────────────

#[tokio::test]
async fn memo_active_read_requires_auth() {
    let req = Request::builder()
        .uri("/api/v1/memos/active?terminal_id=t1")
        .body(Body::empty())
        .unwrap();
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(
        resp.status(),
        StatusCode::UNAUTHORIZED,
        "the active read is JWT-protected — the original public-router placement would 500 here"
    );
}

#[tokio::test]
async fn memo_ack_requires_auth() {
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/memos/memo-1/ack")
        .header("Content-Type", "application/json")
        .body(Body::from(r#"{"acknowledged_by": "user-1"}"#))
        .unwrap();
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

// ── Edge cases ───────────────────────────────────────────────────────

#[tokio::test]
async fn unknown_route_returns_401() {
    let req = Request::builder()
        .uri("/api/v1/nonexistent")
        .body(Body::empty())
        .unwrap();
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn root_returns_401() {
    let req = Request::builder().uri("/").body(Body::empty()).unwrap();
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

// ── Security headers (docs/archived/2026-08-15-unify-auth-and-sync.md §11) ──

#[test]
fn security_header_hsts_only_in_production() {
    assert_eq!(security_header_value(true), Some("max-age=31536000"));
    assert_eq!(security_header_value(false), None);
}

#[tokio::test]
async fn security_headers_present_on_health() {
    let resp = test_app()
        .oneshot(
            Request::builder()
                .uri("/api/v1/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        resp.headers()["x-content-type-options"],
        "nosniff",
        "X-Content-Type-Options must prevent MIME sniffing"
    );
    assert_eq!(resp.headers()["x-frame-options"], "DENY");
    assert_eq!(
        resp.headers()["content-security-policy"],
        "default-src 'self'"
    );
    // HSTS is production-gated; the default test env is dev.
    assert!(resp.headers().get("strict-transport-security").is_none());
}

// ── CORS allowlist (docs/archived/2026-08-15-unify-auth-and-sync.md §11) ────

#[test]
fn parse_cors_origins_defaults_to_documented_allowlist() {
    assert_eq!(
        parse_cors_origins(None),
        DEFAULT_CORS_ORIGINS
            .iter()
            .map(|s| s.to_string())
            .collect::<Vec<_>>()
    );
}

#[test]
fn parse_cors_origins_parses_comma_list() {
    assert_eq!(
        parse_cors_origins(Some(" https://a.com ,https://b.com ".into())),
        vec!["https://a.com".to_string(), "https://b.com".to_string()]
    );
}

#[test]
fn parse_cors_origins_star_means_allow_all() {
    assert_eq!(parse_cors_origins(Some("*".into())), vec!["*".to_string()]);
}

#[test]
fn parse_cors_origins_blank_denies_all() {
    assert!(parse_cors_origins(Some(" ".into())).is_empty());
}

#[test]
fn parse_cors_origins_dedups_non_adjacent_preserving_order() {
    // "a,b,a" used to keep both `a`s — Vec::dedup only collapses
    // adjacent runs, despite the doc promising a de-duplicated list.
    assert_eq!(
        parse_cors_origins(Some("https://a.com,https://b.com,https://a.com".into())),
        vec!["https://a.com".to_string(), "https://b.com".to_string()],
    );
}

#[tokio::test]
async fn cors_allowed_origin_is_echoed() {
    let req = Request::builder()
        .uri("/api/v1/health")
        .header("Origin", "https://kasir.mu")
        .body(Body::empty())
        .unwrap();
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let allow_origin = resp
        .headers()
        .get("access-control-allow-origin")
        .map(|v| v.to_str().unwrap());
    assert_eq!(allow_origin, Some("https://kasir.mu"));
}

/// Windows WebView2 uses `http://tauri.localhost` as the Tauri v2
/// webview origin (macOS/Linux use `tauri://localhost`). Both must be
/// echoed so the unified cloud server's `/api/health` serves the
/// activation screen's direct webview fetch on every platform.
#[tokio::test]
async fn cors_allows_windows_webview_origin() {
    let req = Request::builder()
        .uri("/api/v1/health")
        .header("Origin", "http://tauri.localhost")
        .body(Body::empty())
        .unwrap();
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let allow_origin = resp
        .headers()
        .get("access-control-allow-origin")
        .map(|v| v.to_str().unwrap());
    assert_eq!(allow_origin, Some("http://tauri.localhost"));
}

#[tokio::test]
async fn cors_disallowed_origin_gets_no_header() {
    let req = Request::builder()
        .uri("/api/v1/health")
        .header("Origin", "http://evil.example")
        .body(Body::empty())
        .unwrap();
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK, "request still served");
    assert!(
        resp.headers().get("access-control-allow-origin").is_none(),
        "disallowed origin must not receive CORS headers"
    );
}

#[tokio::test]
async fn cors_preflight_allowed_origin_returns_allow_header() {
    let req = Request::builder()
        .method("OPTIONS")
        .uri("/api/v1/products")
        .header("Origin", "https://kasir.mu")
        .header("Access-Control-Request-Method", "GET")
        .body(Body::empty())
        .unwrap();
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(
        resp.headers()
            .get("access-control-allow-origin")
            .map(|v| v.to_str().unwrap()),
        Some("https://kasir.mu")
    );
}

#[tokio::test]
async fn cors_preflight_disallowed_origin_gets_no_allow_header() {
    let req = Request::builder()
        .method("OPTIONS")
        .uri("/api/v1/products")
        .header("Origin", "http://evil.example")
        .header("Access-Control-Request-Method", "GET")
        .body(Body::empty())
        .unwrap();
    let resp = test_app().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert!(
        resp.headers().get("access-control-allow-origin").is_none(),
        "preflight from a disallowed origin must not be authorized"
    );
}

// ── API-1: production secret gate ────────────────────────────────

#[test]
fn api1_production_requires_api_secret() {
    let err = crate::validate_production_secrets(true, None, Some("admin-key")).unwrap_err();
    assert!(err.contains("OZ_PRODUCTION=1 requires OZ_API_SECRET"));
}

#[test]
fn api1_production_rejects_empty_api_secret() {
    let err = crate::validate_production_secrets(true, Some("   "), Some("admin-key")).unwrap_err();
    assert!(err.contains("OZ_PRODUCTION=1 requires OZ_API_SECRET"));
}

#[test]
fn api1_production_requires_admin_key() {
    let err = crate::validate_production_secrets(true, Some("secret"), None).unwrap_err();
    assert!(err.contains("OZ_PRODUCTION=1 requires OZ_ADMIN_KEY"));
}

#[test]
fn api1_production_rejects_both_missing() {
    // The API-secret gate fires first; admin key is checked on the next
    // boot attempt after the operator fixes the secret.
    let err = crate::validate_production_secrets(true, None, None).unwrap_err();
    assert!(err.contains("OZ_API_SECRET"));
}

#[test]
fn api1_production_accepts_both_secrets() {
    crate::validate_production_secrets(true, Some("secret"), Some("admin-key")).unwrap();
}

#[test]
fn api1_dev_mode_allows_missing_secrets() {
    // Dev mode (no OZ_PRODUCTION) keeps the zero-config startup.
    crate::validate_production_secrets(false, None, None).unwrap();
}

#[test]
fn api1_signing_secret_fallback_is_dev_constant() {
    // The fallback constant itself is unchanged (dev zero-config startup);
    // production refusal happens at serve() before any mint/validate.
    // NOTE: signing_secret reads OZ_API_SECRET from the process env — tests
    // cannot mutate it safely in parallel, so this asserts the pure
    // fallback path via an empty provided value and empty env is NOT
    // guaranteed. Instead assert the DEV constant through provided=None
    // only when the env var is absent in the test environment.
    if std::env::var("OZ_API_SECRET").is_err() {
        let secret = crate::auth::signing_secret_for_tests();
        assert_eq!(secret, "oz-pos-dev-secret-change-in-production");
    }
}

// ── D1 residual (API-4): admin-key write tier ────────────────────────

/// POST with a JWT plus an optional `X-Admin-Key` header.
fn post_json_with_admin_key(
    uri: &str,
    token: &str,
    body: &str,
    admin_key: Option<&str>,
) -> Request<Body> {
    let mut builder = Request::builder()
        .method("POST")
        .uri(uri)
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json");
    if let Some(key) = admin_key {
        builder = builder.header("x-admin-key", key);
    }
    builder.body(Body::from(body.to_owned())).unwrap()
}

/// PATCH with a JWT plus an optional `X-Admin-Key` header.
fn patch_with_admin_key(
    uri: &str,
    token: &str,
    body: &str,
    admin_key: Option<&str>,
) -> Request<Body> {
    let mut builder = Request::builder()
        .method("PATCH")
        .uri(uri)
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json");
    if let Some(key) = admin_key {
        builder = builder.header("x-admin-key", key);
    }
    builder.body(Body::from(body.to_owned())).unwrap()
}

/// DELETE with a JWT plus an optional `X-Admin-Key` header.
fn delete_with_admin_key(uri: &str, token: &str, admin_key: Option<&str>) -> Request<Body> {
    let mut builder = Request::builder()
        .method("DELETE")
        .uri(uri)
        .header("Authorization", format!("Bearer {token}"));
    if let Some(key) = admin_key {
        builder = builder.header("x-admin-key", key);
    }
    builder.body(Body::empty()).unwrap()
}

/// Mint a terminal-scoped token (device credential — must be denied for
/// master-data writes even with a valid admin key header).
fn terminal_token() -> String {
    auth::create_token_scoped("device", Some(1), None, Some("term-1"), None)
        .unwrap()
        .token
}

#[tokio::test]
async fn write_routes_require_admin_key_when_configured() {
    let app = test_app_with_admin_key();
    let token = auth::create_token("script", Some(1), None, None).unwrap();

    let cases: Vec<(&str, &str, Request<Body>)> = vec![
        (
            "POST /api/v1/products",
            "create_product",
            post_json_with_admin_key(
                "/api/v1/products",
                &token.token,
                r#"{"sku":"GATED-1","name":"Gated","price":{"minor_units":100,"currency":"USD"}}"#,
                None,
            ),
        ),
        (
            "PATCH /api/v1/products/{sku}/stock",
            "patch_stock",
            patch_with_admin_key(
                "/api/v1/products/GATED-1/stock",
                &token.token,
                r#"{"delta":5}"#,
                None,
            ),
        ),
        (
            "POST /api/v1/tax-rates",
            "create_tax_rate",
            post_json_with_admin_key(
                "/api/v1/tax-rates",
                &token.token,
                r#"{"name":"Gated VAT","rate_bps":1000,"is_default":false,"is_inclusive":false}"#,
                None,
            ),
        ),
        (
            "POST /api/v1/exchange-rates",
            "create_rate",
            post_json_with_admin_key(
                "/api/v1/exchange-rates",
                &token.token,
                r#"{"from_currency":"USD","to_currency":"IDR","rate_millionths":16000000}"#,
                None,
            ),
        ),
        (
            "DELETE /api/v1/exchange-rates/{id}",
            "delete_rate",
            delete_with_admin_key("/api/v1/exchange-rates/some-id", &token.token, None),
        ),
    ];

    for (label, _op, req) in cases {
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::UNAUTHORIZED,
            "{label} must require the admin key when configured (no header → 401)"
        );
        let json = body_json(resp).await;
        assert_eq!(
            json["error"], "invalid_admin_key",
            "{label} must return invalid_admin_key"
        );
    }
}

#[tokio::test]
async fn write_routes_reject_terminal_tokens_with_admin_key() {
    let app = test_app_with_admin_key();
    let token = terminal_token();

    let cases: Vec<(&str, Request<Body>)> = vec![
        (
            "POST /api/v1/products",
            post_json_with_admin_key(
                "/api/v1/products",
                &token,
                r#"{"sku":"GATED-2","name":"Gated","price":{"minor_units":100,"currency":"USD"}}"#,
                Some("operator-key"),
            ),
        ),
        (
            "POST /api/v1/tax-rates",
            post_json_with_admin_key(
                "/api/v1/tax-rates",
                &token,
                r#"{"name":"Gated VAT 2","rate_bps":1000,"is_default":false,"is_inclusive":false}"#,
                Some("operator-key"),
            ),
        ),
        (
            "POST /api/v1/exchange-rates",
            post_json_with_admin_key(
                "/api/v1/exchange-rates",
                &token,
                r#"{"from_currency":"USD","to_currency":"EUR","rate_millionths":920000}"#,
                Some("operator-key"),
            ),
        ),
    ];

    for (label, req) in cases {
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::FORBIDDEN,
            "{label} must reject terminal-scoped tokens (403) even with the admin key"
        );
        let json = body_json(resp).await;
        assert_eq!(json["error"], "insufficient_scope");
    }
}

#[tokio::test]
async fn write_routes_accept_admin_key_when_configured() {
    let app = test_app_with_admin_key();
    let token = auth::create_token("script", Some(1), None, None).unwrap();

    let resp = app
        .clone()
        .oneshot(post_json_with_admin_key(
            "/api/v1/products",
            &token.token,
            r#"{"sku":"OK-1","name":"Fine","price":{"minor_units":100,"currency":"USD"}}"#,
            Some("operator-key"),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    let resp = app
        .oneshot(post_json_with_admin_key(
            "/api/v1/tax-rates",
            &token.token,
            r#"{"name":"Fine VAT","rate_bps":1000,"is_default":false,"is_inclusive":false}"#,
            Some("operator-key"),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
}

// ── router_with_openapi (review MED-4 regression) ────────────────

#[tokio::test]
async fn docs_route_is_served_inside_the_outer_layers() {
    let state = AppState::test(fresh_conn());
    let app = router_with_openapi(
        state,
        Some(serde_json::json!({"openapi": "3.1.0", "x-test": true})),
        None,
    );
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/openapi.json")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    // The route must sit INSIDE the security-headers layer — it did not
    // when the desktop appended it to the returned Router<()> (MED-4).
    assert_eq!(
        resp.headers()
            .get("x-content-type-options")
            .and_then(|v| v.to_str().ok()),
        Some("nosniff"),
        "docs route must carry the security headers every other route gets"
    );
    let body = body_json(resp).await;
    assert_eq!(body["x-test"], serde_json::json!(true));
}

#[tokio::test]
async fn plain_router_does_not_serve_the_docs_route() {
    let app = test_app();
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/openapi.json")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    // The document is only served when explicitly injected. Unknown
    // paths hit the protected group's auth-layered fallback (axum's
    // `.layer` wraps the not-found service too) — 401 without a bearer,
    // never a 200 with a spec body.
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}
