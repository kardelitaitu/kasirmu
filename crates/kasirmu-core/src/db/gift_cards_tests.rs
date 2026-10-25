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

// ── C18 (slice P1.4): freeze/unfreeze are compare-and-sets ──────────────

/// A migrated on-disk database in `dir` — the shape a forced-interleaving
/// race test needs, since a second connection cannot be opened on the
/// `:memory:` database `fresh()` returns.
fn fresh_file(dir: &std::path::Path) -> Connection {
    std::fs::create_dir_all(dir).unwrap();
    let path = dir.join("kasir.db");
    let mut file_conn = Connection::open(&path).unwrap();
    {
        let template = migrations::fresh_db();
        let backup = rusqlite::backup::Backup::new(&template, &mut file_conn).unwrap();
        backup
            .run_to_completion(10, std::time::Duration::from_millis(0), None)
            .unwrap();
    }
    file_conn
        .pragma_update(None, "journal_mode", "WAL")
        .unwrap();
    file_conn
        .pragma_update(None, "busy_timeout", "5000")
        .unwrap();
    file_conn
}

fn seed_card(conn: &Connection, card_number: &str) {
    seed_user(conn, "staff-1");
    store(conn)
        .issue_gift_card(IssueGiftCardInput {
            card_number: card_number.into(),
            initial_amount_minor: 50000,
            currency: "IDR".into(),
            issued_to: None,
            created_by: "staff-1".into(),
            expiry_date: None,
        })
        .unwrap();
}

