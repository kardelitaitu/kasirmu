use super::*;
use crate::migrations;

/// The caller owns the connection, so this no longer `Box::leak`s a
/// database per test to manufacture a `'static` (O-T03).
fn fresh_store(db: &rusqlite::Connection) -> Store<'_> {
    // Seed products so FK constraints are satisfied.
    db.execute_batch(
        "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at)
         VALUES ('p1', 'ITEM-A', 'Item A', 100, 'USD', 'now', 'now'),
                ('p2', 'ITEM-B', 'Item B', 200, 'USD', 'now', 'now'),
                ('p3', 'ITEM-C', 'Item C', 150, 'USD', 'now', 'now'),
                ('p4', 'BUNDLE1', 'Bundle One', 0, 'USD', 'now', 'now'),
                ('p5', 'B-Gift Box', 'Gift Box Bundle', 0, 'USD', 'now', 'now'),
                ('p6', 'B-Hamper', 'Hamper Bundle', 0, 'USD', 'now', 'now'),
                ('p7', 'B-Sampler', 'Sampler Bundle', 0, 'USD', 'now', 'now'),
                ('p8', 'B-Edit Me', 'Edit Me Bundle', 0, 'USD', 'now', 'now'),
                ('p9', 'B-Delete Me', 'Delete Me Bundle', 0, 'USD', 'now', 'now')",
    )
    .unwrap();

    // We need a static reference for Store — use leak to satisfy lifetime.
    Store::new(db)
}

fn make_bundle(name: &str) -> ProductBundle {
    ProductBundle {
        id: uuid::Uuid::now_v7().to_string(),
        bundle_sku: format!("B-{name}"),
        name: name.into(),
        description: String::new(),
        bundle_price_minor: Some(500),
        currency: "USD".into(),
        active: true,
        created_at: "2025-01-01T00:00:00.000Z".into(),
        updated_at: "2025-01-01T00:00:00.000Z".into(),
    }
}

fn make_item(bundle_id: &str, sku: &str, qty: i64) -> BundleItem {
    BundleItem {
        id: uuid::Uuid::now_v7().to_string(),
        bundle_id: bundle_id.into(),
        sku: sku.into(),
        qty,
        unit_price_minor: None,
    }
}

#[test]
fn list_bundles_empty() {
    let store_db = migrations::fresh_db();
    let store = fresh_store(&store_db);
    let bundles = store.list_bundles().unwrap();
    // Our bundle product "BUNDLE1" is in products but not in product_bundles, so empty.
    assert!(bundles.is_empty());
}

#[test]
fn create_and_list_bundles() {
    let store_db = migrations::fresh_db();
    let store = fresh_store(&store_db);
    let bundle = make_bundle("Gift Box");
    let items = vec![
        make_item(&bundle.id, "ITEM-A", 1),
        make_item(&bundle.id, "ITEM-B", 2),
    ];

    store.create_bundle(&bundle, &items).unwrap();

    let all = store.list_bundles().unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].bundle.name, "Gift Box");
    assert_eq!(all[0].items.len(), 2);
}

#[test]
fn get_bundle_by_id() {
    let store_db = migrations::fresh_db();
    let store = fresh_store(&store_db);
    let bundle = make_bundle("Hamper");
    let items = vec![make_item(&bundle.id, "ITEM-C", 3)];
    store.create_bundle(&bundle, &items).unwrap();

    let found = store.get_bundle(&bundle.id).unwrap().unwrap();
    assert_eq!(found.bundle.bundle_sku, bundle.bundle_sku);
    assert_eq!(found.items.len(), 1);
}

#[test]
fn get_bundle_by_sku() {
    let store_db = migrations::fresh_db();
    let store = fresh_store(&store_db);
    let bundle = make_bundle("Sampler");
    let items = vec![make_item(&bundle.id, "ITEM-A", 1)];
    store.create_bundle(&bundle, &items).unwrap();

    let found = store
        .get_bundle_by_sku(&bundle.bundle_sku)
        .unwrap()
        .unwrap();
    assert_eq!(found.bundle.name, "Sampler");
}

#[test]
fn get_missing_bundle_returns_none() {
    let store_db = migrations::fresh_db();
    let store = fresh_store(&store_db);
    assert!(store.get_bundle("nonexistent").unwrap().is_none());
    assert!(store.get_bundle_by_sku("NONEXISTENT").unwrap().is_none());
}

