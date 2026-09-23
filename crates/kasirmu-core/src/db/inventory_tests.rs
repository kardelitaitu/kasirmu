use super::*;
use crate::migrations;
use crate::subscription::SubscriptionTier;
use rusqlite::Connection;

/// A provisioned store. See `migrations::seed_provisioned_baseline` for why
/// the baseline rows are seeded here rather than shipped by the migration
/// (ADR #56 §2.6).
fn fresh() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    migrations::run(&mut conn).unwrap();
    migrations::seed_provisioned_baseline(&conn);
    conn
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

#[test]
fn test_locations_crud() {
    let conn = fresh();
    let s = store(&conn);

    let id1 = s
        .create_inventory_location("Warehouse A", "warehouse", "Primary warehouse")
        .unwrap();
    let _id2 = s
        .create_inventory_location("Store Front", "store", "POS register floor")
        .unwrap();

    let locs = s.list_inventory_locations().unwrap();
    assert_eq!(locs.len(), 4); // 2 seeded default/transit + 2 new
    assert_eq!(locs[2].name, "Store Front");
    assert_eq!(locs[3].name, "Warehouse A");

    s.update_inventory_location(&id1, "Warehouse A Updated", "warehouse", "Updated desc")
        .unwrap();
    let locs = s.list_inventory_locations().unwrap();
    let updated = locs.iter().find(|l| l.id == id1).unwrap();
    assert_eq!(updated.name, "Warehouse A Updated");
    assert_eq!(updated.description, "Updated desc");

    s.deactivate_inventory_location(&id1).unwrap();
    let locs = s.list_inventory_locations().unwrap();
    let deactivated = locs.iter().find(|l| l.id == id1).unwrap();
    assert!(!deactivated.is_active);
}

#[test]
fn test_workspace_locations() {
    let conn = fresh();
    // Seed workspace type and instance
    conn.execute(
        "INSERT OR IGNORE INTO workspace_types (key, name) VALUES ('retail', 'Retail POS')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO workspace_instances (id, type_key, location_id, name) VALUES ('ws-1', 'retail', 'default', 'Main POS')",
        []
    ).unwrap();
    let s = store(&conn);

    let loc_id = s
        .create_inventory_location("Warehouse A", "warehouse", "")
        .unwrap();
    let bindings = vec![WorkspaceInventoryLocation {
        id: "".to_owned(),
        instance_id: "ws-1".to_owned(),
        location_id: loc_id.clone(),
        is_primary: true,
        allow_negative_stock: true,
        sort_order: 1,
    }];

    s.set_workspace_inventory_locations("ws-1", &bindings)
        .unwrap();
    let retrieved = s.get_workspace_inventory_locations("ws-1").unwrap();
    assert_eq!(retrieved.len(), 1);
    assert_eq!(retrieved[0].location_id, loc_id);
    assert!(retrieved[0].allow_negative_stock);
}

#[test]
fn test_shifts() {
    let conn = fresh();
    // Seed a role and user
    conn.execute(
        "INSERT INTO roles (id, name, description, permissions) VALUES ('r-1', 'Role', 'Desc', '[]')",
        []
    ).unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id) VALUES ('u-1', 'user', 'hash', 'User', 'r-1')",
        []
    ).unwrap();
    let s = store(&conn);

    let loc_id = s
        .create_inventory_location("Warehouse A", "warehouse", "")
        .unwrap();

    // Start shift
    let shift = s
        .start_inventory_shift("u-1", &loc_id, None, "shift notes")
        .unwrap();
    assert_eq!(shift.status, "active");
    assert!(shift.ended_at.is_none());

    // Attempting to open another active shift at the same location should error
    let err = s
        .start_inventory_shift("u-1", &loc_id, None, "")
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { .. }));

    let active = s.get_active_inventory_shift("u-1").unwrap();
    assert_eq!(active.unwrap().id, shift.id);

    s.end_inventory_shift(&shift.id).unwrap();
    let active = s.get_active_inventory_shift("u-1").unwrap();
    assert!(active.is_none());
}

#[test]
fn test_thresholds() {
    let conn = fresh();
    // Seed a product
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency) VALUES ('p-1', 'SKU-1', 'Prod 1', 100, 'USD')",
        []
    ).unwrap();
    let s = store(&conn);

    let loc_id = s
        .create_inventory_location("Warehouse A", "warehouse", "")
        .unwrap();

    s.set_stock_threshold("p-1", Some(&loc_id), 10, true)
        .unwrap();
    let list = s.get_stock_thresholds(Some(&loc_id)).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].threshold, 10);

    s.delete_stock_threshold(&list[0].id).unwrap();
    let list = s.get_stock_thresholds(Some(&loc_id)).unwrap();
    assert_eq!(list.len(), 0);
}

// ── Validation & Error Paths ──────────────────────────────────────

#[test]
fn create_inventory_location_invalid_type_errors() {
    let conn = fresh();
    let s = store(&conn);
    let err = s
        .create_inventory_location("Bad", "invalid_type", "")
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field: "type", .. }));
}

