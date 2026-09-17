use super::*;
use crate::migrations;
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn seed_user(conn: &Connection, id: &str) {
    // The actual users schema (from 021_shifts.sql et al) uses
    // `username, pin_hash, display_name, role_id` rather than the
    // `name, pin, role` columns a casual reader might guess from
    // the crate's domain types. Seed the FK target role first.
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
        params![id, id, id],
    )
    .unwrap();
}

#[test]
fn issue_gift_card_creates_card_and_transaction() {
    let conn = fresh();
    seed_user(&conn, "staff-1");
    let result = store(&conn)
        .issue_gift_card(IssueGiftCardInput {
            card_number: "GC-1001".into(),
            pin: None,
            initial_amount_minor: 50000,
            currency: "IDR".into(),
            issued_to: Some("Alice".into()),
            created_by: "staff-1".into(),
            expiry_date: None,
        })
        .unwrap();

    assert_eq!(result.card.card_number, "GC-1001");
    assert_eq!(result.card.current_balance_minor, 50000);
    assert_eq!(result.card.status, "active");
    assert_eq!(result.transactions.len(), 1);
    assert_eq!(result.transactions[0].txn_type, "issue");
}

#[test]
fn issue_gift_card_with_zero_amount_fails() {
    let conn = fresh();
    seed_user(&conn, "staff-1");
    let err = store(&conn)
        .issue_gift_card(IssueGiftCardInput {
            card_number: "GC-1002".into(),
            pin: None,
            initial_amount_minor: 0,
            currency: "IDR".into(),
            issued_to: None,
            created_by: "staff-1".into(),
            expiry_date: None,
        })
        .unwrap_err();
    assert!(matches!(
        err,
        CoreError::Validation {
            field: "initial_amount_minor",
            ..
        }
    ));
}

#[test]
fn get_gift_card_by_card_number() {
    let conn = fresh();
    seed_user(&conn, "staff-1");
    store(&conn)
        .issue_gift_card(IssueGiftCardInput {
            card_number: "GC-2001".into(),
            pin: None,
            initial_amount_minor: 100000,
            currency: "IDR".into(),
            issued_to: None,
            created_by: "staff-1".into(),
            expiry_date: None,
        })
        .unwrap();

    let card = store(&conn).get_gift_card("GC-2001").unwrap().unwrap();
    assert_eq!(card.current_balance_minor, 100000);
}

#[test]
fn get_gift_card_returns_none_for_unknown() {
    let conn = fresh();
    let card = store(&conn).get_gift_card("NONEXISTENT").unwrap();
    assert!(card.is_none());
}

#[test]
fn get_gift_card_balance_returns_tuple() {
    let conn = fresh();
    seed_user(&conn, "staff-1");
    store(&conn)
        .issue_gift_card(IssueGiftCardInput {
            card_number: "GC-3001".into(),
            pin: None,
            initial_amount_minor: 75000,
            currency: "IDR".into(),
            issued_to: Some("Bob".into()),
            created_by: "staff-1".into(),
            expiry_date: None,
        })
        .unwrap();

    let (balance, currency, status) = store(&conn)
        .get_gift_card_balance("GC-3001")
        .unwrap()
        .unwrap();
    assert_eq!(balance, 75000);
    assert_eq!(currency, "IDR");
    assert_eq!(status, "active");
}

#[test]
fn redeem_gift_card_deducts_balance() {
    let conn = fresh();
    seed_user(&conn, "staff-1");
    store(&conn)
        .issue_gift_card(IssueGiftCardInput {
            card_number: "GC-4001".into(),
            pin: None,
            initial_amount_minor: 50000,
            currency: "IDR".into(),
            issued_to: None,
            created_by: "staff-1".into(),
            expiry_date: None,
        })
        .unwrap();

    // Seed a sale for FK reference.
    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at, subtotal_minor, tax_total_minor)
         VALUES ('sale-1', 25000, 'IDR', 0, 'completed', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', 25000, 0)",
        [],
    ).unwrap();

    let result = store(&conn)
        .redeem_gift_card("GC-4001", 25000, "sale-1")
        .unwrap();
    assert_eq!(result.card.current_balance_minor, 25000);
    assert_eq!(result.transaction.amount_minor, -25000);
    assert_eq!(result.transaction.txn_type, "redeem");
}

