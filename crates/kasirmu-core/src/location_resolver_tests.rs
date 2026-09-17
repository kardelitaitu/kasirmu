use super::*;

/// Create a pre-migrated in-memory connection for unit tests.
fn migrated() -> rusqlite::Connection {
    crate::migrations::fresh_db()
}

/// Seed the minimum rows needed to satisfy FK constraints when
/// inserting a `workspace_instances` test row.
fn seed_fks(conn: &rusqlite::Connection) {
    conn.execute_batch(
        "INSERT OR IGNORE INTO locations (id, name) VALUES ('store-1', 'Test Store');",
    )
    .unwrap();
}

#[test]
fn get_default_location_id_returns_canonical() {
    let loc = get_default_location_id();
    assert_eq!(loc.as_str(), CANONICAL_DEFAULT_LOCATION_UUID);
}

#[test]
fn resolve_primary_location_unbound_returns_canonical_default() {
    let conn = migrated();
    seed_fks(&conn);
    conn.execute(
        "INSERT OR IGNORE INTO workspace_instances (id, type_key, location_id, name) \
         VALUES ('ws-unbound', (SELECT key FROM workspace_types LIMIT 1), 'store-1', 'Unbound')",
        [],
    )
    .unwrap();
    let loc = resolve_primary_location(&conn, "ws-unbound", None).unwrap();
    assert_eq!(loc.as_str(), CANONICAL_DEFAULT_LOCATION_UUID);
}

#[test]
fn resolve_primary_location_single_binding_returns_bound() {
    let conn = migrated();
    seed_fks(&conn);
    conn.execute(
        "INSERT OR IGNORE INTO inventory_locations (id, name, type) \
         VALUES ('loc-store', 'Store', 'store')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT OR IGNORE INTO workspace_instances (id, type_key, location_id, name, bound_location_id) \
         VALUES ('ws-single', (SELECT key FROM workspace_types LIMIT 1), 'store-1', 'Single', 'loc-store')",
        [],
    )
    .unwrap();
    let loc = resolve_primary_location(&conn, "ws-single", None).unwrap();
    assert_eq!(loc.as_str(), "loc-store");
}

#[test]
fn resolve_primary_location_multi_binding_returns_is_primary() {
    let conn = migrated();
    seed_fks(&conn);
    conn.execute_batch(
        "INSERT OR IGNORE INTO inventory_locations (id, name, type) VALUES ('loc-1', 'A', 'store');\
         INSERT OR IGNORE INTO inventory_locations (id, name, type) VALUES ('loc-2', 'B', 'warehouse');\
         INSERT OR IGNORE INTO workspace_instances (id, type_key, location_id, name) \
           VALUES ('ws-multi', (SELECT key FROM workspace_types LIMIT 1), 'store-1', 'Multi');\
         INSERT OR IGNORE INTO workspace_inventory_locations (id, instance_id, location_id, is_primary, sort_order) \
           VALUES ('wsl-1', 'ws-multi', 'loc-2', 1, 0);\
         INSERT OR IGNORE INTO workspace_inventory_locations (id, instance_id, location_id, is_primary, sort_order) \
           VALUES ('wsl-2', 'ws-multi', 'loc-1', 0, 1);",
    )
    .unwrap();
    let loc = resolve_primary_location(&conn, "ws-multi", None).unwrap();
    assert_eq!(loc.as_str(), "loc-2");
}

#[test]
fn resolve_primary_location_explicit_override_wins() {
    let conn = migrated();
    seed_fks(&conn);
    conn.execute(
        "INSERT OR IGNORE INTO inventory_locations (id, name, type) VALUES ('loc-store', 'Store', 'store')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT OR IGNORE INTO workspace_instances (id, type_key, location_id, name, bound_location_id) \
         VALUES ('ws-single', (SELECT key FROM workspace_types LIMIT 1), 'store-1', 'Single', 'loc-store')",
        [],
    )
    .unwrap();
    let override_loc = LocationId::from("loc-override");
    let loc = resolve_primary_location(&conn, "ws-single", Some(&override_loc)).unwrap();
    assert_eq!(loc.as_str(), "loc-override");
}

