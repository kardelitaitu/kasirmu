use super::*;
use crate::Currency;
use rusqlite::Connection;

fn fresh() -> Connection {
    crate::migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn insert_sale(conn: &Connection, id: &str, total_minor: i64, now: &str) {
    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, status,
                            payment_method, tendered_minor,
                            discount_percent, discount_label, user_id,
                            created_at, updated_at,
                            subtotal_minor, tax_total_minor)
         VALUES (?1, ?2, 'USD', 1, 'completed', 'split', ?2,
                 0, NULL, 'user-1',
                 ?3, ?3,
                 ?2, 0)",
        params![id, total_minor, now],
    )
    .unwrap();
}

#[test]
fn create_and_list_payments() {
    let conn = fresh();
    let store = store(&conn);

    let sale_id = uuid::Uuid::now_v7().to_string();
    let now = "2025-06-01T12:00:00Z";
    insert_sale(&conn, &sale_id, 1000, now);

    let splits = vec![
        PaymentSplitArg {
            method: "cash".into(),
            amount_minor: 600,
            gateway_reference: None,
            gateway_status: None,
            gateway_response: None,
            idempotency_key: None,
        },
        PaymentSplitArg {
            method: "card".into(),
            amount_minor: 400,
            gateway_reference: None,
            gateway_status: None,
            gateway_response: None,
            idempotency_key: None,
        },
    ];

    let currency: Currency = "USD".parse().unwrap();
    let payments = store
        .create_payments(&sale_id, &splits, &currency, now)
        .unwrap();
    assert_eq!(payments.len(), 2);
    assert_eq!(payments[0].method, "cash");
    assert_eq!(payments[0].amount.minor_units, 600);
    assert_eq!(payments[1].method, "card");
    assert_eq!(payments[1].amount.minor_units, 400);

    let listed = store.list_payments_for_sale(&sale_id).unwrap();
    assert_eq!(listed.len(), 2);
}

#[test]
fn create_payment_with_gateway_ref() {
    let conn = fresh();
    let store = store(&conn);

    let sale_id = uuid::Uuid::now_v7().to_string();
    let now = "2025-06-01T12:00:00Z";
    insert_sale(&conn, &sale_id, 500, now);

    let splits = vec![PaymentSplitArg {
        method: "card".into(),
        amount_minor: 500,
        gateway_reference: Some("txn_abc123".into()),
        gateway_status: Some("approved".into()),
        gateway_response: Some(r#"{"id":"txn_abc123","status":"approved"}"#.into()),
        idempotency_key: None,
    }];

    let currency: Currency = "USD".parse().unwrap();
    let payments = store
        .create_payments(&sale_id, &splits, &currency, now)
        .unwrap();
    assert_eq!(payments.len(), 1);
    assert_eq!(payments[0].gateway_reference.as_deref(), Some("txn_abc123"));
    assert_eq!(payments[0].gateway_status.as_deref(), Some("approved"));

    let listed = store.list_payments_for_sale(&sale_id).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].gateway_reference.as_deref(), Some("txn_abc123"));
    assert_eq!(listed[0].gateway_status.as_deref(), Some("approved"));
    assert_eq!(
        listed[0].gateway_response.as_deref(),
        Some(r#"{"id":"txn_abc123","status":"approved"}"#)
    );
}

#[test]
fn empty_splits_produces_no_payments() {
    let conn = fresh();
    let store = store(&conn);

    let sale_id = uuid::Uuid::now_v7().to_string();
    let now = "2025-06-01T12:00:00Z";
    insert_sale(&conn, &sale_id, 0, now);

    let currency: Currency = "USD".parse().unwrap();
    let payments = store
        .create_payments(&sale_id, &[], &currency, now)
        .unwrap();
    assert!(payments.is_empty());
}

#[test]
fn list_payments_for_nonexistent_sale() {
    let conn = fresh();
    let store = store(&conn);
    let payments = store.list_payments_for_sale("nonexistent").unwrap();
    assert!(payments.is_empty());
}

