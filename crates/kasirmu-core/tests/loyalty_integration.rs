//! Integration tests for the loyalty module — account creation, point
//! earning with tier multipliers, redemption, tier auto-upgrade, and
//! point value conversion.
//!
//! Tests exercise the full persistence layer via the public
//! [`kasirmu_core::Store`] API against an in-memory SQLite database.

use kasirmu_core::{Store, migrations};
use rusqlite::Connection;

// ── Helpers ───────────────────────────────────────────────────────────

fn setup() -> Connection {
    // O-T01: snapshot clone (~3 ms) rather than a 68-migration replay (~305 ms).
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn seed_customer(conn: &Connection, id: &str, name: &str) {
    conn.execute(
        "INSERT INTO customers (id, name, notes, created_at, updated_at)
         VALUES (?1, ?2, '', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        rusqlite::params![id, name],
    )
    .unwrap();
}

fn seed_sale(conn: &Connection, id: &str, total_minor: i64) {
    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at,
                            subtotal_minor, tax_total_minor)
         VALUES (?1, ?2, 'USD', 0, 'completed',
                 '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', ?2, 0)",
        rusqlite::params![id, total_minor],
    )
    .unwrap();
}

fn seed_customer_sale(conn: &Connection, id: &str, customer_id: &str, total_minor: i64) {
    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, customer_id, created_at, updated_at,
                            subtotal_minor, tax_total_minor)
         VALUES (?1, ?2, 'USD', 0, 'completed', ?3,
                 '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', ?2, 0)",
        rusqlite::params![id, total_minor, customer_id],
    )
    .unwrap();
}

// ── Account Creation ──────────────────────────────────────────────────