#[test]
fn resolve_all_locations_single_binding() {
    let conn = migrated();
    seed_fks(&conn);
    conn.execute(
        "INSERT OR IGNORE INTO inventory_locations (id, name, type) VALUES ('loc-store', 'Store', 'store')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT OR IGNORE INTO workspace_instances (id, type_key, location_id, name, bound_location_id) \
         VALUES ('ws-single', (SELECT key FROM workspace_types LIMIT 1), 'store-1', 'Single', 'loc-store')",
        [],
    )
    .unwrap();
    let locs = resolve_all_locations(&conn, "ws-single").unwrap();
    assert_eq!(locs.len(), 1);
    assert_eq!(locs[0].as_str(), "loc-store");
}

#[test]
fn resolve_all_locations_multi_binding_primary_first() {
    let conn = migrated();
    seed_fks(&conn);
    conn.execute_batch(
        "INSERT OR IGNORE INTO inventory_locations (id, name, type) VALUES ('loc-3', 'C', 'store');\
         INSERT OR IGNORE INTO inventory_locations (id, name, type) VALUES ('loc-1', 'A', 'warehouse');\
         INSERT OR IGNORE INTO inventory_locations (id, name, type) VALUES ('loc-2', 'B', 'warehouse');\
         INSERT OR IGNORE INTO workspace_instances (id, type_key, location_id, name) \
           VALUES ('ws-multi', (SELECT key FROM workspace_types LIMIT 1), 'store-1', 'Multi');\
         INSERT OR IGNORE INTO workspace_inventory_locations (id, instance_id, location_id, is_primary, sort_order) \
           VALUES ('wsl-1', 'ws-multi', 'loc-1', 0, 1);\
         INSERT OR IGNORE INTO workspace_inventory_locations (id, instance_id, location_id, is_primary, sort_order) \
           VALUES ('wsl-2', 'ws-multi', 'loc-2', 1, 0);\
         INSERT OR IGNORE INTO workspace_inventory_locations (id, instance_id, location_id, is_primary, sort_order) \
           VALUES ('wsl-3', 'ws-multi', 'loc-3', 0, 2);",
    )
    .unwrap();
    let locs = resolve_all_locations(&conn, "ws-multi").unwrap();
    assert_eq!(locs.len(), 3, "expected 3 locations, got {locs:?}");
    // is_primary=1 sorts first, then by sort_order ASC.
    assert_eq!(locs[0].as_str(), "loc-2", "primary must be first");
    assert_eq!(locs[1].as_str(), "loc-1");
    assert_eq!(locs[2].as_str(), "loc-3");
}

#[test]
fn resolve_all_locations_unbound_returns_canonical() {
    let conn = migrated();
    seed_fks(&conn);
    conn.execute(
        "INSERT OR IGNORE INTO workspace_instances (id, type_key, location_id, name) \
         VALUES ('ws-unbound', (SELECT key FROM workspace_types LIMIT 1), 'store-1', 'Unbound')",
        [],
    )
    .unwrap();
    let locs = resolve_all_locations(&conn, "ws-unbound").unwrap();
    assert_eq!(locs.len(), 1);
    assert_eq!(locs[0].as_str(), CANONICAL_DEFAULT_LOCATION_UUID);
}

