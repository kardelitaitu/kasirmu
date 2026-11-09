//! Plan coverage for the KDS readers whose filter fragments are PUSHED AT RUN
//! TIME - the crate's third family of runtime-assembled `WHERE` clauses:
//!
//! * `Store::list_kds_orders` (`db/kds_orders.rs:99-114`) - optional
//!   ` WHERE status = ?1`;
//! * `Store::list_kds_orders_for_instance` (`db/kds_orders.rs:156-182`) -
//!   optional status fragment joined to the visibility condition by ` AND`;
//! * `Store::replay_kds_orders_since` (`db/kds_ops.rs:47-70`) - optional
//!   ` AND status = ?2` after the `received_at > ?1` seek.
//!
//! `get_kds_queue` and `get_kds_queue_for_instance` are already graded
//! (unfiltered) in `tests/integration/query_plan_probe.rs`; the unfiltered
//! branch is therefore not repeated here, and the ZONE branch - which those fixed
//! strings cannot reach - is.
//!
//! # Method: the run-time fragment is taken from the PRODUCT's source
//!
//! These methods assemble their text inside the call and never expose it, and a
//! re-typed assembly would be the drift this exercise exists to stop. So the
//! optional piece is read out of the production file itself at test time
//! (`fragment_from_source`) - the literal rustc compiles is the literal graded -
//! and it is spliced into the product's own hoisted base constants, which ARE
//! importable. `kds_fragments_are_still_where_they_are_expected` fails if a fragment
//! moves, so a reshaped branch cannot pass silently.

use crate::db::kds::kds_orders::{KDS_QUEUE_BASE_SQL, LIST_KDS_ORDERS_BASE_SQL};
use crate::migrations;
use rusqlite::Connection;

/// Rows seeded into `kds_orders`, with the status mix the integration probe
/// documents as load-bearing: a kitchen board is mostly history (90% served),
/// a small live set, a few cancelled.
const SEED_ROWS: i64 = 2_000;

fn seeded_kds_connection() -> Connection {
    let conn = migrations::fresh_db();
    {
        let tx = conn
            .unchecked_transaction()
            .expect("opening the KDS seed transaction on a migrated in-memory DB");
        // kds_orders.sale_id is NOT NULL with a foreign key to sales, and this
        // crate opens its connections with foreign keys ENFORCED - so the parent
        // sale has to exist before the ticket that points at it.
        for i in 0..SEED_ROWS {
            tx.execute(
                "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at,
                                    updated_at, payment_method, tenant_id)
                 VALUES (?1, 1000, 'MUR', 1, 'completed', ?2, ?2, 'cash', 'default')",
                rusqlite::params![
                    format!("dw-kds-sale-{i:06}"),
                    format!(
                        "2026-{:02}-{:02}T{:02}:{:02}:00.000Z",
                        (i % 12) + 1,
                        (i % 28) + 1,
                        i % 24,
                        i % 60
                    ),
                ],
            )
            .expect("seeding the sales parent for kds_orders");
        }
        for i in 0..SEED_ROWS {
            let status = match i % 20 {
                0 => "cancelled",
                1 => "pending",
                2 => "preparing",
                3 => "ready",
                _ => "served",
            };
            tx.execute(
                "INSERT INTO kds_orders (id, sale_id, status, received_at, kitchen_zone, table_number,
                                         target_instance_id, store_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, 'dw-store')",
                rusqlite::params![
                    format!("dw-kds-{i:06}"),
                    format!("dw-kds-sale-{i:06}"),
                    status,
                    format!(
                        "2026-{:02}-{:02}T{:02}:{:02}:00.000Z",
                        (i % 12) + 1,
                        (i % 28) + 1,
                        i % 24,
                        i % 60
                    ),
                    format!("zone-{}", i % 4),
                    if i % 6 == 0 {
                        None
                    } else {
                        Some("dw-instance-1".to_owned())
                    },
                ],
            )
            .expect("seeding kds_orders");
        }
        tx.commit().expect("committing the KDS seed transaction");
    }
    conn.execute_batch("ANALYZE")
        .expect("ANALYZE on the seeded database");
    conn
}

