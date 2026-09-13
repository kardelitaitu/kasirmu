//! `sync_pull` tests — the E1 sync-wire contract (D64 binding condition (a):
//! a hub-authored rounding mode must reach branches, and a pre-E1 payload
//! must land exactly as it did before).

use super::*;

#[test]
fn snapshot_tax_rate_rounding_mode_defaults_to_the_empty_sentinel() {
    // A payload written before 20260929 carries no rounding_mode key; absence
    // IS the '' sentinel — every pre-E1 row.
    let legacy: SnapshotTaxRate =
        serde_json::from_str(r#"{"id":"t1","name":"VAT","rate_bps":1000}"#).unwrap();
    assert_eq!(legacy.rounding_mode, "");

    let stamped: SnapshotTaxRate = serde_json::from_str(
        r#"{"id":"t2","name":"VAT","rate_bps":1000,"rounding_mode":"half_up"}"#,
    )
    .unwrap();
    assert_eq!(stamped.rounding_mode, "half_up");
}

#[test]
fn upsert_tax_rates_lands_the_directive_and_overwrites_unconditionally() {
    let mut conn = crate::migrations::fresh_db();

    let rows: Vec<SnapshotTaxRate> = serde_json::from_str(
        r#"[
            {"id":"t1","name":"VAT","rate_bps":1000,"rounding_mode":"truncate"},
            {"id":"t2","name":"Old","rate_bps":500}
        ]"#,
    )
    .unwrap();
    let tx = conn.transaction().unwrap();
    upsert_tax_rates(&tx, &rows).unwrap();
    tx.commit().unwrap();

    let t1: String = conn
        .query_row(
            "SELECT rounding_mode FROM tax_rates WHERE id = 't1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(t1, "truncate", "a stamped row lands its directive");
    let t2: String = conn
        .query_row(
            "SELECT rounding_mode FROM tax_rates WHERE id = 't2'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(t2, "", "an unstamped (pre-E1) row lands the '' sentinel");

    // Server-authoritative on conflict — the scope columns' deliberate
    // non-COALESCE applies here too: a directive REMOVED at the hub clears
    // at the branch instead of keeping a stale mode alive.
    let updated: Vec<SnapshotTaxRate> =
        serde_json::from_str(r#"[{"id":"t1","name":"VAT","rate_bps":1000,"rounding_mode":""}]"#)
            .unwrap();
    let tx = conn.transaction().unwrap();
    upsert_tax_rates(&tx, &updated).unwrap();
    tx.commit().unwrap();
    let t1: String = conn
        .query_row(
            "SELECT rounding_mode FROM tax_rates WHERE id = 't1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        t1, "",
        "the conflict arm assigns rounding_mode unconditionally"
    );
}

#[test]
fn upsert_tax_rates_refuses_a_directive_outside_the_statutory_alphabet() {
    let mut conn = crate::migrations::fresh_db();

    let rows: Vec<SnapshotTaxRate> = serde_json::from_str(
        r#"[{"id":"t1","name":"VAT","rate_bps":1000,"rounding_mode":"bankers"}]"#,
    )
    .unwrap();
    let tx = conn.transaction().unwrap();
    let landed = upsert_tax_rates(&tx, &rows).unwrap();
    tx.commit().unwrap();

    assert_eq!(
        landed, 0,
        "a foreign-alphabet row is skipped, not flattened to ''"
    );
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM tax_rates WHERE id = 't1'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(count, 0, "the refused row must not have been inserted");
}
