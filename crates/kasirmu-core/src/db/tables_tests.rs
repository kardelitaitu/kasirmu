use super::*;
use crate::migrations;
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn dummy_table(id: &str) -> Table {
    Table {
        id: id.into(),
        name: format!("Table {id}"),
        capacity: 4,
        pos_x: 10.0,
        pos_y: 20.0,
        shape: "circle".into(),
        width: 10.0,
        height: 10.0,
        status: "available".into(),
        active_sale_id: None,
        section: "Main".into(),
        active: true,
        sort_order: 0,
        created_at: String::new(),
        updated_at: String::new(),
    }
}

#[test]
fn create_and_get_table() {
    let conn = fresh();
    let s = store(&conn);
    let t = s.create_table(&dummy_table("t1")).unwrap();
    assert_eq!(t.name, "Table t1");
    assert_eq!(t.status, "available");
    let fetched = s.get_table("t1").unwrap().unwrap();
    assert_eq!(fetched.id, "t1");
}

#[test]
fn list_tables_empty() {
    let conn = fresh();
    let s = store(&conn);
    assert!(s.list_tables(None).unwrap().is_empty());
}

#[test]
fn list_tables_filters_section() {
    let conn = fresh();
    let s = store(&conn);
    let mut a = dummy_table("a");
    a.section = "Patio".into();
    let mut b = dummy_table("b");
    b.section = "Main".into();
    s.create_table(&a).unwrap();
    s.create_table(&b).unwrap();
    let patio = s.list_tables(Some("Patio")).unwrap();
    assert_eq!(patio.len(), 1);
    assert_eq!(patio[0].id, "a");
}

#[test]
fn update_table_mutates() {
    let conn = fresh();
    let s = store(&conn);
    let mut t = dummy_table("t1");
    t.name = "Original".into();
    s.create_table(&t).unwrap();
    t.name = "Updated".into();
    let updated = s.update_table(&t).unwrap();
    assert_eq!(updated.name, "Updated");
}

#[test]
fn delete_table_removes() {
    let conn = fresh();
    let s = store(&conn);
    s.create_table(&dummy_table("t1")).unwrap();
    s.delete_table("t1").unwrap();
    assert!(s.get_table("t1").unwrap().is_none());
}

#[test]
fn delete_table_not_found() {
    let conn = fresh();
    let s = store(&conn);
    let err = s.delete_table("nope").unwrap_err();
    assert!(matches!(err, CoreError::NotFound { .. }));
}

#[test]
fn update_table_status_works() {
    let conn = fresh();
    let s = store(&conn);
    s.create_table(&dummy_table("t1")).unwrap();
    // Plain status transitions (not `occupied`) work without a sale link.
    let t = s.update_table_status("t1", "cleaning").unwrap();
    assert_eq!(t.status, "cleaning");
    let t = s.update_table_status("t1", "available").unwrap();
    assert_eq!(t.status, "available");
}

// ── TBL-01: occupied requires an active sale ──────────────────

#[test]
fn occupy_without_sale_rejected() {
    let conn = fresh();
    let s = store(&conn);
    s.create_table(&dummy_table("t1")).unwrap();
    let err = s.update_table_status("t1", "occupied").unwrap_err();
    assert!(
        matches!(err, CoreError::Validation { field, message } if field == "status" && message.contains("active sale"))
    );
    // The status must be untouched after the rejection.
    let t = s.get_table("t1").unwrap().unwrap();
    assert_eq!(t.status, "available");
}

#[test]
fn occupy_with_active_sale_allowed() {
    let conn = fresh();
    let s = store(&conn);
    s.create_table(&dummy_table("t1")).unwrap();
    let cart = crate::Cart::new("USD".parse().unwrap());
    let sale = crate::Sale::from_cart(&cart).unwrap();
    s.create_sale(&sale).unwrap();
    let t = s.assign_table_order("t1", &sale.id).unwrap();
    assert_eq!(t.status, "occupied");
    // Re-asserting occupied on an already-occupied table stays valid.
    let again = s.update_table_status("t1", "occupied").unwrap();
    assert_eq!(again.status, "occupied");
    assert_eq!(again.active_sale_id, Some(sale.id.clone()));
}

#[test]
fn occupy_missing_table_returns_not_found() {
    let conn = fresh();
    let s = store(&conn);
    let err = s.update_table_status("nope", "occupied").unwrap_err();
    assert!(matches!(err, CoreError::NotFound { .. }));
}

// ── TBL-04: delete lifecycle protection ───────────────────────

#[test]
fn delete_occupied_table_rejected() {
    let conn = fresh();
    let s = store(&conn);
    s.create_table(&dummy_table("t1")).unwrap();
    let cart = crate::Cart::new("USD".parse().unwrap());
    let sale = crate::Sale::from_cart(&cart).unwrap();
    s.create_sale(&sale).unwrap();
    s.assign_table_order("t1", &sale.id).unwrap();
    let err = s.delete_table("t1").unwrap_err();
    assert!(
        matches!(err, CoreError::Validation { field, message } if field == "status" && message.contains("deactivate"))
    );
    assert!(s.get_table("t1").unwrap().is_some());
}

