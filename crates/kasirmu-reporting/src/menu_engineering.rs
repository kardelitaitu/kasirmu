/*
last audited 25-07-26 by RSA-Agent (oz-reporting slice A: deep read)
crate: oz-reporting | status: SAFE | lint: CLEAN
findings: R-1 INFO (menu_engineering merge_same_product_rows keeps the first-seen unit price/cost — the revenue-descending SQL order's first row, not the mode — so merged margin_per_unit can misrepresent; proposed: derive unit price as total_revenue/total_volume or document) | R-2 INFO (all reporting queries wrap DATE(s.created_at) in WHERE predicates — non-sargable, full table scans on large sales tables; fine today, propose sargable range predicates when volume grows)
next: cosmetic analytics polish in fix-order | perf: DATE() non-sargable
*/
//! Menu Engineering Analytics — volume, contribution margin, and quadrant
//! classification for restaurant menu items.
//!
//! This module provides SQL-backed aggregation queries that calculate:
//!
//! - **Total volume** — `SUM(sl.qty)` per product over a date range
//! - **Contribution margin** — `SUM((sl.unit_minor - p.cost_minor) * sl.qty)`
//!   per product over a date range
//!
//! The menu engineering matrix classifies each product into one of four
//! quadrants based on median volume and median margin:
//!
//! | Quadrant | Volume | Margin |
//! |---|---|---|
//! | **Star** | ≥ median | ≥ median |
//! | **Plowhorse** | ≥ median | < median |
//! | **Puzzle** | < median | ≥ median |
//! | **Dog** | < median | < median |

use rusqlite::params;
use serde::{Deserialize, Serialize};

use oz_core::CoreError;

/// Aggregated menu engineering row for a single product.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MenuEngineeringRow {
    /// Product unique identifier.
    pub product_id: String,
    /// Product SKU.
    pub sku: String,
    /// Product display name.
    pub name: String,
    /// Total quantity sold over the selected period.
    pub total_volume: i64,
    /// Unit price in minor units (latest sale price or product price).
    pub unit_price_minor: i64,
    /// Cost per unit in minor units.
    pub unit_cost_minor: i64,
    /// Contribution margin per unit: unit_price - unit_cost.
    pub margin_per_unit: i64,
    /// Total contribution margin: (unit_price - unit_cost) * volume.
    pub total_margin_minor: i64,
    /// Total revenue: unit_price * volume.
    pub total_revenue_minor: i64,
}

/// Menu engineering classification quadrant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MenuQuadrant {
    /// High volume, high margin.
    Star,
    /// High volume, low margin.
    Plowhorse,
    /// Low volume, high margin.
    Puzzle,
    /// Low volume, low margin.
    Dog,
}

/// The full menu engineering result: per-product rows plus quadrant
/// classifications.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MenuEngineeringResult {
    /// Aggregated rows sorted by total revenue descending.
    pub rows: Vec<MenuEngineeringRow>,
    /// Median total volume across all products in the period.
    pub median_volume: f64,
    /// Median total margin across all products in the period.
    pub median_margin: f64,
}

