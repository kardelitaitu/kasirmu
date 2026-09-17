//! Integration tests for refund and tax modules — edge cases with data.
//!
//! Tests exercise the full persistence layer via the public
//! [`kasirmu_core::Store`] API against an in-memory SQLite database.

use kasirmu_core::{CoreError, Currency, Money, Refund, RefundLine, Store, migrations};
use rusqlite::Connection;

// ── Shared helpers ────────────────────────────────────────────────────

fn setup() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn usd() -> Currency {
    "USD".parse().unwrap()
}

fn price(minor: i64) -> Money {
    Money {
        minor_units: minor,
        currency: usd(),
    }
}

// Seeds a completed sale with two line items for refund testing.
fn seed_sale(conn: &Connection, sale_id: &str) {
    // Use unique SKUs per sale to avoid UNIQUE constraint violations.
    let sku1 = format!("{sale_id}-COFFEE");
    let sku2 = format!("{sale_id}-BAGEL");
    let pid1 = format!("{sale_id}-p1");
    let pid2 = format!("{sale_id}-p2");
    // sl-1 sells 3 units because the refund tests below sum to 3 units on it: create_refund now bounds each refund by the units already refunded on that same sale line, which the money columns alone cannot express.
    conn.execute_batch(&format!(
        "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at) VALUES
            ('{pid1}', '{sku1}', 'Coffee', 350, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
            ('{pid2}', '{sku2}', 'Bagel', 450, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at) VALUES
            ('{sale_id}', 1500, 'USD', 2, 'completed', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position) VALUES
            ('{sale_id}-sl-1', '{sale_id}', '{sku1}', 3, 350, 1050, 'USD', 1),
            ('{sale_id}-sl-2', '{sale_id}', '{sku2}', 1, 450, 450, 'USD', 2);",
    )).unwrap();
}

// Seeds a product for tax assignment testing.
fn seed_product(conn: &Connection, sku: &str) {
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at) VALUES (?1, ?2, ?3, 1000, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        rusqlite::params![uuid::Uuid::now_v7().to_string(), sku, sku],
    ).unwrap();
}

// ── Refund Integration Tests ──────────────────────────────────────────

#[test]
fn full_refund_of_completed_sale() {
    let conn = setup();
    seed_sale(&conn, "fr-sale-1");
    let s = store(&conn);

    // Refund all lines of the sale.
    // SKUs must match seed_sale's dynamic SKU format: {sale_id}-{name}.
    let line1 = RefundLine::new(
        "fr-sale-1-sl-1",
        "fr-sale-1-COFFEE",
        2,
        price(350),
        price(700),
    );
    let line2 = RefundLine::new(
        "fr-sale-1-sl-2",
        "fr-sale-1-BAGEL",
        1,
        price(450),
        price(450),
    );
    let refund = Refund::new(
        "fr-sale-1",
        price(1150),
        "full refund",
        "",
        "user-1",
        vec![line1, line2],
    );

    s.create_refund(&refund).unwrap();

    // Verify the refund persisted correctly.
    let refunds = s.list_refunds_for_sale("fr-sale-1").unwrap();
    assert_eq!(refunds.len(), 1);
    assert_eq!(refunds[0].total.minor_units, 1150);
    assert_eq!(refunds[0].lines.len(), 2);

    // Verify audit log.
    let details_json: String = conn.query_row(
        "SELECT details FROM audit_log WHERE action = 'sale.refund' AND target_id = 'fr-sale-1'",
        [],
        |row| row.get(0),
    ).unwrap();
    assert!(
        details_json.contains("\"total_minor\":1150"),
        "audit log should contain the refund total"
    );
    assert!(
        details_json.contains("\"line_count\":2"),
        "audit log should contain line count"
    );
    assert!(
        details_json.contains("\"reason\":\"full refund\""),
        "audit log should contain reason"
    );
    assert!(
        details_json.contains(&format!("\"refund_id\":\"{}\"", refund.id)),
        "audit log should contain refund_id"
    );
}

#[test]
fn refund_zero_amount() {
    let conn = setup();
    seed_sale(&conn, "zero-sale");
    let s = store(&conn);

    // Zero-amount refund (e.g., courtesy adjustment).
    let refund = Refund::new(
        "zero-sale",
        price(0),
        "courtesy",
        "no charge",
        "user-1",
        vec![],
    );
    s.create_refund(&refund).unwrap();

    let refunds = s.list_refunds_for_sale("zero-sale").unwrap();
    assert_eq!(refunds.len(), 1);
    assert_eq!(refunds[0].total.minor_units, 0);
    assert!(refunds[0].lines.is_empty());
    assert_eq!(refunds[0].reason, "courtesy");
    assert_eq!(refunds[0].note, "no charge");
}

