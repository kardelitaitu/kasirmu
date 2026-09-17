//! Integration tests for the supplier module — CRUD lifecycle,
//! validation, and edge cases.
//!
//! Tests exercise the full persistence layer via the public
//! [`kasirmu_core::Store`] API against an in-memory SQLite database.

use kasirmu_core::{Store, migrations};
use rusqlite::Connection;

// ── Helpers ───────────────────────────────────────────────────────────

fn setup() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    migrations::run(&mut conn).unwrap();
    conn
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn seed_supplier(conn: &Connection, id: &str, code: &str, name: &str) {
    conn.execute(
        "INSERT INTO suppliers (id, code, name, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'active', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        rusqlite::params![id, code, name],
    )
    .unwrap();
}

// ── Create ────────────────────────────────────────────────────────────

#[test]
fn create_supplier_with_all_fields() {
    let conn = setup();
    let s = store(&conn);

    let sup = s
        .create_supplier(
            "SUP-001",
            "Acme Corp",
            "John Doe",
            "+1-555-0100",
            "john@acme.com",
            "123 Main St",
            "TAX-001",
            "Net 30",
            "Preferred supplier",
        )
        .unwrap();

    assert_eq!(sup.code, "SUP-001");
    assert_eq!(sup.name, "Acme Corp");
    assert_eq!(sup.contact_person, "John Doe");
    assert_eq!(sup.phone, "+1-555-0100");
    assert_eq!(sup.email, "john@acme.com");
    assert_eq!(sup.address, "123 Main St");
    assert_eq!(sup.tax_id, "TAX-001");
    assert_eq!(sup.payment_terms, "Net 30");
    assert_eq!(sup.notes, "Preferred supplier");
    assert_eq!(sup.status, "active");
    assert!(!sup.id.is_empty());
    assert!(sup.created_at.contains('T'));
}

#[test]
fn create_supplier_minimal_fields() {
    let conn = setup();
    let s = store(&conn);

    let sup = s
        .create_supplier("SUP-MIN", "Minimal Co", "", "", "", "", "", "", "")
        .unwrap();

    assert_eq!(sup.code, "SUP-MIN");
    assert_eq!(sup.name, "Minimal Co");
    assert_eq!(sup.status, "active");
    assert!(sup.contact_person.is_empty());
}

#[test]
fn create_supplier_empty_name_fails() {
    let conn = setup();
    let s = store(&conn);

    let err = s
        .create_supplier("SUP-BAD", "", "", "", "", "", "", "", "")
        .unwrap_err();
    assert!(matches!(
        err,
        kasirmu_core::CoreError::Validation { field: "name", .. }
    ));
}

#[test]
fn create_supplier_empty_code_fails() {
    let conn = setup();
    let s = store(&conn);

    let err = s
        .create_supplier("", "A Name", "", "", "", "", "", "", "")
        .unwrap_err();
    assert!(matches!(
        err,
        kasirmu_core::CoreError::Validation { field: "code", .. }
    ));
}

#[test]
fn create_supplier_trims_whitespace() {
    let conn = setup();
    let s = store(&conn);

    let sup = s
        .create_supplier(
            "  SUP-TRIM  ",
            "  Trimmed Name  ",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
        )
        .unwrap();

    assert_eq!(sup.code, "SUP-TRIM");
    assert_eq!(sup.name, "Trimmed Name");
}

// ── List & Get ───────────────────────────────────────────────────────

#[test]
fn list_suppliers_alphabetical() {
    let conn = setup();
    seed_supplier(&conn, "s1", "CODE-A", "Zeta Corp");
    seed_supplier(&conn, "s2", "CODE-B", "Alpha Inc");
    seed_supplier(&conn, "s3", "CODE-C", "Beta Ltd");

    let list = store(&conn).list_suppliers().unwrap();
    assert_eq!(list.len(), 3);
    assert_eq!(list[0].name, "Alpha Inc");
    assert_eq!(list[1].name, "Beta Ltd");
    assert_eq!(list[2].name, "Zeta Corp");
}

#[test]
fn list_empty_returns_empty_vec() {
    let conn = setup();
    let list = store(&conn).list_suppliers().unwrap();
    assert!(list.is_empty());
}

#[test]
fn get_supplier_by_id() {
    let conn = setup();
    seed_supplier(&conn, "s-get", "SUP-GET", "Get Co");

    let sup = store(&conn).get_supplier("s-get").unwrap().unwrap();
    assert_eq!(sup.code, "SUP-GET");
    assert_eq!(sup.name, "Get Co");
}

#[test]
fn get_supplier_nonexistent_returns_none() {
    let conn = setup();
    let sup = store(&conn).get_supplier("nope").unwrap();
    assert!(sup.is_none());
}

// ── Update ───────────────────────────────────────────────────────────

#[test]
fn update_supplier_changes_fields() {
    let conn = setup();
    seed_supplier(&conn, "s-upd", "SUP-OLD", "Old Name");

    let updated = store(&conn)
        .update_supplier(
            "s-upd",
            "SUP-NEW",
            "New Name",
            "Jane",
            "+62",
            "jane@test.com",
            "New Address",
            "TAX-NEW",
            "Net 15",
            "Updated notes",
            "inactive",
        )
        .unwrap();

    assert_eq!(updated.code, "SUP-NEW");
    assert_eq!(updated.name, "New Name");
    assert_eq!(updated.contact_person, "Jane");
    assert_eq!(updated.status, "inactive");
}

#[test]
fn update_supplier_not_found_fails() {
    let conn = setup();
    let err = store(&conn)
        .update_supplier("nope", "C", "X", "", "", "", "", "", "", "", "active")
        .unwrap_err();
    assert!(matches!(
        err,
        kasirmu_core::CoreError::NotFound {
            entity: "supplier",
            ..
        }
    ));
}

#[test]
fn update_supplier_empty_name_fails() {
    let conn = setup();
    seed_supplier(&conn, "s-name", "SUP-NM", "Name Co");

    let err = store(&conn)
        .update_supplier("s-name", "SUP-NM", "", "", "", "", "", "", "", "", "active")
        .unwrap_err();
    assert!(matches!(
        err,
        kasirmu_core::CoreError::Validation { field: "name", .. }
    ));
}

// ── Delete ────────────────────────────────────────────────────────────

#[test]
fn delete_supplier_removes_record() {
    let conn = setup();
    seed_supplier(&conn, "s-del", "SUP-DEL", "Delete Me");

    store(&conn).delete_supplier("s-del").unwrap();
    assert!(store(&conn).get_supplier("s-del").unwrap().is_none());
}

#[test]
fn delete_supplier_not_found_fails() {
    let conn = setup();
    let err = store(&conn).delete_supplier("nope").unwrap_err();
    assert!(matches!(
        err,
        kasirmu_core::CoreError::NotFound {
            entity: "supplier",
            ..
        }
    ));
}

// ── Persistence ──────────────────────────────────────────────────────

#[test]
fn supplier_persists_and_is_listed_after_reopen() {
    let conn = setup();
    let s = store(&conn);
    let sup = s
        .create_supplier("SUP-PERS", "Persist Co", "", "", "", "", "", "", "")
        .unwrap();

    // Verify it's in the list.
    let list = s.list_suppliers().unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, sup.id);

    // Re-lookup by id.
    let fetched = s.get_supplier(&sup.id).unwrap().unwrap();
    assert_eq!(fetched.name, "Persist Co");
}
