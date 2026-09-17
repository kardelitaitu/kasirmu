//! Integration tests for the gift cards module — issue, redeem, top-up,
//! freeze/unfreeze, balance tracking, idempotency, and filters.
//!
//! Tests exercise the full persistence layer via the public
//! [`kasirmu_core::Store`] API against an in-memory SQLite database.

use kasirmu_core::{GiftCardFilter, IssueGiftCardInput, Store, migrations};
use rusqlite::Connection;

// ── Helpers ───────────────────────────────────────────────────────────

fn setup() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    migrations::run(&mut conn).unwrap();
    conn
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn seed_user(conn: &Connection, id: &str) {
    conn.execute(
        "INSERT OR IGNORE INTO roles (id, name, description, permissions, created_at, updated_at)
         VALUES ('role-owner', 'Owner', 'Owner role', '[\"*\"]',
                 '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id,
                            created_at, updated_at)
         VALUES (?1, ?2, 'hash', ?3, 'role-owner',
                 '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        rusqlite::params![id, id, id],
    )
    .unwrap();
}

fn seed_sale(conn: &Connection, sale_id: &str, total_minor: i64) {
    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at,
                            subtotal_minor, tax_total_minor)
         VALUES (?1, ?2, 'IDR', 0, 'completed',
                 '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', ?2, 0)",
        rusqlite::params![sale_id, total_minor],
    )
    .unwrap();
}

fn issue_card(conn: &Connection, card_number: &str, amount: i64, issued_to: Option<&str>) {
    store(conn)
        .issue_gift_card(IssueGiftCardInput {
            card_number: card_number.into(),
            pin: None,
            initial_amount_minor: amount,
            currency: "IDR".into(),
            issued_to: issued_to.map(|s| s.into()),
            created_by: "staff-1".into(),
            expiry_date: None,
        })
        .unwrap();
}

// ── Full Lifecycle ───────────────────────────────────────────────────

#[test]
fn full_lifecycle_issue_redeem_topup() {
    let conn = setup();
    seed_user(&conn, "staff-1");
    seed_sale(&conn, "sale-1", 30000);

    // Issue.
    let result = store(&conn)
        .issue_gift_card(IssueGiftCardInput {
            card_number: "GC-LIFECYCLE".into(),
            pin: Some("1234".into()),
            initial_amount_minor: 100000,
            currency: "IDR".into(),
            issued_to: Some("Alice".into()),
            created_by: "staff-1".into(),
            expiry_date: None,
        })
        .unwrap();
    assert_eq!(result.card.current_balance_minor, 100000);
    assert_eq!(result.card.status, "active");
    assert_eq!(result.transactions.len(), 1);
    assert_eq!(result.transactions[0].txn_type, "issue");

    // Check balance.
    let (bal, currency, status) = store(&conn)
        .get_gift_card_balance("GC-LIFECYCLE")
        .unwrap()
        .unwrap();
    assert_eq!(bal, 100000);
    assert_eq!(currency, "IDR");
    assert_eq!(status, "active");

    // Redeem.
    let redeemed = store(&conn)
        .redeem_gift_card("GC-LIFECYCLE", 30000, "sale-1")
        .unwrap();
    assert_eq!(redeemed.card.current_balance_minor, 70000);
    assert_eq!(redeemed.transaction.amount_minor, -30000);

    // Top-up.
    let topped = store(&conn)
        .top_up_gift_card("GC-LIFECYCLE", 50000)
        .unwrap();
    assert_eq!(topped.card.current_balance_minor, 120000);

    // Final balance check.
    let (final_bal, _, _) = store(&conn)
        .get_gift_card_balance("GC-LIFECYCLE")
        .unwrap()
        .unwrap();
    assert_eq!(final_bal, 120000);
}

