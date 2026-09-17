/*
last audited 25-07-26 by RSA-Agent (oz-reporting slice A: deep read)
crate: oz-reporting | status: SAFE | lint: CLEAN
findings: R-1 INFO (menu_engineering merge_same_product_rows keeps the first-seen unit price/cost — the revenue-descending SQL order's first row, not the mode — so merged margin_per_unit can misrepresent; proposed: derive unit price as total_revenue/total_volume or document) | R-2 INFO (all reporting queries wrap DATE(s.created_at) in WHERE predicates — non-sargable, full table scans on large sales tables; fine today, propose sargable range predicates when volume grows)
next: cosmetic analytics polish in fix-order | perf: DATE() non-sargable
*/
//! Per-sale-line margin reporting (HPP / cost exposure).
//!
//! Retail merchandising records the product cost (`products.cost_minor`, the
//! "HPP" — *harga pokok penjualan* / cost of goods) as a local attribute.
//! This module exposes it in the reporting layer: for a given sale, each line
//! is enriched with the unit cost, the line margin, and the margin
//! percentage, so a manager can review a transaction's profitability.
//!
//! # Cost semantics
//!
//! Costs are **snapshotted into `sale_lines.cost_minor` at checkout** (migration
//! 135): the product's HPP is frozen when the sale is written, so editing a
//! product's cost later never restates historical margins. The query prefers
//! the per-line snapshot and falls back to the product's current cost (and 0)
//! for legacy rows and lines whose product is missing/deleted. The display
//! name likewise falls back to the SKU when the product is unknown.

use rusqlite::params;
use serde::{Deserialize, Serialize};

use oz_core::CoreError;

/// One enriched sale line with cost and margin figures.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaleLineMargin {
    /// `sale_lines.id` — join key back to the sale detail.
    pub sale_line_id: String,
    /// Product SKU at time of sale.
    pub sku: String,
    /// Product display name (falls back to the SKU when unknown).
    pub name: String,
    /// Quantity sold (≥ 1).
    pub qty: i64,
    /// Unit price in minor units at time of sale.
    pub unit_price_minor: i64,
    /// Line total in minor units (`unit_price × qty`, discounts are
    /// sale-level and do not change per-line totals).
    pub line_total_minor: i64,
    /// Current unit cost in minor units (HPP); 0 when unset or unknown.
    pub unit_cost_minor: i64,
    /// Line margin in minor units: `(unit_price − cost) × qty`. Negative
    /// when the unit sells below cost.
    pub margin_minor: i64,
    /// Margin as a percentage of the line total (`margin / total × 100`).
    /// 0.0 when the line total is zero. Negative for loss-leader lines.
    pub margin_percent: f64,
}

/// Compute the margin percentage of a line.
///
/// `margin / line_total × 100`, guarded against a zero line total (fully
/// discounted lines report a 0% margin rather than ±∞).
pub fn margin_percent(margin_minor: i64, line_total_minor: i64) -> f64 {
    if line_total_minor == 0 {
        0.0
    } else {
        (margin_minor as f64) / (line_total_minor as f64) * 100.0
    }
}

/// Enrich every line of one sale with its cost and margin.
///
/// Returns the lines in `line_position` order. The sale's status is not
/// filtered here — the caller decides which sale to open; only its lines are
/// reported.
pub fn query_sale_lines_with_margin(
    conn: &rusqlite::Connection,
    sale_id: &str,
) -> Result<Vec<SaleLineMargin>, CoreError> {
    let mut stmt = conn.prepare(
        "SELECT sl.id, sl.sku,
                COALESCE(p.name, sl.sku) AS name,
                sl.qty,
                sl.unit_minor,
                sl.line_minor,
                COALESCE(sl.cost_minor, p.cost_minor, 0) AS unit_cost_minor,
                (sl.unit_minor - COALESCE(sl.cost_minor, p.cost_minor, 0)) * sl.qty AS margin_minor
         FROM sale_lines sl
         LEFT JOIN products p ON sl.sku = p.sku
         WHERE sl.sale_id = ?1
         ORDER BY sl.line_position",
    )?;

    let rows = stmt.query_map(params![sale_id], |row| {
        let unit_price_minor: i64 = row.get("unit_minor")?;
        let line_total_minor: i64 = row.get("line_minor")?;
        let unit_cost_minor: i64 = row.get("unit_cost_minor")?;
        let qty: i64 = row.get("qty")?;
        let margin_minor: i64 = row.get("margin_minor")?;
        Ok(SaleLineMargin {
            sale_line_id: row.get("id")?,
            sku: row.get("sku")?,
            name: row.get("name")?,
            qty,
            unit_price_minor,
            line_total_minor,
            unit_cost_minor,
            margin_minor,
            margin_percent: margin_percent(margin_minor, line_total_minor),
        })
    })?;

    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[cfg(test)]
#[path = "margin_tests.rs"]
mod tests;