#[test]
fn resolve_location_chain_requires_one_location_when_primary_suffices() {
    // Greedy-fill: with qty=3 and Store having 5, only Store should be
    // returned — WH A is skipped because the demand is already covered.
    let conn = migrated();
    seed_fks(&conn);
    conn.execute_batch(
        "INSERT OR IGNORE INTO inventory_locations (id, name, type) VALUES ('loc-store', 'Store', 'store');\
         INSERT OR IGNORE INTO inventory_locations (id, name, type) VALUES ('loc-wh-a', 'WH A', 'warehouse');\
         INSERT OR IGNORE INTO products (id, sku, name, price_minor, currency, product_type) \
           VALUES ('prod-gf', 'GF-001', 'Greedy', 100, 'IDR', 'retail');\
         INSERT OR IGNORE INTO workspace_instances (id, type_key, location_id, name) \
           VALUES ('ws-gf', (SELECT key FROM workspace_types LIMIT 1), 'store-1', 'GF');\
         INSERT OR IGNORE INTO workspace_inventory_locations (id, instance_id, location_id, is_primary, sort_order) \
           VALUES ('wsl-gf-1', 'ws-gf', 'loc-store', 1, 0);\
         INSERT OR IGNORE INTO workspace_inventory_locations (id, instance_id, location_id, is_primary, sort_order) \
           VALUES ('wsl-gf-2', 'ws-gf', 'loc-wh-a', 0, 1);\
         INSERT OR IGNORE INTO stock_summary (item_id, location_id, qty) VALUES ('prod-gf', 'loc-store', 5);\
         INSERT OR IGNORE INTO stock_summary (item_id, location_id, qty) VALUES ('prod-gf', 'loc-wh-a', 500);",
    )
    .unwrap();
    // Only 3 units needed — Store has 5, so WH A is not included.
    let chain = resolve_location_chain_for_sku(&conn, "ws-gf", "GF-001", 3).unwrap();
    assert_eq!(chain.len(), 1, "primary suffices — only Store needed");
    assert_eq!(chain[0].location_name, "Store");
    assert_eq!(chain[0].qty_available, 5);
}

#[test]
fn resolve_location_chain_exact_fill_stops_at_exact_match() {
    // qty=5 exactly matches Store's stock — no need for WH A.
    let conn = migrated();
    seed_fks(&conn);
    conn.execute_batch(
        "INSERT OR IGNORE INTO inventory_locations (id, name, type) VALUES ('loc-store', 'Store', 'store');\
         INSERT OR IGNORE INTO inventory_locations (id, name, type) VALUES ('loc-wh-a', 'WH A', 'warehouse');\
         INSERT OR IGNORE INTO products (id, sku, name, price_minor, currency, product_type) \
           VALUES ('prod-ef', 'EF-001', 'Exact', 100, 'IDR', 'retail');\
         INSERT OR IGNORE INTO workspace_instances (id, type_key, location_id, name) \
           VALUES ('ws-ef', (SELECT key FROM workspace_types LIMIT 1), 'store-1', 'EF');\
         INSERT OR IGNORE INTO workspace_inventory_locations (id, instance_id, location_id, is_primary, sort_order) \
           VALUES ('wsl-ef-1', 'ws-ef', 'loc-store', 1, 0);\
         INSERT OR IGNORE INTO workspace_inventory_locations (id, instance_id, location_id, is_primary, sort_order) \
           VALUES ('wsl-ef-2', 'ws-ef', 'loc-wh-a', 0, 1);\
         INSERT OR IGNORE INTO stock_summary (item_id, location_id, qty) VALUES ('prod-ef', 'loc-store', 5);\
         INSERT OR IGNORE INTO stock_summary (item_id, location_id, qty) VALUES ('prod-ef', 'loc-wh-a', 500);",
    )
    .unwrap();
    let chain = resolve_location_chain_for_sku(&conn, "ws-ef", "EF-001", 5).unwrap();
    assert_eq!(chain.len(), 1, "exact match — only Store");
    assert_eq!(chain[0].qty_available, 5);
}

