//! Integration tests for store-scoped repository queries.
//!
//! The raw-SQL cross-store audit lives in the migrations unit module
//! (`migrations::tests::store_scoped_*` and friends). This suite proves
//! the SAME isolation guarantee through the real repository API — the
//! store-scoped workspace-instance calls in `db::workspaces`
//! (`list_all_instances`, `count_active_instances`) filter
//! `WHERE store_id = ?1`, and no cross-store row can surface through
//! them.
//!
//! Why the workspace-instance layer and not `list_products`? The product
//! catalog is deliberately GLOBAL in the per-store-database model — each
//! store opens its own `store-<id>.sqlite` file (see
//! docs/decisions/2026-07-10-workspace-type-instance-design.md), so
//! `store_id` on products is the soft-scoping layer for shared/cloud
//! databases only and `list_products` intentionally has no store filter.
//! The genuinely store-scoped repository API is the workspace-instance
//! layer exercised here. Note `workspace_instances.store_id` is NOT NULL
//! with an FK to `locations(id)` (created in migration 060, rebuilt
//! with ON DELETE RESTRICT in migration 066) — so unlike the domain
//! tables there is NO NULL global-sentinel ambiguity at all: every
//! instance belongs to exactly one store, and a scoped listing can only
//! ever return that store's rows.

use oz_core::{Store, StoreProfile, migrations};
use rusqlite::Connection;

// ── Helpers ───────────────────────────────────────────────────────────

/// Open an in-memory database with the full migration set applied.
fn setup() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn make_profile(id: &str, name: &str) -> StoreProfile {
    StoreProfile {
        id: id.to_owned(),
        name: name.to_owned(),
        address: String::new(),
        tax_id: String::new(),
        currency: "USD".to_owned(),
        timezone: "UTC".to_owned(),
        is_primary: false,
        created_at: "2026-07-01T10:00:00Z".to_owned(),
        updated_at: "2026-07-01T10:00:00Z".to_owned(),
    }
}

/// Seed store-a / store-b profiles plus a workspace instance in each.
///
/// `workspace_instances.store_id` is NOT NULL with an FK to
/// `locations(id)`, so every instance created here is owned by
/// exactly one store.
fn seed_two_stores(conn: &Connection) {
    let s = store(conn);
    s.create_store_profile(&make_profile("store-a", "Store A"))
        .unwrap();
    s.create_store_profile(&make_profile("store-b", "Store B"))
        .unwrap();
    s.create_workspace_instance("ws-a-1", "store-pos", "store-a", "A POS", "", None)
        .unwrap();
    s.create_workspace_instance("ws-a-2", "warehouse", "store-a", "A WH", "", None)
        .unwrap();
    s.create_workspace_instance("ws-b-1", "admin", "store-b", "B Admin", "", None)
        .unwrap();
}

// ── Store-scoped listing ──────────────────────────────────────────────

/// The core API-layer audit: `list_all_instances(store_id)` must return
/// exactly that store's instances — never another store's row. Both
/// directions are asserted so isolation holds symmetrically.
#[test]
fn list_all_instances_returns_only_that_stores_instances() {
    let conn = setup();
    seed_two_stores(&conn);
    let s = store(&conn);

    let a = s.list_all_instances("store-a").unwrap();
    let a_ids: Vec<&str> = a.iter().map(|r| r.id.as_str()).collect();
    // ORDER BY name: "A POS" < "A WH"
    assert_eq!(a_ids, vec!["ws-a-1", "ws-a-2"]);
    assert!(
        a.iter().all(|r| r.store_id == "store-a"),
        "every returned instance must belong to store-a"
    );
    assert!(
        a.iter().all(|r| r.id != "ws-b-1"),
        "store-b's instance must never surface through a store-a scoped listing"
    );

    let b = s.list_all_instances("store-b").unwrap();
    let b_ids: Vec<&str> = b.iter().map(|r| r.id.as_str()).collect();
    assert_eq!(b_ids, vec!["ws-b-1"]);
    assert!(
        b.iter().all(|r| r.store_id == "store-b"),
        "every returned instance must belong to store-b"
    );
    assert!(
        b.iter().all(|r| r.id != "ws-a-1" && r.id != "ws-a-2"),
        "store-a's instances must never surface through a store-b scoped listing"
    );
}

/// `count_active_instances(store_id)` must count only that store's
/// instances — a cross-store count would inflate (or leak) another
/// store's rows.
#[test]
fn count_active_instances_is_store_scoped() {
    let conn = setup();
    seed_two_stores(&conn);
    let s = store(&conn);

    assert_eq!(s.count_active_instances("store-a").unwrap(), 2);
    assert_eq!(s.count_active_instances("store-b").unwrap(), 1);
}

/// An empty store scopes to zero instances — a scoped call never falls
/// back to other stores' rows.
#[test]
fn list_all_instances_empty_for_store_without_instances() {
    let conn = setup();
    seed_two_stores(&conn);
    let s = store(&conn);

    s.create_store_profile(&make_profile("store-c", "Store C"))
        .unwrap();
    let c = s.list_all_instances("store-c").unwrap();
    assert!(
        c.is_empty(),
        "store-c has no instances; scoped list must be empty"
    );
    assert_eq!(s.count_active_instances("store-c").unwrap(), 0);
}

