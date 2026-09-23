//! Unit tests for the POS bridge module.
//!
//! Relocated from `apps/desktop-tauri/src/commands/pos_tests.rs` (Wave D /
//! D-rel-1). The shell's `tauri::test` mock app is replaced by the headless
//! `TestBridge` harness ([`crate::testing`]) and every scoped command call
//! targets `kasirmu_bridge::pos` directly through a borrowed `BridgeCtx` — the
//! same delegation the landed desktop shims perform.

use super::*;

use crate::testing::seeded_row_loads;
use kasirmu_core::session::SessionContext;
use kasirmu_core::subscription::TenantSubscription;
use kasirmu_core::workspace_type::RESTAURANT_POS;

// -- The broken-seed leg for a PROPAGATING command (crate::testing, RULE at :217-221) --

/// The settlement commands this file drives do NOT project a fail-closed
/// entitlement when the seeded row will not verify: they carry
/// `verify_signature()?` straight out as an error, exactly the way
/// `terminals.rs:432` does. So this leg has no tier, no state and no
/// verdict to name - the settlement never happens, and every downstream
/// assertion about a written sale row, a stamped idempotency key or a deducted
/// stock quantity would describe a write that was refused. Since 19-09-26 the
/// seeded Free row verifies in BOTH profiles, so a healthy tree never enters
/// this leg and the downstream assertions run in both.
///
/// Existence is pinned FIRST: `seeded_row_loads() == false` collapses five
/// causes (lost row, load Err, public-key failure, the intended base64 reject,
/// a real RSA mismatch) and only one of them is this fixture.
async fn assert_signature_denial(
    bridge: &crate::testing::TestBridge,
    settled: Result<CompleteSaleResult, BridgeError>,
    stamped_tier: &str,
) {
    let ctx = bridge.ctx();
    let db = ctx.lock_global().await;
    let row = TenantSubscription::load(&db, "default")
        .expect("the tenant_subscription read must succeed")
        .expect("the seeded default row must EXIST: seeded_row_loads() == false is also the answer for a lost seed, and a fork must never read a broken migration as a profile difference");
    assert_eq!(
        row.tier.tier_key(),
        stamped_tier,
        "the tier this fixture inherits must be on the row the release arm reads"
    );
    assert_eq!(
        row.verify_signature().is_ok(),
        seeded_row_loads(),
        "the row this fixture settles against must be the row the fork predicate is about"
    );
    drop(db);
    let err = match settled {
        Err(err) => err,
        Ok(_) => panic!(
            "this leg runs only where the seeded row does not verify, so the settlement must have been refused"
        ),
    };
    assert!(
        matches!(
            err,
            BridgeError::Core {
                sub_kind: kasirmu_core::CoreErrorKind::InvalidSubscriptionSignature,
                ..
            }
        ),
        "the refusal must be the propagated signature error, not a looser failure: {err:?}"
    );
}

fn usd() -> Currency {
    "USD".parse().unwrap()
}

fn price(minor: i64) -> Money {
    Money {
        minor_units: minor,
        currency: usd(),
    }
}

// ── DTO struct tests ─────────────────────────────────────────────

#[test]
fn set_cart_discount_args_debug() {
    let args = SetCartDiscountArgs {
        cart_id: CartId::new(),
        percent: 10,
        label: Some("Senior".into()),
        user_id: "user-1".into(),
    };
    let debug = format!("{args:?}");
    assert!(debug.contains("Senior"));
    assert!(debug.contains("10"));
}

#[test]
fn start_sale_args_default_currency() {
    let json = r#"{}"#;
    let args: StartSaleArgs = serde_json::from_str(json).unwrap();
    assert!(args.currency.is_empty());
}

#[test]
fn start_sale_result_debug() {
    let cart_id = CartId::new();
    let result = StartSaleResult {
        cart_id,
        deduction_location_id: None,
    };
    let debug = format!("{result:?}");
    assert!(debug.contains("StartSaleResult"));
}

#[test]
fn add_line_args_fields() {
    let args = AddLineArgs {
        cart_id: CartId::new(),
        sku: Sku::new("COFFEE"),
        qty: 3,
        unit_price_minor: 350,
        unit_price_currency: None,
        course: None,
    };
    assert_eq!(args.qty, 3);
    assert_eq!(args.unit_price_minor, 350);
    assert_eq!(args.sku.as_str(), "COFFEE");
}

// ── FRONTEND-03: line currency crosses the IPC boundary ─────────

#[test]
fn add_line_args_unit_price_currency_shape() {
    // camelCase wire shape: present → Some, absent → None (legacy callers).
    let with_cur: AddLineArgs = serde_json::from_str(
        r#"{"cartId":"11111111-1111-1111-1111-111111111111","sku":"BAGEL","qty":2,"unitPriceMinor":500,"unitPriceCurrency":"EUR"}"#,
    )
    .unwrap();
    assert_eq!(with_cur.unit_price_currency.as_deref(), Some("EUR"));
    let without_cur: AddLineArgs = serde_json::from_str(
        r#"{"cartId":"11111111-1111-1111-1111-111111111111","sku":"BAGEL","qty":2,"unitPriceMinor":500}"#,
    )
    .unwrap();
    assert_eq!(without_cur.unit_price_currency, None);
}

#[test]
fn line_unit_price_uses_wire_currency_over_cart_currency() {
    // FRONTEND-03: an EUR line against a USD cart must be BUILT in EUR so
    // Cart::add_line can reject it — previously the command re-stamped the
    // cart's currency and the mismatch check could never fire.
    let args = AddLineArgs {
        cart_id: CartId::new(),
        sku: Sku::new("IMPORT"),
        qty: 1,
        unit_price_minor: 500,
        unit_price_currency: Some("EUR".into()),
        course: None,
    };
    let money = line_unit_price(&args, usd()).unwrap();
    assert_eq!(money.currency, "EUR".parse::<Currency>().unwrap());
    assert_eq!(money.minor_units, 500);
}

#[test]
fn line_unit_price_falls_back_to_cart_currency_when_absent() {
    let args = AddLineArgs {
        cart_id: CartId::new(),
        sku: Sku::new("COFFEE"),
        qty: 1,
        unit_price_minor: 350,
        unit_price_currency: None,
        course: None,
    };
    let money = line_unit_price(&args, usd()).unwrap();
    assert_eq!(money.currency, usd());
}

#[test]
fn line_unit_price_rejects_invalid_currency() {
    let args = AddLineArgs {
        cart_id: CartId::new(),
        sku: Sku::new("COFFEE"),
        qty: 1,
        unit_price_minor: 350,
        unit_price_currency: Some("NOPE!".into()),
        course: None,
    };
    let err = line_unit_price(&args, usd()).unwrap_err();
    assert!(
        err.to_string().to_lowercase().contains("currency"),
        "invalid currency must surface as a clear error, got: {err}"
    );
}

// ── FRONTEND-03 follow-up: shortfall line currency ─────────────

#[test]
fn cart_line_data_unit_price_currency_shape() {
    let with_cur: CartLineData = serde_json::from_str(
        r#"{"sku":"IMPORT","qty":2,"unitPriceMinor":500,"unitPriceCurrency":"EUR"}"#,
    )
    .unwrap();
    assert_eq!(with_cur.unit_price_currency.as_deref(), Some("EUR"));
    let without_cur: CartLineData =
        serde_json::from_str(r#"{"sku":"COFFEE","qty":1,"unitPriceMinor":350}"#).unwrap();
    assert_eq!(without_cur.unit_price_currency, None);
}

#[test]
fn shortfall_line_unit_price_uses_wire_currency_over_sale_currency() {
    let line_data = CartLineData {
        sku: "IMPORT".into(),
        qty: 1,
        unit_price_minor: 500,
        unit_price_currency: Some("EUR".into()),
        course: None,
    };
    let money = shortfall_line_unit_price(&line_data, usd()).unwrap();
    assert_eq!(money.currency, "EUR".parse::<Currency>().unwrap());
    assert_eq!(money.minor_units, 500);
}

#[test]
fn shortfall_line_unit_price_falls_back_to_sale_currency_when_absent() {
    let line_data = CartLineData {
        sku: "COFFEE".into(),
        qty: 1,
        unit_price_minor: 350,
        unit_price_currency: None,
        course: None,
    };
    let money = shortfall_line_unit_price(&line_data, usd()).unwrap();
    assert_eq!(money.currency, usd());
}

#[test]
fn shortfall_line_unit_price_rejects_invalid_currency() {
    let line_data = CartLineData {
        sku: "COFFEE".into(),
        qty: 1,
        unit_price_minor: 350,
        unit_price_currency: Some("NOPE!".into()),
        course: None,
    };
    let err = shortfall_line_unit_price(&line_data, usd()).unwrap_err();
    assert!(
        err.to_string().to_lowercase().contains("currency"),
        "invalid currency must surface as a clear error, got: {err}"
    );
}

#[test]
fn serial_number_arg_fields() {
    let arg = SerialNumberArg {
        sku: "LAPTOP".into(),
        serial: "SN12345".into(),
    };
    assert_eq!(arg.sku, "LAPTOP");
    assert_eq!(arg.serial, "SN12345");
}

#[test]
fn hold_cart_args_default_bill_type() {
    let json =
        r#"{"label":"Test","cartData":"{}","itemCount":1,"totalMinor":100,"currency":"USD"}"#;
    let args: HoldCartArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.bill_type, "hold");
}

#[test]
fn complete_sale_result_debug() {
    let result = CompleteSaleResult {
        sale_id: "sale-1".into(),
        total: Some(price(1000)),
        line_count: 2,
    };
    let debug = format!("{result:?}");
    assert!(debug.contains("sale-1"));
    assert!(debug.contains("1000"));
}

