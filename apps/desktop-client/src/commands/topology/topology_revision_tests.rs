//! ADR #46 Phase 1: topology revision history write path.
//!
//! Declared at the topology root (house pattern) so `use super::*` resolves
//! the flat namespace — including `revisions::*`, re-exported there under
//! `cfg(test)` — and `super::topology_tests::*` shares `fresh_conn`.
//!
//! The load-bearing test here is
//! [`a_rejected_save_writes_no_revision_row`]. ADR #46 §3 argues the INSERT
//! must live inside Apply's transaction rather than at the call site; that
//! argument is only real if a save that aborts leaves no row behind.

use super::topology_tests::*;
use super::*;

use crate::error::AppError;
use rusqlite::OptionalExtension;
use serde_json::Value;

fn ctx<'a>(note: &'a str, who: &'a str) -> TopologyRevisionContext<'a> {
    TopologyRevisionContext {
        change_note: note,
        published_by: who,
        workspace_creations: 1,
        workspace_updates: 2,
        workspace_archives: 3,
    }
}

fn store_node(id: &str) -> Value {
    serde_json::json!({ "id": id, "type": "store", "name": "Store", "x": 0.0, "y": 0.0 })
}

fn revision_count(conn: &rusqlite::Connection) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM topology_revisions WHERE branch_id = ''",
        [],
        |r| r.get(0),
    )
    .unwrap()
}

fn save(
    conn: &rusqlite::Connection,
    nodes: Vec<Value>,
    expected: Option<u64>,
    context: Option<&TopologyRevisionContext<'_>>,
) -> Result<u64, AppError> {
    save_topology_json_at_key_with_revision(
        conn,
        nodes,
        vec![],
        TOPOLOGY_SETTING_KEY,
        &[],
        expected,
        None,
        None,
        context,
    )
}

#[test]
fn an_apply_records_exactly_one_immutable_revision_row() {
    let conn = fresh_conn();
    let context = ctx("opened the warehouse feed", "user-rina");

    save(&conn, vec![store_node("store-1")], Some(0), Some(&context)).unwrap();

    assert_eq!(revision_count(&conn), 1);
    let (revision, note, who, creations, updates, archives, pinned): (
        i64,
        String,
        String,
        i64,
        i64,
        i64,
        i64,
    ) = conn
        .query_row(
            "SELECT revision, change_note, published_by,
                    workspace_creations, workspace_updates, workspace_archives, pinned
             FROM topology_revisions WHERE branch_id = ''",
            [],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                ))
            },
        )
        .unwrap();

    assert_eq!(revision, 1);
    assert_eq!(note, "opened the warehouse feed");
    assert_eq!(who, "user-rina");
    // ADR #46 §2: the workspace diff is recorded as COUNTS, so a history row
    // can say "this Apply archived 3 workspaces" without copying their rows.
    assert_eq!((creations, updates, archives), (1, 2, 3));
    // Pinning is a Phase 2 UI action; every row enters unpinned.
    assert_eq!(pinned, 0);
}

#[test]
fn revision_rows_track_the_envelope_counter_with_no_gaps() {
    let conn = fresh_conn();
    let context = ctx("", "user-a");

    for expected in 0..3u64 {
        let got = save(
            &conn,
            vec![store_node("store-1")],
            Some(expected),
            Some(&context),
        )
        .unwrap();
        assert_eq!(got, expected + 1);
    }

    let revisions: Vec<i64> = conn
        .prepare("SELECT revision FROM topology_revisions WHERE branch_id = '' ORDER BY revision")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    // Apply is the ONLY production write path that bumps `revision` — the plain
    // `save_topology` command is cfg(test) — so the row numbers must be exactly
    // the envelope numbers. A gap here means a second write path appeared.
    assert_eq!(revisions, vec![1, 2, 3]);
}

#[test]
fn the_stored_diagram_is_byte_identical_to_the_envelope() {
    let conn = fresh_conn();
    let context = ctx("self-contained", "user-a");

    let revision = save(&conn, vec![store_node("store-1")], Some(0), Some(&context)).unwrap();

    // ADR #46 §2: a revision must be restorable without reconstruction, so the
    // row holds the same bytes `settings` holds — not a projection of them.
    let envelope = oz_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY)
        .unwrap()
        .expect("envelope written");
    let stored: String = conn
        .query_row(
            "SELECT diagram FROM topology_revisions WHERE branch_id = '' AND revision = ?1",
            rusqlite::params![revision as i64],
            |r| r.get(0),
        )
        .unwrap();

    assert_eq!(stored, envelope);
    assert!(stored.contains("\"revision\":1"));
}

