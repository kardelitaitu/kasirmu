use super::*;
use oz_core::migrations;
use rusqlite::Connection;

fn fresh_conn() -> Connection {
    migrations::fresh_db()
}

fn seed_completed_sale(conn: &Connection) -> String {
    conn.execute_batch(
        "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at) VALUES
            ('p1', 'COFFEE', 'Coffee', 350, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at) VALUES
            ('sale-1', 700, 'USD', 2, 'completed', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position) VALUES
            ('sl-1', 'sale-1', 'COFFEE', 2, 350, 700, 'USD', 1);"
    ).unwrap();
    "sale-1".to_string()
}

/// Seed a user with refund permission so the permission check in
/// `run_process_refund` passes.
fn seed_user_with_refund_permission(conn: &Connection, user_id: &str) {
    conn.execute_batch(&format!(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-refund', 'Refund Tester', 'Refund Tester', '[\"sales:refund\"]', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO users (id, username, display_name, role_id, pin_hash, is_active, created_at, updated_at) VALUES
            ('{user_id}', '{user_id}', 'Test User', 'role-refund', 'hashed', 1, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');"
    )).unwrap();
}

#[test]
fn process_full_refund() {
    let conn = fresh_conn();
    let sale_id = seed_completed_sale(&conn);
    let store = Store::new(&conn);

    let lines = [RefundLineArg {
        sale_line_id: "sl-1".into(),
        sku: "COFFEE".into(),
        qty: 2,
        unit_price_minor: 350,
        currency: "USD".into(),
        line_total_minor: 700,
    }];

    let refund_lines: Vec<RefundLine> = lines
        .iter()
        .map(|l| {
            let currency: oz_core::Currency = l.currency.parse().unwrap();
            RefundLine::new(
                &l.sale_line_id,
                &l.sku,
                l.qty,
                Money {
                    minor_units: l.unit_price_minor,
                    currency,
                },
                Money {
                    minor_units: l.line_total_minor,
                    currency,
                },
            )
        })
        .collect();

    let refund = Refund::new(
        &sale_id,
        Money {
            minor_units: 700,
            currency: "USD".parse().unwrap(),
        },
        "Customer changed mind",
        "",
        "user-1",
        refund_lines,
    );

    store.create_refund(&refund).unwrap();

    let refunds = store.list_refunds_for_sale(&sale_id).unwrap();
    assert_eq!(refunds.len(), 1);
    assert_eq!(refunds[0].total.minor_units, 700);
    assert_eq!(refunds[0].lines.len(), 1);
}

#[test]
fn refund_nonexistent_sale_fails() {
    let conn = fresh_conn();
    let store = Store::new(&conn);

    let lines = vec![RefundLine::new(
        "sl-x",
        "COFFEE",
        1,
        Money {
            minor_units: 350,
            currency: "USD".parse().unwrap(),
        },
        Money {
            minor_units: 350,
            currency: "USD".parse().unwrap(),
        },
    )];
    let refund = Refund::new(
        "nonexistent",
        Money {
            minor_units: 350,
            currency: "USD".parse().unwrap(),
        },
        "test",
        "",
        "user-1",
        lines,
    );
    let result = store.create_refund(&refund);
    assert!(result.is_err());
}

#[test]
fn refund_with_invalid_currency_returns_error_not_silent_fallback() {
    let conn = fresh_conn();
    let sale_id = seed_completed_sale(&conn);
    seed_user_with_refund_permission(&conn, "user-refund-tester");

    let lines = [RefundLineArg {
        sale_line_id: "sl-1".into(),
        sku: "COFFEE".into(),
        qty: 2,
        unit_price_minor: 350,
        currency: "INVALID_ZZZ".into(),
        line_total_minor: 700,
    }];

    let result = run_process_refund(&conn, "user-refund-tester", &sale_id, "test", None, &lines);
    // The bug: `unwrap_or(sale.currency)` silently falls back to USD
    // when the currency parse fails. After the fix, this must return
    // a proper error mentioning the invalid currency.
    assert!(
        result.is_err(),
        "refund with invalid currency 'INVALID_ZZZ' must return Err, \
         got Ok — currency parse failure was silently swallowed (bug #1)"
    );
    let err = result.unwrap_err().to_string();
    assert!(
        err.contains("invalid currency") || err.contains("INVALID_ZZZ"),
        "error should mention invalid currency, got: {err}"
    );
}

#[test]
fn refund_with_valid_currency_succeeds_through_run_process_refund() {
    // Regression: the collect::<Result> refactor must not regress valid flows.
    let conn = fresh_conn();
    let sale_id = seed_completed_sale(&conn);
    seed_user_with_refund_permission(&conn, "user-valid");

    let lines = [RefundLineArg {
        sale_line_id: "sl-1".into(),
        sku: "COFFEE".into(),
        qty: 2,
        unit_price_minor: 350,
        currency: "USD".into(),
        line_total_minor: 700,
    }];

    let result = run_process_refund(&conn, "user-valid", &sale_id, "test", None, &lines);
    assert!(
        result.is_ok(),
        "valid currency must succeed, got: {:?}",
        result.err()
    );
    let r = result.unwrap();
    assert_eq!(r.total_minor, 700);
}

#[test]
fn refund_total_overflow_returns_error() {
    let conn = fresh_conn();
    let sale_id = seed_completed_sale(&conn);
    seed_user_with_refund_permission(&conn, "user-overflow");

    let lines = [
        RefundLineArg {
            sale_line_id: "sl-1".into(),
            sku: "COFFEE".into(),
            qty: 1,
            unit_price_minor: i64::MAX,
            currency: "USD".into(),
            line_total_minor: i64::MAX,
        },
        RefundLineArg {
            sale_line_id: "sl-1".into(),
            sku: "COFFEE".into(),
            qty: 1,
            unit_price_minor: 1,
            currency: "USD".into(),
            line_total_minor: 1,
        },
    ];

    let result = run_process_refund(&conn, "user-overflow", &sale_id, "test", None, &lines);
    // The bug: the refund total was computed with a raw `sum()` over
    // i64 minor units — panics in debug, silently wraps in release.
    // The total must be folded with Money::checked_add so overflow
    // surfaces as a domain error, not a panic or a wrapped amount.
    assert!(
        result.is_err(),
        "refund total overflowing i64 must return Err, got Ok — \
         raw i64 sum() overflowed silently (wrapped) or panicked"
    );
    let err = result.unwrap_err().to_string();
    assert!(
        err.contains("overflow") || err.contains("currency"),
        "error should mention overflow or currency, got: {err}"
    );
}

#[test]
fn refund_line_currency_mismatch_returns_error() {
    let conn = fresh_conn();
    let sale_id = seed_completed_sale(&conn); // sale is USD
    seed_user_with_refund_permission(&conn, "user-mismatch");

    let lines = [RefundLineArg {
        sale_line_id: "sl-1".into(),
        sku: "COFFEE".into(),
        qty: 2,
        unit_price_minor: 350,
        currency: "EUR".into(), // line currency differs from the USD sale
        line_total_minor: 700,
    }];

    let result = run_process_refund(&conn, "user-mismatch", &sale_id, "test", None, &lines);
    // The bug: each line keeps its own parsed currency, but the total
    // was relabeled with the sale's currency AFTER a raw minor-unit
    // sum — cross-currency lines were silently added together.
    // Money::checked_add must reject the mismatch as a domain error.
    assert!(
        result.is_err(),
        "refund line in EUR against a USD sale must return Err, got Ok — \
         cross-currency minor units were summed and relabeled as USD"
    );
    let err = result.unwrap_err().to_string();
    assert!(
        err.contains("currency"),
        "error should mention currency, got: {err}"
    );
}

#[test]
fn refund_line_arg_deserialize() {
    // camelCase — the wire format the shipped UI sends (Bug #13 parity with
    // the bridge fix in 8d91454f; RefundModal.tsx maps
    // saleLineId/unitPriceMinor/lineTotalMinor).
    let json = r#"{"saleLineId":"sl-1","sku":"CAKE","qty":1,"unitPriceMinor":500,"currency":"USD","lineTotalMinor":500}"#;
    let arg: RefundLineArg = serde_json::from_str(json).unwrap();
    assert_eq!(arg.sale_line_id, "sl-1");
    assert_eq!(arg.sku, "CAKE");
    assert_eq!(arg.qty, 1);
    assert_eq!(arg.unit_price_minor, 500);
    assert_eq!(arg.line_total_minor, 500);
}

#[test]
fn process_refund_scoped_args_deserialize() {
    // Repointed from the dead `process_refund` args (registered nowhere on
    // tablet — lib.rs registers only the three *_scoped commands) to the
    // live scoped struct. camelCase — the wire format the UI sends.
    let json = r#"{"saleId":"s1","reason":"damaged","note":"box was crushed","lines":[{"saleLineId":"sl-1","sku":"CAKE","qty":1,"unitPriceMinor":500,"currency":"USD","lineTotalMinor":500}]}"#;
    let args: ProcessRefundScopedArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.sale_id, "s1");
    assert_eq!(args.reason, "damaged");
    assert_eq!(args.note, Some("box was crushed".into()));
    assert_eq!(args.lines.len(), 1);
    assert_eq!(args.lines[0].sku, "CAKE");
}

#[test]
fn process_refund_result_serialize() {
    let result = ProcessRefundResult {
        refund_id: "ref-1".into(),
        total_minor: 1500,
    };
    let json = serde_json::to_string(&result).unwrap();
    assert!(json.contains("ref-1"));
    assert!(json.contains("1500"));
    // Response-side wire contract (Bug #13 twin): the UI reads
    // result.refundId / result.totalMinor (RefundModal.tsx, api/sales.ts),
    // so the serialized keys must be camelCase.
    assert!(
        json.contains("\"refundId\""),
        "expected camelCase refundId, got: {json}"
    );
    assert!(
        json.contains("\"totalMinor\""),
        "expected camelCase totalMinor, got: {json}"
    );
    assert!(
        !json.contains("refund_id") && !json.contains("total_minor"),
        "snake_case keys leaked: {json}"
    );
}

#[test]
fn process_refund_scoped_args_deserialize_exact_ui_payload() {
    // The exact payload RefundModal.tsx:76-90 ships, key for key: each line
    // is { saleLineId, sku, qty, unitPriceMinor, currency, lineTotalMinor }
    // and the scoped args are { saleId, reason, note, lines } with
    // `note: null` when empty (`note.trim() || null`). Nothing fed the
    // tablet shell its own real payload before — each shell pinned its own
    // shape while the UI contract test ran against a vi.fn mock, so the
    // drift shipped green.
    let json = r##"{"saleId":"sale-1","reason":"Damaged carton","note":null,"lines":[{"saleLineId":"sl-1","sku":"COFFEE","qty":2,"unitPriceMinor":350,"currency":"USD","lineTotalMinor":700}]}"##;
    let args: ProcessRefundScopedArgs = serde_json::from_str(json)
        .expect("tablet ProcessRefundScopedArgs must accept the exact RefundModal payload");
    assert_eq!(args.sale_id, "sale-1");
    assert_eq!(args.reason, "Damaged carton");
    assert!(args.note.is_none());
    assert_eq!(args.lines.len(), 1);
    assert_eq!(args.lines[0].sale_line_id, "sl-1");
    assert_eq!(args.lines[0].unit_price_minor, 350);
    assert_eq!(args.lines[0].line_total_minor, 700);
}

#[test]
fn refund_wire_types_are_bridge_reexports_graded_on_values() {
    // Both remaining tablet copies are gone: ProcessRefundResult and
    // ProcessRefundScopedArgs are now re-exports of the bridge types, exactly like
    // ProcessRefundArgs before them. That makes a struct-vs-struct pair assertion
    // VACUOUS - one type agrees with itself by construction - and it also removes
    // the only proof this file had that the tablet wire shape still matches what
    // the front-end reads. So the proof moves to the other side of the boundary:
    // RESOLVED VALUES on the keys ui/src/api/sales.ts names.
    //
    // Read site, field by field: sales.ts:616-619 declares
    //   ProcessRefundResult { refundId: string; totalMinor: number }
    // and sales.ts:650-655 declares the scoped args as
    //   { saleId: string; reason: string; note?: string | null; lines: RefundLineArg[] }
    // both camelCase, which is what the bridge serde rename_all emits and accepts.
    let result = ProcessRefundResult {
        refund_id: "ref-1".into(),
        total_minor: 1500,
    };
    // Fixture sanity FIRST (the a17b0ab61 lesson): a value pin over an empty
    // fixture is decoration, so the input is graded before the output is.
    assert!(
        !result.refund_id.is_empty() && result.total_minor != 0,
        "this case grades a POPULATED result; an empty one makes the key pins below vacuous"
    );
    let out = serde_json::to_value(&result).unwrap();
    // The key the UI indexes, with the VALUE behind it. The older
    // process_refund_result_serialize only asserts json.contains("refundId"), which
    // passes on an object whose refundId holds nothing - the exact shape that read
    // as a blank field on the page and got written back on the next save.
    assert_eq!(
        out["refundId"], "ref-1",
        "tablet must send refundId carrying the id"
    );
    assert_eq!(
        out["totalMinor"], 1500,
        "tablet must send totalMinor carrying the amount"
    );
    assert!(
        out.get("refund_id").is_none() && out.get("total_minor").is_none(),
        "snake_case refund keys must not reach the UI: {out}"
    );

    // Inbound half, same rule: the payload RefundModal ships, graded on what it
    // RESOLVES TO rather than on two declarations agreeing.
    let json = r##"{"saleId":"sale-1","reason":"Damaged carton","note":null,"lines":[{"saleLineId":"sl-1","sku":"COFFEE","qty":2,"unitPriceMinor":350,"currency":"USD","lineTotalMinor":700}]}"##;
    let args: ProcessRefundScopedArgs = serde_json::from_str(json)
        .expect("re-exported ProcessRefundScopedArgs must accept the UI camelCase payload");
    assert!(!args.sale_id.is_empty() && !args.reason.is_empty());
    assert_eq!(args.sale_id, "sale-1");
    assert_eq!(args.reason, "Damaged carton");
    assert_eq!(args.lines.len(), 1);
    assert_eq!(args.lines[0].sale_line_id, "sl-1");
    assert_eq!(args.lines[0].qty, 2);
    assert_eq!(args.lines[0].unit_price_minor, 350);
    assert_eq!(args.lines[0].line_total_minor, 700);
    // note: null is legitimate and must stay None, not Some("").
    assert!(args.note.is_none());
    // And the other direction, which no pair test can ever see: a snake_case
    // payload must be REFUSED, not silently filled with defaults.
    let snake = r#"{"sale_id":"sale-1","reason":"Damaged carton","note":null,"lines":[]}"#;
    assert!(
        serde_json::from_str::<ProcessRefundScopedArgs>(snake).is_err(),
        "a snake_case payload must NOT deserialise - camelCase is the contract"
    );
}
#[test]
fn process_refund_args_deserialize_exact_ui_payload() {
    // The pin for the re-export: `ProcessRefundArgs` is no longer a tablet
    // copy, it IS `kasirmu_bridge::refunds::ProcessRefundArgs`. A struct-vs-struct
    // pair assertion would now be vacuous — the two are one type — so this
    // asserts what the payload RESOLVES TO, not that two declarations agree.
    // Key for key out of `ui/src/api/sales.ts` (`ProcessRefundArgs`:
    // { saleId, reason, note?, userId, lines }) over its `RefundLineArg`
    // ({ saleLineId, sku, qty, unitPriceMinor, currency, lineTotalMinor }).
    let json = r##"{"saleId":"sale-1","reason":"Customer return","note":"box crushed","userId":"u1","lines":[{"saleLineId":"sl-1","sku":"COFFEE","qty":2,"unitPriceMinor":350,"currency":"USD","lineTotalMinor":700}]}"##;
    let args: ProcessRefundArgs = serde_json::from_str(json)
        .expect("tablet ProcessRefundArgs must accept the UI's camelCase payload");

    // Every field holds a VALUE. Two structs both filling `None` is the
    // defect this replaces, not the evidence.
    assert_eq!(args.sale_id, "sale-1", "saleId did not reach sale_id");
    assert_eq!(args.reason, "Customer return");
    assert_eq!(
        args.note.as_deref(),
        Some("box crushed"),
        "note arrived as None — a casing loss on an Option field is silent"
    );
    assert_eq!(args.user_id, "u1", "userId did not reach user_id");
    assert_eq!(args.lines.len(), 1);
    assert_eq!(args.lines[0].sale_line_id, "sl-1");
    assert_eq!(args.lines[0].sku, "COFFEE");
    assert_eq!(args.lines[0].qty, 2);
    assert_eq!(args.lines[0].unit_price_minor, 350);
    assert_eq!(args.lines[0].currency, "USD");
    assert_eq!(args.lines[0].line_total_minor, 700);

    // `note` is the one optional field: omitted must still be a clean None,
    // not a deserialisation error — the UI sends `note: undefined`.
    let omitted: ProcessRefundArgs =
        serde_json::from_str(r##"{"saleId":"s2","reason":"r","userId":"u1","lines":[]}"##)
            .expect("omitted note must be accepted");
    assert!(omitted.note.is_none());

    // Direction of the change, pinned: the tablet's deleted copy was
    // snake_case-only, so the old spelling is now the key set that fails.
    // If a reader ever re-adds an alias for these, they are deciding to
    // accept a payload no caller in ui/src sends — say so, do not sneak it.
    let snake = r##"{"sale_id":"s","reason":"r","user_id":"u","lines":[]}"##;
    let err = serde_json::from_str::<ProcessRefundArgs>(snake)
        .expect_err("snake_case must now be refused by the shared camelCase type");
    assert!(
        err.to_string().contains("saleId"),
        "expected a missing-field error naming saleId, got: {err}"
    );
}
