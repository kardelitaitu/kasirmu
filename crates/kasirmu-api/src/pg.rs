//! Postgres data layer for the kasirmu-api REST handlers (Phase 1.2 of
//! `docs/archived/2026-08-15-unify-auth-and-sync.md`).
/*
last audited 25-07-26 by RSA-Agent (kasirmu-api slice B: pg deep read)
crate: kasirmu-api | status: SAFE | lint: CLEAN
findings: RLS contract exemplary — every tenant-scoped function opens a tx and sets oz.tenant_id LOCAL (12 sites verified; LOCAL scope auto-resets so pooled connections never leak scope); verify_terminal_credentials is a documented pre-tenant read via a scoped discovery role (SET LOCAL ROLE inside read-only tx) with digest comparison in SQL; all SQL parameterized ($n), format! only builds error strings and static SELECT prefixes; API-3 INFO: sale reads unwrap_or(0) tip_minor/service_charge_minor (1211-1212) and enum fallbacks product_type/status (610/1149) silently zero/default on drift (COR-13/25 family)
next: propagate sale money-column read errors (API-3) | perf: PRODUCT_SELECT reuses stock_summary aggregate
*/
//!
//! The desktop/tablet/cloud POS share one SQLite data layer
//! ([`kasirmu_core::Store`]), which cannot be rewritten to Postgres. The cloud
//! server therefore gets a **parallel async data layer** for the REST
//! surface, exactly like `apps/cloud-server/src/sync_store.rs` is for the
//! sync function. Each handler dispatches on `AppState::pg`:
//!
//! - `Some(pool)` → the cloud server's Postgres branch: this module runs the
//!   query against `deadpool_postgres::Pool`.
//! - `None` → local dev / tests / SQLite branch: the existing
//!   `kasirmu_core::Store` path runs unchanged.
//!
//! The SQL is written natively for Postgres (`$n` parameters). The port
//! schema (`20260813_init.pg.sql`) stores boolean-ish columns as `BIGINT`
//! (0/1), so reads go through `pg_bool` and writes pass `i64`. The
//! behaviour mirrors the SQLite `Store` methods the handlers used before:
//! validation errors, unique-constraint conflicts, the `stock_movements` +
//! `stock_summary` + `inventory` ledger writes on product/stock changes, and
//! the sale header + line insert inside one transaction.

// Only `pg_tests.rs` reaches these through `use super::*` — every function that
// used them moved to a submodule that imports what it needs directly. Gated to
// the test build so the lib build stays warning-free.
#[cfg(test)]
use kasirmu_core::{Currency, Money, Sale, SaleLine, SaleStatus, TenantPlan};

mod memos;

// Re-exported so `crate::pg::<Item>` keeps resolving for the route
// handlers and the PG integration suite after the memo split.
pub use memos::{
    ActiveMemoPg, MemoAckResult, MemoRecipientSyncRow, MemoSyncResult, MemoSyncRow, ack_memo,
    list_active_memos_for_terminal, sync_memos,
};

// The shared prologue helpers (constants, `pg_bool`, the violation probes,
// `now_rfc3339`, `bump_snapshot_version`, `currency_str`, the `IN (…)` chunking
// arithmetic) live in `pg/helpers.rs` so a domain section can be lifted out of
// this file without dragging them along. The domain submodules import them from
// `super::helpers` directly; only what THIS file (and its sibling test module,
// through `use super::*`) names is imported here.
mod helpers;
use helpers::{PG_IN_CHUNK, PG_LEAD_PARAMS, PG_MAX_PARAMS};

// Reached only by `pg_tests.rs` via `use super::*`, so it is imported only in
// test builds — an unconditional import would be unused in the library build.
#[cfg(test)]
use helpers::pg_placeholders;

/// Pin the invariant at COMPILE time: a chunk plus the leading parameters it also
/// binds must stay under the wire ceiling, or the chunking is itself the bug. A
/// `const` assert fails every build, not only a test run someone remembers.
const _: () = assert!(
    PG_IN_CHUNK + PG_LEAD_PARAMS < PG_MAX_PARAMS,
    "PG_IN_CHUNK must stay below PostgreSQL's 65535-parameters-per-statement ceiling"
);

// ── Settings ────────────────────────────────────────────────────────────

#[path = "pg/settings.rs"]
mod settings;
pub use settings::{get_setting_pg, scoped_setting_key, set_setting_pg};

#[path = "pg/error.rs"]
mod error;
pub use error::PgError;

// RLS contract: every tenant-scoped REST function below opens a transaction
// and sets `oz.tenant_id` as a LOCAL setting (`set_config(..., is_local :=
// true)`) as its first statement. Under the cutover (`scripts/rls-cutover.sql`,
// `FORCE ROW LEVEL SECURITY`) a query on a tenant table fails closed without
// it; the LOCAL scope auto-resets on commit/rollback, so a pooled connection
// never leaks one tenant's scope to the next borrower.

// ── Tenant plans ──────────────────────────────────────────────────────

#[path = "pg/plans.rs"]
mod plans;
pub use plans::{get_tenant_plan, set_tenant_plan};

// ── Categories ────────────────────────────────────────────────────────

#[path = "pg/categories.rs"]
mod categories;
pub use categories::list_categories;

// ── Tax rates ─────────────────────────────────────────────────────────

#[path = "pg/tax_rates.rs"]
mod tax_rates;
pub use tax_rates::{
    TaxRateWrite, create_tax_rate, create_tax_rate_scoped, update_tax_rate_scoped,
    validate_tax_rate_write,
};

// ── Users ─────────────────────────────────────────────────────────────

#[path = "pg/users.rs"]
mod users;
pub use users::create_user;

// ── Terminals ─────────────────────────────────────────────────────────
#[path = "pg/terminals.rs"]
mod terminals;
pub use terminals::{register_terminal, verify_terminal_credentials};

// ── Products ─────────────────────────────────────────────────────────

#[path = "pg/products.rs"]
mod products;
pub use products::{adjust_stock, create_product, get_product, list_missing_hashes, list_products};

// ── Sales ─────────────────────────────────────────────────────────────
#[path = "pg/sales.rs"]
mod sales;
pub use sales::{
    SaleClaim, claim_sale_idempotency, create_sale, get_sale, record_unguarded_sale,
    release_sale_idempotency, update_sale_status,
};

// ── Exchange rates ───────────────────────────────────────────────────

#[path = "pg/exchange_rates.rs"]
mod exchange_rates;
pub use exchange_rates::{
    ExchangeRateDto, create_exchange_rate_pg, delete_exchange_rate_pg, get_latest_exchange_rate_pg,
    list_exchange_rates_pg, list_latest_exchange_rates_pg, validate_exchange_rate_request,
};

#[cfg(test)]
#[path = "pg_tests.rs"]
mod tests;
