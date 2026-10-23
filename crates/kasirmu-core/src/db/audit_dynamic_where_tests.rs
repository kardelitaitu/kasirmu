//! Plan coverage for the queries whose `WHERE` clause is ASSEMBLED AT RUN TIME.
//!
//! `tests/integration/query_plan_probe.rs` prepares a KNOWN string, so a query
//! whose predicate list is built per call is invisible to it - the documented
//! blind spot, and exactly where O-M69 lived (`build_audit_where` appends
//! `outcome = ?N` conditionally, and the outcome-filtered FIRST page scanned).
//!
//! This module closes the blind spot without guessing the call shapes: the
//! combinations come from ONE curated table, every one of them goes through the
//! PRODUCTION builder (`build_audit_where`, reached through `use super::*`), and
//! every combination is graded on BOTH page shapes - the FIRST page (no cursor)
//! and the keyset page (cursor).
//!
//! # The tests live here, in `db/`, and this is the whole visibility story
//!
//! `build_audit_where` stays a private `fn`. A sibling test module declared
//! inside its own file is a CHILD of that module, and a child body reaches a
//! private item of its parent through `use super::*`. No `pub`, no `pub(crate)`,
//! no production edit of any kind: the plan is measured on the very function
//! the product runs, not on a copy that can drift from it.
//!
//! The other runtime-assembled builders in this crate are covered the same way
//! from their own sibling modules: `db/gift_cards_dynamic_where_tests.rs`
//! (`list_gift_cards`) and `db/kds_orders_dynamic_where_tests.rs` (three KDS
//! readers).
//!
//! # Why the FIRST page is the assertion that matters
//!
//! The keyset clause (`created_at < ?N OR (created_at = ?N AND id < ?N+1)`)
//! gives the planner a RANGE to seek into, so it can hide a defect the first
//! page shows plainly. Measured on this schema with the O-M69 index dropped
//! (`dropping_the_outcome_index_fails_this_probe` re-measures it every run):
//!
//!   outcome + cursor     -> SEARCH audit_log USING INDEX idx_audit_log_created_at (created_at<?)
//!   outcome FIRST page   -> SCAN audit_log USING INDEX idx_audit_log_created_at
//!                           | USE TEMP B-TREE FOR RIGHT PART OF ORDER BY
//!
//! Asserting only the cursor shape would have passed while every user who
//! opened the screen landed on a full read of the log.
//!
//! # The detector has to know what was PREDICATED, not just what was planned
//!
//! The two plans above are *textually identical lines* except for the index
//! name: the unfiltered page legitimately walks `idx_audit_log_created_at` in
//! ORDER BY order and stops at `LIMIT`, and the defective page walks the same
//! index and pushes the filter into it. Neither string says which is which. So
//! `scans_in_full` is handed the predicate columns read out of the assembled
//! WHERE (`predicate_columns`): a walk of a non-covering index is an ORDERED
//! WALK only while no predicate names a column that has a leading index of its
//! own. Otherwise it is a full read with a filter bolted on - O-M69's shape.

use super::*;
use crate::migrations;
use rusqlite::Connection;

/// Rows seeded into `audit_log`. The migration that added the O-M69 index
/// measured with this many rows and an `ANALYZE`; a smaller table lets SQLite
/// price a full read as cheap and the grading becomes a coin flip.
const SEED_ROWS: i64 = 5_000;

/// The index O-M69 added. Named once: the gate asserts it is present and the
/// falsification test drops it by name.
const OUTCOME_INDEX: &str = "idx_audit_log_outcome_created";

/// Every `audit_log` index that LEADS on a single column this builder can
/// filter with. A predicate on one of these columns must be served by it; when
/// the plan reads the table anyway, the predicate is a FILTER over a full walk.
const LOAD_BEARING_INDEXES: &[(&str, &str)] = &[
    ("outcome", OUTCOME_INDEX),
    ("action", "idx_audit_log_action"),
    ("user_id", "idx_audit_log_user_id"),
    ("created_at", "idx_audit_log_created_at"),
];