#[test]
fn create_account_for_new_customer_defaults_to_bronze() {
    let conn = setup();
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
fn create_account_is_idempotent() {
    let conn = setup();
    seed_customer(&conn, "cust-1", "Alice");

    let a1 = store(&conn)
        .get_or_create_loyalty_account("cust-1")
        .unwrap();
    let a2 = store(&conn)
        .get_or_create_loyalty_account("cust-1")
        .unwrap();

    assert_eq!(a1.id, a2.id);
    assert_eq!(a1.points, a2.points);
}

#[test]
fn create_account_nonexistent_customer_fails() {
    let conn = setup();
    let err = store(&conn)
        .get_or_create_loyalty_account("nope")
        .unwrap_err();
    assert!(matches!(
        err,
        kasirmu_core::CoreError::NotFound {
            entity: "customer",
            ..
        }
    ));
}

// ── Earn Points ──────────────────────────────────────────────────────

#[test]
fn earn_points_bronze_tier_default_rate() {
    let conn = setup();
    seed_customer(&conn, "cust-1", "Alice");
    seed_sale(&conn, "sale-1", 1000);

    let txn = store(&conn).earn_points("cust-1", "sale-1", 1000).unwrap();

    // Bronze: points_per_unit=10, multiplier=1.0 → 1000*10/100*1.0 = 100
    assert_eq!(txn.txn_type, "earn");
    assert_eq!(txn.points, 100);

    let details = store(&conn).get_loyalty_account("cust-1").unwrap().unwrap();
    assert_eq!(details.account.points, 100);
    assert_eq!(details.account.lifetime_points, 100);
}

#[test]
fn earn_points_silver_tier_higher_multiplier() {
    let conn = setup();
    seed_customer(&conn, "cust-1", "Alice");
    seed_sale(&conn, "sale-1", 1000);

    // Create account, then manually upgrade to Silver.
    store(&conn)
        .get_or_create_loyalty_account("cust-1")
        .unwrap();
    conn.execute(
        "UPDATE loyalty_accounts SET tier_id = 'tier-silver' WHERE customer_id = 'cust-1'",
        [],
    )
    .unwrap();

    let txn = store(&conn).earn_points("cust-1", "sale-1", 1000).unwrap();

    // Silver: points_per_unit=10, multiplier=1.25 → 1000*10/100*1.25 = 125
    assert_eq!(txn.points, 125);
}

#[test]
fn earn_points_gold_tier() {
    let conn = setup();
    seed_customer(&conn, "cust-1", "Alice");
    seed_sale(&conn, "sale-1", 2000);

    store(&conn)
        .get_or_create_loyalty_account("cust-1")
        .unwrap();
    conn.execute(
        "UPDATE loyalty_accounts SET tier_id = 'tier-gold' WHERE customer_id = 'cust-1'",
        [],
    )
    .unwrap();

    // Gold tier earns 300 pts on 2000 spend (multiplier 1.5).
    let txn = store(&conn).earn_points("cust-1", "sale-1", 2000).unwrap();
    assert_eq!(txn.points, 300);
}

#[test]
fn earn_points_platinum_tier() {
    let conn = setup();
    seed_customer(&conn, "cust-1", "Alice");
    seed_sale(&conn, "sale-1", 5000);

    store(&conn)
        .get_or_create_loyalty_account("cust-1")
        .unwrap();
    conn.execute(
        "UPDATE loyalty_accounts SET tier_id = 'tier-platinum' WHERE customer_id = 'cust-1'",
        [],
    )
    .unwrap();

    // Platinum tier earns 1000 pts on 5000 spend (multiplier 2.0).
    let txn = store(&conn).earn_points("cust-1", "sale-1", 5000).unwrap();
    assert_eq!(txn.points, 1000);
}

#[test]
fn earn_points_too_small_fails() {
    let conn = setup();
    seed_customer(&conn, "cust-1", "Alice");
    seed_sale(&conn, "sale-1", 1);

    // 1 * 10 / 100 * 1.0 = 0.1 → rounds to 0 → error.
    let err = store(&conn).earn_points("cust-1", "sale-1", 1).unwrap_err();
    assert!(matches!(
        err,
        kasirmu_core::CoreError::Validation {
            field: "total_minor",
            ..
        }
    ));
}

// ── Tier Auto-Upgrade ────────────────────────────────────────────────

#[test]
fn tier_auto_upgrades_when_lifetime_points_exceed_threshold() {
    let conn = setup();
    seed_customer(&conn, "cust-1", "Alice");

    // Bronze → Silver at 500 lifetime. Bronze * 1.0 = 100pt/$100 → need $500 spend.
    // Silver → Gold at 2500 lifetime.
    // Gold → Platinum at 10000 lifetime.

    // Earn 500 points worth → lifetime becomes 500 → upgrades to Silver.
    store(&conn)
        .get_or_create_loyalty_account("cust-1")
        .unwrap();

    // Manually set lifetime_points to 499 to be just below Silver threshold.
    conn.execute(
        "UPDATE loyalty_accounts SET lifetime_points = 499, points = 499 WHERE customer_id = 'cust-1'",
        [],
    )
    .unwrap();
    conn.execute(
        "UPDATE loyalty_accounts SET tier_id = (SELECT id FROM loyalty_tiers WHERE min_points <= 499 ORDER BY min_points DESC LIMIT 1) WHERE customer_id = 'cust-1'",
        [],
    )
    .unwrap();

    // Earn 10 more points to cross a tier threshold.
    seed_sale(&conn, "sale-cross", 100);
    store(&conn)
        .earn_points("cust-1", "sale-cross", 100)
        .unwrap();

    let details = store(&conn).get_loyalty_account("cust-1").unwrap().unwrap();
    // Tier should have auto-upgraded from Bronze to something higher.
    assert_ne!(details.account.tier_id.as_deref(), Some("tier-bronze"));
    assert!(details.account.lifetime_points >= 500);
}

// ── Redeem ────────────────────────────────────────────────────────────

#[test]
fn redeem_points_returns_discount_value() {
    let conn = setup();
    seed_customer(&conn, "cust-1", "Alice");
    seed_sale(&conn, "sale-1", 5000);
    // The redemption target sale must belong to the customer AND have a
    // total >= the redemption value (audit-open-findings: redemption cannot exceed the
    // sale total).
    seed_customer_sale(&conn, "sale-2", "cust-1", 1000);

    store(&conn).earn_points("cust-1", "sale-1", 5000).unwrap();
    // Bronze: 5000 * 10 / 100 * 1.0 = 500 points earned.

    let (txn, discount) = store(&conn).redeem_points("cust-1", 200, "sale-2").unwrap();
    assert_eq!(txn.points, -200);
    assert_eq!(txn.txn_type, "redeem");
    assert_eq!(discount, 200); // 200 points = 200 minor units

    let details = store(&conn).get_loyalty_account("cust-1").unwrap().unwrap();
    assert_eq!(details.account.points, 300); // 500 - 200
}

#[test]
fn redeem_insufficient_points_fails() {
    let conn = setup();
    seed_customer(&conn, "cust-1", "Alice");
    // The sale must belong to the customer and have a total >= 100 so the
    // insufficient-balance guard is what rejects the redemption (audit-open-findings).
    seed_customer_sale(&conn, "sale-1", "cust-1", 1000);

    store(&conn)
        .get_or_create_loyalty_account("cust-1")
        .unwrap();

    let err = store(&conn)
        .redeem_points("cust-1", 100, "sale-1")
        .unwrap_err();
    assert!(matches!(
        err,
        kasirmu_core::CoreError::Validation {
            field: "points",
            ..
        }
    ));
}

#[test]
fn redeem_zero_or_negative_points_fails() {
    let conn = setup();
    seed_customer(&conn, "cust-1", "Alice");
    seed_sale(&conn, "sale-1", 0);

    store(&conn)
        .get_or_create_loyalty_account("cust-1")
        .unwrap();

    let err = store(&conn)
        .redeem_points("cust-1", 0, "sale-1")
        .unwrap_err();
    assert!(matches!(
        err,
        kasirmu_core::CoreError::Validation {
            field: "points",
            ..
        }
    ));
}

#[test]
fn redeem_no_account_fails() {
    let conn = setup();
    seed_sale(&conn, "sale-1", 0);

    let err = store(&conn)
        .redeem_points("cust-noacct", 100, "sale-1")
        .unwrap_err();
    assert!(matches!(
        err,
        kasirmu_core::CoreError::NotFound {
            entity: "loyalty_account",
            ..
        }
    ));
}

// ── Account Details ──────────────────────────────────────────────────

#[test]
fn get_loyalty_account_includes_tier_and_transactions() {
    let conn = setup();
    seed_customer(&conn, "cust-1", "Alice");
    seed_sale(&conn, "sale-1", 1000);
    seed_sale(&conn, "sale-2", 2000);

    store(&conn).earn_points("cust-1", "sale-1", 1000).unwrap();

    // Sleep to guarantee distinct timestamps so ORDER BY created_at DESC
    // is deterministic.
    std::thread::sleep(std::time::Duration::from_millis(5));

    store(&conn).earn_points("cust-1", "sale-2", 2000).unwrap();

    let details = store(&conn).get_loyalty_account("cust-1").unwrap().unwrap();

    assert_eq!(details.account.customer_id, "cust-1");
    assert!(details.tier.is_some());
    assert_eq!(details.recent_transactions.len(), 2);
    // Transactions are most-recent-first, so sale-2's earn should be first.
    assert_eq!(
        details.recent_transactions[0].sale_id.as_deref(),
        Some("sale-2")
    );
}

#[test]
fn get_loyalty_account_nonexistent_returns_none() {
    let conn = setup();
    let result = store(&conn).get_loyalty_account("nope").unwrap();
    assert!(result.is_none());
}

// ── Tiers ─────────────────────────────────────────────────────────────

#[test]
fn list_tiers_includes_all_four_defaults() {
    let conn = setup();
    let tiers = store(&conn).list_tiers().unwrap();

    assert_eq!(tiers.len(), 4);
    assert_eq!(tiers[0].name, "Bronze");
    assert_eq!(tiers[1].name, "Silver");
    assert_eq!(tiers[2].name, "Gold");
    assert_eq!(tiers[3].name, "Platinum");
}

#[test]
fn update_tier_persists_changes() {
    let conn = setup();
    let updated = store(&conn)
        .update_tier("tier-bronze", "Bronze+", 0, 12, 1_500_000, "#ff6600")
        .unwrap();

    assert_eq!(updated.name, "Bronze+");
    assert_eq!(updated.points_per_unit, 12);
    assert_eq!(updated.earn_multiplier_millionths, 1_500_000);
    assert_eq!(updated.colour, "#ff6600");
}

#[test]
fn update_tier_not_found() {
    let conn = setup();
    let err = store(&conn)
        .update_tier("no-such-tier", "X", 0, 10, 1_000_000, "#000")
        .unwrap_err();
    assert!(matches!(
        err,
        kasirmu_core::CoreError::NotFound {
            entity: "loyalty_tier",
            ..
        }
    ));
}

// ── Points Value ─────────────────────────────────────────────────────

#[test]
fn get_points_value_conversion() {
    let conn = setup();
    let s = store(&conn);

    assert_eq!(s.get_points_value(100).unwrap(), 100);
    assert_eq!(s.get_points_value(500).unwrap(), 500);
    assert_eq!(s.get_points_value(0).unwrap(), 0);
}

// ── List All Accounts ────────────────────────────────────────────────

#[test]
fn list_loyalty_accounts_sorted_by_lifetime_points() {
    let conn = setup();
    seed_customer(&conn, "cust-1", "Alice");
    seed_customer(&conn, "cust-2", "Bob");
    seed_sale(&conn, "sale-1", 1000);
    seed_sale(&conn, "sale-2", 5000);

    store(&conn).earn_points("cust-1", "sale-1", 1000).unwrap();
    store(&conn).earn_points("cust-2", "sale-2", 5000).unwrap();

    let list = store(&conn).list_loyalty_accounts().unwrap();
    assert_eq!(list.len(), 2);
    // Bob has 500 points, Alice has 100 — Bob first.
    assert_eq!(list[0].account.customer_id, "cust-2");
    assert_eq!(list[1].account.customer_id, "cust-1");
}

// ── Multi-currency earn basis (CUR-02 base_total_minor) ──────────────
//
// `finalize_sale` awards loyalty on completion via
// `apply_customer_stats_on_completion`, which reads
//   SELECT customer_id, base_total_minor, total_minor FROM sales WHERE id = ?1
// and takes `base_total_minor.unwrap_or(total_minor)` as the earn basis, because
// the points formula is currency-naive and charging in a low-exponent currency
// would otherwise multiply the reward by the exchange rate (LOY-06).
//
// This branch had NO coverage: every `base_total_minor` under
// crates/kasirmu-core/tests was `None`, so the multi-currency selection was
// never executed. The tests below drive the REAL public entry (`finalize_sale`,
// pending -> completed) rather than a private function.

/// Seed a PENDING sale so `finalize_sale` will award, carrying the CUR-02
/// snapshot columns when `base_total_minor` is supplied.
fn seed_pending_sale_for_finalize(
    conn: &Connection,
    id: &str,
    customer_id: &str,
    charged_minor: i64,
    base_total_minor: Option<i64>,
) {
    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, customer_id, created_at, updated_at,
                            subtotal_minor, tax_total_minor, base_currency, base_total_minor)
         VALUES (?1, ?2, 'IDR', 0, 'pending', ?3,
                 '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', ?2, 0, 'USD', ?4)",
        rusqlite::params![id, charged_minor, customer_id, base_total_minor],
    )
    .unwrap();
}