#[test]
fn create_inventory_location_empty_name_rejected() {
    let conn = fresh();
    let s = store(&conn);
    let err = s.create_inventory_location("", "store", "").unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "name"));
}

#[test]
fn create_inventory_location_whitespace_name_rejected() {
    let conn = fresh();
    let s = store(&conn);
    let err = s.create_inventory_location("   ", "store", "").unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "name"));
}

#[test]
fn update_inventory_location_nonexistent_errors() {
    let conn = fresh();
    let s = store(&conn);
    let err = s
        .update_inventory_location("nonexistent-id", "New", "store", "")
        .unwrap_err();
    assert!(matches!(
        err,
        CoreError::NotFound {
            entity: "inventory_location",
            ..
        }
    ));
}

#[test]
fn deactivate_inventory_location_with_stock_errors() {
    let conn = fresh();
    let s = store(&conn);

    let loc_id = s
        .create_inventory_location("Test Loc", "store", "")
        .unwrap();
    // Seed a product with stock at this location
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, product_type) \
         VALUES ('prod-1', 'SKU-1', 'Prod', 100, 'USD', 'retail')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO stock_summary (item_id, location_id, qty) VALUES ('prod-1', ?1, 5)",
        params![loc_id],
    )
    .unwrap();

    let err = s.deactivate_inventory_location(&loc_id).unwrap_err();
    assert!(matches!(
        err,
        CoreError::Validation {
            field: "location",
            ..
        }
    ));
    assert!(
        err.to_string().contains("non-zero stock balance"),
        "expected non-zero stock balance message, got: {}",
        err
    );
}

#[test]
fn deactivate_inventory_location_with_negative_stock_errors() {
    let conn = fresh();
    let s = store(&conn);

    let loc_id = s
        .create_inventory_location("Negative Loc", "store", "")
        .unwrap();
    // Seed a product with a NEGATIVE balance at this location — a negative
    // balance must block deactivation just like a positive one (LOC-02).
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, product_type) \
         VALUES ('prod-neg', 'SKU-NEG', 'Prod', 100, 'USD', 'retail')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO stock_summary (item_id, location_id, qty) VALUES ('prod-neg', ?1, -3)",
        params![loc_id],
    )
    .unwrap();

    let err = s.deactivate_inventory_location(&loc_id).unwrap_err();
    assert!(matches!(
        err,
        CoreError::Validation {
            field: "location",
            ..
        }
    ));
    assert!(
        err.to_string().contains("non-zero stock balance"),
        "expected non-zero stock balance message, got: {}",
        err
    );
    // The location must still be active afterwards.
    let active: i64 = conn
        .query_row(
            "SELECT is_active FROM inventory_locations WHERE id = ?1",
            params![loc_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        active, 1,
        "location must remain active after failed deactivation"
    );
}

