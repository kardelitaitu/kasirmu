//! Tests for the entity index allocator (receipt hierarchy code).

use super::*;
use crate::db::Store;
use crate::migrations;

/// The caller owns the connection, so this no longer `Box::leak`s a
/// database per test to manufacture a `'static` (O-T03).
fn store(db: &rusqlite::Connection) -> Store<'_> {
    Store::new(db)
}

const NOW: &str = "2026-09-18T10:15:00.000Z";

fn insert_location(tx: &rusqlite::Transaction<'_>, tenant_id: &str, id: &str, index_id: i64) {
    tx.execute(
        "INSERT INTO locations (id, tenant_id, name, timezone, index_id, created_at, updated_at)
         VALUES (?1, ?2, ?1, 'UTC', ?3, ?4, ?4)",
        params![id, tenant_id, index_id, NOW],
    )
    .unwrap();
}

fn insert_terminal(tx: &rusqlite::Transaction<'_>, tenant_id: &str, id: &str, index_id: i64) {
    tx.execute(
        "INSERT INTO terminals (id, tenant_id, name, device_id, index_id, created_at, updated_at)
         VALUES (?1, ?2, ?1, ?1, ?3, ?4, ?4)",
        params![id, tenant_id, index_id, NOW],
    )
    .unwrap();
}

fn insert_user(tx: &rusqlite::Transaction<'_>, tenant_id: &str, id: &str, index_id: i64) {
    tx.execute(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at)
         VALUES ('role-test', 'test', 'Test', '[]', ?1, ?1)
         ON CONFLICT (id) DO NOTHING",
        params![NOW],
    )
    .unwrap();
    tx.execute(
        "INSERT INTO users (id, tenant_id, username, pin_hash, display_name, role_id, index_id, is_active, created_at, updated_at)
         VALUES (?1, ?2, ?1, 'hash', ?1, 'role-test', ?3, 1, ?4, ?4)",
        params![id, tenant_id, index_id, NOW],
    )
    .unwrap();
}

#[test]
fn allocation_starts_at_one_and_increments() {
    let s_db = migrations::fresh_db();
    let s = store(&s_db);
    let tx = s.conn.unchecked_transaction().unwrap();
    for expected in 1..=3 {
        let idx = s
            .allocate_entity_index(&tx, "default", EntityIndexKind::Location, NOW)
            .unwrap();
        assert_eq!(idx, expected);
        insert_location(&tx, "default", &format!("loc-{expected}"), idx);
    }
}

#[test]
fn allocation_is_scoped_per_tenant() {
    let s_db = migrations::fresh_db();
    let s = store(&s_db);
    let tx = s.conn.unchecked_transaction().unwrap();
    // Two tenants both start at 1 — an index id is only meaningful inside
    // its own tenant, which is why the code carries no tenant segment.
    let a1 = s
        .allocate_entity_index(&tx, "tenant-a", EntityIndexKind::Terminal, NOW)
        .unwrap();
    assert_eq!(a1, 1);
    insert_terminal(&tx, "tenant-a", "term-a1", a1);

    let b1 = s
        .allocate_entity_index(&tx, "tenant-b", EntityIndexKind::Terminal, NOW)
        .unwrap();
    assert_eq!(b1, 1);
    insert_terminal(&tx, "tenant-b", "term-b1", b1);

    let a2 = s
        .allocate_entity_index(&tx, "tenant-a", EntityIndexKind::Terminal, NOW)
        .unwrap();
    assert_eq!(a2, 2);
}

#[test]
fn allocation_is_scoped_per_kind() {
    let s_db = migrations::fresh_db();
    let s = store(&s_db);
    let tx = s.conn.unchecked_transaction().unwrap();
    let loc1 = s
        .allocate_entity_index(&tx, "default", EntityIndexKind::Location, NOW)
        .unwrap();
    assert_eq!(loc1, 1);
    insert_location(&tx, "default", "loc-1", loc1);

    let term1 = s
        .allocate_entity_index(&tx, "default", EntityIndexKind::Terminal, NOW)
        .unwrap();
    assert_eq!(term1, 1);
    insert_terminal(&tx, "default", "term-1", term1);

    let user1 = s
        .allocate_entity_index(&tx, "default", EntityIndexKind::User, NOW)
        .unwrap();
    assert_eq!(user1, 1);
    insert_user(&tx, "default", "user-1", user1);

    let loc2 = s
        .allocate_entity_index(&tx, "default", EntityIndexKind::Location, NOW)
        .unwrap();
    assert_eq!(loc2, 2);
}