#[test]
fn redeem_gift_card_is_idempotent() {
    let conn = fresh();
    seed_user(&conn, "staff-1");
    store(&conn)
        .issue_gift_card(IssueGiftCardInput {
            card_number: "GC-4002".into(),
            pin: None,
            initial_amount_minor: 50000,
            currency: "IDR".into(),
            issued_to: None,
            created_by: "staff-1".into(),
            expiry_date: None,
        })
        .unwrap();

    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at, subtotal_minor, tax_total_minor)
         VALUES ('sale-2', 10000, 'IDR', 0, 'completed', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', 10000, 0)",
        [],
    ).unwrap();

    let r1 = store(&conn)
        .redeem_gift_card("GC-4002", 10000, "sale-2")
        .unwrap();
    let r2 = store(&conn)
        .redeem_gift_card("GC-4002", 10000, "sale-2")
        .unwrap();
    assert_eq!(r1.card.current_balance_minor, r2.card.current_balance_minor);
    assert_eq!(r1.transaction.id, r2.transaction.id);
}

#[test]
fn redeem_insufficient_balance_fails() {
    let conn = fresh();
    seed_user(&conn, "staff-1");
    store(&conn)
        .issue_gift_card(IssueGiftCardInput {
            card_number: "GC-5001".into(),
            pin: None,
            initial_amount_minor: 5000,
            currency: "IDR".into(),
            issued_to: None,
            created_by: "staff-1".into(),
            expiry_date: None,
        })
        .unwrap();

    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at, subtotal_minor, tax_total_minor)
         VALUES ('sale-3', 50000, 'IDR', 0, 'completed', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', 50000, 0)",
        [],
    ).unwrap();

    let err = store(&conn)
        .redeem_gift_card("GC-5001", 10000, "sale-3")
        .unwrap_err();
    assert!(matches!(
        err,
        CoreError::Validation {
            field: "current_balance_minor",
            ..
        }
    ));
}

// PA-01: redemption balance must be decremented atomically by the DB and
// the ledger row's `balance_after_minor` must reflect the true
// post-deduction value. Two redeems on different sales must both deduct —
// a stale pre-txn read must never overwrite the balance.
#[test]
fn redeem_atomic_decrement_keeps_ledger_in_sync() {
    let conn = fresh();
    seed_user(&conn, "staff-1");
    store(&conn)
        .issue_gift_card(IssueGiftCardInput {
            card_number: "GC-5002".into(),
            pin: None,
            initial_amount_minor: 30000,
            currency: "IDR".into(),
            issued_to: None,
            created_by: "staff-1".into(),
            expiry_date: None,
        })
        .unwrap();

    for (sale_id, amount, expected_after) in
        [("sale-a1", 10000, 20000i64), ("sale-a2", 15000, 5000i64)]
    {
        conn.execute(
            "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at, subtotal_minor, tax_total_minor)
             VALUES (?1, 30000, 'IDR', 0, 'completed', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', 30000, 0)",
            [sale_id],
        )
        .unwrap();
        let r = store(&conn)
            .redeem_gift_card("GC-5002", amount, sale_id)
            .unwrap();
        assert_eq!(
            r.card.current_balance_minor, expected_after,
            "card balance after {sale_id}"
        );
        assert_eq!(
            r.transaction.balance_after_minor, expected_after,
            "ledger balance_after must equal card balance after {sale_id}"
        );
    }

    // Both deductions applied — a lost update would leave 15000 (only one
    // deduction) instead of 5000.
    let balance = store(&conn)
        .get_gift_card_balance("GC-5002")
        .unwrap()
        .unwrap()
        .0;
    assert_eq!(balance, 5000, "both redemptions must have been applied");
}

#[test]
fn top_up_increases_balance() {
    let conn = fresh();
    seed_user(&conn, "staff-1");
    store(&conn)
        .issue_gift_card(IssueGiftCardInput {
            card_number: "GC-6001".into(),
            pin: None,
            initial_amount_minor: 10000,
            currency: "IDR".into(),
            issued_to: None,
            created_by: "staff-1".into(),
            expiry_date: None,
        })
        .unwrap();

    // SQLite's `gift_card_transactions.created_at` is stored at
    // millisecond precision (RFC-3339 ms via `chrono::SecondsFormat::Millis`).
    // When `issue` and `topup` land in the same millisecond, the
    // `ORDER BY created_at DESC` in `get_transactions_for_card` has
    // no deterministic tie-breaker — SQLite picks an arbitrary order
    // for tied rows, which makes the `transactions[0].txn_type ==
    // "topup"` assertion below flake. Sleeping 5ms guarantees a
    // distinct timestamp; the duration matches the existing pattern
    // in `crate::tests::shift_integration`.
    std::thread::sleep(std::time::Duration::from_millis(5));

    let result = store(&conn).top_up_gift_card("GC-6001", 20000).unwrap();
    assert_eq!(result.card.current_balance_minor, 30000);
    assert_eq!(result.transactions[0].txn_type, "topup");
}

#[test]
fn freeze_and_unfreeze() {
    let conn = fresh();
    seed_user(&conn, "staff-1");
    store(&conn)
        .issue_gift_card(IssueGiftCardInput {
            card_number: "GC-7001".into(),
            pin: None,
            initial_amount_minor: 50000,
            currency: "IDR".into(),
            issued_to: None,
            created_by: "staff-1".into(),
            expiry_date: None,
        })
        .unwrap();

    let frozen = store(&conn).freeze_gift_card("GC-7001").unwrap();
    assert_eq!(frozen.status, "frozen");

    let unfrozen = store(&conn).unfreeze_gift_card("GC-7001").unwrap();
    assert_eq!(unfrozen.status, "active");
}

#[test]
fn list_gift_cards_with_filters() {
    let conn = fresh();
    seed_user(&conn, "staff-1");
    store(&conn)
        .issue_gift_card(IssueGiftCardInput {
            card_number: "GC-L1".into(),
            pin: None,
            initial_amount_minor: 10000,
            currency: "IDR".into(),
            issued_to: Some("Alice".into()),
            created_by: "staff-1".into(),
            expiry_date: None,
        })
        .unwrap();
    store(&conn)
        .issue_gift_card(IssueGiftCardInput {
            card_number: "GC-L2".into(),
            pin: None,
            initial_amount_minor: 20000,
            currency: "IDR".into(),
            issued_to: Some("Bob".into()),
            created_by: "staff-1".into(),
            expiry_date: None,
        })
        .unwrap();

    let results = store(&conn)
        .list_gift_cards(GiftCardFilter {
            search: Some("Alice".into()),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].card.card_number, "GC-L1");

    let all = store(&conn)
        .list_gift_cards(GiftCardFilter::default())
        .unwrap();
    assert_eq!(all.len(), 2);
}

#[test]
fn redeem_on_frozen_card_fails() {
    let conn = fresh();
    seed_user(&conn, "staff-1");
    store(&conn)
        .issue_gift_card(IssueGiftCardInput {
            card_number: "GC-8001".into(),
            pin: None,
            initial_amount_minor: 50000,
            currency: "IDR".into(),
            issued_to: None,
            created_by: "staff-1".into(),
            expiry_date: None,
        })
        .unwrap();
    store(&conn).freeze_gift_card("GC-8001").unwrap();

    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at, subtotal_minor, tax_total_minor)
         VALUES ('sale-8', 10000, 'IDR', 0, 'completed', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', 10000, 0)",
        [],
    ).unwrap();

    let err = store(&conn)
        .redeem_gift_card("GC-8001", 10000, "sale-8")
        .unwrap_err();
    assert!(matches!(
        err,
        CoreError::Validation {
            field: "status",
            ..
        }
    ));
}

