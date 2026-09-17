use super::*;
use crate::migrations;
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn seed_customer(conn: &Connection, id: &str, name: &str) {
    conn.execute(
        "INSERT INTO customers (id, name, notes, created_at, updated_at)
         VALUES (?1, ?2, '', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        params![id, name],
    )
    .unwrap();
}

fn seed_sale(conn: &Connection, id: &str) {
    seed_sale_for_customer(conn, id, None, 0);
}

fn seed_sale_for_customer(
    conn: &Connection,
    id: &str,
    customer_id: Option<&str>,
    total_minor: i64,
) {
    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, customer_id, created_at, updated_at, subtotal_minor, tax_total_minor)
         VALUES (?1, ?2, 'USD', 0, 'completed', ?3, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', ?2, 0)",
        params![id, total_minor, customer_id],
    )
    .unwrap();
}

#[test]
fn get_or_create_creates_account() {
    let conn = fresh();
    seed_customer(&conn, "cust-1", "Alice");
    let account = store(&conn)
        .get_or_create_loyalty_account("cust-1")
        .unwrap();
    assert_eq!(account.customer_id, "cust-1");
    assert_eq!(account.points, 0);
    assert_eq!(account.lifetime_points, 0);
    assert_eq!(account.tier_id.as_deref(), Some("tier-bronze"));
}

#[test]
fn get_or_create_returns_existing() {
    let conn = fresh();
    seed_customer(&conn, "cust-1", "Alice");
    let a1 = store(&conn)
        .get_or_create_loyalty_account("cust-1")
        .unwrap();
    let a2 = store(&conn)
        .get_or_create_loyalty_account("cust-1")
        .unwrap();
    assert_eq!(a1.id, a2.id);
}

#[test]
fn earn_points_creates_transaction() {
    let conn = fresh();
    seed_customer(&conn, "cust-1", "Alice");
    seed_sale(&conn, "sale-1");
    let txn = store(&conn).earn_points("cust-1", "sale-1", 1000).unwrap();
    assert_eq!(txn.txn_type, "earn");
    assert_eq!(txn.points, 100); // 1000 * 10 / 100 * 1.0

    let details = store(&conn).get_loyalty_account("cust-1").unwrap().unwrap();
    assert_eq!(details.account.points, 100);
    assert_eq!(details.account.lifetime_points, 100);
}

#[test]
fn earn_points_is_idempotent_for_replayed_sale() {
    let conn = fresh();
    seed_customer(&conn, "cust-1", "Alice");
    seed_sale(&conn, "sale-1");
    let first = store(&conn).earn_points("cust-1", "sale-1", 1000).unwrap();
    let second = store(&conn).earn_points("cust-1", "sale-1", 1000).unwrap();

    assert_eq!(first.id, second.id);
    let details = store(&conn).get_loyalty_account("cust-1").unwrap().unwrap();
    assert_eq!(details.account.points, first.points);
    assert_eq!(details.account.lifetime_points, first.points);
    assert_eq!(details.recent_transactions.len(), 1);
}

#[test]
fn earn_points_is_idempotent_even_when_replay_total_differs() {
    let conn = fresh();
    seed_customer(&conn, "cust-1", "Alice");
    seed_sale(&conn, "sale-1");
    let first = store(&conn).earn_points("cust-1", "sale-1", 1000).unwrap();
    let second = store(&conn).earn_points("cust-1", "sale-1", 9999).unwrap();

    assert_eq!(first.id, second.id);
    assert_eq!(first.points, second.points);
}

#[test]
fn update_tier_rejects_invalid_values() {
    let conn = fresh();
    let s = store(&conn);

    for (field, args) in [
        ("name", ("", 0, 10, 1_000_000, "#ffffff")),
        ("min_points", ("Bronze", -1, 10, 1_000_000, "#ffffff")),
        ("points_per_unit", ("Bronze", 0, 0, 1_000_000, "#ffffff")),
        (
            "earn_multiplier_millionths",
            ("Bronze", 0, 10, 0, "#ffffff"),
        ),
        ("colour", ("Bronze", 0, 10, 1_000_000, "not-a-colour")),
    ] {
        let err = s
            .update_tier("tier-bronze", args.0, args.1, args.2, args.3, args.4)
            .unwrap_err();
        assert!(matches!(err, CoreError::Validation { field: actual, .. } if actual == field));
    }
}

#[test]
fn earn_points_with_silver_multiplier() {
    let conn = fresh();
    seed_customer(&conn, "cust-1", "Alice");
    seed_sale(&conn, "sale-1");
    // Create account first, then bump to Silver (1.25x multiplier).
    store(&conn)
        .get_or_create_loyalty_account("cust-1")
        .unwrap();
    conn.execute(
        "UPDATE loyalty_accounts SET tier_id = 'tier-silver' WHERE customer_id = 'cust-1'",
        [],
    )
    .unwrap();

    let txn = store(&conn).earn_points("cust-1", "sale-1", 1000).unwrap();
    // 1000 * 10 / 100 * 1.25 = 125
    assert_eq!(txn.points, 125);
}

