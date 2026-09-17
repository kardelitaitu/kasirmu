use super::*;
use crate::migrations;
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn seed(conn: &Connection) {
    conn.execute_batch(
        "INSERT INTO suppliers (id, code, name, contact_person, phone, email, address, tax_id, payment_terms, notes, status, created_at, updated_at) VALUES
            ('sup-1', 'SUP001', 'Acme Corp',  'John Doe',  '+1-555-0101', 'john@acme.com',  '123 Main St', 'TAX-001', 'Net 30', 'Preferred', 'active', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
            ('sup-2', 'SUP002', 'Beta Ltd',   'Jane Smith','+1-555-0102', 'jane@beta.com',  '456 Oak Ave', 'TAX-002', 'Net 15', '',         'active', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
            ('sup-3', 'SUP003', 'Gamma Inc',  '',           '',            '',               '',           '',       '',       '',         'inactive', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');"
    ).unwrap();
}

#[test]
fn list_empty() {
    let conn = fresh();
    let list = store(&conn).list_suppliers().unwrap();
    assert!(list.is_empty());
}

#[test]
fn list_all() {
    let conn = fresh();
    seed(&conn);
    let list = store(&conn).list_suppliers().unwrap();
    assert_eq!(list.len(), 3);
}

#[test]
fn get_found() {
    let conn = fresh();
    seed(&conn);
    let s = store(&conn).get_supplier("sup-1").unwrap().unwrap();
    assert_eq!(s.name, "Acme Corp");
    assert_eq!(s.code, "SUP001");
}

#[test]
fn get_not_found() {
    let conn = fresh();
    let s = store(&conn).get_supplier("nope").unwrap();
    assert!(s.is_none());
}

#[test]
fn create_minimal() {
    let conn = fresh();
    let s = store(&conn)
        .create_supplier("SUP010", "New Co", "", "", "", "", "", "", "")
        .unwrap();
    assert_eq!(s.name, "New Co");
    assert_eq!(s.code, "SUP010");
}

#[test]
fn create_empty_name() {
    let conn = fresh();
    let err = store(&conn)
        .create_supplier("SUP010", "", "", "", "", "", "", "", "")
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field: "name", .. }));
}

#[test]
fn update_basic() {
    let conn = fresh();
    seed(&conn);
    let updated = store(&conn)
        .update_supplier(
            "sup-1",
            "SUP001",
            "Acme Updated",
            "John",
            "",
            "",
            "",
            "",
            "",
            "",
            "active",
        )
        .unwrap();
    assert_eq!(updated.name, "Acme Updated");
}

#[test]
fn update_not_found() {
    let conn = fresh();
    let err = store(&conn)
        .update_supplier("nope", "C", "X", "", "", "", "", "", "", "", "active")
        .unwrap_err();
    assert!(matches!(err, CoreError::NotFound { .. }));
}

#[test]
fn delete_removes() {
    let conn = fresh();
    seed(&conn);
    store(&conn).delete_supplier("sup-1").unwrap();
    assert!(store(&conn).get_supplier("sup-1").unwrap().is_none());
}

#[test]
fn delete_not_found() {
    let conn = fresh();
    let err = store(&conn).delete_supplier("nope").unwrap_err();
    assert!(matches!(err, CoreError::NotFound { .. }));
}

#[test]
fn supplier_full_crud_lifecycle() {
    let conn = fresh();
    let s = store(&conn);

    // Create
    let created = s
        .create_supplier(
            "SUP100",
            "Lifecycle Co",
            "Alice",
            "555-0100",
            "alice@test.com",
            "789 Pine St",
            "TAX-100",
            "Net 60",
            "First order",
        )
        .unwrap();
    assert_eq!(created.name, "Lifecycle Co");
    assert_eq!(created.status, "active");
    let sid = created.id.clone();

    // Get
    let fetched = s.get_supplier(&sid).unwrap().unwrap();
    assert_eq!(fetched.name, "Lifecycle Co");

    // Update
    let updated = s
        .update_supplier(
            &sid,
            "SUP100",
            "Lifecycle Updated",
            "Alice",
            "555-0100",
            "alice@test.com",
            "789 Pine St",
            "TAX-100",
            "Net 60",
            "Updated notes",
            "active",
        )
        .unwrap();
    assert_eq!(updated.name, "Lifecycle Updated");

    // Get again — verify update persisted
    let refetched = s.get_supplier(&sid).unwrap().unwrap();
    assert_eq!(refetched.name, "Lifecycle Updated");

    // Delete
    s.delete_supplier(&sid).unwrap();
    assert!(s.get_supplier(&sid).unwrap().is_none());
}

#[test]
fn supplier_empty_code_rejected() {
    let conn = fresh();
    let err = store(&conn)
        .create_supplier("  ", "Valid Name", "", "", "", "", "", "", "")
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field: "code", .. }));
}

#[test]
fn supplier_update_status_to_inactive() {
    let conn = fresh();
    let s = store(&conn);

    let created = s
        .create_supplier("SUP200", "Status Co", "", "", "", "", "", "", "")
        .unwrap();
    assert_eq!(created.status, "active");

    let updated = s
        .update_supplier(
            &created.id,
            "SUP200",
            "Status Co",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "inactive",
        )
        .unwrap();
    assert_eq!(updated.status, "inactive");
}