#[test]
fn resolve_location_chain_under_stock_includes_all_available() {
    // qty=600 exceeds Store(5) + WH A(500) — both locations included.
    let conn = migrated();
    seed_fks(&conn);
    conn.execute_batch(
        "INSERT OR IGNORE INTO inventory_locations (id, name, type) VALUES ('loc-store', 'Store', 'store');\
         INSERT OR IGNORE INTO inventory_locations (id, name, type) VALUES ('loc-wh-a', 'WH A', 'warehouse');\
         INSERT OR IGNORE INTO products (id, sku, name, price_minor, currency, product_type) \
           VALUES ('prod-us', 'US-001', 'Under', 100, 'IDR', 'retail');\
         INSERT OR IGNORE INTO workspace_instances (id, type_key, location_id, name) \
           VALUES ('ws-us', (SELECT key FROM workspace_types LIMIT 1), 'store-1', 'US');\
         INSERT OR IGNORE INTO workspace_inventory_locations (id, instance_id, location_id, is_primary, sort_order) \
           VALUES ('wsl-us-1', 'ws-us', 'loc-store', 1, 0);\
         INSERT OR IGNORE INTO workspace_inventory_locations (id, instance_id, location_id, is_primary, sort_order) \
           VALUES ('wsl-us-2', 'ws-us', 'loc-wh-a', 0, 1);\
         INSERT OR IGNORE INTO stock_summary (item_id, location_id, qty) VALUES ('prod-us', 'loc-store', 5);\
         INSERT OR IGNORE INTO stock_summary (item_id, location_id, qty) VALUES ('prod-us', 'loc-wh-a', 500);",
    )
    .unwrap();
    // 600 > 5 + 500 — can't fully satisfy, but all stocked locations included.
    let chain = resolve_location_chain_for_sku(&conn, "ws-us", "US-001", 600).unwrap();
    assert_eq!(chain.len(), 2, "all locations with stock still included");
    assert_eq!(chain[0].location_name, "Store");
    assert_eq!(chain[0].qty_available, 5);
    assert_eq!(chain[1].location_name, "WH A");
    assert_eq!(chain[1].qty_available, 500);
}

#[test]
fn resolve_location_chain_for_sku_returns_stocked_alternatives() {
    let conn = migrated();
    seed_fks(&conn);
    conn.execute_batch(
        "INSERT OR IGNORE INTO inventory_locations (id, name, type) VALUES ('loc-store', 'Store', 'store');\
         INSERT OR IGNORE INTO inventory_locations (id, name, type) VALUES ('loc-wh-a', 'WH A', 'warehouse');\
         INSERT OR IGNORE INTO inventory_locations (id, name, type) VALUES ('loc-wh-b', 'WH B', 'warehouse');\
         INSERT OR IGNORE INTO products (id, sku, name, price_minor, currency, product_type) \
           VALUES ('prod-test', 'CHO-001', 'Choco Bar', 15000, 'IDR', 'retail');\
         INSERT OR IGNORE INTO workspace_instances (id, type_key, location_id, name) \
           VALUES ('ws-multi', (SELECT key FROM workspace_types LIMIT 1), 'store-1', 'Multi');\
         INSERT OR IGNORE INTO workspace_inventory_locations (id, instance_id, location_id, is_primary, sort_order) \
           VALUES ('wsl-1', 'ws-multi', 'loc-store', 1, 0);\
         INSERT OR IGNORE INTO workspace_inventory_locations (id, instance_id, location_id, is_primary, sort_order) \
           VALUES ('wsl-2', 'ws-multi', 'loc-wh-a', 0, 1);\
         INSERT OR IGNORE INTO workspace_inventory_locations (id, instance_id, location_id, is_primary, sort_order) \
           VALUES ('wsl-3', 'ws-multi', 'loc-wh-b', 0, 2);\
         INSERT OR IGNORE INTO stock_summary (item_id, location_id, qty) VALUES ('prod-test', 'loc-store', 5);\
         INSERT OR IGNORE INTO stock_summary (item_id, location_id, qty) VALUES ('prod-test', 'loc-wh-a', 500);",
    )
    .unwrap();
    let chain = resolve_location_chain_for_sku(&conn, "ws-multi", "CHO-001", 20).unwrap();
    // loc-store has 5, loc-wh-a has 500, loc-wh-b has 0 (no stock row).
    assert_eq!(chain.len(), 2, "only locations with stock > 0 returned");
    assert_eq!(chain[0].location_name, "Store");
    assert_eq!(chain[0].qty_available, 5);
    assert_eq!(chain[1].location_name, "WH A");
    assert_eq!(chain[1].qty_available, 500);
}

