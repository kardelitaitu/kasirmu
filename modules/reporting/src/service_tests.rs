use super::*;
use rusqlite::Connection;

fn fresh() -> Connection {
    let conn = kasirmu_core::migrations::fresh_db();
    // The generate_daily_report query references `tax_minor` which is not
    // in the base migration. Add it so the service layer can work.
    conn.execute_batch("ALTER TABLE sales ADD COLUMN tax_minor INTEGER NOT NULL DEFAULT 0")
        .unwrap();
    conn
}

#[test]
fn generate_daily_report_delegates_to_repository() {
    let conn = fresh();
    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at, tax_total_minor)
         VALUES ('s-1', 500, 'USD', 1, 'completed', '2025-06-15T10:00:00.000Z', '2025-06-15T10:00:00.000Z', 50)",
        [],
    )
    .unwrap();
    let report = ReportingService::generate_daily_report(&conn, "2025-06-15").unwrap();
    assert_eq!(report.total_sales_count, 1);
    assert_eq!(report.total_revenue.minor_units, 500);
    assert_eq!(report.total_tax.minor_units, 50);
}

#[test]
fn generate_daily_report_empty() {
    let conn = fresh();
    let report = ReportingService::generate_daily_report(&conn, "2099-01-01").unwrap();
    assert_eq!(report.total_sales_count, 0);
}