#[test]
fn a_rejected_save_writes_no_revision_row() {
    let conn = fresh_conn();
    let context = ctx("never published", "user-a");

    // Stale writer: the envelope is at revision 0, this claims 999.
    let err = save(
        &conn,
        vec![store_node("store-1")],
        Some(999),
        Some(&context),
    );
    assert!(err.is_err(), "a stale writer must be rejected");

    // THE §3 CLAIM. If the INSERT sat at the Apply call site instead of inside
    // this transaction, a row would exist for a deploy that never happened —
    // and it would squat the revision number the next real Apply needs.
    assert_eq!(revision_count(&conn), 0);
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM topology_revisions", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0,
        "no branch may hold a row for a rejected Apply"
    );
}

#[test]
fn the_unscoped_graph_is_recorded_under_empty_string_not_null() {
    let conn = fresh_conn();
    let context = ctx("", "user-a");

    save(&conn, vec![store_node("store-1")], Some(0), Some(&context)).unwrap();

    // `branch_id` is NOT NULL DEFAULT '' and the unscoped legacy path must land
    // there. UNIQUE ignores NULLs in both SQLite and Postgres, so a NULL here
    // would let the unscoped graph store one revision number twice.
    let stored_branch: Option<String> = conn
        .query_row(
            "SELECT branch_id FROM topology_revisions WHERE revision = 1",
            [],
            |r| r.get(0),
        )
        .optional()
        .unwrap();
    assert_eq!(stored_branch.as_deref(), Some(""));
}

#[test]
fn branch_scoped_applies_do_not_share_a_revision_sequence() {
    let conn = fresh_conn();
    let context = ctx("", "user-a");
    let key_a = format!("{TOPOLOGY_SETTING_KEY}/branch-a");
    let key_b = format!("{TOPOLOGY_SETTING_KEY}/branch-b");

    for key in [&key_a, &key_b, &key_a] {
        save_topology_json_at_key_with_revision(
            &conn,
            vec![store_node("store-1")],
            vec![],
            key,
            &[],
            None,
            None,
            None,
            Some(&context),
        )
        .unwrap();
    }

    let rows_for_branch = |branch_id: &str| {
        conn.query_row(
            "SELECT COUNT(*) FROM topology_revisions WHERE branch_id = ?1",
            rusqlite::params![branch_id],
            |r| r.get::<_, i64>(0),
        )
        .unwrap()
    };
    // Per-location ownership (todo-global-saas-1.md:186): each branch has its
    // own sequence, and branch-a reaching revision 2 must not collide with
    // branch-b's revision 1 under UNIQUE (branch_id, revision).
    assert_eq!(
        (rows_for_branch("branch-a"), rows_for_branch("branch-b")),
        (2, 1)
    );
}

#[test]
fn contract_schema_version_is_stamped_from_the_shared_constant() {
    let conn = fresh_conn();
    let context = ctx("", "user-a");

    save(&conn, vec![store_node("store-1")], Some(0), Some(&context)).unwrap();

    // Read against ONE declaration rather than a copy that can drift: the
    // constant is owned by oz_core, where the evaluator that understands it
    // lives. This is the axis ADR #46 §7 asks about — NOT the envelope's own
    // `schema_version`, which model.rs:273-285 warns must never be conflated
    // with it.
    let stamped: i64 = conn
        .query_row(
            "SELECT contract_schema_version FROM topology_revisions WHERE branch_id = ''",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        stamped as u64,
        oz_core::topology::TOPOLOGY_CONTRACT_SCHEMA_VERSION
    );
}

#[test]
fn a_save_without_a_context_records_no_row() {
    let conn = fresh_conn();

    // The cfg(test) save helper is not a publish, so it must not pollute the
    // deploy history while still bumping the envelope counter.
    save(&conn, vec![store_node("store-1")], Some(0), None).unwrap();

    assert_eq!(revision_count(&conn), 0);
    assert_eq!(
        current_topology_revision(&conn, TOPOLOGY_SETTING_KEY).unwrap(),
        1
    );
}

