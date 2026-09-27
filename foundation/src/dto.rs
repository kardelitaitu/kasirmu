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
#[path = "dto_tests.rs"]
mod tests;
