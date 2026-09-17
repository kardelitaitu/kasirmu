/*
last audited 25-07-26 by RSA-Agent (modules-reporting slice A: handlers deep read)
crate: modules-reporting | status: SAFE | lint: CLEAN
findings: MSL-8 FIXED — the insert is idempotent (INSERT..SELECT WHERE NOT EXISTS on sale_id; replayed events are logged and skipped), so a replayed sale.completed double-counts revenue in the reporting store (corpus pattern elsewhere is pre-check plus unique index); plus the lazy CREATE TABLE DDL executes on EVERY event (wasted prepare per sale). Refunded sales also remain in report revenue (no refund event exists) - product decision to confirm. Handler is otherwise clean (parameterized, tx-free single insert)
next: add UNIQUE(sale_id) with INSERT OR IGNORE, hoist DDL to migration or first-use | perf: DDL per event
*/
//! Event handlers for the Reporting module.
//!
//! These handlers respond to domain events published on the kernel
//! event bus. Each handler holds a reference to the shared database
//! connection so it can perform side effects atomically.

use std::sync::{Arc, Mutex};

use crate::error::ReportingError;
use foundation::contracts::{EventHandler, ModuleResult};
use foundation::events::SaleCompleted;
use rusqlite::Connection;
use tracing::info;

/// Handler that captures sale data when a sale completes.
///
/// For each `sale.completed` event, this handler inserts a row into
/// the `report_sales` table with the sale ID, total, currency,
/// customer ID (if any), and timestamp. This populates the report
/// data store so that downstream reporting queries (daily summaries,
/// hourly trends, exports) can operate without hitting the live
/// sales tables.
///
/// If the table does not exist yet, the handler creates it lazily.
#[derive(Debug)]
pub struct SaleCompletedReporter {
    db: Arc<Mutex<Connection>>,
}

impl SaleCompletedReporter {
    /// Create a new handler with a shared database connection.
    pub fn new(db: Arc<Mutex<Connection>>) -> Self {
        Self { db }
    }

    /// Ensure the `report_sales` table exists.
    fn ensure_table(&self, conn: &Connection) -> Result<(), ReportingError> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS report_sales (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                sale_id     TEXT    NOT NULL,
                total_minor INTEGER NOT NULL,
                currency    TEXT    NOT NULL,
                customer_id TEXT,
                line_items  TEXT    NOT NULL DEFAULT '[]',
                created_at  TEXT    NOT NULL
            );",
        )?;
        Ok(())
    }
}