#[test]
fn redeem_points_deducts_and_returns_value() {
    let conn = fresh();
    seed_customer(&conn, "cust-1", "Alice");
    seed_sale_for_customer(&conn, "sale-1", Some("cust-1"), 5000);
    seed_sale_for_customer(&conn, "sale-2", Some("cust-1"), 1000);
    store(&conn).earn_points("cust-1", "sale-1", 5000).unwrap();

    let (txn, discount) = store(&conn).redeem_points("cust-1", 200, "sale-2").unwrap();
    assert_eq!(txn.points, -200);
    assert_eq!(discount, 200); // 200 points = 200 minor units
    // The seeded sale is USD (exp 2): 200 minor units render as a decimal.
    assert_eq!(txn.description, "Redeemed 200 points for 2.00 discount");

    let details = store(&conn).get_loyalty_account("cust-1").unwrap().unwrap();
    // 5000 * 10 / 100 * 1.0 = 500 earned - 200 redeemed = 300
    assert_eq!(details.account.points, 300);
}

#[test]
fn redeem_points_note_uses_sale_currency_exponent() {
    let conn = fresh();
    seed_customer(&conn, "cust-1", "Alice");
    seed_sale_for_customer(&conn, "sale-earn", Some("cust-1"), 5000);
    // IDR sale (exp 0): the minor unit IS the Rupiah, so the discount
    // stays raw in the description.
    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, customer_id, created_at, updated_at, subtotal_minor, tax_total_minor)
         VALUES ('sale-idr', 10000, 'IDR', 0, 'completed', 'cust-1', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', 10000, 0)",
        [],
    )
    .unwrap();
    store(&conn)
        .earn_points("cust-1", "sale-earn", 5000)
        .unwrap();

    let (txn, discount) = store(&conn)
        .redeem_points("cust-1", 500, "sale-idr")
        .unwrap();
    assert_eq!(discount, 500);
    assert_eq!(txn.description, "Redeemed 500 points for 500 discount");

    // The DB-stored row (written inside the transaction) formats the same way.
    let details = store(&conn).get_loyalty_account("cust-1").unwrap().unwrap();
    let stored = details
        .recent_transactions
        .iter()
        .find(|t| t.txn_type == "redeem")
        .unwrap();
    assert_eq!(stored.description, "Redeemed 500 points for 500 discount");
}

#[test]
fn redeem_points_retry_returns_original_transaction_after_balance_changes() {
    let conn = fresh();
    seed_customer(&conn, "cust-1", "Alice");
    seed_sale_for_customer(&conn, "sale-earn", Some("cust-1"), 5000);
    seed_sale_for_customer(&conn, "sale-redeem", Some("cust-1"), 1000);
    store(&conn)
        .earn_points("cust-1", "sale-earn", 5000)
        .unwrap();

    let first = store(&conn)
        .redeem_points("cust-1", 200, "sale-redeem")
        .unwrap();
    let retry = store(&conn)
        .redeem_points("cust-1", 200, "sale-redeem")
        .unwrap();

    assert_eq!(first.0.id, retry.0.id);
    assert_eq!(first.1, retry.1);
    assert_eq!(
        store(&conn)
            .get_loyalty_account("cust-1")
            .unwrap()
            .unwrap()
            .account
            .points,
        300
    );
}

#[test]
fn redeem_points_rejects_customer_mismatch_and_over_discount() {
    let conn = fresh();
    seed_customer(&conn, "cust-1", "Alice");
    seed_customer(&conn, "cust-2", "Bob");
    seed_sale_for_customer(&conn, "sale-earn", Some("cust-1"), 5000);
    seed_sale_for_customer(&conn, "sale-other", Some("cust-2"), 1000);
    seed_sale_for_customer(&conn, "sale-small", Some("cust-1"), 50);
    store(&conn)
        .earn_points("cust-1", "sale-earn", 5000)
        .unwrap();

    let mismatch = store(&conn)
        .redeem_points("cust-1", 100, "sale-other")
        .unwrap_err();
    assert!(matches!(
        mismatch,
        CoreError::Validation {
            field: "sale_id",
            ..
        }
    ));

    let over_discount = store(&conn)
        .redeem_points("cust-1", 100, "sale-small")
        .unwrap_err();
    assert!(matches!(
        over_discount,
        CoreError::Validation {
            field: "points",
            ..
        }
    ));
}