/// The allow-list the SECURITY-EVENTS page sends - `SECURITY_ACTIONS`
/// (`db/audit_security.rs:82-91`), spelled here in its production order.
///
/// Eight actions out of a catalogue of dozens is the real call shape, and it is
/// the one `list_security_events` makes on every board refresh.
const SECURITY_ACTIONS: &[&str] = &[
    "login",
    "login_failed",
    "logout",
    "user.create",
    "user.update",
    "impersonate.start",
    "impersonate.stop",
    "org.switch",
];

/// A short allow-list of ordinary business actions, for the boundary measurement.
const TWO_ACTIONS: &[&str] = &["sale.void", "sale.refund"];

/// One curated call shape for `build_audit_where`: the builder's seven
/// predicate arguments, in the builder's own order.
type Shape = (
    Option<&'static str>,
    Option<&'static str>,
    Option<&'static [&'static str]>,
    Option<&'static str>,
    Option<&'static str>,
    Option<&'static str>,
    Option<(&'static str, &'static str)>,
);

/// A migrated, seeded, ANALYZE'd in-memory database whose `audit_log` carries
/// both halves of a real log: an ordinary business-action history (which
/// dominates in volume) and a security-event slice.
///
/// The mix is load-bearing, not decoration, and it was measured:
///
/// * the business actions are `i % 5` over five values, so - once three of the
///   fifteen security slots are taken from the same modulus - no single action
///   exceeds 1/5 of the table. A fixture where four actions split the WHOLE
///   table makes every multi-value `IN` list read as 'most of the table', and
///   SQLite then abandons the index for a reason that describes the fixture
///   rather than the query. That was measured here and the seed was fixed;
/// * the eight `SECURITY_ACTIONS` are sparse among them, which is what makes the
///   security-events page a genuinely selective read.
///
/// `success` outnumbers `failure` 49:1, the shape an audit log actually has and
/// the shape the O-M69 migration measured against. A 50/50 split would make
/// `outcome = 'success'` half-selective and the planner could abandon the index
/// for reasons that say nothing about the query.
fn seeded_audit_connection() -> Connection {
    let conn = migrations::fresh_db();
    {
        let tx = conn
            .unchecked_transaction()
            .expect("opening the audit seed transaction on a migrated in-memory DB");
        for i in 0..SEED_ROWS {
            tx.execute(
                "INSERT INTO audit_log (id, user_id, action, target_type, target_id, details, outcome, created_at)
                 VALUES (?1, ?2, ?3, 'sale', ?4, '{}', ?5, ?6)",
                rusqlite::params![
                    format!("dw-audit-{i:06}"),
                    format!("dw-user-{}", i % 7),
                    seed_action(i),
                    format!("dw-sale-{i}"),
                    if i % 50 == 0 { "failure" } else { "success" },
                    format!(
                        "2026-{:02}-{:02}T{:02}:{:02}:00.000Z",
                        (i % 12) + 1,
                        (i % 28) + 1,
                        i % 24,
                        i % 60
                    ),
                ],
            )
            .expect("seeding audit_log");
        }
        tx.commit().expect("committing the audit seed transaction");
    }
    conn.execute_batch("ANALYZE")
        .expect("ANALYZE on the seeded database");
    conn
}