#[test]
fn resolve_location_chain_for_sku_no_stock_anywhere_returns_empty() {
    let conn = migrated();
    seed_fks(&conn);
    conn.execute_batch(
        "INSERT OR IGNORE INTO inventory_locations (id, name, type) VALUES ('loc-1', 'A', 'store');\
         INSERT OR IGNORE INTO products (id, sku, name, price_minor, currency, product_type) \
           VALUES ('prod-empty', 'EMPTY', 'Empty', 100, 'IDR', 'retail');\
         INSERT OR IGNORE INTO workspace_instances (id, type_key, location_id, name) \
           VALUES ('ws-1', (SELECT key FROM workspace_types LIMIT 1), 'store-1', 'WS1');\
         INSERT OR IGNORE INTO workspace_inventory_locations (id, instance_id, location_id, is_primary, sort_order) \
           VALUES ('wsl-1', 'ws-1', 'loc-1', 1, 0);",
    )
    .unwrap();
    let chain = resolve_location_chain_for_sku(&conn, "ws-1", "EMPTY", 10).unwrap();
    assert!(chain.is_empty());
}

#[test]
fn resolve_primary_location_multi_binding_no_primary_returns_canonical() {
    let conn = migrated();
    seed_fks(&conn);
    conn.execute_batch(
        "INSERT OR IGNORE INTO inventory_locations (id, name, type) VALUES ('loc-a', 'A', 'store');\
         INSERT OR IGNORE INTO inventory_locations (id, name, type) VALUES ('loc-b', 'B', 'warehouse');\
         INSERT OR IGNORE INTO workspace_instances (id, type_key, location_id, name) \
           VALUES ('ws-no-primary', (SELECT key FROM workspace_types LIMIT 1), 'store-1', 'NoPrimary');\
         INSERT OR IGNORE INTO workspace_inventory_locations (id, instance_id, location_id, is_primary, sort_order) \
           VALUES ('wsl-a', 'ws-no-primary', 'loc-a', 0, 0);\
         INSERT OR IGNORE INTO workspace_inventory_locations (id, instance_id, location_id, is_primary, sort_order) \
           VALUES ('wsl-b', 'ws-no-primary', 'loc-b', 0, 1);",
    )
    .unwrap();
    let loc = resolve_primary_location(&conn, "ws-no-primary", None).unwrap();
    // Falls through to canonical default — no is_primary=1 row exists.
    assert_eq!(loc.as_str(), CANONICAL_DEFAULT_LOCATION_UUID);
}

// ── Cache tests ────────────────────────────────────────────────

#[test]
#[serial_test::serial]
fn location_cache_returns_cached_value_invalidation_forces_db_read() {
    // Uses entirely unique IDs to avoid any possible collision with seed data
    // or parallel test interference. The location name must be globally unique
    // due to the UNIQUE index on inventory_locations(name).
    let conn = migrated();
    seed_fks(&conn);
    conn.execute(
        "INSERT OR IGNORE INTO inventory_locations (id, name, type) VALUES ('loc-cache-zzz', 'Cache Test Loc Z99', 'store')",
        [],
    )
    .expect("insert inventory_locations");
    conn.execute(
        "INSERT OR IGNORE INTO workspace_instances (id, type_key, location_id, name, bound_location_id) \
         VALUES ('ws-cache-zz99', (SELECT key FROM workspace_types LIMIT 1), 'store-1', 'CacheTestZZ99', 'loc-cache-zzz')",
        [],
    )
    .expect("insert workspace_instances");

    invalidate_location_cache();

    // First call — hits DB, populates cache.
    let loc = resolve_primary_location(&conn, "ws-cache-zz99", None).unwrap();
    assert_eq!(loc.as_str(), "loc-cache-zzz");

    // Second call — verifies cache hit (immediate re-read).
    // Even if a parallel test invalidates between calls, the DB still
    // holds the same value, so the assertion stays green.
    let loc2 = resolve_primary_location(&conn, "ws-cache-zz99", None).unwrap();
    assert_eq!(
        loc2.as_str(),
        "loc-cache-zzz",
        "cache hit should return same value"
    );

    // Modify DB behind the cache.
    conn.execute(
        "INSERT OR IGNORE INTO inventory_locations (id, name, type) VALUES ('loc-fake-zz99', 'Cache Fake Loc Z99', 'warehouse')",
        [],
    )
    .expect("insert fake location for FK");
    let rows = conn
        .execute(
            "UPDATE workspace_instances SET bound_location_id = 'loc-fake-zz99' WHERE id = 'ws-cache-zz99'",
            [],
        )
        .expect("update bound_location_id");
    assert_eq!(rows, 1, "UPDATE must affect exactly 1 row");

    // Invalidate cache, then verify fresh DB read returns new value.
    invalidate_location_cache();

    let loc3 = resolve_primary_location(&conn, "ws-cache-zz99", None).unwrap();
    assert_eq!(
        loc3.as_str(),
        "loc-fake-zz99",
        "after invalidation, should read fresh DB value"
    );
}

