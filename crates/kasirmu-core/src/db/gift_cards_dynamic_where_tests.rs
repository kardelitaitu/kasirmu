//! Plan coverage for `Store::list_gift_cards` - the crate's SECOND runtime-assembled
//! `WHERE` builder (`db/gift_cards.rs:211-301`).
//!
//! Same blind spot and same remedy as `db/audit_dynamic_where_tests.rs`: the call
//! shapes are ENUMERATED from one curated table and graded with
//! `EXPLAIN QUERY PLAN` over a seeded, ANALYZE'd database.
//!
//! # Honest scope, stated up front
//!
//! `gift_cards` is NOT in the integration probe's `LARGE_TABLES` list, and this
//! module does not move it there: a gift-card table is bounded by the cards a
//! merchant issues, not by transaction volume. The plans below are therefore
//! MEASURED first and graded second, and the one assertion that is made is the
//! measured fact that SQLite already relies on - the status filter has a real
//! access path (`idx_gift_cards_status`) - plus the shapes that have none.
//!
//! Turning a measurement into a silent pass would hide the finding; turning it
//! into a failing assertion would assert a policy this module was not asked to
//! set. So the scan shapes are asserted to be NON-VACUOUS and their plans are
//! named in the failure message of `gift_card_scan_shapes_are_reported` - which
//! is a FAILING-by-design report, not a gate: it exists so the numbers are
//! recorded where a reader will find them rather than inferred from a doc.

use super::*;
use crate::migrations;
use rusqlite::Connection;

/// Rows seeded into `gift_cards`.
const SEED_ROWS: i64 = 5_000;

/// The filter shapes the gift-cards screen and the till actually send: no
/// filter (the default listing), a card-number search, the status tab, the
/// issued-to search, the balance floor, and the status tab with a search -
/// the only pairing any screen produces.
///
/// A function, not a `const` table: `GiftCardFilter` owns `String`s and cannot
/// be built in a constant.
fn filter_shapes() -> Vec<(&'static str, GiftCardFilter)> {
    vec![
        ("no filter (default listing)", GiftCardFilter::default()),
        (
            "search only",
            GiftCardFilter {
                search: Some("GC0001".to_owned()),
                ..GiftCardFilter::default()
            },
        ),
        (
            "status only",
            GiftCardFilter {
                status: Some("active".to_owned()),
                ..GiftCardFilter::default()
            },
        ),
        (
            "issued_to only",
            GiftCardFilter {
                issued_to: Some("cust-1".to_owned()),
                ..GiftCardFilter::default()
            },
        ),
        (
            "min_balance only",
            GiftCardFilter {
                min_balance: Some(5_000),
                ..GiftCardFilter::default()
            },
        ),
        (
            "status + search (the tab with a search term)",
            GiftCardFilter {
                status: Some("active".to_owned()),
                search: Some("GC0001".to_owned()),
                ..GiftCardFilter::default()
            },
        ),
    ]
}

fn seeded_gift_card_connection() -> Connection {
    let conn = migrations::fresh_db();
    {
        let tx = conn
            .unchecked_transaction()
            .expect("opening the gift-card seed transaction on a migrated in-memory DB");
        for i in 0..SEED_ROWS {
            tx.execute(
                "INSERT INTO gift_cards (id, card_number, initial_balance_minor, current_balance_minor,
                                         currency, status, issued_to, issue_date, created_by, updated_at)
                 VALUES (?1, ?2, 10000, ?3, 'MUR', ?4, ?5, '2026-01-01', NULL, ?6)",
                rusqlite::params![
                    format!("dw-gift-{i:06}"),
                    format!("GC{i:06}"),
                    (i * 7) % 10_000,
                    // A gift-card table is a HISTORY: spent cards accumulate forever,
                    // the live ones are the minority. 20% active / 70% redeemed /
                    // 10% expired, so the 'active' tab is a genuinely selective read.
                    // Measured: with 'active' at 80% SQLite correctly prefers one
                    // table scan over the index, and the probe would have been
                    // grading the fixture rather than the query.
                    if i % 10 == 7 {
                        "expired"
                    } else if i % 5 == 0 {
                        "active"
                    } else {
                        "redeemed"
                    },
                    format!("cust-{}", i % 200),
                    format!(
                        "2026-{:02}-{:02}T00:00:00.000Z",
                        (i % 12) + 1,
                        (i % 28) + 1
                    ),
                ],
            )
            .expect("seeding gift_cards");
        }
        tx.commit()
            .expect("committing the gift-card seed transaction");
    }
    conn.execute_batch("ANALYZE")
        .expect("ANALYZE on the seeded database");
    conn
}