#[test]
fn supplier_create_with_all_fields() {
    let conn = fresh();
    let s = store(&conn);

    let supplier = s
        .create_supplier(
            "SUP300",
            "Full Co",
            "Bob Smith",
            "+62-812-3456",
            "bob@full.com",
            "Jl. Merdeka No. 1",
            "ID-123456",
            "Net 30",
            "Preferred partner",
        )
        .unwrap();
    assert_eq!(supplier.code, "SUP300");
    assert_eq!(supplier.name, "Full Co");
    assert_eq!(supplier.contact_person, "Bob Smith");
    assert_eq!(supplier.phone, "+62-812-3456");
    assert_eq!(supplier.email, "bob@full.com");
    assert_eq!(supplier.address, "Jl. Merdeka No. 1");
    assert_eq!(supplier.tax_id, "ID-123456");
    assert_eq!(supplier.payment_terms, "Net 30");
    assert_eq!(supplier.notes, "Preferred partner");
    assert_eq!(supplier.status, "active");
    assert!(!supplier.created_at.is_empty());
}

#[test]
fn supplier_list_ordered_by_name() {
    let conn = fresh();
    let s = store(&conn);

    s.create_supplier("C", "Charlie Co", "", "", "", "", "", "", "")
        .unwrap();
    s.create_supplier("A", "Alpha Inc", "", "", "", "", "", "", "")
        .unwrap();
    s.create_supplier("B", "Beta Ltd", "", "", "", "", "", "", "")
        .unwrap();

    let list = s.list_suppliers().unwrap();
    assert_eq!(list.len(), 3);
    assert_eq!(list[0].name, "Alpha Inc");
    assert_eq!(list[1].name, "Beta Ltd");
    assert_eq!(list[2].name, "Charlie Co");
}

// ── Additional edge cases (coverage expansion) ──────────────────

#[test]
fn supplier_update_empty_name_rejected() {
    let conn = fresh();
    let s = store(&conn);

    let created = s
        .create_supplier("SUP400", "Valid Co", "", "", "", "", "", "", "")
        .unwrap();

    let err = s
        .update_supplier(
            &created.id,
            "SUP400",
            "", // empty name
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "active",
        )
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field: "name", .. }));
}

#[test]
fn supplier_update_empty_code_rejected() {
    let conn = fresh();
    let s = store(&conn);

    let created = s
        .create_supplier("SUP401", "Valid Co", "", "", "", "", "", "", "")
        .unwrap();

    let err = s
        .update_supplier(
            &created.id,
            "  ", // empty code after trim
            "Valid Co",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "active",
        )
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field: "code", .. }));
}

#[test]
fn supplier_special_chars_in_contact() {
    let conn = fresh();
    let s = store(&conn);

    // Unicode, emoji, international characters in contact fields
    let supplier = s
        .create_supplier(
            "SUP-UNI",
            "Usaha Sejahtera 🌟",
            "Sari Dewi à la carte",
            "+62-821-2345-6789 ☎",
            "sari@usaha.sejahtera.id",
            "Jl. カフェ No. 5, 北区",
            "ID-PKP-123.456",
            "Net 30",
            "Предпочтение",
        )
        .unwrap();
    assert_eq!(supplier.name, "Usaha Sejahtera 🌟");
    assert_eq!(supplier.contact_person, "Sari Dewi à la carte");
    assert_eq!(supplier.phone, "+62-821-2345-6789 ☎");
    assert_eq!(supplier.email, "sari@usaha.sejahtera.id");
    assert_eq!(supplier.address, "Jl. カフェ No. 5, 北区");
    assert_eq!(supplier.tax_id, "ID-PKP-123.456");
}

#[test]
fn supplier_very_long_notes() {
    let conn = fresh();
    let s = store(&conn);

    // 1000-char notes field
    let long_notes = "x".repeat(1000);
    let supplier = s
        .create_supplier(
            "SUP-LONG",
            "Long Notes Co",
            "",
            "",
            "",
            "",
            "",
            "",
            &long_notes,
        )
        .unwrap();
    assert_eq!(supplier.notes.len(), 1000);

    // Round-trip
    let fetched = s.get_supplier(&supplier.id).unwrap().unwrap();
    assert_eq!(fetched.notes.len(), 1000);
}

#[test]
fn supplier_update_preserves_unchanged_fields() {
    let conn = fresh();
    let s = store(&conn);

    let created = s
        .create_supplier(
            "SUP500",
            "Original Co",
            "Alice",
            "555-0100",
            "alice@orig.com",
            "123 Main",
            "TAX-500",
            "Net 30",
            "First",
        )
        .unwrap();

    // Update only the name, keep everything else
    let updated = s
        .update_supplier(
            &created.id,
            "SUP500",
            "Updated Co",
            "Alice",          // same
            "555-0100",       // same
            "alice@orig.com", // same
            "123 Main",       // same
            "TAX-500",        // same
            "Net 30",         // same
            "First",          // same
            "active",
        )
        .unwrap();
    assert_eq!(updated.name, "Updated Co");
    assert_eq!(updated.contact_person, "Alice");
    assert_eq!(updated.phone, "555-0100");
    assert_eq!(updated.email, "alice@orig.com");
    assert_eq!(updated.address, "123 Main");
    assert_eq!(updated.tax_id, "TAX-500");
    assert_eq!(updated.payment_terms, "Net 30");
    assert_eq!(updated.notes, "First");
}
