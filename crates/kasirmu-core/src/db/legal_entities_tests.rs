use super::*;

/// The caller owns the connection, so this no longer `Box::leak`s a
/// database per test to manufacture a `'static` (O-T03).
fn store(db: &rusqlite::Connection) -> Store<'_> {
    Store::new(db)
}

#[test]
fn create_rejects_empty_tenant_or_name() {
    let store_db = crate::migrations::fresh_db();
    let store = store(&store_db);
    let entity = LegalEntity {
        id: "entity-invalid".into(),
        tenant_id: String::new(),
        name: "Entity".into(),
        legal_name: "Entity".into(),
        registration_number: String::new(),
        tax_id: String::new(),
        status: "active".into(),
        created_at: "2026-09-06T10:00:00Z".into(),
        updated_at: "2026-09-06T10:00:00Z".into(),
    };

    let error = store.create_legal_entity(&entity).unwrap_err();
    assert!(matches!(
        error,
        CoreError::Validation {
            field: "tenant_id",
            ..
        }
    ));
}