#[test]
fn slot_recycling_reclaims_gaps_from_deleted_entities() {
    let s_db = migrations::fresh_db();
    let s = store(&s_db);
    let tx = s.conn.unchecked_transaction().unwrap();

    // 1. Locations: allocate 1, 2, 3
    insert_location(&tx, "default", "loc-1", 1);
    insert_location(&tx, "default", "loc-2", 2);
    insert_location(&tx, "default", "loc-3", 3);

    // Delete location 2 -> gap at 2
    tx.execute("DELETE FROM locations WHERE id = 'loc-2'", [])
        .unwrap();
    let recycled = s
        .allocate_entity_index(&tx, "default", EntityIndexKind::Location, NOW)
        .unwrap();
    assert_eq!(recycled, 2, "slot 2 must be reclaimed for location");
    insert_location(&tx, "default", "loc-2b", recycled);

    // Next is 4
    let next = s
        .allocate_entity_index(&tx, "default", EntityIndexKind::Location, NOW)
        .unwrap();
    assert_eq!(next, 4);

    // 2. Terminals: delete terminal 1 -> gap at 1
    insert_terminal(&tx, "default", "term-1", 1);
    insert_terminal(&tx, "default", "term-2", 2);
    tx.execute("DELETE FROM terminals WHERE id = 'term-1'", [])
        .unwrap();
    let recycled_term = s
        .allocate_entity_index(&tx, "default", EntityIndexKind::Terminal, NOW)
        .unwrap();
    assert_eq!(recycled_term, 1, "slot 1 must be reclaimed for terminal");

    // 3. Users: soft-delete clears index_id and sets deleted_at
    insert_user(&tx, "default", "user-1", 1);
    insert_user(&tx, "default", "user-2", 2);
    tx.execute(
        "UPDATE users SET deleted_at = ?1, index_id = NULL WHERE id = 'user-1'",
        params![NOW],
    )
    .unwrap();
    let recycled_user = s
        .allocate_entity_index(&tx, "default", EntityIndexKind::User, NOW)
        .unwrap();
    assert_eq!(
        recycled_user, 1,
        "slot 1 must be reclaimed for user after soft-delete"
    );
}

#[test]
fn the_last_valid_index_is_max_and_the_next_one_refuses() {
    let s_db = migrations::fresh_db();
    let s = store(&s_db);
    let tx = s.conn.unchecked_transaction().unwrap();

    let idx1 = Store::allocate_entity_index_with_ceiling(&tx, "default", EntityIndexKind::Location, NOW, 2)
        .unwrap();
    assert_eq!(idx1, 1);
    insert_location(&tx, "default", "loc-1", idx1);

    let idx2 = Store::allocate_entity_index_with_ceiling(&tx, "default", EntityIndexKind::Location, NOW, 2)
        .unwrap();
    assert_eq!(idx2, 2);
    insert_location(&tx, "default", "loc-2", idx2);

    let err = Store::allocate_entity_index_with_ceiling(&tx, "default", EntityIndexKind::Location, NOW, 2)
        .unwrap_err();
    assert!(
        err.to_string().contains("exhausted"),
        "unexpected error: {err}"
    );
}

#[test]
fn a_refused_allocation_consumes_nothing_once_rolled_back() {
    let s_db = migrations::fresh_db();
    let s = store(&s_db);
    {
        let tx = s.conn.unchecked_transaction().unwrap();
        insert_location(&tx, "default", "loc-1", 1);
        assert!(
            Store::allocate_entity_index_with_ceiling(&tx, "default", EntityIndexKind::Location, NOW, 1)
                .is_err()
        );
    } // dropped without commit — rolled back

    // The refusal rolled back, leaving table clean
    let tx = s.conn.unchecked_transaction().unwrap();
    assert_eq!(
        s.allocate_entity_index(&tx, "default", EntityIndexKind::Location, NOW)
            .unwrap(),
        1
    );
}

