use super::*;
use rusqlite::Connection;

fn fresh() -> Connection {
    kasirmu_core::migrations::fresh_db()
}

// MSL-7 fixed: the query uses the real 	ax_total_minor column, so no
// ALTER TABLE shim is needed anymore.

fn seed_sale(conn: &Connection, id: &str, total: i64, status: &str, date: &str) {
    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at)
         VALUES (?1, ?2, 'USD', 1, ?3, ?4, ?4)",
        rusqlite::params![id, total, status, date],
    )
    .unwrap();
}

#[test]
fn daily_report_empty_date_returns_zeroes() {
    let conn = fresh();
    let repo = ReportingRepository::new(&conn);
    let report = repo.generate_daily_report("2025-01-01").unwrap();
    assert_eq!(report.total_sales_count, 0);
    assert_eq!(report.total_revenue.minor_units, 0);
    assert_eq!(report.total_tax.minor_units, 0);
    assert_eq!(report.date, "2025-01-01");
}

#[test]
fn daily_report_counts_completed_sales() {
    let conn = fresh();
    seed_sale(&conn, "s-1", 1000, "completed", "2025-06-15T10:00:00.000Z");
    conn.execute(
        "UPDATE sales SET tax_total_minor = 100 WHERE id = 's-1'",
        [],
    )
    .unwrap();
    seed_sale(&conn, "s-2", 2000, "completed", "2025-06-15T14:00:00.000Z");
    conn.execute(
        "UPDATE sales SET tax_total_minor = 200 WHERE id = 's-2'",
        [],
    )
    .unwrap();
    let repo = ReportingRepository::new(&conn);

    let report = repo.generate_daily_report("2025-06-15").unwrap();
    assert_eq!(report.total_sales_count, 2);
    assert_eq!(report.total_revenue.minor_units, 3000);
    assert_eq!(report.total_tax.minor_units, 300);
}

#[test]
fn daily_report_ignores_other_dates() {
    let conn = fresh();
    seed_sale(&conn, "s-1", 1000, "completed", "2025-06-15T10:00:00.000Z");
    seed_sale(&conn, "s-2", 2000, "completed", "2025-06-16T10:00:00.000Z");
    let repo = ReportingRepository::new(&conn);

    let report = repo.generate_daily_report("2025-06-15").unwrap();
    assert_eq!(report.total_sales_count, 1);
    assert_eq!(report.total_revenue.minor_units, 1000);
}

#[test]
fn daily_report_ignores_non_completed_sales() {
    let conn = fresh();
    seed_sale(&conn, "s-1", 1000, "completed", "2025-06-15T10:00:00.000Z");
    seed_sale(&conn, "s-2", 5000, "voided", "2025-06-15T12:00:00.000Z");
    seed_sale(&conn, "s-3", 3000, "active", "2025-06-15T13:00:00.000Z");
    let repo = ReportingRepository::new(&conn);

    let report = repo.generate_daily_report("2025-06-15").unwrap();
    assert_eq!(report.total_sales_count, 1);
    assert_eq!(report.total_revenue.minor_units, 1000);
}

#[test]
fn daily_report_has_generated_at() {
    let conn = fresh();
    let repo = ReportingRepository::new(&conn);
    let report = repo.generate_daily_report("2025-01-01").unwrap();
    assert!(!report.generated_at.is_empty());
}
