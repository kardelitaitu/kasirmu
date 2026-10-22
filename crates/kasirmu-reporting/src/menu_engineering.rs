/*
last audited 25-07-26 by RSA-Agent (kasirmu-reporting slice A: deep read)
crate: kasirmu-reporting | status: SAFE | lint: CLEAN
findings: R-1 INFO (menu_engineering merge_same_product_rows keeps the first-seen unit price/cost — the revenue-descending SQL order's first row, not the mode — so merged margin_per_unit can misrepresent; proposed: derive unit price as total_revenue/total_volume or document) | R-2 INFO (all reporting queries wrap DATE(s.created_at) in WHERE predicates — non-sargable, full table scans on large sales tables; fine today, propose sargable range predicates when volume grows)
next: none | perf: R-2 RESOLVED HERE 2026-10-22 (O-M54) for THIS query only —
  query_menu_engineering's WHERE was DATE(s.created_at) BETWEEN ?1 AND ?2 and is
  now the half-open sargable range s.created_at >= ?1 AND s.created_at <
  date(?2, '+1 day'). MEASURED with EXPLAIN QUERY PLAN over 200 seeded rows:
  old = "SCAN s USING COVERING INDEX idx_sales_created_at" (walks every row);
  new = "SEARCH s USING INDEX idx_sales_status_created_date (status=? AND <expr>>?
  AND <expr><?)" (seeks the range). The remaining DATE() predicates in the
  crate's OTHER report queries (and the tz-aware DATE(created_at, tz) form)
  are unchanged and still R-2 INFO.
R-1 RESOLVED 2026-10-04 by documentation, the audit's second option:
  merge_same_product_rows (menu_engineering.rs) carries a `// REP-B:` comment
  stating the kept unit price/cost is the FIRST-SEEN row from the
  revenue-descending SQL — the highest-revenue price point, NOT the mode or
  an average — so merged margin_per_unit is representative of that price
  point; derive total_revenue/total_volume if an average is wanted.
  The former `next: cosmetic analytics polish in fix-order` named a phase
  that no longer exists in any live plan; R-2 was never a fix-order item.
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
//!
//! # Medians are integer money (O-L20)
//!
//! Both medians are `i64`, never `f64`: volume is a count and the margin is
//! money in minor units, and this crate forbids floating point in the money
//! path. The comparison those medians drive is "is this row's margin high?",
//! and for an integer margin that question has exactly one right answer:
//!
//! ```text
//! margin >= (lower + upper) / 2      the exact median, halved
//! ```
//!
//! Halving is the only place a float would appear, and it can be avoided
//! without changing the answer. For an **integer** `margin`, `margin >= mean`
//! holds exactly when `margin >= ceil(mean)`, so the whole test reduces to a
//! comparison against one integer, `ceil((lower + upper) / 2)`. That is the
//! value `MarginMedian::high_water_mark` produces and the value this module
//! publishes and compares against — one integer, no float, and **not one
//! boundary case moves** relative to the previous `f64` code.
//!
//! The two middle elements are still kept, as `(lower, upper)`, so the exact
//! interval survives: `MenuEngineeringResult::median_margin_range` returns it
//! and `classify_quadrant_with_range` classifies from it without any rounding
//! at all. `median_margin` and `median_volume` are then **thresholds, not
//! averages** — see `MenuEngineeringResult` for why that distinction is the
//! contract the screen depends on.

use rusqlite::params;
use serde::{Deserialize, Serialize};

use kasirmu_core::CoreError;

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
    /// ISO-4217 code the three money fields above are denominated in.
    ///
    /// C22: this report used to sum every line regardless of currency, so a
    /// USD line and an IDR line produced one total that was not money in any
    /// currency — and the screen, having no code to read, formatted it with
    /// the workspace default. Rows are now grouped per (product, currency)
    /// and this field is what lets the UI label them correctly. It is always
    /// non-empty: `sale_lines.currency` is NOT NULL.
    pub currency: String,
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
///
/// # `median_volume` and `median_margin` are thresholds, not averages
///
/// Both are integers (O-L20): volume is a count and margin is money in minor
/// units, and neither may be a float. Each is the value a row is compared
/// against to decide whether it is "high":
///
/// ```text
/// volume_high = row.total_volume       >= median_volume
/// margin_high = row.total_margin_minor >= median_margin
/// ```
///
/// That is deliberately the rule the menu-engineering screen already applies
/// (the MenuEngineeringScreen report view, its own
/// `classifyQuadrant`), and it is the *only* rule this struct's scalars
/// support. They are the ceil of the exact median, not the exact median:
/// for products with margins `{4, 5}` the median is `4.5` but
/// `median_margin` is `5`, because `4 >= 4.5` is false and `5 >= 4.5` is
/// true. Publishing `4` would make the screen paint row 4 as high when it is
/// below the median.
///
/// So these fields are not "the median" in the arithmetic sense and must not
/// be displayed as one or averaged with anything. A caller that needs the
/// exact median asks for `median_margin_range()`; the two are equal for every
/// odd-length product set, and differ by one only when the two middle margins
/// straddle a half unit of money.
///
/// Zero medians mean an empty result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MenuEngineeringResult {
    /// Aggregated rows sorted by total revenue descending.
    pub rows: Vec<MenuEngineeringRow>,
    /// Classification threshold for total volume, in units: a row is high
    /// volume when `total_volume >= median_volume`.
    ///
    /// That is also the exact median, re-expressed as the integer it must
    /// exceed — see the struct note.
    pub median_volume: i64,
    /// Classification threshold for total contribution margin, in minor units
    /// of each row's own currency (see `MenuEngineeringRow::currency`): a row
    /// is high margin when `total_margin_minor >= median_margin`.
    ///
    /// The ceil of the exact median; see the struct note, and
    /// `median_margin_range` for the exact bounds.
    pub median_margin: i64,
}

impl MenuEngineeringResult {
    /// Exact bounds of the margin median, as `(lower, upper)` minor units.
    ///
    /// For an odd-length product set both elements are the median. For an
    /// even-length set they are the two middle margins, so an odd sum is
    /// represented exactly (`(4, 5)` means the median is `4.5`) instead of
    /// being rounded. Empty results report `(0, 0)`.
    ///
    /// `median_margin` is the ceil of the mean of this pair; when the two
    /// bounds differ this is what lets a caller see that the median is
    /// fractional rather than believing the threshold is the average.
    ///
    /// Recovered from the rows the result already carries, which are sorted
    /// by revenue, so this sorts a copy of the margins — no extra field and no
    /// extra serde key.
    #[must_use]
    pub fn median_margin_range(&self) -> (i64, i64) {
        margin_median_of(&self.rows).lower_upper()
    }
}

/// The menu engineering aggregation SQL.
///
/// Hoisted to a module constant so the test that asserts its QUERY PLAN
/// (`menu_engineering_date_filter_can_use_an_index`) reads the SAME text the
/// product runs. A plan test against a copy of the SQL is worthless: the
/// earlier version of that test kept its own literal and stayed green when the
/// production predicate was reverted to the non-sargable form.
///
/// // REP-A, C22 and O-M54 comments live at the call site below.
const MENU_ENGINEERING_SQL: &str = "SELECT COALESCE(p.id, sl.sku) AS product_id, sl.sku AS sku,
                COALESCE(p.name, sl.sku) AS name,
                sl.currency AS currency,
                COALESCE(SUM(sl.qty), 0) AS total_volume,
                sl.unit_minor AS unit_price_minor,
                COALESCE(sl.cost_minor, p.cost_minor, 0) AS unit_cost_minor,
                (sl.unit_minor - COALESCE(sl.cost_minor, p.cost_minor, 0)) AS margin_per_unit,
                SUM((sl.unit_minor - COALESCE(sl.cost_minor, p.cost_minor, 0)) * sl.qty) AS total_margin_minor,
                SUM(sl.line_minor) AS total_revenue_minor
         FROM sale_lines sl
         JOIN sales s ON sl.sale_id = s.id
         LEFT JOIN products p ON sl.sku = p.sku
         WHERE s.status = 'completed'
           AND s.created_at >= ?1 AND s.created_at < date(?2, '+1 day')
         GROUP BY COALESCE(p.id, sl.sku), sl.currency, sl.unit_minor
         ORDER BY total_revenue_minor DESC";

/// Run the menu engineering aggregation query for a date range.
///
/// Returns per-product totals for volume, revenue, and contribution margin,
/// along with the median values used for quadrant classification.
///
/// # Range semantics
///
/// Both bounds are INCLUSIVE CALENDAR DAYS, in whatever zone the stored
/// `created_at` values are written in (the same convention as the rest of the
/// report suite). The predicate is written as a half-open instant range,
/// `created_at >= start AND created_at < (end + 1 day)`, rather than
/// `DATE(created_at) BETWEEN start AND end`.
///
/// O-M54: the `DATE(...)` form wraps the COLUMN in a function, so SQLite cannot
/// use an index on `sales.created_at` and every report is a full scan that grows
/// with history. The half-open range leaves the column bare, so the planner can
/// seek. It is equivalent for the stored format (`YYYY-MM-DDTHH:MM:SS.sssZ`:
/// ISO-8601 strings sort lexicographically, and `date(?2, '+1 day')` yields
/// `YYYY-MM-DD`, which is BELOW every timestamp sharing that date prefix — so
/// the upper bound excludes the whole end day and only that day).
/// `menu_engineering_range_is_half_open_on_calendar_days` pins the boundary.
pub fn query_menu_engineering(
    conn: &rusqlite::Connection,
    start_date: &str,
    end_date: &str,
) -> Result<MenuEngineeringResult, CoreError> {
    let mut stmt = conn.prepare(
        // REP-A: LEFT JOIN, keyed on the SKU (which is what sale_lines carries)
        // with the SKU as the name/id fallback. An INNER join erased the whole
        // menu history of any product later deleted, while margin reporting and
        // `kasirmu_core::db::reports`'s daily aggregates still counted those
        // lines (reproduced: 0 rows after delete_product). `sale_lines.sku` has
        // no foreign key to products.
        // C22: `sl.currency` is part of BOTH the grouping and the ordering key.
        // Without it, USD and IDR amounts were added into one number that is
        // money in no currency, and the row carried no code for the UI to
        // format with. Same convention as the rest of the report suite --
        // see db/reports/product_sales.rs:175 and revenue.rs:144.
        MENU_ENGINEERING_SQL,
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
                currency: row.get("currency")?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    // Merge rows for the same product (same product sold at different prices).
    // Note: merge_same_product_rows already returns rows sorted by total_revenue_minor descending,
    // so an immediate re-sort here is redundant (O-M55).
    rows = merge_same_product_rows(rows);

    // Calculate medians. Both stay integer (O-L20): the volume median is a
    // plain i64 because every element is one; the margin median keeps its
    // exact interval, and the published scalar is its ceil — the threshold a
    // scalar reader must use so that IT and `classify_quadrant` agree on every
    // row (see `MenuEngineeringResult`).
    let median_volume = volume_median_of(&rows);
    let margin_median = margin_median_of(&rows);

    Ok(MenuEngineeringResult {
        rows,
        median_volume,
        median_margin: margin_median.high_water_mark(),
    })
}

/// Merge rows that belong to the same product sold at different prices.
///
/// The key is `(sku, currency)`, not `sku` alone: C22's whole point is
/// that a product sold in two currencies is two different amounts of money,
/// and keying on the SKU would fuse them straight back together after the
/// SQL had separated them.
fn merge_same_product_rows(rows: Vec<MenuEngineeringRow>) -> Vec<MenuEngineeringRow> {
    let mut merged: std::collections::HashMap<(String, String), MenuEngineeringRow> =
        std::collections::HashMap::new();

    for row in rows {
        use std::collections::hash_map::Entry;
        match merged.entry((row.sku.clone(), row.currency.clone())) {
            Entry::Occupied(mut existing) => {
                let existing = existing.get_mut();
                existing.total_volume += row.total_volume;
                existing.total_margin_minor += row.total_margin_minor;
                existing.total_revenue_minor += row.total_revenue_minor;
                // REP-B: keep the first-seen unit price/cost. That is the row
                // the SQL ordered first — the HIGHEST-REVENUE price point, not
                // "the most common" as this comment used to claim. The merged
                // margin_per_unit is therefore representative of the biggest
                // price point rather than of the product overall; derive it from
                // total_revenue/total_volume if an average is wanted.
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

/// The median of an integer set, as a closed integer interval.
///
/// # Why an interval, and why a threshold rather than an average
///
/// An odd-length set has a single middle element, so `lower == upper`. An
/// even-length set has two middle elements whose mean is the median only when
/// their sum is even; when it is odd the median is genuinely fractional
/// (the median of `{4, 5}` is `4.5`). Money must not become a float (O-L20),
/// so the exact bounds are kept as two integers.
///
/// The question the quadrant rule actually asks is not "what is the median"
/// but "is this row at or above it", and that has an integer answer:
/// `row >= (lower + upper) / 2` for an integer `row` is the same test as
/// `row >= ceil((lower + upper) / 2)`. `high_water_mark` is that ceil, it needs
/// no division (the two sets are the same except in their last bit), and it is
/// the single integer both this module and the screen compare against.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct MarginMedian {
    /// Lower bound of the median; equals `upper` for an odd-length set.
    lower: i64,
    /// Upper bound of the median; equals `lower` for an odd-length set.
    upper: i64,
}

impl MarginMedian {
    /// A median known to be exactly `value` — an odd-length median, or an
    /// even-length one whose two middle values are equal.
    #[must_use]
    pub fn point(value: i64) -> Self {
        Self {
            lower: value,
            upper: value,
        }
    }

    /// The empty-set median: both bounds zero, matching the historical
    /// `0.0` sentinel and `Money`'s additive identity.
    #[must_use]
    pub fn zero() -> Self {
        Self::point(0)
    }

    /// The two bounds as `(lower, upper)`, lower ≤ upper.
    #[must_use]
    pub fn lower_upper(self) -> (i64, i64) {
        (self.lower, self.upper)
    }

    /// The smallest integer that is at or above this median — its ceil.
    ///
    /// This is the value a scalar reader must compare against, and the one
    /// `median_margin` carries. For an integer row that comparison is exactly
    /// "at or above the exact median": `row >= mean` and `row >= ceil(mean)`
    /// agree for every integer `row`, so no boundary case differs from the
    /// `f64` code that previously computed `row as f64 >= mean`.
    ///
    /// Because `lower <= upper`, the ceil is `upper` whenever the two bounds
    /// straddle a half unit, and the common value otherwise. No addition, so
    /// no overflow anywhere on the `i64` range: the old mean computation
    /// added the two middle values, which could overflow even though the
    /// median itself never can.
    #[must_use]
    pub fn high_water_mark(self) -> i64 {
        self.ceil_of_mean()
    }

    /// Build the median from two known bounds, in either order.
    ///
    /// Accepts a reversed pair and normalises it, so a caller reconstructing a
    /// median from stored data cannot invert the comparison.
    #[must_use]
    pub fn from_bounds(lower: i64, upper: i64) -> Self {
        Self {
            lower: lower.min(upper),
            upper: lower.max(upper),
        }
    }

    /// `ceil((lower + upper) / 2)` without ever forming the sum.
    ///
    /// `lower + upper` would overflow for a large opposite pair
    /// (`i64::MIN` with `i64::MAX - 1`), and so would `upper - lower`; the
    /// mean itself is always representable, since it cannot exceed either
    /// bound. So the halves are taken separately:
    ///
    /// ```text
    /// ceil((a + b) / 2) = floor(a / 2) + floor(b / 2) + (a odd || b odd)
    /// ```
    ///
    /// `>> 1` on `i64` is an arithmetic shift, which IS floor division by two
    /// for negatives (unlike `/ 2`, which truncates toward zero), and `& 1` is
    /// the low bit, so the odd test is sign-correct. No operation in here can
    /// overflow: halving moves inward and the sum of two halves of `a <= b`
    /// cannot exceed `b`.
    fn ceil_of_mean(self) -> i64 {
        let a = self.lower;
        let b = self.upper;
        let halves = (a >> 1) + (b >> 1);
        if (a & 1) != 0 || (b & 1) != 0 {
            halves + 1
        } else {
            halves
        }
    }
}

/// Median of a slice of integer-valued items, extracted by `extract`.
///
/// An empty slice yields the zero interval.
/// Uses `select_nth_unstable` in $O(n)$ time rather than a full $O(n \log n)$ sort (O-M55).
fn median_of<T>(items: &[T], extract: impl Fn(&T) -> i64) -> MarginMedian {
    if items.is_empty() {
        return MarginMedian::zero();
    }

    let mut values: Vec<i64> = items.iter().map(extract).collect();
    let len = values.len();
    let mid = len / 2;

    if len.is_multiple_of(2) {
        values.select_nth_unstable(mid);
        let upper = values[mid];
        let lower = *values[..mid].iter().max().unwrap_or(&upper);
        MarginMedian { lower, upper }
    } else {
        values.select_nth_unstable(mid);
        MarginMedian::point(values[mid])
    }
}

/// Median total volume across the rows, in units.
fn volume_median_of(rows: &[MenuEngineeringRow]) -> i64 {
    // Volume is a count and always an integer, so its threshold is its ceil_of_mean.
    median_of(rows, |r| r.total_volume).high_water_mark()
}

/// Exact median of the rows' total contribution margin, in minor units.
fn margin_median_of(rows: &[MenuEngineeringRow]) -> MarginMedian {
    median_of(rows, |r| r.total_margin_minor)
}

/// Classify a product into a menu engineering quadrant based on median
/// thresholds.
///
/// `volume` is sold units and `margin_minor` is contribution margin in minor
/// units; both are integers, and so are the medians they are compared
/// against (O-L20 — no money value in this crate is a float).
///
/// # Boundary semantics
///
/// "High" means **at or above** the median, so a product exactly on the
/// median is high: equal volume *and* equal margin is a `Star`, and
/// `classify_quadrant(m, m)` is a `Star` for every `m`.
///
/// For an even-length product set the exact median may fall between two
/// integers: products with margins `{4, 5}` have a median of `4.5`, so a
/// margin of `4` is **below** it (low) and `5` is above it (high). This
/// function gets that right without a float by comparing against the ceil of
/// the median, which for an integer margin is the same test — see
/// `MarginMedian`.
///
/// The published `MenuEngineeringResult::median_margin` is that same ceil, so
/// a caller applying `margin_minor >= median_margin` — as the menu
/// engineering screen does — reproduces this function's answer for every row.
pub fn classify_quadrant(
    volume: i64,
    margin_minor: i64,
    median_volume: i64,
    margin_median: MarginMedian,
) -> MenuQuadrant {
    let volume_high = volume >= median_volume;
    let margin_high = margin_minor >= margin_median.high_water_mark();

    match (volume_high, margin_high) {
        (true, true) => MenuQuadrant::Star,
        (true, false) => MenuQuadrant::Plowhorse,
        (false, true) => MenuQuadrant::Puzzle,
        (false, false) => MenuQuadrant::Dog,
    }
}

/// Classify a product using an exact margin-median interval.
///
/// Identical to `classify_quadrant` for the same median, spelled with the raw
/// `(lower, upper)` pair so a caller holding
/// `MenuEngineeringResult::median_margin_range`'s output — or `(m, m)` for a
/// known integer median — does not have to know about the internal type.
///
/// Note what "exact" does *not* mean here: a margin strictly inside
/// `[lower, upper]` is already below the mean when the two bounds differ
/// (`4` against `{4, 5}` is below `4.5`), so it is low. The interval buys
/// exactness for the *median*, not a wider high band.
pub fn classify_quadrant_with_range(
    volume: i64,
    margin_minor: i64,
    median_volume: i64,
    margin_median: (i64, i64),
) -> MenuQuadrant {
    let (lower, upper) = margin_median;
    classify_quadrant(
        volume,
        margin_minor,
        median_volume,
        MarginMedian::from_bounds(lower, upper),
    )
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
