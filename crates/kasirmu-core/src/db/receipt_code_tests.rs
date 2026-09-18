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
fn claim_starts_at_one_and_increments_per_terminal_year() {
    let s = store();
    let tx = s.conn.unchecked_transaction().unwrap();
    for expected in 1..=3 {
        assert_eq!(
            s.claim_receipt_sequence(&tx, "default", "02", "2026")
                .unwrap(),
            expected
        );
    }
}

#[test]
fn claim_is_scoped_per_tenant_terminal_and_year() {
    let s = store();
    let tx = s.conn.unchecked_transaction().unwrap();
    // The same terminal index under two tenants does not share a counter.
    assert_eq!(
        s.claim_receipt_sequence(&tx, "tenant-a", "01", "2026")
            .unwrap(),
        1
    );
    assert_eq!(
        s.claim_receipt_sequence(&tx, "tenant-b", "01", "2026")
            .unwrap(),
        1
    );
    // Same tenant, two terminals, do not share either.
    assert_eq!(
        s.claim_receipt_sequence(&tx, "default", "01", "2026")
            .unwrap(),
        1
    );
    assert_eq!(
        s.claim_receipt_sequence(&tx, "default", "02", "2026")
            .unwrap(),
        1
    );
    // A new fiscal year is a fresh row (the PK carries the year), so it
    // restarts at 1 instead of continuing the previous year's tail.
    assert_eq!(
        s.claim_receipt_sequence(&tx, "default", "01", "2027")
            .unwrap(),
        1
    );
}

#[test]
fn claim_refuses_when_sequence_exceeds_max() {
    let s = store();
    let tx = s.conn.unchecked_transaction().unwrap();
    tx.execute(
        "INSERT INTO receipt_number_counters (tenant_id, terminal_idx, fiscal_year, counter)
         VALUES ('default', '01', '2026', 999999)",
        [],
    )
    .unwrap();
    // The next claim would push to 1,000,000 — beyond the 6-digit tail.
    let err = s
        .claim_receipt_sequence(&tx, "default", "01", "2026")
        .unwrap_err();
    assert!(
        err.to_string().contains("exhausted"),
        "unexpected error: {err}"
    );
}

#[test]
fn a_refused_claim_consumes_nothing_once_rolled_back() {
    let s = store();
    // Seed the exhausted counter and COMMIT it, so it survives the rollback
    // that follows.
    {
        let tx = s.conn.unchecked_transaction().unwrap();
        tx.execute(
            "INSERT INTO receipt_number_counters (tenant_id, terminal_idx, fiscal_year, counter)
             VALUES ('default', '01', '2026', 999999)",
            [],
        )
        .unwrap();
        tx.commit().unwrap();
    }
    // A claim that would overflow is refused; rolling it back must leave the
    // committed 999999 untouched — the +1 never landed.
    {
        let tx = s.conn.unchecked_transaction().unwrap();
        assert!(
            s.claim_receipt_sequence(&tx, "default", "01", "2026")
                .is_err()
        );
    } // dropped without commit — rolled back

    let tx = s.conn.unchecked_transaction().unwrap();
    let row: i64 = tx
        .query_row(
            "SELECT counter FROM receipt_number_counters
              WHERE tenant_id = 'default' AND terminal_idx = '01' AND fiscal_year = '2026'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(row, 999999);
}

#[test]
fn assemble_renders_the_agreed_22_char_format() {
    assert_eq!(
        assemble_receipt_code(1, 2, "260918", 1, 123),
        "01-02-260918-01-000123"
    );
    // Hex letters appear above 99, and the sequence is zero-padded to six.
    assert_eq!(
        assemble_receipt_code(0xFF, 0x0A, "260101", 0x00, 999_999),
        "FF-0A-260101-00-999999"
    );
}

#[test]
fn assemble_uses_00_staff_sentinel_for_system_sales() {
    // A kiosk sale (no user_id) must print 00, never a never-assigned index.
    assert_eq!(
        assemble_receipt_code(1, 2, "260918", INDEX_ID_NONE, 1),
        "01-02-260918-00-000001"
    );
}

#[test]
fn resolve_receipt_date_honours_the_location_offset() {
    // 2026-09-18T23:30:00Z is already 2026-09-19T06:30 local in UTC+7, so
    // the printed date is the location's, not UTC's.
    let (yymmdd, year) = resolve_receipt_date("2026-09-18T23:30:00Z", "+07:00").unwrap();
    assert_eq!(yymmdd, "260919");
    assert_eq!(year, "2026");
    // A negative offset also shifts the day backwards.
    let (yymmdd_west, _) = resolve_receipt_date("2026-09-18T02:30:00Z", "-05:00").unwrap();
    assert_eq!(yymmdd_west, "260917");
    // A value core cannot interpret (an IANA name) falls back to UTC.
    let (yymmdd_utc, _) = resolve_receipt_date("2026-09-18T23:30:00Z", "Asia/Jakarta").unwrap();
    assert_eq!(yymmdd_utc, "260918");
}

#[test]
fn index_hex_renders_two_uppercase_digits() {
    assert_eq!(index_hex(INDEX_ID_NONE), "00");
    assert_eq!(index_hex(1), "01");
    assert_eq!(index_hex(10), "0A");
    assert_eq!(index_hex(INDEX_ID_MAX), "FF");
}