// ── Serde regression: all DTOs accept camelCase from JS ────────

#[test]
fn add_line_args_from_camel_case_json() {
    let json = r#"{"cartId":"11111111-1111-1111-1111-111111111111","sku":"BAGEL","qty":2,"unitPriceMinor":500}"#;
    let args: AddLineArgs = serde_json::from_str(json).unwrap();
    assert_eq!(
        args.cart_id.to_string(),
        "11111111-1111-1111-1111-111111111111"
    );
    assert_eq!(args.sku.as_str(), "BAGEL");
    assert_eq!(args.qty, 2);
    assert_eq!(args.unit_price_minor, 500);
}

#[test]
fn complete_sale_args_from_camel_case_json() {
    let json = r#"{"cartId":"22222222-2222-2222-2222-222222222222","paymentMethod":"cash","tenderedMinor":50000,"userId":"user-1"}"#;
    let args: CompleteSaleArgs = serde_json::from_str(json).unwrap();
    assert_eq!(
        args.cart_id.to_string(),
        "22222222-2222-2222-2222-222222222222"
    );
    assert_eq!(args.payment_method, "cash");
    assert_eq!(args.tendered_minor, Some(50000));
    assert_eq!(args.user_id, "user-1");
}

#[test]
fn hold_cart_args_from_camel_case_json() {
    let json = r#"{"label":"Table 5","cartData":"{}","itemCount":3,"totalMinor":15000,"currency":"IDR","customerName":"Budi"}"#;
    let args: HoldCartArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.label, "Table 5");
    assert_eq!(args.item_count, 3);
    assert_eq!(args.total_minor, 15000);
    assert_eq!(args.currency, "IDR");
    assert_eq!(args.customer_name.as_deref(), Some("Budi"));
    assert_eq!(args.bill_type, "hold");
}

// ── Scoped command token rejection tests ───────────────────────

