use super::*;
use oz_core::{PurchaseOrder, PurchaseOrderLine, PurchaseOrderWithLines, Supplier};

fn make_supplier() -> Supplier {
    Supplier {
        id: "sup-1".into(),
        code: "SUP001".into(),
        name: "Acme Corp".into(),
        contact_person: "John Doe".into(),
        phone: "+1234567890".into(),
        email: "john@acme.com".into(),
        address: "123 Main St".into(),
        tax_id: "TAX-001".into(),
        payment_terms: "NET30".into(),
        notes: String::new(),
        status: "active".into(),
        created_at: "2025-01-01T00:00:00.000Z".into(),
        updated_at: "2025-01-01T00:00:00.000Z".into(),
    }
}

fn make_po_line() -> PurchaseOrderLine {
    PurchaseOrderLine {
        id: "pol-1".into(),
        po_id: "po-1".into(),
        sku: "SKU-1".into(),
        product_name: "Widget".into(),
        qty: 10,
        unit_cost_minor: 5000,
        line_total_minor: 50000,
        received_qty: 0,
        damaged_qty: 0,
    }
}

// ── SupplierDto ─────────────────────────────────────────────────────

#[test]
fn supplier_dto_debug() {
    let dto = SupplierDto::from(make_supplier());
    let d = format!("{dto:?}");
    assert!(d.contains("Acme Corp"));
}

#[test]
fn supplier_dto_serialize() {
    let dto = SupplierDto::from(make_supplier());
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["name"], "Acme Corp");
    assert_eq!(json["status"], "active");
}

// ── PurchaseOrderLineDto ────────────────────────────────────────────

#[test]
fn purchase_order_line_dto_debug() {
    let dto = PurchaseOrderLineDto::from(make_po_line());
    let d = format!("{dto:?}");
    assert!(d.contains("SKU-1"));
}

#[test]
fn purchase_order_line_dto_serialize() {
    let dto = PurchaseOrderLineDto::from(make_po_line());
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["sku"], "SKU-1");
    assert_eq!(json["qty"], 10);
}

// ── PurchaseOrderDto ────────────────────────────────────────────────

#[test]
fn purchase_order_dto_debug() {
    let po_with_lines = PurchaseOrderWithLines {
        order: PurchaseOrder {
            id: "po-1".into(),
            po_number: "PO-2025-001".into(),
            supplier_id: "sup-1".into(),
            status: "draft".into(),
            order_date: "2025-01-01".into(),
            expected_date: "2025-01-15".into(),
            received_date: None,
            subtotal_minor: 50000,
            tax_minor: 5000,
            total_minor: 55000,
            notes: String::new(),
            created_by: Some("admin".into()),
            created_at: "2025-01-01T00:00:00.000Z".into(),
            updated_at: "2025-01-01T00:00:00.000Z".into(),
        },
        lines: vec![make_po_line()],
        supplier_name: Some("Acme Corp".into()),
    };
    let dto = PurchaseOrderDto::from(po_with_lines);
    let d = format!("{dto:?}");
    assert!(d.contains("PO-2025-001"));
}

#[test]
fn purchase_order_dto_serialize() {
    let po_with_lines = PurchaseOrderWithLines {
        order: PurchaseOrder {
            id: "po-2".into(),
            po_number: "PO-2025-002".into(),
            supplier_id: "sup-2".into(),
            status: "pending".into(),
            order_date: "2025-02-01".into(),
            expected_date: "2025-02-15".into(),
            received_date: None,
            subtotal_minor: 100000,
            tax_minor: 10000,
            total_minor: 110000,
            notes: "Urgent".into(),
            created_by: None,
            created_at: "2025-02-01T00:00:00.000Z".into(),
            updated_at: "2025-02-01T00:00:00.000Z".into(),
        },
        lines: vec![],
        supplier_name: None,
    };
    let dto = PurchaseOrderDto::from(po_with_lines);
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["po_number"], "PO-2025-002");
    assert_eq!(json["total_minor"], 110000);
    assert!(json["lines"].as_array().unwrap().is_empty());
}