fn status_and_updated_at(conn: &Connection, card_number: &str) -> (String, String) {
    conn.query_row(
        "SELECT status, updated_at FROM gift_cards WHERE card_number = ?1",
        params![card_number],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .unwrap()
}

/// The pre-check already refuses a card that is not `active`; this pins the
/// OUTCOME (refused, row untouched) rather than only the error variant, so a
/// future rewrite of the guard cannot regress it into a silent write.
#[test]
fn freeze_gift_card_refuses_an_already_frozen_card() {
    let conn = fresh();
    seed_card(&conn, "GC-C18-01");
    let frozen = store(&conn).freeze_gift_card("GC-C18-01").unwrap();
    assert_eq!(frozen.status, "frozen");
    let before = status_and_updated_at(&conn, "GC-C18-01");

    let err = store(&conn)
        .freeze_gift_card("GC-C18-01")
        .expect_err("freezing an already-frozen card must be refused");
    assert!(
        matches!(
            err,
            CoreError::Validation {
                field: "status",
                ..
            }
        ),
        "expected a status Validation, got: {err}"
    );
    assert_eq!(
        status_and_updated_at(&conn, "GC-C18-01"),
        before,
        "a refused freeze must leave the row exactly as it was"
    );
}

#[test]
fn unfreeze_gift_card_refuses_an_active_card() {
    let conn = fresh();
    seed_card(&conn, "GC-C18-02");
    let before = status_and_updated_at(&conn, "GC-C18-02");
    assert_eq!(before.0, "active");

    let err = store(&conn)
        .unfreeze_gift_card("GC-C18-02")
        .expect_err("unfreezing an active card must be refused");
    assert!(
        matches!(
            err,
            CoreError::Validation {
                field: "status",
                ..
            }
        ),
        "expected a status Validation, got: {err}"
    );
    assert_eq!(
        status_and_updated_at(&conn, "GC-C18-02"),
        before,
        "a refused unfreeze must leave the row exactly as it was"
    );
}

/// C18 (slice P1.4): the freeze is a compare-and-set, forced rather than
/// hoped for.
///
/// Connection B stages a rival write that moves the card off `active` — an
/// uncommitted `gift_cards` update held under a write lock until B's own
/// timer releases it. A (the freeze, run on the main thread the instant B
/// announces its lock) reads the card while B's write is still invisible, so
/// it starts from `active`; A's write lands only after B commits.
///
/// Without the status predicate, A's unconditional `UPDATE ... WHERE id = ?`
/// overwrites B's `redeemed` with `frozen` and reports success — a lost
/// update on the column that gates redemption of a stored-value row. With the
/// predicate, A's UPDATE matches zero rows, the freeze is refused, and B's
/// status and timestamp survive exactly as B wrote them.
#[test]
fn freeze_gift_card_race_cannot_overwrite_a_competing_transition() {
    // The guard owns the directory and deletes it on drop, so the fixture
    // cannot be left behind by a failed assertion.
    let scratch = kasirmu_test_support::ScratchDir::new("gift-card-freeze-race");
    let dir = scratch.path();
    let db_path = dir.join("kasir.db");
    {
        let conn = fresh_file(dir);
        seed_card(&conn, "GC-C18-R1");
    }

    // B holds the write lock until A's busy handler reports it is BLOCKED on
    // it — no timer (O-T15).
    //
    // The 300 ms sleep this replaces was a bet on wall-clock behaviour: on a
    // stalled host A's read could land after B's commit (which is why this test
    // had no restage loop and simply failed), and the sleep was paid in full
    // whether or not the window had been used. The property is unchanged and
    // still the whole point: A must READ `active` while B's uncommitted
    // `redeemed` is invisible, then lose its compare-and-set once B commits.
    //
    // A cannot signal mid-call, so A's busy handler signals for it: it runs on
    // A's own thread, inside `freeze_gift_card`, after the status read and
    // before the UPDATE. That is the proof A is inside the window, and it
    // replaces the sleep with a fact. The wait is bounded (5 s) so a bug that
    // makes A never block FAILS here rather than hanging.
    static A_IS_WAITING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    A_IS_WAITING.store(false, std::sync::atomic::Ordering::SeqCst);
    // Reported through a `static` mailbox because rusqlite's `busy_handler`
    // takes a function POINTER: a capturing closure cannot be passed.
    static A_WAITING_TX: std::sync::Mutex<Option<std::sync::mpsc::Sender<()>>> =
        std::sync::Mutex::new(None);
    fn note_a_is_waiting(_attempts: i32) -> bool {
        if !A_IS_WAITING.swap(true, std::sync::atomic::Ordering::SeqCst)
            && let Some(tx) = A_WAITING_TX.lock().unwrap().as_ref()
        {
            let _ = tx.send(());
        }
        true
    }

    let (locked_tx, locked_rx) = std::sync::mpsc::channel();
    let (a_waiting_tx, a_waiting_rx) = std::sync::mpsc::channel();
    let rival = {
        let db_path = db_path.clone();
        std::thread::spawn(move || {
            let conn_b = Connection::open(&db_path).unwrap();
            conn_b.pragma_update(None, "busy_timeout", "5000").unwrap();
            let tx = conn_b.unchecked_transaction().unwrap();
            let rows = tx
                .execute(
                    "UPDATE gift_cards SET status='redeemed', updated_at=?1 WHERE card_number=?2",
                    params!["2020-01-01T00:00:00.000Z", "GC-C18-R1"],
                )
                .unwrap();
            assert_eq!(rows, 1, "the rival transition must touch the staged card");
            locked_tx.send(()).unwrap();
            // Commit either when A is demonstrably waiting on the lock, or (the
            // timeout arm) when A has already finished — in which case its
            // outcome is classified below instead of the test hanging.
            let _ = a_waiting_rx.recv_timeout(std::time::Duration::from_secs(5));
            tx.commit().unwrap();
        })
    };
    locked_rx.recv().unwrap();

    let conn_a = Connection::open(&db_path).unwrap();
    conn_a.pragma_update(None, "busy_timeout", "5000").unwrap();
    A_WAITING_TX.lock().unwrap().replace(a_waiting_tx);
    conn_a.busy_handler(Some(note_a_is_waiting)).unwrap();
    let outcome = store(&conn_a).freeze_gift_card("GC-C18-R1");
    rival.join().unwrap();

    assert!(
        A_IS_WAITING.load(std::sync::atomic::Ordering::SeqCst),
        "the losing freeze must have BLOCKED on B's write lock first; \
         it never entered the race window"
    );
    let err = outcome.expect_err("a freeze that lost the race must be refused");
    assert!(
        matches!(
            err,
            CoreError::Validation {
                field: "status",
                ..
            }
        ),
        "expected a status Validation for the losing freeze, got: {err}"
    );

    let (status, updated_at) = status_and_updated_at(&conn_a, "GC-C18-R1");
    assert_eq!(status, "redeemed", "the winner's status must survive");
    assert_eq!(
        updated_at, "2020-01-01T00:00:00.000Z",
        "the refused freeze must leave the row untouched"
    );

    drop(conn_a);
}

/// C18 (slice P1.4): the same compare-and-set in the other direction.
///
/// B stages an unfreeze-by-another-terminal (`frozen` -> `active`, sentinel
/// timestamp) under its write lock. A reads `frozen` while that write is
/// invisible, then writes after B commits. Without the predicate A's
/// unconditional update reports success and clobbers B's `updated_at`; with
/// it A's UPDATE matches zero rows and the unfreeze is refused.
#[test]
fn unfreeze_gift_card_race_cannot_overwrite_a_competing_transition() {
    // The guard owns the directory and deletes it on drop, so the fixture
    // cannot be left behind by a failed assertion.
    let scratch = kasirmu_test_support::ScratchDir::new("gift-card-unfreeze-race");
    let dir = scratch.path();
    let db_path = dir.join("kasir.db");
    {
        let conn = fresh_file(dir);
        seed_card(&conn, "GC-C18-R2");
        store(&conn).freeze_gift_card("GC-C18-R2").unwrap();
    }

    // Same channel-driven release as the freeze test above (O-T15): B holds the
    // write lock until A's busy handler reports A is BLOCKED on it. The
    // property is unchanged: A reads `frozen`, B's uncommitted `active` is
    // invisible to it, and A's compare-and-set fails once B commits.
    static A_IS_WAITING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    A_IS_WAITING.store(false, std::sync::atomic::Ordering::SeqCst);
    // Reported through a `static` mailbox because rusqlite's `busy_handler`
    // takes a function POINTER: a capturing closure cannot be passed.
    static A_WAITING_TX: std::sync::Mutex<Option<std::sync::mpsc::Sender<()>>> =
        std::sync::Mutex::new(None);
    fn note_a_is_waiting(_attempts: i32) -> bool {
        if !A_IS_WAITING.swap(true, std::sync::atomic::Ordering::SeqCst)
            && let Some(tx) = A_WAITING_TX.lock().unwrap().as_ref()
        {
            let _ = tx.send(());
        }
        true
    }

    let (locked_tx, locked_rx) = std::sync::mpsc::channel();
    let (a_waiting_tx, a_waiting_rx) = std::sync::mpsc::channel();
    let rival = {
        let db_path = db_path.clone();
        std::thread::spawn(move || {
            let conn_b = Connection::open(&db_path).unwrap();
            conn_b.pragma_update(None, "busy_timeout", "5000").unwrap();
            let tx = conn_b.unchecked_transaction().unwrap();
            let rows = tx
                .execute(
                    "UPDATE gift_cards SET status='active', updated_at=?1 WHERE card_number=?2",
                    params!["2020-01-01T00:00:00.000Z", "GC-C18-R2"],
                )
                .unwrap();
            assert_eq!(rows, 1, "the rival transition must touch the staged card");
            locked_tx.send(()).unwrap();
            let _ = a_waiting_rx.recv_timeout(std::time::Duration::from_secs(5));
            tx.commit().unwrap();
        })
    };
    locked_rx.recv().unwrap();

    let conn_a = Connection::open(&db_path).unwrap();
    conn_a.pragma_update(None, "busy_timeout", "5000").unwrap();
    A_WAITING_TX.lock().unwrap().replace(a_waiting_tx);
    conn_a.busy_handler(Some(note_a_is_waiting)).unwrap();
    let outcome = store(&conn_a).unfreeze_gift_card("GC-C18-R2");
    rival.join().unwrap();

    assert!(
        A_IS_WAITING.load(std::sync::atomic::Ordering::SeqCst),
        "the losing unfreeze must have BLOCKED on B's write lock first; \
         it never entered the race window"
    );
    let err = outcome.expect_err("an unfreeze that lost the race must be refused");
    assert!(
        matches!(
            err,
            CoreError::Validation {
                field: "status",
                ..
            }
        ),
        "expected a status Validation for the losing unfreeze, got: {err}"
    );

    let (status, updated_at) = status_and_updated_at(&conn_a, "GC-C18-R2");
    assert_eq!(status, "active", "the winner's status must survive");
    assert_eq!(
        updated_at, "2020-01-01T00:00:00.000Z",
        "the refused unfreeze must leave the row untouched"
    );

    drop(conn_a);
}

/// The idempotency read must tell "no prior redemption" apart from a read that
/// FAILED. `redeem_gift_card` used `if let Ok(txn) = existing`, so an
/// undecodable prior row was read as "no prior redemption" and the function
/// redeemed a SECOND time — a fail-open on the money path. Every loyalty
/// idempotency lookup (`db/loyalty.rs` `fetch_earn_txn` and its siblings)
/// matches `QueryReturnedNoRows` and propagates every other error; this was
/// the one that disagreed.
///
/// The partial unique index `uq_gift_card_redeem_sale` (migration
/// 20260901) normally catches the second INSERT and rolls the transaction
/// back — which is why the defect is invisible today. This test drops that
/// index so the APPLICATION-layer guard is the only thing standing: with the
/// guard broken, the card is debited twice and a second ledger row is
/// written. It pins that the application guard, not the index added later,
/// is what makes a redemption replay safe.
#[test]
fn redeem_refuses_when_the_idempotency_read_errors_instead_of_double_redeeming() {
    let conn = fresh();
    seed_user(&conn, "staff-1");
    store(&conn)
        .issue_gift_card(IssueGiftCardInput {
            card_number: "GC-ERR-1".into(),
            initial_amount_minor: 50000,
            currency: "IDR".into(),
            issued_to: None,
            created_by: "staff-1".into(),
            expiry_date: None,
        })
        .unwrap();

    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at, subtotal_minor, tax_total_minor)
         VALUES ('sale-err-1', 10000, 'IDR', 0, 'completed', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', 10000, 0)",
        [],
    )
    .unwrap();

    // A prior redemption exists for this card and sale, but its `amount_minor`
    // cannot decode as an integer, so the idempotency mapper errors.
    let card_id: String = conn
        .query_row(
            "SELECT id FROM gift_cards WHERE card_number = 'GC-ERR-1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    conn.execute(
        "INSERT INTO gift_card_transactions
             (id, gift_card_id, sale_id, txn_type, amount_minor, balance_after_minor, created_at)
         VALUES ('red-corrupt', ?1, 'sale-err-1', 'redeem', x'deadbeef', 40000, '2025-01-01T00:00:00.000Z')",
        params![card_id],
    )
    .unwrap();

    // Remove the DB-level backstop so the application guard is the only
    // protection against a second debit.
    conn.execute_batch("DROP INDEX IF EXISTS uq_gift_card_redeem_sale;")
        .unwrap();

    // RED: the failed read was taken for "no prior redemption", so the redemption ran a second
    // time. GREEN: the read failure propagates — the `if let` leaves the block untouched on
    // `Err`, which is the whole assertion.
    if let Ok(r) = store(&conn).redeem_gift_card("GC-ERR-1", 10000, "sale-err-1") {
        panic!(
            "unreadable idempotency row was read as absence and re-redeemed: {}",
            r.transaction.id
        );
    }

    let balance: i64 = conn
        .query_row(
            "SELECT current_balance_minor FROM gift_cards WHERE card_number = 'GC-ERR-1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        balance, 50000,
        "a failed idempotency read must not debit the card"
    );

    let redeems: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM gift_card_transactions
             WHERE sale_id = 'sale-err-1' AND txn_type = 'redeem'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(redeems, 1, "no second redemption row may be written");
}

