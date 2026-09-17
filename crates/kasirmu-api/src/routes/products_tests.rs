use super::*;
use axum::http::StatusCode;

// ── store_error_response ────────────────────────────────────

#[test]
fn validation_error_returns_400() {
    let err = CoreError::Validation {
        field: "sku",
        message: "must not be empty".into(),
    };
    let resp = store_error_response(err);
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[test]
fn conflict_error_returns_409() {
    let err = CoreError::Conflict {
        entity: "product",
        field: "sku",
    };
    let resp = store_error_response(err);
    assert_eq!(resp.status(), StatusCode::CONFLICT);
}

#[test]
fn not_found_error_returns_404() {
    let err = CoreError::NotFound {
        entity: "product",
        id: "NOPE-001".into(),
    };
    let resp = store_error_response(err);
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[test]
fn internal_error_returns_500() {
    let err = CoreError::Internal("serialization failed".into());
    let resp = store_error_response(err);
    assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

#[test]
fn db_error_returns_500_via_catchall() {
    let err = CoreError::Db(rusqlite::Error::InvalidParameterName("x".into()));
    let resp = store_error_response(err);
    assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

#[test]
fn money_overflow_error_returns_500_via_catchall() {
    let err = CoreError::MoneyOverflow {
        left: 1_000_000,
        right: 500_000,
        currency: "USD".into(),
    };
    let resp = store_error_response(err);
    assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

// ── CreateProductRequest deserialization ────────────────────

#[test]
fn create_product_request_minimal_fields() {
    let json = r#"{"sku":"SKU-1","name":"Widget","price":{"minor_units":199,"currency":"USD"}}"#;
    let req: CreateProductRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.sku, "SKU-1");
    assert_eq!(req.name, "Widget");
    assert_eq!(req.price.minor_units, 199);
    assert_eq!(req.price.currency, "USD".parse().unwrap());
    assert!(req.category_id.is_none());
    assert!(req.barcode.is_none());
    assert!(req.initial_stock.is_none());
}

#[test]
fn create_product_request_all_fields() {
    let json = r#"{"sku":"SKU-2","name":"Gadget","price":{"minor_units":499,"currency":"IDR"},"category_id":"cat-1","barcode":"5901234123457","initial_stock":10}"#;
    let req: CreateProductRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.sku, "SKU-2");
    assert_eq!(req.name, "Gadget");
    assert_eq!(req.price.minor_units, 499);
    assert_eq!(req.price.currency, "IDR".parse().unwrap());
    assert_eq!(req.category_id, Some("cat-1".into()));
    assert_eq!(req.barcode, Some("5901234123457".into()));
    assert_eq!(req.initial_stock, Some(10));
}

// ── PatchStockRequest deserialization ───────────────────────

#[test]
fn patch_stock_request_positive_delta() {
    let json = r#"{"delta":25}"#;
    let req: PatchStockRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.delta, 25);
}

#[test]
fn patch_stock_request_negative_delta() {
    let json = r#"{"delta":-10}"#;
    let req: PatchStockRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.delta, -10);
}

// ── PatchStockResponse serialization ────────────────────────

#[test]
fn patch_stock_response_serialization() {
    let resp = PatchStockResponse {
        sku: "DRINK-001".into(),
        previous_qty: 50,
        new_qty: 40,
    };
    let json = serde_json::to_string(&resp).unwrap();
    assert!(json.contains("\"sku\":\"DRINK-001\""));
    assert!(json.contains("\"previous_qty\":50"));
    assert!(json.contains("\"new_qty\":40"));
}
