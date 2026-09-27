//! Unit tests for `dto`.
//!
//! Moved out of `dto.rs` to satisfy the AGENTS.md section 2 rule that unit
//! tests live in a sibling `*_tests.rs` file rather than inside a production
//! `.rs` file. Wired from `dto.rs` with:
//!   `#[cfg(test)] #[path = "dto_tests.rs"] mod tests;`

use super::*;

// ── CreateProductDto ─────────────────────────────────────────────

#[test]
fn create_product_dto_minimal() {
    let json = r#"{"sku":"COFFEE","name":"Espresso","price_minor":350,"currency":"USD"}"#;
    let dto: CreateProductDto = serde_json::from_str(json).unwrap();
    assert_eq!(dto.sku, "COFFEE");
    assert_eq!(dto.name, "Espresso");
    assert_eq!(dto.price_minor, 350);
    assert_eq!(dto.currency, "USD");
    assert_eq!(dto.product_type, "retail"); // default
    assert!(dto.category_id.is_none());
    assert!(dto.barcode.is_none());
    assert!(!dto.track_serial);
    assert_eq!(dto.cost_minor, 0); // default
    assert!(dto.brand.is_none());
    assert!(dto.rack_location.is_none());
    assert!(dto.notes.is_none());
    assert!(dto.unit.is_none());
    assert!(dto.is_active); // default
    assert!(dto.default_supplier_id.is_none());
}

#[test]
fn create_product_dto_full() {
    let json = r#"{
        "sku":"LAPTOP","name":"MacBook Pro","price_minor":129999,"currency":"USD",
        "category_id":"cat-electronics","barcode":"5901234123457",
        "product_type":"retail","track_serial":true,
        "cost_minor":90000,"brand":"Apple","rack_location":"E-02-11",
        "notes":"genuine","unit":"pcs","is_active":true,
        "default_supplier_id":"sup-1"
    }"#;
    let dto: CreateProductDto = serde_json::from_str(json).unwrap();
    assert_eq!(dto.category_id, Some("cat-electronics".into()));
    assert_eq!(dto.barcode, Some("5901234123457".into()));
    assert!(dto.track_serial);
    assert_eq!(dto.cost_minor, 90000);
    assert_eq!(dto.brand.as_deref(), Some("Apple"));
    assert_eq!(dto.rack_location.as_deref(), Some("E-02-11"));
    assert_eq!(dto.notes.as_deref(), Some("genuine"));
    assert_eq!(dto.unit.as_deref(), Some("pcs"));
    assert!(dto.is_active);
    assert_eq!(dto.default_supplier_id.as_deref(), Some("sup-1"));
}

#[test]
fn create_product_dto_serde_roundtrip() {
    let dto = CreateProductDto {
        sku: "COFFEE".into(),
        name: "Espresso".into(),
        price_minor: 350,
        currency: "USD".into(),
        category_id: None,
        barcode: None,
        product_type: "retail".into(),
        track_serial: false,
        cost_minor: 0,
        brand: None,
        rack_location: None,
        notes: None,
        unit: None,
        is_active: true,
        default_supplier_id: None,
    };
    let json = serde_json::to_string(&dto).unwrap();
    let back: CreateProductDto = serde_json::from_str(&json).unwrap();
    assert_eq!(back, dto);
}

// ── UpdateProductDto ─────────────────────────────────────────────

#[test]
fn update_product_dto_partial() {
    let json = r#"{"name":"Updated Name"}"#;
    let dto: UpdateProductDto = serde_json::from_str(json).unwrap();
    assert_eq!(dto.name, Some("Updated Name".into()));
    assert!(dto.price_minor.is_none());
}

#[test]
fn update_product_dto_empty() {
    let json = r#"{}"#;
    let dto: UpdateProductDto = serde_json::from_str(json).unwrap();
    assert!(dto.name.is_none());
    assert!(dto.price_minor.is_none());
    assert!(dto.category_id.is_none());
}

#[test]
fn update_product_dto_null_clears_category() {
    // Sending null for category_id must produce Some(None) — "clear the field"
    let json = r#"{"category_id":null}"#;
    let dto: UpdateProductDto = serde_json::from_str(json).unwrap();
    assert_eq!(
        dto.category_id,
        Some(None),
        "null should deserialize to Some(None) via custom deserializer"
    );
    // name should still be None (key absent = don't update)
    assert!(dto.name.is_none());
}