#[test]
fn redeem_points_insufficient() {
    let conn = fresh();
    seed_customer(&conn, "cust-1", "Alice");
    seed_sale_for_customer(&conn, "sale-1", Some("cust-1"), 1000);
    store(&conn)
        .get_or_create_loyalty_account("cust-1")
        .unwrap();
    let err = store(&conn)
        .redeem_points("cust-1", 100, "sale-1")
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "points"));
}

#[test]
fn list_tiers_returns_seeded() {
    let conn = fresh();
    let tiers = store(&conn).list_tiers().unwrap();
    assert_eq!(tiers.len(), 4);
    assert_eq!(tiers[0].name, "Bronze");
    assert_eq!(tiers[1].name, "Silver");
    assert_eq!(tiers[2].name, "Gold");
    assert_eq!(tiers[3].name, "Platinum");
}

#[test]
fn update_tier_modifies_fields() {
    let conn = fresh();
    let updated = store(&conn)
        .update_tier("tier-bronze", "Bronze Updated", 0, 15, 1_500_000, "#ff0000")
        .unwrap();
    assert_eq!(updated.name, "Bronze Updated");
    assert_eq!(updated.points_per_unit, 15);
    assert_eq!(updated.earn_multiplier_millionths, 1_500_000);
}

#[test]
fn get_points_value_converts_correctly() {
    let conn = fresh();
    assert_eq!(store(&conn).get_points_value(100).unwrap(), 100);
    assert_eq!(store(&conn).get_points_value(50).unwrap(), 50);
    assert_eq!(store(&conn).get_points_value(0).unwrap(), 0);
    assert!(matches!(
        store(&conn).get_points_value(-1),
        Err(CoreError::Validation {
            field: "points",
            ..
        })
    ));
}

#[test]
fn customer_not_found_returns_error() {
    let conn = fresh();
    let err = store(&conn)
        .get_or_create_loyalty_account("nonexistent")
        .unwrap_err();
    assert!(matches!(err, CoreError::NotFound { entity, .. } if entity == "customer"));
}

// ── Additional edge-case tests ─────────────────────────────────

#[test]
fn list_loyalty_accounts_ordered_by_points() {
    let conn = fresh();
    seed_customer(&conn, "cust-1", "Alice");
    seed_customer(&conn, "cust-2", "Bob");
    seed_customer(&conn, "cust-3", "Charlie");
    seed_sale(&conn, "sale-1");
    seed_sale(&conn, "sale-2");

    let s = store(&conn);
    // Create accounts
    s.get_or_create_loyalty_account("cust-1").unwrap();
    s.get_or_create_loyalty_account("cust-2").unwrap();
    s.get_or_create_loyalty_account("cust-3").unwrap();

    // Earn different point amounts
    s.earn_points("cust-1", "sale-1", 5000).unwrap(); // 500 points
    s.earn_points("cust-2", "sale-2", 10000).unwrap(); // 1000 points

    let accounts = s.list_loyalty_accounts().unwrap();
    assert_eq!(accounts.len(), 3);
    // ORDER BY lifetime_points DESC: cust-2 (1000) first, cust-1 (500) second, cust-3 (0) third
    assert_eq!(accounts[0].account.customer_id, "cust-2");
    assert_eq!(accounts[1].account.customer_id, "cust-1");
    assert_eq!(accounts[2].account.customer_id, "cust-3");
}

#[test]
fn list_loyalty_accounts_empty() {
    let conn = fresh();
    // Seed a customer but don't create any loyalty accounts
    seed_customer(&conn, "cust-1", "Alice");
    let accounts = store(&conn).list_loyalty_accounts().unwrap();
    assert!(accounts.is_empty());
}

#[test]
fn earn_points_validation_zero_total() {
    let conn = fresh();
    seed_customer(&conn, "cust-1", "Alice");
    seed_sale(&conn, "sale-1");
    store(&conn)
        .get_or_create_loyalty_account("cust-1")
        .unwrap();

    // total_minor = 0 → 0 points → Validation error
    let err = store(&conn).earn_points("cust-1", "sale-1", 0).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "total_minor"));
}

#[test]
fn earn_points_small_total_rounds_to_one() {
    let conn = fresh();
    seed_customer(&conn, "cust-1", "Alice");
    seed_sale(&conn, "sale-1");
    store(&conn)
        .get_or_create_loyalty_account("cust-1")
        .unwrap();

    // total_minor = 9 → base = 90 → 90.0 / 100.0 * 1.0 = 0.9 → rounds to 1
    // With the fix for integer truncation, fractional cents are preserved
    let txn = store(&conn).earn_points("cust-1", "sale-1", 9).unwrap();
    assert_eq!(
        txn.points, 1,
        "9 cents with 10 pts/unit should round 0.9 → 1"
    );
}

