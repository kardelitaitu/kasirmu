//! Sales Repository — database persistence layer for sales, held carts, and refunds.
/*
last audited 25-07-26 by RSA-Agent (modules-sales slice A: repository deep read)
crate: modules-sales | status: SAFE | lint: CLEAN
findings: MSL-1 FIXED — get_sale now fails closed on an unrecognized stored status (SalesError::validation; the previous unwrap_or(Pending) turned a corrupted status into an editable pending sale): a corrupted status string becomes an editable pending sale that can be transitioned and re-processed; contrast foundation's fail-closed from_stored_str (returns None). Proposed: return SalesError::validation on unrecognized status (use foundation SaleStatus::from_stored_str). Also note the write/read asymmetry: status stored via serde_json to_string then trim_quotes, read via re-quote — works but obscures intent. Otherwise clean: all SQL parameterized, currency parse fails closed, legacy-row column defaults documented, update_sale_status bumps version, lines ordered by position, tx-scoped inserts
next: fix MSL-1 in the fix-order phase | perf: prepared statements per call
*/

use crate::error::SalesError;
use foundation::{Currency, Money, SaleStatus};
use kasirmu_core::db::Store;
use kasirmu_core::db::namespaced::{Grants, ModuleId, NamespacedStore};
use rusqlite::{Connection, Transaction, params};

use crate::models::{Sale, SaleLine};

/// The sales module's own namespace id, as the ownership map names it.
const OWNER: ModuleId = ModuleId("sales");

/// The module's own manifest, embedded so the runtime grant set is derived from
/// the same declaration the governance checker reads (Phase 4 P4.1 item 2).
const MANIFEST: &str = include_str!("../manifest.json");

/// Database access repository for sales data.
///
/// Phase 3 P3.2: reaches the database through a [`NamespacedStore`] scoped to the
/// `sales` namespace rather than a bare `&Connection`, so every statement is
/// checked against `modules/ownership.json` before it runs. `sales` owns both
/// `sales` and `sale_lines` and declares no foreign read, so its embedded
/// manifest (Phase 4 P4.1) yields no grant.
pub struct SalesRepository<'a> {
    ns: NamespacedStore<'a>,
}

impl<'a> SalesRepository<'a> {
    /// Create a new `SalesRepository` borrowing a SQLite connection.
    pub fn new(conn: &'a Connection) -> Self {
        Self {
            ns: NamespacedStore::new(
                Store::new(conn),
                OWNER,
                Grants::from_manifest_json(OWNER, MANIFEST),
            ),
        }
    }

    /// Retrieve a sale by ID including its line items.
    pub fn get_sale(&self, id: &str) -> Result<Option<Sale>, SalesError> {
        let rows = self.ns.own().query_try(
            "SELECT id, status, total_minor, line_count, currency, payment_method, tendered_minor, user_id, created_at, updated_at, discount_percent, discount_label, subtotal_minor, tax_total_minor, customer_id, version, base_currency, base_total_minor, tender_rate_millionths, tip_minor, service_charge_minor
             FROM sales WHERE id = ?1",
            rusqlite::params![id],
            Self::map_sale_row,
        )?;
        let Some(mut sale) = rows.into_iter().next() else {
            return Ok(None);
        };
        sale.lines = self.load_lines(id, sale.currency)?;
        Ok(Some(sale))
    }

    /// Map a `sales` row into a [`Sale`]; line items are loaded separately
    /// ([`load_lines`](Self::load_lines)) because they need the sale's currency.
    fn map_sale_row(row: &rusqlite::Row<'_>) -> Result<Sale, SalesError> {
        let currency_str: String = row.get(4)?;
        let currency: Currency = currency_str.parse().map_err(|_| {
            SalesError::validation("currency", format!("invalid currency code: {currency_str}"))
        })?;

        let status_str: String = row.get(1)?;
        // MSL-1 fix: fail closed on an unrecognized stored status. The
        // previous `unwrap_or(SaleStatus::Pending)` turned a corrupted or
        // hostile status string into an editable pending sale that the
        // state machine would then happily transition.
        let status: SaleStatus = SaleStatus::from_stored_str(&status_str).ok_or_else(|| {
            SalesError::validation(
                "status",
                format!("unrecognized stored sale status: {status_str}"),
            )
        })?;

        let total_minor: i64 = row.get(2)?;
        let total = Money {
            minor_units: total_minor,
            currency,
        };

        let subtotal_minor: i64 = row.get(12).unwrap_or(total_minor);
        let subtotal = Money {
            minor_units: subtotal_minor,
            currency,
        };

        let tax_total_minor: i64 = row.get(13).unwrap_or(0);
        let tax_total = Money {
            minor_units: tax_total_minor,
            currency,
        };

        Ok(Sale {
            id: row.get(0)?,
            status,
            total,
            line_count: row.get(3)?,
            currency,
            payment_method: row.get(5)?,
            tendered_minor: row.get(6)?,
            user_id: row.get(7)?,
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
            // Line items are loaded by get_sale (they need the sale's currency);
            // the mapper stands alone so it can run inside query_try.
            lines: Vec::new(),
            discount_percent: row.get(10).unwrap_or(0),
            discount_label: row.get(11)?,
            subtotal,
            tax_total,
            customer_id: row.get(14)?,
            // CUR-02: multi-currency tender fields (nullable — None for
            // single-currency sales, matching the migration defaults).
            base_currency: row.get(16)?,
            base_total_minor: row.get(17)?,
            tender_rate_millionths: row.get(18)?,
            // Tip and service charge (default 0 for backward compatibility).
            tip_minor: row.get(19).unwrap_or(0),
            service_charge_minor: row.get(20).unwrap_or(0),
            version: row.get(15).unwrap_or(1),
        })
    }

