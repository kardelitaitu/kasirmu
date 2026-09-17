use super::*;
use axum::http::StatusCode;

// ── store_error_response ────────────────────────────────────

#[test]
fn validation_error_returns_400() {
    let err = CoreError::Validation {
        field: "lines",
        message: "must have at least one line".into(),
    };
    let resp = store_error_response(err);
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[test]
fn not_found_error_returns_404() {
    let err = CoreError::NotFound {
        entity: "sale",
        id: "nope-123".into(),
    };
    let resp = store_error_response(err);
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[test]
fn internal_error_returns_500_via_catchall() {
    let err = CoreError::Internal("db connection lost".into());
    let resp = store_error_response(err);
    assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

#[test]
fn conflict_error_returns_500_via_catchall() {
    // sales.rs store_error_response has no explicit Conflict arm,
    // so it falls through to the catch-all → 500.
    let err = CoreError::Conflict {
        entity: "sale",
        field: "id",
    };
    let resp = store_error_response(err);
    assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

// ── CreateSaleRequest / CreateSaleLine deserialization ──────

#[test]
fn create_sale_request_single_line() {
    let json =
        r#"{"lines":[{"sku":"SKU-1","qty":2,"unit_price":{"minor_units":350,"currency":"USD"}}]}"#;
    let req: CreateSaleRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.lines.len(), 1);
    assert_eq!(req.lines[0].sku, "SKU-1");
    assert_eq!(req.lines[0].qty, 2);
    assert_eq!(req.lines[0].unit_price.minor_units, 350);
    assert_eq!(req.lines[0].unit_price.currency, "USD".parse().unwrap());
}

#[test]
fn create_sale_request_multi_line() {
    let json = r#"{"lines":[
        {"sku":"A","qty":2,"unit_price":{"minor_units":100,"currency":"USD"}},
        {"sku":"B","qty":1,"unit_price":{"minor_units":200,"currency":"USD"}}
    ]}"#;
    let req: CreateSaleRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.lines.len(), 2);
    assert_eq!(req.lines[0].sku, "A");
    assert_eq!(req.lines[0].qty, 2);
    assert_eq!(req.lines[1].sku, "B");
    assert_eq!(req.lines[1].qty, 1);
    assert_eq!(req.lines[1].unit_price.minor_units, 200);
}

#[test]
fn create_sale_request_empty_lines_deserializes() {
    let json = r#"{"lines":[]}"#;
    let req: CreateSaleRequest = serde_json::from_str(json).unwrap();
    assert!(req.lines.is_empty());
}

// ── UpdateSaleStatusRequest deserialization ─────────────────

#[test]
fn update_sale_status_request_active() {
    let json = r#"{"status":"active"}"#;
    let req: UpdateSaleStatusRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.status, SaleStatus::Active);
}

#[test]
fn update_sale_status_request_completed() {
    let json = r#"{"status":"completed"}"#;
    let req: UpdateSaleStatusRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.status, SaleStatus::Completed);
}

#[test]
fn update_sale_status_request_voided() {
    let json = r#"{"status":"voided"}"#;
    let req: UpdateSaleStatusRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.status, SaleStatus::Voided);
}

#[test]
fn update_sale_status_request_pending() {
    let json = r#"{"status":"pending"}"#;
    let req: UpdateSaleStatusRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.status, SaleStatus::Pending);
}

// ── SaleStatusResponse serialization ────────────────────────

#[test]
fn sale_status_response_serialization() {
    let resp = SaleStatusResponse {
        id: "sale-1".into(),
        status: SaleStatus::Active,
        updated_at: "2025-01-15T10:30:00Z".into(),
    };
    let json = serde_json::to_string(&resp).unwrap();
    assert!(json.contains("\"id\":\"sale-1\""));
    assert!(json.contains("\"status\":\"active\""));
    assert!(json.contains("\"updated_at\":\"2025-01-15T10:30:00Z\""));
}