#[test]
fn update_product_dto_serde_roundtrip() {
    let dto = UpdateProductDto {
        name: Some("New Name".into()),
        price_minor: Some(999),
        category_id: Some(Some("cat-new".into())),
        barcode: None,
        product_type: None,
        track_serial: Some(true),
        cost_minor: Some(800),
        brand: Some(Some("Apple".into())),
        rack_location: Some(None),
        notes: None,
        unit: Some(Some("kg".into())),
        is_active: Some(true),
        default_supplier_id: None,
    };
    let json = serde_json::to_string(&dto).unwrap();
    let back: UpdateProductDto = serde_json::from_str(&json).unwrap();
    assert_eq!(back, dto);
}

// ── CreateCustomerDto ────────────────────────────────────────────

#[test]
fn create_customer_dto_minimal() {
    let json = r#"{"name":"Alice"}"#;
    let dto: CreateCustomerDto = serde_json::from_str(json).unwrap();
    assert_eq!(dto.name, "Alice");
    assert!(dto.email.is_none());
    assert!(dto.phone.is_none());
    assert!(dto.notes.is_none());
}

#[test]
fn create_customer_dto_full() {
    let json =
        r#"{"name":"Bob","email":"bob@example.com","phone":"+6281234567890","notes":"VIP"}"#;
    let dto: CreateCustomerDto = serde_json::from_str(json).unwrap();
    assert_eq!(dto.email, Some("bob@example.com".into()));
    assert_eq!(dto.phone, Some("+6281234567890".into()));
    assert_eq!(dto.notes, Some("VIP".into()));
}

#[test]
fn create_customer_dto_serde_roundtrip() {
    let dto = CreateCustomerDto {
        name: "Alice".into(),
        email: Some("alice@example.com".into()),
        phone: None,
        notes: None,
    };
    let json = serde_json::to_string(&dto).unwrap();
    let back: CreateCustomerDto = serde_json::from_str(&json).unwrap();
    assert_eq!(back, dto);
}

// ── SaleSummaryDto ───────────────────────────────────────────────

#[test]
fn sale_summary_dto_deserialize() {
    let json = r#"{
        "id":"s1","status":"completed","total_minor":1150,"currency":"USD",
        "line_count":2,"payment_method":"cash","cashier_name":"John",
        "customer_name":null,"created_at":"2026-07-22T10:00:00Z"
    }"#;
    let dto: SaleSummaryDto = serde_json::from_str(json).unwrap();
    assert_eq!(dto.id, "s1");
    assert_eq!(dto.status, "completed");
    assert_eq!(dto.total_minor, 1150);
    assert_eq!(dto.payment_method, Some("cash".into()));
    assert_eq!(dto.cashier_name, Some("John".into()));
    assert!(dto.customer_name.is_none());
}

#[test]
fn sale_summary_dto_serde_roundtrip() {
    let dto = SaleSummaryDto {
        id: "s1".into(),
        status: "completed".into(),
        total_minor: 1150,
        currency: "IDR".into(),
        line_count: 2,
        payment_method: Some("qris".into()),
        cashier_name: Some("Budi".into()),
        customer_name: None,
        created_at: "2026-07-22T10:00:00Z".into(),
    };
    let json = serde_json::to_string(&dto).unwrap();
    let back: SaleSummaryDto = serde_json::from_str(&json).unwrap();
    assert_eq!(back, dto);
}

// ── StockAlertDto ────────────────────────────────────────────────

#[test]
fn stock_alert_dto_critical() {
    let json = r#"{
        "id":"a1","sku":"COFFEE","product_name":"Espresso",
        "location_id":"loc-1","location_name":"Main Store",
        "current_qty":2,"threshold":20,
        "severity":"critical","triggered_at":"2026-07-22T08:00:00Z",
        "acknowledged":false
    }"#;
    let dto: StockAlertDto = serde_json::from_str(json).unwrap();
    assert_eq!(dto.sku, "COFFEE");
    assert_eq!(dto.current_qty, 2);
    assert_eq!(dto.threshold, 20);
    assert_eq!(dto.severity, "critical");
    assert!(!dto.acknowledged);
}

#[test]
fn stock_alert_dto_serde_roundtrip() {
    let dto = StockAlertDto {
        id: "a1".into(),
        sku: "BAGEL".into(),
        product_name: "Bagel".into(),
        location_id: "loc-2".into(),
        location_name: "Branch".into(),
        current_qty: 5,
        threshold: 10,
        severity: "warning".into(),
        triggered_at: "2026-07-22T08:00:00Z".into(),
        acknowledged: true,
    };
    let json = serde_json::to_string(&dto).unwrap();
    let back: StockAlertDto = serde_json::from_str(&json).unwrap();
    assert_eq!(back, dto);
}