#[test]
fn deactivate_inventory_location_with_zero_balance_succeeds() {
    let conn = fresh();
    let s = store(&conn);

    let loc_id = s
        .create_inventory_location("Zero Loc", "store", "")
        .unwrap();
    // A zero-balance row must NOT block deactivation.
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, product_type) \
         VALUES ('prod-zero', 'SKU-ZERO', 'Prod', 100, 'USD', 'retail')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO stock_summary (item_id, location_id, qty) VALUES ('prod-zero', ?1, 0)",
        params![loc_id],
    )
    .unwrap();

    s.deactivate_inventory_location(&loc_id).unwrap();
    let active: i64 = conn
        .query_row(
            "SELECT is_active FROM inventory_locations WHERE id = ?1",
            params![loc_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(active, 0, "zero-balance location should deactivate");
}

#[test]
fn deactivate_inventory_location_nonexistent_errors() {
    let conn = fresh();
    let s = store(&conn);
    // A missing ID must surface a NotFound error rather than a silent no-op (LOC-03).
    let err = s.deactivate_inventory_location("nonexistent").unwrap_err();
    assert!(matches!(
        err,
        CoreError::NotFound {
            entity: "inventory_location",
            ..
        }
    ));
}

#[test]
fn deactivate_inventory_location_already_inactive_errors() {
    let conn = fresh();
    let s = store(&conn);

    let loc_id = s
        .create_inventory_location("Inactive Loc", "store", "")
        .unwrap();
    s.deactivate_inventory_location(&loc_id).unwrap();

    // Deactivating an already-inactive location should report a clear error.
    let err = s.deactivate_inventory_location(&loc_id).unwrap_err();
    assert!(matches!(
        err,
        CoreError::Validation {
            field: "location",
            ..
        }
    ));
    assert!(
        err.to_string().contains("already inactive"),
        "expected already-inactive message, got: {}",
        err
    );
}

#[test]
fn get_workspace_locations_empty_for_unbound_workspace() {
    let conn = fresh();
    let s = store(&conn);
    conn.execute(
        "INSERT OR IGNORE INTO workspace_types (key, name) VALUES ('retail', 'Retail POS')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO workspace_instances (id, type_key, location_id, name) \
         VALUES ('ws-empty', 'retail', 'default', 'Empty')",
        [],
    )
    .unwrap();

    let locs = s.get_workspace_inventory_locations("ws-empty").unwrap();
    assert!(locs.is_empty());
}

#[test]
fn end_inventory_shift_nonexistent_errors() {
    let conn = fresh();
    let s = store(&conn);
    let err = s.end_inventory_shift("nonexistent-shift").unwrap_err();
    assert!(matches!(
        err,
        CoreError::NotFound {
            entity: "active_inventory_shift",
            ..
        }
    ));
}

#[test]
fn list_inventory_shifts_empty_returns_empty() {
    let conn = fresh();
    let s = store(&conn);
    let shifts = s.list_inventory_shifts().unwrap();
    assert!(shifts.is_empty());
}
#[test]
fn test_inventory_transaction_lifecycle() {
    let conn = fresh();
    let s = store(&conn);

    // Seed FK rows: role + user for staff_id constraint
    conn.execute(
        "INSERT INTO roles (id, name, description, permissions) VALUES ('r-inv', 'InvRole', '', '[]')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id) VALUES ('staff-1', 'staff1', 'hash', 'Staff 1', 'r-inv')",
        [],
    )
    .unwrap();

    // Seed a location and product with stock
    let loc_id = s.create_inventory_location("Store", "store", "").unwrap();
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, product_type) \
         VALUES ('prod-stock', 'STOCK-SKU', 'Stocked', 1000, 'USD', 'retail')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO stock_summary (item_id, location_id, qty) VALUES ('prod-stock', ?1, 100)",
        params![loc_id],
    )
    .unwrap();

    // Create a stock-count transaction with one line (no delta change, just audit)
    let lines = vec![InventoryTransactionLineInput {
        sku: "STOCK-SKU".into(),
        product_name: "Stocked Product".into(),
        qty: 50,
        delta: 0,
        barcode_scanned: None,
    }];
    let tx_id = s
        .create_inventory_transaction(
            crate::inventory_transaction::InventoryTransactionType::StockCount,
            &loc_id,
            "staff-1",
            "audit notes",
            &lines,
        )
        .unwrap();
    assert!(!tx_id.is_empty());

    // Verify it appears in list
    let txns = s.list_inventory_transactions().unwrap();
    assert_eq!(txns.len(), 1);
    assert_eq!(txns[0].id.as_str(), tx_id);
    assert_eq!(txns[0].notes, "audit notes");

    // Verify we can get the full transaction with lines
    let (header, detail_lines) = s.get_inventory_transaction(&tx_id).unwrap().unwrap();
    assert_eq!(header.id.as_str(), tx_id);
    assert_eq!(detail_lines.len(), 1);
    assert_eq!(detail_lines[0].sku, "STOCK-SKU");
    assert_eq!(detail_lines[0].qty, 50);
}

#[test]
fn get_inventory_transaction_not_found_returns_none() {
    let conn = fresh();
    let s = store(&conn);
    let result = s.get_inventory_transaction("nonexistent-tx").unwrap();
    assert!(result.is_none());
}

#[test]
fn list_inventory_transactions_empty() {
    let conn = fresh();
    let s = store(&conn);
    let txns = s.list_inventory_transactions().unwrap();
    assert!(txns.is_empty());
}

#[test]
fn list_inventory_transactions_for_shift_filters_by_staff_location_and_time() {
    let conn = fresh();
    let s = store(&conn);
    conn.execute(
        "INSERT INTO roles (id, name, description, permissions) VALUES ('r-inv3', 'InvRole3', '', '[]')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id) VALUES ('staff-a', 'a', 'hash', 'A', 'r-inv3')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id) VALUES ('staff-b', 'b', 'hash', 'B', 'r-inv3')",
        [],
    )
    .unwrap();

    let loc_a = s.create_inventory_location("Loc A", "store", "").unwrap();
    let loc_b = s
        .create_inventory_location("Loc B", "warehouse", "")
        .unwrap();
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, product_type) \
         VALUES ('p-shift', 'SKU-SHIFT', 'Shift Item', 100, 'USD', 'retail')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO stock_summary (item_id, location_id, qty) VALUES ('p-shift', ?1, 100)",
        params![loc_a],
    )
    .unwrap();

    let line = InventoryTransactionLineInput {
        sku: "SKU-SHIFT".into(),
        product_name: "Shift".into(),
        qty: 1,
        delta: 0,
        barcode_scanned: None,
    };

    // Create a transaction for staff-a at loc-a (within window).
    let tx_a = s
        .create_inventory_transaction(
            crate::inventory_transaction::InventoryTransactionType::StockCount,
            &loc_a,
            "staff-a",
            "staff-a at loc-a",
            std::slice::from_ref(&line),
        )
        .unwrap();

    // Create a transaction for staff-a at loc-b (different location).
    let _tx_a_loc_b = s
        .create_inventory_transaction(
            crate::inventory_transaction::InventoryTransactionType::StockCount,
            &loc_b,
            "staff-a",
            "staff-a at loc-b",
            std::slice::from_ref(&line),
        )
        .unwrap();

    // Create a transaction for staff-b at loc-a (different staff).
    let _tx_b = s
        .create_inventory_transaction(
            crate::inventory_transaction::InventoryTransactionType::StockCount,
            &loc_a,
            "staff-b",
            "staff-b at loc-a",
            std::slice::from_ref(&line),
        )
        .unwrap();

    let since = "2020-01-01T00:00:00.000Z";

    // Should only return staff-a at loc-a.
    let filtered = s
        .list_inventory_transactions_for_shift("staff-a", &loc_a, since)
        .unwrap();
    assert_eq!(filtered.len(), 1, "should only find the matching tx");
    assert_eq!(filtered[0].id.as_str(), tx_a);

    // Empty result for a different staff.
    let none = s
        .list_inventory_transactions_for_shift("staff-b", &loc_b, since)
        .unwrap();
    assert!(none.is_empty(), "no transactions for staff-b at loc-b");
}