/// Run the menu engineering aggregation query for a date range.
///
/// Returns per-product totals for volume, revenue, and contribution margin,
/// along with the median values used for quadrant classification.
pub fn query_menu_engineering(
    conn: &rusqlite::Connection,
    start_date: &str,
    end_date: &str,
) -> Result<MenuEngineeringResult, CoreError> {
    let mut stmt = conn.prepare(
        "SELECT p.id AS product_id, p.sku, p.name,
                COALESCE(SUM(sl.qty), 0) AS total_volume,
                sl.unit_minor AS unit_price_minor,
                COALESCE(sl.cost_minor, p.cost_minor, 0) AS unit_cost_minor,
                (sl.unit_minor - COALESCE(sl.cost_minor, p.cost_minor, 0)) AS margin_per_unit,
                SUM((sl.unit_minor - COALESCE(sl.cost_minor, p.cost_minor, 0)) * sl.qty) AS total_margin_minor,
                SUM(sl.line_minor) AS total_revenue_minor
         FROM sale_lines sl
         JOIN sales s ON sl.sale_id = s.id
         JOIN products p ON sl.sku = p.sku
         WHERE s.status = 'completed'
           AND DATE(s.created_at) BETWEEN ?1 AND ?2
         GROUP BY p.id, sl.unit_minor
         ORDER BY total_revenue_minor DESC",
    )?;

    let mut rows: Vec<MenuEngineeringRow> = stmt
        .query_map(params![start_date, end_date], |row| {
            Ok(MenuEngineeringRow {
                product_id: row.get("product_id")?,
                sku: row.get("sku")?,
                name: row.get("name")?,
                total_volume: row.get("total_volume")?,
                unit_price_minor: row.get("unit_price_minor")?,
                unit_cost_minor: row.get("unit_cost_minor")?,
                margin_per_unit: row.get("margin_per_unit")?,
                total_margin_minor: row.get("total_margin_minor")?,
                total_revenue_minor: row.get("total_revenue_minor")?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    // Merge rows for the same product (same product sold at different prices).
    rows = merge_same_product_rows(rows);

    // Sort by total revenue descending.
    rows.sort_by_key(|b| std::cmp::Reverse(b.total_revenue_minor));

    // Calculate medians.
    let median_volume = median_of(&rows, |r| r.total_volume as f64);
    let median_margin = median_of(&rows, |r| r.total_margin_minor as f64);

    Ok(MenuEngineeringResult {
        rows,
        median_volume,
        median_margin,
    })
}

/// Merge rows that belong to the same product (different sale prices).
fn merge_same_product_rows(rows: Vec<MenuEngineeringRow>) -> Vec<MenuEngineeringRow> {
    let mut merged: std::collections::HashMap<String, MenuEngineeringRow> =
        std::collections::HashMap::new();

    for row in rows {
        use std::collections::hash_map::Entry;
        match merged.entry(row.sku.clone()) {
            Entry::Occupied(mut existing) => {
                let existing = existing.get_mut();
                existing.total_volume += row.total_volume;
                existing.total_margin_minor += row.total_margin_minor;
                existing.total_revenue_minor += row.total_revenue_minor;
                // Keep the first unit price/cost (most common / representative).
            }
            Entry::Vacant(entry) => {
                entry.insert(row);
            }
        }
    }

    let mut result: Vec<MenuEngineeringRow> = merged.into_values().collect();
    result.sort_by_key(|b| std::cmp::Reverse(b.total_revenue_minor));
    result
}

/// Compute the median of a numeric field extracted from a slice of rows.
fn median_of<T>(items: &[T], extract: impl Fn(&T) -> f64) -> f64 {
    if items.is_empty() {
        return 0.0;
    }

    let mut values: Vec<f64> = items.iter().map(extract).collect();
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    let len = values.len();
    if len.is_multiple_of(2) {
        (values[len / 2 - 1] + values[len / 2]) / 2.0
    } else {
        values[len / 2]
    }
}

/// Classify a product into a menu engineering quadrant based on median
/// thresholds.
pub fn classify_quadrant(
    volume: i64,
    margin_minor: i64,
    median_volume: f64,
    median_margin: f64,
) -> MenuQuadrant {
    let volume_high = (volume as f64) >= median_volume;
    let margin_high = (margin_minor as f64) >= median_margin;

    match (volume_high, margin_high) {
        (true, true) => MenuQuadrant::Star,
        (true, false) => MenuQuadrant::Plowhorse,
        (false, true) => MenuQuadrant::Puzzle,
        (false, false) => MenuQuadrant::Dog,
    }
}

/// Generate a human-readable recommendation for a menu quadrant.
pub fn quadrant_recommendation(quadrant: MenuQuadrant) -> &'static str {
    match quadrant {
        MenuQuadrant::Star => "Promote Star — high volume & high margin. Feature prominently.",
        MenuQuadrant::Plowhorse => {
            "Increase Price on Plowhorse — high volume but low margin. Raise price or reduce cost."
        }
        MenuQuadrant::Puzzle => {
            "Reposition Puzzle — low volume but high margin. Improve visibility or bundle."
        }
        MenuQuadrant::Dog => "Remove Dog — low volume & low margin. Consider delisting.",
    }
}

#[cfg(test)]
#[path = "menu_engineering_tests.rs"]
mod tests;