#[test]
fn delete_reserved_table_rejected() {
    let conn = fresh();
    let s = store(&conn);
    s.create_table(&dummy_table("t1")).unwrap();
    s.update_table_status("t1", "reserved").unwrap();
    let err = s.delete_table("t1").unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "status"));
}

#[test]
fn delete_table_with_active_sale_link_rejected() {
    let conn = fresh();
    let s = store(&conn);
    // Build the state the production way: assign a real sale, then reset
    // the status to `available` — `update_table_status` changes only the
    // status and leaves the sale link intact, yielding "not occupied or
    // reserved, but still linked to an active sale". Constructing this
    // directly with a fake sale id would trip the FK constraint at insert.
    s.create_table(&dummy_table("t1")).unwrap();
    let cart = crate::Cart::new("USD".parse().unwrap());
    let sale = crate::Sale::from_cart(&cart).unwrap();
    s.create_sale(&sale).unwrap();
    s.assign_table_order("t1", &sale.id).unwrap();
    let linked = s.update_table_status("t1", "available").unwrap();
    assert_eq!(linked.status, "available");
    assert_eq!(linked.active_sale_id, Some(sale.id.clone()));
    let err = s.delete_table("t1").unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "status"));
}

#[test]
fn delete_free_table_still_allowed() {
    let conn = fresh();
    let s = store(&conn);
    s.create_table(&dummy_table("t1")).unwrap();
    s.update_table_status("t1", "cleaning").unwrap();
    s.delete_table("t1").unwrap();
    assert!(s.get_table("t1").unwrap().is_none());
}

// ── TBL-08: geometry validation ───────────────────────────────

#[test]
fn create_table_nan_geometry_rejected() {
    let conn = fresh();
    let s = store(&conn);
    let mut t = dummy_table("t1");
    t.pos_x = f64::NAN;
    let err = s.create_table(&t).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "pos_x"));
}

#[test]
fn create_table_negative_geometry_rejected() {
    let conn = fresh();
    let s = store(&conn);
    let mut t = dummy_table("t1");
    t.pos_y = -5.0;
    let err = s.create_table(&t).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "pos_y"));
}

#[test]
fn create_table_out_of_bounds_geometry_rejected() {
    let conn = fresh();
    let s = store(&conn);
    let mut t = dummy_table("t1");
    t.width = 120.0;
    let err = s.create_table(&t).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "width"));
}

#[test]
fn create_table_tiny_geometry_rejected() {
    let conn = fresh();
    let s = store(&conn);
    let mut t = dummy_table("t1");
    t.height = 1.0;
    let err = s.create_table(&t).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "width"));
}

#[test]
fn create_table_zero_geometry_rejected() {
    let conn = fresh();
    let s = store(&conn);
    let mut t = dummy_table("t1");
    t.width = 0.0;
    let err = s.create_table(&t).unwrap_err();
    assert!(matches!(err, CoreError::Validation { .. }));
}

#[test]
fn update_table_geometry_validated() {
    let conn = fresh();
    let s = store(&conn);
    let mut t = dummy_table("t1");
    s.create_table(&t).unwrap();
    t.width = 150.0;
    let err = s.update_table(&t).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "width"));
    t.width = 10.0;
    t.height = 0.0;
    let err = s.update_table(&t).unwrap_err();
    assert!(matches!(err, CoreError::Validation { .. }));
}

#[test]
fn assign_and_release() {
    let conn = fresh();
    let s = store(&conn);
    s.create_table(&dummy_table("t1")).unwrap();
    // Create a sale to link.
    let cart = crate::Cart::new("USD".parse().unwrap());
    let sale = crate::Sale::from_cart(&cart).unwrap();
    s.create_sale(&sale).unwrap();
    let t = s.assign_table_order("t1", &sale.id).unwrap();
    assert_eq!(t.status, "occupied");
    assert_eq!(t.active_sale_id, Some(sale.id.clone()));
    let released = s.release_table("t1").unwrap();
    assert_eq!(released.status, "cleaning");
    assert!(released.active_sale_id.is_none());
}

#[test]
fn list_sections_returns_distinct() {
    let conn = fresh();
    let s = store(&conn);
    let mut a = dummy_table("a");
    a.section = "Patio".into();
    let mut b = dummy_table("b");
    b.section = "Patio".into();
    let mut c = dummy_table("c");
    c.section = "Bar".into();
    s.create_table(&a).unwrap();
    s.create_table(&b).unwrap();
    s.create_table(&c).unwrap();
    let sections = s.list_sections().unwrap();
    assert_eq!(sections.len(), 2);
    assert!(sections.contains(&"Bar".to_string()));
    assert!(sections.contains(&"Patio".to_string()));
}

