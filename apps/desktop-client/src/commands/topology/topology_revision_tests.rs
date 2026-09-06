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