    /// Load a sale's line items, in position order.
    fn load_lines(&self, id: &str, currency: Currency) -> Result<Vec<SaleLine>, SalesError> {
        self.ns.own().query_try(
            "SELECT id, sale_id, sku, qty, unit_minor, line_minor, line_position, tax_minor, tax_rate_id, tax_breakdown_json, serial_number, course, modifiers_json
             FROM sale_lines WHERE sale_id = ?1 ORDER BY line_position ASC",
            rusqlite::params![id],
            |r| {
                let unit_minor: i64 = r.get(4)?;
                let line_minor: i64 = r.get(5)?;
                let tax_amount_minor: i64 = r.get(7).unwrap_or(0);

                Ok(SaleLine {
                    id: r.get(0)?,
                    sale_id: r.get(1)?,
                    sku: r.get(2)?,
                    qty: r.get(3)?,
                    unit_price: Money {
                        minor_units: unit_minor,
                        currency,
                    },
                    line_total: Money {
                        minor_units: line_minor,
                        currency,
                    },
                    line_position: r.get(6)?,
                    tax_amount: Money {
                        minor_units: tax_amount_minor,
                        currency,
                    },
                    tax_rate_id: r.get(8)?,
                    tax_breakdown_json: r.get(9)?,
                    serial_number: r.get(10)?,
                    course: r.get(11)?,
                    modifiers_json: r.get(12)?,
                })
            },
        )
    }

    /// Insert a new sale and its line items inside a transaction.
    pub fn create_sale_tx(&self, tx: &Transaction, sale: &Sale) -> Result<(), SalesError> {
        let status_str = serde_json::to_string(&sale.status)?
            .trim_matches('"')
            .to_string();
        // A transaction is a property of the connection, so a store built over
        // the passed `tx` writes inside the caller's transaction while still
        // running the namespace check.
        let ns = NamespacedStore::new(
            Store::new(tx),
            OWNER,
            Grants::from_manifest_json(OWNER, MANIFEST),
        );
        ns.own().execute(
            "INSERT INTO sales (id, status, total_minor, line_count, currency, payment_method, tendered_minor, user_id, created_at, updated_at, discount_percent, discount_label, subtotal_minor, tax_total_minor, customer_id, version, base_currency, base_total_minor, tender_rate_millionths, tip_minor, service_charge_minor)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)",
            params![
                sale.id,
                status_str,
                sale.total.minor_units,
                sale.line_count,
                sale.currency.to_string(),
                sale.payment_method,
                sale.tendered_minor,
                sale.user_id,
                sale.created_at,
                sale.updated_at,
                sale.discount_percent,
                sale.discount_label,
                sale.subtotal.minor_units,
                sale.tax_total.minor_units,
                sale.customer_id,
                sale.version,
                sale.base_currency,
                sale.base_total_minor,
                sale.tender_rate_millionths,
                sale.tip_minor,
                sale.service_charge_minor,
            ],
        )?;

        for line in &sale.lines {
            ns.own().execute(
                "INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, line_position, tax_minor, tax_rate_id, tax_breakdown_json, serial_number, course, modifiers_json, currency)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                params![
                    line.id,
                    line.sale_id,
                    line.sku,
                    line.qty,
                    line.unit_price.minor_units,
                    line.line_total.minor_units,
                    line.line_position,
                    line.tax_amount.minor_units,
                    line.tax_rate_id,
                    line.tax_breakdown_json,
                    line.serial_number,
                    line.course,
                    line.modifiers_json,
                    line.unit_price.currency.to_string(),
                ],
            )?;
        }

        Ok(())
    }

    /// Update sale status.
    pub fn update_sale_status(&self, id: &str, status: SaleStatus) -> Result<(), SalesError> {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let status_str = serde_json::to_string(&status)?
            .trim_matches('"')
            .to_string();
        self.ns.own().execute(
            "UPDATE sales SET status = ?1, updated_at = ?2, version = version + 1 WHERE id = ?3",
            params![status_str, now, id],
        )?;
        Ok(())
    }
}

#[cfg(test)]
#[path = "repository_tests.rs"]
mod tests;