#[test]
fn create_single_payment() {
    let conn = fresh();
    let store = store(&conn);

    let sale_id = uuid::Uuid::now_v7().to_string();
    let now = "2025-06-01T12:00:00Z";
    insert_sale(&conn, &sale_id, 1000, now);

    let splits = vec![PaymentSplitArg {
        method: "cash".into(),
        amount_minor: 1000,
        gateway_reference: None,
        gateway_status: None,
        gateway_response: None,
        idempotency_key: None,
    }];

    let currency: Currency = "USD".parse().unwrap();
    let payments = store
        .create_payments(&sale_id, &splits, &currency, now)
        .unwrap();
    assert_eq!(payments.len(), 1);
    assert_eq!(payments[0].method, "cash");
    assert_eq!(payments[0].amount.minor_units, 1000);
    assert_eq!(payments[0].amount.currency, currency);
    assert!(!payments[0].id.is_empty());
    assert!(!payments[0].created_at.is_empty());
}

#[test]
fn create_payment_zero_amount() {
    let conn = fresh();
    let store = store(&conn);

    let sale_id = uuid::Uuid::now_v7().to_string();
    let now = "2025-06-01T12:00:00Z";
    insert_sale(&conn, &sale_id, 0, now);

    let splits = vec![PaymentSplitArg {
        method: "voucher".into(),
        amount_minor: 0,
        gateway_reference: None,
        gateway_status: None,
        gateway_response: None,
        idempotency_key: None,
    }];

    let currency: Currency = "USD".parse().unwrap();
    let payments = store
        .create_payments(&sale_id, &splits, &currency, now)
        .unwrap();
    assert_eq!(payments.len(), 1);
    assert_eq!(payments[0].amount.minor_units, 0);
}

#[test]
fn create_payment_large_amount() {
    let conn = fresh();
    let store = store(&conn);

    let sale_id = uuid::Uuid::now_v7().to_string();
    let now = "2025-06-01T12:00:00Z";
    insert_sale(&conn, &sale_id, i64::MAX, now);

    let splits = vec![PaymentSplitArg {
        method: "card".into(),
        amount_minor: i64::MAX,
        gateway_reference: None,
        gateway_status: None,
        gateway_response: None,
        idempotency_key: None,
    }];

    let currency: Currency = "USD".parse().unwrap();
    let payments = store
        .create_payments(&sale_id, &splits, &currency, now)
        .unwrap();
    assert_eq!(payments.len(), 1);
    assert_eq!(payments[0].amount.minor_units, i64::MAX);
}

#[test]
fn create_payment_with_declined_gateway() {
    let conn = fresh();
    let store = store(&conn);

    let sale_id = uuid::Uuid::now_v7().to_string();
    let now = "2025-06-01T12:00:00Z";
    insert_sale(&conn, &sale_id, 5000, now);

    let splits = vec![PaymentSplitArg {
        method: "card".into(),
        amount_minor: 5000,
        gateway_reference: Some("txn_declined".into()),
        gateway_status: Some("declined".into()),
        gateway_response: Some(r#"{"error":"insufficient_funds"}"#.into()),
        idempotency_key: None,
    }];

    let currency: Currency = "USD".parse().unwrap();
    let payments = store
        .create_payments(&sale_id, &splits, &currency, now)
        .unwrap();
    assert_eq!(payments[0].gateway_status.as_deref(), Some("declined"));

    let listed = store.list_payments_for_sale(&sale_id).unwrap();
    assert_eq!(listed[0].gateway_status.as_deref(), Some("declined"));
}

#[test]
fn list_payments_filters_by_sale() {
    let conn = fresh();
    let store = store(&conn);
    let currency: Currency = "USD".parse().unwrap();
    let now = "2025-06-01T12:00:00Z";

    let sale_a = uuid::Uuid::now_v7().to_string();
    let sale_b = uuid::Uuid::now_v7().to_string();
    insert_sale(&conn, &sale_a, 500, now);
    insert_sale(&conn, &sale_b, 300, now);

    store
        .create_payments(
            &sale_a,
            &[PaymentSplitArg {
                method: "cash".into(),
                amount_minor: 500,
                gateway_reference: None,
                gateway_status: None,
                gateway_response: None,
                idempotency_key: None,
            }],
            &currency,
            now,
        )
        .unwrap();
    store
        .create_payments(
            &sale_b,
            &[PaymentSplitArg {
                method: "card".into(),
                amount_minor: 300,
                gateway_reference: None,
                gateway_status: None,
                gateway_response: None,
                idempotency_key: None,
            }],
            &currency,
            now,
        )
        .unwrap();

    let a_payments = store.list_payments_for_sale(&sale_a).unwrap();
    assert_eq!(a_payments.len(), 1);
    assert_eq!(a_payments[0].method, "cash");

    let b_payments = store.list_payments_for_sale(&sale_b).unwrap();
    assert_eq!(b_payments.len(), 1);
    assert_eq!(b_payments[0].method, "card");
}

#[test]
fn create_payments_preserves_currency() {
    let conn = fresh();
    let store = store(&conn);

    let sale_id = uuid::Uuid::now_v7().to_string();
    let now = "2025-06-01T12:00:00Z";
    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, status,
                            payment_method, tendered_minor,
                            discount_percent, discount_label, user_id,
                            created_at, updated_at,
                            subtotal_minor, tax_total_minor)
         VALUES (?1, ?2, 'IDR', 1, 'completed', 'cash', ?2,
                 0, NULL, 'user-1', ?3, ?3, ?2, 0)",
        params![sale_id, 50000_i64, now],
    )
    .unwrap();

    let currency: Currency = "IDR".parse().unwrap();
    let payments = store
        .create_payments(
            &sale_id,
            &[PaymentSplitArg {
                method: "cash".into(),
                amount_minor: 50000,
                gateway_reference: None,
                gateway_status: None,
                gateway_response: None,
                idempotency_key: None,
            }],
            &currency,
            now,
        )
        .unwrap();
    assert_eq!(payments[0].amount.currency, currency);
    assert_eq!(payments[0].amount.currency.to_string(), "IDR");

    let listed = store.list_payments_for_sale(&sale_id).unwrap();
    assert_eq!(listed[0].amount.currency.to_string(), "IDR");
}