/// The documented absence path survives the fix: a genuinely absent prior
/// redemption is not an error, so the first redemption still succeeds and
/// debits exactly once.
#[test]
fn redeem_still_proceeds_when_no_prior_redemption_exists() {
    let conn = fresh();
    seed_user(&conn, "staff-1");
    store(&conn)
        .issue_gift_card(IssueGiftCardInput {
            card_number: "GC-OK-1".into(),
            initial_amount_minor: 50000,
            currency: "IDR".into(),
            issued_to: None,
            created_by: "staff-1".into(),
            expiry_date: None,
        })
        .unwrap();

    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at, subtotal_minor, tax_total_minor)
         VALUES ('sale-ok-1', 10000, 'IDR', 0, 'completed', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', 10000, 0)",
        [],
    )
    .unwrap();

    let result = store(&conn)
        .redeem_gift_card("GC-OK-1", 10000, "sale-ok-1")
        .expect("a genuinely absent prior redemption must not be an error");
    assert_eq!(result.card.current_balance_minor, 40000);
    assert_eq!(result.transaction.txn_type, "redeem");
}

/// The redeem path's PA-01 guard, proven by a FORCED race that can fail.
///
/// Why this test exists. `redeem_atomic_decrement_keeps_ledger_in_sync` reads as
/// proof of the atomic guard, but both of its redeems run sequentially on ONE
/// connection with no rival writer — so it passes on the pre-PA-01 code too.
/// Measured 2026-10-26 (round 244) by deleting the `AND current_balance_minor >= ?1`
/// predicate from `gift_cards.rs` and re-running it: **it still passed**, 1 passed,
/// 0 failed. A guard with no test that reddens when it is removed is a comment.
///
/// The shape is copied from `freeze_gift_card_race_cannot_overwrite_a_competing_transition`:
/// B stages a competing deduction under its write lock, A reads the pre-deduction
/// balance while that write is invisible, then writes after B commits. With the
/// predicate A's UPDATE matches zero rows and the redemption is refused; without
/// it A double-spends the same balance and reports success.
#[test]
fn redeem_gift_card_race_cannot_double_spend_the_same_balance() {
    let scratch = kasirmu_test_support::ScratchDir::new("gift-card-redeem-race");
    let dir = scratch.path();
    let db_path = dir.join("kasir.db");
    {
        let conn = fresh_file(dir);
        seed_card(&conn, "GC-RD-R1");
        for sale in ["sale-rd-a", "sale-rd-b"] {
            conn.execute(
                "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at, subtotal_minor, tax_total_minor)
                 VALUES (?1, 30000, 'IDR', 0, 'completed', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', 30000, 0)",
                params![sale],
            )
            .unwrap();
        }
    }

    // B holds the write lock until A's busy handler reports it is BLOCKED on it
    // (O-T15, no timer). B deducts 30000 of the card's 50000, leaving 20000.
    static A_IS_WAITING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    A_IS_WAITING.store(false, std::sync::atomic::Ordering::SeqCst);
    static A_WAITING_TX: std::sync::Mutex<Option<std::sync::mpsc::Sender<()>>> =
        std::sync::Mutex::new(None);
    fn note_a_is_waiting(_attempts: i32) -> bool {
        if !A_IS_WAITING.swap(true, std::sync::atomic::Ordering::SeqCst)
            && let Some(tx) = A_WAITING_TX.lock().unwrap().as_ref()
        {
            let _ = tx.send(());
        }
        true
    }

    let (locked_tx, locked_rx) = std::sync::mpsc::channel();
    let (a_waiting_tx, a_waiting_rx) = std::sync::mpsc::channel();
    let rival = {
        let db_path = db_path.clone();
        std::thread::spawn(move || {
            let conn_b = Connection::open(&db_path).unwrap();
            conn_b.pragma_update(None, "busy_timeout", "5000").unwrap();
            let tx = conn_b.unchecked_transaction().unwrap();
            let rows = tx
                .execute(
                    "UPDATE gift_cards SET current_balance_minor = current_balance_minor - 30000
                     WHERE card_number = ?1",
                    params!["GC-RD-R1"],
                )
                .unwrap();
            assert_eq!(rows, 1, "the rival deduction must touch the staged card");
            locked_tx.send(()).unwrap();
            let _ = a_waiting_rx.recv_timeout(std::time::Duration::from_secs(5));
            tx.commit().unwrap();
        })
    };
    locked_rx.recv().unwrap();

    // A read 50000 before B committed, and asks for 30000 of it. B leaves 20000,
    // which is below A's request -- so the predicate must refuse A.
    let conn_a = Connection::open(&db_path).unwrap();
    conn_a.pragma_update(None, "busy_timeout", "5000").unwrap();
    A_WAITING_TX.lock().unwrap().replace(a_waiting_tx);
    conn_a.busy_handler(Some(note_a_is_waiting)).unwrap();
    let outcome = store(&conn_a).redeem_gift_card("GC-RD-R1", 30000, "sale-rd-a");
    rival.join().unwrap();

    assert!(
        A_IS_WAITING.load(std::sync::atomic::Ordering::SeqCst),
        "the losing redemption must have BLOCKED on B's write lock first; \
         it never entered the race window"
    );
    let err = outcome.expect_err(
        "a redemption that lost the race must be refused, not silently overdraw the card",
    );
    assert!(
        matches!(
            err,
            CoreError::Validation {
                field: "current_balance_minor",
                ..
            }
        ),
        "expected the balance Validation for the losing redemption, got: {err}"
    );

    // The money fact that matters: B's deduction is the ONLY one that landed.
    let balance = store(&conn_a)
        .get_gift_card_balance("GC-RD-R1")
        .unwrap()
        .unwrap()
        .0;
    assert_eq!(
        balance, 20000,
        "only the rival's deduction may be applied; a double-spend leaves the card short"
    );

    // And no ledger row was written for the refused redemption.
    let rows: i64 = conn_a
        .query_row(
            "SELECT COUNT(*) FROM gift_card_transactions WHERE sale_id = 'sale-rd-a'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(rows, 0, "a refused redemption must not write a ledger row");

    drop(conn_a);
}