#[test]
fn auto_redeemed_when_balance_hits_zero() {
    let conn = setup();
    seed_user(&conn, "staff-1");
    seed_sale(&conn, "sale-zero", 50000);

    issue_card(&conn, "GC-ZERO", 50000, None);

    let redeemed = store(&conn)
        .redeem_gift_card("GC-ZERO", 50000, "sale-zero")
        .unwrap();
    assert_eq!(redeemed.card.current_balance_minor, 0);
    assert_eq!(redeemed.card.status, "redeemed");
}

// ── Idempotency ──────────────────────────────────────────────────────

#[test]
fn redeem_is_idempotent_same_card_and_sale() {
    let conn = setup();
    seed_user(&conn, "staff-1");
    seed_sale(&conn, "sale-idem", 10000);

    issue_card(&conn, "GC-IDEM", 50000, None);

    let r1 = store(&conn)
        .redeem_gift_card("GC-IDEM", 10000, "sale-idem")
        .unwrap();
    let r2 = store(&conn)
        .redeem_gift_card("GC-IDEM", 10000, "sale-idem")
        .unwrap();

    assert_eq!(r1.card.current_balance_minor, r2.card.current_balance_minor);
    assert_eq!(r1.transaction.id, r2.transaction.id);
    // Balance deducted only once.
    assert_eq!(r1.card.current_balance_minor, 40000);
}

#[test]
fn redeem_idempotent_with_different_sale_is_not_duplicate() {
    let conn = setup();
    seed_user(&conn, "staff-1");
    seed_sale(&conn, "sale-a", 10000);
    seed_sale(&conn, "sale-b", 15000);

    issue_card(&conn, "GC-MULTI", 50000, None);

    let r1 = store(&conn)
        .redeem_gift_card("GC-MULTI", 10000, "sale-a")
        .unwrap();
    let r2 = store(&conn)
        .redeem_gift_card("GC-MULTI", 15000, "sale-b")
        .unwrap();

    assert_ne!(r1.transaction.id, r2.transaction.id);
    assert_eq!(r2.card.current_balance_minor, 25000);
    // 50000 - 10000 - 15000 = 25000.
}

// ── Freeze / Unfreeze ────────────────────────────────────────────────

#[test]
fn freeze_rejects_redemption() {
    let conn = setup();
    seed_user(&conn, "staff-1");
    seed_sale(&conn, "sale-frozen", 10000);

    issue_card(&conn, "GC-FROZEN", 50000, None);

    let frozen = store(&conn).freeze_gift_card("GC-FROZEN").unwrap();
    assert_eq!(frozen.status, "frozen");

    let err = store(&conn)
        .redeem_gift_card("GC-FROZEN", 10000, "sale-frozen")
        .unwrap_err();
    assert!(
        matches!(
            &err,
            kasirmu_core::CoreError::Validation {
                field: "status",
                ..
            }
        ),
        "expected status validation error, got: {err:?}"
    );
}

#[test]
fn unfreeze_restores_redemption() {
    let conn = setup();
    seed_user(&conn, "staff-1");
    seed_sale(&conn, "sale-unfreeze", 10000);

    issue_card(&conn, "GC-UNFREEZE", 50000, None);
    store(&conn).freeze_gift_card("GC-UNFREEZE").unwrap();

    let unfrozen = store(&conn).unfreeze_gift_card("GC-UNFREEZE").unwrap();
    assert_eq!(unfrozen.status, "active");

    // Should now succeed.
    let result = store(&conn)
        .redeem_gift_card("GC-UNFREEZE", 10000, "sale-unfreeze")
        .unwrap();
    assert_eq!(result.card.current_balance_minor, 40000);
}

#[test]
fn top_up_on_frozen_card_reactivates() {
    let conn = setup();
    seed_user(&conn, "staff-1");

    issue_card(&conn, "GC-TOPUP-FROZEN", 50000, None);
    store(&conn).freeze_gift_card("GC-TOPUP-FROZEN").unwrap();

    let result = store(&conn)
        .top_up_gift_card("GC-TOPUP-FROZEN", 20000)
        .unwrap();
    assert_eq!(result.card.status, "active");
    assert_eq!(result.card.current_balance_minor, 70000);
}

