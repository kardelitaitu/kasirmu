//! Tax rate CRUD — list, get, create, update, delete, and product/category assignments.
//!
//! # Decomposition (13-09-26)
//!
//! The 1,463-line monolith split along its real seams into submodules:
//! [`rates`] (rate-record CRUD, dependency counts, rounding-directive reads),
//! [`scopes`] (the scope/window model, scoped authoring, the resolver walk
//! and applicability filter) and [`assignments`] (product/category ↔
//! rate junctions). This file keeps only the module wiring and the
//! re-exports callers and the test module resolve through it — no logic
//! lives here. Behaviour unchanged; `crate::db::tax::<Name>` paths did
//! not move.
/*
last audited 25-07-26 by RSA-Agent (oz-core slice B5 part 4)
crate: oz-core | status: SAFE | lint: CLEAN
findings: exemplary — TAX-02 default-flag swap atomic in tx; TAX-03 archive-not-delete with sale-line reference guard + junction cleanup + archived-rate immutability + active-rate validation on assignment; TAX-04 bounded bps with overflow rationale (MAX_TAX_RATE_BPS); PROD-12 batch junction query with documented SQLITE_MAX_VARIABLE_NUMBER bound
next: none | perf: batch query documented
*/

mod assignments;
mod rates;
mod scopes;

pub use rates::{MAX_TAX_RATE_BPS, TaxRateDependencyCounts};
pub use scopes::{TaxRateScope, TaxRateScopeInfo, TaxRateWindow, TaxSaleScope};

// Everything below exists for `tax_tests.rs`, which is wired as a child of
// this module and resolves its subjects through `use super::*`: the strict
// date parser it pins, and the parent-use bindings it inherits. They are
// compiled out of the release build entirely.
#[cfg(test)]
use super::Store;
#[cfg(test)]
use crate::error::CoreError;
#[cfg(test)]
use crate::tax_rate::RoundingMode;
#[cfg(test)]
use rusqlite::params;
#[cfg(test)]
pub(crate) use scopes::parse_effective_date;

#[cfg(test)]
#[path = "tax_tests.rs"]
mod tests;