// ── Orphaned-file edge cases (from payments_new_tests.rs) ─────

#[test]
fn create_payments_multiple_calls_same_sale() {
    let conn = fresh();
    let store = store(&conn);
    let currency: Currency = "USD".parse().unwrap();
    let now = "2025-06-01T12:00:00Z";

    let sale_id = uuid::Uuid::now_v7().to_string();
    insert_sale(&conn, &sale_id, 3000, now);

    // First batch: cash + card
    let batch1 = store
        .create_payments(
            &sale_id,
            &[
                PaymentSplitArg {
                    method: "cash".into(),
                    amount_minor: 1000,
                    gateway_reference: None,
                    gateway_status: None,
                    gateway_response: None,
                    idempotency_key: None,
                },
                PaymentSplitArg {
                    method: "card".into(),
                    amount_minor: 1000,
                    gateway_reference: Some("txn_b1".into()),
                    gateway_status: Some("approved".into()),
                    gateway_response: None,
                    idempotency_key: None,
                },
            ],
            &currency,
            now,
        )
        .unwrap();
    assert_eq!(batch1.len(), 2);

    // Second batch: voucher
    let batch2 = store
        .create_payments(
            &sale_id,
            &[PaymentSplitArg {
                method: "voucher".into(),
                amount_minor: 1000,
                gateway_reference: None,
                gateway_status: None,
                gateway_response: None,
                idempotency_key: None,
            }],
            &currency,
            now,
        )
        .unwrap();
    assert_eq!(batch2.len(), 1);

    // All 3 should appear in list
    let listed = store.list_payments_for_sale(&sale_id).unwrap();
    assert_eq!(listed.len(), 3);
    let total: i64 = listed.iter().map(|p| p.amount.minor_units).sum();
    assert_eq!(total, 3000);
}

#[test]
fn create_payment_negative_amount() {
    let conn = fresh();
    let store = store(&conn);
    let currency: Currency = "USD".parse().unwrap();
    let now = "2025-06-01T12:00:00Z";

    let sale_id = uuid::Uuid::now_v7().to_string();
    insert_sale(&conn, &sale_id, -500, now);

    let splits = vec![PaymentSplitArg {
        method: "cash".into(),
        amount_minor: -500,
        gateway_reference: None,
        gateway_status: None,
        gateway_response: None,
        idempotency_key: None,
    }];

    let payments = store
        .create_payments(&sale_id, &splits, &currency, now)
        .unwrap();
    assert_eq!(payments.len(), 1);
    assert_eq!(payments[0].amount.minor_units, -500);

    let listed = store.list_payments_for_sale(&sale_id).unwrap();
    assert_eq!(listed[0].amount.minor_units, -500);
}