// ── Ownership enforcement through the API ─────────────────────────────

/// The 066 FK (`workspace_instances.store_id` → `locations(id)`,
/// ON DELETE RESTRICT) is enforced on the write path: a caller cannot
/// create an instance for a store that does not exist. The failure is
/// pinned to the FK mechanism itself (a constraint violation, not some
/// unrelated error) by asserting the message names the foreign key.
#[test]
fn create_workspace_instance_for_missing_store_rejected() {
    let conn = setup();
    let s = store(&conn);

    let err =
        s.create_workspace_instance("ws-ghost", "store-pos", "ghost-store", "Ghost", "", None);
    let msg = err.unwrap_err().to_string();
    assert!(
        msg.contains("FOREIGN KEY"),
        "creating an instance for a missing store_profile must fail the FK, got: {msg}"
    );
}

// ── Domain-table scoped listing (migration 117 soft-scoping) ──────────
//
// The product/customer/sale catalogs are GLOBAL in the per-store database
// model (NULL store_id = the shared catalog). The soft-scoping layer for
// shared/cloud databases is `store_id IS NULL OR store_id = ?1` — a store
// sees the global rows PLUS its own tagged rows, never another store's.
// These tests prove the repository APIs enforce exactly that, in both
// directions.

/// Seed the two store profiles plus domain rows with store_id = store-a,
/// store-b, and NULL (global) across products, customers, and sales.
fn seed_domain_rows(conn: &Connection) {
    let s = store(conn);
    s.create_store_profile(&make_profile("store-a", "Store A"))
        .unwrap();
    s.create_store_profile(&make_profile("store-b", "Store B"))
        .unwrap();

    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, store_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params!["p-a", "SKU-A", "Prod A", 100, "USD", "store-a"],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, store_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params!["p-b", "SKU-B", "Prod B", 200, "USD", "store-b"],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, store_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            "p-global",
            "SKU-G",
            "Prod Global",
            300,
            "USD",
            Option::<&str>::None
        ],
    )
    .unwrap();

    conn.execute(
        "INSERT INTO customers (id, name, store_id) VALUES (?1, ?2, ?3)",
        rusqlite::params!["c-a", "Cust A", "store-a"],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO customers (id, name, store_id) VALUES (?1, ?2, ?3)",
        rusqlite::params!["c-b", "Cust B", "store-b"],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO customers (id, name, store_id) VALUES (?1, ?2, ?3)",
        rusqlite::params!["c-global", "Cust Global", Option::<&str>::None],
    )
    .unwrap();

    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, store_id)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params!["s-a", 1000, "USD", 1, "store-a"],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, store_id)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params!["s-b", 2000, "USD", 1, "store-b"],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, store_id)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params!["s-global", 3000, "USD", 1, Option::<&str>::None],
    )
    .unwrap();
}

/// `list_products_for_store` returns the global catalog plus that store's
/// own rows — never another store's rows, in either direction.
#[test]
fn list_products_for_store_returns_global_and_own_never_other_store() {
    let conn = setup();
    seed_domain_rows(&conn);
    let s = store(&conn);

    let a = s.list_products_for_store("store-a").unwrap();
    let mut a_ids: Vec<&str> = a.iter().map(|r| r.product.sku.as_str()).collect();
    a_ids.sort_unstable();
    assert_eq!(
        a_ids,
        vec!["SKU-A", "SKU-G"],
        "store-a must see its own row plus the global catalog, never store-b's"
    );

    let b = s.list_products_for_store("store-b").unwrap();
    let mut b_ids: Vec<&str> = b.iter().map(|r| r.product.sku.as_str()).collect();
    b_ids.sort_unstable();
    assert_eq!(
        b_ids,
        vec!["SKU-B", "SKU-G"],
        "store-b must see its own row plus the global catalog, never store-a's"
    );
}

/// `list_customers_for_store` returns the global customer base plus that
/// store's own rows — never another store's rows, in either direction.
#[test]
fn list_customers_for_store_returns_global_and_own_never_other_store() {
    let conn = setup();
    seed_domain_rows(&conn);
    let s = store(&conn);

    let a = s.list_customers_for_store("store-a").unwrap();
    let mut a_ids: Vec<&str> = a.iter().map(|c| c.id.as_str()).collect();
    a_ids.sort_unstable();
    assert_eq!(
        a_ids,
        vec!["c-a", "c-global"],
        "store-a must see its own customers plus the global base, never store-b's"
    );

    let b = s.list_customers_for_store("store-b").unwrap();
    let mut b_ids: Vec<&str> = b.iter().map(|c| c.id.as_str()).collect();
    b_ids.sort_unstable();
    assert_eq!(
        b_ids,
        vec!["c-b", "c-global"],
        "store-b must see its own customers plus the global base, never store-a's"
    );
}