/// THE REPRODUCE, and it PASSES AGAINST HEAD: a sale charged in IDR for a
/// high-exponent-currency order must earn on the BASE amount, not the charged
/// one. IDR has exponent 0, so charged_minor is the whole figure; a USD 100.00
/// order is 10000 base minor units, which is 10_000_000 in IDR minor units.
/// Earning on the charged figure would award 10000x the intended points.
#[test]
fn earn_basis_prefers_base_total_over_the_charged_total() {
    let conn = setup();
    seed_customer(&conn, "cust-1", "Alice");
    seed_pending_sale_for_finalize(&conn, "sale-1", "cust-1", 10_000_000, Some(10_000));

    store(&conn).finalize_sale("sale-1").unwrap();

    let account = store(&conn).get_loyalty_account("cust-1").unwrap().unwrap();
    // Bronze: points_per_unit=10, multiplier=1.0.
    //   on base    10000 -> 10000 * 10 / 100 * 1.0 =  1000 points
    //   on charged 10_000_000 ->                     10000 points (10x wrong)
    assert_eq!(account.account.points, 1000);
}

/// Without the CUR-02 snapshot the earn basis is the sale total, so the
/// single-currency path is unaffected by the branch above.
#[test]
fn earn_basis_falls_back_to_the_sale_total_without_the_snapshot() {
    let conn = setup();
    seed_customer(&conn, "cust-1", "Alice");
    seed_pending_sale_for_finalize(&conn, "sale-1", "cust-1", 1000, None);

    store(&conn).finalize_sale("sale-1").unwrap();

    let account = store(&conn).get_loyalty_account("cust-1").unwrap().unwrap();
    assert_eq!(account.account.points, 100);
}

