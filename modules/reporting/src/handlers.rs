/*
crate: modules-reporting | status: REPAIRED | lint: pending
findings: MSL-11 REMOVED — `SaleCompletedReporter` was registered on the live
`sale.completed` bus and wrote every completed sale into `report_sales`, a table
with ONE writer and ZERO readers (no Rust, UI, or export path ever selected from
it; `audit_log` by contrast has 35 readers). The write also ran a lazy
`CREATE TABLE IF NOT EXISTS` on every sale, and it discarded `event.store_id`, so
in multi-store mode every store's sales landed in the GLOBAL identity DB with no
store attribution. The handler was a pure cost: rows grew without bound and
nothing could ever read them.

The projection it claimed to provide already exists, correctly, in
`crates/kasirmu-core/src/db/reports/`: `daily_revenue` aggregates directly from
`sales`/`refunds`, groups BY CURRENCY, applies the store's UTC offset (REP-03),
joins refunds FULL OUTER so a refund-only day still yields a row (REP-04), and
validates its date bounds. A projection table could only ever be a stale
duplicate of that.
*/

//! Event handlers for the Reporting module.
//!
//! This module previously subscribed a `report_sales` projection handler to
//! `sale.completed`. That projection had no reader anywhere in the tree, so the
//! write was removed rather than kept as a documented no-op: the aggregates it
//! was meant to serve are computed directly from the live tables by
//! `kasirmu_core::db::reports`.
//!
//! The module is deliberately empty of handlers now. It is kept because
//! [`crate::ReportingModule`] is registered in the kernel and the crate still
//! owns the report DTOs and the read-only [`crate::ReportingRepository`].