#[test]
fn earn_points_tiny_total_rounds_to_zero() {
    let conn = fresh();
    seed_customer(&conn, "cust-1", "Alice");
    seed_sale(&conn, "sale-1");
    store(&conn)
        .get_or_create_loyalty_account("cust-1")
        .unwrap();

    // total_minor = 4 → base = 40 → 40.0 / 100.0 * 1.0 = 0.4 → rounds to 0 → err
    let err = store(&conn).earn_points("cust-1", "sale-1", 4).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "total_minor"));
}

#[test]
fn earn_points_no_integer_truncation_for_sub_dollar_amounts() {
    let conn = fresh();
    seed_customer(&conn, "cust-1", "Alice");
    seed_sale(&conn, "sale-1");
    store(&conn)
        .get_or_create_loyalty_account("cust-1")
        .unwrap();

    // total_minor = 155 ($1.55), points_per_unit = 10, multiplier 1.0 (1_000_000)
    // Correct math: 155 * 10 / 100 = 15.5 → round → 16
    // Integer-division bug: 155 * 10 / 100 = 15 (truncated) → 15
    let txn = store(&conn).earn_points("cust-1", "sale-1", 155).unwrap();
    assert_eq!(
        txn.points, 16,
        "$1.55 with 10 pts/unit should earn 16 pts (rounded from 15.5), \
         not {} from integer truncation",
        txn.points
    );

    // Verify account balance matches
    let details = store(&conn).get_loyalty_account("cust-1").unwrap().unwrap();
    assert_eq!(details.account.points, 16);
    assert_eq!(details.account.lifetime_points, 16);
}

#[test]
fn earn_points_multiple_sub_dollar_amounts_stack_correctly() {
    let conn = fresh();
    seed_customer(&conn, "cust-1", "Alice");
    seed_sale(&conn, "sale-1");
    seed_sale(&conn, "sale-2");
    seed_sale(&conn, "sale-3");
    let s = store(&conn);
    s.get_or_create_loyalty_account("cust-1").unwrap();

    // Three sub-dollar purchases that should round correctly
    // $1.55 → 16 pts, $2.49 → 25 pts, $0.99 → 10 pts
    s.earn_points("cust-1", "sale-1", 155).unwrap();
    s.earn_points("cust-1", "sale-2", 249).unwrap();
    s.earn_points("cust-1", "sale-3", 99).unwrap();

    // Expected: 16 + 25 + 10 = 51 (with correct float division)
    // Bug: 15 + 24 + 9 = 48 (with integer truncation before f64 cast)
    let details = s.get_loyalty_account("cust-1").unwrap().unwrap();
    assert_eq!(
        details.account.points, 51,
        "accumulated points from 155+249+99 should be 51, got {}",
        details.account.points
    );
    assert_eq!(
        details.account.lifetime_points, 51,
        "lifetime_points should also be 51, got {}",
        details.account.lifetime_points
    );
}

#[test]
fn redeem_points_zero_returns_validation_error() {
    let conn = fresh();
    seed_customer(&conn, "cust-1", "Alice");
    seed_sale_for_customer(&conn, "sale-1", Some("cust-1"), 5000);
    seed_sale_for_customer(&conn, "sale-2", Some("cust-1"), 1000);
    store(&conn).earn_points("cust-1", "sale-1", 5000).unwrap();

    let err = store(&conn)
        .redeem_points("cust-1", 0, "sale-2")
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "points"));
}

#[test]
fn redeem_points_negative_returns_validation_error() {
    let conn = fresh();
    seed_customer(&conn, "cust-1", "Alice");
    seed_sale_for_customer(&conn, "sale-1", Some("cust-1"), 5000);
    seed_sale_for_customer(&conn, "sale-2", Some("cust-1"), 1000);
    store(&conn).earn_points("cust-1", "sale-1", 5000).unwrap();

    let err = store(&conn)
        .redeem_points("cust-1", -50, "sale-2")
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "points"));
}

#[test]
fn redeem_points_no_account_returns_not_found() {
    let conn = fresh();
    seed_sale(&conn, "sale-1");
    let err = store(&conn)
        .redeem_points("nonexistent", 100, "sale-1")
        .unwrap_err();
    assert!(matches!(err, CoreError::NotFound { entity, .. } if entity == "loyalty_account"));
}

#[test]
fn update_tier_not_found() {
    let conn = fresh();
    let err = store(&conn)
        .update_tier("nonexistent", "No Tier", 0, 10, 1_000_000, "#000")
        .unwrap_err();
    assert!(matches!(err, CoreError::NotFound { entity, .. } if entity == "loyalty_tier"));
}