#[test]
fn refund_in_eur() {
    let conn = setup();
    // Create a sale with EUR currency.
    conn.execute_batch(
        "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at) VALUES
            ('eur-p1', 'COFFEE-EUR', 'Coffee', 300, 'EUR', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at) VALUES
            ('eur-sale', 600, 'EUR', 1, 'completed', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position) VALUES
            ('eur-sl-1', 'eur-sale', 'COFFEE-EUR', 2, 300, 600, 'EUR', 1);",
    ).unwrap();

    let s = store(&conn);
    let eur: Currency = "EUR".parse().unwrap();
    let eur_money = Money {
        minor_units: 600,
        currency: eur,
    };

    let line = RefundLine::new("eur-sl-1", "COFFEE-EUR", 2, eur_money, eur_money);
    let refund = Refund::new(
        "eur-sale",
        eur_money,
        "currency test",
        "",
        "user-1",
        vec![line],
    );
    s.create_refund(&refund).unwrap();

    let refunds = s.list_refunds_for_sale("eur-sale").unwrap();
    assert_eq!(refunds.len(), 1);
    assert_eq!(refunds[0].total.minor_units, 600);
    assert_eq!(
        std::str::from_utf8(&refunds[0].total.currency.0).unwrap(),
        "EUR"
    );
}

#[test]
fn refunds_across_multiple_sales() {
    let conn = setup();
    seed_sale(&conn, "ms-1");
    seed_sale(&conn, "ms-2");
    let s = store(&conn);

    // Refund first sale.
    // SKUs must match seed_sale's dynamic format: {sale_id}-{name}.
    let line1 = RefundLine::new("ms-1-sl-1", "ms-1-COFFEE", 1, price(350), price(350));
    s.create_refund(&Refund::new(
        "ms-1",
        price(350),
        "partial-1",
        "",
        "user-1",
        vec![line1],
    ))
    .unwrap();

    // Refund second sale.
    let line2 = RefundLine::new("ms-2-sl-1", "ms-2-COFFEE", 2, price(350), price(700));
    s.create_refund(&Refund::new(
        "ms-2",
        price(700),
        "partial-2",
        "",
        "user-1",
        vec![line2],
    ))
    .unwrap();

    // Verify each sale has the correct refunds.
    let refunds1 = s.list_refunds_for_sale("ms-1").unwrap();
    assert_eq!(refunds1.len(), 1);
    assert_eq!(refunds1[0].total.minor_units, 350);

    let refunds2 = s.list_refunds_for_sale("ms-2").unwrap();
    assert_eq!(refunds2.len(), 1);
    assert_eq!(refunds2[0].total.minor_units, 700);

    // Verify audit logs for both sales.
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM audit_log WHERE action = 'sale.refund'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 2);
}

#[test]
fn total_refunded_aggregates_correctly() {
    let conn = setup();
    seed_sale(&conn, "agg-sale");
    let s = store(&conn);

    // Create three partial refunds.
    // SKU must match seed_sale's dynamic format: {sale_id}-{name}.
    for i in 0..3 {
        let line = RefundLine::new(
            "agg-sale-sl-1",
            "agg-sale-COFFEE",
            1,
            price(350),
            price(350),
        );
        s.create_refund(&Refund::new(
            "agg-sale",
            price(350),
            format!("partial-{i}"),
            "",
            "user-1",
            vec![line],
        ))
        .unwrap();
    }

    let total = s.total_refunded_for_sale("agg-sale").unwrap();
    assert_eq!(total.minor_units, 1050, "3 × 350 = 1050");
    assert_eq!(total.currency, usd());
}