impl EventHandler<SaleCompleted> for SaleCompletedReporter {
    fn handle(&self, event: &SaleCompleted) -> ModuleResult {
        let conn = self
            .db
            .lock()
            .map_err(|e| anyhow::anyhow!("reporting handler: db lock failed: {e}"))?;

        // Ensure the report table exists (lazy creation).
        self.ensure_table(&conn)?;

        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

        // Serialize line items to JSON for storage.
        let line_items_json = serde_json::to_string(&event.line_items).map_err(|e| {
            anyhow::anyhow!("reporting handler: failed to serialize line items: {e}")
        })?;

        // MSL-8 fix: idempotent insert — `report_sales` has no
        // UNIQUE(sale_id) constraint, so a replayed `sale.completed`
        // event (redelivery, retry, offline re-sync) previously
        // double-counted revenue. The single-statement INSERT..SELECT
        // WHERE NOT EXISTS is atomic under the connection mutex and
        // works for both fresh and legacy tables (which may already
        // contain duplicate rows, so a UNIQUE index creation could
        // fail).
        let inserted = conn.execute(
            "INSERT INTO report_sales (sale_id, total_minor, currency, customer_id, line_items, created_at)
             SELECT ?1, ?2, ?3, ?4, ?5, ?6
             WHERE NOT EXISTS (SELECT 1 FROM report_sales WHERE sale_id = ?1)",
            rusqlite::params![
                event.sale_id,
                event.total_minor,
                event.currency,
                event.customer_id,
                line_items_json,
                now,
            ],
        )?;

        if inserted == 0 {
            tracing::warn!(
                sale_id = %event.sale_id,
                "reporting handler: duplicate sale.completed ignored (already reported)"
            );
        }

        info!(
            sale_id = %event.sale_id,
            total_minor = event.total_minor,
            currency = %event.currency,
            "reporting handler: sale recorded for reporting"
        );

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use kasirmu_core::events::SaleCompletedLine;
    use kasirmu_core::migrations;
    use platform_kernel::EventBus;

    fn fresh_db() -> Arc<Mutex<Connection>> {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrations::run(&mut conn).unwrap();
        Arc::new(Mutex::new(conn))
    }

    #[test]
    fn handler_records_sale_in_report_table() {
        let db = fresh_db();
        let handler = SaleCompletedReporter::new(db.clone());

        let event = SaleCompleted {
            sale_id: "sale-1".into(),
            store_id: None,
            line_items: vec![SaleCompletedLine {
                sku: "COFFEE".into(),
                qty: 2,
                unit_price_minor: 350,
                tax_minor: 0,
                tax_rate_id: None,
            }],
            total_minor: 700,
            currency: "USD".into(),
            customer_id: Some("cust-1".into()),
        };

        handler.handle(&event).unwrap();

        // Verify the row was inserted.
        let conn = db.lock().unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM report_sales", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);

        let (sale_id, total_minor, currency, customer_id): (String, i64, String, Option<String>) =
            conn.query_row(
                "SELECT sale_id, total_minor, currency, customer_id FROM report_sales WHERE sale_id = ?1",
                ["sale-1"],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(sale_id, "sale-1");
        assert_eq!(total_minor, 700);
        assert_eq!(currency, "USD");
        assert_eq!(customer_id, Some("cust-1".into()));
    }

    #[test]
    fn handler_records_multiple_sales() {
        let db = fresh_db();
        let handler = SaleCompletedReporter::new(db.clone());

        let event1 = SaleCompleted {
            sale_id: "sale-a".into(),
            store_id: None,
            line_items: vec![],
            total_minor: 100,
            currency: "USD".into(),
            customer_id: None,
        };

        let event2 = SaleCompleted {
            sale_id: "sale-b".into(),
            store_id: None,
            line_items: vec![],
            total_minor: 200,
            currency: "EUR".into(),
            customer_id: Some("cust-2".into()),
        };

        handler.handle(&event1).unwrap();
        handler.handle(&event2).unwrap();

        let conn = db.lock().unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM report_sales", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn handler_replayed_sale_event_is_idempotent() {
        // MSL-8 fix: a replayed sale.completed (redelivery, retry,
        // offline re-sync) must not double-count revenue.
        let db = fresh_db();
        let handler = SaleCompletedReporter::new(db.clone());

        let event = SaleCompleted {
            sale_id: "sale-replay".into(),
            store_id: None,
            line_items: vec![],
            total_minor: 500,
            currency: "USD".into(),
            customer_id: None,
        };

        handler.handle(&event).unwrap();
        handler.handle(&event).unwrap();
        handler.handle(&event).unwrap();

        let conn = db.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM report_sales WHERE sale_id = ?1",
                ["sale-replay"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);

        let total: i64 = conn
            .query_row(
                "SELECT SUM(total_minor) FROM report_sales WHERE sale_id = ?1",
                ["sale-replay"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(total, 500);
    }

    #[test]
    fn handler_works_with_event_bus() {
        let db = fresh_db();
        let bus = EventBus::new();
        let handler = SaleCompletedReporter::new(db.clone());
        bus.subscribe("sale.completed", Box::new(handler));

        let event = SaleCompleted {
            sale_id: "sale-3".into(),
            store_id: None,
            line_items: vec![SaleCompletedLine {
                sku: "TEA".into(),
                qty: 1,
                unit_price_minor: 250,
                tax_minor: 0,
                tax_rate_id: None,
            }],
            total_minor: 250,
            currency: "USD".into(),
            customer_id: None,
        };

        bus.publish(&event).unwrap();

        let conn = db.lock().unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM report_sales", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);

        let total: i64 = conn
            .query_row(
                "SELECT total_minor FROM report_sales WHERE sale_id = ?1",
                ["sale-3"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(total, 250);
    }

    #[test]
    fn handler_stores_line_items_as_json() {
        let db = fresh_db();
        let handler = SaleCompletedReporter::new(db.clone());

        let event = SaleCompleted {
            sale_id: "sale-4".into(),
            store_id: None,
            line_items: vec![
                SaleCompletedLine {
                    sku: "BURGER".into(),
                    qty: 2,
                    unit_price_minor: 500,
                    tax_minor: 0,
                    tax_rate_id: None,
                },
                SaleCompletedLine {
                    sku: "FRIES".into(),
                    qty: 1,
                    unit_price_minor: 300,
                    tax_minor: 0,
                    tax_rate_id: None,
                },
            ],
            total_minor: 1300,
            currency: "USD".into(),
            customer_id: None,
        };

        handler.handle(&event).unwrap();

        let conn = db.lock().unwrap();
        let line_items_json: String = conn
            .query_row(
                "SELECT line_items FROM report_sales WHERE sale_id = ?1",
                ["sale-4"],
                |row| row.get(0),
            )
            .unwrap();

        let parsed: serde_json::Value =
            serde_json::from_str(&line_items_json).expect("line_items should be valid JSON");
        let arr = parsed.as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0]["sku"], "BURGER");
        assert_eq!(arr[0]["qty"], 2);
        assert_eq!(arr[1]["sku"], "FRIES");
        assert_eq!(arr[1]["qty"], 1);
    }
}