/// The actions a real audit log holds: a long tail of ordinary business events.
///
/// Both densities below are MEASURED, and both are load-bearing:
///
/// * SECURITY events are 1 in 100. `list_security_events` filters by the eight
///   `SECURITY_ACTIONS` and SQLite serves it from `idx_audit_log_action` while
///   those are a small fraction of the log - which is what a merchant's log
///   looks like, logins being rare next to sales and product edits.
/// * the ordinary actions come from a twelve-entry tail, so any TWO of them
///   are ~1/6 of the table. SQLite serves an `action IN (...)` from
///   `idx_audit_log_action` below roughly a quarter of the table and prefers one
///   ordered walk above it - a real cost-model boundary, measured:
///
///   ```text
///   2 of 3 distinct actions  -> SCAN audit_log USING INDEX idx_audit_log_created_at
///   2 of 8 distinct actions  -> SEARCH audit_log USING INDEX idx_audit_log_action
///   ```
///
///   A fixture with three action values put 40% of the log in the two filtered
///   ones and made the query scan - correctly. Grading that would have graded
///   the fixture: the assertion was right and the seed was wrong.
const BUSINESS_ACTIONS: [&str; 12] = [
    "sale.create",
    "sale.void",
    "sale.refund",
    "settings.change",
    "product.update",
    "sale.hold",
    "sale.resume",
    "shift.open",
    "shift.close",
    "receipt.print",
    "inventory.adjust",
    "purchase_order.create",
];

/// The action a seeded row carries: an ordinary business event, with a SECURITY
/// event every hundredth row.
fn seed_action(i: i64) -> &'static str {
    if i % 100 == 0 {
        SECURITY_ACTIONS[(i / 100) as usize % SECURITY_ACTIONS.len()]
    } else {
        BUSINESS_ACTIONS[(i % BUSINESS_ACTIONS.len() as i64) as usize]
    }
}
/// The curated list of call shapes, ENUMERATED instead of all 2^7 = 128.
///
/// COVERED, in three groups:
///
/// 1. no predicate at all - the unfiltered audit screen;
/// 2. each single predicate alone - outcome (both values), query, the actions
///    allow-list at BOTH the production width (eight, `SECURITY_ACTIONS`) and a
///    short width (two), the actor, and the created_at window. A predicate that
///    reads the log in full ON ITS OWN is the defect class; pairing it with
///    another only gives the planner a second index to hide behind;
/// 3. the shapes real callers send. `list_audit_entries_filtered` forwards
///    (outcome, query, cursor) and nothing else, so outcome+query is what the
///    review screen asks for; `list_security_events` forwards the eight-action
///    allow-list plus (outcome, query, cursor); `list_audit_entries_export_filtered`
///    sends the actor with both date bounds.
///
/// SKIPPED, deliberately:
///
/// * the 100+ three-through-seven-predicate permutations. Each is an
///   INTERSECTION of shapes graded alone here: SQLite seeks on the predicate it
///   can index and filters the rest, so a shape that already has an indexed
///   access path cannot become a full read merely by gaining another AND-ed
///   predicate that was itself graded seekable. The reverse is not true, which
///   is why group 2 exists.
/// * the empty-string predicates (blank outcome/query/actor, an empty actions
///   slice). The builder TRIMS the first three away and turns the empty
///   allow-list into the literal `1 = 0`; their assembled text is the
///   "no predicate" shape already graded, or a `1 = 0` SQLite short-circuits
///   without reading the table. `blank_predicates_collapse_onto_the_unfiltered_shape`
///   pins that identity instead of re-planning it.
/// * the remaining cursor permutations (cursor+query, cursor+actions, ...).
///   Every shape is graded on BOTH page shapes, so the cursor is never the only
///   grading; the extra combinations add no new access path.
const SHAPES: &[(&str, Shape)] = &[
    // -- (ii) no predicate at all ------------------------------------
    ("no predicate", (None, None, None, None, None, None, None)),
    // -- (i) each single predicate alone -----------------------------
    (
        "outcome = success",
        (Some("success"), None, None, None, None, None, None),
    ),
    (
        "outcome = failure",
        (Some("failure"), None, None, None, None, None, None),
    ),
    (
        "query only",
        (None, Some("sale.void"), None, None, None, None, None),
    ),
    (
        "actions: SECURITY_ACTIONS allow-list only (the security-events page)",
        (None, None, Some(SECURITY_ACTIONS), None, None, None, None),
    ),
    (
        "actions: two-entry allow-list only",
        (None, None, Some(TWO_ACTIONS), None, None, None, None),
    ),
    (
        "actor only",
        (None, None, None, Some("dw-user-3"), None, None, None),
    ),
    (
        "created_after + created_before",
        (
            None,
            None,
            None,
            None,
            Some("2026-03-01T00:00:00.000Z"),
            Some("2026-09-01T00:00:00.000Z"),
            None,
        ),
    ),
    // -- (iii) the combinations real callers send --------------------
    (
        "outcome + query (filtered listing with a search term)",
        (
            Some("success"),
            Some("sale.void"),
            None,
            None,
            None,
            None,
            None,
        ),
    ),
    (
        "actor + created_after + created_before (security-event export)",
        (
            None,
            None,
            None,
            Some("dw-user-3"),
            Some("2026-03-01T00:00:00.000Z"),
            Some("2026-09-01T00:00:00.000Z"),
            None,
        ),
    ),
];