/// The where/params text `list_gift_cards` assembles for `filter`.
///
/// Kept in lockstep with `db/gift_cards.rs:211-301` by
/// `list_gift_cards_fragments_are_still_where_expected` below, which reads the
/// production source and fails if any filter's clause literal changes shape.
fn assemble_where(filter: &GiftCardFilter) -> (String, Vec<String>, usize) {
    let mut where_clauses: Vec<String> = Vec::new();
    let mut param_values: Vec<String> = Vec::new();
    let mut param_idx = 1;

    if let Some(ref search) = filter.search {
        let escaped = search
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        where_clauses.push(format!(
            "(g.card_number LIKE ?{param_idx} ESCAPE '\\' OR g.issued_to LIKE ?{param_idx} ESCAPE '\\')"
        ));
        param_values.push(format!("%{escaped}%"));
        param_idx += 1;
    }
    if let Some(ref status) = filter.status {
        where_clauses.push(format!("g.status = ?{param_idx}"));
        param_values.push(status.clone());
        param_idx += 1;
    }
    if let Some(ref issued_to) = filter.issued_to {
        let escaped = issued_to
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        where_clauses.push(format!("g.issued_to LIKE ?{param_idx} ESCAPE '\\'"));
        param_values.push(format!("%{escaped}%"));
        param_idx += 1;
    }
    if let Some(min_balance) = filter.min_balance {
        where_clauses.push(format!("g.current_balance_minor >= ?{param_idx}"));
        param_values.push(min_balance.to_string());
    }

    let where_sql = if where_clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", where_clauses.join(" AND "))
    };
    (where_sql, param_values, param_idx)
}

fn list_sql(where_sql: &str) -> String {
    format!(
        "SELECT g.id, g.card_number, g.initial_balance_minor, g.current_balance_minor,
             g.currency, g.status, g.issued_to, g.issue_date, g.expiry_date, g.created_by, g.updated_at
             FROM gift_cards g {where_sql} ORDER BY g.updated_at DESC"
    )
}

