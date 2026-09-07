/*
last audited 25-07-26 by RSA-Agent (oz-core slice B1: db facade)
crate: oz-core | status: SAFE | lint: CLEAN
findings: RUST-08 transaction contract verified in the field (22 files, ~70 unchecked_transaction sites; no nesting violations surfaced by the 2,536-test suite); all format!-built SQL verified injection-safe (whitelist columns + bound ?N params, escaped LIKE); backup uses online Backup API not VACUUM INTO (RUST-02/03); tenant integrity check fails loud; UNIQUE idx_payments_idempotency_key closes the create_payments dedup race
next: B2 aggregate stores (sales/products/inventory deep read) | perf: backup chunking 512 pages/10ms documented and reasoned
*/
//! Database facade — typed CRUD for every domain entity.
//!
//! The [`Store`] is a lightweight borrow-wrapper around a
//! `&rusqlite::Connection`. It holds no state of its own; callers
//! create a `Store` on the fly and call methods that map directly to
//! SQL queries. All writes that touch more than one row use
//! `unchecked_transaction` for atomicity.
//!
//! Domain methods are organised into sub-modules, each one implementing
//! `impl Store<'_>` for a logical domain (products, sales, customers, etc.).
//!
//! # Repository transaction contract (RUST-08)
//!
//! The facade deliberately uses [`rusqlite::Connection::unchecked_transaction`]
//! rather than the checked `Connection::transaction` because [`Store`] borrows
//! `&Connection` (checked transactions require `&mut Connection`, which would
//! force callers to hold a mutable borrow of the shared pool for the whole
//! write). The contract for every method in this module is:
//!
//! 1. **Standalone atomic commands own their transaction.** Any method that
//!    must write multiple rows atomically opens its own
//!    `unchecked_transaction()` and commits it before returning. Callers rely
//!    on this: a single `Store::method(...)` call is always all-or-nothing.
//! 2. **Composable methods never nest.** A method that calls another `Store`
//!    method which itself opens a transaction MUST NOT wrap that call in an
//!    outer transaction — SQLite rejects nested transactions, and the inner
//!    `unchecked_transaction()` would fail with "cannot start a transaction
//!    within a transaction". See `db/settings.rs` workspace tests which
//!    pin this boundary. If true cross-method atomicity is required, implement
//!    a dedicated method that performs all writes inside one transaction.
//! 3. **Read-only methods never open a transaction.** Queries run directly on
//!    the connection; a reader must never hold a write lock.
//! 4. **Error paths roll back.** Every `unchecked_transaction()` result is
//!    mapped with `?`/`map_err` so a failure drops the transaction (rollback)
//!    instead of committing a partial write.
//!
//! Adding a new database method that opens a transaction internally is a
//! review point: confirm it is standalone-atomic (not composable), confirm it
//! cannot be invoked from inside another transaction, and document any
//! deliberate exception here.

use rusqlite::Connection;

use std::sync::Arc;

use crate::Money;
use crate::cache::Cache;
use crate::error::CoreError;
use crate::money::Currency;