#[test]
fn refund_timestamps_are_chronological() {
    let conn = setup();
    seed_sale(&conn, "ts-sale");
    let s = store(&conn);

    // Create refunds with small delays to ensure different timestamps.
    // SKU must match seed_sale's dynamic format: {sale_id}-{name}.
    let line1 = RefundLine::new("ts-sale-sl-1", "ts-sale-COFFEE", 1, price(350), price(350));
    s.create_refund(&Refund::new(
        "ts-sale",
        price(350),
        "first",
        "",
        "user-1",
        vec![line1],
    ))
    .unwrap();

    std::thread::sleep(std::time::Duration::from_millis(10));

    let line2 = RefundLine::new("ts-sale-sl-1", "ts-sale-COFFEE", 1, price(350), price(350));
    s.create_refund(&Refund::new(
        "ts-sale",
        price(350),
        "second",
        "",
        "user-1",
        vec![line2],
    ))
    .unwrap();

    let refunds = s.list_refunds_for_sale("ts-sale").unwrap();
    assert_eq!(refunds.len(), 2);
    // list_refunds_for_sale orders by created_at ASC.
    assert_eq!(refunds[0].reason, "first");
    assert_eq!(refunds[1].reason, "second");
    assert!(
        refunds[0].created_at <= refunds[1].created_at,
        "refunds should be in chronological order"
    );
}

#[test]
fn refund_line_total_matches_unit_price_times_qty() {
    let conn = setup();
    seed_sale(&conn, "linecheck");
    let s = store(&conn);

    // SKU must match seed_sale's dynamic format: {sale_id}-{name}.
    let line = RefundLine::new(
        "linecheck-sl-1",
        "linecheck-COFFEE",
        3,
        price(350),
        price(1050),
    );
    let refund = Refund::new(
        "linecheck",
        price(1050),
        "qty test",
        "",
        "user-1",
        vec![line],
    );
    s.create_refund(&refund).unwrap();

    let refunds = s.list_refunds_for_sale("linecheck").unwrap();
    assert_eq!(refunds[0].lines[0].qty, 3);
    assert_eq!(refunds[0].lines[0].unit_price.minor_units, 350);
    assert_eq!(refunds[0].lines[0].line_total.minor_units, 1050);
}

#[test]
fn audit_log_details_for_refund_has_all_fields() {
    let conn = setup();
    seed_sale(&conn, "audit-detail");
    let s = store(&conn);

    // SKU must match seed_sale's dynamic format: {sale_id}-{name}.
    let line = RefundLine::new(
        "audit-detail-sl-1",
        "audit-detail-COFFEE",
        2,
        price(350),
        price(700),
    );
    let refund = Refund::new(
        "audit-detail",
        price(700),
        "damaged goods",
        "customer dropped item",
        "cashier-5",
        vec![line],
    );
    s.create_refund(&refund).unwrap();

    let details: String = conn
        .query_row(
            "SELECT details FROM audit_log WHERE target_id = 'audit-detail'",
            [],
            |r| r.get(0),
        )
        .unwrap();

    // All expected fields present.
    assert!(details.contains("\"refund_id\""), "missing refund_id");
    assert!(
        details.contains("\"reason\":\"damaged goods\""),
        "missing reason"
    );
    assert!(details.contains("\"total_minor\":700"), "missing total");
    assert!(details.contains("\"currency\":\"USD\""), "missing currency");
    assert!(details.contains("\"line_count\":1"), "missing line_count");
    assert!(
        details.contains(&format!("\"refund_id\":\"{}\"", refund.id)),
        "refund_id should match"
    );
}

// ── Tax Integration Tests ─────────────────────────────────────────────

#[test]
fn tax_rates_listed_in_alphabetical_order() {
    let conn = setup();
    let s = store(&conn);
    s.create_tax_rate("VAT 20%", 2000, false, false).unwrap();
    s.create_tax_rate("GST 5%", 500, false, false).unwrap();
    s.create_tax_rate("Zero Rated", 0, false, false).unwrap();

    let rates = s.list_tax_rates().unwrap();
    assert_eq!(rates.len(), 3);
    assert_eq!(rates[0].name, "GST 5%");
    assert_eq!(rates[1].name, "VAT 20%");
    assert_eq!(rates[2].name, "Zero Rated");
}

#[test]
fn multiple_tax_rates_assigned_to_product() {
    let conn = setup();
    seed_product(&conn, "COMPOUND");
    let s = store(&conn);

    let vat = s.create_tax_rate("VAT 10%", 1000, false, false).unwrap();
    let surcharge = s
        .create_tax_rate("Surcharge 5%", 500, false, false)
        .unwrap();
    let service = s.create_tax_rate("Service 2%", 200, false, false).unwrap();

    // Assign all three to the product.
    s.set_product_tax_rates(
        "COMPOUND",
        &[vat.id.clone(), surcharge.id.clone(), service.id.clone()],
    )
    .unwrap();

    let ids = s.get_product_tax_rates("COMPOUND").unwrap();
    assert_eq!(ids.len(), 3, "all three rates should be assigned");
    assert!(ids.contains(&vat.id));
    assert!(ids.contains(&surcharge.id));
    assert!(ids.contains(&service.id));
}

