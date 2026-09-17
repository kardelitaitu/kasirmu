use super::*;
use crate::migrations;

fn fresh_store() -> Store<'static> {
    let conn = migrations::fresh_db();

    // Seed products so FK constraints are satisfied.
    conn.execute_batch(
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
    let conn = Box::leak(Box::new(conn));
    Store::new(conn)
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
    let store = fresh_store();
    let bundles = store.list_bundles().unwrap();
    // Our bundle product "BUNDLE1" is in products but not in product_bundles, so empty.
    assert!(bundles.is_empty());
}

#[test]
fn create_and_list_bundles() {
    let store = fresh_store();
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
    let store = fresh_store();
    let bundle = make_bundle("Hamper");
    let items = vec![make_item(&bundle.id, "ITEM-C", 3)];
    store.create_bundle(&bundle, &items).unwrap();

    let found = store.get_bundle(&bundle.id).unwrap().unwrap();
    assert_eq!(found.bundle.bundle_sku, bundle.bundle_sku);
    assert_eq!(found.items.len(), 1);
}

#[test]
fn get_bundle_by_sku() {
    let store = fresh_store();
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
    let store = fresh_store();
    assert!(store.get_bundle("nonexistent").unwrap().is_none());
    assert!(store.get_bundle_by_sku("NONEXISTENT").unwrap().is_none());
}

#[test]
fn update_bundle_replaces_items() {
    let store = fresh_store();
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
    let store = fresh_store();
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
    let store = fresh_store();
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
    let store = fresh_store();
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
    let store = fresh_store();
    let bundle = make_bundle("Hamper");
    let items = vec![make_item(&bundle.id, "ITEM-A", 0)];
    store.create_bundle(&bundle, &items).unwrap();

    let found = store.get_bundle(&bundle.id).unwrap().unwrap();
    assert_eq!(found.items.len(), 1);
    assert_eq!(found.items[0].qty, 0);
}

#[test]
fn create_bundle_with_no_items() {
    let store = fresh_store();
    let bundle = make_bundle("Sampler");
    store.create_bundle(&bundle, &[]).unwrap();

    let found = store.get_bundle(&bundle.id).unwrap().unwrap();
    assert!(found.items.is_empty());
}

#[test]
fn update_bundle_sku() {
    let store = fresh_store();
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
    let store = fresh_store();
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
    let store = fresh_store();
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
    let store = fresh_store();

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
    let store = fresh_store();
    assert!(store.get_bundle_by_sku("").unwrap().is_none());
}

#[test]
fn create_bundle_duplicate_id() {
    let store = fresh_store();
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
    let store = fresh_store();
    assert!(store.get_bundle("no-such-id").unwrap().is_none());
}

#[test]
fn get_bundle_by_nonexistent_sku_returns_none() {
    let store = fresh_store();
    assert!(store.get_bundle_by_sku("NO-SUCH-SKU").unwrap().is_none());
}

#[test]
fn update_nonexistent_bundle_is_noop() {
    let store = fresh_store();
    let bundle = make_bundle("Gift Box");
    // Updating a bundle that doesn't exist is a no-op (0 rows affected, no error)
    store.update_bundle(&bundle, &[]).unwrap();
}
