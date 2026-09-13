//! Location-profile domain type — each location has its own identity,
//! settings, and feature flags.
//!
//! Maps to the `locations` table (introduced by the historical
//! `025_store_profiles.sql` migration).

use serde::{Deserialize, Serialize};

/// A physical location / outlet in a multi-store deployment.
///
/// Every deployment has exactly one **primary** location, created on first
// startup (`id = "default"`). Additional locations can be added for
// multi-location operators.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LocationProfile {
    /// Row id (`"default"` for the primary location, UUID for others).
    pub id: String,

    /// Display name (e.g. "Downtown Flagship").
    pub name: String,

    /// Street address (printed on receipts).
    pub address: String,

    /// Tax / VAT registration number.
    pub tax_id: String,

    /// ISO-4217 currency code (e.g. "USD", "IDR").
    pub currency: String,

    /// IANA timezone (e.g. "America/New_York", "Asia/Jakarta").
    pub timezone: String,

    /// Whether this is the primary location (exactly one per deployment).
    pub is_primary: bool,

    /// ISO-8601 creation timestamp.
    pub created_at: String,

    /// ISO-8601 last-update timestamp.
    pub updated_at: String,
}
#[cfg(test)]
#[path = "location_profile_tests.rs"]
mod tests;