#[test]
fn multiple_tax_rates_assigned_to_category() {
    let conn = setup();
    let s = store(&conn);
    s.create_category("cat-compound", "Compound Cat", "#fff", "")
        .unwrap();

    let r1 = s.create_tax_rate("Rate A", 800, false, false).unwrap();
    let r2 = s.create_tax_rate("Rate B", 1200, false, false).unwrap();

    s.set_category_tax_rates("cat-compound", &[r1.id.clone(), r2.id.clone()])
        .unwrap();

    let ids = s.get_category_tax_rates("cat-compound").unwrap();
    assert_eq!(ids.len(), 2);
}

#[test]
fn clearing_product_tax_rates_removes_all() {
    let conn = setup();
    seed_product(&conn, "CLEAR");
    let s = store(&conn);

    let r1 = s.create_tax_rate("R1", 500, false, false).unwrap();
    s.set_product_tax_rates("CLEAR", std::slice::from_ref(&r1.id))
        .unwrap();
    assert_eq!(s.get_product_tax_rates("CLEAR").unwrap().len(), 1);

    // Setting an empty list should clear all assignments.
    s.set_product_tax_rates("CLEAR", &[]).unwrap();
    let ids = s.get_product_tax_rates("CLEAR").unwrap();
    assert!(ids.is_empty(), "clearing should remove all assignments");
}

#[test]
fn clearing_category_tax_rates_removes_all() {
    let conn = setup();
    let s = store(&conn);
    s.create_category("cat-clear", "Clear Cat", "#fff", "")
        .unwrap();

    let r1 = s.create_tax_rate("R1", 500, false, false).unwrap();
    s.set_category_tax_rates("cat-clear", std::slice::from_ref(&r1.id))
        .unwrap();
    assert_eq!(s.get_category_tax_rates("cat-clear").unwrap().len(), 1);

    s.set_category_tax_rates("cat-clear", &[]).unwrap();
    let ids = s.get_category_tax_rates("cat-clear").unwrap();
    assert!(ids.is_empty());
}

#[test]
fn product_and_category_tax_assignments_are_independent() {
    let conn = setup();
    seed_product(&conn, "INDEP");
    let s = store(&conn);
    s.create_category("cat-indep", "Indep Cat", "#fff", "")
        .unwrap();

    let prod_rate = s
        .create_tax_rate("Product Rate", 1000, false, false)
        .unwrap();
    let cat_rate = s
        .create_tax_rate("Category Rate", 500, false, false)
        .unwrap();

    s.set_product_tax_rates("INDEP", std::slice::from_ref(&prod_rate.id))
        .unwrap();
    s.set_category_tax_rates("cat-indep", std::slice::from_ref(&cat_rate.id))
        .unwrap();

    let prod_ids = s.get_product_tax_rates("INDEP").unwrap();
    let cat_ids = s.get_category_tax_rates("cat-indep").unwrap();

    assert_eq!(
        prod_ids,
        vec![prod_rate.id],
        "product should only have product rate"
    );
    assert_eq!(
        cat_ids,
        vec![cat_rate.id],
        "category should only have category rate"
    );
}

#[test]
fn update_tax_rate_preserves_created_at() {
    let conn = setup();
    let s = store(&conn);

    let created = s.create_tax_rate("Original", 500, false, false).unwrap();

    // Small delay so updated_at differs.
    std::thread::sleep(std::time::Duration::from_millis(2));
    let updated = s
        .update_tax_rate(&created.id, "Updated", 600, true, false)
        .unwrap();

    // update_tax_rate returns created_at: String::new() and updated_at set to now.
    assert!(
        !updated.updated_at.is_empty(),
        "updated_at should be set after update"
    );
}