#[test]
fn get_table_not_found() {
    let conn = fresh();
    let s = store(&conn);
    assert!(s.get_table("nope").unwrap().is_none());
}

// ── Additional edge-case tests ─────────────────────────────────

#[test]
fn update_table_not_found() {
    let conn = fresh();
    let s = store(&conn);
    let err = s.update_table(&dummy_table("nonexistent")).unwrap_err();
    assert!(matches!(err, CoreError::NotFound { entity, .. } if entity == "table"));
}

#[test]
fn update_table_status_not_found() {
    let conn = fresh();
    let s = store(&conn);
    let err = s.update_table_status("nope", "occupied").unwrap_err();
    assert!(matches!(err, CoreError::NotFound { .. }));
}

#[test]
fn assign_table_order_not_found() {
    let conn = fresh();
    let s = store(&conn);
    let err = s.assign_table_order("nope", "sale-1").unwrap_err();
    assert!(matches!(err, CoreError::NotFound { .. }));
}

#[test]
fn release_table_not_found() {
    let conn = fresh();
    let s = store(&conn);
    let err = s.release_table("nope").unwrap_err();
    assert!(matches!(err, CoreError::NotFound { .. }));
}

#[test]
fn create_table_with_empty_id_generates_uuid() {
    let conn = fresh();
    let s = store(&conn);
    let t = s.create_table(&dummy_table("")).unwrap();
    assert!(!t.id.is_empty());
    assert_ne!(t.id, "");
}

#[test]
fn list_tables_ordered_by_sort_order_name() {
    let conn = fresh();
    let s = store(&conn);
    let mut a = dummy_table("a");
    a.name = "Z Table".into();
    a.sort_order = 2;
    let mut b = dummy_table("b");
    b.name = "A Table".into();
    b.sort_order = 1;
    let mut c = dummy_table("c");
    c.name = "B Table".into();
    c.sort_order = 1;
    s.create_table(&a).unwrap();
    s.create_table(&b).unwrap();
    s.create_table(&c).unwrap();

    let tables = s.list_tables(None).unwrap();
    assert_eq!(tables.len(), 3);
    // ORDER BY sort_order, name: b (1,A), c (1,B), a (2,Z)
    assert_eq!(tables[0].id, "b");
    assert_eq!(tables[1].id, "c");
    assert_eq!(tables[2].id, "a");
}

#[test]
fn list_tables_excludes_inactive() {
    let conn = fresh();
    let s = store(&conn);
    let mut active = dummy_table("active");
    active.active = true;
    let mut inactive = dummy_table("inactive");
    inactive.active = false;
    s.create_table(&active).unwrap();
    s.create_table(&inactive).unwrap();

    let tables = s.list_tables(None).unwrap();
    assert_eq!(tables.len(), 1);
    assert_eq!(tables[0].id, "active");
}

#[test]
fn list_sections_excludes_empty() {
    let conn = fresh();
    let s = store(&conn);
    let mut a = dummy_table("a");
    a.section = "Main".into();
    let mut b = dummy_table("b");
    b.section = "".into();
    s.create_table(&a).unwrap();
    s.create_table(&b).unwrap();

    let sections = s.list_sections().unwrap();
    assert_eq!(sections.len(), 1);
    assert_eq!(sections[0], "Main");
}

// ── Validation tests ────────────────────────────────────────

#[test]
fn create_table_empty_name_rejected() {
    let conn = fresh();
    let s = store(&conn);
    let mut t = dummy_table("t1");
    t.name = "".into();
    let err = s.create_table(&t).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "name"));
}

#[test]
fn create_table_whitespace_name_rejected() {
    let conn = fresh();
    let s = store(&conn);
    let mut t = dummy_table("t1");
    t.name = "   ".into();
    let err = s.create_table(&t).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "name"));
}

#[test]
fn create_table_negative_capacity_rejected() {
    let conn = fresh();
    let s = store(&conn);
    let mut t = dummy_table("t1");
    t.capacity = -1;
    let err = s.create_table(&t).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "capacity"));
}

#[test]
fn update_table_empty_name_rejected() {
    let conn = fresh();
    let s = store(&conn);
    let mut t = dummy_table("t1");
    s.create_table(&t).unwrap();
    t.name = "".into();
    let err = s.update_table(&t).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "name"));
}

#[test]
fn update_table_negative_capacity_rejected() {
    let conn = fresh();
    let s = store(&conn);
    let mut t = dummy_table("t1");
    s.create_table(&t).unwrap();
    t.capacity = -5;
    let err = s.update_table(&t).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "capacity"));
}

#[test]
fn update_table_status_invalid_rejected() {
    let conn = fresh();
    let s = store(&conn);
    s.create_table(&dummy_table("t1")).unwrap();
    let err = s.update_table_status("t1", "invalid_status").unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "status"));
}