// ── Additional edge cases ─────────────────────────────────────

#[test]
fn issue_gift_card_with_empty_card_number_fails() {
    let conn = fresh();
    seed_user(&conn, "staff-1");
    let err = store(&conn)
        .issue_gift_card(IssueGiftCardInput {
            card_number: "  ".into(),
            pin: None,
            initial_amount_minor: 10000,
            currency: "IDR".into(),
            issued_to: None,
            created_by: "staff-1".into(),
            expiry_date: None,
        })
        .unwrap_err();
    assert!(matches!(
        err,
        CoreError::Validation {
            field: "card_number",
            ..
        }
    ));
}

#[test]
fn redeem_gift_card_zero_amount_fails() {
    let conn = fresh();
    seed_user(&conn, "staff-1");
    store(&conn)
        .issue_gift_card(IssueGiftCardInput {
            card_number: "GC-9001".into(),
            pin: None,
            initial_amount_minor: 50000,
            currency: "IDR".into(),
            issued_to: None,
            created_by: "staff-1".into(),
            expiry_date: None,
        })
        .unwrap();

    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at, subtotal_minor, tax_total_minor)
         VALUES ('sale-9', 0, 'IDR', 0, 'completed', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', 0, 0)",
        [],
    ).unwrap();

    let err = store(&conn)
        .redeem_gift_card("GC-9001", 0, "sale-9")
        .unwrap_err();
    assert!(matches!(
        err,
        CoreError::Validation {
            field: "amount_minor",
            ..
        }
    ));
}

#[test]
fn top_up_nonexistent_card_fails() {
    let conn = fresh();
    let err = store(&conn)
        .top_up_gift_card("NONEXISTENT", 10000)
        .unwrap_err();
    assert!(matches!(
        err,
        CoreError::NotFound {
            entity: "gift_card",
            ..
        }
    ));
}

#[test]
fn freeze_nonexistent_card_fails() {
    let conn = fresh();
    let err = store(&conn).freeze_gift_card("NO-SUCH-CARD").unwrap_err();
    assert!(matches!(
        err,
        CoreError::NotFound {
            entity: "gift_card",
            ..
        }
    ));
}

