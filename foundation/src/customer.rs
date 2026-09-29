//! Customer domain type — shared by the CRM module and the core facade.
//!
//! Moved here from `modules-crm` (ADR-61 / C26, 2026-09-28) so `kasirmu-core` can re-export the
//! type without depending on a business module. The move is possible because the type carries no
//! database dependency: its only imports are this crate's `Email`/`Phone`, `serde`, and `uuid`.
//! An inherent impl has to live in the type's defining crate, which is why the impl moved with it.

use crate::{Email, Phone};
use serde::{Deserialize, Serialize};

/// A repeat buyer tracked by the POS.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Customer {
    /// Internal row id (UUID v4).
    pub id: String,
    /// Display name.
    pub name: String,
    /// Optional email address.
    pub email: Option<Email>,
    /// Optional phone number.
    pub phone: Option<Phone>,
    /// Accumulated loyalty points.
    pub loyalty_points: i64,
    /// Total lifetime spend in minor units.
    pub total_spent_minor: i64,
    /// Currency code for `total_spent_minor`.
    pub currency: String,
    /// Free-form notes about this customer.
    pub notes: String,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// ISO-8601 last-update timestamp.
    pub updated_at: String,
}

impl Customer {
    /// Create a new customer.
    pub fn new(name: impl Into<String>) -> Self {
        let name = name.into().trim().to_owned();
        assert!(!name.is_empty(), "customer name must not be empty");

        Self {
            id: uuid::Uuid::now_v7().to_string(),
            name,
            email: None,
            phone: None,
            loyalty_points: 0,
            total_spent_minor: 0,
            currency: "USD".to_string(),
            notes: String::new(),
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    /// Builder method for setting email.
    #[must_use]
    pub fn with_email(mut self, email: Email) -> Self {
        self.email = Some(email);
        self
    }

    /// Builder method for setting phone.
    #[must_use]
    pub fn with_phone(mut self, phone: Phone) -> Self {
        self.phone = Some(phone);
        self
    }
}

#[cfg(test)]
#[path = "customer_tests.rs"]
mod tests;