#[test]
fn test_stock_threshold_upsert_updates_existing() {
    let conn = fresh();
    let s = store(&conn);
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency) VALUES ('p-upsert', 'SKU-U', 'Upsert', 100, 'USD')",
        [],
    )
    .unwrap();

    // Create initial threshold
    s.set_stock_threshold("p-upsert", None, 10, true).unwrap();
    let list = s.get_stock_thresholds(None).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].threshold, 10);
    assert!(list[0].enabled);

    // Upsert: update threshold value and disable
    s.set_stock_threshold("p-upsert", None, 25, false).unwrap();
    let list = s.get_stock_thresholds(None).unwrap();
    assert_eq!(list.len(), 1, "upsert should not create duplicate");
    assert_eq!(list[0].threshold, 25);
    assert!(!list[0].enabled);
}

#[test]
fn test_stock_threshold_global_vs_per_location() {
    let conn = fresh();
    let s = store(&conn);
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency) VALUES ('p-glob', 'SKU-G', 'Global', 100, 'USD')",
        [],
    )
    .unwrap();
    let loc_id = s
        .create_inventory_location("Test Loc", "store", "")
        .unwrap();

    // Set a global threshold (null location_id)
    s.set_stock_threshold("p-glob", None, 5, true).unwrap();
    // Set a per-location threshold
    s.set_stock_threshold("p-glob", Some(&loc_id), 15, true)
        .unwrap();

    let global_list = s.get_stock_thresholds(None).unwrap();
    assert_eq!(global_list.len(), 1);
    assert_eq!(global_list[0].threshold, 5);

    let loc_list = s.get_stock_thresholds(Some(&loc_id)).unwrap();
    assert_eq!(loc_list.len(), 1);
    assert_eq!(loc_list[0].threshold, 15);
}

#[test]
fn set_workspace_locations_replaces_existing_bindings() {
    let conn = fresh();
    let s = store(&conn);
    conn.execute(
        "INSERT OR IGNORE INTO workspace_types (key, name) VALUES ('retail', 'Retail POS')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO workspace_instances (id, type_key, location_id, name) \
         VALUES ('ws-replace', 'retail', 'default', 'Replace')",
        [],
    )
    .unwrap();

    let loc_a = s.create_inventory_location("Loc A", "store", "").unwrap();
    let loc_b = s
        .create_inventory_location("Loc B", "warehouse", "")
        .unwrap();

    // Set initial binding
    let initial = vec![WorkspaceInventoryLocation {
        id: String::new(),
        instance_id: "ws-replace".into(),
        location_id: loc_a.clone(),
        is_primary: true,
        allow_negative_stock: false,
        sort_order: 0,
    }];
    s.set_workspace_inventory_locations("ws-replace", &initial)
        .unwrap();

    // Replace with two bindings (different locations, different settings)
    let replacement = vec![
        WorkspaceInventoryLocation {
            id: String::new(),
            instance_id: "ws-replace".into(),
            location_id: loc_b.clone(),
            is_primary: true,
            allow_negative_stock: true,
            sort_order: 0,
        },
        WorkspaceInventoryLocation {
            id: String::new(),
            instance_id: "ws-replace".into(),
            location_id: loc_a.clone(),
            is_primary: false,
            allow_negative_stock: false,
            sort_order: 1,
        },
    ];
    s.set_workspace_inventory_locations("ws-replace", &replacement)
        .unwrap();

    let retrieved = s.get_workspace_inventory_locations("ws-replace").unwrap();
    assert_eq!(retrieved.len(), 2);
    // First should be primary (loc_b)
    assert_eq!(retrieved[0].location_id, loc_b);
    assert!(retrieved[0].is_primary);
    assert!(retrieved[0].allow_negative_stock);
    // Second should be secondary (loc_a)
    assert_eq!(retrieved[1].location_id, loc_a);
    assert!(!retrieved[1].is_primary);
    assert!(!retrieved[1].allow_negative_stock);
}

#[test]
fn update_inventory_location_invalid_type_errors() {
    let conn = fresh();
    let s = store(&conn);
    let loc_id = s.create_inventory_location("Valid", "store", "").unwrap();
    let err = s
        .update_inventory_location(&loc_id, "Bad", "invalid_type", "")
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field: "type", .. }));
}

