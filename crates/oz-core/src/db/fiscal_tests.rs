//! Tests for the fiscal/numbering module (slice 5).

use super::*;
use crate::db::Store;
use crate::migrations;

fn store() -> Store<'static> {
    let conn = migrations::fresh_db();
    let conn: &'static rusqlite::Connection = Box::leak(Box::new(conn));
    Store::new(conn)
}

const NOW: &str = "2026-09-26T10:15:00.000Z";

fn seed_entity(store: &Store<'_>, entity: &str) {
    store
        .conn
        .execute(
            "INSERT INTO legal_entities (id, tenant_id, name, legal_name,
                    registration_number, tax_id, status, country_code, locale,
                    timezone, currency, created_at, updated_at)
             VALUES (?1, 'default', ?1, '', '', '', 'active', 'ID', '', '', '',
                     '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')",
            params![entity],
        )
        .unwrap();
}

fn seed_series(store: &Store<'_>, entity: &str) {
    store
        .upsert_document_number_sequence(entity, "receipt", "INV/", ResetPeriod::Monthly, 4, NOW)
        .unwrap();
}

fn seed_location(store: &Store<'_>, location_id: &str, entity: &str) {
    store
        .conn
        .execute(
            "INSERT INTO locations (id, name, address, tax_id, currency, timezone, locale,
                                    is_primary, legal_entity_id, created_at, updated_at)
             VALUES (?1, ?1, '', '', 'IDR', 'UTC', '', 0, ?2,
                     '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')",
            params![location_id, entity],
        )
        .unwrap();
}

fn seed_sale(store: &Store<'_>, sale_id: &str) {
    store
        .conn
        .execute(
            "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at)
             VALUES (?1, 1000, 'IDR', 1, 'pending', '2026-09-26T10:00:00.000Z', '2026-09-26T10:00:00.000Z')",
            params![sale_id],
        )
        .unwrap();
}

/// Entity + monthly series + linked location + a sale at that location —
/// the common claim fixture.
fn seed_claim_fixture(store: &Store<'_>, entity: &str, location_id: &str, sale_id: &str) {
    seed_entity(store, entity);
    seed_series(store, entity);
    seed_location(store, location_id, entity);
    seed_sale(store, sale_id);
}