#[test]
#[serial_test::serial]
fn location_cache_notfound_cleared_by_invalidation() {
    let conn = migrated();
    seed_fks(&conn);
    invalidate_location_cache();

    // Resolving a nonexistent workspace returns NotFound.
    let err = resolve_primary_location(&conn, "ws-noexist-cache", None).unwrap_err();
    assert!(
        matches!(
            err,
            CoreError::NotFound {
                entity: "workspace_instance",
                ..
            }
        ),
        "expected NotFound error"
    );

    // Create a workspace and resolve again.
    conn.execute_batch(
        "INSERT OR IGNORE INTO inventory_locations (id, name, type) VALUES ('loc-b', 'B', 'store');\
         INSERT OR IGNORE INTO workspace_instances (id, type_key, location_id, name, bound_location_id) \
           VALUES ('ws-noexist-cache', (SELECT key FROM workspace_types LIMIT 1), 'store-1', 'NowExists', 'loc-b');",
    )
    .unwrap();

    invalidate_location_cache();
    let ok_loc = resolve_primary_location(&conn, "ws-noexist-cache", None).unwrap();
    assert_eq!(
        ok_loc.as_str(),
        "loc-b",
        "must resolve after NotFound + invalidation"
    );
}

#[test]
#[serial_test::serial]
fn location_cache_explicit_override_never_cached() {
    let conn = migrated();
    seed_fks(&conn);
    conn.execute_batch(
        "INSERT OR IGNORE INTO inventory_locations (id, name, type) VALUES ('loc-z', 'Z', 'store');\
         INSERT OR IGNORE INTO workspace_instances (id, type_key, location_id, name, bound_location_id) \
           VALUES ('ws-override-cache', (SELECT key FROM workspace_types LIMIT 1), 'store-1', 'OCache', 'loc-z');",
    )
    .unwrap();

    invalidate_location_cache();

    // Call with explicit override — should return override, NOT bound.
    let ovr = LocationId::from("loc-override");
    let loc = resolve_primary_location(&conn, "ws-override-cache", Some(&ovr)).unwrap();
    assert_eq!(loc.as_str(), "loc-override");

    // After override, subsequent non-override call should hit DB.
    let loc2 = resolve_primary_location(&conn, "ws-override-cache", None).unwrap();
    assert_eq!(
        loc2.as_str(),
        "loc-z",
        "non-override call after override should hit DB"
    );
}

#[test]
fn resolve_primary_location_nonexistent_workspace_errors() {
    let conn = migrated();
    seed_fks(&conn);
    let err = resolve_primary_location(&conn, "ws-nonexistent", None).unwrap_err();
    assert!(matches!(
        err,
        CoreError::NotFound {
            entity: "workspace_instance",
            ..
        }
    ));
}

#[test]
fn resolve_all_locations_nonexistent_workspace_errors() {
    let conn = migrated();
    seed_fks(&conn);
    let err = resolve_all_locations(&conn, "ws-nonexistent").unwrap_err();
    assert!(matches!(
        err,
        CoreError::NotFound {
            entity: "workspace_instance",
            ..
        }
    ));
}

#[test]
fn resolve_location_chain_for_sku_nonexistent_product_errors() {
    let conn = migrated();
    seed_fks(&conn);
    conn.execute(
        "INSERT OR IGNORE INTO workspace_instances (id, type_key, location_id, name) \
         VALUES ('ws-1', (SELECT key FROM workspace_types LIMIT 1), 'store-1', 'WS1')",
        [],
    )
    .unwrap();
    let err = resolve_location_chain_for_sku(&conn, "ws-1", "NONEXISTENT-SKU", 10).unwrap_err();
    assert!(matches!(
        err,
        CoreError::NotFound {
            entity: "product",
            ..
        }
    ));
}