/// WHAT THE SERVER DOES NOT DO, pinned so the trust gap is an executable
/// statement rather than a comment. `base_total_minor` is written by the client
/// (pos/checkout.rs:427) and no server read re-derives it, so the row is BELIEVED.
/// This is the test to delete when the value is bounded or re-derived: while it
/// stands, it is the executable record that an implausible claim is honoured.
#[test]
fn base_total_minor_is_believed_without_re_derivation() {
    let conn = setup();
    seed_customer(&conn, "cust-1", "Alice");
    // An earn basis 1000x the sale total.
    seed_pending_sale_for_finalize(&conn, "sale-1", "cust-1", 1000, Some(1_000_000));

    store(&conn).finalize_sale("sale-1").unwrap();

    let account = store(&conn).get_loyalty_account("cust-1").unwrap().unwrap();
    // Points follow the client's base_total_minor, not the 1000-unit sale.
    assert_eq!(account.account.points, 100_000);
}

/// The lifetime-spend balance has TWO production writers in different
/// transactions: accrue on completion and reverse on refund, the latter via
/// `MAX(total_spent_minor - ?1, 0)` (customers.rs:400). The floor is what makes
/// that worth testing — a refund applied before its sale is counted clamps at
/// zero and the under-count is swallowed, leaving a wrong number that later sales
/// add on top of. Every existing customer_integration case writes the column
/// directly, so none of them exercises the pair.

