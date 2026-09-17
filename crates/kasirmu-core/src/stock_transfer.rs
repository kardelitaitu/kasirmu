//! Stock transfers between terminals/stores.
//!
//! A [`StockTransfer`] moves inventory from one location or terminal to
//! another. Each transfer carries one or more [`StockTransferLine`] items
//! and progresses through a status state machine:
//! draft → pending → in_transit → received / cancelled.

use serde::{Deserialize, Serialize};

/// A single stock transfer between locations/terminals.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StockTransfer {
    /// UUID primary key.
    pub id: String,
    /// Human-readable transfer number (e.g., "TRF-20260701-001").
    pub transfer_number: String,
    /// Status: draft, pending, in_transit, received, cancelled.
    pub status: String,
    /// FK to `inventory_locations.id` (source location). Carries a UUID
    /// string, NOT a free-text name — post-migration 081 the underlying
    /// column is `source_location_id` with the canonical default UUID
    /// (`crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID`) supplied by
    /// `Store::create_transfer` when the caller passes `None`.
    pub source_location: Option<String>,
    /// FK to `inventory_locations.id` (destination location). Carries a
    /// UUID string — see [`Self::source_location`] for the contract.
    pub destination_location: Option<String>,
    /// FK to terminals.id — source terminal device.
    pub source_terminal_id: Option<String>,
    /// FK to terminals.id — destination terminal device.
    pub destination_terminal_id: Option<String>,
    /// Free-form notes.
    pub notes: String,
    /// FK to users.id — who created the transfer.
    pub created_by: String,
    /// FK to users.id — who received the transfer (None until received).
    pub received_by: Option<String>,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// ISO-8601 timestamp when the transfer was sent (None until sent).
    pub sent_at: Option<String>,
    /// ISO-8601 timestamp when the transfer was received (None until received).
    pub received_at: Option<String>,
    /// ISO-8601 last-update timestamp.
    pub updated_at: String,
}

/// A line item in a stock transfer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StockTransferLine {
    /// UUID primary key.
    pub id: String,
    /// FK to stock_transfers.id.
    pub transfer_id: String,
    /// Product SKU being transferred.
    pub sku: String,
    /// Product display name (denormalised).
    pub product_name: String,
    /// Quantity being transferred.
    pub qty: i64,
    /// Quantity actually received (0 until received).
    pub received_qty: i64,
}

#[cfg(test)]
#[path = "stock_transfer_tests.rs"]
mod tests;
