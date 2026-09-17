use super::*;

// ADR #49: this suite's local `run_upsert` copy needs `Store` and `ResetPeriod`,
// which the parent used to import and no longer does now that the doors delegate.
// A `#[path]` test module inherits the parent's imports through `use super::*`, so
// removing them there broke the build here; the fix is to import them here rather
// than to keep dead imports above.
use kasirmu_core::db::Store;
use kasirmu_core::db::fiscal::ResetPeriod;

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
    let conn = kasirmu_core::migrations::fresh_db();
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
    let conn = kasirmu_core::migrations::fresh_db();
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
    let conn = kasirmu_core::migrations::fresh_db();
    let err = run_upsert(&conn, &upsert_args(SEEDED_ENTITY, "invoice", 0, "weekly")).unwrap_err();
    match err {
        AppError::Core { message, .. } => {
            assert!(message.contains("reset_period"), "got: {message}");
        }
        other => panic!("expected typed validation, got {other:?}"),
    }
}

#[test]
fn negative_padding_is_refused() {
    let conn = kasirmu_core::migrations::fresh_db();
    assert!(run_upsert(&conn, &upsert_args(SEEDED_ENTITY, "invoice", -1, "never")).is_err());
}

#[test]
fn unconfigured_entity_kind_reads_none() {
    let conn = kasirmu_core::migrations::fresh_db();
    let store = Store::new(&conn);
    assert!(
        store
            .document_number_sequence("ent-x", "receipt")
            .unwrap()
            .is_none()
    );
}

/// The sync business logic both fiscal commands wrap (extracted so tests
/// exercise the exact production path).
fn run_upsert(
    conn: &rusqlite::Connection,
    args: &UpsertDocumentNumberSequenceArgs,
) -> Result<(), AppError> {
    let store = Store::new(conn);
    let reset_period = ResetPeriod::parse(&args.reset_period)?;
    store.upsert_document_number_sequence(
        &args.legal_entity_id,
        &args.document_kind,
        &args.prefix,
        reset_period,
        args.padding,
        &chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    )?;
    Ok(())
}