// ── Edge Cases ────────────────────────────────────────────────────────

#[test]
fn redeem_nonexistent_card_fails() {
    let conn = setup();
    seed_sale(&conn, "sale-nope", 10000);

    let err = store(&conn)
        .redeem_gift_card("GC-NOPE", 10000, "sale-nope")
        .unwrap_err();
    assert!(
        matches!(
            &err,
            kasirmu_core::CoreError::NotFound {
                entity: "gift_card",
                ..
            }
        ),
        "expected NotFound for gift_card, got: {err:?}"
    );
}

#[test]
fn redeem_insufficient_balance_fails() {
    let conn = setup();
    seed_user(&conn, "staff-1");
    seed_sale(&conn, "sale-insuf", 99999);

    issue_card(&conn, "GC-INSF", 5000, None);

    let err = store(&conn)
        .redeem_gift_card("GC-INSF", 10000, "sale-insuf")
        .unwrap_err();
    assert!(
        matches!(
            &err,
            kasirmu_core::CoreError::Validation {
                field: "current_balance_minor",
                ..
            }
        ),
        "expected current_balance_minor validation error, got: {err:?}"
    );
}

#[test]
fn issue_with_zero_amount_fails() {
    let conn = setup();
    seed_user(&conn, "staff-1");

    let err = store(&conn)
        .issue_gift_card(IssueGiftCardInput {
            card_number: "GC-ZEROAMT".into(),
            pin: None,
            initial_amount_minor: 0,
            currency: "IDR".into(),
            issued_to: None,
            created_by: "staff-1".into(),
            expiry_date: None,
        })
        .unwrap_err();
    assert!(
        matches!(
            &err,
            kasirmu_core::CoreError::Validation {
                field: "initial_amount_minor",
                ..
            }
        ),
        "expected initial_amount_minor validation error, got: {err:?}"
    );
}

#[test]
fn balance_check_for_nonexistent_card_returns_none() {
    let conn = setup();
    let result = store(&conn)
        .get_gift_card_balance("DOES_NOT_EXIST")
        .unwrap();
    assert!(result.is_none());
}

#[test]
fn get_gift_card_detail_includes_transactions() {
    let conn = setup();
    seed_user(&conn, "staff-1");
    seed_sale(&conn, "sale-detail", 10000);

    issue_card(&conn, "GC-DETAIL", 50000, Some("Bob"));

    // Sleep to guarantee distinct timestamps so `ORDER BY created_at DESC`
    // is deterministic — same pattern as in `crate::db::gift_cards` unit tests.
    std::thread::sleep(std::time::Duration::from_millis(5));

    store(&conn)
        .redeem_gift_card("GC-DETAIL", 10000, "sale-detail")
        .unwrap();

    let detail = store(&conn)
        .get_gift_card_detail("GC-DETAIL")
        .unwrap()
        .unwrap();
    assert_eq!(detail.card.card_number, "GC-DETAIL");
    assert_eq!(detail.card.current_balance_minor, 40000);
    assert!(detail.transactions.len() >= 2);
    // Most recent transaction should be the redeem.
    assert_eq!(detail.transactions[0].txn_type, "redeem");
}

// ── Filters ──────────────────────────────────────────────────────────

#[test]
fn list_all_gift_cards_unfiltered() {
    let conn = setup();
    seed_user(&conn, "staff-1");

    issue_card(&conn, "GC-LA", 10000, Some("Alice"));
    issue_card(&conn, "GC-LB", 20000, Some("Bob"));
    issue_card(&conn, "GC-LC", 30000, None);

    let all = store(&conn)
        .list_gift_cards(GiftCardFilter::default())
        .unwrap();
    assert_eq!(all.len(), 3);
}

#[test]
fn list_filter_by_search_matches_card_number() {
    let conn = setup();
    seed_user(&conn, "staff-1");

    issue_card(&conn, "GC-SEARCH-A", 10000, None);
    issue_card(&conn, "GC-SEARCH-B", 20000, None);

    let results = store(&conn)
        .list_gift_cards(GiftCardFilter {
            search: Some("SEARCH-A".into()),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].card.card_number, "GC-SEARCH-A");
}