#[test]
fn unfreeze_card_not_frozen_fails() {
    let conn = fresh();
    seed_user(&conn, "staff-1");
    store(&conn)
        .issue_gift_card(IssueGiftCardInput {
            card_number: "GC-10001".into(),
            pin: None,
            initial_amount_minor: 10000,
            currency: "IDR".into(),
            issued_to: None,
            created_by: "staff-1".into(),
            expiry_date: None,
        })
        .unwrap();
    let err = store(&conn).unfreeze_gift_card("GC-10001").unwrap_err();
    assert!(matches!(
        err,
        CoreError::Validation {
            field: "status",
            ..
        }
    ));
}

#[test]
fn redeem_exhausts_balance_auto_redeemed() {
    let conn = fresh();
    seed_user(&conn, "staff-1");
    store(&conn)
        .issue_gift_card(IssueGiftCardInput {
            card_number: "GC-11001".into(),
            pin: None,
            initial_amount_minor: 5000,
            currency: "IDR".into(),
            issued_to: None,
            created_by: "staff-1".into(),
            expiry_date: None,
        })
        .unwrap();

    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at, subtotal_minor, tax_total_minor)
         VALUES ('sale-11', 5000, 'IDR', 0, 'completed', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', 5000, 0)",
        [],
    ).unwrap();

    let result = store(&conn)
        .redeem_gift_card("GC-11001", 5000, "sale-11")
        .unwrap();
    assert_eq!(result.card.current_balance_minor, 0);
    assert_eq!(result.card.status, "redeemed");
}

#[test]
fn notes_format_major_units_via_card_currency() {
    let conn = fresh();
    seed_user(&conn, "staff-1");
    // USD (exp 2): raw minor units must render as a decimal, not a raw int.
    store(&conn)
        .issue_gift_card(IssueGiftCardInput {
            card_number: "GC-12001".into(),
            pin: None,
            initial_amount_minor: 50000,
            currency: "USD".into(),
            issued_to: None,
            created_by: "staff-1".into(),
            expiry_date: None,
        })
        .unwrap();

    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at, subtotal_minor, tax_total_minor)
         VALUES ('sale-12', 25000, 'USD', 0, 'completed', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', 25000, 0)",
        [],
    ).unwrap();

    let result = store(&conn)
        .redeem_gift_card("GC-12001", 25000, "sale-12")
        .unwrap();
    assert_eq!(result.transaction.notes, "Redeemed 250.00 on sale sale-12");

    // The DB-stored row (written inside the transaction) formats the same way.
    let detail = store(&conn)
        .get_gift_card_detail("GC-12001")
        .unwrap()
        .unwrap();
    let redeem = detail
        .transactions
        .iter()
        .find(|t| t.txn_type == "redeem")
        .unwrap();
    assert_eq!(redeem.notes, "Redeemed 250.00 on sale sale-12");

    let topped = store(&conn).top_up_gift_card("GC-12001", 10000).unwrap();
    let topup = topped
        .transactions
        .iter()
        .find(|t| t.txn_type == "topup")
        .unwrap();
    assert_eq!(topup.notes, "Top-up of 100.00 on card GC-12001");
}

#[test]
fn notes_keep_raw_minor_for_idr() {
    let conn = fresh();
    seed_user(&conn, "staff-1");
    // IDR (exp 0): the minor unit IS the Rupiah, so the note stays raw.
    store(&conn)
        .issue_gift_card(IssueGiftCardInput {
            card_number: "GC-12002".into(),
            pin: None,
            initial_amount_minor: 50000,
            currency: "IDR".into(),
            issued_to: None,
            created_by: "staff-1".into(),
            expiry_date: None,
        })
        .unwrap();

    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at, subtotal_minor, tax_total_minor)
         VALUES ('sale-13', 25000, 'IDR', 0, 'completed', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', 25000, 0)",
        [],
    ).unwrap();

    let result = store(&conn)
        .redeem_gift_card("GC-12002", 25000, "sale-13")
        .unwrap();
    assert_eq!(result.transaction.notes, "Redeemed 25000 on sale sale-13");
}

#[test]
fn notes_render_kwd_three_decimals() {
    let conn = fresh();
    seed_user(&conn, "staff-1");
    // KWD (exp 3): 12 fils → 0.012 — the case a naive /100 would get wrong.
    store(&conn)
        .issue_gift_card(IssueGiftCardInput {
            card_number: "GC-12003".into(),
            pin: None,
            initial_amount_minor: 500,
            currency: "KWD".into(),
            issued_to: None,
            created_by: "staff-1".into(),
            expiry_date: None,
        })
        .unwrap();

    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at, subtotal_minor, tax_total_minor)
         VALUES ('sale-14', 12, 'KWD', 0, 'completed', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', 12, 0)",
        [],
    ).unwrap();

    let result = store(&conn)
        .redeem_gift_card("GC-12003", 12, "sale-14")
        .unwrap();
    assert_eq!(result.transaction.notes, "Redeemed 0.012 on sale sale-14");
}