// ── CreateSupplierArgs ──────────────────────────────────────────────

#[test]
fn create_supplier_args_deserialize_minimal() {
    let json = r#"{"code":"SUP001","name":"Acme"}"#;
    let args: CreateSupplierArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.code, "SUP001");
    assert_eq!(args.contact_person, None);
}

#[test]
fn create_supplier_args_debug() {
    let args = CreateSupplierArgs {
        code: "S1".into(),
        name: "Test".into(),
        contact_person: Some("Jane".into()),
        phone: None,
        email: None,
        address: None,
        tax_id: None,
        payment_terms: None,
        notes: None,
    };
    let d = format!("{args:?}");
    assert!(d.contains("Test"));
}

// ── UpdateSupplierArgs ──────────────────────────────────────────────

#[test]
fn update_supplier_args_deserialize() {
    let json = r##"{"id":"sup-1","code":"SUP001","name":"Acme","status":"active"}"##;
    let args: UpdateSupplierArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.id, "sup-1");
    assert_eq!(args.status.as_deref(), Some("active"));
}

#[test]
fn update_supplier_args_debug() {
    let args = UpdateSupplierArgs {
        id: "s1".into(),
        code: "C1".into(),
        name: "N1".into(),
        contact_person: None,
        phone: None,
        email: None,
        address: None,
        tax_id: None,
        payment_terms: None,
        notes: None,
        status: None,
    };
    let d = format!("{args:?}");
    assert!(d.contains("N1"));
}

// ── PoLineInput ─────────────────────────────────────────────────────

#[test]
fn po_line_input_deserialize() {
    let json = r#"{"sku":"SKU-1","product_name":"Widget","qty":10,"unit_cost_minor":5000}"#;
    let args: PoLineInput = serde_json::from_str(json).unwrap();
    assert_eq!(args.sku, "SKU-1");
    assert_eq!(args.unit_cost_minor, 5000);
}

#[test]
fn po_line_input_debug() {
    let args = PoLineInput {
        sku: "S".into(),
        product_name: "P".into(),
        qty: 1,
        unit_cost_minor: 100,
    };
    let d = format!("{args:?}");
    assert!(d.contains("P"));
}

// ── CreatePurchaseOrderArgs ─────────────────────────────────────────

#[test]
fn create_purchase_order_args_deserialize_minimal() {
    let json = r#"{"po_number":"PO-001","supplier_id":"sup-1","lines":[]}"#;
    let args: CreatePurchaseOrderArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.po_number, "PO-001");
    assert_eq!(args.expected_date, None);
}

#[test]
fn create_purchase_order_args_deserialize_full() {
    let json = r#"{"po_number":"PO-002","supplier_id":"sup-2","expected_date":"2025-06-01","notes":"Rush","lines":[{"sku":"SKU-A","product_name":"Widget","qty":5,"unit_cost_minor":1000}]}"#;
    let args: CreatePurchaseOrderArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.expected_date.as_deref(), Some("2025-06-01"));
    assert_eq!(args.lines.len(), 1);
}

#[test]
fn create_purchase_order_args_debug() {
    let args = CreatePurchaseOrderArgs {
        po_number: "P1".into(),
        supplier_id: "S1".into(),
        expected_date: None,
        notes: None,
        lines: vec![],
    };
    let d = format!("{args:?}");
    assert!(d.contains("P1"));
}

// ── UpdatePoStatusArgs ──────────────────────────────────────────────

#[test]
fn update_po_status_args_deserialize() {
    let json = r#"{"id":"po-1","status":"approved"}"#;
    let args: UpdatePoStatusArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.id, "po-1");
    assert_eq!(args.status, "approved");
}

#[test]
fn update_po_status_args_debug() {
    let args = UpdatePoStatusArgs {
        id: "x".into(),
        status: "draft".into(),
    };
    let d = format!("{args:?}");
    assert!(d.contains("draft"));
}