#[test]
fn payment_very_long_gateway_reference() {
    let conn = fresh();
    let store = store(&conn);
    let currency: Currency = "USD".parse().unwrap();
    let now = "2025-06-01T12:00:00Z";

    let sale_id = uuid::Uuid::now_v7().to_string();
    insert_sale(&conn, &sale_id, 1000, now);

    // 500-char gateway reference
    let long_ref = "txn_".to_owned() + &"x".repeat(496);
    assert_eq!(long_ref.len(), 500);

    let splits = vec![PaymentSplitArg {
        method: "card".into(),
        amount_minor: 1000,
        gateway_reference: Some(long_ref.clone()),
        gateway_status: Some("approved".into()),
        gateway_response: None,
        idempotency_key: None,
    }];

    let payments = store
        .create_payments(&sale_id, &splits, &currency, now)
        .unwrap();
    assert_eq!(payments.len(), 1);
    assert_eq!(
        payments[0].gateway_reference.as_deref(),
        Some(long_ref.as_str())
    );

    let listed = store.list_payments_for_sale(&sale_id).unwrap();
    assert_eq!(listed[0].gateway_reference.as_deref().unwrap().len(), 500);
}

#[test]
fn payment_gateway_response_large_payload() {
    let conn = fresh();
    let store = store(&conn);
    let currency: Currency = "USD".parse().unwrap();
    let now = "2025-06-01T12:00:00Z";

    let sale_id = uuid::Uuid::now_v7().to_string();
    insert_sale(&conn, &sale_id, 999, now);

    // Large JSON payload (10 KB)
    let large_body = "x".repeat(10_000);
    let large_response = format!(
        r#"{{"id":"txn_big","status":"approved","data":"{}"}}"#,
        large_body
    );
    assert!(large_response.len() > 10_000);

    let splits = vec![PaymentSplitArg {
        method: "card".into(),
        amount_minor: 999,
        gateway_reference: Some("txn_big".into()),
        gateway_status: Some("approved".into()),
        gateway_response: Some(large_response.clone()),
        idempotency_key: None,
    }];

    let payments = store
        .create_payments(&sale_id, &splits, &currency, now)
        .unwrap();
    assert_eq!(payments.len(), 1);
    assert!(payments[0].gateway_response.as_deref().unwrap().len() > 10_000);

    let listed = store.list_payments_for_sale(&sale_id).unwrap();
    assert!(
        listed[0]
            .gateway_response
            .as_deref()
            .unwrap()
            .contains("txn_big")
    );
}

#[test]
fn payment_currency_different_from_sale() {
    let conn = fresh();
    let store = store(&conn);
    let now = "2025-06-01T12:00:00Z";

    let sale_id = uuid::Uuid::now_v7().to_string();
    // Sale recorded in USD
    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, status,
                            payment_method, tendered_minor,
                            discount_percent, discount_label, user_id,
                            created_at, updated_at,
                            subtotal_minor, tax_total_minor)
         VALUES (?1, ?2, 'USD', 1, 'completed', 'split', ?2,
                 0, NULL, 'user-1', ?3, ?3, ?2, 0)",
        params![sale_id, 3000, now],
    )
    .unwrap();

    // Payment in different currency
    let currency: Currency = "IDR".parse().unwrap();
    let splits = vec![PaymentSplitArg {
        method: "card".into(),
        amount_minor: 45000,
        gateway_reference: None,
        gateway_status: None,
        gateway_response: None,
        idempotency_key: None,
    }];

    let payments = store
        .create_payments(&sale_id, &splits, &currency, now)
        .unwrap();
    assert_eq!(payments.len(), 1);
    assert_eq!(payments[0].amount.currency.to_string(), "IDR");
    assert_eq!(payments[0].amount.minor_units, 45000);

    let listed = store.list_payments_for_sale(&sale_id).unwrap();
    assert_eq!(listed[0].amount.currency.to_string(), "IDR");
}

// ── Idempotency key tests (P5-2) ─────────────────────────────

