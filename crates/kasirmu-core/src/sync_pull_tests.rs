//! `sync_pull` tests — the E1 sync-wire contract (D64 binding condition (a):
//! a hub-authored rounding mode must reach branches, and a pre-E1 payload
//! must land exactly as it did before).

use super::*;

#[test]
fn snapshot_tax_rate_rounding_mode_defaults_to_the_empty_sentinel() {
    // A payload written before 20260929 carries no rounding_mode key; absence
    // IS the '' sentinel — every pre-E1 row.
    // The minimal payload carries the REQUIRED fields explicitly; only
    // `rounding_mode` is omitted, which is this test's subject.
    let legacy: SnapshotTaxRate = serde_json::from_str(
        r#"{"id":"t1","name":"VAT","rate_bps":1000,"is_default":false,"is_inclusive":false}"#,
    )
    .unwrap();
    assert_eq!(legacy.rounding_mode, "");

    let stamped: SnapshotTaxRate = serde_json::from_str(
        r#"{"id":"t2","name":"VAT","rate_bps":1000,"is_default":false,"is_inclusive":false,"rounding_mode":"half_up"}"#,
    )
    .unwrap();
    assert_eq!(stamped.rounding_mode, "half_up");
}

/// A tax-rate payload missing `is_inclusive`/`is_default` must be REJECTED.
///
/// Both fields were `bool` with `#[serde(default)]`, so a payload omitting them
/// deserialized to `false` — and `false` is not an absence here, it is a VALUE:
/// `is_inclusive = false` means "tax added on top", so a rate arriving without
/// the key would price every line differently, and the upsert overwrites the
/// stored value with it. A money bug, silently accepted.
///
/// The fields are REQUIRED now, and that cannot refuse a legitimate payload:
/// both columns exist in the BASELINE schema (`20260813_init.sql:885,888`), so no
/// server version could omit them. That distinguishes them from the four
/// scope/window fields, whose defaults ARE the documented back-compat ruling for
/// pre-20260921 payloads and are deliberately left in place.
///
/// This change made three existing fixtures fail, which is evidence rather than
/// noise: they under-specified their payloads because the defaults let them. Each
/// was updated to carry the two flags EXPLICITLY, so the field they actually test
/// (`rounding_mode`, or the upsert's overwrite behaviour) stays the subject. Every
/// real producer already emits both — `sync_store/pg.rs:385`, `sync_store/sqlite.rs:347`
/// — so no fixture was modelling a shape the wire can produce.
#[test]
fn a_tax_rate_payload_without_is_inclusive_is_rejected_not_defaulted_to_false() {
    let missing: Result<SnapshotTaxRate, _> =
        serde_json::from_str(r#"{"id":"t1","name":"VAT","rate_bps":1000}"#);
    assert!(
        missing.is_err(),
        "omitting is_inclusive must fail, not silently mean 'tax added on top'"
    );

    // A complete payload still parses, so the field is required, not impossible.
    let complete: SnapshotTaxRate = serde_json::from_str(
        r#"{"id":"t2","name":"VAT","rate_bps":1000,"is_default":false,"is_inclusive":true}"#,
    )
    .expect("a payload carrying both flags must still parse");
    assert!(complete.is_inclusive, "true must round-trip as true");
}

#[test]
fn upsert_tax_rates_lands_the_directive_and_overwrites_unconditionally() {
    let mut conn = crate::migrations::fresh_db();

    let rows: Vec<SnapshotTaxRate> = serde_json::from_str(
        r#"[
            {"id":"t1","name":"VAT","rate_bps":1000,"is_default":false,"is_inclusive":false,"rounding_mode":"truncate"},
            {"id":"t2","name":"Old","rate_bps":500,"is_default":false,"is_inclusive":false}
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
        serde_json::from_str(
            r#"[{"id":"t1","name":"VAT","rate_bps":1000,"is_default":false,"is_inclusive":false,"rounding_mode":""}]"#,
        )
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
        r#"[{"id":"t1","name":"VAT","rate_bps":1000,"is_default":false,"is_inclusive":false,"rounding_mode":"bankers"}]"#,
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
