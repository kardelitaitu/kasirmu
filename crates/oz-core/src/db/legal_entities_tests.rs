use super::*;

fn store() -> Store<'static> {
    let conn = crate::migrations::fresh_db();
    let conn: &'static rusqlite::Connection = Box::leak(Box::new(conn));
    Store::new(conn)
}

#[test]
fn create_rejects_empty_tenant_or_name() {
    let store = store();
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