/// THE REPRODUCE, and it PASSES AGAINST HEAD: a completed sale followed by a full
/// refund returns the customer to zero. Both sides derive the amount from the
/// same basis, so the pair is symmetric on the happy path.
#[test]
fn completed_sale_then_full_refund_returns_lifetime_spend_to_zero() {
    let conn = setup();
    seed_customer(&conn, "cust-1", "Alice");
    seed_pending_sale_for_finalize(&conn, "sale-1", "cust-1", 1000, None);

    store(&conn).finalize_sale("sale-1").unwrap();
    let after_sale: i64 = conn
        .query_row(
            "SELECT total_spent_minor FROM customers WHERE id = 'cust-1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(after_sale, 1000);

    // Reverse exactly what was accrued, through the production helper.
    kasirmu_core::db::Store::reverse_lifetime_spend_in_tx(
        &conn,
        "cust-1",
        1000,
        "2025-01-01T00:00:00.000Z",
    )
    .unwrap();

    let after_refund: i64 = conn
        .query_row(
            "SELECT total_spent_minor FROM customers WHERE id = 'cust-1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(after_refund, 0);
}

/// The floor, pinned. This is the C64 failure mode: reversing a refund against a
/// spend that was never accrued clamps to zero and the 900-unit shortfall is
/// swallowed, so a LATER sale adds on top of a wrong base. The assertion below is
/// what a correct implementation would change.
#[test]
fn refund_before_its_sale_is_credited_swallows_the_under_count() {
    let conn = setup();
    seed_customer(&conn, "cust-1", "Alice");

    // No sale has completed, so nothing has been accrued.
    kasirmu_core::db::Store::reverse_lifetime_spend_in_tx(
        &conn,
        "cust-1",
        900,
        "2025-01-01T00:00:00.000Z",
    )
    .unwrap();

    let after: i64 = conn
        .query_row(
            "SELECT total_spent_minor FROM customers WHERE id = 'cust-1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    // The floor hides the 900 the refund could not apply.
    assert_eq!(after, 0);

    // A later sale then accrues onto a base that is 900 short of the truth.
    seed_pending_sale_for_finalize(&conn, "sale-1", "cust-1", 1000, None);
    store(&conn).finalize_sale("sale-1").unwrap();
    let final_total: i64 = conn
        .query_row(
            "SELECT total_spent_minor FROM customers WHERE id = 'cust-1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(final_total, 1000);
}