/// Manually open a write transaction and hand its handle to the claim.
fn tx_of(store: &Store<'static>) -> rusqlite::Transaction<'static> {
    store.conn.unchecked_transaction().unwrap()
}

fn stamped_number(store: &Store<'_>, sale_id: &str) -> Option<String> {
    store
        .conn
        .query_row(
            "SELECT statutory_number FROM sales WHERE id = ?1",
            params![sale_id],
            |row| row.get(0),
        )
        .unwrap()
}

// ── scheme CRUD ──────────────────────────────────────────────────────

#[test]
fn fiscal_scheme_crud_round_trips() {
    let store = store();
    seed_entity(&store, "ent-1");
    store
        .conn
        .execute(
            "INSERT INTO fiscal_schemes (id, tenant_id, legal_entity_id, scheme_code, name,
                    parameters, is_active, created_at, updated_at)
             VALUES ('sch-1', 'default', 'ent-1', 'id-faktur-pajak', 'Faktur Pajak',
                     '{\"rate_bps\":1100}', 1, ?1, ?1)",
            params![NOW],
        )
        .unwrap();
    let count: i64 = store
        .conn
        .query_row(
            "SELECT COUNT(*) FROM fiscal_schemes WHERE legal_entity_id = 'ent-1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}

// ── sequence configuration ──────────────────────────────────────────

#[test]
fn upsert_keeps_the_counter_when_policy_is_rewritten() {
    let store = store();
    seed_claim_fixture(&store, "ent-1", "loc-1", "sale-1");
    let tx = tx_of(&store);
    store
        .claim_statutory_number_for_sale(&tx, "sale-1", "loc-1", "receipt", NOW)
        .unwrap();
    tx.commit().unwrap();

    // Policy tweak: new padding, same entity/kind. The counter must survive —
    // a policy change must never reissue numbers already spent.
    store
        .upsert_document_number_sequence("ent-1", "receipt", "INV/", ResetPeriod::Monthly, 6, NOW)
        .unwrap();
    let series = store
        .document_number_sequence("ent-1", "receipt")
        .unwrap()
        .unwrap();
    assert_eq!(series.current_value, 1);
    assert_eq!(series.padding, 6);
}

#[test]
fn upsert_rejects_negative_padding() {
    let store = store();
    let err = store
        .upsert_document_number_sequence("ent-x", "receipt", "", ResetPeriod::Never, -1, NOW)
        .unwrap_err();
    assert!(
        matches!(
            err,
            CoreError::Validation {
                field: "padding",
                ..
            }
        ),
        "got {err:?}"
    );
}

// ── the claim ────────────────────────────────────────────────────────

#[test]
fn claim_stamps_the_sale_and_returns_the_number() {
    let store = store();
    seed_claim_fixture(&store, "ent-1", "loc-1", "sale-1");
    let tx = tx_of(&store);
    let number = store
        .claim_statutory_number_for_sale(&tx, "sale-1", "loc-1", "receipt", NOW)
        .unwrap();
    tx.commit().unwrap();

    assert_eq!(number.as_deref(), Some("INV/2026-09/0001"));
    assert_eq!(
        stamped_number(&store, "sale-1").as_deref(),
        Some("INV/2026-09/0001")
    );
}

#[test]
fn sequential_claims_within_one_transaction_draw_distinct_numbers() {
    // The supervisor's note-2 sibling: two sales in the SAME transaction
    // window draw DISTINCT numbers. Both claims run on ONE transaction
    // handle — this is the in-tx property, not a two-transaction sequence.
    let store = store();
    seed_claim_fixture(&store, "ent-1", "loc-1", "sale-1");
    seed_sale(&store, "sale-2");
    let tx = tx_of(&store);
    let n1 = store
        .claim_statutory_number_for_sale(&tx, "sale-1", "loc-1", "receipt", NOW)
        .unwrap();
    let n2 = store
        .claim_statutory_number_for_sale(&tx, "sale-2", "loc-1", "receipt", NOW)
        .unwrap();
    tx.commit().unwrap();

    assert_ne!(n1, n2);
    assert_eq!(n1.as_deref(), Some("INV/2026-09/0001"));
    assert_eq!(n2.as_deref(), Some("INV/2026-09/0002"));
}

#[test]
fn period_rollover_restarts_at_one() {
    let store = store();
    seed_claim_fixture(&store, "ent-1", "loc-1", "sale-1");
    let tx = tx_of(&store);
    store
        .claim_statutory_number_for_sale(&tx, "sale-1", "loc-1", "receipt", NOW)
        .unwrap();
    tx.commit().unwrap();

    // Next month: the bucket changes, the counter restarts at 1.
    let october = "2026-10-01T09:00:00.000Z";
    seed_sale(&store, "sale-2");
    let tx = tx_of(&store);
    let n = store
        .claim_statutory_number_for_sale(&tx, "sale-2", "loc-1", "receipt", october)
        .unwrap();
    tx.commit().unwrap();
    assert_eq!(n.as_deref(), Some("INV/2026-10/0001"));
}

#[test]
fn unconfigured_entity_stamps_nothing() {
    let store = store();
    // Entity exists but has NO series: the claim is a no-op, the sale is
    // untouched — an unconfigured deployment keeps today's behavior.
    seed_entity(&store, "ent-1");
    seed_location(&store, "loc-1", "ent-1");
    seed_sale(&store, "sale-1");
    let tx = tx_of(&store);
    let n = store
        .claim_statutory_number_for_sale(&tx, "sale-1", "loc-1", "receipt", NOW)
        .unwrap();
    tx.commit().unwrap();
    assert_eq!(n, None);
    assert_eq!(stamped_number(&store, "sale-1"), None);
}

#[test]
fn unknown_location_stamps_nothing() {
    let store = store();
    let tx = tx_of(&store);
    let n = store
        .claim_statutory_number_for_sale(&tx, "sale-x", "no-such-loc", "receipt", NOW)
        .unwrap();
    tx.commit().unwrap();
    assert_eq!(n, None);
}

// ── THE KILLER TEST: rollback consumes nothing ──────────────────────

#[test]
fn rollback_of_the_sale_transaction_consumes_no_number() {
    // A failed checkout rolls its transaction back; the claim was made
    // inside that same transaction, so the counter must be untouched and
    // the next successful sale gets the number the failed one "used".
    let store = store();
    seed_claim_fixture(&store, "ent-1", "loc-1", "sale-fail");

    let tx = tx_of(&store);
    let n = store
        .claim_statutory_number_for_sale(&tx, "sale-fail", "loc-1", "receipt", NOW)
        .unwrap();
    assert_eq!(n.as_deref(), Some("INV/2026-09/0001"));
    drop(tx); // ROLLBACK — the sale fails after the claim

    let series = store
        .document_number_sequence("ent-1", "receipt")
        .unwrap()
        .unwrap();
    assert_eq!(series.current_value, 0, "rollback must restore the counter");

    // The next successful sale gets 0001 — no gap.
    seed_sale(&store, "sale-ok");
    let tx = tx_of(&store);
    let n2 = store
        .claim_statutory_number_for_sale(&tx, "sale-ok", "loc-1", "receipt", NOW)
        .unwrap();
    tx.commit().unwrap();
    assert_eq!(n2.as_deref(), Some("INV/2026-09/0001"));
}

#[test]
fn never_reset_series_carry_no_bucket_segment() {
    let store = store();
    seed_entity(&store, "ent-1");
    store
        .upsert_document_number_sequence("ent-1", "invoice", "F/", ResetPeriod::Never, 0, NOW)
        .unwrap();
    seed_location(&store, "loc-1", "ent-1");
    seed_sale(&store, "sale-1");
    let tx = tx_of(&store);
    let n = store
        .claim_statutory_number_for_sale(&tx, "sale-1", "loc-1", "invoice", NOW)
        .unwrap();
    tx.commit().unwrap();
    assert_eq!(n.as_deref(), Some("F/1"));
}

#[test]
fn reset_period_rejects_unknown_keywords() {
    let err = ResetPeriod::parse("weekly");
    assert!(matches!(err, Err(CoreError::Validation { .. })));
}

// ── management readers (W5-A — the D44 gap) ─────────────────────────

fn seed_scheme(store: &Store<'_>, id: &str, entity: &str, code: &str, active: i64) {
    store
        .conn
        .execute(
            "INSERT INTO fiscal_schemes (id, tenant_id, legal_entity_id, scheme_code, name,
                    parameters, is_active, created_at, updated_at)
             VALUES (?1, 'default', ?2, ?3, ?3, '{}', ?4, ?5, ?5)",
            params![id, entity, code, active, NOW],
        )
        .unwrap();
}

#[test]
fn list_sequences_is_empty_before_configuration() {
    let store = store();
    assert!(store.list_document_number_sequences().unwrap().is_empty());
    assert!(store.list_fiscal_schemes().unwrap().is_empty());
}

#[test]
fn list_sequences_orders_and_reports_the_live_counter() {
    let store = store();
    seed_entity(&store, "ent-1");
    store
        .upsert_document_number_sequence("ent-1", "receipt", "INV/", ResetPeriod::Monthly, 4, NOW)
        .unwrap();
    store
        .upsert_document_number_sequence("ent-1", "invoice", "F/", ResetPeriod::Never, 0, NOW)
        .unwrap();
    // Simulate an issued ordinal the way a claim would leave the row.
    store
        .conn
        .execute(
            "UPDATE document_number_sequences SET current_value = 41
             WHERE legal_entity_id = 'ent-1' AND document_kind = 'receipt'",
            [],
        )
        .unwrap();
    let list = store.list_document_number_sequences().unwrap();
    assert_eq!(list.len(), 2);
    // Stable (entity, kind) order: invoice sorts before receipt.
    assert_eq!(list[0].document_kind, "invoice");
    assert_eq!(list[1].document_kind, "receipt");
    // current_value is the LIVE counter (never resets on reconfiguration).
    assert_eq!(list[1].current_value, 41);
    assert_eq!(list[1].prefix, "INV/");
    assert_eq!(list[1].padding, 4);
}

#[test]
fn per_entity_reader_isolates_its_entity() {
    let store = store();
    seed_entity(&store, "ent-1");
    seed_entity(&store, "ent-2");
    store
        .upsert_document_number_sequence("ent-1", "receipt", "INV/", ResetPeriod::Never, 0, NOW)
        .unwrap();
    store
        .upsert_document_number_sequence("ent-2", "invoice", "B/", ResetPeriod::Yearly, 2, NOW)
        .unwrap();
    let own = store.document_number_sequences_for_entity("ent-1").unwrap();
    assert_eq!(own.len(), 1);
    assert_eq!(own[0].legal_entity_id, "ent-1");
    assert_eq!(own[0].document_kind, "receipt");
    let all = store.list_document_number_sequences().unwrap();
    assert_eq!(all.len(), 2, "tenant-wide list sees both entities");
}

#[test]
fn fiscal_scheme_reader_reports_active_and_inactive() {
    let store = store();
    seed_entity(&store, "ent-1");
    seed_scheme(&store, "sch-1", "ent-1", "id-faktur-pajak", 1);
    seed_scheme(&store, "sch-2", "ent-1", "legacy-e-faktur", 0);
    let schemes = store.list_fiscal_schemes().unwrap();
    // The overview shows the FULL configuration surface — inactive schemes
    // included; consumers filter by is_active per their contract.
    assert_eq!(schemes.len(), 2);
    assert_eq!(schemes[0].scheme_code, "id-faktur-pajak");
    assert!(schemes[0].is_active);
    assert_eq!(schemes[1].scheme_code, "legacy-e-faktur");
    assert!(!schemes[1].is_active);
    assert_eq!(schemes[0].legal_entity_id, "ent-1");
}
