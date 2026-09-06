use super::*;

fn store() -> crate::db::Store<'static> {
    let conn = crate::migrations::fresh_db();
    let conn: &'static rusqlite::Connection = Box::leak(Box::new(conn));
    crate::db::Store::new(conn)
}

#[test]
fn legal_entity_roundtrips_its_business_identity() {
    let entity = LegalEntity {
        id: "entity-2".into(),
        tenant_id: "default".into(),
        name: "Second Entity".into(),
        legal_name: "Second Entity LLC".into(),
        registration_number: "REG-2".into(),
        tax_id: "TAX-2".into(),
        status: "active".into(),
        created_at: "2026-09-06T10:00:00Z".into(),
        updated_at: "2026-09-06T10:00:00Z".into(),
    };

    let store = store();
    assert_eq!(store.create_legal_entity(&entity).unwrap(), entity);
    assert_eq!(
        store.get_legal_entity("default", "entity-2").unwrap(),
        Some(entity)
    );

    let updated = store
        .update_legal_entity(
            "default",
            "entity-2",
            &UpdateLegalEntity {
                name: "Second Entity Updated".into(),
                legal_name: "Second Entity Holdings LLC".into(),
                registration_number: "REG-2A".into(),
                tax_id: "TAX-2A".into(),
                status: "active".into(),
            },
        )
        .unwrap();
    assert_eq!(updated.name, "Second Entity Updated");
    assert_eq!(updated.legal_name, "Second Entity Holdings LLC");
    assert_eq!(updated.registration_number, "REG-2A");
    assert_eq!(updated.tax_id, "TAX-2A");
}

#[test]
fn list_legal_entities_is_tenant_scoped() {
    let store = store();
    let default_entities = store.list_legal_entities("default").unwrap();
    assert_eq!(default_entities.len(), 1);
    assert_eq!(default_entities[0].name, "Default Legal Entity");
    assert!(
        store
            .list_legal_entities("tenant-without-rows")
            .unwrap()
            .is_empty()
    );
}

#[test]
fn location_assignment_rejects_cross_tenant_entity() {
    let store = store();
    let entity = LegalEntity {
        id: "tenant-2-entity".into(),
        tenant_id: "tenant-2".into(),
        name: "Tenant 2 Entity".into(),
        legal_name: "Tenant 2 Entity".into(),
        registration_number: String::new(),
        tax_id: String::new(),
        status: "active".into(),
        created_at: "2026-09-06T10:00:00Z".into(),
        updated_at: "2026-09-06T10:00:00Z".into(),
    };
    store.create_legal_entity(&entity).unwrap();

    let error = store
        .assign_location_to_legal_entity("default", "default", "tenant-2-entity")
        .unwrap_err();
    assert!(matches!(
        error,
        crate::CoreError::NotFound {
            entity: "legal_entity",
            ..
        }
    ));

    let assigned_entity: String = store
        .conn
        .query_row(
            "SELECT legal_entity_id FROM locations WHERE id = 'default'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(assigned_entity, "default:default-legal-entity");
}

#[test]
fn location_assignment_changes_entity_within_tenant() {
    let store = store();
    let entity = LegalEntity {
        id: "default-secondary".into(),
        tenant_id: "default".into(),
        name: "Secondary Entity".into(),
        legal_name: "Secondary Entity".into(),
        registration_number: String::new(),
        tax_id: String::new(),
        status: "active".into(),
        created_at: "2026-09-06T10:00:00Z".into(),
        updated_at: "2026-09-06T10:00:00Z".into(),
    };
    store.create_legal_entity(&entity).unwrap();

    store
        .assign_location_to_legal_entity("default", "default", "default-secondary")
        .unwrap();

    let assigned_entity: String = store
        .conn
        .query_row(
            "SELECT legal_entity_id FROM locations WHERE id = 'default'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(assigned_entity, "default-secondary");
}
