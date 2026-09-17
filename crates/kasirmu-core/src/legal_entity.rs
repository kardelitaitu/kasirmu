//! Legal Entity domain type for the Organization/Tenant hierarchy.
//!
//! A Legal Entity owns the statutory business identity beneath one
//! Organization/Tenant. Locations are assigned to exactly one entity by the
//! database repository in [`crate::db::legal_entities`].

use serde::{Deserialize, Serialize};

/// A statutory business identity belonging to one Organization/Tenant.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LegalEntity {
    /// Stable identifier for the legal entity.
    pub id: String,
    /// Organization/Tenant that owns this entity.
    pub tenant_id: String,
    /// Operator-facing name.
    pub name: String,
    /// Registered legal name used for statutory documents.
    pub legal_name: String,
    /// Government or company registration number.
    pub registration_number: String,
    /// Tax registration identifier.
    pub tax_id: String,
    /// Lifecycle status, currently `active` or `inactive`.
    pub status: String,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// ISO-8601 last-update timestamp.
    pub updated_at: String,
}

/// Mutable Legal Entity fields accepted by an update operation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UpdateLegalEntity {
    /// Operator-facing name.
    pub name: String,
    /// Registered legal name used for statutory documents.
    pub legal_name: String,
    /// Government or company registration number.
    pub registration_number: String,
    /// Tax registration identifier.
    pub tax_id: String,
    /// Lifecycle status, currently `active` or `inactive`.
    pub status: String,
}

#[cfg(test)]
#[path = "legal_entity_tests.rs"]
mod tests;