#[test]
fn earn_points_updates_tier_automatically() {
    let conn = fresh();
    seed_customer(&conn, "cust-1", "Alice");
    seed_sale(&conn, "sale-1");
    seed_sale(&conn, "sale-2");

    let s = store(&conn);
    s.get_or_create_loyalty_account("cust-1").unwrap();

    // Earn enough points to reach Silver tier (min_points = 200 for Silver)
    // 2000 * 10 / 100 * 1.0 = 200 points → should auto-upgrade to Silver
    s.earn_points("cust-1", "sale-1", 2000).unwrap();

    let details = s.get_loyalty_account("cust-1").unwrap().unwrap();
    assert_eq!(details.account.tier_id.as_deref(), Some("tier-silver"));
    assert!(details.tier.is_some());
    assert_eq!(details.tier.as_ref().unwrap().name, "Silver");
}

#[test]
fn earn_points_multiple_stacked() {
    let conn = fresh();
    seed_customer(&conn, "cust-1", "Alice");
    seed_sale(&conn, "sale-1");
    seed_sale(&conn, "sale-2");
    seed_sale(&conn, "sale-3");

    let s = store(&conn);
    s.get_or_create_loyalty_account("cust-1").unwrap();

    // sale-1: Bronze 1.0x → 1000*10/100=100 points. Upgrades to Silver.
    // sale-2: Silver 1.25x → 2000*10/100*1.25=250 points. Total: 350.
    // sale-3: Silver 1.25x → 3000*10/100*1.25=375 points. Total: 725.
    s.earn_points("cust-1", "sale-1", 1000).unwrap();
    s.earn_points("cust-1", "sale-2", 2000).unwrap();
    s.earn_points("cust-1", "sale-3", 3000).unwrap();

    let details = s.get_loyalty_account("cust-1").unwrap().unwrap();
    assert_eq!(details.account.points, 725);
    assert_eq!(details.account.lifetime_points, 725);
    // Should have 3 recent transactions
    assert_eq!(details.recent_transactions.len(), 3);
}

// ── LOY-02 (migration 128): unique earn/redeem projection index ──

/// The audit's LOY-02 recommendation: enforce idempotency at the
/// database layer with a unique projection key (account_id, sale_id,
/// txn_type) so a CONCURRENT replay — both callers passing the
/// application-layer lookup, then both inserting — can never
/// double-award. `earn_points`/`redeem_points` recover from the
/// resulting ConstraintViolation by returning the winning row, but that
/// recovery depends on the index existing. Pin: a second row for the
/// same projection must be rejected by the database.
#[test]
fn duplicate_earn_projection_row_is_rejected_by_database() {
    let conn = fresh();
    seed_customer(&conn, "cust-1", "Alice");
    seed_sale(&conn, "sale-1");
    let account = store(&conn)
        .get_or_create_loyalty_account("cust-1")
        .unwrap();

    // The winning concurrent replay row is already in the ledger.
    conn.execute(
        "INSERT INTO loyalty_transactions (id, account_id, sale_id, points, txn_type, description, created_at)
         VALUES ('txn-win', ?1, 'sale-1', 100, 'earn', 'winning row', '2025-01-01T00:00:00.000Z')",
        params![account.id],
    )
    .unwrap();

    // A losing concurrent replay must hit the unique projection index
    // instead of double-awarding the same sale.
    let duplicate = conn.execute(
        "INSERT INTO loyalty_transactions (id, account_id, sale_id, points, txn_type, description, created_at)
         VALUES ('txn-lose', ?1, 'sale-1', 100, 'earn', 'losing row', '2025-01-01T00:00:00.000Z')",
        params![account.id],
    );
    assert!(
        matches!(
            &duplicate,
            Err(rusqlite::Error::SqliteFailure(code, _))
                if code.code == rusqlite::ErrorCode::ConstraintViolation
        ),
        "duplicate (account_id, sale_id, 'earn') row must be rejected by the unique \
         projection index, got: {duplicate:?}"
    );
}

/// The same projection must also hold for redemptions: one 'redeem'
/// row per (account, sale). A retried checkout must not double-deduct.
#[test]
fn duplicate_redeem_projection_row_is_rejected_by_database() {
    let conn = fresh();
    seed_customer(&conn, "cust-1", "Alice");
    seed_sale_for_customer(&conn, "sale-1", Some("cust-1"), 5000);
    let account = store(&conn)
        .get_or_create_loyalty_account("cust-1")
        .unwrap();
    conn.execute(
        "INSERT INTO loyalty_transactions (id, account_id, sale_id, points, txn_type, description, created_at)
         VALUES ('txn-win', ?1, 'sale-1', -100, 'redeem', 'winning row', '2025-01-01T00:00:00.000Z')",
        params![account.id],
    )
    .unwrap();

    let duplicate = conn.execute(
        "INSERT INTO loyalty_transactions (id, account_id, sale_id, points, txn_type, description, created_at)
         VALUES ('txn-lose', ?1, 'sale-1', -100, 'redeem', 'losing row', '2025-01-01T00:00:00.000Z')",
        params![account.id],
    );
    assert!(
        matches!(
            &duplicate,
            Err(rusqlite::Error::SqliteFailure(code, _))
                if code.code == rusqlite::ErrorCode::ConstraintViolation
        ),
        "duplicate (account_id, sale_id, 'redeem') row must be rejected, got: {duplicate:?}"
    );
}