#[test]
fn update_bundle_replaces_items() {
    let store_db = migrations::fresh_db();
    let store = fresh_store(&store_db);
    let mut bundle = make_bundle("Edit Me");
    let items = vec![make_item(&bundle.id, "ITEM-A", 1)];
    store.create_bundle(&bundle, &items).unwrap();

    bundle.name = "Edited".into();
    let new_items = vec![
        make_item(&bundle.id, "ITEM-B", 1),
        make_item(&bundle.id, "ITEM-C", 2),
    ];
    store.update_bundle(&bundle, &new_items).unwrap();

    let found = store.get_bundle(&bundle.id).unwrap().unwrap();
    assert_eq!(found.bundle.name, "Edited");
    assert_eq!(found.items.len(), 2);
}

#[test]
fn delete_bundle_removes_items() {
    let store_db = migrations::fresh_db();
    let store = fresh_store(&store_db);
    let bundle = make_bundle("Delete Me");
    let items = vec![make_item(&bundle.id, "ITEM-A", 1)];
    store.create_bundle(&bundle, &items).unwrap();

    store.delete_bundle(&bundle.id).unwrap();
    assert!(store.get_bundle(&bundle.id).unwrap().is_none());

    // Items should also be gone.
    let all_items = store.load_all_bundle_items().unwrap();
    assert!(all_items.is_empty());
}

#[test]
fn delete_nonexistent_bundle_is_noop() {
    let store_db = migrations::fresh_db();
    let store = fresh_store(&store_db);
    // Deleting a nonexistent bundle should not error.
    store.delete_bundle("no-such-bundle").unwrap();
}

// ── Additional edge-case tests ─────────────────────────────────
//
// NOTE: bundle_sku has FK REFERENCES products(sku), so bundle names
// must match seeded product SKUs (B-Gift Box, B-Hamper, B-Sampler,
// B-Edit Me, B-Delete Me, BUNDLE1).

#[test]
fn create_bundle_with_many_items() {
    let store_db = migrations::fresh_db();
    let store = fresh_store(&store_db);
    let bundle = make_bundle("Gift Box");
    let items = vec![
        make_item(&bundle.id, "ITEM-A", 1),
        make_item(&bundle.id, "ITEM-B", 1),
        make_item(&bundle.id, "ITEM-C", 1),
        make_item(&bundle.id, "ITEM-A", 2),
        make_item(&bundle.id, "ITEM-B", 3),
    ];
    store.create_bundle(&bundle, &items).unwrap();

    let found = store.get_bundle(&bundle.id).unwrap().unwrap();
    assert_eq!(found.items.len(), 5);
}

#[test]
fn create_bundle_with_zero_qty_item() {
    // MSL-51 CHANGED THIS EXPECTATION, deliberately. This test lives in the
    // "Additional edge-case tests" block and used to record that a zero quantity
    // was stored verbatim — a description of behaviour, not a business rule: the
    // schema never carried a CHECK, and the desktop editor has always refused
    // `qty < 1` (the bundle-management screen), so the two disagreed and
    // only the client guarded anything. A bundle containing "0 of ITEM-A" is not
    // a meaningful bundle, so the store now refuses it and every caller agrees.
    let store_db = migrations::fresh_db();
    let store = fresh_store(&store_db);
    let bundle = make_bundle("Hamper");
    let items = vec![make_item(&bundle.id, "ITEM-A", 0)];

    let err = store
        .create_bundle(&bundle, &items)
        .expect_err("a zero-quantity component is refused at the store boundary");
    assert!(
        matches!(err, CoreError::Validation { field: "qty", .. }),
        "expected a qty Validation, got {err:?}"
    );
    assert!(store.get_bundle(&bundle.id).unwrap().is_none());
}

#[test]
fn create_bundle_with_no_items() {
    let store_db = migrations::fresh_db();
    let store = fresh_store(&store_db);
    let bundle = make_bundle("Sampler");
    store.create_bundle(&bundle, &[]).unwrap();

    let found = store.get_bundle(&bundle.id).unwrap().unwrap();
    assert!(found.items.is_empty());
}

#[test]
fn update_bundle_sku() {
    let store_db = migrations::fresh_db();
    let store = fresh_store(&store_db);
    let mut bundle = make_bundle("Edit Me");
    let items = vec![make_item(&bundle.id, "ITEM-A", 1)];
    store.create_bundle(&bundle, &items).unwrap();

    // bundle_sku FK must reference an existing product SKU; BUNDLE1 exists
    bundle.bundle_sku = "BUNDLE1".into();
    store.update_bundle(&bundle, &items).unwrap();

    // Look up by new SKU
    let found = store.get_bundle_by_sku("BUNDLE1").unwrap().unwrap();
    assert_eq!(found.bundle.name, "Edit Me");

    // Old SKU should not find it
    assert!(store.get_bundle_by_sku("B-Edit Me").unwrap().is_none());
}