/// The workspace-relative source of the module under test.
fn source(relative: &str) -> String {
    let path = format!("{}/{relative}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("reading {path}: {e}"))
}

/// The EXACT text of the production literal containing `needle`, quotes included.
///
/// Read from source rather than re-typed: whatever rustc compiled is what gets
/// graded, and a fragment that moves or changes fails the caller's assertion
/// instead of leaving a stale copy behind.
fn fragment_from_source(file: &str, needle: &str) -> String {
    let text = source(file);
    let line = text
        .lines()
        .find(|l| l.contains(needle) && l.contains('"') && !l.trim_start().starts_with("//"))
        .unwrap_or_else(|| {
            panic!(
                "{file} no longer contains a string literal carrying {needle}; the fragment moved"
            )
        });
    let start = line
        .find('"')
        .unwrap_or_else(|| panic!("{file}: the line carrying {needle} has no literal: {line}"));
    let rest = &line[start + 1..];
    let end = rest
        .find('"')
        .unwrap_or_else(|| panic!("{file}: unterminated literal on: {line}"));
    rest[..end].to_owned()
}

/// The body of a multi-line string literal assigned on the line after `anchor`.
fn block_from_source(file: &str, anchor: &str, _end: &str) -> String {
    let text = source(file);
    let start = text
        .find(anchor)
        .unwrap_or_else(|| panic!("{file} no longer contains {anchor}; the block moved"));
    let after = &text[start + anchor.len()..];
    let open = after
        .find('"')
        .unwrap_or_else(|| panic!("{file}: {anchor} has no literal"));
    let body = &after[open + 1..];
    let close = body
        .find('"')
        .unwrap_or_else(|| panic!("{file}: {anchor} unterminated"));
    body[..close].to_owned()
}

fn plan_of(conn: &Connection, sql: &str) -> String {
    let explain = format!("EXPLAIN QUERY PLAN {sql}");
    let mut stmt = conn
        .prepare(&explain)
        .unwrap_or_else(|e| panic!("preparing the KDS plan failed: {e}\nSQL:\n{sql}"));
    // EXPLAIN must still be given every placeholder; the values themselves are
    // irrelevant to a plan, so bind the placeholder's own name.
    let mut binds: Vec<String> = (1..=stmt.parameter_count())
        .map(|n| format!("?{n}"))
        .collect();
    for n in 1..=stmt.parameter_count() {
        binds[n - 1] = "2026-06-01T00:00:00.000Z".to_owned();
    }
    let rows = stmt
        .query_map(
            rusqlite::params_from_iter(binds.iter().map(String::as_str)),
            |r| r.get::<_, String>(3),
        )
        .unwrap_or_else(|e| panic!("running the KDS plan failed: {e}\nSQL:\n{sql}"));
    rows.collect::<Result<Vec<_>, _>>()
        .unwrap_or_else(|e| panic!("reading the KDS plan failed: {e}\nSQL:\n{sql}"))
        .join("\n")
}

/// A plan step that reads its source in FULL.
fn scans_in_full(plan: &str) -> Option<&str> {
    plan.lines().find(|line| {
        let l = line.trim();
        l.starts_with("SCAN ") && (!l.contains("USING INDEX") || l.contains("USING COVERING INDEX"))
    })
}

/// The ORDER BY `list_kds_orders` always appends.
const LIST_KDS_ORDERS_ORDER_BY: &str = " ORDER BY received_at DESC";

/// The base of `replay_kds_orders_since`; the method's own literal stops at the
/// first predicate, so the probe continues it the way the product does.
const REPLAY_BASE: &str = "SELECT id, sale_id, store_id, target_instance_id, status, items_summary, item_count, display_number,
                    received_at, started_at, ready_at, served_at,
                    prep_time_seconds, kitchen_zone, notes, table_number, priority, ticket_prefix
             FROM kds_orders WHERE received_at > ?1";

/// The fragments are still in the files this module reads them from.
#[test]
fn kds_fragments_are_still_where_they_are_expected() {
    assert_eq!(
        fragment_from_source("src/db/kds_orders.rs", " WHERE status = ?1"),
        " WHERE status = ?1",
    );
    assert_eq!(
        fragment_from_source("src/db/kds_orders.rs", " AND kitchen_zone = ?1"),
        " AND kitchen_zone = ?1",
    );
    assert_eq!(
        fragment_from_source("src/db/kds_ops.rs", " AND status = ?2"),
        " AND status = ?2",
    );
}

/// `list_kds_orders`'s status branch and `list_kds_orders_for_instance`'s
/// status branch both stay seekable.
#[test]
fn list_kds_orders_status_branches_stay_seekable() {
    let conn = seeded_kds_connection();
    let status_fragment = fragment_from_source("src/db/kds_orders.rs", " WHERE status = ?1");
    let sql = format!("{LIST_KDS_ORDERS_BASE_SQL}{status_fragment}{LIST_KDS_ORDERS_ORDER_BY}");
    let plan = plan_of(&conn, &sql);
    assert!(
        scans_in_full(&plan).is_none(),
        "list_kds_orders with a status filter reads kds_orders in full; plan:\n{plan}\nSQL:\n{sql}"
    );
    assert!(
        plan.contains("idx_kds_orders_status_received"),
        "the status-filtered ticket list no longer uses idx_kds_orders_status_received; plan:\n{plan}"
    );
}

/// `replay_kds_orders_since` with and without a status filter - the offline
/// catch-up path, which runs on every KDS reconnection.
#[test]
fn replay_kds_orders_since_branches_stay_seekable() {
    let conn = seeded_kds_connection();
    let status_fragment = fragment_from_source("src/db/kds_ops.rs", " AND status = ?2");

    let without = format!("{REPLAY_BASE} ORDER BY received_at ASC");
    let with = format!("{REPLAY_BASE}{status_fragment} ORDER BY received_at ASC");
    for (label, sql) in [("no status filter", &without), ("status filter", &with)] {
        let plan = plan_of(&conn, sql);
        assert!(
            scans_in_full(&plan).is_none(),
            "replay_kds_orders_since ({label}) reads kds_orders in full; plan:\n{plan}\nSQL:\n{sql}"
        );
        assert!(
            plan.contains("received_at"),
            "replay_kds_orders_since ({label}) is no longer seeking on received_at; plan:\n{plan}"
        );
    }
}

/// `get_kds_queue`'s ZONE branch - a kitchen board filtered to one station.
///
/// The unfiltered branch is graded in the integration probe; this one cannot be,
/// because the probe's fixed string has no zone predicate.
#[test]
fn get_kds_queue_zone_branch_stays_seekable() {
    let conn = seeded_kds_connection();
    let zone_fragment = fragment_from_source("src/db/kds_orders.rs", " AND kitchen_zone = ?1");
    let unzoned_fragment = fragment_from_source(
        "src/db/kds_orders.rs",
        " AND (kitchen_zone IS NULL OR kitchen_zone = '')",
    );
    // The ORDER BY the product appends; it is private, so read it too.
    // The queue's ORDER BY is a multi-line private constant, so it is read whole
    // from source rather than quoted by one of its lines.
    let order_by = block_from_source(
        "src/db/kds_orders.rs",
        "const KDS_QUEUE_ORDER_BY: &str = ",
        "",
    );
    for (label, fragment) in [
        ("zone = ?1", zone_fragment.as_str()),
        ("no zone assigned", unzoned_fragment.as_str()),
    ] {
        let sql = format!("{KDS_QUEUE_BASE_SQL}{fragment}{order_by}");
        let plan = plan_of(&conn, &sql);
        assert!(
            scans_in_full(&plan).is_none(),
            "get_kds_queue ({label}) reads kds_orders in full; plan:\n{plan}\nSQL:\n{sql}"
        );
    }
}