#[test]
fn create_payments_with_idempotency_key_dedup() {
    let conn = fresh();
    let store = store(&conn);
    let currency: Currency = "USD".parse().unwrap();
    let now = "2025-06-01T12:00:00Z";

    let sale_id = uuid::Uuid::now_v7().to_string();
    insert_sale(&conn, &sale_id, 300, now);

    let ik = uuid::Uuid::now_v7().to_string();

    // First call — creates the payment with idempotency_key
    let splits1 = vec![PaymentSplitArg {
        method: "card".into(),
        amount_minor: 300,
        gateway_reference: Some("txn_first".into()),
        gateway_status: Some("approved".into()),
        gateway_response: None,
        idempotency_key: Some(ik.clone()),
    }];
    let payments1 = store
        .create_payments(&sale_id, &splits1, &currency, now)
        .unwrap();
    assert_eq!(payments1.len(), 1);
    assert_eq!(payments1[0].gateway_reference.as_deref(), Some("txn_first"));
    assert_eq!(payments1[0].idempotency_key.as_deref(), Some(ik.as_str()));

    // Second call — same idempotency_key, should return existing payment (dedup)
    let splits2 = vec![PaymentSplitArg {
        method: "card".into(),
        amount_minor: 999, // different amount, should be ignored due to dedup
        gateway_reference: Some("txn_second".into()),
        gateway_status: Some("approved".into()),
        gateway_response: None,
        idempotency_key: Some(ik.clone()),
    }];
    let payments2 = store
        .create_payments(&sale_id, &splits2, &currency, now)
        .unwrap();
    assert_eq!(payments2.len(), 1);
    // Should return the original payment, not the new one
    assert_eq!(payments2[0].gateway_reference.as_deref(), Some("txn_first"));
    assert_eq!(payments2[0].amount.minor_units, 300);

    // Only 1 payment should exist in the DB
    let listed = store.list_payments_for_sale(&sale_id).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].gateway_reference.as_deref(), Some("txn_first"));
}

#[test]
fn create_payments_different_idempotency_keys_create_separate_records() {
    let conn = fresh();
    let store = store(&conn);
    let currency: Currency = "USD".parse().unwrap();
    let now = "2025-06-01T12:00:00Z";

    let sale_id = uuid::Uuid::now_v7().to_string();
    insert_sale(&conn, &sale_id, 1000, now);

    let ik1 = uuid::Uuid::now_v7().to_string();
    let ik2 = uuid::Uuid::now_v7().to_string();
    assert_ne!(ik1, ik2);

    // Two different sales with different idempotency keys — both should be created
    store
        .create_payments(
            &sale_id,
            &[PaymentSplitArg {
                method: "cash".into(),
                amount_minor: 500,
                gateway_reference: None,
                gateway_status: None,
                gateway_response: None,
                idempotency_key: Some(ik1),
            }],
            &currency,
            now,
        )
        .unwrap();

    store
        .create_payments(
            &sale_id,
            &[PaymentSplitArg {
                method: "card".into(),
                amount_minor: 500,
                gateway_reference: None,
                gateway_status: None,
                gateway_response: None,
                idempotency_key: Some(ik2),
            }],
            &currency,
            now,
        )
        .unwrap();

    let listed = store.list_payments_for_sale(&sale_id).unwrap();
    assert_eq!(listed.len(), 2);
}

#[test]
fn create_payments_idempotency_key_none_allows_duplicates() {
    // Without idempotency key, duplicate payments are NOT deduplicated
    // (no implicit dedup for None keys)
    let conn = fresh();
    let store = store(&conn);
    let currency: Currency = "USD".parse().unwrap();
    let now = "2025-06-01T12:00:00Z";

    let sale_id = uuid::Uuid::now_v7().to_string();
    insert_sale(&conn, &sale_id, 2000, now);

    store
        .create_payments(
            &sale_id,
            &[PaymentSplitArg {
                method: "cash".into(),
                amount_minor: 1000,
                gateway_reference: None,
                gateway_status: None,
                gateway_response: None,
                idempotency_key: None,
            }],
            &currency,
            now,
        )
        .unwrap();

    // Same data, no idempotency key — creates a new record
    store
        .create_payments(
            &sale_id,
            &[PaymentSplitArg {
                method: "cash".into(),
                amount_minor: 1000,
                gateway_reference: None,
                gateway_status: None,
                gateway_response: None,
                idempotency_key: None,
            }],
            &currency,
            now,
        )
        .unwrap();

    let listed = store.list_payments_for_sale(&sale_id).unwrap();
    assert_eq!(listed.len(), 2);
}