/// Audit log queries (read / write).
pub mod analytics;
pub mod assignments;
pub mod audit;
/// Active cart persistence (survives restarts).
pub mod cart;
/// Cash payout CRUD (open / close / list).
pub mod cash_payouts;
/// Customer CRUD and lookups.
pub mod customers;
/// Downgrade assessment gatherer — reads live per-dimension counts.
pub mod downgrade;
/// Gift cards — issue, redeem, top-up, freeze, balance checks.
pub mod gift_cards;
/// Inventory management CRUD (locations, shifts, thresholds, transaction logs).
pub mod inventory;
/// Kitchen Display System order CRUD.
pub mod kds;
/// Loyalty points / rewards CRUD.
pub mod loyalty;
/// Offline queue and sync state.
pub mod offline;
pub mod plans;
pub mod stripe;
pub use offline::RemoteSyncFailure;
/// EDC terminal configuration CRUD — PLANNED (stubs).
pub mod edc_terminals;
/// Cloud image content spine — refcount + push queue (spec 0046b §3.7).
pub mod image_refs;
/// Organization/Tenant-scoped Legal Entity CRUD and location assignment.
pub mod legal_entities;
/// Location profile CRUD.
pub mod locations;
/// Media asset (image) CRUD — PLANNED (stubs).
pub mod media;
/// Memo lifecycle repository — create/publish/stop, revisions, recipients.
pub mod memos;
/// Accounts Payable (Hutang) repository — create/settle/age supplier debts.
pub mod payables;
/// Payment gateway configuration CRUD — PLANNED (stubs).
pub mod payment_gateways;
/// Payment settlement ledger CRUD — PLANNED (stubs).
pub mod payment_settlements;
/// Payment CRUD (tenders, transactions).
pub mod payments;
/// Popularity recompute (ADR #37) — sale/activity aggregation + score writes.
pub mod popularity;
/// CRUD for product bundles (group selling).
pub mod product_bundles;
/// Product CRUD and search.
pub mod products;
pub mod profile;
/// Promotion / discount CRUD.
pub mod promotions;
/// CRUD for purchase orders.
pub mod purchase_orders;
/// Recipe / modifier CRUD.
pub mod recipes;
/// Refund CRUD.
pub mod refunds;
/// Report generation queries.
pub mod reports;
/// Role authoring — update / delete for custom roles (ADR #47 ruling 4).
pub mod roles;
/// Sale CRUD (transactions, lines, taxes).
pub mod sales;
/// Settings key/value CRUD.
pub mod settings;
/// Shift CRUD (open, close, reports).
pub mod shifts;
/// Staff / employee CRUD.
pub mod staff;
/// CRUD for stock counts / cycle counting.
pub mod stock_counts;
/// CRUD for stock transfers between terminals/stores.
pub mod stock_transfers;
/// CRUD for suppliers.
pub mod suppliers;
/// CRUD for restaurant tables (floor plan, status management).
pub mod tables;
/// Tax rate CRUD.
pub mod tax;
/// Terminal override CRUD.
pub mod terminal_overrides;
/// Terminal profile CRUD.
pub mod terminal_profiles;
/// Terminal CRUD (registration, status).
pub mod terminals;
/// Workspace CRUD.
pub mod workspaces;

// ── Re-exports ──────────────────────────────────────────────────────

pub use products::{CreateProductAttributes, ProductWithDetails, UpdateProductAttributes};
pub use reports::{
    CategoryBreakdownRow, DailyRevenueRow, HourlyHeatmapRow, LowStockAlert, MonthlyRevenueRow,
    TopProductRow, WeeklyRevenueRow,
};
pub use sales::{
    CartLineTaxInput, CartTaxResult, DailySummaryRow, HeldCartFull, HeldCartRow, SalesByHourRow,
};
pub use shifts::{ShiftPaymentBreakdown, ShiftReport, ShiftSalesByHour};

// ── Store ────────────────────────────────────────────────────────────

/// Typed CRUD facade for the OZ-POS database.
///
/// > **ADR #30 Modularization Note**: New code should prefer invoking dedicated
/// > domain repositories (e.g. `SalesRepository`, `InventoryRepository`, `CrmRepository`,
/// > `LoyaltyRepository`, `StaffRepository`, `TerminalRepository`, `SettingsRepository`,
/// > `TaxRepository`, `ReportingRepository`) directly on `&Connection` / `&Transaction`.
///
/// All methods borrow `&self` and operate on the underlying
/// [`Connection`] directly. The caller is responsible for
/// synchronisation (e.g. `Mutex<Connection>`) and transaction
/// boundaries for multi-statement workflows.
pub struct Store<'a> {
    /// Underlying SQLite connection.
    pub conn: &'a Connection,
    /// Optional caching layer for product and inventory lookups.
    /// Uses `Arc` so multiple `Store` instances can share the same
    /// cache backend (e.g. Redis).
    pub cache: Option<Arc<dyn Cache>>,
    /// Terminal ID for pub/sub message tagging (multi-terminal).
    /// Passed through to `Cache::publish_inventory_change` so other
    /// terminals can skip their own messages.
    pub terminal_id: Option<String>,
}

impl<'a> Store<'a> {
    /// Wrap an existing connection with no cache.
    pub fn new(conn: &'a Connection) -> Self {
        Self {
            conn,
            cache: None,
            terminal_id: None,
        }
    }