#[test]
fn list_filter_by_issued_to_name() {
    let conn = setup();
    seed_user(&conn, "staff-1");

    issue_card(&conn, "GC-NAME-A", 10000, Some("Alice"));
    issue_card(&conn, "GC-NAME-B", 20000, Some("Bob"));

    let results = store(&conn)
        .list_gift_cards(GiftCardFilter {
            search: Some("Alice".into()),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].card.issued_to, "Alice");
}

#[test]
fn list_filter_by_status() {
    let conn = setup();
    seed_user(&conn, "staff-1");

    issue_card(&conn, "GC-STAT-A", 10000, None);
    issue_card(&conn, "GC-STAT-B", 20000, None);
    store(&conn).freeze_gift_card("GC-STAT-B").unwrap();

    let active = store(&conn)
        .list_gift_cards(GiftCardFilter {
            status: Some("active".into()),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(active.len(), 1);
    assert_eq!(active[0].card.card_number, "GC-STAT-A");

    let frozen = store(&conn)
        .list_gift_cards(GiftCardFilter {
            status: Some("frozen".into()),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(frozen.len(), 1);
    assert_eq!(frozen[0].card.card_number, "GC-STAT-B");
}

#[test]
fn list_filter_by_min_balance() {
    let conn = setup();
    seed_user(&conn, "staff-1");

    issue_card(&conn, "GC-BAL-LOW", 5000, None);
    issue_card(&conn, "GC-BAL-HIGH", 50000, None);

    let results = store(&conn)
        .list_gift_cards(GiftCardFilter {
            min_balance: Some(20000),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].card.card_number, "GC-BAL-HIGH");
}

#[test]
fn list_empty_when_no_cards() {
    let conn = setup();
    let results = store(&conn)
        .list_gift_cards(GiftCardFilter::default())
        .unwrap();
    assert!(results.is_empty());
}

// ── Pin handling ─────────────────────────────────────────────────────

#[test]
fn issue_with_pin_includes_pin_in_card() {
    let conn = setup();
    seed_user(&conn, "staff-1");

    let result = store(&conn)
        .issue_gift_card(IssueGiftCardInput {
            card_number: "GC-PIN".into(),
            pin: Some("9876".into()),
            initial_amount_minor: 50000,
            currency: "IDR".into(),
            issued_to: None,
            created_by: "staff-1".into(),
            expiry_date: None,
        })
        .unwrap();
    assert_eq!(result.card.pin, "9876");
}

#[test]
fn issue_without_pin_has_empty_pin() {
    let conn = setup();
    seed_user(&conn, "staff-1");

    let result = store(&conn)
        .issue_gift_card(IssueGiftCardInput {
            card_number: "GC-NOPIN".into(),
            pin: None,
            initial_amount_minor: 30000,
            currency: "IDR".into(),
            issued_to: None,
            created_by: "staff-1".into(),
            expiry_date: None,
        })
        .unwrap();
    assert_eq!(result.card.pin, "");
}

// ── Lookup by id ─────────────────────────────────────────────────────

#[test]
fn get_gift_card_by_uuid_id() {
    let conn = setup();
    seed_user(&conn, "staff-1");

    let issued = store(&conn)
        .issue_gift_card(IssueGiftCardInput {
            card_number: "GC-BYID".into(),
            pin: None,
            initial_amount_minor: 25000,
            currency: "IDR".into(),
            issued_to: None,
            created_by: "staff-1".into(),
            expiry_date: None,
        })
        .unwrap();

    // Look up by the UUID id, not card number.
    let card = store(&conn)
        .get_gift_card(&issued.card.id)
        .unwrap()
        .unwrap();
    assert_eq!(card.card_number, "GC-BYID");
    assert_eq!(card.current_balance_minor, 25000);
}