/// `list_sales_for_store` returns the global sales plus that store's own
/// rows — never another store's rows, in either direction.
#[test]
fn list_sales_for_store_returns_global_and_own_never_other_store() {
    let conn = setup();
    seed_domain_rows(&conn);
    let s = store(&conn);

    let a = s.list_sales_for_store("store-a").unwrap();
    let mut a_ids: Vec<&str> = a.iter().map(|r| r.id.as_str()).collect();
    a_ids.sort_unstable();
    assert_eq!(
        a_ids,
        vec!["s-a", "s-global"],
        "store-a must see its own sales plus the global set, never store-b's"
    );

    let b = s.list_sales_for_store("store-b").unwrap();
    let mut b_ids: Vec<&str> = b.iter().map(|r| r.id.as_str()).collect();
    b_ids.sort_unstable();
    assert_eq!(
        b_ids,
        vec!["s-b", "s-global"],
        "store-b must see its own sales plus the global set, never store-a's"
    );
}

// ── Sync snapshot → scoped-read loop (ADR #6) ────────────────────────
//
// The snapshot transport contract carries `store_id` (migration 069/117
// soft-scoping). These tests prove the FULL loop: a server snapshot with
// store-a / store-b / NULL-tagged products is applied via `apply_snapshot`,
// and the scoped read APIs from the Phase A repair surface exactly the
// global+own set — never another store's rows. A snapshot tagging a store
// the local DB does not know is rejected by the FK (fail closed) instead
// of silently importing into the global catalog.

/// Apply a wire-format snapshot (as served by the cloud server) and return
/// the store for assertion.
fn apply_wire_snapshot<'a>(conn: &'a Connection, json: &'a str) -> oz_core::Store<'a> {
    let s = store(conn);
    s.create_store_profile(&make_profile("store-a", "Store A"))
        .unwrap();
    s.create_store_profile(&make_profile("store-b", "Store B"))
        .unwrap();
    let snap: oz_core::sync_client::Snapshot = serde_json::from_str(json).unwrap();
    oz_core::sync_client::apply_snapshot(&s, &snap).unwrap();
    s
}

/// A snapshot carrying store-scoped products must land scoped: store-a
/// reads see store-a + global rows, never store-b's, and the DB stays
/// FK-clean.
#[test]
fn snapshot_apply_preserves_store_scoping_end_to_end() {
    let conn = setup();
    let json = r#"{
        "products": [
            {"id": "p-a", "sku": "SKU-A", "name": "Prod A", "price_minor": 100, "currency": "USD", "store_id": "store-a"},
            {"id": "p-b", "sku": "SKU-B", "name": "Prod B", "price_minor": 200, "currency": "USD", "store_id": "store-b"},
            {"id": "p-g", "sku": "SKU-G", "name": "Prod Global", "price_minor": 300, "currency": "USD"}
        ]
    }"#;
    let s = apply_wire_snapshot(&conn, json);

    let a = s.list_products_for_store("store-a").unwrap();
    let mut a_ids: Vec<&str> = a.iter().map(|r| r.product.sku.as_str()).collect();
    a_ids.sort_unstable();
    assert_eq!(
        a_ids,
        vec!["SKU-A", "SKU-G"],
        "store-a must see its own snapshot row plus the global row, never store-b's"
    );

    let b = s.list_products_for_store("store-b").unwrap();
    let mut b_ids: Vec<&str> = b.iter().map(|r| r.product.sku.as_str()).collect();
    b_ids.sort_unstable();
    assert_eq!(
        b_ids,
        vec!["SKU-B", "SKU-G"],
        "store-b must see its own snapshot row plus the global row, never store-a's"
    );

    // FK integrity: the import must not have orphaned any store_id.
    let violations: i64 = conn
        .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(violations, 0, "snapshot import must leave no FK violations");
}

/// A snapshot that tags a product with a store the local DB does not know
/// must be rejected by the FK — never silently imported as global.
#[test]
fn snapshot_with_unknown_store_id_is_rejected_fail_closed() {
    let conn = setup();
    let json = r#"{
        "products": [
            {"id": "p-x", "sku": "SKU-X", "name": "Ghost", "price_minor": 100, "currency": "USD", "store_id": "ghost-store"}
        ]
    }"#;
    let s = store(&conn);
    s.create_store_profile(&make_profile("store-a", "Store A"))
        .unwrap();
    let snap: oz_core::sync_client::Snapshot = serde_json::from_str(json).unwrap();

    let err = oz_core::sync_client::apply_snapshot(&s, &snap);
    let msg = err.unwrap_err().to_string();
    assert!(
        msg.contains("FOREIGN KEY"),
        "snapshot row for an unknown store must fail the FK, got: {msg}"
    );

    // Nothing was imported — the transaction rolled back.
    assert!(s.list_products_for_store("store-a").unwrap().is_empty());
    assert!(
        conn.query_row("SELECT COUNT(*) FROM products", [], |r| r.get::<_, i64>(0))
            .unwrap()
            == 0,
        "failed snapshot must leave no rows behind"
    );
}