/// The keyset cursor every "second page" variant uses.
const CURSOR: (&str, &str) = ("2026-06-01T00:00:00.000Z", "dw-audit-050000");

/// The page query `Store::list_audit_entries_page` and
/// `Store::list_audit_entries_export_filtered` assemble: the column list, the
/// real `where_sql` from the builder, the product's ORDER BY, and a `LIMIT`
/// bound to the builder's next placeholder index.
fn page_sql(where_sql: &str, idx: usize) -> String {
    format!(
        "SELECT id, user_id, action, target_type, target_id, details, outcome, created_at
             FROM audit_log{where_sql} ORDER BY created_at DESC, id DESC LIMIT ?{idx}"
    )
}

/// The `EXPLAIN QUERY PLAN` output for `sql`, one step per line.
fn run_plan(conn: &Connection, sql: &str, binds: &[String]) -> String {
    let explain = format!("EXPLAIN QUERY PLAN {sql}");
    let mut stmt = conn
        .prepare(&explain)
        .unwrap_or_else(|e| panic!("preparing the plan failed: {e}\nSQL:\n{sql}"));
    assert_eq!(
        stmt.parameter_count(),
        binds.len(),
        "the probe binds {n} value(s) for {p} placeholder(s); the builder changed shape and the binds must follow it\nSQL:\n{sql}",
        n = binds.len(),
        p = stmt.parameter_count(),
    );
    let rows = stmt
        .query_map(
            rusqlite::params_from_iter(binds.iter().map(String::as_str)),
            |r| r.get::<_, String>(3),
        )
        .unwrap_or_else(|e| panic!("running the plan failed: {e}\nSQL:\n{sql}"));
    rows.collect::<Result<Vec<_>, _>>()
        .unwrap_or_else(|e| panic!("reading the plan failed: {e}\nSQL:\n{sql}"))
        .join("\n")
}

/// The builder's own parameters as the text this probe binds.
///
/// Read back off the builder (rather than re-derived) so the probe cannot
/// disagree with the clause it grades about which value belongs to which
/// placeholder.
fn builder_binds(params: &[Box<dyn rusqlite::ToSql>]) -> Vec<String> {
    params
        .iter()
        .map(
            |p| match p.to_sql().expect("a builder parameter is bindable") {
                rusqlite::types::ToSqlOutput::Owned(rusqlite::types::Value::Text(t)) => t,
                rusqlite::types::ToSqlOutput::Borrowed(rusqlite::types::ValueRef::Text(t)) => {
                    String::from_utf8_lossy(t).into_owned()
                }
                other => panic!("the audit builder pushes only TEXT parameters, got {other:?}"),
            },
        )
        .collect()
}