/// A sale may legitimately carry BOTH an earn and a redeem row — the
/// projection key is (account, sale, TYPE), so the index must not
/// collapse different transaction types for the same sale.
#[test]
fn earn_and_redeem_for_same_sale_are_distinct_projections() {
    let conn = fresh();
    seed_customer(&conn, "cust-1", "Alice");
    seed_sale_for_customer(&conn, "sale-1", Some("cust-1"), 5000);
    let account = store(&conn)
        .get_or_create_loyalty_account("cust-1")
        .unwrap();

    conn.execute(
        "INSERT INTO loyalty_transactions (id, account_id, sale_id, points, txn_type, description, created_at)
         VALUES ('txn-earn', ?1, 'sale-1', 500, 'earn', 'earned', '2025-01-01T00:00:00.000Z')",
        params![account.id],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO loyalty_transactions (id, account_id, sale_id, points, txn_type, description, created_at)
         VALUES ('txn-redeem', ?1, 'sale-1', -100, 'redeem', 'redeemed', '2025-01-02T00:00:00.000Z')",
        params![account.id],
    )
    .unwrap();
}

/// adjust/expire rows have no sale binding (NULL sale_id). SQLite unique
/// indexes treat NULLs as distinct, so multiple sale-less rows for the
/// same account must stay insertable — the projection index must not
/// over-constrain them.
#[test]
fn sale_less_transaction_rows_are_not_projection_constrained() {
    let conn = fresh();
    seed_customer(&conn, "cust-1", "Alice");
    let account = store(&conn)
        .get_or_create_loyalty_account("cust-1")
        .unwrap();

    for i in 0..2 {
        let id = format!("txn-adjust-{i}");
        conn.execute(
            "INSERT INTO loyalty_transactions (id, account_id, sale_id, points, txn_type, description, created_at)
             VALUES (?1, ?2, NULL, -10, 'adjust', 'manual adjustment', '2025-01-01T00:00:00.000Z')",
            params![id, account.id],
        )
        .unwrap_or_else(|e| panic!("sale-less adjust row {i} must insert: {e}"));
    }
}

// ── LOY-06: finalize_sale awards loyalty points atomically ─────────────

fn seed_pending_sale(
    conn: &Connection,
    id: &str,
    customer_id: Option<&str>,
    total_minor: i64,
    base_total_minor: Option<i64>,
) {
    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, customer_id,
                            created_at, updated_at, subtotal_minor, tax_total_minor,
                            base_total_minor)
         VALUES (?1, ?2, 'USD', 0, 'pending', ?3, '2025-01-01T00:00:00.000Z',
                 '2025-01-01T00:00:00.000Z', ?2, 0, ?4)",
        params![id, total_minor, customer_id, base_total_minor],
    )
    .unwrap();
}

fn earn_points_for(conn: &Connection, sale_id: &str) -> Option<i64> {
    conn.query_row(
        "SELECT points FROM loyalty_transactions WHERE sale_id = ?1 AND txn_type = 'earn'",
        params![sale_id],
        |r| r.get(0),
    )
    .ok()
}

#[test]
fn finalize_sale_awards_points_to_customer_sale() {
    let conn = fresh();
    seed_customer(&conn, "cust-1", "Alice");
    seed_pending_sale(&conn, "sale-1", Some("cust-1"), 700, None);

    store(&conn).finalize_sale("sale-1").unwrap();

    // Bronze default: points_per_unit = 10, multiplier 1.0 → 700*10/100 = 70.
    assert_eq!(
        earn_points_for(&conn, "sale-1"),
        Some(70),
        "finalizing a customer sale must award tier points"
    );
    let projected: i64 = conn
        .query_row(
            "SELECT loyalty_points FROM customers WHERE id = 'cust-1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        projected, 70,
        "customers.loyalty_points projection must update"
    );
}

#[test]
fn finalize_sale_awards_on_base_total_when_converted() {
    let conn = fresh();
    seed_customer(&conn, "cust-1", "Alice");
    // Multi-currency charge: customer paid 115500 IDR-minor for a 700
    // USD-minor sale. Points must follow the BASE total, not the charge
    // amount — otherwise the charge currency silently multiplies rewards.
    seed_pending_sale(&conn, "sale-1", Some("cust-1"), 115_500, Some(700));

    store(&conn).finalize_sale("sale-1").unwrap();

    assert_eq!(
        earn_points_for(&conn, "sale-1"),
        Some(70),
        "earn must use base_total_minor when present (currency-naive formula guard)"
    );
}

