//! Sale-deduction result types (ADR-19 §2).
//!
//! When [`Store::complete_sale`](crate::db::Store) runs with multi-location
//! inventory, it returns either a [`CompleteSaleResult`] (all stock sufficed)
//! or a [`PartialStockResult`] (one or more lines had insufficient stock at
//! the resolved primary location). The cashier UI uses these discriminators
//! to render either a success toast or the Stock Shortfall panel.
//!
//! These types belong in `oz-core` because both the desktop-client and
//! tablet-client Tauri command layers deserialize and forward them to the
//! front-end without further transformation.

use serde::{Deserialize, Serialize};

use crate::inventory::LocationId;
use crate::inventory_transaction::InventoryTransactionId;
use foundation::SaleStatus;

/// A cashier's resolution for a single shortfall — which location(s) to
/// draw from to fulfill the deficit.
///
/// Sent by the front-end Stock Shortfall dialog after the cashier picks
/// alternative locations or enters split-fulfillment quantities.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedShortfall {
    /// SKU that was short (must match a Shortfall from PartialStockResult).
    pub sku: String,
    /// Per-location allocation of the quantity to deduct from each location.
    /// Sum of `qty` across all entries MUST equal the original `requested_qty`.
    pub allocations: Vec<LocationAllocation>,
}

/// A per-location quantity allocation chosen by the cashier for split fulfillment.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationAllocation {
    /// Which inventory location to deduct from.
    pub location_id: LocationId,
    /// How many units to deduct from this location (must be ≥ 0).
    pub qty: i64,
}

/// Stock availability at a specific inventory location.
///
/// Returned inside [`Shortfall::alternatives`] so the cashier UI can render
/// a per-location choice (e.g. "Warehouse A — 250 available").
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationStock {
    /// FK to `inventory_locations.id`.
    pub location_id: LocationId,
    /// Human-readable location name for the cashier UI dropdown.
    pub location_name: String,
    /// Live stock on hand at this location for the relevant SKU.
    pub qty_available: i64,
}

/// A single SKU that could not be fulfilled from the resolved primary location.
///
/// Aggregated into [`PartialStockResult::shortfalls`] so the cashier sees
/// every affected line item in a single dialog.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Shortfall {
    /// Product SKU that is short.
    pub sku: String,
    /// Product display name (denormalised from the cart line).
    pub product_name: String,
    /// Quantity the customer requested.
    pub requested_qty: i64,
    /// Quantity currently available at the primary location.
    pub primary_qty_available: i64,
    /// Shortfall = requested_qty - primary_qty_available (≥ 1).
    pub deficit: i64,
    /// The primary location where stock was checked.
    pub primary_location_id: LocationId,
    /// Alternative locations where this SKU has available stock.
    /// Suggested fallback sources for the cashier to choose from.
    /// Empty if no alternative location has stock.
    pub alternatives: Vec<LocationStock>,
}

/// Returned when every line item had sufficient stock at its resolved
/// deduction location. The sale row is committed; the cart is cleared.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteSaleResult {
    /// The newly-created sale's primary key.
    pub sale_id: String,
    /// Always `completed` — stock was sufficient across all lines.
    pub status: SaleStatus,
    /// Human-readable receipt number for the cashier UI.
    pub receipt_number: String,
    /// The statutory document number claimed inside the sale transaction
    /// (regional slice 5), or `None` when the selling entity has no
    /// configured `document_number_sequences` series for the document kind
    /// (unconfigured deployments keep today's behavior).
    pub statutory_number: Option<String>,
    /// FK to `inventory_transactions.id` — the audit session that groups
    /// all `stock_movements` rows produced by this deduction.
    pub deduct_tx_id: InventoryTransactionId,
}

/// Returned when at least one line item exceeded available stock at the
/// resolved primary location. The sale row is **rolled back** — no DB row
/// exists for this attempt. The cashier must resolve each shortfall via
/// the Stock Shortfall dialog and retry with
/// `complete_sale_with_resolved_shortfalls`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartialStockResult {
    /// Always `true` — sentinel for the front-end to render the shortfall
    /// panel instead of the receipt screen.
    pub requires_resolution: bool,
    /// Every line item that had insufficient stock at the primary location.
    /// May be a subset of the cart's lines (some lines may have sufficed,
    /// but since the transaction is rolled back atomically, ALL lines must
    /// be re-deducted on the retry — lines that sufficed on the first pass
    /// are NOT listed here because they don't need cashier resolution).
    pub shortfalls: Vec<Shortfall>,
}

/// A single deduction to execute atomically inside a batch operation.
///
/// Used by [`Store::adjust_stock_batch`](crate::db::Store) for split-fulfillment
/// where one line item is deducted from 2+ locations simultaneously (ADR-19 §3).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StockDeduction {
    /// Product SKU to deduct from.
    pub sku: String,
    /// FK to `inventory_locations.id` — where the stock is deducted.
    pub location_id: LocationId,
    /// Signed quantity: negative for deduction, positive for credit.
    pub delta: i64,
}

impl PartialStockResult {
    /// Convenience constructor for a single-shortfall response.
    #[must_use]
    pub fn single(shortfall: Shortfall) -> Self {
        Self {
            requires_resolution: true,
            shortfalls: vec![shortfall],
        }
    }

    /// Convenience constructor for a multi-shortfall response.
    #[must_use]
    pub fn multiple(shortfalls: Vec<Shortfall>) -> Self {
        Self {
            requires_resolution: true,
            shortfalls,
        }
    }
}

/// Allocate a requested quantity across topology-selected locations in their
/// declared route order. The first location is preferred, then later routes
/// fill the remaining quantity. `None` means the configured routes cannot
/// fulfill the request and no partial allocation should be committed.
#[must_use]
pub fn allocate_stock_in_route_order(
    requested_qty: i64,
    locations: &[LocationStock],
) -> Option<Vec<LocationAllocation>> {
    if requested_qty < 0 {
        return None;
    }

    let mut remaining = requested_qty;
    let mut allocations = Vec::new();
    for location in locations {
        if remaining == 0 {
            break;
        }
        if location.qty_available <= 0 {
            continue;
        }
        let allocated = remaining.min(location.qty_available);
        allocations.push(LocationAllocation {
            location_id: location.location_id.clone(),
            qty: allocated,
        });
        remaining = remaining.checked_sub(allocated)?;
    }

    (remaining == 0).then_some(allocations)
}

#[cfg(test)]
#[path = "sale_deduction_tests.rs"]
mod tests;