/// The columns the assembled WHERE actually predicates on.
///
/// Read from `where_sql`, because the healthy and defective plans are
/// byte-identical and only the WHERE tells them apart. EVERY identifier that is
/// immediately followed by a comparison operator or `IN` is collected - not a
/// hand-maintained list - so a predicate a future edit adds is picked up without
/// editing this function. That matters twice over: the first version listed four
/// columns by hand and silently missed `target_type`, and the second tokenised
/// the WHERE in a way that threw the operator away, so `outcome = ?1` produced an
/// empty list. Both made the falsification test pass for the wrong reason.
fn predicate_columns(where_sql: &str) -> Vec<&str> {
    let bytes = where_sql.as_bytes();
    let mut found: Vec<&str> = Vec::new();
    let is_ident = |b: u8| b.is_ascii_alphanumeric() || b == b'_';
    let mut i = 0usize;
    while i < bytes.len() {
        if !is_ident(bytes[i]) || (i > 0 && is_ident(bytes[i - 1])) {
            i += 1;
            continue;
        }
        let start = i;
        while i < bytes.len() && is_ident(bytes[i]) {
            i += 1;
        }
        let word = &where_sql[start..i];
        if matches!(word, "WHERE" | "AND" | "OR" | "NOT") {
            continue;
        }
        let rest = where_sql[i..].trim_start();
        let operator = rest.split_whitespace().next().unwrap_or("");
        // Equality, range and IN are compared against an INDEX'S OWN ORDER. LIKE
        // is not: no ordinary index serves a substring test, so a LIKE arm never
        // makes the planner pick that column's index, and treating one as an
        // indexed predicate produced a false positive on the search clause
        // (`user_id LIKE ?` read as an equality on user_id, and the whole query
        // was then graded as a masked full read).
        let is_comparison = rest.starts_with('=')
            || rest.starts_with('<')
            || rest.starts_with('>')
            || operator.eq_ignore_ascii_case("IN");
        if is_comparison {
            found.push(word);
        }
    }
    found
}
/// The plan step that reads `audit_log` in FULL, if any.
///
/// A step IS a full read when
///
/// * it is a bare `SCAN audit_log` - no index at all; or
/// * it walks a COVERING index - every row is still visited; or
/// * it walks a non-covering index WHILE some predicate names a column that has
///   a leading index the plan does not use (the O-M69 shape), or a column that
///   has NO index at all (a genuinely unindexed filter, which the walk can only
///   test row by row).
///
/// The two clauses of the last arm are the same defect measured two ways: the
/// planner has a predicate it cannot serve and falls back to reading everything
/// the ordered walk passes over. `LOAD_BEARING_INDEXES` names the columns whose
/// index exists in the schema; a column absent from it has no index to use.
fn scans_in_full<'a>(plan: &'a str, predicate_columns: &[&str]) -> Option<&'a str> {
    plan.lines().find(|line| {
        let l = line.trim();
        if !l.starts_with("SCAN audit_log") {
            return false;
        }
        if l.contains("USING COVERING INDEX") {
            return true;
        }
        if !l.contains("USING") {
            return true;
        }
        predicate_columns.iter().any(|column| {
            match LOAD_BEARING_INDEXES.iter().find(|(c, _)| c == column) {
                // A filterable column WITH an index: a full read unless the plan
                // actually uses that index.
                Some((_, index)) => !plan.contains(index),
                // No index on this column at all: the walk cannot serve it.
                None => true,
            }
        })
    })
}
/// Grade the shapes against a connection and return the offenders, formatted
/// for a failure message.
fn grade_shapes(conn: &Connection) -> Vec<String> {
    let mut offenders: Vec<String> = Vec::new();
    for (label, shape) in SHAPES {
        for cursor in [None, Some(CURSOR)] {
            let page = match cursor {
                None => "FIRST page (no cursor)",
                Some(_) => "keyset page (cursor)",
            };
            let (where_sql, params, idx) =
                build_audit_where(shape.0, shape.1, shape.2, shape.3, shape.4, shape.5, cursor);
            let sql = page_sql(&where_sql, idx);
            let mut binds = builder_binds(&params);
            binds.push("51".to_owned());
            let plan = run_plan(conn, &sql, &binds);
            let columns = predicate_columns(&where_sql);
            if let Some(step) = scans_in_full(&plan, &columns) {
                offenders.push(format!(
                    "  [{page}] {label}\n    WHERE:{where_sql}\n    predicates on: {columns:?}\n    reads in full: {step}\n    plan:\n{plan}\n"
                ));
            }
        }
    }
    offenders
}