#[test]
fn finalize_sale_without_customer_awards_nothing() {
    let conn = fresh();
    seed_pending_sale(&conn, "sale-1", None, 700, None);

    store(&conn).finalize_sale("sale-1").unwrap();

    assert_eq!(earn_points_for(&conn, "sale-1"), None);
}

#[test]
fn finalize_sale_zero_total_completes_without_award() {
    let conn = fresh();
    seed_customer(&conn, "cust-1", "Alice");
    seed_pending_sale(&conn, "sale-1", Some("cust-1"), 0, None);

    store(&conn).finalize_sale("sale-1").unwrap();

    // Too-small-to-earn is expected, not an error: the sale must still be
    // completed and no ledger row written.
    let status: String = conn
        .query_row("SELECT status FROM sales WHERE id = 'sale-1'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(status, "completed");
    assert_eq!(earn_points_for(&conn, "sale-1"), None);
}

#[test]
fn finalize_replay_awards_once() {
    let conn = fresh();
    seed_customer(&conn, "cust-1", "Alice");
    seed_pending_sale(&conn, "sale-1", Some("cust-1"), 700, None);

    let s = store(&conn);
    s.finalize_sale("sale-1").unwrap();
    s.finalize_sale("sale-1").unwrap();

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM loyalty_transactions WHERE sale_id = 'sale-1' AND txn_type = 'earn'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1, "replayed finalize must not double-award");
}

// ── LOY-03: proportional refund reversal ───────────────────────
//
// LOY-06 made completion award points atomically; refunds must
// claw back their proportional share in the same DB tx, or every
// refund silently leaks points.