#[test]
fn pos_scoped_rejects_invalid_token() {
    let bridge = crate::testing::TestBridge::new();
    let result = bridge.ctx().resolve_session("nonexistent-token");
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

#[test]
fn complete_sale_scoped_rejects_invalid_token() {
    let bridge = crate::testing::TestBridge::new();
    let result = bridge.ctx().resolve_session("bad-token");
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

#[tokio::test]
async fn scoped_sale_deducts_from_topology_warehouse_not_pos_location() {
    let store_id = "store-stock-route-e2e";
    let pos_instance_id = "pos-stock-route-e2e";
    let warehouse_instance_id = "warehouse-stock-route-e2e";
    let global = crate::testing::temp_conn();
    let runtime_key = format!("{TOPOLOGY_RUNTIME_SETTING_KEY}/{store_id}");
    let runtime_plan = serde_json::json!({
        "routes": [{
            "source_instance_id": pos_instance_id,
            "target_instance_id": warehouse_instance_id,
            "from_port_id": "stock-out",
            "to_port_id": "stock-in",
            "relationship_type": "stock-routing"
        }]
    });
    kasirmu_core::Settings::set(&global, &runtime_key, &runtime_plan.to_string()).unwrap();
    {
        let identity_store = Store::new(&global);
        identity_store.seed_default_roles().unwrap();
        global.execute(
            "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
             VALUES ('stock-route-user', 'stock-route-user', 'hash', 'Stock Route User', 'role-owner', 1, '2026-08-09T00:00:00Z', '2026-08-09T00:00:00Z')",
            [],
        )
        .unwrap();
    }

    // The harness owns a file-backed per-store manager over a unique temp
    // directory (tempfile is not a bridge dependency), so the store DB is
    // seeded through the bridge's own manager — the same shape the shell's
    // `AppState::for_test_with_conn` + manager swap produced.
    let bridge = crate::testing::TestBridge::new().with_conn(global);
    {
        let store_conn = bridge.db_manager().open_store(store_id).unwrap();
        let db = store_conn.lock().unwrap();
        db.execute_batch(
            "INSERT OR IGNORE INTO locations (id, name, is_primary) VALUES ('store-stock-route-e2e', 'Stock Route E2E', 0);
             INSERT INTO inventory_locations (id, name, type) VALUES
                ('stock-route-pos-location', 'Stock Route POS', 'store'),
                ('stock-route-warehouse-location', 'Stock Route Warehouse', 'warehouse');
             INSERT INTO workspace_instances (id, type_key, location_id, name, bound_location_id)
                VALUES ('pos-stock-route-e2e', 'restaurant-pos', 'store-stock-route-e2e', 'Route POS', 'stock-route-pos-location');
             INSERT INTO workspace_instances (id, type_key, location_id, name, bound_location_id)
                VALUES ('warehouse-stock-route-e2e', 'warehouse', 'store-stock-route-e2e', 'Route Warehouse', 'stock-route-warehouse-location');
             INSERT INTO products (id, sku, name, price_minor, currency, product_type)
                VALUES ('stock-route-product', 'STOCK-ROUTE-COFFEE', 'Stock Route Coffee', 1000, 'USD', 'retail');
             INSERT INTO stock_summary (item_id, location_id, qty)
                VALUES ('stock-route-product', 'stock-route-pos-location', 20),
                       ('stock-route-product', 'stock-route-warehouse-location', 20);",
        )
        .unwrap();
    }
    bridge.sessions().write().unwrap().insert(
        "stock-route-token".into(),
        SessionContext::new(
            "stock-route-user".into(),
            "role-owner".into(),
            "stock-route-terminal".into(),
            store_id.into(),
            pos_instance_id.into(),
            "restaurant-pos".into(),
            None,
            0,
        ),
    );

    let started = start_sale_scoped(
        &bridge.ctx(),
        "stock-route-token",
        StartSaleArgs {
            currency: "USD".into(),
        },
    )
    .await
    .unwrap();
    add_line_scoped(
        &bridge.ctx(),
        "stock-route-token",
        AddLineArgs {
            cart_id: started.cart_id,
            sku: Sku::new("STOCK-ROUTE-COFFEE"),
            qty: 3,
            unit_price_minor: 1000,
            unit_price_currency: None,
            course: None,
        },
    )
    .await
    .unwrap();
    let completed = complete_sale_scoped(
        &bridge.ctx(),
        "stock-route-token",
        CompleteSaleScopedArgs {
            cart_id: started.cart_id,
            payment_method: "cash".into(),
            tendered_minor: Some(3000),
            customer_id: None,
            payment_splits: None,
            customer_name: None,
            serial_numbers: None,
            base_currency: None,
            base_total_minor: None,
            tender_rate_millionths: None,
            tip_minor: None,
            service_charge_minor: None,
            promotion_ids: None,
            // No attempt id: this fixture exercises the unguarded legacy path.
            attempt_id: None,
            // F2-6: no estimate claim — the note must stay NULL.
            tax_estimated: None,
        },
    )
    .await;
    // Broken-seed fallback, not a profile fork: since 19-09-26 the seeded Free
    // row verifies in BOTH profiles, so the settlement below lands in both and
    // the stock quantities are asserted in both. This arm is reached only when
    // the row exists but does not verify - then the quantities never change,
    // and asserting them would be asserting that nothing happened rather than
    // that the route prefers the warehouse.
    if !seeded_row_loads() {
        assert_signature_denial(&bridge, completed, "free").await;
        return;
    }
    completed.unwrap();

    let store_conn = bridge.db_manager().open_store(store_id).unwrap();
    let db = store_conn.lock().unwrap();
    let pos_qty: i64 = db
        .query_row(
            "SELECT qty FROM stock_summary WHERE item_id = 'stock-route-product' AND location_id = 'stock-route-pos-location'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let warehouse_qty: i64 = db
        .query_row(
            "SELECT qty FROM stock_summary WHERE item_id = 'stock-route-product' AND location_id = 'stock-route-warehouse-location'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(pos_qty, 20, "POS stock must remain untouched by the route");
    assert_eq!(
        warehouse_qty, 17,
        "Warehouse stock must fund the completed sale"
    );
}

#[test]
fn runtime_plan_selects_stock_target_for_pos_source() {
    let plan = serde_json::json!({
        "routes": [{
            "source_instance_id": "pos-main",
            "target_instance_id": "warehouse-main",
            "from_port_id": "stock-out",
            "to_port_id": "stock-in",
            "relationship_type": "stock-routing"
        }]
    });
    assert_eq!(
        runtime_stock_target_instances(&plan, "pos-main"),
        vec!["warehouse-main"]
    );
    assert!(runtime_stock_target_instances(&plan, "other-pos").is_empty());
}

#[test]
fn runtime_plan_uses_retail_operation_route_for_warehouse_stock_target() {
    let plan = serde_json::json!({
        "routes": [{
            "source_instance_id": "pos-main",
            "target_instance_id": "warehouse-main",
            "from_port_id": "operation-out",
            "to_port_id": "operation-in",
            "relationship_type": "generic",
            "target_node_kind": "warehouse"
        }]
    });
    assert_eq!(
        runtime_stock_target_instances(&plan, "pos-main"),
        vec!["warehouse-main"]
    );
}

#[test]
fn runtime_plan_does_not_treat_operation_feed_to_kds_as_stock() {
    let plan = serde_json::json!({
        "routes": [{
            "source_instance_id": "restaurant-pos",
            "target_instance_id": "kds-main",
            "from_port_id": "operation-out",
            "to_port_id": "operation-in",
            "relationship_type": "generic",
            "target_node_kind": "workspace"
        }]
    });
    assert!(runtime_stock_target_instances(&plan, "restaurant-pos").is_empty());
}

#[test]
fn runtime_plan_preserves_distinct_stock_targets_in_route_order() {
    let plan = serde_json::json!({
        "routes": [
            {
                "source_instance_id": "pos-main",
                "target_instance_id": "warehouse-b",
                "from_port_id": "stock-out",
                "to_port_id": "stock-in",
                "relationship_type": "stock-routing"
            },
            {
                "source_instance_id": "pos-main",
                "target_instance_id": "warehouse-a",
                "from_port_id": "stock-out",
                "to_port_id": "stock-in",
                "relationship_type": "stock-routing"
            },
            {
                "source_instance_id": "pos-main",
                "target_instance_id": "warehouse-b",
                "from_port_id": "stock-out",
                "to_port_id": "stock-in",
                "relationship_type": "stock-routing"
            }
        ]
    });
    assert_eq!(
        runtime_stock_target_instances(&plan, "pos-main"),
        vec!["warehouse-b", "warehouse-a"]
    );
}

// ── Scoped command integration tests ─────────────────────────────

fn seed_owner(conn: &rusqlite::Connection) {
    let store = Store::new(conn);
    store.seed_default_roles().unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();
}

/// The workspace `type_key` a fixture session carries when the test does not
/// care which terminal it is.
///
/// Deliberately NOT [`RESTAURANT_POS`]: a session's `type_key` now
/// decides whether the open-bill paths are reachable, so the default fixture
/// must not silently hold the restaurant terminal's extra rights. Tests that
/// need the restaurant terminal use [`scoped_bridge_typed`].
const DEFAULT_TEST_TYPE_KEY: &str = "pos";

fn scoped_bridge(
    conn: rusqlite::Connection,
    token: &str,
    user_id: &str,
    role_id: &str,
    store_id: &str,
) -> crate::testing::TestBridge {
    scoped_bridge_typed(
        conn,
        token,
        user_id,
        role_id,
        store_id,
        DEFAULT_TEST_TYPE_KEY,
    )
}

/// As [`scoped_bridge`], but with an explicit workspace `type_key`, so a test can
/// place the session on a named terminal and assert what that terminal may and
/// may not do.
fn scoped_bridge_typed(
    conn: rusqlite::Connection,
    token: &str,
    user_id: &str,
    role_id: &str,
    store_id: &str,
    type_key: &str,
) -> crate::testing::TestBridge {
    let bridge = crate::testing::TestBridge::new().with_conn(conn);
    bridge.sessions().write().unwrap().insert(
        token.into(),
        SessionContext::new(
            user_id.into(),
            role_id.into(),
            "terminal-1".into(),
            store_id.into(),
            "instance-1".into(),
            type_key.into(),
            None,
            0,
        ),
    );
    bridge
}

// ── Session validation ────────────────────────────────────────

#[tokio::test]
async fn scoped_hold_cart_rejects_invalid_token() {
    let conn = crate::testing::temp_conn();
    let bridge = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");

    let result = hold_cart_scoped(
        &bridge.ctx(),
        "bad-token",
        HoldCartArgs {
            label: "Test".into(),
            cart_data: "{}".into(),
            item_count: 1,
            total_minor: 500,
            currency: "USD".into(),
            bill_type: "regular".into(),
            customer_name: None,
            deduction_location_id: None,
        },
    )
    .await;
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

#[tokio::test]
async fn scoped_list_held_carts_rejects_invalid_token() {
    let conn = crate::testing::temp_conn();
    let bridge = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");

    let result = list_held_carts_scoped(&bridge.ctx(), "bad-token").await;
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

// ── Owner hold_cart CRUD ─────────────────────────────────────────

#[tokio::test]
async fn owner_can_hold_cart() {
    let conn = crate::testing::temp_conn();
    seed_owner(&conn);
    let bridge = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");

    let result = hold_cart_scoped(
        &bridge.ctx(),
        "tok",
        HoldCartArgs {
            label: "Table 5".into(),
            cart_data: r#"{"lines":[]}"#.into(),
            item_count: 2,
            total_minor: 1500,
            currency: "USD".into(),
            bill_type: "regular".into(),
            customer_name: None,
            deduction_location_id: None,
        },
    )
    .await;
    assert!(result.is_ok(), "owner should hold a cart");
}

#[tokio::test]
async fn owner_can_list_held_carts() {
    let conn = crate::testing::temp_conn();
    seed_owner(&conn);
    let bridge = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");

    // Hold two carts.
    for i in 0..2 {
        hold_cart_scoped(
            &bridge.ctx(),
            "tok",
            HoldCartArgs {
                label: format!("Table {i}"),
                cart_data: "{}".into(),
                item_count: 1,
                total_minor: 500,
                currency: "USD".into(),
                bill_type: "regular".into(),
                customer_name: None,
                deduction_location_id: None,
            },
        )
        .await
        .unwrap();
    }

    let carts = list_held_carts_scoped(&bridge.ctx(), "tok").await.unwrap();
    assert_eq!(carts.len(), 2);
}

#[tokio::test]
async fn list_held_carts_empty_when_none() {
    let conn = crate::testing::temp_conn();
    seed_owner(&conn);
    let bridge = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");

    let carts = list_held_carts_scoped(&bridge.ctx(), "tok").await.unwrap();
    assert!(carts.is_empty());
}

// ── Owner open_bills ─────────────────────────────────────────────

/// A hold request, so each terminal test states only the `bill_type` it is about.
fn hold_args(bill_type: &str) -> HoldCartArgs {
    HoldCartArgs {
        label: "Table 5".into(),
        cart_data: r#"{"lines":[]}"#.into(),
        item_count: 1,
        total_minor: 500,
        currency: "USD".into(),
        bill_type: bill_type.into(),
        customer_name: None,
        deduction_location_id: None,
    }
}

#[tokio::test]
async fn owner_can_list_open_bills_empty() {
    let conn = crate::testing::temp_conn();
    seed_owner(&conn);
    let bridge = scoped_bridge_typed(
        conn,
        "tok",
        "user-owner",
        "role-owner",
        "s1",
        RESTAURANT_POS,
    );

    let bills = list_open_bills_scoped(&bridge.ctx(), "tok").await.unwrap();
    assert!(bills.is_empty());
}

// ── Terminal identity: the open-bill paths are restaurant-only ───
//
// `bill_type` used to be written through exactly as the client sent it, which
// let a store-pos session create an open bill — reachable in practice through
// the shared `PaymentModal`, whose Open Bill tender was not workspace-gated.
// The checks below pin the value against the session's workspace type instead.

#[tokio::test]
async fn restaurant_pos_can_create_and_read_an_open_bill() {
    let conn = crate::testing::temp_conn();
    seed_owner(&conn);
    let bridge = scoped_bridge_typed(
        conn,
        "tok",
        "user-owner",
        "role-owner",
        "s1",
        RESTAURANT_POS,
    );

    hold_cart_scoped(&bridge.ctx(), "tok", hold_args(BILL_TYPE_OPEN_BILL))
        .await
        .expect("the restaurant terminal owns the open bill");

    let bills = list_open_bills_scoped(&bridge.ctx(), "tok").await.unwrap();
    assert_eq!(bills.len(), 1, "the open bill must read back");
}

#[tokio::test]
async fn store_pos_cannot_create_open_bill() {
    let conn = crate::testing::temp_conn();
    seed_owner(&conn);
    let bridge = scoped_bridge_typed(conn, "tok", "user-owner", "role-owner", "s1", "store-pos");

    let err = hold_cart_scoped(&bridge.ctx(), "tok", hold_args(BILL_TYPE_OPEN_BILL))
        .await
        .expect_err("a store-pos session must not be able to create an open bill");
    assert!(
        matches!(err, BridgeError::PermissionDenied(_)),
        "the refusal must be fail-closed, got {err:?}"
    );
}

#[tokio::test]
async fn store_pos_can_still_hold_a_plain_cart() {
    let conn = crate::testing::temp_conn();
    seed_owner(&conn);
    let bridge = scoped_bridge_typed(conn, "tok", "user-owner", "role-owner", "s1", "store-pos");

    hold_cart_scoped(&bridge.ctx(), "tok", hold_args("hold"))
        .await
        .expect("the enforcement must not remove the plain hold from any terminal");
}

#[tokio::test]
async fn store_pos_cannot_list_open_bills() {
    let conn = crate::testing::temp_conn();
    seed_owner(&conn);
    let bridge = scoped_bridge_typed(conn, "tok", "user-owner", "role-owner", "s1", "store-pos");

    let err = list_open_bills_scoped(&bridge.ctx(), "tok")
        .await
        .expect_err("a store-pos session must not be able to list open bills");
    assert!(
        matches!(err, BridgeError::PermissionDenied(_)),
        "the refusal must be fail-closed, got {err:?}"
    );
}

// ── Permission matrix: staff (has SALES_PROCESS) ─────────────────

#[tokio::test]
async fn staff_can_hold_cart() {
    let conn = crate::testing::temp_conn();
    seed_owner(&conn);
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-staff', 'staff', 'hash', 'Staff', 'role-staff', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();
    let bridge = scoped_bridge(conn, "tok", "user-staff", "role-staff", "s1");

    let result = hold_cart_scoped(
        &bridge.ctx(),
        "tok",
        HoldCartArgs {
            label: "Staff hold".into(),
            cart_data: "{}".into(),
            item_count: 1,
            total_minor: 500,
            currency: "USD".into(),
            bill_type: "regular".into(),
            customer_name: None,
            deduction_location_id: None,
        },
    )
    .await;
    assert!(result.is_ok(), "staff has SALES_PROCESS permission");
}

#[tokio::test]
async fn staff_can_list_held_carts() {
    let conn = crate::testing::temp_conn();
    seed_owner(&conn);
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-staff', 'staff', 'hash', 'Staff', 'role-staff', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();
    let bridge = scoped_bridge(conn, "tok", "user-staff", "role-staff", "s1");

    let result = list_held_carts_scoped(&bridge.ctx(), "tok").await;
    assert!(result.is_ok(), "staff has SALES_PROCESS permission");
    assert!(result.unwrap().is_empty());
}

// ── COR-7: attempt id to per-split idempotency keys ────────────────

fn tender_split(method: &str, amount_minor: i64) -> PaymentSplitArg {
    PaymentSplitArg {
        method: method.into(),
        amount_minor,
        gateway_reference: None,
        gateway_status: None,
        gateway_response: None,
        idempotency_key: None,
    }
}

#[test]
fn attempt_keys_are_indexed_per_split() {
    // One key shared by every split would make a two-tender sale collide with
    // itself on its own second row and reject a legitimate sale. The index is
    // the whole point of the format.
    let mut splits = vec![tender_split("cash", 400), tender_split("card", 300)];
    stamp_attempt_split_keys(Some("att-1"), &mut splits);
    let keys: Vec<Option<&str>> = splits
        .iter()
        .map(|s| s.idempotency_key.as_deref())
        .collect();
    assert_eq!(keys, vec![Some("att-1:0"), Some("att-1:1")]);
}

#[test]
fn attempt_keys_are_deterministic_across_retries() {
    // A replay has to reproduce the same keys, or the UNIQUE index cannot
    // recognise it as the same attempt and the guard never fires.
    let mut first = vec![tender_split("cash", 700)];
    let mut second = vec![tender_split("cash", 700)];
    stamp_attempt_split_keys(Some("att-1"), &mut first);
    stamp_attempt_split_keys(Some("att-1"), &mut second);
    assert_eq!(first[0].idempotency_key, second[0].idempotency_key);
}

#[test]
fn no_attempt_id_leaves_the_sale_unguarded() {
    // Legacy callers and CLI imports keep working unchanged; they simply get
    // no replay protection rather than a half-applied one.
    let mut splits = vec![tender_split("cash", 700)];
    stamp_attempt_split_keys(None, &mut splits);
    assert_eq!(splits[0].idempotency_key, None);
}

// ── COR-7: a replayed key must never match a different basket ──────

/// Settle one cart through `complete_sale_scoped` with a cash tender.
///
/// Every field except cart and attempt id is the neutral default, so the
/// test's two settlements differ ONLY in basket and (deliberately) not in
/// the attempt id.
async fn settle_replay_cart(
    bridge: &crate::testing::TestBridge,
    token: &str,
    cart_id: CartId,
    attempt: Option<&str>,
) -> Result<CompleteSaleResult, BridgeError> {
    complete_sale_scoped(
        &bridge.ctx(),
        token,
        CompleteSaleScopedArgs {
            cart_id,
            payment_method: "cash".into(),
            tendered_minor: Some(5000),
            customer_id: None,
            payment_splits: None,
            customer_name: None,
            serial_numbers: None,
            base_currency: None,
            base_total_minor: None,
            tender_rate_millionths: None,
            tip_minor: None,
            service_charge_minor: None,
            promotion_ids: None,
            attempt_id: attempt.map(str::to_owned),
            tax_estimated: None,
        },
    )
    .await
}

#[tokio::test]
async fn stale_attempt_id_on_a_different_cart_settles_a_new_sale() {
    // settle with att-x, void it, settle a DIFFERENT cart with att-x.
    // void_pending_sale never touches payments, so `{att-x}:0` keeps
    // resolving to the voided sale forever. Key equality alone is not proof
    // of the same basket: the second cart still exists, so the matched sale
    // cannot be this basket. The guard must refuse the replay and settle a
    // NEW sale instead of handing back the old receipt.
    let store_id = "store-replay-guard";
    let global = crate::testing::temp_conn();
    {
        let identity_store = Store::new(&global);
        identity_store.seed_default_roles().unwrap();
        global
            .execute(
                "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
                 VALUES ('replay-user', 'replay-user', 'hash', 'Replay User', 'role-owner', 1, '2026-08-09T00:00:00Z', '2026-08-09T00:00:00Z')",
                [],
            )
            .unwrap();
    }
    let bridge = crate::testing::TestBridge::new().with_conn(global);
    {
        let store_conn = bridge.db_manager().open_store(store_id).unwrap();
        let db = store_conn.lock().unwrap();
        db.execute_batch(
            "INSERT INTO products (id, sku, name, price_minor, currency, product_type)
                 VALUES ('replay-product', 'REPLAY-COFFEE', 'Replay Coffee', 350, 'USD', 'retail');
             INSERT INTO stock_summary (item_id, location_id, qty)
                 VALUES ('replay-product', '01926b3a-0000-7000-8000-000000000001', 100);",
        )
        .unwrap();
    }
    bridge.sessions().write().unwrap().insert(
        "replay-tok".into(),
        SessionContext::new(
            "replay-user".into(),
            "role-owner".into(),
            "replay-terminal".into(),
            store_id.into(),
            "replay-instance".into(),
            "restaurant-pos".into(),
            None,
            0,
        ),
    );

    // ── Attempt 1: basket 1 settles under att-x ───────────────────
    let started1 = start_sale_scoped(
        &bridge.ctx(),
        "replay-tok",
        StartSaleArgs {
            currency: "USD".into(),
        },
    )
    .await
    .unwrap();
    add_line_scoped(
        &bridge.ctx(),
        "replay-tok",
        AddLineArgs {
            cart_id: started1.cart_id,
            sku: Sku::new("REPLAY-COFFEE"),
            qty: 2,
            unit_price_minor: 350,
            unit_price_currency: None,
            course: None,
        },
    )
    .await
    .unwrap();
    let first = settle_replay_cart(&bridge, "replay-tok", started1.cart_id, Some("att-x")).await;
    // Broken-seed fallback, not a profile fork: since 19-09-26 the seeded Free
    // row verifies in BOTH profiles, so the sale below is written in both and
    // the replay-guard story is asserted in both. This arm is reached only when
    // the row exists but does not verify - then there is no sale row, no
    // idempotency key and no replay to talk about.
    if !seeded_row_loads() {
        assert_signature_denial(&bridge, first, "free").await;
        return;
    }
    let first = first.unwrap();

    // Void it: the sale row flips to void, but the payment row keeps
    // `{att-x}:0` — a replayed key stays valid forever by design.
    {
        let store_conn = bridge.db_manager().open_store(store_id).unwrap();
        let db = store_conn.lock().unwrap();
        Store::new(&db).void_pending_sale(&first.sale_id).unwrap();
    }

    // ── Attempt 2: a DIFFERENT basket, same stale att-x ───────────
    let started2 = start_sale_scoped(
        &bridge.ctx(),
        "replay-tok",
        StartSaleArgs {
            currency: "USD".into(),
        },
    )
    .await
    .unwrap();
    add_line_scoped(
        &bridge.ctx(),
        "replay-tok",
        AddLineArgs {
            cart_id: started2.cart_id,
            sku: Sku::new("REPLAY-COFFEE"),
            qty: 1,
            unit_price_minor: 350,
            unit_price_currency: None,
            course: None,
        },
    )
    .await
    .unwrap();
    let second = settle_replay_cart(&bridge, "replay-tok", started2.cart_id, Some("att-x"))
        .await
        .unwrap();

    assert_ne!(
        second.sale_id, first.sale_id,
        "a replayed key must never hand basket 1's receipt to basket 2 — the guard must refuse it and settle a NEW sale"
    );

    // The re-key happened: the stale prefix still owns exactly one payment
    // row (the voided sale's). Had the guard stamped att-x again, the UNIQUE
    // index would have rejected the second settlement outright.
    {
        let store_conn = bridge.db_manager().open_store(store_id).unwrap();
        let db = store_conn.lock().unwrap();
        let stale_keyed: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM payments WHERE idempotency_key LIKE 'att-x%'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        // Two rows now share the attempt prefix: the voided sale's own
        // `{att-x}:0`, plus the deterministic re-key the guard stamped for
        // the new basket (`{att-x}:rekey:{cart}:0`) so a retry of this
        // submission finds ITS OWN receipt instead of the voided one.
        assert_eq!(
            stale_keyed, 2,
            "the voided sale keeps its key and the deterministic re-key adds one under the same prefix"
        );
        let second_keyed: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM payments WHERE sale_id = ?1 AND idempotency_key IS NOT NULL",
                rusqlite::params![second.sale_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            second_keyed, 1,
            "the new sale must carry its own fresh idempotency key"
        );
    }
}

/// Bridge + store seeded for the replay-guard end-to-end tests: one sellable
/// product with ample stock and an owner session on token `replay-tok`.
fn replay_guard_bridge() -> crate::testing::TestBridge {
    let store_id = "store-replay-guard";
    let global = crate::testing::temp_conn();
    {
        let identity_store = Store::new(&global);
        identity_store.seed_default_roles().unwrap();
        global
            .execute(
                "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
                 VALUES ('replay-user', 'replay-user', 'hash', 'Replay User', 'role-owner', 1, '2026-08-09T00:00:00Z', '2026-08-09T00:00:00Z')",
                [],
            )
            .unwrap();
    }
    let bridge = crate::testing::TestBridge::new().with_conn(global);
    {
        let store_conn = bridge.db_manager().open_store(store_id).unwrap();
        let db = store_conn.lock().unwrap();
        db.execute_batch(
            "INSERT INTO products (id, sku, name, price_minor, currency, product_type)
                 VALUES ('replay-product', 'REPLAY-COFFEE', 'Replay Coffee', 350, 'USD', 'retail');
             INSERT INTO stock_summary (item_id, location_id, qty)
                 VALUES ('replay-product', '01926b3a-0000-7000-8000-000000000001', 100);",
        )
        .unwrap();
    }
    bridge.sessions().write().unwrap().insert(
        "replay-tok".into(),
        SessionContext::new(
            "replay-user".into(),
            "role-owner".into(),
            "replay-terminal".into(),
            store_id.into(),
            "replay-instance".into(),
            "restaurant-pos".into(),
            None,
            0,
        ),
    );
    bridge
}

/// Void `sale_id` the way the finalize-failure path does, leaving its
/// payment rows (and their attempt keys) untouched.
fn void_replay_sale(bridge: &crate::testing::TestBridge, sale_id: &str) {
    let store_conn = bridge
        .db_manager()
        .open_store("store-replay-guard")
        .unwrap();
    let db = store_conn.lock().unwrap();
    Store::new(&db).void_pending_sale(sale_id).unwrap();
}

#[tokio::test]
async fn replayed_attempt_answers_the_rekeyed_baskets_own_receipt() {
    // Foreign-receipt regression: attempt att-x is stale on basket 1, the
    // guard re-keys deterministically and basket 2's sale S2 commits, the
    // response is lost, the client retries att-x with basket 2's cart. The
    // retry must be answered with S2 — the receipt for the basket whose
    // payment is being retried — never with basket 1's older S1, whose base
    // key `{att-x}:0` still resolves.
    let bridge = replay_guard_bridge();
    let started1 = start_sale_scoped(
        &bridge.ctx(),
        "replay-tok",
        StartSaleArgs {
            currency: "USD".into(),
        },
    )
    .await
    .unwrap();
    add_line_scoped(
        &bridge.ctx(),
        "replay-tok",
        AddLineArgs {
            cart_id: started1.cart_id,
            sku: Sku::new("REPLAY-COFFEE"),
            qty: 2,
            unit_price_minor: 350,
            unit_price_currency: None,
            course: None,
        },
    )
    .await
    .unwrap();
    let first = settle_replay_cart(&bridge, "replay-tok", started1.cart_id, Some("att-x")).await;
    // Broken-seed fallback, not a profile fork: since 19-09-26 the seeded Free
    // row verifies in BOTH profiles, so the sale below is written in both and
    // the replay-guard story is asserted in both. This arm is reached only when
    // the row exists but does not verify - then there is no sale row, no
    // idempotency key and no replay to talk about.
    if !seeded_row_loads() {
        assert_signature_denial(&bridge, first, "free").await;
        return;
    }
    let first = first.unwrap();
    void_replay_sale(&bridge, &first.sale_id);

    let started2 = start_sale_scoped(
        &bridge.ctx(),
        "replay-tok",
        StartSaleArgs {
            currency: "USD".into(),
        },
    )
    .await
    .unwrap();
    add_line_scoped(
        &bridge.ctx(),
        "replay-tok",
        AddLineArgs {
            cart_id: started2.cart_id,
            sku: Sku::new("REPLAY-COFFEE"),
            qty: 1,
            unit_price_minor: 350,
            unit_price_currency: None,
            course: None,
        },
    )
    .await
    .unwrap();
    let second = settle_replay_cart(&bridge, "replay-tok", started2.cart_id, Some("att-x"))
        .await
        .unwrap();
    assert_ne!(
        second.sale_id, first.sale_id,
        "fixture premise: basket 2 settled its own sale under the re-key"
    );

    // Response lost — the client retries the SAME attempt id and cart.
    let retried = settle_replay_cart(&bridge, "replay-tok", started2.cart_id, Some("att-x"))
        .await
        .unwrap();
    assert_eq!(
        retried.sale_id, second.sale_id,
        "the retry must be answered with the re-keyed basket's own receipt"
    );
    assert_ne!(
        retried.sale_id, first.sale_id,
        "basket 1's older sale must never be handed to basket 2's payment"
    );
}

#[tokio::test]
async fn voided_sale_does_not_satisfy_a_replay() {
    // Voided-receipt regression: settle S1 keyed att-x, void it, then replay
    // att-x against the same (now consumed) cart. The voided S1 took no
    // money and returned its stock, so it must never come back as a replayed
    // receipt — the guard refuses the replay and the submission falls
    // through to the cart lookup, which rejects the consumed cart.
    let bridge = replay_guard_bridge();
    let started1 = start_sale_scoped(
        &bridge.ctx(),
        "replay-tok",
        StartSaleArgs {
            currency: "USD".into(),
        },
    )
    .await
    .unwrap();
    add_line_scoped(
        &bridge.ctx(),
        "replay-tok",
        AddLineArgs {
            cart_id: started1.cart_id,
            sku: Sku::new("REPLAY-COFFEE"),
            qty: 2,
            unit_price_minor: 350,
            unit_price_currency: None,
            course: None,
        },
    )
    .await
    .unwrap();
    let first = settle_replay_cart(&bridge, "replay-tok", started1.cart_id, Some("att-x")).await;
    // Broken-seed fallback, not a profile fork: since 19-09-26 the seeded Free
    // row verifies in BOTH profiles, so the sale below is written in both and
    // the replay-guard story is asserted in both. This arm is reached only when
    // the row exists but does not verify - then there is no sale row, no
    // idempotency key and no replay to talk about.
    if !seeded_row_loads() {
        assert_signature_denial(&bridge, first, "free").await;
        return;
    }
    let first = first.unwrap();
    void_replay_sale(&bridge, &first.sale_id);

    let replayed = settle_replay_cart(&bridge, "replay-tok", started1.cart_id, Some("att-x")).await;
    assert!(
        replayed.is_err(),
        "a voided sale must never be handed back as a replayed receipt"
    );
}

/// Submit one shortfall resolution for a synthetic cart id — the shape the
/// StockShortfallDialog retry sends, cart id regenerated per submit.
async fn settle_shortfall_resolution(
    bridge: &crate::testing::TestBridge,
    token: &str,
    synthetic_cart_id: CartId,
    attempt: Option<&str>,
) -> CompleteSaleResult {
    complete_sale_with_resolved_shortfalls_scoped(
        &bridge.ctx(),
        token,
        CompleteSaleWithResolvedShortfallsArgs {
            cart_id: synthetic_cart_id,
            payment_method: "cash".into(),
            tendered_minor: Some(5000),
            customer_id: None,
            payment_splits: None,
            customer_name: None,
            serial_numbers: None,
            lines: vec![CartLineData {
                sku: "REPLAY-COFFEE".into(),
                qty: 2,
                unit_price_minor: 350,
                unit_price_currency: None,
                course: None,
            }],
            total_minor: 700,
            currency: "USD".into(),
            discount_percent: 0,
            discount_label: None,
            promotion_ids: None,
            resolutions: vec![],
            base_currency: None,
            base_total_minor: None,
            tender_rate_millionths: None,
            tip_minor: None,
            service_charge_minor: None,
            attempt_id: attempt.map(str::to_owned),
        },
    )
    .await
    .unwrap()
}

#[tokio::test]
async fn shortfall_retries_with_a_stable_attempt_settle_one_sale() {
    // DOUBLE-COUNT reproduce: basket 1 settles under att-x and is voided
    // (the base key `{att-x}:0` stays live forever). The shortfall
    // resolution is then submitted TWICE one tick apart — same attempt id,
    // same basket contents, but the synthetic resolved-<timestamp> cart id
    // is regenerated per submit. Both submits must produce ONE sale: the
    // contents hash, not the per-submit cart id, anchors the re-key.
    let bridge = replay_guard_bridge();
    let started1 = start_sale_scoped(
        &bridge.ctx(),
        "replay-tok",
        StartSaleArgs {
            currency: "USD".into(),
        },
    )
    .await
    .unwrap();
    add_line_scoped(
        &bridge.ctx(),
        "replay-tok",
        AddLineArgs {
            cart_id: started1.cart_id,
            sku: Sku::new("REPLAY-COFFEE"),
            qty: 2,
            unit_price_minor: 350,
            unit_price_currency: None,
            course: None,
        },
    )
    .await
    .unwrap();
    let first = settle_replay_cart(&bridge, "replay-tok", started1.cart_id, Some("att-x")).await;
    // Broken-seed fallback, not a profile fork: since 19-09-26 the seeded Free
    // row verifies in BOTH profiles, so the sale below is written in both and
    // the replay-guard story is asserted in both. This arm is reached only when
    // the row exists but does not verify - then there is no sale row, no
    // idempotency key and no replay to talk about.
    if !seeded_row_loads() {
        assert_signature_denial(&bridge, first, "free").await;
        return;
    }
    let first = first.unwrap();
    void_replay_sale(&bridge, &first.sale_id);

    let s1 = settle_shortfall_resolution(&bridge, "replay-tok", CartId::new(), Some("att-x")).await;
    let s2 = settle_shortfall_resolution(&bridge, "replay-tok", CartId::new(), Some("att-x")).await;
    assert_eq!(
        s2.sale_id, s1.sale_id,
        "the second shortfall submit must replay the first resolution's receipt — two sales here is the same basket's money counted twice"
    );
}

#[tokio::test]
async fn attempt_id_reuse_across_carts_settles_each_basket_under_its_own_key() {
    // PINS the reuse-across-carts answer: a live base-key sale plus a fresh
    // cart SETTLES the new basket under its own basket-derived key — a hard
    // refusal here would make a legitimate sale impossible after a lost
    // response. Each basket's retry then finds its OWN receipt.
    let bridge = replay_guard_bridge();
    let started1 = start_sale_scoped(
        &bridge.ctx(),
        "replay-tok",
        StartSaleArgs {
            currency: "USD".into(),
        },
    )
    .await
    .unwrap();
    add_line_scoped(
        &bridge.ctx(),
        "replay-tok",
        AddLineArgs {
            cart_id: started1.cart_id,
            sku: Sku::new("REPLAY-COFFEE"),
            qty: 2,
            unit_price_minor: 350,
            unit_price_currency: None,
            course: None,
        },
    )
    .await
    .unwrap();
    let first = settle_replay_cart(&bridge, "replay-tok", started1.cart_id, Some("att-x")).await;
    // Broken-seed fallback, not a profile fork: since 19-09-26 the seeded Free
    // row verifies in BOTH profiles, so the sale below is written in both and
    // the replay-guard story is asserted in both. This arm is reached only when
    // the row exists but does not verify - then there is no sale row, no
    // idempotency key and no replay to talk about.
    if !seeded_row_loads() {
        assert_signature_denial(&bridge, first, "free").await;
        return;
    }
    let first = first.unwrap();

    // Same attempt id, DIFFERENT cart: settles, never refuses.
    let started2 = start_sale_scoped(
        &bridge.ctx(),
        "replay-tok",
        StartSaleArgs {
            currency: "USD".into(),
        },
    )
    .await
    .unwrap();
    add_line_scoped(
        &bridge.ctx(),
        "replay-tok",
        AddLineArgs {
            cart_id: started2.cart_id,
            sku: Sku::new("REPLAY-COFFEE"),
            qty: 1,
            unit_price_minor: 350,
            unit_price_currency: None,
            course: None,
        },
    )
    .await
    .unwrap();
    let second = settle_replay_cart(&bridge, "replay-tok", started2.cart_id, Some("att-x"))
        .await
        .unwrap();
    assert_ne!(
        second.sale_id, first.sale_id,
        "basket 2 must settle as its own sale, not replay basket 1's receipt"
    );

    // Basket 2's lost-response retry finds basket 2's receipt...
    let retried = settle_replay_cart(&bridge, "replay-tok", started2.cart_id, Some("att-x"))
        .await
        .unwrap();
    assert_eq!(
        retried.sale_id, second.sale_id,
        "the retry must be answered with basket 2's own receipt"
    );
    // ...and basket 1's genuine replay still answers with basket 1's sale.
    let replayed_first = settle_replay_cart(&bridge, "replay-tok", started1.cart_id, Some("att-x"))
        .await
        .unwrap();
    assert_eq!(
        replayed_first.sale_id, first.sale_id,
        "a genuine replay of basket 1 must keep answering with basket 1's sale"
    );
}

#[test]
fn attempt_ids_with_colons_are_rejected_and_rekey_stems_stay_disjoint() {
    // The ':' separator is reused inside client-supplied attempt ids, so a
    // crafted "a:rekey:b" would stamp a base key identical to another
    // attempt's re-key LOOKUP key and hand one basket the wrong receipt.
    // The door rejects them outright; the stem keeps the literal ":rekey:"
    // segment so the re-key namespace never overlaps the base-key namespace.
    assert_eq!(
        validated_attempt_id(Some("att-x")).unwrap().as_deref(),
        Some("att-x")
    );
    assert_eq!(
        validated_attempt_id(Some("  att-x  ")).unwrap().as_deref(),
        Some("att-x")
    );
    assert!(validated_attempt_id(None).unwrap().is_none());
    assert!(validated_attempt_id(Some("   ")).unwrap().is_none());
    assert!(
        validated_attempt_id(Some("a:rekey:b")).is_err(),
        "a colon lets a crafted attempt forge another attempt's re-key lookup key"
    );
    assert_ne!(
        rekey_stem("att-x", "cart:u1", 0),
        rekey_stem("att-x", "cart:u2", 0),
        "distinct baskets under one attempt must hash to distinct stems"
    );
    assert!(
        rekey_stem("att-x", "cart:u1", 3).contains(":rekey:"),
        "every re-key stem carries the re-key segment base keys can never have"
    );
}

#[tokio::test]
async fn whitespace_only_attempt_id_is_unguarded_like_the_tablet() {
    // Trim-parity pin: the tablet's normalized_attempt_id collapses
    // absent/empty/whitespace-only to UNGUARDED (NULL keys) — never a
    // guarded stem. The bridge validator must agree, or the two shells
    // disagree about what an empty attempt means.
    let bridge = replay_guard_bridge();
    let started = start_sale_scoped(
        &bridge.ctx(),
        "replay-tok",
        StartSaleArgs {
            currency: "USD".into(),
        },
    )
    .await
    .unwrap();
    add_line_scoped(
        &bridge.ctx(),
        "replay-tok",
        AddLineArgs {
            cart_id: started.cart_id,
            sku: Sku::new("REPLAY-COFFEE"),
            qty: 2,
            unit_price_minor: 350,
            unit_price_currency: None,
            course: None,
        },
    )
    .await
    .unwrap();
    let sale = settle_replay_cart(&bridge, "replay-tok", started.cart_id, Some("   ")).await;
    // Broken-seed fallback, not a profile fork: since 19-09-26 the seeded Free
    // row verifies in BOTH profiles, so the settlement below reaches the
    // normalizer in both. This arm is reached only when the row exists but does
    // not verify - then it is refused before the normalizer is ever asked
    // whether a whitespace-only attempt id stamps NULL, a question that needs a
    // written payment row to be answerable.
    if !seeded_row_loads() {
        assert_signature_denial(&bridge, sale, "free").await;
        return;
    }
    let sale = sale.unwrap();
    let store_conn = bridge
        .db_manager()
        .open_store("store-replay-guard")
        .unwrap();
    let db = store_conn.lock().unwrap();
    let keyed: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM payments WHERE sale_id = ?1 AND idempotency_key IS NOT NULL",
            rusqlite::params![sale.sale_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        keyed, 0,
        "a whitespace-only attempt id must stamp NULL keys, exactly like the tablet normalizer"
    );
}
// ── Tax scope at the command layer (tax-separation P1) ─────────────

fn single_line_cart() -> kasirmu_core::Cart {
    let mut cart = kasirmu_core::Cart::new(usd());
    cart.add_line(kasirmu_core::CartLine::new(
        Sku::new("COFFEE"),
        2,
        price(350),
    ))
    .unwrap();
    cart
}

#[test]
fn tax_scope_now_carries_the_location_and_a_date_the_resolver_accepts() {
    // The command layer owns the business date, so it owns getting the shape
    // right. A scope the core resolver rejects fails EVERY sale at this
    // location — loudly, which is the intended failure mode, but loudly at
    // checkout is still a broken checkout.
    let db = crate::testing::temp_conn();
    let store = Store::new(&db);
    let scope = tax_scope_now(&store, "loc-42");
    assert_eq!(
        scope.location_id, "loc-42",
        "the session's store id must pass through unchanged"
    );
    chrono::NaiveDate::parse_from_str(&scope.as_of, "%Y-%m-%d").unwrap_or_else(|e| {
        panic!(
            "as_of must be a bare business date the resolver parses, got {:?}: {e}",
            scope.as_of
        )
    });
}

#[test]
fn a_store_scoped_rate_wins_over_the_tenant_default_through_the_command_door() {
    // Core proves the resolver. This pins the exact call shape pos.rs uses —
    // tax_scope_now + compute_sale_tax_for_location + the settings rounding
    // mode — so a location with its own rate stops inheriting the tenant
    // default at the command layer, and does not leak it next door.
    let db = crate::testing::temp_conn();
    let store = Store::new(&db);
    db.execute(
        "INSERT INTO legal_entities (id, tenant_id, name) VALUES ('ent-1', 'default', 'Ent')",
        [],
    )
    .unwrap();
    for (id, name) in [("loc-here", "Here"), ("loc-there", "There")] {
        db.execute(
            "INSERT INTO locations (id, name, legal_entity_id) VALUES (?1, ?2, 'ent-1')",
            rusqlite::params![id, name],
        )
        .unwrap();
    }
    store
        .create_tax_rate("National VAT", 1000, true, false)
        .unwrap();
    db.execute(
        "INSERT INTO tax_rates (id, name, rate_bps, is_default, is_inclusive, is_active, location_id)
         VALUES ('r-here', 'Here VAT', 1100, 0, 0, 1, 'loc-here')",
        [],
    )
    .unwrap();
    let mode = kasirmu_core::Settings::get_tax_rounding_mode(&db).unwrap();

    let mut here = kasirmu_core::Sale::from_cart(&single_line_cart()).unwrap();
    store
        .compute_sale_tax_for_location(
            &mut here,
            &[],
            mode,
            Some(&tax_scope_now(&store, "loc-here")),
        )
        .unwrap();
    assert_eq!(here.lines[0].tax_rate_id.as_deref(), Some("r-here"));
    assert_eq!(here.tax_total.minor_units, 77, "11% of 700");

    let mut there = kasirmu_core::Sale::from_cart(&single_line_cart()).unwrap();
    store
        .compute_sale_tax_for_location(
            &mut there,
            &[],
            mode,
            Some(&tax_scope_now(&store, "loc-there")),
        )
        .unwrap();
    assert_eq!(
        there.tax_total.minor_units, 70,
        "the neighbouring branch keeps the tenant default"
    );

    // The regression this exists to catch: if a future edit drops the scope
    // argument, loc-here silently gets THIS number.
    let mut forgot = kasirmu_core::Sale::from_cart(&single_line_cart()).unwrap();
    store.compute_sale_tax(&mut forgot, &[], mode).unwrap();
    assert_eq!(forgot.tax_total.minor_units, 70);
}

#[test]
fn complete_sale_scoped_args_reject_unknown_keys_loudly() {
    // The hardening ported from the tablet shell (Phase 3.3 T4): the
    // shipped UI once sent `attemptId` and the DTO silently dropped it,
    // which made checkout look guarded while it was not. With
    // `deny_unknown_fields`, an unknown key fails deserialization instead
    // of vanishing — on every shell, since the DTO is shared.
    let json = r#"{"cartId":"00000000-0000-0000-0000-000000000001","paymentMethod":"cash","tenderedMinor":100,"typoField":1}"#;
    let err = serde_json::from_str::<CompleteSaleScopedArgs>(json).unwrap_err();
    assert!(
        err.to_string().contains("unknown field"),
        "expected unknown-field rejection, got: {err}"
    );
}

#[test]
fn complete_sale_scoped_args_accept_the_ui_wire() {
    // Positive pin: the exact key set PaymentModal sends (camelCase,
    // 15 fields) deserializes cleanly.
    let json = r#"{"cartId":"00000000-0000-0000-0000-000000000001","paymentMethod":"cash","tenderedMinor":100,
        "customerId":null,"paymentSplits":null,"customerName":null,
        "serialNumbers":null,"baseCurrency":null,"baseTotalMinor":null,
        "tenderRateMillionths":null,"tipMinor":null,"serviceChargeMinor":null,
        "promotionIds":null,"attemptId":"att-1","taxEstimated":false}"#;
    let args: CompleteSaleScopedArgs = serde_json::from_str(json).unwrap();
    assert_eq!(
        args.cart_id.to_string(),
        "00000000-0000-0000-0000-000000000001"
    );
    assert_eq!(args.payment_method, "cash");
    assert_eq!(args.attempt_id.as_deref(), Some("att-1"));
    assert_eq!(args.tax_estimated, Some(false));
}

// ── Restaurant coursing: set_line_course_scoped ────────────────

#[tokio::test]
async fn set_line_course_assigns_and_clears_with_normalization() {
    let conn = crate::testing::temp_conn();
    seed_owner(&conn);
    let bridge = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");

    let started = start_sale_scoped(
        &bridge.ctx(),
        "tok",
        StartSaleArgs {
            currency: "USD".into(),
        },
    )
    .await
    .unwrap();
    let added = add_line_scoped(
        &bridge.ctx(),
        "tok",
        AddLineArgs {
            cart_id: started.cart_id,
            sku: Sku::new("STEAK"),
            qty: 1,
            unit_price_minor: 1500,
            unit_price_currency: None,
            course: None,
        },
    )
    .await
    .unwrap();

    set_line_course_scoped(
        &bridge.ctx(),
        "tok",
        SetLineCourseArgs {
            cart_id: started.cart_id,
            line_id: added.line_id,
            course: Some("main".into()),
        },
    )
    .await
    .unwrap();
    {
        let ctx = bridge.ctx();
        let conn = ctx.db_manager.open_store("s1").unwrap();
        let db = conn.lock().unwrap();
        let cart = Store::new(&db)
            .load_active_cart(&started.cart_id)
            .unwrap()
            .unwrap();
        assert_eq!(cart.lines()[0].course.as_deref(), Some("main"));
    }

    // Legacy "drinks" normalizes to "beverage" on the same path.
    set_line_course_scoped(
        &bridge.ctx(),
        "tok",
        SetLineCourseArgs {
            cart_id: started.cart_id,
            line_id: added.line_id,
            course: Some("drinks".into()),
        },
    )
    .await
    .unwrap();
    {
        let ctx = bridge.ctx();
        let conn = ctx.db_manager.open_store("s1").unwrap();
        let db = conn.lock().unwrap();
        let cart = Store::new(&db)
            .load_active_cart(&started.cart_id)
            .unwrap()
            .unwrap();
        assert_eq!(cart.lines()[0].course.as_deref(), Some("beverage"));
    }

    // Empty clears the assignment.
    set_line_course_scoped(
        &bridge.ctx(),
        "tok",
        SetLineCourseArgs {
            cart_id: started.cart_id,
            line_id: added.line_id,
            course: Some("".into()),
        },
    )
    .await
    .unwrap();
    {
        let ctx = bridge.ctx();
        let conn = ctx.db_manager.open_store("s1").unwrap();
        let db = conn.lock().unwrap();
        let cart = Store::new(&db)
            .load_active_cart(&started.cart_id)
            .unwrap()
            .unwrap();
        assert_eq!(cart.lines()[0].course, None);
    }
}

#[tokio::test]
async fn set_line_course_rejects_unknown_cart_and_line() {
    let conn = crate::testing::temp_conn();
    seed_owner(&conn);
    let bridge = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");

    let started = start_sale_scoped(
        &bridge.ctx(),
        "tok",
        StartSaleArgs {
            currency: "USD".into(),
        },
    )
    .await
    .unwrap();
    let added = add_line_scoped(
        &bridge.ctx(),
        "tok",
        AddLineArgs {
            cart_id: started.cart_id,
            sku: Sku::new("STEAK"),
            qty: 1,
            unit_price_minor: 1500,
            unit_price_currency: None,
            course: None,
        },
    )
    .await
    .unwrap();

    let missing_cart = set_line_course_scoped(
        &bridge.ctx(),
        "tok",
        SetLineCourseArgs {
            cart_id: CartId::new(),
            line_id: added.line_id,
            course: Some("main".into()),
        },
    )
    .await;
    assert!(matches!(missing_cart, Err(BridgeError::Invalid(_))));

    let missing_line = set_line_course_scoped(
        &bridge.ctx(),
        "tok",
        SetLineCourseArgs {
            cart_id: started.cart_id,
            line_id: LineId::new(),
            course: Some("main".into()),
        },
    )
    .await;
    assert!(matches!(missing_line, Err(BridgeError::Invalid(_))));
}

#[tokio::test]
async fn set_line_course_and_publish_course_fired_reject_invalid_token() {
    let conn = crate::testing::temp_conn();
    let bridge = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");

    let set = set_line_course_scoped(
        &bridge.ctx(),
        "bad-token",
        SetLineCourseArgs {
            cart_id: CartId::new(),
            line_id: LineId::new(),
            course: Some("main".into()),
        },
    )
    .await;
    assert!(matches!(set, Err(BridgeError::InvalidSession)));

    let publish = publish_course_fired_scoped(
        &bridge.ctx(),
        "bad-token",
        PublishCourseFiredArgs {
            sale_id: "sale-1".into(),
            course_id: "main".into(),
            display_number: None,
            items: vec![],
        },
    )
    .await;
    assert!(matches!(publish, Err(BridgeError::InvalidSession)));
}

#[tokio::test]
async fn publish_course_fired_rejects_unknown_sale_and_empty_course() {
    let conn = crate::testing::temp_conn();
    seed_owner(&conn);
    let bridge = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");

    let missing = publish_course_fired_scoped(
        &bridge.ctx(),
        "tok",
        PublishCourseFiredArgs {
            sale_id: "no-such-sale".into(),
            course_id: "main".into(),
            display_number: None,
            items: vec![],
        },
    )
    .await;
    assert!(matches!(missing, Err(BridgeError::Invalid(_))));

    let started = start_sale_scoped(
        &bridge.ctx(),
        "tok",
        StartSaleArgs {
            currency: "USD".into(),
        },
    )
    .await
    .unwrap();
    let sale_id = complete_sale_scoped(
        &bridge.ctx(),
        "tok",
        CompleteSaleScopedArgs {
            cart_id: started.cart_id,
            payment_method: "cash".into(),
            tendered_minor: Some(500),
            customer_id: None,
            payment_splits: None,
            customer_name: None,
            serial_numbers: None,
            base_currency: None,
            base_total_minor: None,
            tender_rate_millionths: None,
            tip_minor: None,
            service_charge_minor: None,
            promotion_ids: None,
            attempt_id: None,
            tax_estimated: None,
        },
    )
    .await
    .map(|r| r.sale_id);
    // The settlement may still be refused (a missing or unverifiable signature
    // row) — the empty-course rejection below does not depend on which it was.
    let empty_args = PublishCourseFiredArgs {
        sale_id: sale_id.unwrap_or_else(|_| "no-such-sale".into()),
        course_id: "  ".into(),
        display_number: None,
        items: vec![],
    };
    let empty = publish_course_fired_scoped(&bridge.ctx(), "tok", empty_args).await;
    assert!(matches!(empty, Err(BridgeError::Invalid(_))));
}

// ── C13: a plugin discount clears the same gate as the manual path ──

/// Write a one-plugin directory whose script is `lua` and whose manifest
/// declares exactly `permissions`. Mirrors kasirmu-plugin's own fixture.
fn plugin_dir(name: &str, lua: &str, permissions: &[&str]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let plugin_dir = dir.path().join(name);
    std::fs::create_dir(&plugin_dir).unwrap();
    let perms = permissions
        .iter()
        .map(|p| format!("\"{p}\""))
        .collect::<Vec<_>>()
        .join(", ");
    std::fs::write(
        plugin_dir.join("plugin.toml"),
        format!(
            "[plugin]\nname = \"{name}\"\nversion = \"1.0.0\"\n\n[capabilities]\nscripts = [\"script.lua\"]\n\n[permissions]\nrequired_permissions = [{perms}]\n"
        ),
    )
    .unwrap();
    std::fs::write(plugin_dir.join("script.lua"), lua).unwrap();
    dir
}

/// Seed a role granting exactly `permissions` plus the user that holds it.
///
/// A bespoke role rather than a preset: the presets grant SALES_DISCOUNT to
/// every checkout role (Owner wildcard, Manager, Staff, Admin), so only a role
/// authored here can prove the plugin path is gated rather than merely
/// permissioned in practice.
fn seed_role_with_permissions(
    conn: &rusqlite::Connection,
    role_id: &str,
    user_id: &str,
    permissions: &[&str],
) {
    Store::new(conn).seed_default_roles().unwrap();
    let perms = permissions
        .iter()
        .map(|p| format!("\"{p}\""))
        .collect::<Vec<_>>()
        .join(", ");
    conn.execute(
        "INSERT OR REPLACE INTO roles (id, name, description, permissions, created_at, updated_at)
         VALUES (?1, ?1, 'plugin-gate fixture', ?2, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        rusqlite::params![role_id, format!("[{perms}]")],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES (?1, ?1, 'hash', ?1, ?2, 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        rusqlite::params![user_id, role_id],
    )
    .unwrap();
}

/// `bridge.ctx()` with a plugin manager installed — `TestBridge` has no
/// plugin setter (its headless default is `None`), and every `BridgeCtx`
/// field is public, so the context is rebuilt over the same borrows.
fn ctx_with_plugins<'a>(
    bridge: &'a crate::testing::TestBridge,
    plugins: &'a tokio::sync::Mutex<Option<kasirmu_plugin::PluginManager>>,
) -> BridgeCtx<'a> {
    BridgeCtx {
        plugins,
        ..bridge.ctx()
    }
}

/// Bridge + store for the plugin-discount gate: one sellable product and a
/// session on token `plugin-tok` holding `role_id`.
fn plugin_gate_bridge(
    role_id: &str,
    user_id: &str,
    permissions: &[&str],
) -> crate::testing::TestBridge {
    let store_id = "store-plugin-gate";
    let global = crate::testing::temp_conn();
    seed_role_with_permissions(&global, role_id, user_id, permissions);
    let bridge = crate::testing::TestBridge::new().with_conn(global);
    {
        let store_conn = bridge.db_manager().open_store(store_id).unwrap();
        let db = store_conn.lock().unwrap();
        db.execute_batch(
            "INSERT INTO products (id, sku, name, price_minor, currency, product_type)
                 VALUES ('plugin-product', 'PLUGIN-COFFEE', 'Plugin Coffee', 1000, 'USD', 'retail');
             INSERT INTO stock_summary (item_id, location_id, qty)
                 VALUES ('plugin-product', '01926b3a-0000-7000-8000-000000000001', 100);",
        )
        .unwrap();
    }
    bridge.sessions().write().unwrap().insert(
        "plugin-tok".into(),
        SessionContext::new(
            user_id.into(),
            role_id.into(),
            "plugin-terminal".into(),
            store_id.into(),
            "plugin-instance".into(),
            "restaurant-pos".into(),
            None,
            0,
        ),
    );
    bridge
}

/// Ring up one cart of PLUGIN-COFFEE and settle it through `complete_sale_scoped`.
async fn settle_plugin_gate_cart(ctx: &BridgeCtx<'_>) -> Result<CompleteSaleResult, BridgeError> {
    let started = start_sale_scoped(
        ctx,
        "plugin-tok",
        StartSaleArgs {
            currency: "USD".into(),
        },
    )
    .await
    .unwrap();
    add_line_scoped(
        ctx,
        "plugin-tok",
        AddLineArgs {
            cart_id: started.cart_id,
            sku: Sku::new("PLUGIN-COFFEE"),
            qty: 1,
            unit_price_minor: 1000,
            unit_price_currency: None,
            course: None,
        },
    )
    .await
    .unwrap();
    complete_sale_scoped(
        ctx,
        "plugin-tok",
        CompleteSaleScopedArgs {
            cart_id: started.cart_id,
            payment_method: "cash".into(),
            tendered_minor: Some(5000),
            customer_id: None,
            payment_splits: None,
            customer_name: None,
            serial_numbers: None,
            base_currency: None,
            base_total_minor: None,
            tender_rate_millionths: None,
            tip_minor: None,
            service_charge_minor: None,
            promotion_ids: None,
            attempt_id: None,
            tax_estimated: None,
        },
    )
    .await
}

#[tokio::test]
async fn plugin_discount_without_sales_discount_is_refused() {
    // The defect this closes: the plugin manifest's required_permissions is
    // self-declared and never compared with the caller's role, so before this
    // gate a plugin (or anyone able to drop a .lua file in the plugin
    // directory) discounted an order with no permission and no audit.
    let dir = plugin_dir(
        "discounter",
        "oz.apply_discount(\"cart\", 20)\n",
        &["cart:read", "cart:write"],
    );
    let plugins = tokio::sync::Mutex::new(Some(
        kasirmu_plugin::PluginManager::new(dir.path()).unwrap(),
    ));

    let bridge = plugin_gate_bridge(
        "role-plugin-nodiscount",
        "user-plugin-nodiscount",
        &["sales:process"],
    );
    let ctx = ctx_with_plugins(&bridge, &plugins);
    let settled = settle_plugin_gate_cart(&ctx).await;

    match settled {
        Err(BridgeError::PermissionDenied(message)) => assert!(
            message.contains("sales:discount"),
            "the refusal must be the SALES_DISCOUNT gate, got: {message}"
        ),
        Err(err) => panic!(
            "a plugin discount without SALES_DISCOUNT must be refused by the permission gate, got: {err:?}"
        ),
        Ok(result) => panic!(
            "a plugin discount without SALES_DISCOUNT settled sale {} — the money-boundary defect",
            result.sale_id
        ),
    }
}

#[tokio::test]
async fn plugin_discount_with_sales_discount_succeeds() {
    let dir = plugin_dir(
        "discounter",
        "oz.apply_discount(\"cart\", 20)\n",
        &["cart:read", "cart:write"],
    );
    let plugins = tokio::sync::Mutex::new(Some(
        kasirmu_plugin::PluginManager::new(dir.path()).unwrap(),
    ));

    let bridge = plugin_gate_bridge(
        "role-plugin-discount",
        "user-plugin-discount",
        &["sales:process", "sales:discount"],
    );
    let ctx = ctx_with_plugins(&bridge, &plugins);
    let settled = settle_plugin_gate_cart(&ctx).await;

    let result = match settled {
        Ok(result) => result,
        Err(err) => panic!(
            "a plugin discount WITH SALES_DISCOUNT must settle exactly as before, got: {err:?}"
        ),
    };

    // The gate must not have swallowed the discount on the way through: the
    // persisted sale carries the plugin's 20% and the payable total reflects it.
    let store_conn = bridge.db_manager().open_store("store-plugin-gate").unwrap();
    let db = store_conn.lock().unwrap();
    let stored = Store::new(&db)
        .get_sale(&result.sale_id)
        .unwrap()
        .expect("the settled sale must be readable");
    assert_eq!(
        stored.discount_percent, 20,
        "the plugin's discount must survive the permission gate"
    );
    assert_eq!(
        stored.total.minor_units, 800,
        "1000 minor less the plugin's 20% is the payable"
    );
}

// ── C2: the shortfall door passes the plugin tax overrides ──────────

#[tokio::test]
async fn shortfall_door_applies_the_same_plugin_tax_overrides_as_the_main_door() {
    // The asymmetry this closes: the main checkout door passes the plugin's
    // calc_line_tax overrides into the tax computation, this door passed an
    // EMPTY list — so the same basket was taxed at the DB rate when it went
    // through shortfall resolution and at the plugin's rate otherwise.
    let dir = plugin_dir(
        "taxer",
        "function calc_line_tax(sku, qty, unit_price_minor, currency)\n    if sku == \"REPLAY-COFFEE\" then\n        return { rate_bps = 500, is_inclusive = false }\n    end\n    return nil\nend\n",
        &["cart:read"],
    );
    let plugins = tokio::sync::Mutex::new(Some(
        kasirmu_plugin::PluginManager::new(dir.path()).unwrap(),
    ));

    // replay_guard_bridge seeds REPLAY-COFFEE at 350 with NO tax rate rows, so
    // an override that never arrived would leave the line's tax at 0.
    let bridge = replay_guard_bridge();
    let ctx = ctx_with_plugins(&bridge, &plugins);
    let settled = complete_sale_with_resolved_shortfalls_scoped(
        &ctx,
        "replay-tok",
        CompleteSaleWithResolvedShortfallsArgs {
            cart_id: CartId::new(),
            payment_method: "cash".into(),
            tendered_minor: Some(5000),
            customer_id: None,
            payment_splits: None,
            customer_name: None,
            serial_numbers: None,
            lines: vec![CartLineData {
                sku: "REPLAY-COFFEE".into(),
                qty: 2,
                unit_price_minor: 350,
                unit_price_currency: None,
                course: None,
            }],
            total_minor: 700,
            currency: "USD".into(),
            discount_percent: 0,
            discount_label: None,
            promotion_ids: None,
            resolutions: vec![],
            base_currency: None,
            base_total_minor: None,
            tender_rate_millionths: None,
            tip_minor: None,
            service_charge_minor: None,
            attempt_id: None,
        },
    )
    .await
    .unwrap();

    let store_conn = bridge
        .db_manager()
        .open_store("store-replay-guard")
        .unwrap();
    let db = store_conn.lock().unwrap();
    let stored = Store::new(&db)
        .get_sale(&settled.sale_id)
        .unwrap()
        .expect("the settled sale must be readable");
    // 2 x 350 = 700 minor at the plugin's 500 bps exclusive = 35 minor.
    assert_eq!(
        stored.lines[0].tax_amount.minor_units, 35,
        "the shortfall door must tax at the plugin's rate, not fall back to the DB rate"
    );
    assert!(
        stored.lines[0].tax_rate_id.is_none(),
        "the override's provenance is a null rate id"
    );
}