// ── get_workspace_locations tests (ADR-19 §10) ────────────────

#[test]
fn get_workspace_locations_unknown_type_returns_empty() {
    let conn = migrated();
    seed_fks(&conn);
    conn.execute(
        "INSERT OR IGNORE INTO workspace_instances (id, type_key, location_id, name) \
         VALUES ('ws-admin', 'admin', 'store-1', 'Admin')",
        [],
    )
    .unwrap();
    let locs = get_workspace_locations(&conn, "ws-admin", "admin").unwrap();
    assert!(locs.is_empty(), "admin type should have no locations");
}

#[test]
fn get_workspace_locations_store_pos_multi_binding() {
    let conn = migrated();
    seed_fks(&conn);
    conn.execute_batch(
        "INSERT OR IGNORE INTO inventory_locations (id, name, type) VALUES ('loc-a', 'Store Front', 'store');\
         INSERT OR IGNORE INTO inventory_locations (id, name, type) VALUES ('loc-b', 'Back Room', 'warehouse');\
         INSERT OR IGNORE INTO workspace_instances (id, type_key, location_id, name) \
           VALUES ('ws-pos', 'store-pos', 'store-1', 'Main POS');\
         INSERT OR IGNORE INTO workspace_inventory_locations (id, instance_id, location_id, is_primary, allow_negative_stock, sort_order) \
           VALUES ('wsl-1', 'ws-pos', 'loc-b', 1, 1, 0);\
         INSERT OR IGNORE INTO workspace_inventory_locations (id, instance_id, location_id, is_primary, allow_negative_stock, sort_order) \
           VALUES ('wsl-2', 'ws-pos', 'loc-a', 0, 0, 1);",
    )
    .unwrap();
    let locs = get_workspace_locations(&conn, "ws-pos", "store-pos").unwrap();
    assert_eq!(locs.len(), 2);
    // Primary first (is_primary=1).
    assert_eq!(locs[0].location_id, "loc-b");
    assert_eq!(locs[0].location_name, "Back Room");
    assert!(locs[0].is_primary);
    assert!(locs[0].allow_negative_stock);
    // Secondary.
    assert_eq!(locs[1].location_id, "loc-a");
    assert!(!locs[1].is_primary);
}

#[test]
fn get_workspace_locations_store_pos_no_bindings_returns_default() {
    let conn = migrated();
    seed_fks(&conn);
    conn.execute(
        "INSERT OR IGNORE INTO workspace_instances (id, type_key, location_id, name) \
         VALUES ('ws-pos-empty', 'store-pos', 'store-1', 'Empty POS')",
        [],
    )
    .unwrap();
    let locs = get_workspace_locations(&conn, "ws-pos-empty", "store-pos").unwrap();
    assert_eq!(locs.len(), 1);
    assert_eq!(locs[0].location_id, CANONICAL_DEFAULT_LOCATION_UUID);
    assert!(locs[0].is_primary);
}

#[test]
fn get_workspace_locations_warehouse_single_binding() {
    let conn = migrated();
    seed_fks(&conn);
    conn.execute(
        "INSERT OR IGNORE INTO inventory_locations (id, name, type) VALUES ('loc-wh', 'Main WH', 'warehouse')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT OR IGNORE INTO workspace_instances (id, type_key, location_id, name, bound_location_id) \
         VALUES ('ws-wh', 'warehouse', 'store-1', 'Warehouse', 'loc-wh')",
        [],
    )
    .unwrap();
    let locs = get_workspace_locations(&conn, "ws-wh", "warehouse").unwrap();
    assert_eq!(locs.len(), 1);
    assert_eq!(locs[0].location_id, "loc-wh");
    assert_eq!(locs[0].location_name, "Main WH");
    assert!(locs[0].is_primary);
}