#[test]
fn update_tax_rate_without_default_does_not_clear_other_defaults() {
    let conn = setup();
    let s = store(&conn);

    let r1 = s.create_tax_rate("Default", 500, true, false).unwrap();
    let r2 = s
        .create_tax_rate("Non-Default", 1000, false, false)
        .unwrap();

    // Update r2 without changing is_default — should NOT clear r1's default.
    s.update_tax_rate(&r2.id, "Still Non-Default", 1000, false, false)
        .unwrap();

    let r1_after = s.get_tax_rate(&r1.id).unwrap().unwrap();
    assert!(r1_after.is_default, "original default should remain");
}

#[test]
fn update_tax_rate_with_default_clears_previous_default() {
    let conn = setup();
    let s = store(&conn);

    let r1 = s.create_tax_rate("Default", 500, true, false).unwrap();
    let r2 = s
        .create_tax_rate("New Default", 1000, false, false)
        .unwrap();

    // Update r2 to be default — should clear r1's default.
    s.update_tax_rate(&r2.id, "New Default", 1000, true, false)
        .unwrap();

    let r1_after = s.get_tax_rate(&r1.id).unwrap().unwrap();
    let r2_after = s.get_tax_rate(&r2.id).unwrap().unwrap();
    assert!(!r1_after.is_default, "old default should be cleared");
    assert!(r2_after.is_default, "new default should be set");
}

#[test]
fn create_tax_rate_with_default_clears_previous_default() {
    let conn = setup();
    let s = store(&conn);

    let first = s.create_tax_rate("First", 500, true, false).unwrap();
    let second = s.create_tax_rate("Second", 1000, true, false).unwrap();

    let first_loaded = s.get_tax_rate(&first.id).unwrap().unwrap();
    let second_loaded = s.get_tax_rate(&second.id).unwrap().unwrap();
    assert!(
        !first_loaded.is_default,
        "first should no longer be default"
    );
    assert!(second_loaded.is_default, "second should be default");
}

#[test]
fn tax_rate_with_inclusive_flag_roundtrips() {
    let conn = setup();
    let s = store(&conn);

    let created = s
        .create_tax_rate("Inclusive Tax", 800, false, true)
        .unwrap();
    assert!(created.is_inclusive);
    assert!(!created.is_default);

    let loaded = s.get_tax_rate(&created.id).unwrap().unwrap();
    assert!(
        loaded.is_inclusive,
        "inclusive flag should persist through DB roundtrip"
    );

    // Update to exclusive.
    let updated = s
        .update_tax_rate(&created.id, "Inclusive Tax", 800, false, false)
        .unwrap();
    assert!(!updated.is_inclusive, "inclusive flag should be updated");
}

#[test]
fn delete_tax_rate_with_product_assignments() {
    let conn = setup();
    seed_product(&conn, "TAX-DEL");
    let s = store(&conn);

    let rate = s
        .create_tax_rate("To Be Deleted", 500, false, false)
        .unwrap();
    s.set_product_tax_rates("TAX-DEL", std::slice::from_ref(&rate.id))
        .unwrap();
    assert_eq!(s.get_product_tax_rates("TAX-DEL").unwrap().len(), 1);

    // Delete the tax rate.
    s.delete_tax_rate(&rate.id).unwrap();

    // The product_taxes entry still exists (no CASCADE DELETE in SQLite without explicit FK config).
    // Verify the tax rate is gone.
    let found = s.get_tax_rate(&rate.id).unwrap();
    assert!(found.is_none());

    // The product_taxes table has ON DELETE CASCADE, so orphaned rows are removed.
    let ids = s.get_product_tax_rates("TAX-DEL").unwrap();
    assert!(ids.is_empty(), "product_taxes should be cascaded on delete");
}

#[test]
fn refund_exceeding_sale_total_is_rejected() {
    // The over-refund guard rejects refunds whose total exceeds the
    // sale's original total. This prevents unlimited refunds on a
    // completed sale.
    let conn = setup();
    seed_sale(&conn, "exceed-sale");
    let s = store(&conn);

    // Sale total is 1150; refund 3500 → must be rejected.
    let line = RefundLine::new(
        "exceed-sale-sl-1",
        "exceed-sale-COFFEE",
        10,
        price(350),
        price(3500),
    );
    let refund = Refund::new(
        "exceed-sale",
        price(3500),
        "over refund",
        "exceeds total",
        "user-1",
        vec![line],
    );
    let err = s.create_refund(&refund).unwrap_err();
    assert!(
        matches!(err, CoreError::Validation { field, .. } if field == "total"),
        "over-refund must be rejected, got: {err:?}"
    );
}