#[test]
fn update_bundle_mark_inactive() {
    let store_db = migrations::fresh_db();
    let store = fresh_store(&store_db);
    let mut bundle = make_bundle("Delete Me");
    let items = vec![make_item(&bundle.id, "ITEM-A", 1)];
    store.create_bundle(&bundle, &items).unwrap();

    bundle.active = false;
    store.update_bundle(&bundle, &items).unwrap();

    let found = store.get_bundle(&bundle.id).unwrap().unwrap();
    assert!(!found.bundle.active);
}

#[test]
fn update_bundle_clear_items_to_empty() {
    let store_db = migrations::fresh_db();
    let store = fresh_store(&store_db);
    let bundle = make_bundle("Gift Box");
    let items = vec![make_item(&bundle.id, "ITEM-A", 1)];
    store.create_bundle(&bundle, &items).unwrap();

    // Update with empty items
    store.update_bundle(&bundle, &[]).unwrap();

    let found = store.get_bundle(&bundle.id).unwrap().unwrap();
    assert!(found.items.is_empty());
}

#[test]
fn list_bundles_multiple_ordered_by_name() {
    let store_db = migrations::fresh_db();
    let store = fresh_store(&store_db);

    // Create bundles using seeded skus: B-Gift Box, B-Hamper, B-Sampler
    // Names sort as: Gift Box < Hamper < Sampler -> already in order
    // Insert out-of-order to verify ORDER BY name works
    let b = make_bundle("Sampler");
    store.create_bundle(&b, &[]).unwrap();
    let a = make_bundle("Gift Box");
    store.create_bundle(&a, &[]).unwrap();
    let c = make_bundle("Hamper");
    store.create_bundle(&c, &[]).unwrap();

    let all = store.list_bundles().unwrap();
    assert_eq!(all.len(), 3);
    // ORDER BY name ASC
    assert_eq!(all[0].bundle.name, "Gift Box");
    assert_eq!(all[1].bundle.name, "Hamper");
    assert_eq!(all[2].bundle.name, "Sampler");
}

#[test]
fn get_bundle_by_sku_empty_string() {
    let store_db = migrations::fresh_db();
    let store = fresh_store(&store_db);
    assert!(store.get_bundle_by_sku("").unwrap().is_none());
}

#[test]
fn create_bundle_duplicate_id() {
    let store_db = migrations::fresh_db();
    let store = fresh_store(&store_db);
    let bundle = make_bundle("Gift Box");
    let items = vec![make_item(&bundle.id, "ITEM-A", 1)];
    store.create_bundle(&bundle, &items).unwrap();

    // Creating with same ID should fail (PK constraint)
    // Use a different seeded SKU for the duplicate to avoid bundle_sku UNIQUE
    let dup = ProductBundle {
        id: bundle.id.clone(),
        bundle_sku: "B-Hamper".into(),
        name: "Duplicate".into(),
        ..make_bundle("Gift Box")
    };
    let result = store.create_bundle(&dup, &items);
    assert!(result.is_err());
}

#[test]
fn get_bundle_by_nonexistent_id_returns_none() {
    let store_db = migrations::fresh_db();
    let store = fresh_store(&store_db);
    assert!(store.get_bundle("no-such-id").unwrap().is_none());
}

#[test]
fn get_bundle_by_nonexistent_sku_returns_none() {
    let store_db = migrations::fresh_db();
    let store = fresh_store(&store_db);
    assert!(store.get_bundle_by_sku("NO-SUCH-SKU").unwrap().is_none());
}

// ── MSL-48: a bundle item naming a missing product must say so ──