// ── find_sale_by_idempotency_key — read side of the COR-7 replay guard ──

fn keyed_split(method: &str, amount_minor: i64, key: &str) -> PaymentSplitArg {
    PaymentSplitArg {
        method: method.into(),
        amount_minor,
        gateway_reference: None,
        gateway_status: None,
        gateway_response: None,
        idempotency_key: Some(key.into()),
    }
}

#[test]
fn find_sale_by_idempotency_key_returns_the_sale_the_key_paid_for() {
    let conn = fresh();
    let store = store(&conn);
    let sale_id = uuid::Uuid::now_v7().to_string();
    let now = "2025-06-01T12:00:00Z";
    insert_sale(&conn, &sale_id, 700, now);
    let currency: Currency = "USD".parse().unwrap();

    store
        .create_payments(
            &sale_id,
            &[keyed_split("cash", 700, "attempt-1:0")],
            &currency,
            now,
        )
        .unwrap();

    assert_eq!(
        store
            .find_sale_by_idempotency_key("attempt-1:0")
            .unwrap()
            .as_deref(),
        Some(sale_id.as_str()),
    );
}

#[test]
fn find_sale_by_idempotency_key_resolves_every_split_of_one_attempt_to_one_sale() {
    // The command layer indexes keys as `{attempt}:{n}` so a split tender does
    // not collide with itself. That only works if every split of the attempt
    // still leads back to the one sale, since the replay check can only hold
    // whichever key it happens to have.
    let conn = fresh();
    let store = store(&conn);
    let sale_id = uuid::Uuid::now_v7().to_string();
    let now = "2025-06-01T12:00:00Z";
    insert_sale(&conn, &sale_id, 700, now);
    let currency: Currency = "USD".parse().unwrap();

    let payments = store
        .create_payments(
            &sale_id,
            &[
                keyed_split("cash", 400, "attempt-2:0"),
                keyed_split("card", 300, "attempt-2:1"),
            ],
            &currency,
            now,
        )
        .unwrap();
    assert_eq!(payments.len(), 2, "both splits must persist");

    for key in ["attempt-2:0", "attempt-2:1"] {
        let found = store.find_sale_by_idempotency_key(key).unwrap();
        assert_eq!(
            found.as_deref(),
            Some(sale_id.as_str()),
            "key {key} should resolve to the attempt sale",
        );
    }
}

#[test]
fn find_sale_by_idempotency_key_returns_none_for_an_unknown_key() {
    let conn = fresh();
    let store = store(&conn);
    assert_eq!(
        store.find_sale_by_idempotency_key("never-used").unwrap(),
        None
    );
}

#[test]
fn find_sale_by_idempotency_key_never_matches_unkeyed_legacy_payments() {
    // The property that kept COR-7 invisible for so long: rows written with a
    // NULL key are mutually distinct under the UNIQUE index, and a NULL never
    // equals a supplied key either. A lookup must miss them rather than
    // resolve to some arbitrary sale, or replaying a new attempt could hand
    // back an unrelated receipt.
    let conn = fresh();
    let store = store(&conn);
    let sale_id = uuid::Uuid::now_v7().to_string();
    let now = "2025-06-01T12:00:00Z";
    insert_sale(&conn, &sale_id, 700, now);
    let currency: Currency = "USD".parse().unwrap();

    store
        .create_payments(
            &sale_id,
            &[PaymentSplitArg {
                method: "cash".into(),
                amount_minor: 700,
                gateway_reference: None,
                gateway_status: None,
                gateway_response: None,
                idempotency_key: None,
            }],
            &currency,
            now,
        )
        .unwrap();

    for key in ["anything", "", "attempt-9:0"] {
        let found = store.find_sale_by_idempotency_key(key).unwrap();
        assert_eq!(
            found, None,
            "a NULL-keyed payment must not match the query for {key:?}",
        );
    }
}