fn acct_state(conn: &Connection, customer_id: &str) -> (i64, i64, String) {
    conn.query_row(
        "SELECT points, lifetime_points, COALESCE(tier_id, '')
         FROM loyalty_accounts WHERE customer_id = ?1",
        params![customer_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )
    .unwrap()
}

fn seed_earned_sale(conn: &Connection, sale_total: i64) {
    seed_customer(conn, "cust-1", "Alice");
    seed_sale_for_customer(conn, "sale-1", Some("cust-1"), sale_total);
    store(conn)
        .earn_points("cust-1", "sale-1", sale_total)
        .unwrap();
}

#[test]
fn refund_reversal_deducts_proportionally() {
    let conn = fresh();
    // Bronze: 10 pts / 100 minor → 10000 earns 1000.
    seed_earned_sale(&conn, 10000);
    let txn = reverse_loyalty_on_refund(&conn, "sale-1", "ref-1", 3000, 10000)
        .unwrap()
        .expect("30% refund reverses 30% of the award");
    assert_eq!(txn.points, -300);
    assert_eq!(txn.txn_type, "refund_reversal");
    assert_eq!(acct_state(&conn, "cust-1").0, 700);
    assert_eq!(acct_state(&conn, "cust-1").1, 700);
    let projection: i64 = conn
        .query_row(
            "SELECT loyalty_points FROM customers WHERE id = 'cust-1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(projection, 700);
}

#[test]
fn refund_reversal_is_idempotent_per_refund() {
    let conn = fresh();
    seed_earned_sale(&conn, 10000);
    assert!(
        reverse_loyalty_on_refund(&conn, "sale-1", "ref-1", 3000, 10000)
            .unwrap()
            .is_some()
    );
    // Replay of the SAME refund id (retry after a crash) must not deduct twice.
    assert!(
        reverse_loyalty_on_refund(&conn, "sale-1", "ref-1", 3000, 10000)
            .unwrap()
            .is_none()
    );
    assert_eq!(acct_state(&conn, "cust-1").0, 700);
}

#[test]
fn refund_reversal_cumulative_capped_at_award() {
    let conn = fresh();
    seed_earned_sale(&conn, 10000); // 1000 pts awarded
    let t1 = reverse_loyalty_on_refund(&conn, "sale-1", "ref-1", 6000, 10000)
        .unwrap()
        .unwrap();
    assert_eq!(t1.points, -600);
    // Second 60% refund: only 400 headroom remains under the award.
    let t2 = reverse_loyalty_on_refund(&conn, "sale-1", "ref-2", 6000, 10000)
        .unwrap()
        .unwrap();
    assert_eq!(t2.points, -400);
    // Nothing left to reverse.
    assert!(
        reverse_loyalty_on_refund(&conn, "sale-1", "ref-3", 1000, 10000)
            .unwrap()
            .is_none()
    );
    assert_eq!(acct_state(&conn, "cust-1").0, 0);
}

#[test]
fn refund_reversal_without_earn_is_noop() {
    let conn = fresh();
    seed_customer(&conn, "cust-1", "Alice");
    seed_sale_for_customer(&conn, "sale-1", Some("cust-1"), 10000);
    // Legacy sale that never earned (LOY-06 rollout boundary).
    assert!(
        reverse_loyalty_on_refund(&conn, "sale-1", "ref-1", 5000, 10000)
            .unwrap()
            .is_none()
    );
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM loyalty_transactions", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn refund_reversal_floors_balance_at_zero() {
    let conn = fresh();
    seed_earned_sale(&conn, 10000); // 1000 pts
    // Customer spent points meanwhile: balance 200, lifetime 1000.
    conn.execute(
        "UPDATE loyalty_accounts SET points = 200 WHERE customer_id = 'cust-1'",
        [],
    )
    .unwrap();
    let txn = reverse_loyalty_on_refund(&conn, "sale-1", "ref-1", 10000, 10000)
        .unwrap()
        .unwrap();
    assert_eq!(txn.points, -1000, "ledger records the full reversal");
    let (points, lifetime, _) = acct_state(&conn, "cust-1");
    assert_eq!(points, 0, "balance floors at zero, never negative");
    assert_eq!(lifetime, 0);
}

#[test]
fn refund_reversal_demotes_tier_when_lifetime_drops() {
    let conn = fresh();
    seed_earned_sale(&conn, 10000); // lifetime 1000 → Gold (min 500)
    assert_eq!(acct_state(&conn, "cust-1").2, "tier-gold");
    reverse_loyalty_on_refund(&conn, "sale-1", "ref-1", 10000, 10000).unwrap();
    assert_eq!(
        acct_state(&conn, "cust-1").2,
        "tier-bronze",
        "lifetime back to 0 → tier recomputed down"
    );
}

// ── LOYALTY-01: fixed-point multiplier, exact points ──────────────────

#[test]
fn compute_points_exact_half_up_boundaries() {
    // The $22.50 case: 22.5 × 1.4 = 31.5 exact → 32. The old float path
    // computed 31.499999999999996 → 31 (scan-verified: 585 such bases ≤ 2M
    // for multiplier 1.4, all rounding DOWNWARD).
    assert_eq!(compute_points(2250, 1_400_000), 32);
    // Further scan-verified flip bases: exact 59.5 → 60, exact 115.5 → 116.
    assert_eq!(compute_points(4250, 1_400_000), 60);
    assert_eq!(compute_points(8250, 1_400_000), 116);
    // base=250: exact 3.5 → 4. (The old float happened to be right here —
    // the product snapped back to exactly 3.5 — pin it so it stays right.)
    assert_eq!(compute_points(250, 1_400_000), 4);
    // The pre-existing $1.55 boundary (155 × 10 = 1550; 15.5 → 16).
    assert_eq!(compute_points(1550, 1_000_000), 16);
    // Non-boundary rounding: 123.45 → 123, 123.5 → 124, 123.6 → 124.
    assert_eq!(compute_points(12345, 1_000_000), 123);
    assert_eq!(compute_points(12350, 1_000_000), 124);
    assert_eq!(compute_points(12360, 1_000_000), 124);
    // 1.25× (seeded Silver): 4.4 × 1.25 = 5.5 → 6.
    assert_eq!(compute_points(440, 1_250_000), 6);
    // Zero and identity.
    assert_eq!(compute_points(0, 1_400_000), 0);
    assert_eq!(compute_points(99, 1_000_000), 1); // 0.99 → 1
    assert_eq!(compute_points(49, 1_000_000), 0); // 0.49 → 0
}

#[test]
fn compute_points_extremes_do_not_overflow() {
    // i128 intermediate: i64::MAX × 1.0 stays in i64 range.
    assert_eq!(compute_points(i64::MAX, 1_000_000), i64::MAX / 100);
    // Absurd multiplier: result saturates instead of wrapping.
    assert_eq!(compute_points(i64::MAX, i64::MAX), i64::MAX);
    // Negative base (defensive — sale totals are non-negative): half-up
    // toward +∞, the house convention. -3.5 → -3.
    assert_eq!(compute_points(-250, 1_400_000), -3);
}

#[test]
fn earn_points_22_50_at_1_4x_tier_earns_32() {
    // The real-world repro, end to end through the DB path: Gold-style
    // tier "1 point per dollar, 1.4× bonus", $22.50 sale.
    let conn = fresh();
    seed_customer(&conn, "cust-1", "Alice");
    seed_sale(&conn, "sale-1");
    let s = store(&conn);
    s.get_or_create_loyalty_account("cust-1").unwrap();
    s.update_tier("tier-bronze", "Bronze", 0, 1, 1_400_000, "#cd7f32")
        .unwrap();
    let txn = s.earn_points("cust-1", "sale-1", 2250).unwrap();
    assert_eq!(
        txn.points, 32,
        "22.5 × 1.4 = 31.5 → half-up 32; the old f64 path earned 31"
    );
}
