use super::*;

#[test]
fn new_supplier() {
    let s = Supplier::new("SUP001", "Acme Corp");
    assert_eq!(s.code, "SUP001");
    assert_eq!(s.name, "Acme Corp");
    assert_eq!(s.status, "active");
}

#[test]
#[should_panic(expected = "supplier name must not be empty")]
fn new_panics_on_empty_name() {
    Supplier::new("SUP001", "   ");
}

#[test]
#[should_panic(expected = "supplier code must not be empty")]
fn new_panics_on_empty_code() {
    Supplier::new("  ", "Acme Corp");
}

#[test]
fn serde_roundtrip() {
    let s = Supplier::new("SUP001", "Acme Corp");
    let json = serde_json::to_string(&s).unwrap();
    let back: Supplier = serde_json::from_str(&json).unwrap();
    assert_eq!(back, s);
}

#[test]
fn new_generates_uuid() {
    let s = Supplier::new("SUP001", "Acme Corp");
    assert_eq!(s.id.len(), 36, "UUID v4 should be 36 chars");
    assert_eq!(
        s.id.chars().filter(|c| *c == '-').count(),
        4,
        "UUID should have 4 hyphens"
    );
}

#[test]
fn new_trims_whitespace() {
    let s = Supplier::new("  SUP002  ", "  Best Supply Inc.  ");
    assert_eq!(s.code, "SUP002");
    assert_eq!(s.name, "Best Supply Inc.");
}

#[test]
fn new_defaults_optional_fields_to_empty() {
    let s = Supplier::new("SUP001", "Acme Corp");
    assert_eq!(s.contact_person, "");
    assert_eq!(s.phone, "");
    assert_eq!(s.email, "");
    assert_eq!(s.address, "");
    assert_eq!(s.tax_id, "");
    assert_eq!(s.payment_terms, "");
    assert_eq!(s.notes, "");
}

#[test]
fn new_defaults_timestamps_to_empty() {
    let s = Supplier::new("SUP001", "Acme Corp");
    assert_eq!(s.created_at, "");
    assert_eq!(s.updated_at, "");
}

#[test]
fn debug_output() {
    let s = Supplier::new("SUP001", "Acme Corp");
    let debug = format!("{:?}", s);
    assert!(debug.contains("SUP001"));
    assert!(debug.contains("Acme Corp"));
}

#[test]
fn two_suppliers_have_different_ids() {
    let a = Supplier::new("SUP001", "Acme Corp");
    let b = Supplier::new("SUP002", "Best Supply");
    assert_ne!(
        a.id, b.id,
        "different suppliers should have different UUIDs"
    );
}

#[test]
fn equality_based_on_all_fields() {
    let a = Supplier::new("SUP001", "Acme Corp");
    let mut b = a.clone();
    b.status = "inactive".into();
    assert_ne!(a, b, "suppliers with different status should not be equal");
}
