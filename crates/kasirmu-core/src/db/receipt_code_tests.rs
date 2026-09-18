//! Tests for the entity index allocator (receipt hierarchy code).

use super::*;
use crate::db::Store;
use crate::migrations;

fn store() -> Store<'static> {
    let conn = migrations::fresh_db();
    let conn: &'static rusqlite::Connection = Box::leak(Box::new(conn));
    Store::new(conn)
}

const NOW: &str = "2026-09-18T10:15:00.000Z";

/// `entity_index_cursors.next_value` means "the next id to hand out".
fn seed_cursor(tx: &rusqlite::Transaction<'_>, kind: &str, next_value: i64) {
    tx.execute(
        "INSERT INTO entity_index_cursors (tenant_id, entity_kind, next_value, updated_at)
         VALUES ('default', ?1, ?2, ?3)",
        params![kind, next_value, NOW],
    )
    .unwrap();
}

#[test]
fn allocation_starts_at_one_and_increments() {
    let s = store();
    let tx = s.conn.unchecked_transaction().unwrap();
    for expected in 1..=3 {
        assert_eq!(
            s.allocate_entity_index(&tx, "default", EntityIndexKind::Location, NOW)
                .unwrap(),
            expected
        );
    }
}

#[test]
fn allocation_is_scoped_per_tenant() {
    let s = store();
    let tx = s.conn.unchecked_transaction().unwrap();
    // Two tenants both start at 1 — an index id is only meaningful inside
    // its own tenant, which is why the code carries no tenant segment.
    assert_eq!(
        s.allocate_entity_index(&tx, "tenant-a", EntityIndexKind::Terminal, NOW)
            .unwrap(),
        1
    );
    assert_eq!(
        s.allocate_entity_index(&tx, "tenant-b", EntityIndexKind::Terminal, NOW)
            .unwrap(),
        1
    );
    assert_eq!(
        s.allocate_entity_index(&tx, "tenant-a", EntityIndexKind::Terminal, NOW)
            .unwrap(),
        2
    );
}

#[test]
fn allocation_is_scoped_per_kind() {
    let s = store();
    let tx = s.conn.unchecked_transaction().unwrap();
    assert_eq!(
        s.allocate_entity_index(&tx, "default", EntityIndexKind::Location, NOW)
            .unwrap(),
        1
    );
    assert_eq!(
        s.allocate_entity_index(&tx, "default", EntityIndexKind::Terminal, NOW)
            .unwrap(),
        1
    );
    assert_eq!(
        s.allocate_entity_index(&tx, "default", EntityIndexKind::User, NOW)
            .unwrap(),
        1
    );
    assert_eq!(
        s.allocate_entity_index(&tx, "default", EntityIndexKind::Location, NOW)
            .unwrap(),
        2
    );
}

#[test]
fn retiring_an_index_does_not_free_it() {
    let s = store();
    let tx = s.conn.unchecked_transaction().unwrap();
    let issued: Vec<i64> = (0..3)
        .map(|_| {
            s.allocate_entity_index(&tx, "default", EntityIndexKind::Location, NOW)
                .unwrap()
        })
        .collect();
    assert_eq!(issued, vec![1, 2, 3]);

    // Retiring 2 must not make 2 available again: a reissued 02 would
    // silently redirect every historic receipt that names it.
    s.retire_entity_index(
        &tx,
        "default",
        EntityIndexKind::Location,
        2,
        "loc-2",
        "Branch 2",
        NOW,
    )
    .unwrap();
    assert_eq!(
        s.allocate_entity_index(&tx, "default", EntityIndexKind::Location, NOW)
            .unwrap(),
        4
    );
}

#[test]
fn the_last_valid_index_is_0xff_and_the_next_one_refuses() {
    let s = store();
    let tx = s.conn.unchecked_transaction().unwrap();
    seed_cursor(&tx, "location", 255);

    assert_eq!(
        s.allocate_entity_index(&tx, "default", EntityIndexKind::Location, NOW)
            .unwrap(),
        INDEX_ID_MAX
    );
    let err = s
        .allocate_entity_index(&tx, "default", EntityIndexKind::Location, NOW)
        .unwrap_err();
    assert!(
        err.to_string().contains("exhausted"),
        "unexpected error: {err}"
    );
}

#[test]
fn a_refused_allocation_consumes_nothing_once_rolled_back() {
    let s = store();
    {
        let tx = s.conn.unchecked_transaction().unwrap();
        seed_cursor(&tx, "location", 255);
        assert_eq!(
            s.allocate_entity_index(&tx, "default", EntityIndexKind::Location, NOW)
                .unwrap(),
            INDEX_ID_MAX
        );
        assert!(
            s.allocate_entity_index(&tx, "default", EntityIndexKind::Location, NOW)
                .is_err()
        );
    } // dropped without commit — rolled back

    // The refusal must not have burned an id: a fresh allocation starts
    // over from 1 rather than continuing past the ceiling.
    let tx = s.conn.unchecked_transaction().unwrap();
    assert_eq!(
        s.allocate_entity_index(&tx, "default", EntityIndexKind::Location, NOW)
            .unwrap(),
        1
    );
}

#[test]
fn tombstone_records_what_a_retired_index_was() {
    let s = store();
    let tx = s.conn.unchecked_transaction().unwrap();
    s.retire_entity_index(
        &tx,
        "default",
        EntityIndexKind::User,
        7,
        "user-7",
        "Budi",
        NOW,
    )
    .unwrap();
    tx.commit().unwrap();

    assert_eq!(
        s.retired_entity_label("default", EntityIndexKind::User, 7)
            .unwrap()
            .as_deref(),
        Some("Budi")
    );
    assert_eq!(
        s.retired_entity_label("default", EntityIndexKind::User, 8)
            .unwrap(),
        None
    );
}

#[test]
fn index_hex_renders_two_uppercase_digits() {
    assert_eq!(index_hex(INDEX_ID_NONE), "00");
    assert_eq!(index_hex(1), "01");
    assert_eq!(index_hex(10), "0A");
    assert_eq!(index_hex(INDEX_ID_MAX), "FF");
}