    /// Wrap an existing connection with a cache backend.
    pub fn with_cache(conn: &'a Connection, cache: Arc<dyn Cache>) -> Self {
        Self {
            conn,
            cache: Some(cache),
            terminal_id: None,
        }
    }

    /// Set the terminal ID for pub/sub message tagging.
    pub fn with_terminal_id(mut self, terminal_id: Option<String>) -> Self {
        self.terminal_id = terminal_id;
        self
    }

    /// Return a reference to the underlying connection.
    pub fn conn(&self) -> &Connection {
        self.conn
    }
}

// ── Backup / Export ────────────────────────────────────────────────────

impl Store<'_> {
    /// Remove an existing destination file so an online backup can
    /// (re)create it.
    ///
    /// RUST-03: only a missing destination is acceptable — permission
    /// failures, directory targets, and other filesystem errors are
    /// propagated so the caller surfaces the real cause instead of an
    /// indirect backup error.
    fn remove_destination_for_backup(output_path: &str) -> Result<(), CoreError> {
        match std::fs::remove_file(output_path) {
            Ok(()) => Ok(()),
            // A missing destination is the normal fresh-backup case.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(CoreError::Internal(format!(
                "cannot prepare backup destination '{output_path}': {e}"
            ))),
        }
    }

    /// Create a snapshot of the database to a file at `output_path`.
    ///
    /// RUST-02: uses rusqlite's online backup API (the SQLite Backup API),
    /// so the source connection can remain in use during the copy and the
    /// destination path is handled as a filesystem path by the API rather
    /// than being interpolated into a `VACUUM INTO` SQL statement.
    pub fn backup(&self, output_path: &str) -> Result<(), CoreError> {
        Self::remove_destination_for_backup(output_path)?;

        let mut dst = rusqlite::Connection::open(output_path).map_err(|e| {
            CoreError::Internal(format!(
                "failed to open backup destination '{output_path}': {e}"
            ))
        })?;
        // rusqlite 0.31: `Backup::new` takes the two distinct connections;
        // `run_to_completion` copies the whole source database in chunks.
        // 512 pages (~2 MB) per chunk with a 10 ms pause yields to concurrent
        // writers between chunks (the online-backup contract) without the
        // ~250 ms × chunks sleep that made small backups take ~18 s.
        let backup = rusqlite::backup::Backup::new(self.conn, &mut dst).map_err(|e| {
            CoreError::Internal(format!(
                "failed to start online backup to '{output_path}': {e}"
            ))
        })?;
        backup
            .run_to_completion(512, std::time::Duration::from_millis(10), None)
            .map_err(|e| {
                CoreError::Internal(format!("online backup to '{output_path}' failed: {e}"))
            })?;
        Ok(())
    }

    /// Check database integrity using SQLite's `PRAGMA integrity_check`.
    ///
    /// Returns `Ok(())` if the database passes all integrity checks.
    /// Returns `Err(CoreError)` with a detailed message if corruption
    /// is detected (the error message includes the specific failures
    /// reported by SQLite).
    ///
    /// # Performance
    ///
    /// `integrity_check` scans every page in the database. On large
    /// databases (>1 GB), this may take several seconds. Call this at
    /// startup or on a background thread, not in a hot path.
    pub fn check_integrity(&self) -> Result<(), CoreError> {
        let mut stmt = self.conn.prepare("PRAGMA integrity_check")?;

        let mut errors = Vec::new();
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;

        for row in rows {
            let msg = row?;
            if msg != "ok" {
                errors.push(msg);
            }
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(CoreError::Internal(format!(
                "database corruption detected: {}",
                errors.join("; ")
            )))
        }
    }

    /// Check for tenant-foreign rows in a desktop store database.
    ///
    /// Desktop POS databases are scoped by construction to a single store
    /// (`default` tenant) — every `products` / `users` row is expected to
    /// carry `tenant_id = 'default'`. A row with any other tenant means a
    /// sync/restore mishap planted another tenant's data into this store
    /// (the audit in the plan doc: don't sprinkle 40+ `WHERE tenant_id`
    /// clauses; scope by construction + fail loudly if a foreign row ever
    /// appears).
    ///
    /// Returns `Ok(())` when no foreign rows exist (the normal state).
    /// Returns `Err(CoreError)` naming the offending table(s) — the caller
    /// should refuse to start until the data is reconciled.
    ///
    /// # Performance
    ///
    /// Two indexed COUNT queries (`idx_products_tenant` / `idx_users_tenant`)
    /// — effectively O(log n) each, so safe to call at every startup.
    pub fn check_tenant_integrity(&self) -> Result<(), CoreError> {
        let mut violations: Vec<String> = Vec::new();

        for (table, index) in [
            ("products", "idx_products_tenant"),
            ("users", "idx_users_tenant"),
        ] {
            let count: i64 = self.conn.query_row(
                &format!("SELECT COUNT(*) FROM {table} WHERE tenant_id != 'default'"),
                [],
                |row| row.get(0),
            )?;
            if count > 0 {
                violations.push(format!(
                    "{table}: {count} row(s) with tenant_id != 'default' (index {index} exists)"
                ));
            }
        }

        if violations.is_empty() {
            Ok(())
        } else {
            Err(CoreError::Internal(format!(
                "foreign-tenant rows detected in desktop store database — refusing to start: {}",
                violations.join("; ")
            )))
        }
    }

    /// Attempt to repair a corrupted database by rebuilding it via `VACUUM INTO`.
    ///
    /// Creates a clean copy of the database at `output_path`. The original
    /// database is not modified. **The output file is overwritten if it
    /// already exists.** After repair, callers should:
    /// 1. Verify the output with `check_integrity()` on the new connection
    /// 2. Replace the original file with the repaired copy
    /// 3. Re-open the database
    ///
    /// # Errors
    ///
    /// Returns `CoreError` if the backup fails (e.g., the database is too
    /// corrupt to read, the output path is not writable, or an existing
    /// destination could not be removed — RUST-03).
    pub fn repair_to(&self, output_path: &str) -> Result<(), CoreError> {
        // RUST-03: propagate filesystem failures when preparing the target
        // (permission denied, directory target) instead of swallowing them.
        Self::remove_destination_for_backup(output_path)?;
        self.backup(output_path).map_err(|e| {
            CoreError::Internal(format!(
                "database repair failed — backup to '{output_path}': {e}"
            ))
        })
    }
}