#[test]
fn update_inventory_location_empty_name_rejected() {
    let conn = fresh();
    let s = store(&conn);
    let loc_id = s.create_inventory_location("Valid", "store", "").unwrap();
    let err = s
        .update_inventory_location(&loc_id, "", "store", "")
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "name"));
}

#[test]
fn create_inventory_transaction_adjusts_stock() {
    let conn = fresh();
    let s = store(&conn);

    // Seed FK rows: role + user for staff_id constraint
    conn.execute(
        "INSERT INTO roles (id, name, description, permissions) VALUES ('r-inv2', 'InvRole2', '', '[]')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id) VALUES ('staff-2', 'staff2', 'hash', 'Staff 2', 'r-inv2')",
        [],
    )
    .unwrap();

    let loc_id = s
        .create_inventory_location("Warehouse", "warehouse", "")
        .unwrap();
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, product_type) \
         VALUES ('prod-delta', 'DELTA', 'Delta Item', 500, 'USD', 'retail')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO stock_summary (item_id, location_id, qty) VALUES ('prod-delta', ?1, 50)",
        params![loc_id],
    )
    .unwrap();

    // Create a manual adjustment: add 10 units
    let lines = vec![InventoryTransactionLineInput {
        sku: "DELTA".into(),
        product_name: "Delta Item".into(),
        qty: 10,
        delta: 10, // positive = credit
        barcode_scanned: None,
    }];
    s.create_inventory_transaction(
        crate::inventory_transaction::InventoryTransactionType::ManualAdjustment,
        &loc_id,
        "staff-2",
        "added 10 units",
        &lines,
    )
    .unwrap();

    // Verify stock increased
    let stock: i64 = conn
        .query_row(
            "SELECT COALESCE(qty, 0) FROM stock_summary \
             WHERE item_id = 'prod-delta' AND location_id = ?1",
            params![loc_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(stock, 60, "stock should have increased by 10");
}

// ── Extended edge cases (coverage 19→30) ──────────────────────────

#[test]
fn start_shift_nonexistent_user_fk_errors() {
    let conn = fresh();
    let s = store(&conn);
    let loc_id = s
        .create_inventory_location("Test Loc", "store", "")
        .unwrap();
    let err = s
        .start_inventory_shift("nonexistent-user", &loc_id, None, "")
        .unwrap_err();
    // FK violation on users(id) returns a rusqlite error wrapped in CoreError::Db
    assert!(matches!(err, CoreError::Db(_)));
}

#[test]
fn end_already_ended_shift_errors() {
    let conn = fresh();
    let s = store(&conn);
    conn.execute(
        "INSERT INTO roles (id, name, description, permissions) VALUES ('r-eae', 'Role', '', '[]')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id) \
         VALUES ('u-eae', 'user', 'hash', 'User', 'r-eae')",
        [],
    )
    .unwrap();
    let loc_id = s.create_inventory_location("Loc", "store", "").unwrap();

    let shift = s.start_inventory_shift("u-eae", &loc_id, None, "").unwrap();
    s.end_inventory_shift(&shift.id).unwrap();

    // Ending again should error
    let err = s.end_inventory_shift(&shift.id).unwrap_err();
    assert!(
        matches!(err, CoreError::NotFound { entity, .. } if entity == "active_inventory_shift")
    );
}

#[test]
fn list_shifts_orders_by_started_at_desc() {
    let conn = fresh();
    let s = store(&conn);
    conn.execute(
        "INSERT INTO roles (id, name, description, permissions) VALUES ('r-ord', 'Role', '', '[]')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id) \
         VALUES ('u-ord', 'user', 'hash', 'User', 'r-ord')",
        [],
    )
    .unwrap();
    let loc_id = s.create_inventory_location("Loc", "store", "").unwrap();

    let shift1 = s
        .start_inventory_shift("u-ord", &loc_id, None, "first")
        .unwrap();
    // End shift1 first so we can start shift2
    s.end_inventory_shift(&shift1.id).unwrap();

    std::thread::sleep(std::time::Duration::from_millis(10));
    let _shift2 = s
        .start_inventory_shift("u-ord", &loc_id, None, "second")
        .unwrap();

    let all = s.list_inventory_shifts().unwrap();
    assert_eq!(all.len(), 2);
    // Most recent first
    assert_eq!(all[0].notes, "second");
    assert_eq!(all[1].notes, "first");
}

#[test]
fn deactivate_location_with_pending_transfers_errors() {
    let conn = fresh();
    let s = store(&conn);
    let loc_id = s.create_inventory_location("Loc", "store", "").unwrap();

    // Seed user + transfer referencing this location
    conn.execute(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) \
         VALUES ('r-deact', 'Role', '', '[]', 'now', 'now')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, created_at, updated_at) \
         VALUES ('u-deact', 'user', 'hash', 'User', 'r-deact', 'now', 'now')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO stock_transfers (id, transfer_number, status, source_location_id, destination_location_id, \
         created_by, created_at, updated_at) \
         VALUES ('tr-pend', 'TRF-1', 'in_transit', ?1, ?1, 'u-deact', 'now', 'now')",
        params![loc_id],
    )
    .unwrap();

    let err = s.deactivate_inventory_location(&loc_id).unwrap_err();
    assert!(
        err.to_string().contains("pending stock transfers"),
        "expected pending transfer message, got: {}",
        err
    );
}

