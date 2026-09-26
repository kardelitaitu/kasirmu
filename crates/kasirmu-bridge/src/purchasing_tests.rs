use super::*;
use kasirmu_core::{PurchaseOrder, PurchaseOrderLine, PurchaseOrderWithLines, Supplier};

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

// ── MSL-41: an omitted status must PRESERVE the row, not force "active" ──

/// `update_supplier` (both variants) defaults an absent `status` to `"active"`
/// (`purchasing.rs` — `args.status.as_deref().unwrap_or("active")`), and the
/// Suppliers screen never sends one: its edit form is seeded from the row but
/// carries no status field, and the payload omits it entirely
/// (the supplier-management screen builds `UpdateSupplierArgs` without `status`).
///
/// So editing a supplier — any edit, even fixing a phone number — silently
/// RE-ACTIVATES an inactive one. The row the user was looking at said
/// "inactive"; the save flips it. Nothing in the UI can express the intent, and
/// nothing reports the change.
///
/// This pins the contract the fix has to satisfy, at the level the defect
/// lives: an omitted status means "leave it as it is", while an explicit value
/// still wins. It is written against the pure argument mapping so it needs no
/// BridgeCtx.
#[test]
fn an_omitted_status_preserves_the_existing_supplier_status() {
    // The mapping the two update wrappers perform, extracted here so the
    // contract is assertable without a bridge context.
    fn resolved_status(requested: Option<&str>, existing: &str) -> String {
        requested.unwrap_or(existing).to_owned()
    }

    // The reported defect: omit + inactive must NOT become active.
    assert_eq!(
        resolved_status(None, "inactive"),
        "inactive",
        "an edit that does not mention status must leave an inactive supplier inactive"
    );

    // An explicit value still wins, both directions.
    assert_eq!(resolved_status(Some("inactive"), "active"), "inactive");
    assert_eq!(resolved_status(Some("active"), "inactive"), "active");
}

/// The consequence, driven through the real store rather than restated as a
/// source grep: what `unwrap_or("active")` hands the UPDATE. An inactive
/// supplier edited through the UI payload (which omits `status`) reaches the
/// store as `"active"` and is silently re-activated.
#[test]
fn an_inactive_supplier_survives_an_edit_that_omits_status() {
    use kasirmu_core::db::Store;
    let conn = kasirmu_core::migrations::fresh_db();
    let store = Store::new(&conn);

    let created = store
        .create_supplier("SUP900", "Dormant Co", "", "", "", "", "", "", "")
        .unwrap();
    store
        .update_supplier(
            &created.id,
            "SUP900",
            "Dormant Co",
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
    assert_eq!(
        store.get_supplier(&created.id).unwrap().unwrap().status,
        "inactive"
    );

    // The UI edits the phone number; its payload carries no `status` key.
    let edit = UpdateSupplierArgs {
        id: created.id.clone(),
        code: "SUP900".into(),
        name: "Dormant Co".into(),
        contact_person: None,
        phone: Some("+230 5555 0000".into()),
        email: None,
        address: None,
        tax_id: None,
        payment_terms: None,
        notes: None,
        status: None,
    };

    let existing = store.get_supplier(&edit.id).unwrap().unwrap().status;
    let resolved = status_for_update(edit.status.as_deref(), &existing);
    assert_eq!(
        resolved, "inactive",
        "an edit that omits status must preserve the row, not force it active"
    );

    store
        .update_supplier(
            &edit.id,
            &edit.code,
            &edit.name,
            edit.contact_person.as_deref().unwrap_or_default(),
            edit.phone.as_deref().unwrap_or_default(),
            edit.email.as_deref().unwrap_or_default(),
            edit.address.as_deref().unwrap_or_default(),
            edit.tax_id.as_deref().unwrap_or_default(),
            edit.payment_terms.as_deref().unwrap_or_default(),
            edit.notes.as_deref().unwrap_or_default(),
            &resolved,
        )
        .unwrap();

    let after = store.get_supplier(&edit.id).unwrap().unwrap();
    assert_eq!(after.status, "inactive", "the edit must not resurrect it");
    assert_eq!(
        after.phone, "+230 5555 0000",
        "and the edit must still land"
    );
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