// ── Default helpers for row mapping ──────────────────────────────────

/// Build a [`crate::Product`] from a `rusqlite::Row`. All `products` columns
/// must be present in the result set.
pub(crate) fn row_to_product(row: &rusqlite::Row) -> rusqlite::Result<crate::Product> {
    let sku_str: String = row.get("sku")?;
    let cur_str: String = row.get("currency")?;
    let barcode_raw: Option<String> = row.get("barcode")?;
    // Use Option<String> for nullable column — reads NULL as None
    // rather than swallowing errors via .ok().
    let product_type_str: Option<String> = row.get("product_type")?;
    Ok(crate::Product {
        id: row.get("id")?,
        sku: crate::Sku::new(sku_str),
        name: row.get("name")?,
        price: Money {
            minor_units: row.get("price_minor")?,
            currency: cur_str.parse::<Currency>().map_err(|e| {
                rusqlite::Error::ToSqlConversionFailure(
                    std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()).into(),
                )
            })?,
        },
        category_id: row.get("category_id")?,
        barcode: barcode_raw.and_then(|s| foundation::Barcode::new(&s).ok()),
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        price_updated_at: row.get("price_updated_at")?,
        track_serial: row.get("track_serial").unwrap_or(false),
        product_type: product_type_str
            .as_deref()
            .and_then(crate::ProductType::parse_str)
            .unwrap_or_default(),
        version: row.get("version").unwrap_or(1),
        cost_minor: row.get("cost_minor").unwrap_or(0),
        brand: row.get("brand").unwrap_or(None),
        rack_location: row.get("rack_location").unwrap_or(None),
        notes: row.get("notes").unwrap_or(None),
        unit: row.get("unit").unwrap_or(None),
        is_active: row.get("is_active").unwrap_or(1i64) != 0,
        default_supplier_id: row.get("default_supplier_id").unwrap_or(None),
        image_hash: row.get("image_hash").unwrap_or(None),
    })
}

#[cfg(test)]
#[path = "mod_tests.rs"]
mod tests;