// The component SKU is free text in the editor, and a typo currently reaches
// the caller as a bare `FOREIGN KEY constraint failed`.
//
// `bundle_items.sku` is `REFERENCES products(sku)`, and both writers bind
// `item.sku` from an untyped `String` (`product_bundle.rs:41`). Measured:
//
// ```text
// PROBE create_bundle with bad sku = Err(Db(SqliteFailure(
//     ConstraintViolation, 787, Some("FOREIGN KEY constraint failed"))))
// ```
//
// No field, no SKU, and no statement that the product is the missing thing —
// while the bridge forwards `i.sku` unvalidated (`bundles.rs:170`) and the
// editor renders it as an `<input>` (the bundle-management screen) whose
// save failure shows the generic `bundles-error-save` message, because a DB
// error is not the client-side `BundleValidationError` the catch distinguishes.
//
// So a mistyped SKU reads as "the bundle could not be saved" with nothing
// pointing at the field. This is MSL-40's shape once more — a constraint
// violation reported as a storage fault — but here the constraint is an FK
// and the offending value is on screen.
//
// NOTE (2026-09-28): this block documents an OPEN finding with no test under it — MSL-48
// names a defect (`create_bundle` with a bad SKU reports a bare FK violation) that nothing
// here asserts. It was a doc comment with no item, which is also what clippy's
// `empty_line_after_doc_comments` was flagging.
// ── MSL-51: a bundle item quantity must be positive ─────────────

/// `bundle_items.qty` has `DEFAULT 1` and **no CHECK**, and nothing validates it
/// on the write path — so a zero or negative quantity is stored.
///
/// The desktop editor guards it client-side (the bundle-management screen:
/// `qty < 1` throws), which is precisely why it went unnoticed: the check exists,
/// just not where the other callers reach. Both shells forward to the same bridge
/// command, so the tablet, a script, or any future IPC caller can store "−2 of
/// ITEM-A" in a bundle.
///
/// Unlike MSL-48 this is not a constraint being misreported — there is no
/// constraint. The fix adds the rule at the store, where every caller meets it,
/// and the DB CHECK is deliberately left alone (adding one would need a migration
/// and would turn a bad value into a raw failure rather than a named field).
#[test]
fn a_bundle_item_quantity_must_be_positive() {
    let store_db = migrations::fresh_db();
    let store = fresh_store(&store_db);
    let bundle = make_bundle("Gift Box");

    for bad in [0_i64, -1, -99] {
        let items = vec![make_item(&bundle.id, "ITEM-A", bad)];
        let err = store
            .create_bundle(&bundle, &items)
            .expect_err("a non-positive item quantity must be refused");
        match err {
            CoreError::Validation { field, message } => {
                assert_eq!(field, "qty", "the error names the quantity");
                assert!(
                    message.contains(&bad.to_string()),
                    "and echoes the rejected value {bad}: {message}"
                );
            }
            other => panic!("expected a qty Validation for {bad}, got {other:?}"),
        }
    }

    // Nothing was written: the refused create leaves no bundle behind.
    assert!(store.get_bundle(&bundle.id).unwrap().is_none());
}

/// The update path re-inserts every item, so it is held to the same rule.
/// The sibling of the quantity rule: `unit_price_minor` is a price OVERRIDE, so a
/// negative value is money that should never exist.
///
/// `bundle_items.unit_price_minor` is `INTEGER` with no CHECK, and the store
/// validated nothing — the editor refuses negatives (the bundle-management screen:
/// `unitPrice < 0`), so again only the client guarded it.
///
/// **Severity, stated honestly:** nothing in `kasirmu-core` sums this column —
/// `line.qty * line.unit_price_minor` belongs to SALE lines (`sales_tax.rs:385`), a
/// different table — so a negative override is inert today and this is a
/// consistency fix, not a live wrong answer. It is worth pinning because the
/// column is a price: the first consumer to trust it would otherwise inherit a
/// value the UI already believes is impossible.
#[test]
fn a_bundle_item_price_override_cannot_be_negative() {
    let store_db = migrations::fresh_db();
    let store = fresh_store(&store_db);
    let bundle = make_bundle("Sampler");
    let mut item = make_item(&bundle.id, "ITEM-A", 1);
    item.unit_price_minor = Some(-500);

    let err = store
        .create_bundle(&bundle, &[item])
        .expect_err("a negative price override must be refused");
    match err {
        CoreError::Validation { field, message } => {
            assert_eq!(field, "unit_price_minor");
            assert!(message.contains("-500"), "echoes the value: {message}");
        }
        other => panic!("expected a unit_price_minor Validation, got {other:?}"),
    }
}

/// A valid override and the `None` case still round-trip — the property the fix
/// must not break.
#[test]
fn a_valid_price_override_still_round_trips() {
    let store_db = migrations::fresh_db();
    let store = fresh_store(&store_db);
    let bundle = make_bundle("Edit Me");
    let mut with_override = make_item(&bundle.id, "ITEM-A", 1);
    with_override.unit_price_minor = Some(250);
    let without = make_item(&bundle.id, "ITEM-B", 1);

    store
        .create_bundle(&bundle, &[with_override, without])
        .unwrap();
    let found = store.get_bundle(&bundle.id).unwrap().unwrap();
    assert_eq!(found.items[0].unit_price_minor, Some(250));
    assert_eq!(found.items[1].unit_price_minor, None, "None stays None");
}