// ── ADR #46 §4: the retention sweep ────────────────────────────

/// Apply `n` times through the real write path, returning the revision numbers.
fn apply_n_times(conn: &rusqlite::Connection, n: u64) {
    let context = ctx("note", "user-sweep");
    for expected in 0..n {
        save(
            conn,
            vec![store_node("store-1")],
            Some(expected),
            Some(&context),
        )
        .unwrap();
    }
}

fn restorable_count(conn: &rusqlite::Connection, branch_id: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM topology_revisions
         WHERE branch_id = ?1 AND diagram IS NOT NULL",
        rusqlite::params![branch_id],
        |r| r.get(0),
    )
    .unwrap()
}

fn sweep(conn: &rusqlite::Connection, keep: usize) -> usize {
    cleanup_old_topology_revisions(conn, keep).unwrap()
}

#[test]
fn the_sweep_deflates_beyond_the_budget_but_keeps_the_record() {
    let conn = fresh_conn();
    apply_n_times(&conn, 25);

    assert_eq!(sweep(&conn, 20), 5, "the 5 oldest snapshots go");
    assert_eq!(restorable_count(&conn, ""), 20);

    // THE POINT OF DEFLATION. The row survives with who/when/why intact, so
    // "what happened here?" stays answerable forever while "can I restore
    // this?" is bounded. If this query returns no row, the sweep deleted
    // history instead of pruning it, and §4's read-vs-restore split is gone.
    let (note, who, archives): (String, String, i64) = conn
        .query_row(
            "SELECT change_note, published_by, workspace_archives
             FROM topology_revisions WHERE branch_id = '' AND revision = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(
        (note.as_str(), who.as_str(), archives),
        ("note", "user-sweep", 3)
    );

    // ...and that row is explicitly NOT restorable.
    let diagram: Option<String> = conn
        .query_row(
            "SELECT diagram FROM topology_revisions WHERE branch_id = '' AND revision = 1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(diagram.is_none(), "revision 1 must be record-only");
}

#[test]
fn a_branch_inside_its_budget_is_untouched() {
    let conn = fresh_conn();
    apply_n_times(&conn, 20);

    assert_eq!(sweep(&conn, 20), 0);
    assert_eq!(restorable_count(&conn, ""), 20);
}

#[test]
fn pinned_revisions_survive_and_do_not_consume_the_budget() {
    let conn = fresh_conn();
    apply_n_times(&conn, 25);

    // Pin the three OLDEST. They are excluded from the unpinned ranking, so the
    // 20-slot budget still holds 20 and the pins are additive: 23 restorable.
    conn.execute(
        "UPDATE topology_revisions SET pinned = 1
         WHERE branch_id = '' AND revision <= 3",
        [],
    )
    .unwrap();

    assert_eq!(
        sweep(&conn, 20),
        2,
        "only revs 4 and 5 fall out of the window"
    );
    assert_eq!(restorable_count(&conn, ""), 23);
    let pinned_still_there: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM topology_revisions
             WHERE branch_id = '' AND pinned = 1 AND diagram IS NOT NULL",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(pinned_still_there, 3, "a pin is never deflated");
}

#[test]
fn the_sweep_is_idempotent() {
    let conn = fresh_conn();
    apply_n_times(&conn, 25);

    assert_eq!(sweep(&conn, 20), 5);
    // The `diagram IS NOT NULL` guard makes a re-run a no-op, which is what
    // lets the sweep skip a transaction: a partway failure finishes next tick.
    assert_eq!(sweep(&conn, 20), 0);
    assert_eq!(restorable_count(&conn, ""), 20);
}

#[test]
fn the_sweep_prunes_each_branch_against_its_own_budget() {
    let conn = fresh_conn();
    let context = ctx("", "user-a");
    for branch in ["branch-a", "branch-b"] {
        let key = format!("{TOPOLOGY_SETTING_KEY}/{branch}");
        for expected in 0..25u64 {
            save_topology_json_at_key_with_revision(
                &conn,
                vec![store_node("store-1")],
                vec![],
                &key,
                &[],
                Some(expected),
                None,
                None,
                Some(&context),
            )
            .unwrap();
        }
    }

    // Both branches are over budget, so one pass must handle both — the sweep
    // enumerates branches rather than assuming a single graph.
    assert_eq!(sweep(&conn, 20), 10);
    assert_eq!(restorable_count(&conn, "branch-a"), 20);
    assert_eq!(restorable_count(&conn, "branch-b"), 20);
}

// ── ADR #46 §6: the audit record ───────────────────────────────

fn audit_rows(conn: &rusqlite::Connection) -> Vec<(String, String, Option<String>, String)> {
    oz_core::Store::new(conn)
        .list_audit_entries(50, 0)
        .unwrap()
        .into_iter()
        .map(|e| (e.action, e.user_id, e.target_id, e.details))
        .collect()
}

#[test]
fn the_audit_record_describes_the_apply() {
    let store_db = oz_core::migrations::fresh_db();
    let context = ctx("wired the second kitchen screen", "user-rina");

    audit_topology_apply(&store_db, "branch-a", 7, 12, 9, &context).unwrap();

    let rows = audit_rows(&store_db);
    assert_eq!(rows.len(), 1);
    let (action, who, target, details) = &rows[0];
    // `domain.action`, matching "sale.completed" / "system.export".
    assert_eq!(action, "topology.apply");
    assert_eq!(who, "user-rina");
    // target_id is the BRANCH, so the audit screen's entity filter can find
    // every change to one branch's graph.
    assert_eq!(target.as_deref(), Some("branch-a"));

    let parsed: Value = serde_json::from_str(details).unwrap();
    assert_eq!(parsed["revision"], 7);
    assert_eq!(parsed["change_note"], "wired the second kitchen screen");
    assert_eq!(parsed["nodes"], 12);
    assert_eq!(parsed["wires"], 9);
    assert_eq!(parsed["workspace_creations"], 1);
    assert_eq!(parsed["workspace_updates"], 2);
    assert_eq!(parsed["workspace_archives"], 3);
}

#[test]
fn no_audit_detail_key_collides_with_the_redaction_list() {
    let store_db = oz_core::migrations::fresh_db();
    // log_audit sanitises `details` by matching KEY NAMES against
    // SENSITIVE_DETAIL_KEYS (db/audit.rs:16-37), which contains `pin`,
    // `token`, `secret`, `password`. Topology has PIN-pad hardware nodes, so
    // a key named `pin` here would be silently blanked forever.
    //
    // This pins the whole payload: every key must come back non-null. If a
    // future field is added under a sensitive name, this fails instead of
    // quietly losing data.
    let context = ctx("note", "user-a");
    audit_topology_apply(&store_db, "", 1, 3, 2, &context).unwrap();

    let details = &audit_rows(&store_db)[0].3;
    let parsed: Value = serde_json::from_str(details).unwrap();
    for key in [
        "branch_id",
        "revision",
        "change_note",
        "nodes",
        "wires",
        "workspace_creations",
        "workspace_updates",
        "workspace_archives",
    ] {
        assert!(
            parsed.get(key).is_some_and(|v| !v.is_null()),
            "`{key}` was redacted or dropped — its name collides with \
             SENSITIVE_DETAIL_KEYS, or the payload shape changed"
        );
    }

    // The complementary limit, recorded as a test because it is a decision
    // rather than an accident: redaction matches KEYS, never VALUES, so a
    // merchant who types a secret into the free-text note stores it verbatim.
    let leaky = ctx("reset the back register password to hunter2", "user-a");
    audit_topology_apply(&store_db, "", 2, 3, 2, &leaky).unwrap();
    let details = &audit_rows(&store_db)[0].3;
    assert!(
        details.contains("hunter2"),
        "change_note is free text and is NOT value-scanned by design (ADR #46 §6)"
    );
}

#[test]
fn the_unscoped_graph_is_audited_under_an_empty_target_id() {
    let store_db = oz_core::migrations::fresh_db();
    let context = ctx("", "user-a");

    audit_topology_apply(&store_db, "", 1, 1, 0, &context).unwrap();

    // Same "" convention as the revision row, so the two records agree about
    // which graph they describe.
    assert_eq!(audit_rows(&store_db)[0].2.as_deref(), Some(""));
}