#[test]
fn tombstone_records_what_a_retired_index_was() {
    let s_db = migrations::fresh_db();
    let s = store(&s_db);
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
    let s_db = migrations::fresh_db();
    let s = store(&s_db);
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
    let s_db = migrations::fresh_db();
    let s = store(&s_db);
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
    let s_db = migrations::fresh_db();
    let s = store(&s_db);
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
    let s_db = migrations::fresh_db();
    let s = store(&s_db);
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
fn assemble_renders_dynamic_widths() {
    // 22-char format: standard 2-character indices
    let code_22 = assemble_receipt_code(1, 2, "260929", 1, 123);
    assert_eq!(code_22, "01-02-260929-01-000123");
    assert_eq!(code_22.len(), 22);

    // 23-char format: 3-character staff index (3844 = "100")
    let code_23 = assemble_receipt_code(1, 2, "260929", 3844, 123);
    assert_eq!(code_23, "01-02-260929-100-000123");
    assert_eq!(code_23.len(), 23);

    // 24-char format: 4-character staff index (238328 = "1000")
    let code_24 = assemble_receipt_code(1, 2, "260929", 238328, 123);
    assert_eq!(code_24, "01-02-260929-1000-000123");
    assert_eq!(code_24.len(), 24);

    // 28-char format: all 4-character max indices (14,776,335 = "ZZZZ")
    let code_28 =
        assemble_receipt_code(INDEX_ID_MAX, INDEX_ID_MAX, "260929", INDEX_ID_MAX, 999_999);
    assert_eq!(code_28, "ZZZZ-ZZZZ-260929-ZZZZ-999999");
    assert_eq!(code_28.len(), 28);
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
    // MSL-29: an IANA name now RESOLVES rather than falling to UTC. This line
    // used to assert `260918` (the UTC fallback), which is exactly the divergence
    // MSL-29 fixed: `tz_modifier` bucketed this instant as the 19th in Jakarta
    // while the receipt printed the 18th. The unknown-name fallback is still UTC
    // and is asserted in `resolve_receipt_date_resolves_iana_zone_names_like_the_reports_path`.
    let (yymmdd_jakarta, _) = resolve_receipt_date("2026-09-18T23:30:00Z", "Asia/Jakarta").unwrap();
    assert_eq!(yymmdd_jakarta, "260919");
}

/// MSL-29: `resolve_receipt_date` must resolve the SAME zone vocabulary its
/// documented mirror does.
///
/// `tz_modifier` (`reports/datetime.rs:120-130`) states the contract: `timezone`
/// holds `'+HH:MM'` / `'-HH:MM'` / `'UTC'` / **an IANA zone name** — the last
/// resolved through `crate::timezone::offset_for_zone`, so reports and the tax
/// path agree on the business day. `resolve_receipt_date` uses `offset_seconds`,
/// which parses only the NUMERIC forms: an IANA name is "a value core cannot
/// interpret" and falls to UTC.
///
/// That makes the two paths disagree on the same stored value. A store set to
/// `Asia/Jakarta` gets reports bucketed at +07 and receipt numbers dated at +00,
/// and the date feeds BOTH the printed `yymmdd` and the `fiscal_year` that
/// selects the sequence — so the receipt can land in the wrong fiscal year with
/// no trace at all (`receipt_code.rs` contains zero `tracing::` calls, while
/// `tz_modifier` warns on its own fallback).
#[test]
fn resolve_receipt_date_resolves_iana_zone_names_like_the_reports_path() {
    // 2026-09-18T23:30:00Z is 2026-09-19 06:30 in Jakarta (+07). UTC would
    // print 260918; the reports path buckets this instant as the 19th.
    let (yymmdd, year) = resolve_receipt_date("2026-09-18T23:30:00Z", "Asia/Jakarta").unwrap();
    assert_eq!(
        yymmdd, "260919",
        "an IANA zone the reports path understands must date the receipt the same way"
    );
    assert_eq!(year, "2026");

    // And the two paths must agree for every zone the helper knows.
    for (zone, expected_day) in [
        ("Asia/Jakarta", "260919"),
        ("Asia/Makassar", "260919"), // +08
        ("Asia/Jayapura", "260919"), // +09
    ] {
        let (d, _) = resolve_receipt_date("2026-09-18T23:30:00Z", zone).unwrap();
        assert_eq!(d, expected_day, "{zone} must resolve, not fall back to UTC");
    }

    // A name NEITHER path can resolve still falls back to UTC, unchanged.
    let (utc, _) = resolve_receipt_date("2026-09-18T23:30:00Z", "Not/AZone").unwrap();
    assert_eq!(
        utc, "260918",
        "an unknown name keeps the documented UTC fallback"
    );
}

#[test]
fn base62_encoding_boundaries() {
    assert_eq!(format_base62_index(INDEX_ID_NONE), "00");
    assert_eq!(format_base62_index(-1), "00");
    assert_eq!(format_base62_index(1), "01");
    assert_eq!(format_base62_index(9), "09");
    assert_eq!(format_base62_index(10), "0a");
    assert_eq!(format_base62_index(35), "0z");
    assert_eq!(format_base62_index(36), "0A");
    assert_eq!(format_base62_index(61), "0Z");
    assert_eq!(format_base62_index(62), "10");
    assert_eq!(format_base62_index(3843), "ZZ");
    assert_eq!(format_base62_index(3844), "100");
    assert_eq!(format_base62_index(238327), "ZZZ");
    assert_eq!(format_base62_index(238328), "1000");
    assert_eq!(format_base62_index(INDEX_ID_MAX), "ZZZZ");
}

#[test]
fn base62_parsing_and_roundtrip() {
    assert_eq!(parse_base62_index("00"), Some(0));
    assert_eq!(parse_base62_index("01"), Some(1));
    assert_eq!(parse_base62_index("0a"), Some(10));
    assert_eq!(parse_base62_index("0A"), Some(36));
    assert_eq!(parse_base62_index("ZZ"), Some(3843));
    assert_eq!(parse_base62_index("100"), Some(3844));
    assert_eq!(parse_base62_index("ZZZ"), Some(238327));
    assert_eq!(parse_base62_index("1000"), Some(238328));
    assert_eq!(parse_base62_index("ZZZZ"), Some(INDEX_ID_MAX));

    // Whitespace trimming
    assert_eq!(parse_base62_index("  01  "), Some(1));

    // Invalid strings
    assert_eq!(parse_base62_index(""), None);
    assert_eq!(parse_base62_index("   "), None);
    assert_eq!(parse_base62_index("0-1"), None);
    assert_eq!(parse_base62_index("0!"), None);
    assert_eq!(parse_base62_index("10000"), None); // Exceeds INDEX_ID_MAX
    assert_eq!(parse_base62_index("ZZZZZ"), None); // 5 digits

    // Roundtrip for representative samples
    for sample in [
        0,
        1,
        10,
        61,
        62,
        3843,
        3844,
        10000,
        238327,
        238328,
        1_000_000,
        INDEX_ID_MAX,
    ] {
        let encoded = format_base62_index(sample);
        let decoded = parse_base62_index(&encoded).unwrap();
        assert_eq!(decoded, sample, "failed roundtrip for {sample}");
    }
}

#[test]
fn index_hex_renders_base62_string() {
    assert_eq!(index_hex(INDEX_ID_NONE), "00");
    assert_eq!(index_hex(1), "01");
    assert_eq!(index_hex(10), "0a");
    assert_eq!(index_hex(3843), "ZZ");
    assert_eq!(index_hex(INDEX_ID_MAX), "ZZZZ");
}

#[test]
fn eager_allocation_and_code_lookups_for_locations() {
    let s_db = migrations::fresh_db();
    let s = store(&s_db);

    let profile1 = crate::LocationProfile {
        id: "loc-1".into(),
        name: "Branch 1".into(),
        address: "Address 1".into(),
        tax_id: String::new(),
        currency: "USD".into(),
        timezone: "UTC".into(),
        is_primary: false,
        created_at: NOW.into(),
        updated_at: NOW.into(),
    };
    s.create_location_profile(&profile1).unwrap();
    assert_eq!(s.get_location_index_id("loc-1").unwrap(), Some(1));
    assert_eq!(s.get_location_code("loc-1").unwrap().as_deref(), Some("01"));

    let profile2 = crate::LocationProfile {
        id: "loc-2".into(),
        name: "Branch 2".into(),
        address: "Address 2".into(),
        tax_id: String::new(),
        currency: "USD".into(),
        timezone: "UTC".into(),
        is_primary: false,
        created_at: NOW.into(),
        updated_at: NOW.into(),
    };
    s.create_location_profile(&profile2).unwrap();
    assert_eq!(s.get_location_index_id("loc-2").unwrap(), Some(2));
    assert_eq!(s.get_location_code("loc-2").unwrap().as_deref(), Some("02"));

    // Delete loc-1 -> slot 1 is reclaimed!
    s.delete_location_profile("loc-1").unwrap();
    assert_eq!(s.get_location_index_id("loc-1").unwrap(), None);

    let profile3 = crate::LocationProfile {
        id: "loc-3".into(),
        name: "Branch 3".into(),
        address: "Address 3".into(),
        tax_id: String::new(),
        currency: "USD".into(),
        timezone: "UTC".into(),
        is_primary: false,
        created_at: NOW.into(),
        updated_at: NOW.into(),
    };
    s.create_location_profile(&profile3).unwrap();
    assert_eq!(s.get_location_index_id("loc-3").unwrap(), Some(1), "slot 1 should be recycled");
    assert_eq!(s.get_location_code("loc-3").unwrap().as_deref(), Some("01"));
}

#[test]
fn eager_allocation_and_code_lookups_for_terminals() {
    let s_db = migrations::fresh_db();
    let s = store(&s_db);

    let t1 = crate::Terminal {
        id: "term-1".into(),
        name: "Counter 1".into(),
        device_id: "dev-1".into(),
        terminal_secret: None,
        is_active: true,
        last_seen_at: None,
        metadata: None,
        created_at: NOW.into(),
        updated_at: NOW.into(),
    };
    s.create_terminal(&t1).unwrap();
    assert_eq!(s.get_terminal_index_id("term-1").unwrap(), Some(1));
    assert_eq!(s.get_terminal_code("term-1").unwrap().as_deref(), Some("01"));

    let t2 = crate::Terminal {
        id: "term-2".into(),
        name: "Counter 2".into(),
        device_id: "dev-2".into(),
        terminal_secret: None,
        is_active: true,
        last_seen_at: None,
        metadata: None,
        created_at: NOW.into(),
        updated_at: NOW.into(),
    };
    s.create_terminal(&t2).unwrap();
    assert_eq!(s.get_terminal_index_id("term-2").unwrap(), Some(2));
    assert_eq!(s.get_terminal_code("term-2").unwrap().as_deref(), Some("02"));

    // Delete term-1 -> slot 1 is reclaimed!
    s.delete_terminal("term-1").unwrap();
    assert_eq!(s.get_terminal_index_id("term-1").unwrap(), None);

    let t3 = crate::Terminal {
        id: "term-3".into(),
        name: "Counter 3".into(),
        device_id: "dev-3".into(),
        terminal_secret: None,
        is_active: true,
        last_seen_at: None,
        metadata: None,
        created_at: NOW.into(),
        updated_at: NOW.into(),
    };
    s.create_terminal(&t3).unwrap();
    assert_eq!(s.get_terminal_index_id("term-3").unwrap(), Some(1), "slot 1 should be recycled");
    assert_eq!(s.get_terminal_code("term-3").unwrap().as_deref(), Some("01"));
}

#[test]
fn eager_allocation_and_code_lookups_for_staff() {
    let s_db = migrations::fresh_db();
    let s = store(&s_db);

    s.conn.execute(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at)
         VALUES ('cashier', 'Cashier', '', '[]', ?1, ?1)",
        params![NOW],
    ).unwrap();

    let u1 = s.create_user("cashier1", "hash", "Alice", "cashier").unwrap();
    assert_eq!(s.get_user_index_id(&u1.id).unwrap(), Some(1));
    assert_eq!(s.get_staff_code(&u1.id).unwrap().as_deref(), Some("01"));

    let u2 = s.create_user("cashier2", "hash", "Bob", "cashier").unwrap();
    assert_eq!(s.get_user_index_id(&u2.id).unwrap(), Some(2));
    assert_eq!(s.get_staff_code(&u2.id).unwrap().as_deref(), Some("02"));

    s.conn
        .execute("UPDATE users SET is_active = 0 WHERE id = ?1", params![&u1.id])
        .unwrap();
    s.soft_delete_user(&u1.id).unwrap();
    assert_eq!(s.get_user_index_id(&u1.id).unwrap(), None);

    let u3 = s.create_user("cashier3", "hash", "Charlie", "cashier").unwrap();
    assert_eq!(s.get_user_index_id(&u3.id).unwrap(), Some(1), "slot 1 should be recycled");
    assert_eq!(s.get_staff_code(&u3.id).unwrap().as_deref(), Some("01"));
}
