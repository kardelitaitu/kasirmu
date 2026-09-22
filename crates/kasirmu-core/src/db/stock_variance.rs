//! Read-only stock reconciliation — \`stock_summary\` vs the \`stock_movements\` ledger.
//!
//! Checklist item C12 (prerequisite for C3). A terminal that re-applies its own
//! pushed \`complete_sale\` deducts stock twice, so the materialised
//! \`stock_summary.qty\` and the append-only \`stock_movements\` ledger drift apart
//! per \`(item_id, location_id)\`. This module REPORTS that drift and nothing
//! else: it never rewrites history, because a blind \`qty = SUM(delta)\` repair
//! would destroy legitimate manual adjustments. The operator decides.
//!
//! Key type: [\`StockVarianceRow\`]. Key function:
//! [\`Store::stock_variance_report\`].
//!
//! Invariants: the ledger is the driving set, so a \`(item, location)\` with
//! movement history but no summary row reports a stored qty of 0 rather than
//! disappearing; only the LIVE \`stock_movements\` table is summed, because
//! \`stock_movements_archive\` already contributed its \`archive-rollup\` row to the
//! live table and reading both would double count; the whole call is one SELECT
//! with two bound parameters — no transaction, no write.

use rusqlite::params;

use crate::db::Store;
use crate::error::CoreError;

/// Hard ceiling on \`limit\` for [\`Store::stock_variance_report\`].
///
/// The report is an operator triage surface, not an export: a caller asking for
/// more rows than this gets a validation error naming the ceiling instead of a
/// silently truncated list it cannot detect.
pub const STOCK_VARIANCE_MAX_ROWS: i64 = 1000;

/// One \`(item_id, location_id)\` whose materialised qty disagrees with the ledger.
///
/// Quantities are whole units, so they are plain \`i64\` — not [\`crate::Money\`],
/// which is minor currency units.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StockVarianceRow {
    /// Product id the two tables disagree about.
    pub item_id: String,
    /// Location id the two tables disagree about.
    pub location_id: String,
    /// \`stock_summary.qty\` as stored (0 when the summary row is absent).
    pub stored_qty: i64,
    /// \`SUM(stock_movements.delta)\` for this item at this location.
    pub ledger_qty: i64,
    /// \`stored_qty - ledger_qty\`; never zero for a reported row unless the
    /// caller asked for \`min_abs_difference = 0\`.
    pub difference: i64,
}

impl Store<'_> {
    /// Reconcile \`stock_summary\` against the \`stock_movements\` ledger per
    /// \`(item_id, location_id)\`.
    ///
    /// Returns every \`(item, location)\` that has ANY movement history and whose
    /// \`ABS(stored_qty - SUM(delta))\` is at least \`min_abs_difference\`, ordered by
    /// absolute difference descending (ties broken by \`item_id\`, then
    /// \`location_id\`, so the order is stable), capped at \`limit\` rows.
    ///
    /// The ledger drives the join, so a location whose movements exist but whose
    /// \`stock_summary\` row was never written is reported with \`stored_qty = 0\`.
    /// A fully consistent \`(item, location)\` is filtered out unless the caller
    /// passes \`min_abs_difference = 0\`, in which case it comes back with
    /// \`difference = 0\`.
    ///
    /// Read-only by construction: one \`SELECT\`, no transaction, so a caller may
    /// run it against a live connection while other terminals are writing. It is
    /// deliberately NOT a repair — see the module docs for why the operator, not
    /// this query, owns the correction.
    ///
    /// # Errors
    ///
    /// [\`CoreError::Validation\`] when \`min_abs_difference\` is negative or
    /// \`limit\` falls outside \`1..=STOCK_VARIANCE_MAX_ROWS\`; otherwise
    /// [\`CoreError::Db\`] from the underlying query.
    pub fn stock_variance_report(
        &self,
        min_abs_difference: i64,
        limit: i64,
    ) -> Result<Vec<StockVarianceRow>, CoreError> {
        if min_abs_difference < 0 {
            return Err(CoreError::Validation {
                field: "min_abs_difference",
                message: format!("must be >= 0, got {min_abs_difference}"),
            });
        }
        if !(1..=STOCK_VARIANCE_MAX_ROWS).contains(&limit) {
            return Err(CoreError::Validation {
                field: "limit",
                message: format!("must be in 1..={STOCK_VARIANCE_MAX_ROWS}, got {limit}"),
            });
        }

        // The ledger is aggregated FIRST (one row per (item, location)) and then
        // LEFT JOINed to the summary, so every column in the projection is
        // deterministic and no bare-column-with-aggregate SQLite semantics are
        // relied on. ABS() is applied to the joined result in both WHERE and
        // ORDER BY so the filter and the ordering agree.
        let mut stmt = self.conn.prepare(
            "SELECT l.item_id,
                    l.location_id,
                    COALESCE(s.qty, 0)                AS stored_qty,
                    l.ledger_qty,
                    COALESCE(s.qty, 0) - l.ledger_qty AS difference
             FROM (SELECT item_id, location_id, SUM(delta) AS ledger_qty
                     FROM stock_movements
                    GROUP BY item_id, location_id) l
             LEFT JOIN stock_summary s
                    ON s.item_id = l.item_id AND s.location_id = l.location_id
            WHERE ABS(COALESCE(s.qty, 0) - l.ledger_qty) >= ?1
            ORDER BY ABS(COALESCE(s.qty, 0) - l.ledger_qty) DESC,
                     l.item_id ASC,
                     l.location_id ASC
            LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![min_abs_difference, limit], |row| {
            Ok(StockVarianceRow {
                item_id: row.get(0)?,
                location_id: row.get(1)?,
                stored_qty: row.get(2)?,
                ledger_qty: row.get(3)?,
                difference: row.get(4)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(CoreError::from)
    }
}

#[cfg(test)]
#[path = "stock_variance_tests.rs"]
mod tests;
