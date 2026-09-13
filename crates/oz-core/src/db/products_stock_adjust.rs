//! Location-aware stock adjustment and ledger maintenance.
//!
//! Key functions: `adjust_stock_at_location_with_reason` (ADR-19
//! canonical adjust - every sale/refund/void/transfer routes here),
//! `adjust_stock_batch` (precheck-then-execute with checked arithmetic),
//! `adjust_stock_with_reason`, `check_stock_threshold_and_alert_in_tx`,
//! `get_stock_from_ledger`, `rebuild_stock_summary`,
//! `rebuild_stock_summary_for` (scoped, self-healing), `list_stock_movements`,
//! `archive_stock_movements`.
//!
//! Invariants: batch precheck avoids partial deductions; stock math
//! uses checked_add/sub; adjustments upsert `stock_summary` per
//! location.
//!
//! Split (products campaign Agent 2/3): the `impl Store` groups moved
//! to child modules below (`adjust`, `batch`, `ledger`, `movements`),
//! declared as private children so every downstream path is unchanged.
//! The parts hold inherent `impl Store` blocks + private fns, so no
//! `pub use` re-exports are needed or wanted (the sales.rs precedent);
//! the shared consts stay HERE because the sibling test file reaches
//! `REBUILD_SCOPE_CHUNK` through this namespace via `use super::*`.
use super::*;

/// The `reason` tag and id prefix on the compensating movement written by
/// [`Store::rebuild_stock_summary_for`] when it heals a legacy ledger shortfall.
///
/// Named, not inlined, because it is user-visible: it appears in
/// [`Store::list_stock_movements`] and in any audit export, and it is what an
/// operator greps for to find every unit the rebuild had to invent a movement
/// for. The row is a derived placeholder standing in for stock that predates
/// the ADR #6 ledger — not a claim that someone moved something on this date.
const LEGACY_BACKFILL_REASON: &str = "legacy-backfill";

/// How many product ids one scoped rebuild statement may bind at a time.
///
/// Every statement in [`Store::rebuild_stock_summary_for`] binds ONE PARAMETER
/// PER ID (`WHERE item_id IN (?1..?n)`), and SQLite caps the variables per
/// statement at `SQLITE_MAX_VARIABLE_NUMBER` — 32 766 on the bundled 3.4x,
/// 999 on any older build. [`Store::rebuild_stock_summary`] passes EVERY ledger
/// and summary id, so an unchunked scope turns a large catalog into a
/// `too many SQL variables` error on the sync path, where the old parameterless
/// table-wide statement could not fail. 900 stays under even the historical
/// 999 ceiling; see `rebuild_scope_survives_a_catalog_larger_than_the_chunk`.
///
/// This is a CHUNK SIZE, never a threshold that switches the scope off: a long
/// id list is processed in more chunks, not in a table-wide sweep.
const REBUILD_SCOPE_CHUNK: usize = 900;

// Products-campaign split: cohesive impl-Store groups moved to child
// modules; the child-module wiring below keeps every downstream path
// unchanged. Parts reach `upsert_stock_summary_in_tx`, the consts and
// the crate types through this facade's namespace via `use super::*`.
// Explicit `#[path]` attributes are load-bearing, not decorative: this
// file is itself loaded via `#[path]` by `products.rs`, so a bare
// `mod x;` child resolves against `db/`, not a `products_stock_adjust/`
// directory — the same reason every sibling in this subtree is declared
// with a path attribute.
#[path = "products_stock_adjust/adjust.rs"]
mod adjust;

#[path = "products_stock_adjust/batch.rs"]
mod batch;

#[path = "products_stock_adjust/ledger.rs"]
mod ledger;

#[path = "products_stock_adjust/movements.rs"]
mod movements;

#[cfg(test)]
#[path = "products_stock_adjust_tests.rs"]
mod tests;