/// THE GATE. No call shape of `build_audit_where` may read `audit_log` in
/// full, on the FIRST page or on a keyset page.
#[test]
fn audit_where_combinations_never_read_audit_log_in_full() {
    let conn = seeded_audit_connection();

    let rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM audit_log", [], |r| r.get(0))
        .expect("counting the seeded audit_log");
    assert!(
        rows >= SEED_ROWS,
        "audit_log holds {rows} rows after seeding, expected {SEED_ROWS}; a plan assertion over a thin table is vacuous",
    );
    let has_index: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?1",
            rusqlite::params![OUTCOME_INDEX],
            |r| r.get(0),
        )
        .expect("looking up the O-M69 index");
    assert_eq!(
        has_index, 1,
        "{OUTCOME_INDEX} is missing from the migrated schema; the outcome shapes would then be graded against a schema the product does not ship",
    );

    let offenders = grade_shapes(&conn);
    let graded = SHAPES.len() * 2;
    assert!(
        offenders.is_empty(),
        "{count} of {graded} graded audit page(s) read audit_log in full:\n\n{body}",
        count = offenders.len(),
        body = offenders.join("\n"),
    );
}

/// The blank predicates collapse onto shapes graded above: the builder TRIMS
/// outcome/query/actor and drops a blank one, and an empty actions allow-list
/// becomes the literal `1 = 0`.
///
/// Asserting the collapse rather than planning it keeps the curated table free
/// of near-duplicates while still pinning the behaviour: if the builder ever
/// stops dropping a blank filter, this fails and the new text gets graded.
#[test]
fn blank_predicates_collapse_onto_the_unfiltered_shape() {
    let (unfiltered, _, _) = build_audit_where(None, None, None, None, None, None, None);
    assert_eq!(unfiltered, "", "no predicate must assemble no WHERE at all");

    let (blank, blank_params, _) =
        build_audit_where(Some("  "), Some(""), None, Some(""), None, None, None);
    assert_eq!(
        blank, unfiltered,
        "a blank outcome/query/actor must be DROPPED, not bound to an empty string"
    );
    assert!(
        blank_params.is_empty(),
        "a dropped predicate must contribute no parameter"
    );

    let (empty_actions, params, idx) =
        build_audit_where(None, None, Some(&[]), None, None, None, None);
    assert_eq!(
        empty_actions, " WHERE 1 = 0",
        "an EMPTY actions allow-list must fail closed, never dump the log"
    );
    assert!(params.is_empty());
    assert_eq!(idx, 1, "a fail-closed allow-list binds nothing");
}
/// FALSIFICATION 1 - the O-M69 defect itself, reproduced by dropping the index
/// the migration added.
///
/// This is the proof that the gate above can fail. It drops
/// `idx_audit_log_outcome_created` inside the test's own in-memory database
/// (nothing on disk changes) and requires the SAME detector the gate uses to
/// report `audit_log` for the outcome-filtered FIRST page - for BOTH outcome
/// values.
///
/// It also pins WHY the gate grades both page shapes: the measured first-page
/// plan is
///
///   SCAN audit_log USING INDEX idx_audit_log_created_at
///   USE TEMP B-TREE FOR RIGHT PART OF ORDER BY
///
/// while the CURSOR page still seeks `created_at`, so a probe that only
/// checked the cursor would stay green while every user who opened the screen
/// read the whole log.
#[test]
fn dropping_the_outcome_index_fails_this_probe() {
    let conn = seeded_audit_connection();
    conn.execute_batch(&format!("DROP INDEX {OUTCOME_INDEX}"))
        .expect("dropping the O-M69 index inside the scratch database");

    let mut first_page_plans: Vec<String> = Vec::new();
    let mut cursor_plans: Vec<String> = Vec::new();
    for outcome in ["success", "failure"] {
        let (first_where, first_params, first_idx) =
            build_audit_where(Some(outcome), None, None, None, None, None, None);
        let first_sql = page_sql(&first_where, first_idx);
        let mut binds = builder_binds(&first_params);
        binds.push("51".to_owned());
        let plan = run_plan(&conn, &first_sql, &binds);
        let columns = predicate_columns(&first_where);
        assert!(
            scans_in_full(&plan, &columns).is_some(),
            "outcome = {outcome}, FIRST page: with {OUTCOME_INDEX} dropped this did not register as a full read, so the detector is blind and the gate cannot fail; plan:\n{plan}"
        );
        first_page_plans.push(format!("outcome = {outcome}, FIRST page:\n{plan}"));

        let (cursor_where, cursor_params, cursor_idx) =
            build_audit_where(Some(outcome), None, None, None, None, None, Some(CURSOR));
        let cursor_sql = page_sql(&cursor_where, cursor_idx);
        let mut binds = builder_binds(&cursor_params);
        binds.push("51".to_owned());
        cursor_plans.push(format!(
            "outcome = {outcome}, CURSOR page:\n{}",
            run_plan(&conn, &cursor_sql, &binds)
        ));
    }

    assert_eq!(first_page_plans.len(), 2, "both outcome values are graded");
    // The mask, measured: with the outcome index gone the CURSOR page still
    // seeks created_at, which is exactly the shape a cursor-only probe would
    // have called healthy.
    for plan in &cursor_plans {
        assert!(
            plan.contains("idx_audit_log_created_at"),
            "the cursor page no longer seeks created_at; the measured contrast this test documents has changed:\n{plan}"
        );
    }
}

