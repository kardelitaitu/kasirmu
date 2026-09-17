//! Cross-layer boundary contract for the inventory vertical (F-026).
//!
//! Mirrors `modules/tax/tests/boundary_contract.rs` so the inventory
//! pieces cannot drift apart:
//!
//! 1. **Module registration** — `manifest.json` id must match the
//!    `Module` trait id and declare the documented permissions.
//! 2. **Type identity** — the `kasirmu_core` re-exports are *the same types*
//!    as the `modules_inventory` ones (compile-time proof).
//! 3. **DB behaviour parity** — the module service observes the same
//!    product rows as `kasirmu_core`'s `Store`. Stock-level parity
//!    (`get_stock` / `adjust_stock_tx`) is intentionally NOT pinned
//!    yet: those methods query `inventory.sku` /
//!    `inventory.low_stock_threshold`, which are planned-schema columns
//!    absent from the current migration (see the NOTE in
//!    `modules/inventory/src/repository_tests.rs`).
//! 4. **Serde wire shape** — `InventoryTransaction` serializes the
//!    exact field names the frontend `ui/src/api/inventory.ts` DTO
//!    declares, including the `type` rename.

use foundation::contracts::Module;
use modules_inventory::{Category as ModuleCategory, Product as ModuleProduct};
use modules_inventory::{Inventory as ModuleInventory, InventoryModule};
use kasirmu_core::category::Category as CoreCategory;
use kasirmu_core::migrations::fresh_db;
use kasirmu_core::product::Product as CoreProduct;
use kasirmu_core::{Inventory as CoreInventory, InventoryLocation as CoreLocation};

// ── 1. Module registration contract ─────────────────────────────────

#[test]
fn manifest_id_matches_module_trait_id() {
    let manifest_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("manifest.json");
    let manifest = platform_kernel::ModuleManifest::load_from_file(&manifest_path)
        .expect("modules/inventory/manifest.json must load and validate");

    assert_eq!(manifest.id, "inventory", "manifest id must be stable");
    assert_eq!(
        manifest.id,
        InventoryModule::new().id(),
        "manifest id must equal Module::id()"
    );
    assert!(
        manifest.permissions.iter().any(|p| p == "inventory:view"),
        "manifest must declare inventory:view"
    );
    assert!(
        manifest.permissions.iter().any(|p| p == "inventory:edit"),
        "manifest must declare inventory:edit"
    );
    assert!(
        manifest.permissions.iter().any(|p| p == "inventory:adjust"),
        "manifest must declare inventory:adjust"
    );
}

// ── 2. Type identity contract ───────────────────────────────────────

/// Identity function used only for compile-time type-equality proofs.
fn identity<T>(t: T) -> T {
    t
}

#[test]
fn oz_core_reexports_exact_module_types() {
    // These assignments compile ONLY if the oz-core re-exports are
    // literally the same types as the modules_inventory ones. If
    // someone forks a type in either crate, this fails to build.
    let _inv: fn(CoreInventory) -> CoreInventory = identity::<ModuleInventory>;
    let _prod: fn(CoreProduct) -> CoreProduct = identity::<ModuleProduct>;
    let _cat: fn(CoreCategory) -> CoreCategory = identity::<ModuleCategory>;
    let _loc: fn(CoreLocation) -> CoreLocation = identity::<modules_inventory::InventoryLocation>;
}

// ── 3. DB behaviour parity contract ─────────────────────────────────

#[test]
fn module_service_and_store_agree_on_product_rows() {
    let conn = fresh_db();
    let store = kasirmu_core::db::Store::new(&conn);
    let price = foundation::Money {
        minor_units: 19_999,
        currency: "USD".parse().unwrap(),
    };
    let created = store
        .create_product(
            "BC-CONTRACT-1",
            "Contract Product",
            price,
            None,
            Some("4006381333931"),
            5,
            None,
        )
        .expect("seed product");

    // The module service must observe the SAME product row the store
    // wrote — reached via barcode (Store::get_product returns the
    // composed ProductWithDetails view, so the Product-typed parity
    // anchor is the barcode lookup).
    let via_module = modules_inventory::InventoryService::get_product(&conn, &created.id).unwrap();
    let via_store = store
        .get_product_by_barcode("4006381333931")
        .unwrap()
        .expect("store must find the product by barcode");

    assert_eq!(
        via_module.as_ref().map(|p| p.id.as_str()),
        Some(created.id.as_str())
    );
    assert_eq!(
        via_module,
        Some(via_store),
        "module and store must agree on the product row"
    );
}

#[test]
fn module_service_returns_none_for_unknown_product_id() {
    let conn = fresh_db();
    assert!(
        modules_inventory::InventoryService::get_product(&conn, "no-such-id")
            .unwrap()
            .is_none(),
        "unknown ids must return None through the module service"
    );
}

// ── 4. Serde wire-shape contract ────────────────────────────────────

#[test]
fn inventory_transaction_serializes_frontend_contract_fields() {
    use kasirmu_core::inventory_transaction::{
        InventoryTransaction, InventoryTransactionId, InventoryTransactionType,
    };

    let tx = InventoryTransaction {
        id: InventoryTransactionId::from("01926b3a-0000-7000-8000-00000000abcd"),
        transaction_type: InventoryTransactionType::Sale,
        location_id: "loc-1".into(),
        staff_id: "staff-1".into(),
        transfer_id: None,
        purchase_order_id: None,
        notes: String::new(),
        created_at: "2026-01-01T00:00:00.000Z".into(),
    };

    let value = serde_json::to_value(&tx).unwrap();
    let obj = value
        .as_object()
        .expect("InventoryTransaction must serialize to an object");

    // Must match ui/src/api/inventory.ts InventoryTransaction field
    // names exactly — including the `type` rename.
    for field in [
        "id",
        "type",
        "location_id",
        "staff_id",
        "transfer_id",
        "purchase_order_id",
        "notes",
        "created_at",
    ] {
        assert!(obj.contains_key(field), "missing contract field '{field}'");
    }
    assert_eq!(
        obj.len(),
        8,
        "InventoryTransaction must serialize exactly 8 fields"
    );
    assert_eq!(
        obj["type"], "sale",
        "transaction_type must rename to 'type'"
    );
}

#[test]
fn inventory_transaction_line_input_accepts_frontend_wire_shape() {
    use kasirmu_core::db::inventory::InventoryTransactionLineInput;

    // Deserialize-only command input: pin the wire shape the frontend
    // sends (ui/src/api/inventory.ts InventoryTransactionLineInput) —
    // extra/missing keys or renames must fail here, not at runtime.
    let json = serde_json::json!({
        "sku": "SKU-1",
        "product_name": "Widget",
        "qty": 2,
        "delta": -2,
        "barcode_scanned": "4006381333931"
    });
    let back: InventoryTransactionLineInput = serde_json::from_value(json).unwrap();
    assert_eq!(back.sku, "SKU-1");
    assert_eq!(back.product_name, "Widget");
    assert_eq!(back.qty, 2);
    assert_eq!(back.delta, -2);
    assert_eq!(back.barcode_scanned.as_deref(), Some("4006381333931"));
}