#[test]
fn create_transaction_with_multiple_lines_and_barcode() {
    let conn = fresh();
    let s = store(&conn);
    conn.execute(
        "INSERT INTO roles (id, name, description, permissions) VALUES ('r-ml', 'Role', '', '[]')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id) VALUES ('staff-ml', 's', 'hash', 'S', 'r-ml')",
        [],
    )
    .unwrap();
    let loc_id = s.create_inventory_location("Loc", "store", "").unwrap();
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, product_type) \
         VALUES ('p-a', 'SKU-A', 'A', 100, 'USD', 'retail')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, product_type) \
         VALUES ('p-b', 'SKU-B', 'B', 200, 'USD', 'retail')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO stock_summary (item_id, location_id, qty) VALUES ('p-a', ?1, 20)",
        params![loc_id],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO stock_summary (item_id, location_id, qty) VALUES ('p-b', ?1, 30)",
        params![loc_id],
    )
    .unwrap();

    let lines = vec![
        InventoryTransactionLineInput {
            sku: "SKU-A".into(),
            product_name: "Product A".into(),
            qty: 10,
            delta: -5,
            barcode_scanned: Some("BARCODE-A".into()),
        },
        InventoryTransactionLineInput {
            sku: "SKU-B".into(),
            product_name: "Product B".into(),
            qty: 5,
            delta: 3,
            barcode_scanned: None,
        },
    ];
    let tx_id = s
        .create_inventory_transaction(
            crate::inventory_transaction::InventoryTransactionType::ManualAdjustment,
            &loc_id,
            "staff-ml",
            "multi-line + barcode",
            &lines,
        )
        .unwrap();

    let (_, detail_lines) = s.get_inventory_transaction(&tx_id).unwrap().unwrap();
    assert_eq!(detail_lines.len(), 2);
    // Lines ordered by sort_order
    assert_eq!(detail_lines[0].sku, "SKU-A");
    assert_eq!(detail_lines[0].qty, 10);
    assert_eq!(
        detail_lines[0].barcode_scanned.as_deref(),
        Some("BARCODE-A")
    );
    assert_eq!(detail_lines[1].sku, "SKU-B");
    assert_eq!(detail_lines[1].qty, 5);
    assert!(detail_lines[1].barcode_scanned.is_none());
}

#[test]
fn list_transactions_orders_by_created_at_desc() {
    let conn = fresh();
    let s = store(&conn);
    conn.execute(
        "INSERT INTO roles (id, name, description, permissions) VALUES ('r-tord', 'Role', '', '[]')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id) \
         VALUES ('staff-tord', 's', 'hash', 'S', 'r-tord')",
        [],
    )
    .unwrap();
    let loc_id = s.create_inventory_location("Loc", "store", "").unwrap();
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, product_type) \
         VALUES ('p-tord', 'SKU-T', 'T', 100, 'USD', 'retail')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO stock_summary (item_id, location_id, qty) VALUES ('p-tord', ?1, 100)",
        params![loc_id],
    )
    .unwrap();

    let line = vec![InventoryTransactionLineInput {
        sku: "SKU-T".into(),
        product_name: "T".into(),
        qty: 1,
        delta: 0,
        barcode_scanned: None,
    }];
    let tx1 = s
        .create_inventory_transaction(
            crate::inventory_transaction::InventoryTransactionType::StockCount,
            &loc_id,
            "staff-tord",
            "first",
            &line,
        )
        .unwrap();
    std::thread::sleep(std::time::Duration::from_millis(10));
    let tx2 = s
        .create_inventory_transaction(
            crate::inventory_transaction::InventoryTransactionType::StockCount,
            &loc_id,
            "staff-tord",
            "second",
            &line,
        )
        .unwrap();

    let all = s.list_inventory_transactions().unwrap();
    assert_eq!(all.len(), 2);
    assert_eq!(all[0].id.as_str(), tx2, "most recent first");
    assert_eq!(all[1].id.as_str(), tx1);
}

#[test]
fn delete_nonexistent_threshold_succeeds() {
    let conn = fresh();
    let s = store(&conn);
    // Deleting a non-existent threshold should not error (DELETE with no match is a no-op)
    s.delete_stock_threshold("nonexistent-id").unwrap();
}

#[test]
fn get_thresholds_for_location_with_none_returns_empty() {
    let conn = fresh();
    let s = store(&conn);
    let loc_id = s
        .create_inventory_location("Empty Loc", "store", "")
        .unwrap();
    let list = s.get_stock_thresholds(Some(&loc_id)).unwrap();
    assert!(list.is_empty());
}