#[test]
fn get_workspace_locations_warehouse_unbound_returns_all_active() {
    let conn = migrated();
    seed_fks(&conn);
    conn.execute_batch(
        "INSERT OR IGNORE INTO inventory_locations (id, name, type, is_active) VALUES ('loc-a', 'WH A', 'warehouse', 1);\
         INSERT OR IGNORE INTO inventory_locations (id, name, type, is_active) VALUES ('loc-b', 'Store B', 'store', 1);\
         INSERT OR IGNORE INTO inventory_locations (id, name, type, is_active) VALUES ('loc-c', 'Inactive C', 'warehouse', 0);\
         INSERT OR IGNORE INTO workspace_instances (id, type_key, location_id, name) \
           VALUES ('ws-wh-unbound', 'warehouse', 'store-1', 'Unbound WH');",
    )
    .unwrap();
    // Unbound warehouse should return all active locations.
    // Note: migration 078 seeds 2 canonical locations (default + transit),
    // plus our 2 added locations = 4 active total. The inactive one is excluded.
    let locs = get_workspace_locations(&conn, "ws-wh-unbound", "warehouse").unwrap();
    assert_eq!(locs.len(), 4, "2 canonical + 2 added = 4 active");
    assert!(locs.iter().any(|l| l.location_id == "loc-a"));
    assert!(locs.iter().any(|l| l.location_id == "loc-b"));
    assert!(
        !locs.iter().any(|l| l.location_id == "loc-c"),
        "inactive excluded"
    );
    // Verify canonical locations are included.
    assert!(locs.iter().any(|l| l.location_name.contains("Default")));
}

#[test]
fn get_workspace_locations_split_brain_errors() {
    let conn = migrated();
    seed_fks(&conn);
    conn.execute(
        "INSERT OR IGNORE INTO inventory_locations (id, name, type) VALUES ('loc-x', 'X', 'store')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT OR IGNORE INTO workspace_instances (id, type_key, location_id, name, bound_location_id) \
         VALUES ('ws-brain', 'store-pos', 'store-1', 'SplitBrain', 'loc-x')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT OR IGNORE INTO workspace_inventory_locations (id, instance_id, location_id, is_primary, sort_order) \
         VALUES ('wsl-brain', 'ws-brain', 'loc-x', 1, 0)",
        [],
    )
    .unwrap();
    let err = get_workspace_locations(&conn, "ws-brain", "store-pos").unwrap_err();
    assert!(matches!(
        err,
        CoreError::Validation {
            field: "workspace_binding",
            ..
        }
    ));
    assert!(
        err.to_string().contains("split-brain"),
        "error should mention split-brain"
    );
}

#[test]
fn get_workspace_locations_nonexistent_instance_errors() {
    let conn = migrated();
    seed_fks(&conn);
    let err = get_workspace_locations(&conn, "ws-nonexistent", "store-pos").unwrap_err();
    assert!(matches!(
        err,
        CoreError::NotFound {
            entity: "workspace_instance",
            ..
        }
    ));
}

#[test]
fn get_workspace_locations_warehouse_type_key_from_instance() {
    // Test with a workspace_instances row that has type_key='warehouse'
    // but we pass type_key='store-pos' — verifies the parameter is honored.
    let conn = migrated();
    seed_fks(&conn);
    conn.execute(
        "INSERT OR IGNORE INTO inventory_locations (id, name, type) VALUES ('loc-wh', 'WH', 'warehouse')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT OR IGNORE INTO workspace_instances (id, type_key, location_id, name, bound_location_id) \
         VALUES ('ws-wh', 'warehouse', 'store-1', 'WH Instance', 'loc-wh')",
        [],
    )
    .unwrap();
    // Call with type_key='store-pos' (different from instance's type_key).
    // store-pos with single binding + no multi-rows → falls back to default.
    let locs = get_workspace_locations(&conn, "ws-wh", "store-pos").unwrap();
    // store-pos with bound_location_id set but no multi-rows: the bound is IGNORED
    // (store-pos resolves from workspace_inventory_locations, not bound_location_id).
    // No multi-rows means we go to default.
    assert_eq!(locs.len(), 1);
    assert_eq!(locs[0].location_id, CANONICAL_DEFAULT_LOCATION_UUID);
}