/// FALSIFICATION 2 - a NEW dynamic predicate that reads the table in full.
///
/// The gate enumerates the shapes of `build_audit_where` as it exists today.
/// A future predicate would be added to that builder and graded by nobody. This
/// proves the gate WOULD catch it: an unindexed predicate is appended to the
/// REAL builder's output - at exactly the place a new
/// `where_clauses.push(..)` would land - and the gate's own detector must
/// report a full read.
///
/// # Why every shape is tried with the predicate ALONE as well
///
/// The first version of this test appended the predicate to every shape and
/// demanded a catch. It then FAILED to catch the whole idea: with
/// `outcome = ?1 AND details LIKE ?` the plan stays
/// `SEARCH audit_log USING INDEX idx_audit_log_outcome_created` - the
/// outcome index serves the outcome predicate and SQLite filters `details`
/// row by row. That is a correct plan, not a table read, so the detector was
/// right to stay quiet; the TEST was wrong to assume a scanning plan.
///
/// The lesson generalises into the assertion below: an indexed sibling can MASK
/// an unindexed predicate, so the proof pins each column ON ITS OWN, where
/// nothing can serve it. The masked shapes are then graded by the same rule the
/// gate uses, so a shape that legitimately stays healthy cannot make this test
/// fail for the right answer.
///
/// The column is `target_type`, MEASURED as having no usable access path:
/// `audit_log` carries `idx_audit_log_target(target_type, target_id)`
/// and `idx_audit_log_action(action)`, and neither serves a `target_type`
/// equality under an `ORDER BY created_at DESC, id DESC`. Measured plan:
///
///   SCAN audit_log USING INDEX idx_audit_log_created_at
///   USE TEMP B-TREE FOR RIGHT PART OF ORDER BY
///
/// `target_id` was the first candidate and had to be dropped: it DOES have
/// a path through `idx_audit_log_target` (a skip-scan on
/// `ANY(target_type)`), so a proof built on it would have been about
/// nothing. `details` and `target_type` are the columns with no
/// path at all.
#[test]
fn a_new_unindexed_predicate_is_caught_by_this_gate() {
    let conn = seeded_audit_connection();

    // STAGE 1 - the predicate ALONE, where no indexed sibling can mask it.
    let alone = " WHERE target_type = ?1";
    let alone_sql = page_sql(alone, 2);
    let alone_plan = run_plan(&conn, &alone_sql, &["sale".to_owned(), "51".to_owned()]);
    let alone_columns = predicate_columns(alone);
    assert_eq!(
        alone_columns,
        vec!["target_type"],
        "the classifier must see `target_type = ?1` as a predicate; if it does not, the detector is blind to the column the rest of this test is about"
    );
    let alone_hit = scans_in_full(&alone_plan, &alone_columns);
    assert!(
        alone_hit.is_some(),
        "an unindexed predicate on its own did NOT register as a full read; the gate cannot see a new dynamic predicate; plan:\n{alone_plan}"
    );
    assert!(
        alone_hit.is_some_and(|step| step.contains("SCAN audit_log")),
        "the caught plan must name audit_log plainly, got: {alone_hit:?}"
    );

    // STAGE 2 - the same predicate ADDED to each real shape, graded by the gate's
    // own rule. Some shapes legitimately stay healthy (an indexed sibling serves
    // them); the masked ones are recorded, not demanded, because demanding them
    // would assert a cost model rather than a code property.
    let mut masked: Vec<&str> = Vec::new();
    let mut caught = 0usize;
    for (label, shape) in SHAPES {
        let (where_sql, params, idx) =
            build_audit_where(shape.0, shape.1, shape.2, shape.3, shape.4, shape.5, None);
        let mutated = if where_sql.is_empty() {
            format!(" WHERE target_type = ?{idx}")
        } else {
            format!("{where_sql} AND target_type = ?{idx}")
        };
        let sql = page_sql(&mutated, idx + 1);
        let mut binds = builder_binds(&params);
        binds.push("sale".to_owned());
        binds.push("51".to_owned());
        let plan = run_plan(&conn, &sql, &binds);
        let columns = predicate_columns(&mutated);
        assert!(
            columns.contains(&"target_type"),
            "{label}: the added predicate is missing from the classifier's output {columns:?}"
        );
        if scans_in_full(&plan, &columns).is_some() {
            caught += 1;
        } else {
            masked.push(label);
        }
    }
    assert!(
        caught >= 1,
        "adding an unindexed predicate to EVERY shape produced no catch at all; the gate is blind to a new dynamic predicate"
    );
    assert!(
        caught + masked.len() == SHAPES.len(),
        "every shape must be classified exactly once"
    );
}

