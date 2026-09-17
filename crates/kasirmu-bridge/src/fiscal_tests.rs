//! Unit tests for the fiscal command bodies (Wave-A test relocation: moved
//! out of `apps/desktop-tauri/src/commands/fiscal_tests.rs`).
//!
//! Mounted at the foot of `fiscal.rs` with `#[cfg(test)] #[path]`, so
//! `use super::*` resolves `Store`, `run_upsert` and the write DTO. The desktop
//! file carried its own test-local `run_upsert` helper because the shell's
//! command body was not reachable headlessly; the bridge now exposes the real
//! `run_upsert` (and owns the RFC-3339 stamp itself), so every case below calls
//! the production function directly and the duplicate helper is gone. Database
//! handles come from the crate's own `testing::temp_conn` harness rather than
//! a direct `migrations::fresh_db` call — the same fully-migrated in-memory
//! database, reached through the shared seam.

use super::*;
use crate::testing::temp_conn;

fn upsert_args(
    entity: &str,
    kind: &str,
    padding: i64,
    reset: &str,
) -> UpsertDocumentNumberSequenceArgs {
    UpsertDocumentNumberSequenceArgs {
        legal_entity_id: entity.into(),
        document_kind: kind.into(),
        prefix: "INV/".into(),
        reset_period: reset.into(),
        padding,
    }
}

/// The entity id migration 20260908 seeds for the 'default' tenant — the
/// table's FK to legal_entities refuses any other value on a fresh db.
const SEEDED_ENTITY: &str = "default:default-legal-entity";

#[test]
fn upsert_then_read_round_trips_the_series() {
    let conn = temp_conn();
    let store = Store::new(&conn);
    run_upsert(&conn, &upsert_args(SEEDED_ENTITY, "invoice", 4, "yearly")).unwrap();
    let seq = store
        .document_number_sequence(SEEDED_ENTITY, "invoice")
        .unwrap()
        .expect("a configured series must read back");
    assert_eq!(seq.prefix, "INV/");
    assert_eq!(seq.current_value, 0, "upsert never touches the counter");
    assert_eq!(seq.reset_period, "yearly");
    assert_eq!(seq.padding, 4);
}

#[test]
fn upsert_twice_reconfigures_without_resetting_the_counter() {
    let conn = temp_conn();
    let store = Store::new(&conn);
    run_upsert(&conn, &upsert_args(SEEDED_ENTITY, "invoice", 4, "never")).unwrap();
    conn.execute(
        "UPDATE document_number_sequences SET current_value = 41 WHERE legal_entity_id = 'default:default-legal-entity'",
        [],
    )
    .unwrap();
    run_upsert(&conn, &upsert_args(SEEDED_ENTITY, "invoice", 2, "monthly")).unwrap();
    let seq = store
        .document_number_sequence(SEEDED_ENTITY, "invoice")
        .unwrap()
        .unwrap();
    assert_eq!(
        seq.current_value, 41,
        "reconfiguration must not gap a statutory series"
    );
    assert_eq!(seq.padding, 2);
    assert_eq!(seq.reset_period, "monthly");
}

#[test]
fn unknown_reset_period_is_refused() {
    let conn = temp_conn();
    let err = run_upsert(&conn, &upsert_args(SEEDED_ENTITY, "invoice", 0, "weekly")).unwrap_err();
    match err {
        BridgeError::Core { message, .. } => {
            assert!(message.contains("reset_period"), "got: {message}");
        }
        other => panic!("expected typed validation, got {other:?}"),
    }
}

#[test]
fn negative_padding_is_refused() {
    let conn = temp_conn();
    assert!(run_upsert(&conn, &upsert_args(SEEDED_ENTITY, "invoice", -1, "never")).is_err());
}

#[test]
fn unconfigured_entity_kind_reads_none() {
    let conn = temp_conn();
    let store = Store::new(&conn);
    assert!(
        store
            .document_number_sequence("ent-x", "receipt")
            .unwrap()
            .is_none()
    );
}