#[test]
fn updating_a_bundle_with_a_non_positive_quantity_is_refused() {
    let store_db = migrations::fresh_db();
    let store = fresh_store(&store_db);
    let bundle = make_bundle("Hamper");
    store
        .create_bundle(&bundle, &[make_item(&bundle.id, "ITEM-A", 2)])
        .unwrap();

    let err = store
        .update_bundle(&bundle, &[make_item(&bundle.id, "ITEM-A", 0)])
        .expect_err("a non-positive quantity must be refused on update");
    assert!(
        matches!(err, CoreError::Validation { field: "qty", .. }),
        "expected a qty Validation, got {err:?}"
    );
}

#[test]
fn an_item_naming_a_missing_product_is_a_typed_error() {
    let store_db = migrations::fresh_db();
    let store = fresh_store(&store_db);
    let bundle = make_bundle("Gift Box");
    let items = vec![make_item(&bundle.id, "NO-SUCH-SKU", 1)];

    let err = store
        .create_bundle(&bundle, &items)
        .expect_err("a missing component product must be refused");
    match err {
        CoreError::NotFound { entity, id } => {
            assert_eq!(entity, "product", "the missing thing is a product");
            assert_eq!(id, "NO-SUCH-SKU", "and the error names the SKU to fix");
        }
        other => panic!("expected NotFound naming the SKU, got {other:?}"),
    }

    // Nothing was half-written: the bundle row must not survive the refusal.
    assert!(store.get_bundle(&bundle.id).unwrap().is_none());
}

/// The update path is held to the same rule, since it re-inserts every item.
/// The bundle SKU itself is `UNIQUE REFERENCES products(sku)` — a bundle is a
/// product — so a `bundle_sku` that names nothing is the third instance of the
/// same raw-FK leak, on the row written before the items.
#[test]
fn a_bundle_sku_that_is_not_a_product_is_a_typed_error() {
    let store_db = migrations::fresh_db();
    let store = fresh_store(&store_db);
    let mut bundle = make_bundle("Sampler");
    bundle.bundle_sku = "NOT-A-PRODUCT".into();

    let err = store
        .create_bundle(&bundle, &[])
        .expect_err("a bundle SKU naming no product must be refused");
    match err {
        CoreError::NotFound { entity, id } => {
            assert_eq!(entity, "product");
            assert_eq!(id, "NOT-A-PRODUCT", "the error names the SKU to fix");
        }
        other => panic!("expected NotFound naming the bundle SKU, got {other:?}"),
    }
}

/// Renaming a bundle onto a non-product SKU is refused the same way.
#[test]
fn renaming_a_bundle_onto_a_missing_product_is_a_typed_error() {
    let store_db = migrations::fresh_db();
    let store = fresh_store(&store_db);
    let bundle = make_bundle("Edit Me");
    store.create_bundle(&bundle, &[]).unwrap();

    let mut renamed = bundle.clone();
    renamed.bundle_sku = "NOT-A-PRODUCT".into();
    let err = store
        .update_bundle(&renamed, &[])
        .expect_err("renaming onto a missing product must be refused");
    assert!(
        matches!(
            err,
            CoreError::NotFound {
                entity: "product",
                ..
            }
        ),
        "expected NotFound for the product, got {err:?}"
    );
}

#[test]
fn updating_onto_a_missing_product_is_a_typed_error() {
    let store_db = migrations::fresh_db();
    let store = fresh_store(&store_db);
    let bundle = make_bundle("Hamper");
    store
        .create_bundle(&bundle, &[make_item(&bundle.id, "ITEM-A", 1)])
        .unwrap();

    let err = store
        .update_bundle(&bundle, &[make_item(&bundle.id, "NO-SUCH-SKU", 1)])
        .expect_err("a missing component product must be refused");
    assert!(
        matches!(
            err,
            CoreError::NotFound {
                entity: "product",
                ..
            }
        ),
        "expected NotFound for the product, got {err:?}"
    );
}

#[test]
fn update_nonexistent_bundle_is_noop() {
    let store_db = migrations::fresh_db();
    let store = fresh_store(&store_db);
    let bundle = make_bundle("Gift Box");
    // Updating a bundle that doesn't exist is a no-op (0 rows affected, no error)
    store.update_bundle(&bundle, &[]).unwrap();
}
