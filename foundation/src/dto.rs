/*
last audited 25-07-26 by RSA-Agent (foundation slice E: contact+dto verified)
crate: foundation | status: SAFE | lint: CLEAN
findings: clean — Email/Phone validated newtypes (serde transparent), DTO conventions documented (Create and Update DTOs with Option PATCH semantics); dto unwraps are test-only (verified by line-range check)
next: none | perf: N/A
*/
//! Shared Data Transfer Objects for kasir.mu.
//!
//! These DTOs provide a stable, versioned API surface for create/update
//! operations across all Tauri commands and REST endpoints. They live in
//! `foundation` so every crate can depend on them without pulling in
//! heavy transitive deps.
//!
//! # Conventions
//!
//! - Every DTO derives `Serialize + Deserialize + Clone + Debug + PartialEq`.
//! - `Create*Dto` structs carry all required fields for entity creation.
//! - `Update*Dto` structs use `Option<T>` for partial updates (PATCH semantics).
//! - Summary DTOs are read-only projections used in list/dashboard views.

use serde::{Deserialize, Serialize};

// ── Product DTOs ────────────────────────────────────────────────────

/// Payload for creating a new product.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreateProductDto {
    /// Stock-keeping unit — the human-readable product code (required).
    pub sku: String,
    /// Display name shown on receipts and the POS UI (required).
    pub name: String,
    /// Sale price in minor units (e.g. 1299 = $12.99).
    pub price_minor: i64,
    /// ISO-4217 currency code (e.g. "USD", "IDR").
    pub currency: String,
    /// Optional category reference.
    #[serde(default)]
    pub category_id: Option<String>,
    /// Optional machine-readable barcode (EAN-13, UPC-A, etc.).
    #[serde(default)]
    pub barcode: Option<String>,
    /// Product type: "retail", "restaurant", "both", or "service".
    #[serde(default = "default_product_type")]
    pub product_type: String,
    /// Whether this product requires serial number capture at checkout.
    #[serde(default)]
    pub track_serial: bool,
    /// Purchase/cost price in minor units (local-only, ADR #36 D2).
    #[serde(default)]
    pub cost_minor: i64,
    /// Brand (free text).
    #[serde(default)]
    pub brand: Option<String>,
    /// Rack position code, e.g. "A-01-03".
    #[serde(default)]
    pub rack_location: Option<String>,
    /// Free-text notes.
    #[serde(default)]
    pub notes: Option<String>,
    /// Unit of measure, e.g. "pcs", "kg", "box".
    #[serde(default)]
    pub unit: Option<String>,
    /// Active/sellable status (default: active).
    #[serde(default = "default_is_active")]
    pub is_active: bool,
    /// Default supplier FK (local-only, ADR #36 D2).
    #[serde(default)]
    pub default_supplier_id: Option<String>,
}

fn default_product_type() -> String {
    "retail".into()
}

fn default_is_active() -> bool {
    true
}

/// Payload for updating an existing product (PATCH semantics — only
/// the fields present in the payload are updated).
///
/// ## Field semantics
///
/// | JSON | Rust | Meaning |
/// |------|------|---------|
/// | key absent | `None` | Don't update |
/// | `"key": null` | `Some(None)` | Clear the field |
/// | `"key": "value"` | `Some(Some("value"))` | Set to new value |
///
/// A custom deserializer on `category_id` and `barcode` correctly
/// distinguishes `null` (clear) from absent (no-op) for optional fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UpdateProductDto {
    /// Updated display name.
    #[serde(default)]
    pub name: Option<String>,
    /// Updated sale price in minor units.
    #[serde(default)]
    pub price_minor: Option<i64>,
    /// Updated category reference. Send `null` to clear.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_field"
    )]
    pub category_id: Option<Option<String>>,
    /// Updated barcode. Send `null` to clear.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_field"
    )]
    pub barcode: Option<Option<String>>,
    /// Updated product type.
    #[serde(default)]
    pub product_type: Option<String>,
    /// Updated serial tracking flag.
    #[serde(default)]
    pub track_serial: Option<bool>,
    /// Updated cost in minor units. `Some(v)` updates, `None` keeps.
    #[serde(default)]
    pub cost_minor: Option<i64>,
    /// Updated brand. Send `null` to clear.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_field"
    )]
    pub brand: Option<Option<String>>,
    /// Updated rack position code. Send `null` to clear.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_field"
    )]
    pub rack_location: Option<Option<String>>,
    /// Updated notes. Send `null` to clear.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_field"
    )]
    pub notes: Option<Option<String>>,
    /// Updated unit of measure. Send `null` to clear.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_field"
    )]
    pub unit: Option<Option<String>>,
    /// Updated active status. `Some(v)` updates, `None` keeps.
    #[serde(default)]
    pub is_active: Option<bool>,
    /// Updated default supplier. Send `null` to clear.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_field"
    )]
    pub default_supplier_id: Option<Option<String>>,
}

/// Custom deserializer for `Option<Option<T>>` PATCH fields.
///
/// Serde maps JSON `null` → `None` by default, but in PATCH semantics
/// we need to distinguish "key absent" (`None`) from "explicitly null"
/// (`Some(None)`). This function wraps the inner deserializer so that:
/// - Key absent (handled by `#[serde(default)]`) → `None`
/// - `null` → `Some(None)`
/// - `"value"` → `Some(Some("value"))`
fn deserialize_optional_field<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de>,
{
    Ok(Some(Option::deserialize(deserializer)?))
}

// ── Customer DTOs ───────────────────────────────────────────────────

/// Payload for creating a new customer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreateCustomerDto {
    /// Display name (required).
    pub name: String,
    /// Optional email address.
    #[serde(default)]
    pub email: Option<String>,
    /// Optional phone number.
    #[serde(default)]
    pub phone: Option<String>,
    /// Free-form notes.
    #[serde(default)]
    pub notes: Option<String>,
}

// ── Sale Summary DTO ─────────────────────────────────────────────────

/// Read-only projection of a sale for list/dashboard views.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaleSummaryDto {
    /// Sale ID.
    pub id: String,
    /// Current status: "pending", "active", "completed", "voided".
    pub status: String,
    /// Grand total in minor units.
    pub total_minor: i64,
    /// ISO-4217 currency code.
    pub currency: String,
    /// Number of line items.
    pub line_count: i64,
    /// Payment method used.
    pub payment_method: Option<String>,
    /// Cashier display name (if available).
    pub cashier_name: Option<String>,
    /// Customer display name (if linked).
    pub customer_name: Option<String>,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
}

// ── Stock Alert DTO ──────────────────────────────────────────────────

/// Read-only projection of an active stock alert for dashboard widgets.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StockAlertDto {
    /// Alert event ID.
    pub id: String,
    /// Product SKU.
    pub sku: String,
    /// Product display name.
    pub product_name: String,
    /// Location ID where stock is low.
    pub location_id: String,
    /// Location display name.
    pub location_name: String,
    /// Current quantity on hand.
    pub current_qty: i64,
    /// Reorder threshold.
    pub threshold: i64,
    /// Severity: "critical" (≤ 25% of threshold) or "warning".
    pub severity: String,
    /// ISO-8601 timestamp when the alert was triggered.
    pub triggered_at: String,
    /// Whether the alert has been acknowledged.
    pub acknowledged: bool,
}

#[cfg(test)]
mod tests {
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
}