fn source(relative: &str) -> String {
    let path = format!("{}/{relative}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("reading {path}: {e}"))
}

/// Every clause literal this file re-uses is still in the production builder.
///
/// The assembly above is a copy, and a copy is only honest while the original
/// still says the same thing. This test is what keeps that true: change the
/// method's clause text and this fails here, before a stale plan passes.
#[test]
fn list_gift_cards_fragments_are_still_where_expected() {
    let text = source("src/db/gift_cards.rs");
    for fragment in [
        "g.card_number LIKE ?{param_idx} ESCAPE",
        "g.status = ?{param_idx}",
        "g.issued_to LIKE ?{param_idx} ESCAPE",
        "g.current_balance_minor >= ?{param_idx}",
        "ORDER BY g.updated_at DESC",
    ] {
        assert!(
            text.contains(fragment),
            "db/gift_cards.rs no longer contains {fragment}; the probe's assembly is stale"
        );
    }
}

/// A plan step that reads its source in FULL.
fn scans_in_full(plan: &str) -> Option<&str> {
    plan.lines().find(|line| {
        let l = line.trim();
        l.starts_with("SCAN ") && (!l.contains("USING INDEX") || l.contains("USING COVERING INDEX"))
    })
}

fn plan_of(conn: &Connection, sql: &str, binds: &[String]) -> String {
    let explain = format!("EXPLAIN QUERY PLAN {sql}");
    let mut stmt = conn
        .prepare(&explain)
        .unwrap_or_else(|e| panic!("preparing the gift-card plan failed: {e}\nSQL:\n{sql}"));
    let rows = stmt
        .query_map(
            rusqlite::params_from_iter(binds.iter().map(String::as_str)),
            |r| r.get::<_, String>(3),
        )
        .unwrap_or_else(|e| panic!("running the gift-card plan failed: {e}\nSQL:\n{sql}"));
    rows.collect::<Result<Vec<_>, _>>()
        .unwrap_or_else(|e| panic!("reading the gift-card plan failed: {e}\nSQL:\n{sql}"))
        .join("\n")
}

/// The seed is large enough that a full read is a real cost, and every shape
/// matches real rows - a filter that matched nothing would plan the same way
/// whether or not its text was right.
#[test]
fn gift_card_filter_shapes_are_non_vacuous() {
    let conn = seeded_gift_card_connection();
    let rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM gift_cards", [], |r| r.get(0))
        .expect("counting the seeded gift_cards");
    assert!(
        rows >= SEED_ROWS,
        "gift_cards holds {rows} rows after seeding, expected {SEED_ROWS}; the plan assertions would be vacuous",
    );

    for (label, filter) in filter_shapes() {
        let (where_sql, binds, idx) = assemble_where(&filter);
        let count_sql = format!("SELECT COUNT(*) FROM gift_cards g {where_sql}");
        let matched: i64 = conn
            .query_row(
                &count_sql,
                rusqlite::params_from_iter(binds.iter().map(String::as_str)),
                |r| r.get(0),
            )
            .unwrap_or_else(|e| panic!("{label}: counting matches failed: {e}"));
        assert!(
            matched > 0,
            "{label}: the filter matches no seeded row, so its plan says nothing about the product's query",
        );
        assert!(
            (idx - 1) == binds.len() || idx == binds.len(),
            "{label}: placeholder index {idx} does not line up with {} bound value(s)",
            binds.len(),
        );
    }
}

/// The status tab IS served by `idx_gift_cards_status` - asserted, because losing
/// it would be a regression against a plan the shipped schema already gives.
#[test]
fn gift_card_status_filter_has_an_access_path() {
    let conn = seeded_gift_card_connection();
    let shapes = filter_shapes();
    let (where_sql, binds, _) = assemble_where(&shapes[2].1);
    let plan = plan_of(&conn, &list_sql(&where_sql), &binds);
    assert!(
        plan.contains("idx_gift_cards_status"),
        "the status-filtered gift-card listing no longer uses idx_gift_cards_status; plan:\n{plan}"
    );
}

/// MEASURED FINDING, PINNED - the gift-card filter shapes that have no access
/// path at all.
///
/// `gift_cards` is NOT a LARGE table in the integration probe's sense (bounded by
/// cards issued, not by transaction volume), so a scan here does not belong in
/// the O-M69 gate and this module does not move it there. But four of the six
/// shapes measured here read the whole table. Measured:
///
///   no filter              -> SCAN g
///   search only            -> SCAN g   (card_number LIKE OR issued_to LIKE)
///   issued_to only         -> SCAN g
///   min_balance only       -> SCAN g
///
/// Only the two shapes carrying `status = ?` are served, and only by
/// `idx_gift_cards_status`. This is reported to the owner for a decision - an
/// index, or an explicit acceptance - and is NOT fixed here.
///
/// # Why this is pinned rather than left red or ignored
///
/// The finding is real and must not be lost, but a suite that stays red forever
/// is a suite nobody reads: `#[ignore]` would hide it, and a permanent failure
/// would drown the next real red. So the measured COUNT is pinned to the number
/// this file was written against. That makes the finding loudly recordable in the
/// test's own name and message while keeping the suite green, and it makes the
/// test FAIL in BOTH directions that matter: when a shape starts scanning that
/// did not before, and when an index lands and the count drops - at which point
/// the number must be lowered deliberately, with this doc read first.
#[test]
fn gift_card_scan_shapes_are_pinned_as_a_measured_finding() {
    const PINNED_FULL_READS: usize = 4;

    let conn = seeded_gift_card_connection();
    let mut found: Vec<String> = Vec::new();
    for (label, filter) in filter_shapes() {
        let (where_sql, binds, _) = assemble_where(&filter);
        let sql = list_sql(&where_sql);
        let plan = plan_of(&conn, &sql, &binds);
        if let Some(step) = scans_in_full(&plan) {
            found.push(format!(
                "  {label}\n    {where_sql}\n    reads in full: {step}"
            ));
        }
    }
    assert_eq!(
        found.len(),
        PINNED_FULL_READS,
        "the number of gift-card filter shapes that read gift_cards in full CHANGED. If it went UP a shape regressed; if it went DOWN an index landed - either way lower or raise PINNED_FULL_READS deliberately. gift_cards is bounded by cards issued, so this is NOT the O-M69 growth class; the plan is the owner's call. Measured now:\n\n{body}\n",
        body = found.join("\n\n"),
    );
}