#[test]
fn create_transaction_without_stock_change_preserves_qty() {
    let conn = fresh();
    let s = store(&conn);
    conn.execute(
        "INSERT INTO roles (id, name, description, permissions) VALUES ('r-d0', 'Role', '', '[]')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id) VALUES ('staff-d0', 's', 'hash', 'S', 'r-d0')",
        [],
    )
    .unwrap();
    let loc_id = s.create_inventory_location("Loc", "store", "").unwrap();
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, product_type) \
         VALUES ('p-d0', 'SKU-D0', 'D0', 100, 'USD', 'retail')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO stock_summary (item_id, location_id, qty) VALUES ('p-d0', ?1, 40)",
        params![loc_id],
    )
    .unwrap();

    let lines = vec![InventoryTransactionLineInput {
        sku: "SKU-D0".into(),
        product_name: "D0".into(),
        qty: 10,
        delta: 0, // zero delta — no stock change
        barcode_scanned: None,
    }];
    s.create_inventory_transaction(
        crate::inventory_transaction::InventoryTransactionType::StockCount,
        &loc_id,
        "staff-d0",
        "zero delta audit",
        &lines,
    )
    .unwrap();

    // Stock should be unchanged
    let stock: i64 = conn
        .query_row(
            "SELECT COALESCE(qty, 0) FROM stock_summary \
             WHERE item_id = 'p-d0' AND location_id = ?1",
            params![loc_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(stock, 40, "zero-delta transaction should not change stock");
}

#[test]
fn start_shift_with_terminal_id_stores_terminal() {
    let conn = fresh();
    let s = store(&conn);
    conn.execute(
        "INSERT INTO roles (id, name, description, permissions) VALUES ('r-term', 'Role', '', '[]')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id) \
         VALUES ('u-term', 'user', 'hash', 'User', 'r-term')",
        [],
    )
    .unwrap();
    let loc_id = s.create_inventory_location("Loc", "store", "").unwrap();

    // Seed a terminal for the FK reference
    conn.execute(
        "INSERT INTO terminals (id, name, device_id, is_active, created_at, updated_at) \
         VALUES ('term-1', 'Terminal 1', 'dev-term', 1, 'now', 'now')",
        [],
    )
    .unwrap();

    let shift = s
        .start_inventory_shift("u-term", &loc_id, Some("term-1"), "with terminal")
        .unwrap();
    assert_eq!(shift.terminal_id.as_deref(), Some("term-1"));
    assert_eq!(shift.notes, "with terminal");
}

#[test]
fn list_locations_returns_in_order_by_name() {
    let conn = fresh();
    let s = store(&conn);
    let _c = s.create_inventory_location("Zebra", "store", "").unwrap();
    let _a = s
        .create_inventory_location("Alpha", "warehouse", "")
        .unwrap();
    let _m = s.create_inventory_location("Mike", "store", "").unwrap();

    let locs = s.list_inventory_locations().unwrap();
    // 2 seeded (canonical default + transit) + 3 new = 5
    assert_eq!(locs.len(), 5);
    // Our custom ones should be ordered: Alpha, Mike, Zebra (among the seeded ones)
    let names: Vec<&str> = locs.iter().map(|l| l.name.as_str()).collect();
    let alpha_pos = names.iter().position(|n| *n == "Alpha").unwrap();
    let mike_pos = names.iter().position(|n| *n == "Mike").unwrap();
    let zebra_pos = names.iter().position(|n| *n == "Zebra").unwrap();
    assert!(alpha_pos < mike_pos, "Alpha should come before Mike");
    assert!(mike_pos < zebra_pos, "Mike should come before Zebra");
}

// ── Warehouse quota enforcement ─────────────────────────────────

#[test]
fn count_warehouse_locations_starts_at_zero() {
    let conn = fresh();
    let s = store(&conn);
    assert_eq!(s.count_warehouse_locations().unwrap(), 0);
}

#[test]
fn count_warehouse_locations_counts_only_warehouses() {
    let conn = fresh();
    let s = store(&conn);
    s.create_inventory_location("Main Store", "store", "")
        .unwrap();
    s.create_inventory_location("WH A", "warehouse", "")
        .unwrap();
    s.create_inventory_location("WH B", "warehouse", "")
        .unwrap();
    s.create_inventory_location("Transit", "transit", "")
        .unwrap();
    assert_eq!(s.count_warehouse_locations().unwrap(), 2);
}

#[test]
fn enforce_warehouse_quota_allows_non_warehouse_types() {
    let conn = fresh();
    let s = store(&conn);
    // Free allows 1 warehouse; store/transit types bypass the check.
    assert!(
        s.enforce_warehouse_quota(&SubscriptionTier::Free, "store")
            .is_ok()
    );
    assert!(
        s.enforce_warehouse_quota(&SubscriptionTier::Free, "transit")
            .is_ok()
    );
    assert!(
        s.enforce_warehouse_quota(&SubscriptionTier::Free, "damaged")
            .is_ok()
    );
}

#[test]
fn enforce_warehouse_quota_blocks_free_at_limit() {
    let conn = fresh();
    let s = store(&conn);
    s.create_inventory_location("WH A", "warehouse", "")
        .unwrap();
    // Free allows 1 warehouse; we have 1 → must be blocked.
    let err = s
        .enforce_warehouse_quota(&SubscriptionTier::Free, "warehouse")
        .unwrap_err();
    assert!(
        matches!(err, CoreError::SubscriptionLimitExceeded(_)),
        "Free with 1 warehouse must be blocked: {err:?}"
    );
}

#[test]
fn enforce_warehouse_quota_allows_plus_two() {
    let conn = fresh();
    let s = store(&conn);
    s.create_inventory_location("WH A", "warehouse", "")
        .unwrap();
    // Plus allows 2 warehouses; we have 1 → OK.
    assert!(
        s.enforce_warehouse_quota(&SubscriptionTier::Plus, "warehouse")
            .is_ok()
    );
    s.create_inventory_location("WH B", "warehouse", "")
        .unwrap();
    // Now at 2 → Plus must be blocked.
    let err = s
        .enforce_warehouse_quota(&SubscriptionTier::Plus, "warehouse")
        .unwrap_err();
    assert!(
        matches!(err, CoreError::SubscriptionLimitExceeded(_)),
        "Plus with 2 warehouses must be blocked: {err:?}"
    );
}

#[test]
fn enforce_warehouse_quota_error_message_includes_tier() {
    let conn = fresh();
    let s = store(&conn);
    s.create_inventory_location("WH A", "warehouse", "")
        .unwrap();
    let err = s
        .enforce_warehouse_quota(&SubscriptionTier::Free, "warehouse")
        .unwrap_err();
    let msg = err.to_string();
    assert!(msg.contains("Free"), "message should name the tier: {msg}");
}

#[test]
fn enforce_warehouse_quota_pro_allows_three() {
    let conn = fresh();
    let s = store(&conn);
    s.create_inventory_location("WH A", "warehouse", "")
        .unwrap();
    s.create_inventory_location("WH B", "warehouse", "")
        .unwrap();
    // Pro allows 3 warehouses; we have 2 → OK.
    assert!(
        s.enforce_warehouse_quota(&SubscriptionTier::Pro, "warehouse")
            .is_ok()
    );
    s.create_inventory_location("WH C", "warehouse", "")
        .unwrap();
    // Now at 3 → Pro must be blocked.
    let err = s
        .enforce_warehouse_quota(&SubscriptionTier::Pro, "warehouse")
        .unwrap_err();
    assert!(
        matches!(err, CoreError::SubscriptionLimitExceeded(_)),
        "Pro with 3 warehouses must be blocked: {err:?}"
    );
}

#[test]
fn enforce_warehouse_quota_premium_unlimited() {
    let conn = fresh();
    let s = store(&conn);
    for i in 0..5 {
        s.create_inventory_location(&format!("WH {i}"), "warehouse", "")
            .unwrap();
    }
    // Premium has no warehouse limit — always passes.
    assert!(
        s.enforce_warehouse_quota(&SubscriptionTier::Premium, "warehouse")
            .is_ok()
    );
}

#[test]
fn enforce_warehouse_quota_enterprise_unlimited() {
    let conn = fresh();
    let s = store(&conn);
    for i in 0..10 {
        s.create_inventory_location(&format!("WH {i}"), "warehouse", "")
            .unwrap();
    }
    // Enterprise has no warehouse limit — always passes.
    assert!(
        s.enforce_warehouse_quota(&SubscriptionTier::Enterprise, "warehouse")
            .is_ok()
    );
}

#[test]
fn warehouse_tx_veto_closes_limit_race_and_ignores_other_types() {
    // W7-B: the warehouse door. Two things are pinned: an armed warehouse
    // create at the cap is refused in-tx and does not persist; and a
    // NON-warehouse location neither consumes nor honours the arm, because
    // stores are not counted by this dimension — vetoing one would refuse a
    // row the cap never measured.
    let conn = fresh();
    let s = store(&conn);
    let tier = SubscriptionTier::Free;
    let limit = QuotaDimension::Warehouses.limit_for(&tier).unwrap();
    let warehouses = |c: &Connection| -> i64 {
        c.query_row(
            "SELECT COUNT(*) FROM inventory_locations WHERE type = ?1 AND is_active = 1",
            params!["warehouse"],
            |r| r.get(0),
        )
        .unwrap()
    };
    let baseline = warehouses(&conn);
    assert!(
        baseline < limit,
        "the fixture must start under the cap (baseline {baseline}, limit {limit})"
    );
    for n in baseline..limit {
        s.create_inventory_location(&format!("WH {n}"), "warehouse", "")
            .unwrap();
    }
    assert_eq!(warehouses(&conn), limit);
    s.arm_creation_quota(QuotaDimension::Warehouses, tier.clone());
    let err = s
        .create_inventory_location("WH over", "warehouse", "")
        .unwrap_err();
    assert!(
        matches!(err, CoreError::SubscriptionLimitExceeded(_)),
        "Free at the warehouse cap must be refused in-tx: {err:?}"
    );
    assert_eq!(
        warehouses(&conn),
        limit,
        "the over-cap warehouse must not persist"
    );
    s.arm_creation_quota(QuotaDimension::Warehouses, tier.clone());
    s.create_inventory_location("Store two", "store", "")
        .unwrap();
    assert_eq!(
        warehouses(&conn),
        limit,
        "a store row must not move the warehouse count"
    );
}
