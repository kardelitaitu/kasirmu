//! Unit tests for the sales-history DTOs and session rejection (test
//! relocation: moved out of `apps/desktop-tauri/src/commands/history_tests.rs`).
//!
//! Mounted at the foot of `history.rs` with `#[cfg(test)] #[path]`, so
//! `use super::*` resolves the DTOs from the bridge module directly. The
//! three token-rejection tests drive `BridgeCtx::resolve_session` through
//! the headless `TestBridge` harness instead of the tauri `AppState`.

use super::*;
use crate::testing::TestBridge;
use foundation::{Currency, Money};
use kasirmu_core::SaleLine;
use kasirmu_core::refund::Refund;

fn usd() -> Currency {
    "USD".parse().unwrap()
}

fn price(minor: i64) -> Money {
    Money {
        minor_units: minor,
        currency: usd(),
    }
}

fn make_sale_line(sale_id: &str, sku: &str, qty: i64, unit: i64) -> SaleLine {
    SaleLine {
        id: uuid::Uuid::now_v7().to_string(),
        sale_id: sale_id.into(),
        sku: sku.into(),
        qty,
        unit_price: price(unit),
        line_total: price(unit * qty),
        line_position: 1,
        tax_amount: Money::zero(usd()),
        tax_rate_id: None,
        tax_breakdown_json: None,
        serial_number: None,
        course: None,
        modifiers_json: None,
    }
}

// ── SaleListItem ───────────────────────────────────────────────────

#[test]
fn sale_list_item_debug() {
    let item = SaleListItem {
        id: "s1".into(),
        total: price(5000),
        line_count: 3,
        status: "completed".into(),
        payment_method: Some("cash".into()),
        user_id: Some("u1".into()),
        created_at: "2025-01-01".into(),
        display_code: None,
    };
    let d = format!("{item:?}");
    assert!(d.contains("s1"));
    assert!(d.contains("5000"));
    assert!(d.contains("completed"));
}

// ── F2-7: the estimate note rides the detail DTO ───────────────────

fn make_detail(note: Option<String>) -> SaleDetail {
    SaleDetail {
        id: "s-est".into(),
        total: price(770),
        subtotal: price(700),
        tax_total: price(70),
        line_count: 1,
        status: "Pending".into(),
        payment_method: Some("cash".into()),
        tendered_minor: Some(770),
        user_id: None,
        created_at: "2026-09-10T00:00:00.000Z".into(),
        lines: vec![],
        tax_estimate_note: note,
        display_code: None,
    }
}

#[test]
fn sale_detail_carries_the_estimate_stamp_when_claimed() {
    let json = serde_json::to_value(make_detail(Some(
        "{\"estimated\":true,\"computed_tax\":70}".into(),
    )))
    .unwrap();
    assert_eq!(
        json["taxEstimateNote"], "{\"estimated\":true,\"computed_tax\":70}",
        "the badge source rides the wire camelCase"
    );
}

#[test]
fn sale_detail_serializes_null_when_unstamped() {
    let json = serde_json::to_value(make_detail(None)).unwrap();
    assert!(
        json["taxEstimateNote"].is_null(),
        "NULL = unstamped — absence must never read as a claim"
    );
}

#[test]
fn sale_list_item_serialize() {
    let item = SaleListItem {
        id: "s2".into(),
        total: price(7500),
        line_count: 1,
        status: "voided".into(),
        payment_method: None,
        user_id: None,
        created_at: "2025-06-01".into(),
        display_code: None,
    };
    let json = serde_json::to_value(&item).unwrap();
    assert_eq!(json["id"], "s2");
    assert_eq!(json["status"], "voided");
    assert!(json["payment_method"].is_null());
}

// ── SaleDetail ──────────────────────────────────────────────────────

#[test]
fn sale_detail_debug() {
    let detail = SaleDetail {
        id: "sd1".into(),
        total: price(10000),
        subtotal: price(10000),
        tax_total: Money::zero(usd()),
        line_count: 2,
        status: "completed".into(),
        payment_method: Some("card".into()),
        tendered_minor: Some(12000),
        user_id: Some("u2".into()),
        created_at: "2025-03-15".into(),
        lines: vec![make_sale_line("sd1", "SKU-A", 2, 5000)],
        tax_estimate_note: None,
        display_code: None,
    };
    let d = format!("{detail:?}");
    assert!(d.contains("sd1"));
    assert!(d.contains("SKU-A"));
}

#[test]
fn sale_detail_serialize() {
    let detail = SaleDetail {
        id: "sd2".into(),
        total: price(3000),
        subtotal: price(3000),
        tax_total: Money::zero(usd()),
        line_count: 1,
        status: "completed".into(),
        payment_method: None,
        tendered_minor: None,
        user_id: None,
        created_at: "2025-01-01".into(),
        lines: vec![],
        tax_estimate_note: None,
        display_code: None,
    };
    let json = serde_json::to_value(&detail).unwrap();
    assert_eq!(json["id"], "sd2");
    assert!(
        json["paymentMethod"].is_null(),
        "camelCase wire: paymentMethod"
    );
    assert!(
        json["tenderedMinor"].is_null(),
        "camelCase wire: tenderedMinor"
    );
    assert!(
        json["taxEstimateNote"].is_null(),
        "camelCase wire: taxEstimateNote"
    );
    assert_eq!(json["lines"].as_array().unwrap().len(), 0);
}

// ── PaymentBreakdown ────────────────────────────────────────────────

#[test]
fn payment_breakdown_debug() {
    let pb = PaymentBreakdown {
        method: "cash".into(),
        count: 15,
        total: 50000,
    };
    let d = format!("{pb:?}");
    assert!(d.contains("cash"));
    assert!(d.contains("15"));
}

