//! Cross-layer boundary contract for the sales vertical (F-026).
//!
//! Mirrors `modules/tax/tests/boundary_contract.rs` so the sales
//! pieces cannot drift apart:
//!
//! 1. **Module registration** — `manifest.json` id must match the
//!    `Module` trait id and declare the documented permissions.
//! 2. **Type identity** — the `kasirmu_core` re-exports are *the same types*
//!    as the `modules_sales` ones (compile-time proof).
//! 3. **DB behaviour parity** — a sale the module service checks out
//!    must be readable by `kasirmu_core`'s `Store` with the same status and
//!    total, and a module-side void must be visible through the store.
//! 4. **Serde wire shape** — `Sale` crosses IPC raw (the Tauri
//!    `complete_sale` / void / refund commands return it directly), so
//!    its serialized field names and the kebab-case `SaleStatus`
//!    representation are pinned against the frontend contract.

use foundation::contracts::Module;
use kasirmu_core::migrations::fresh_db;
use kasirmu_core::refund::{Refund as CoreRefund, RefundLine as CoreRefundLine};
use kasirmu_core::sale::{Sale as CoreSale, SaleLine as CoreSaleLine};
use modules_sales::{
    Refund as ModuleRefund, RefundLine as ModuleRefundLine, SalesModule, SalesService,
};
use modules_sales::{Sale as ModuleSale, SaleLine as ModuleSaleLine};

// ── 1. Module registration contract ─────────────────────────────────

#[test]
fn manifest_id_matches_module_trait_id() {
    let manifest_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("manifest.json");
    let manifest = platform_kernel::ModuleManifest::load_from_file(&manifest_path)
        .expect("modules/sales/manifest.json must load and validate");

    assert_eq!(manifest.id, "sales", "manifest id must be stable");
    assert_eq!(
        manifest.id,
        SalesModule::new().id(),
        "manifest id must equal Module::id()"
    );
    // The documented command surface: void, refund, and the report
    // reads the sales module exposes. `sales:create` is intentionally
    // absent — checkout runs inside the POS command layer.
    assert!(
        manifest.permissions.iter().any(|p| p == "sales:void"),
        "manifest must declare sales:void"
    );
    assert!(
        manifest.permissions.iter().any(|p| p == "sales:refund"),
        "manifest must declare sales:refund"
    );
    assert!(
        manifest.permissions.iter().any(|p| p == "reports:view"),
        "manifest must declare reports:view"
    );
}

// ── 2. Type identity contract ───────────────────────────────────────

/// Identity function used only for compile-time type-equality proofs.
fn identity<T>(t: T) -> T {
    t
}

#[test]
fn oz_core_reexports_exact_module_types() {
    // These assignments compile ONLY if the kasirmu-core re-exports are
    // literally the same types as the modules_sales ones. If someone
    // forks a type in either crate, this fails to build.
    let _sale: fn(CoreSale) -> CoreSale = identity::<ModuleSale>;
    let _line: fn(CoreSaleLine) -> CoreSaleLine = identity::<ModuleSaleLine>;
    let _refund: fn(CoreRefund) -> CoreRefund = identity::<ModuleRefund>;
    let _rline: fn(CoreRefundLine) -> CoreRefundLine = identity::<ModuleRefundLine>;
}

// ── 3. DB behaviour parity contract ─────────────────────────────────

/// A single-line USD cart (2 × 350 = 700 minor units).
fn cart_with_line() -> modules_sales::Cart {
    let mut cart = modules_sales::Cart::new("USD".parse().unwrap());
    cart.add_line(modules_sales::CartLine::new(
        modules_sales::Sku::new("COFFEE"),
        2,
        foundation::Money {
            minor_units: 350,
            currency: "USD".parse().unwrap(),
        },
    ))
    .unwrap();
    cart
}

#[test]
fn module_checkout_is_visible_through_the_store() {
    let mut conn = fresh_db();

    // The module service persists the sale in its own transaction.
    let sale = SalesService::process_checkout(
        &mut conn,
        &cart_with_line(),
        Some("u-1".to_string()),
        "cash".to_string(),
    )
    .expect("checkout must succeed");

    // kasirmu_core's Store must observe the SAME row — same status, total,
    // and line count — even though it knows nothing about the module.
    let store = kasirmu_core::db::Store::new(&conn);
    let via_store = store
        .get_sale(&sale.id)
        .expect("store read must not error")
        .expect("store must see the module-written sale");
    assert_eq!(via_store.id, sale.id);
    assert_eq!(via_store.status, sale.status);
    assert_eq!(via_store.total, sale.total);
    assert_eq!(via_store.lines.len(), sale.lines.len());
}

#[test]
fn module_void_is_visible_through_the_store() {
    let conn = fresh_db();
    let store = kasirmu_core::db::Store::new(&conn);

    // Build an ACTIVE sale (Pending → Active) and persist it through
    // the store so the module's void path has a legal state-machine
    // transition (Active → Voided). Completed sales intentionally
    // cannot be voided — they route to the refund flow — so voiding a
    // fresh `process_checkout` sale would violate the state machine.
    let mut sale = ModuleSale::from_cart_with_user(&cart_with_line(), None)
        .expect("sale must construct from cart");
    sale.transition_to(foundation::SaleStatus::Active)
        .expect("pending → active is a legal transition");
    store.create_sale(&sale).expect("store write");

    SalesService::void_sale(&conn, &sale.id).expect("void must succeed");

    let via_store = store
        .get_sale(&sale.id)
        .expect("store read must not error")
        .expect("store must still see the voided sale");
    assert_eq!(
        via_store.status,
        foundation::SaleStatus::Voided,
        "the store must observe the module-side void"
    );
}

// ── 4. Serde wire-shape contract ────────────────────────────────────

#[test]
fn sale_serializes_ipc_contract_shape() {
    let mut conn = fresh_db();
    let sale =
        SalesService::process_checkout(&mut conn, &cart_with_line(), None, "cash".to_string())
            .expect("checkout must succeed");

    let value = serde_json::to_value(&sale).unwrap();
    let obj = value.as_object().expect("Sale must serialize to an object");

    // Raw IPC fields the frontend consumes off `complete_sale` /
    // void / refund command payloads.
    for field in ["id", "status", "total", "lines", "version"] {
        assert!(obj.contains_key(field), "missing contract field '{field}'");
    }

    // SaleStatus is kebab-case over the wire.
    assert_eq!(obj["status"], "completed");

    // Money crosses as { minor_units, currency } — the i64-minor-units
    // rule made visible to the frontend contract.
    let total = obj["total"].as_object().expect("total must be an object");
    assert_eq!(total["minor_units"], 700);
    assert_eq!(total["currency"], "USD");
}

#[test]
fn sale_status_serializes_kebab_case() {
    use foundation::SaleStatus;
    assert_eq!(
        serde_json::to_string(&SaleStatus::Pending).unwrap(),
        "\"pending\""
    );
    assert_eq!(
        serde_json::to_string(&SaleStatus::Active).unwrap(),
        "\"active\""
    );
    assert_eq!(
        serde_json::to_string(&SaleStatus::Completed).unwrap(),
        "\"completed\""
    );
    assert_eq!(
        serde_json::to_string(&SaleStatus::Voided).unwrap(),
        "\"voided\""
    );
}
