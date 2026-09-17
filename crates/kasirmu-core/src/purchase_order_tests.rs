use super::*;

// ── PurchaseOrder construction ───────────────────────────────

#[test]
fn new_purchase_order() {
    let po = PurchaseOrder::new("PO-001", "sup-1");
    assert_eq!(po.po_number, "PO-001");
    assert_eq!(po.supplier_id, "sup-1");
    assert_eq!(po.status, "draft");
    assert!(!po.order_date.is_empty());
}

#[test]
#[should_panic(expected = "PO number must not be empty")]
fn new_panics_on_empty_po_number() {
    PurchaseOrder::new("  ", "sup-1");
}

#[test]
fn new_generates_uuid() {
    let po = PurchaseOrder::new("PO-001", "sup-1");
    assert_eq!(po.id.len(), 36, "UUID v4 should be 36 chars");
    assert_eq!(po.id.chars().filter(|c| *c == '-').count(), 4);
}

#[test]
fn new_trims_whitespace() {
    let po = PurchaseOrder::new("  PO-002  ", "sup-1");
    assert_eq!(po.po_number, "PO-002");
}

#[test]
fn new_defaults_monetary_fields_to_zero() {
    let po = PurchaseOrder::new("PO-001", "sup-1");
    assert_eq!(po.subtotal_minor, 0);
    assert_eq!(po.tax_minor, 0);
    assert_eq!(po.total_minor, 0);
}

#[test]
fn new_defaults_optional_fields() {
    let po = PurchaseOrder::new("PO-001", "sup-1");
    assert_eq!(po.expected_date, "");
    assert_eq!(po.received_date, None);
    assert_eq!(po.notes, "");
    assert_eq!(po.created_by, None);
    assert_eq!(po.created_at, "");
    assert_eq!(po.updated_at, "");
}

#[test]
fn new_order_date_is_rfc3339() {
    let po = PurchaseOrder::new("PO-001", "sup-1");
    assert!(po.order_date.contains('T'), "should contain 'T' separator");
    assert!(po.order_date.ends_with('Z'), "should be UTC");
}

#[test]
fn unique_ids_per_instance() {
    let a = PurchaseOrder::new("PO-001", "sup-1");
    let b = PurchaseOrder::new("PO-002", "sup-2");
    assert_ne!(a.id, b.id);
}

#[test]
fn debug_output() {
    let po = PurchaseOrder::new("PO-001", "sup-1");
    let debug = format!("{:?}", po);
    assert!(debug.contains("PO-001"));
    assert!(debug.contains("sup-1"));
}

#[test]
fn equality_depends_on_fields() {
    let a = PurchaseOrder::new("PO-001", "sup-1");
    let mut b = a.clone();
    b.status = "approved".into();
    assert_ne!(a, b);
}

// ── PurchaseOrderLine ────────────────────────────────────────

#[test]
fn new_line() {
    let line = PurchaseOrderLine::new("po-1");
    assert_eq!(line.po_id, "po-1");
    assert_eq!(line.qty, 0);
}

#[test]
fn new_line_generates_uuid() {
    let line = PurchaseOrderLine::new("po-1");
    assert_eq!(line.id.len(), 36);
    assert_eq!(line.id.chars().filter(|c| *c == '-').count(), 4);
}

#[test]
fn new_line_defaults_fields() {
    let line = PurchaseOrderLine::new("po-1");
    assert_eq!(line.sku, "");
    assert_eq!(line.product_name, "");
    assert_eq!(line.qty, 0);
    assert_eq!(line.unit_cost_minor, 0);
    assert_eq!(line.line_total_minor, 0);
}

#[test]
fn line_debug_output() {
    let line = PurchaseOrderLine::new("po-1");
    let debug = format!("{:?}", line);
    assert!(debug.contains("po-1"));
}

// ── Serde ────────────────────────────────────────────────────

#[test]
fn serde_roundtrip() {
    let po = PurchaseOrder::new("PO-001", "sup-1");
    let json = serde_json::to_string(&po).unwrap();
    let back: PurchaseOrder = serde_json::from_str(&json).unwrap();
    assert_eq!(back, po);
}

#[test]
fn purchase_order_with_lines_serde() {
    let po = PurchaseOrder::new("PO-001", "sup-1");
    let line = PurchaseOrderLine::new("po-1");
    let with_lines = PurchaseOrderWithLines {
        order: po.clone(),
        lines: vec![line],
        supplier_name: Some("Acme Corp".into()),
    };
    let json = serde_json::to_string(&with_lines).unwrap();
    let back: PurchaseOrderWithLines = serde_json::from_str(&json).unwrap();
    assert_eq!(back.order, po);
    assert_eq!(back.lines.len(), 1);
    assert_eq!(back.supplier_name, Some("Acme Corp".into()));
}

#[test]
fn purchase_order_with_lines_empty_lines() {
    let po = PurchaseOrder::new("PO-001", "sup-1");
    let with_lines = PurchaseOrderWithLines {
        order: po.clone(),
        lines: vec![],
        supplier_name: None,
    };
    let json = serde_json::to_string(&with_lines).unwrap();
    let back: PurchaseOrderWithLines = serde_json::from_str(&json).unwrap();
    assert_eq!(back.order, po);
    assert!(back.lines.is_empty());
    assert_eq!(back.supplier_name, None);
}
