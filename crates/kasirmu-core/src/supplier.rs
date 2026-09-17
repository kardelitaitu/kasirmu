//! Supplier domain type — vendor/supplier relationship management.
//!
//! A [`Supplier`] stores contact and business information for vendors
//! that provide products to the store. Suppliers are stored in the
//! `suppliers` table (migration `046_suppliers.sql`).

use serde::{Deserialize, Serialize};

/// A vendor that supplies products to the store.
///
/// # Schema mapping
///
/// Maps 1:1 to the `suppliers` table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Supplier {
    /// Internal row id (UUID v7).
    pub id: String,
    /// Unique supplier code (human-readable identifier).
    pub code: String,
    /// Display name of the supplier company.
    pub name: String,
    /// Name of the primary contact person.
    pub contact_person: String,
    /// Contact phone number.
    pub phone: String,
    /// Contact email address.
    pub email: String,
    /// Physical or mailing address.
    pub address: String,
    /// Tax identification number.
    pub tax_id: String,
    /// Payment terms (e.g. "Net 30").
    pub payment_terms: String,
    /// Free-form notes.
    pub notes: String,
    /// Status: "active" or "inactive".
    pub status: String,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// ISO-8601 last-update timestamp.
    pub updated_at: String,
}

impl Supplier {
    /// Create a new supplier with the given code and name.
    ///
    /// Generates a fresh UUID for `id`. Defaults status to `"active"`.
    ///
    /// # Panics
    ///
    /// Panics if `name` or `code` is empty after trimming.
    pub fn new(code: impl Into<String>, name: impl Into<String>) -> Self {
        let name = name.into().trim().to_owned();
        assert!(!name.is_empty(), "supplier name must not be empty");
        let code = code.into().trim().to_owned();
        assert!(!code.is_empty(), "supplier code must not be empty");

        Self {
            id: uuid::Uuid::now_v7().to_string(),
            code,
            name,
            contact_person: String::new(),
            phone: String::new(),
            email: String::new(),
            address: String::new(),
            tax_id: String::new(),
            payment_terms: String::new(),
            notes: String::new(),
            status: "active".into(),
            created_at: String::new(),
            updated_at: String::new(),
        }
    }
}

#[cfg(test)]
#[path = "supplier_tests.rs"]
mod tests;