#[test]
fn payment_breakdown_serialize() {
    let pb = PaymentBreakdown {
        method: "card".into(),
        count: 42,
        total: 120000,
    };
    let json = serde_json::to_value(&pb).unwrap();
    assert_eq!(json["method"], "card");
    assert_eq!(json["count"], 42);
    assert_eq!(json["total"], 120000);
}

// ── EodReport ───────────────────────────────────────────────────────

#[test]
fn eod_report_debug() {
    let report = EodReport {
        total_sales: 100,
        total_revenue: 500000,
        currency: "IDR".into(),
        payment_breakdown: vec![],
        void_count: 3,
        void_total: 15000,
        discount_count: 10,
        discount_total: 25000,
        hourly_breakdown: vec![],
    };
    let d = format!("{report:?}");
    assert!(d.contains("100"));
    assert!(d.contains("IDR"));
}

#[test]
fn eod_report_serialize() {
    let report = EodReport {
        total_sales: 50,
        total_revenue: 250000,
        currency: "USD".into(),
        payment_breakdown: vec![PaymentBreakdown {
            method: "cash".into(),
            count: 30,
            total: 150000,
        }],
        void_count: 1,
        void_total: 5000,
        discount_count: 5,
        discount_total: 10000,
        hourly_breakdown: vec![],
    };
    let json = serde_json::to_value(&report).unwrap();
    assert_eq!(json["total_sales"], 50);
    assert_eq!(json["currency"], "USD");
    assert!(!json["payment_breakdown"].as_array().unwrap().is_empty());
}

// ── Session token rejection tests ─────────────────────────────────

#[test]
fn list_sales_scoped_rejects_invalid_token() {
    let tb = TestBridge::new();
    let ctx = tb.ctx();
    let result = ctx.resolve_session("nonexistent-token");
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

#[test]
fn get_sale_scoped_rejects_invalid_token() {
    let tb = TestBridge::new();
    let ctx = tb.ctx();
    let result = ctx.resolve_session("bad-token");
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

#[test]
fn export_reports_scoped_reject_invalid_token() {
    let tb = TestBridge::new();
    let ctx = tb.ctx();
    let result = ctx.resolve_session("nonexistent-token");
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

// ── C5: the EOD sheet's header and body share one day definition ───

/// C5. `build_eod_report` used to derive the header from the store-local
/// daily summary (REP-03: `DATE(created_at, tz) = DATE(now, tz)`) while every
/// money sub-query underneath it used bare `date(created_at) = date('now')`
/// — the UTC day. On a fixture carrying a refund AND a void, the two halves
/// must now agree, and the void must stay out of revenue while remaining
/// reported.
#[test]
fn eod_report_reconciles_on_a_refund_and_void_fixture() {
    let conn = crate::testing::temp_conn();
    let store = Store::new(&conn);

    let sale = |total: i64, status: &str, method: &str, discount: i64| {
        conn.execute(
            "INSERT INTO sales (id, total_minor, currency, line_count, status, payment_method, discount_percent, created_at, updated_at)
             VALUES (?1, ?2, 'USD', 1, ?3, ?4, ?5, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            rusqlite::params![uuid::Uuid::now_v7().to_string(), total, status, method, discount],
        )
        .expect("seed sale");
    };

    // Revenue: one discounted cash sale (later partly refunded) and one card sale.
    sale(5_000, "completed", "cash", 10);
    sale(2_000, "completed", "card", 0);
    // Not revenue: a voided sale (it keeps its total_minor) and a pending one.
    sale(9_000, "voided", "cash", 0);
    sale(7_000, "pending", "cash", 0);

    // The refund itself goes through the real path, so this fixture is not a
    // hand-written status the product could never produce.
    let completed_cash_id: String = conn
        .query_row(
            "SELECT id FROM sales WHERE status = 'completed' AND payment_method = 'cash'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    store
        .create_refund(&Refund::new(
            &completed_cash_id,
            Money {
                minor_units: 1_000,
                currency: usd(),
            },
            "C5 fixture",
            "",
            "user-1",
            vec![],
        ))
        .expect("a refund against a completed sale must succeed");

    let report = build_eod_report(&conn).expect("EOD report");

    // Header: completed sales only — not the void, not the pending row.
    assert_eq!(
        report.total_sales, 2,
        "header counts the two completed sales"
    );
    assert_eq!(
        report.total_revenue, 7_000,
        "a voided sale must not change total_revenue"
    );

    // Body: the payment breakdown sums to exactly the header. This is the
    // reconciliation that failed while the two halves used different days.
    let paid: i64 = report.payment_breakdown.iter().map(|p| p.total).sum();
    assert_eq!(
        paid, report.total_revenue,
        "header and payment breakdown must agree on one sheet"
    );
    let paid_count: i64 = report.payment_breakdown.iter().map(|p| p.count).sum();
    assert_eq!(paid_count, report.total_sales);

    // The void is excluded from revenue but still on the sheet, exactly once.
    assert_eq!(report.void_count, 1);
    assert_eq!(report.void_total, 9_000);
    assert!(
        report.void_total > 0 && !report.payment_breakdown.iter().any(|p| p.total == 9_000),
        "the void's money must appear as a void, never inside the breakdown"
    );

    // Discount is a slice of revenue, not a fourth number.
    assert_eq!(report.discount_count, 1);
    assert!(
        report.discount_total > 0 && report.discount_total <= report.total_revenue,
        "discount {} must sit inside revenue {}",
        report.discount_total,
        report.total_revenue
    );
}