/// The SECURITY-EVENTS page - the eight-action `SECURITY_ACTIONS` allow-list
/// over a realistic log - stays seekable on BOTH page shapes.
///
/// This became a real assertion only after the fixture was corrected. It was
/// first written as an `#[ignore]`d "recorded, not graded" measurement because
/// the page planned `SCAN audit_log USING INDEX idx_audit_log_created_at` - and
/// that was the FIXTURE, not the query: the seed put 40% of the log in security
/// events, so eight index seeks genuinely lost to one ordered walk. On a log
/// where security events are 1 in 100 - what a merchant's log looks like - the
/// same query plans
///
///   SEARCH audit_log USING INDEX idx_audit_log_action (action=?)
///
/// for both pages. An ignored test is a silent hole, so this one is graded.
#[test]
fn security_events_page_is_seekable_on_both_page_shapes() {
    let conn = seeded_audit_connection();
    let mut plans: Vec<(String, String)> = Vec::new();
    for (label, cursor) in [("FIRST page", None), ("keyset page", Some(CURSOR))] {
        let (where_sql, params, idx) =
            build_audit_where(None, None, Some(SECURITY_ACTIONS), None, None, None, cursor);
        let sql = page_sql(&where_sql, idx);
        let mut binds = builder_binds(&params);
        binds.push("51".to_owned());
        let plan = run_plan(&conn, &sql, &binds);
        plans.push((label.to_owned(), plan));
    }
    for (label, plan) in &plans {
        let columns = predicate_columns(" WHERE action IN (?1)");
        assert!(
            scans_in_full(plan, &columns).is_none(),
            "security-events {label} reads audit_log in full; plan:\n{plan}"
        );
        assert!(
            plan.contains("idx_audit_log_action"),
            "security-events {label} no longer uses idx_audit_log_action; plan:\n{plan}"
        );
    }
}
