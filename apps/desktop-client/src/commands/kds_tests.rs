use super::*;
use oz_core::RegisterKdsDeviceInput;
use oz_core::session::SessionContext;
use oz_core::{CreateKdsOrderInput, Currency, Money, Sale, SaleStatus};
use platform_core::StoreDatabaseManager;
use tauri::Manager as _;

// ── Existing tests (preserved) ────────────────────────────────────

#[test]
fn empty_runtime_kds_targets_disable_ticket_creation() {
    let conn = oz_core::migrations::fresh_db();
    let key = format!("{TOPOLOGY_RUNTIME_SETTING_KEY}/store-1");
    oz_core::Settings::set(&conn, &key, r#"{"routes":[]}"#).unwrap();

    let runtime_targets = resolve_runtime_kds_plan(&conn, "store-1")
        .unwrap()
        .map(|plan| runtime_kds_target_instances(&plan, "pos-main"));
    assert_eq!(runtime_targets, Some(Vec::<String>::new()));
    assert!(!should_create_kds_tickets(runtime_targets.as_deref()));
    assert!(should_create_kds_tickets(None));
}

fn test_kds_order(id: &str) -> KdsOrder {
    KdsOrder {
        id: id.into(),
        sale_id: format!("sale-{id}"),
        store_id: Some("store-1".into()),
        target_instance_id: Some("kds-main".into()),
        status: "pending".into(),
        items_summary: "Burger".into(),
        item_count: 1,
        display_number: Some(1),
        received_at: "2026-08-09T12:00:00.000Z".into(),
        started_at: None,
        ready_at: None,
        served_at: None,
        prep_time_seconds: 0,
        kitchen_zone: None,
        notes: String::new(),
        table_number: None,
        priority: false,
    }
}

#[test]
fn runtime_plan_maps_each_kds_target_to_its_hardware() {
    let plan = serde_json::json!({
        "routes": [
            {
                "source_instance_id": "kds-main",
                "target_instance_id": "printer-grill",
                "from_port_id": "ticket-out",
                "to_port_id": "ticket-in",
                "relationship_type": "ticket-routing"
            },
            {
                "source_instance_id": "kds-expediter",
                "target_instance_id": "printer-pass",
                "from_port_id": "ticket-out",
                "to_port_id": "ticket-in",
                "relationship_type": "ticket-routing"
            },
            {
                "source_instance_id": "kds-main",
                "target_instance_id": "printer-grill",
                "from_port_id": "ticket-out",
                "to_port_id": "ticket-in",
                "relationship_type": "ticket-routing"
            }
        ]
    });
    let kds_targets = vec!["kds-main".into(), "kds-expediter".into()];
    assert_eq!(
        runtime_kds_hardware_targets(&plan, &kds_targets),
        vec![
            ("kds-main".into(), "printer-grill".into()),
            ("kds-expediter".into(), "printer-pass".into()),
        ]
    );
    let jobs = build_kds_chit_jobs(&[test_kds_order("order-1")], &kds_targets, &plan);
    assert_eq!(jobs.len(), 2);
    assert_eq!(jobs[0].hardware_instance_id, "printer-grill");
    assert_eq!(jobs[1].hardware_instance_id, "printer-pass");
}

#[tokio::test]
async fn target_aware_chit_jobs_print_to_separate_registered_printers() {
    let registry = oz_hal::DriverRegistry::default();
    let grill = Arc::new(oz_hal::drivers::mock::MockReceiptPrinter::new());
    let pass = Arc::new(oz_hal::drivers::mock::MockReceiptPrinter::new());
    registry
        .register_printer("printer-grill", grill.clone())
        .await;
    registry
        .register_printer("printer-pass", pass.clone())
        .await;
    let plan = serde_json::json!({
        "routes": [
            {"source_instance_id":"kds-main","target_instance_id":"printer-grill","from_port_id":"ticket-out","to_port_id":"ticket-in","relationship_type":"ticket-routing"},
            {"source_instance_id":"kds-expediter","target_instance_id":"printer-pass","from_port_id":"ticket-out","to_port_id":"ticket-in","relationship_type":"ticket-routing"}
        ]
    });
    let orders = vec![test_kds_order("order-1")];
    let kds_targets = vec!["kds-main".into(), "kds-expediter".into()];

    try_auto_print_kds_chit_jobs(&orders, &kds_targets, &plan, &registry, None).await;

    assert_eq!(grill.printed_raw.lock().unwrap().len(), 1);
    assert_eq!(pass.printed_raw.lock().unwrap().len(), 1);
}

#[test]
fn runtime_plan_selects_all_kds_targets_for_pos_source() {
    let plan = serde_json::json!({
        "routes": [
            {
                "source_instance_id": "pos-main",
                "target_instance_id": "kds-main",
                "from_port_id": "operation-out",
                "to_port_id": "operation-in",
                "relationship_type": "generic"
            },
            {
                "source_instance_id": "pos-main",
                "target_instance_id": "kds-expediter",
                "from_port_id": "operation-out",
                "to_port_id": "operation-in",
                "relationship_type": "generic"
            },
            {
                "source_instance_id": "pos-main",
                "target_instance_id": "kds-main",
                "from_port_id": "operation-out",
                "to_port_id": "operation-in",
                "relationship_type": "generic"
            }
        ]
    });
    assert_eq!(
        runtime_kds_target_instances(&plan, "pos-main"),
        vec!["kds-main", "kds-expediter"]
    );
    assert!(runtime_kds_target_instances(&plan, "other-pos").is_empty());
}

// ── Helpers ───────────────────────────────────────────────────────

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

fn scoped_state(
    conn: rusqlite::Connection,
    token: &str,
    user_id: &str,
    role_id: &str,
    store_id: &str,
    instance_id: &str,
) -> AppState {
    scoped_state_with_restaurant(conn, token, user_id, role_id, store_id, instance_id, None)
}

fn scoped_state_with_restaurant(
    conn: rusqlite::Connection,
    token: &str,
    user_id: &str,
    role_id: &str,
    store_id: &str,
    instance_id: &str,
    restaurant_pos_id: Option<String>,
) -> AppState {
    let temp_dir = tempfile::tempdir().unwrap();
    let mut state = AppState::for_test_with_conn(conn);
    state.db_manager =
        StoreDatabaseManager::new(temp_dir.path().to_path_buf(), oz_core::migrations::ALL);
    state.session_store.write().unwrap().insert(
        token.into(),
        SessionContext::new_with_restaurant_pos(
            user_id.into(),
            role_id.into(),
            "terminal-1".into(),
            store_id.into(),
            instance_id.into(),
            "pos".into(),
            None,
            0,
            restaurant_pos_id,
        ),
    );
    state
}

/// Seed a terminal into the store DB (via db_manager) so FK constraints
/// on kds_devices.restaurant_pos_id are satisfied.
fn seed_terminal_in_store(state: &AppState, store_id: &str, id: &str, name: &str, device_id: &str) {
    let store_db = state.db_manager.open_store(store_id).unwrap();
    let db = store_db.lock().unwrap();
    db.execute(
        "INSERT OR IGNORE INTO terminals (id, name, device_id, is_active, created_at, updated_at)
         VALUES (?1, ?2, ?3, 1, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        rusqlite::params![id, name, device_id],
    )
    .unwrap();
}

fn create_sale_in_store(state: &AppState, sale_id: &str) {
    let store_db = state.db_manager.open_store("s1").unwrap();
    let db = store_db.lock().unwrap();
    let s = Store::new(&db);
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let usd: Currency = "USD".parse().unwrap();
    let zero = Money {
        minor_units: 0,
        currency: usd,
    };
    let sale = Sale {
        id: sale_id.into(),
        status: SaleStatus::Pending,
        total: zero,
        line_count: 0,
        currency: usd,
        payment_method: None,
        tendered_minor: None,
        user_id: Some("user-owner".into()),
        created_at: now.clone(),
        updated_at: now,
        lines: Vec::new(),
        discount_percent: 0,
        discount_label: None,
        subtotal: zero,
        tax_total: zero,
        customer_id: None,
        base_currency: None,
        base_total_minor: None,
        tender_rate_millionths: None,
        tip_minor: 0,
        service_charge_minor: 0,
        version: 1,
    };
    s.create_sale(&sale).unwrap();
}

fn create_kds_order_in_store(state: &AppState, order: &KdsOrder) -> KdsOrder {
    // First create the FK sale in the same store-DB.
    create_sale_in_store(state, &order.sale_id);
    let store_db = state.db_manager.open_store("s1").unwrap();
    let db = store_db.lock().unwrap();
    let s = Store::new(&db);
    let input = CreateKdsOrderInput {
        sale_id: order.sale_id.clone(),
        store_id: order.store_id.clone(),
        items_summary: order.items_summary.clone(),
        item_count: order.item_count,
        kitchen_zone: order.kitchen_zone.clone(),
        notes: order.notes.clone(),
        table_number: order.table_number.clone(),
        priority: order.priority,
    };
    s.create_kds_order_routed(input, order.target_instance_id.as_deref())
        .unwrap()
}

// ── Session validation ────────────────────────────────────────────

#[tokio::test]
async fn scoped_list_kds_orders_rejects_invalid_token() {
    let conn = oz_core::migrations::fresh_db();
    let state = scoped_state(conn, "tok", "user-owner", "role-owner", "s1", "kds-main");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let result = list_kds_orders_scoped("bad-token".into(), None, app.state()).await;
    assert!(matches!(result, Err(AppError::InvalidSession)));
}

#[tokio::test]
async fn scoped_get_kds_queue_rejects_invalid_token() {
    let conn = oz_core::migrations::fresh_db();
    let state = scoped_state(conn, "tok", "user-owner", "role-owner", "s1", "kds-main");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let result = get_kds_queue_scoped("bad-token".into(), None, app.state()).await;
    assert!(matches!(result, Err(AppError::InvalidSession)));
}

#[tokio::test]
async fn scoped_get_kds_order_rejects_invalid_token() {
    let conn = oz_core::migrations::fresh_db();
    let state = scoped_state(conn, "tok", "user-owner", "role-owner", "s1", "kds-main");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let result = get_kds_order_scoped("bad-token".into(), "order-1".into(), app.state()).await;
    assert!(matches!(result, Err(AppError::InvalidSession)));
}

// ── CRUD operations ───────────────────────────────────────────────

#[tokio::test]
async fn owner_can_list_kds_orders_empty() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let state = scoped_state(conn, "tok", "user-owner", "role-owner", "s1", "kds-main");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let orders = list_kds_orders_scoped("tok".into(), None, app.state())
        .await
        .unwrap();
    assert!(orders.is_empty());
}

#[tokio::test]
async fn owner_can_list_kds_orders_with_data() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let state = scoped_state(conn, "tok", "user-owner", "role-owner", "s1", "kds-main");

    let order = test_kds_order("o1");
    let created = create_kds_order_in_store(&state, &order);

    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let orders = list_kds_orders_scoped("tok".into(), None, app.state())
        .await
        .unwrap();
    assert_eq!(orders.len(), 1);
    assert_eq!(orders[0].id, created.id);
}

#[tokio::test]
async fn list_kds_orders_filters_by_status() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let state = scoped_state(conn, "tok", "user-owner", "role-owner", "s1", "kds-main");

    // Create two orders (both start as "pending" per DB default).
    let order1 = create_kds_order_in_store(&state, &test_kds_order("o1"));
    let order2 = create_kds_order_in_store(&state, &test_kds_order("o2"));

    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    // Move order2 through the valid forward-only chain: pending -> preparing -> ready.
    update_kds_status_scoped(
        "tok".into(),
        order2.id.clone(),
        "preparing".into(),
        app.state(),
    )
    .await
    .unwrap();
    update_kds_status_scoped("tok".into(), order2.id.clone(), "ready".into(), app.state())
        .await
        .unwrap();

    // Now filter by status.
    let pending_orders = list_kds_orders_scoped("tok".into(), Some("pending".into()), app.state())
        .await
        .unwrap();
    assert_eq!(pending_orders.len(), 1);
    assert_eq!(pending_orders[0].id, order1.id);

    let ready_orders = list_kds_orders_scoped("tok".into(), Some("ready".into()), app.state())
        .await
        .unwrap();
    assert_eq!(ready_orders.len(), 1);
    assert_eq!(ready_orders[0].id, order2.id);
}

#[tokio::test]
async fn owner_can_get_kds_order_by_id() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let state = scoped_state(conn, "tok", "user-owner", "role-owner", "s1", "kds-main");

    let order = test_kds_order("o1");
    let created = create_kds_order_in_store(&state, &order);

    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let fetched = get_kds_order_scoped("tok".into(), created.id.clone(), app.state()).await;
    assert!(fetched.is_ok());
    assert!(fetched.unwrap().is_some());
}

#[tokio::test]
async fn get_kds_order_returns_none_for_unknown() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let state = scoped_state(conn, "tok", "user-owner", "role-owner", "s1", "kds-main");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let result = get_kds_order_scoped("tok".into(), "nonexistent".into(), app.state())
        .await
        .unwrap();
    assert!(result.is_none());
}

#[tokio::test]
async fn owner_can_get_kds_queue() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let state = scoped_state(conn, "tok", "user-owner", "role-owner", "s1", "kds-main");

    let order = test_kds_order("o1");
    let created = create_kds_order_in_store(&state, &order);

    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let queue = get_kds_queue_scoped("tok".into(), None, app.state())
        .await
        .unwrap();
    assert_eq!(queue.len(), 1);
    assert_eq!(queue[0].id, created.id);
}

#[tokio::test]
async fn update_kds_status_returns_error_for_unknown_order() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let state = scoped_state(conn, "tok", "user-owner", "role-owner", "s1", "kds-main");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let result = update_kds_status_scoped(
        "tok".into(),
        "nonexistent".into(),
        "ready".into(),
        app.state(),
    )
    .await;
    assert!(result.is_err());
}

// ── Instance isolation ────────────────────────────────────────────

#[tokio::test]
async fn kds_orders_scoped_to_instance() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let state = scoped_state(conn, "tok", "user-owner", "role-owner", "s1", "kds-main");

    // Order for kds-main — should be visible.
    let mut order_main = test_kds_order("o1");
    order_main.target_instance_id = Some("kds-main".into());
    let created_main = create_kds_order_in_store(&state, &order_main);

    // Order for kds-expediter — should NOT be visible.
    let mut order_exp = test_kds_order("o2");
    order_exp.target_instance_id = Some("kds-expediter".into());
    create_kds_order_in_store(&state, &order_exp);

    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let orders = list_kds_orders_scoped("tok".into(), None, app.state())
        .await
        .unwrap();
    assert_eq!(orders.len(), 1, "only kds-main orders should be visible");
    assert_eq!(orders[0].id, created_main.id);
}

// ── Staff permission tests ────────────────────────────────────────

#[tokio::test]
async fn staff_can_list_kds_orders() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-staff', 'staff', 'hash', 'Staff', 'role-staff', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();
    let state = scoped_state(conn, "tok", "user-staff", "role-staff", "s1", "kds-main");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let result = list_kds_orders_scoped("tok".into(), None, app.state()).await;
    assert!(result.is_ok(), "staff has KDS_VIEW permission");
    assert!(result.unwrap().is_empty());
}

#[tokio::test]
async fn staff_can_update_kds_status() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-staff', 'staff', 'hash', 'Staff', 'role-staff', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();
    let state = scoped_state(conn, "tok", "user-staff", "role-staff", "s1", "kds-main");

    let order = test_kds_order("o1");
    let created = create_kds_order_in_store(&state, &order);

    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let result = update_kds_status_scoped(
        "tok".into(),
        created.id.clone(),
        "preparing".into(),
        app.state(),
    )
    .await;
    assert!(result.is_ok(), "staff has KDS_UPDATE permission");
}

// ── Tests for kds_device.rs scoped commands ─────────────────────

#[tokio::test]
async fn register_kds_device_scoped_rejects_invalid_token() {
    let conn = oz_core::migrations::fresh_db();
    let state = scoped_state(conn, "tok", "u1", "r1", "s1", "kds-main");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let result = crate::commands::kds_device::register_kds_device_scoped(
        "bad-token".into(),
        RegisterKdsDeviceInput {
            name: "Test KDS".into(),
            restaurant_pos_id: "resto-1".into(),
            station_ids: vec![],
            pairing_token_hash: "hash-test".into(),
            pairing_expires_at: "2099-01-01T00:00:00.000Z".into(),
        },
        app.state(),
    )
    .await;
    assert!(result.is_err(), "invalid token should be rejected");
}

#[tokio::test]
async fn register_and_list_kds_devices_scoped() {
    let conn = oz_core::migrations::fresh_db();
    // Seed owner.
    seed_owner(&conn);
    let state = scoped_state_with_restaurant(
        conn,
        "tok",
        "user-owner",
        "role-owner",
        "s1",
        "resto-1",
        Some("resto-1".into()),
    );
    // Seed terminal in the store DB (where kds_devices lives).
    seed_terminal_in_store(&state, "s1", "resto-1", "Restaurant POS", "dev-resto");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    // Register a device.
    let reg_result = crate::commands::kds_device::register_kds_device_scoped(
        "tok".into(),
        RegisterKdsDeviceInput {
            name: "Kitchen Screen".into(),
            restaurant_pos_id: "resto-1".into(),
            station_ids: vec!["grill".into(), "bar".into()],
            pairing_token_hash: "hash-test".into(),
            pairing_expires_at: "2099-01-01T00:00:00.000Z".into(),
        },
        app.state(),
    )
    .await;
    assert!(
        reg_result.is_ok(),
        "register should succeed: {:?}",
        reg_result.err()
    );

    // List devices.
    let list_result =
        crate::commands::kds_device::list_kds_devices_scoped("tok".into(), app.state()).await;
    assert!(list_result.is_ok(), "list should succeed");
    let devices = list_result.unwrap();
    assert_eq!(devices.len(), 1, "should have 1 device");
    assert_eq!(devices[0].name, "Kitchen Screen");
}

#[tokio::test]
async fn ack_kds_order_scoped_rejects_invalid_token() {
    let conn = oz_core::migrations::fresh_db();
    let state = scoped_state(conn, "tok", "u1", "r1", "s1", "kds-main");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let result = crate::commands::kds_device::ack_kds_order_scoped(
        "bad-token".into(),
        "some-order-id".into(),
        "kds-device-1".into(),
        app.state(),
    )
    .await;
    assert!(result.is_err(), "invalid token should be rejected");
}

// ── Tests for kds_routing.rs scoped command ─────────────────────

#[tokio::test]
async fn resolve_kds_targets_scoped_rejects_invalid_token() {
    let conn = oz_core::migrations::fresh_db();
    let state = scoped_state(conn, "tok", "u1", "r1", "s1", "kds-main");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let result = crate::commands::kds_routing::resolve_kds_targets_scoped(
        "bad-token".into(),
        "sale-123".into(),
        app.state(),
    )
    .await;
    assert!(result.is_err(), "invalid token should be rejected");
}

// ══════════════════════════════════════════════════════════════════
// Integration: Full KDS enrollment flow
// ══════════════════════════════════════════════════════════════════

/// End-to-end enrollment flow through Tauri commands:
/// register device → list devices → update status → ack order → stale detection.
#[tokio::test]
async fn integration_enrollment_full_lifecycle() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let state = scoped_state_with_restaurant(
        conn,
        "tok",
        "user-owner",
        "role-owner",
        "s1",
        "resto-1",
        Some("resto-1".into()),
    );
    seed_terminal_in_store(&state, "s1", "resto-1", "Restaurant POS", "dev-resto");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    // Step 1: Register a KDS device.
    let device = crate::commands::kds_device::register_kds_device_scoped(
        "tok".into(),
        RegisterKdsDeviceInput {
            name: "Grill Display".into(),
            restaurant_pos_id: "resto-1".into(),
            station_ids: vec!["grill".into(), "fryer".into()],
            pairing_token_hash: "hash-grill".into(),
            pairing_expires_at: "2099-01-01T00:00:00Z".into(),
        },
        app.state(),
    )
    .await
    .unwrap();
    assert!(!device.id.is_empty());
    assert_eq!(device.name, "Grill Display");
    assert_eq!(device.station_ids, vec!["grill", "fryer"]);
    assert!(device.is_active);
    assert_eq!(
        device.connection_status,
        oz_core::kds::KdsConnectionStatus::Disconnected
    );

    // Step 2: List devices — should show the registered device.
    let devices = crate::commands::kds_device::list_kds_devices_scoped("tok".into(), app.state())
        .await
        .unwrap();
    assert_eq!(devices.len(), 1);
    assert_eq!(devices[0].id, device.id);

    // Step 3: Get single device.
    let fetched = crate::commands::kds_device::get_kds_device_scoped(
        "tok".into(),
        device.id.clone(),
        app.state(),
    )
    .await
    .unwrap();
    assert!(fetched.is_some());
    assert_eq!(fetched.unwrap().id, device.id);

    // Step 4: Device connects — update status to connected.
    crate::commands::kds_device::update_kds_device_status_scoped(
        "tok".into(),
        device.id.clone(),
        oz_core::kds::KdsConnectionStatus::Connected,
        app.state(),
    )
    .await
    .unwrap();
    let fetched = crate::commands::kds_device::get_kds_device_scoped(
        "tok".into(),
        device.id.clone(),
        app.state(),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(
        fetched.connection_status,
        oz_core::kds::KdsConnectionStatus::Connected
    );
    assert!(fetched.last_seen_at.is_some());

    // Step 5: Create a sale + KDS order, then ack it.
    let order = create_kds_order_in_store(
        &app.state::<AppState>(),
        &KdsOrder {
            id: "order-1".into(),
            sale_id: "sale-1".into(),
            store_id: Some("s1".into()),
            target_instance_id: None,
            status: "pending".into(),
            items_summary: "Burger x2".into(),
            item_count: 2,
            display_number: None,
            received_at: "2026-08-21T10:00:00.000Z".into(),
            started_at: None,
            ready_at: None,
            served_at: None,
            prep_time_seconds: 0,
            kitchen_zone: Some("grill".into()),
            notes: String::new(),
            table_number: None,
            priority: false,
        },
    );
    assert_eq!(order.status, "pending");

    let acked = crate::commands::kds_device::ack_kds_order_scoped(
        "tok".into(),
        order.id.clone(),
        device.id.clone(),
        app.state(),
    )
    .await
    .unwrap();
    assert!(acked, "first ack should succeed");

    // Step 6: Double-ack should fail.
    let acked2 = crate::commands::kds_device::ack_kds_order_scoped(
        "tok".into(),
        order.id.clone(),
        "other-device".into(),
        app.state(),
    )
    .await
    .unwrap();
    assert!(!acked2, "second ack should return false");

    // Step 7: Device goes stale — backdate last_seen_at.
    {
        let state_ref = app.state::<AppState>();
        let db_ref = state_ref.db_manager.open_store("s1").unwrap();
        let db = db_ref.lock().unwrap();
        db.execute(
            "UPDATE kds_devices SET last_seen_at = '2020-01-01T00:00:00.000Z', connection_status = 'connected' WHERE id = ?1",
            rusqlite::params![device.id],
        )
        .unwrap();
    }
    // Run stale detection via the Store directly (simulates health daemon).
    {
        let state_ref = app.state::<AppState>();
        let db_ref = state_ref.db_manager.open_store("s1").unwrap();
        let db = db_ref.lock().unwrap();
        let store = Store::new(&db);
        let marked = store.mark_stale_kds_devices(30).unwrap();
        assert_eq!(marked, 1, "should mark 1 device stale");
    }
    let fetched = crate::commands::kds_device::get_kds_device_scoped(
        "tok".into(),
        device.id.clone(),
        app.state(),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(
        fetched.connection_status,
        oz_core::kds::KdsConnectionStatus::Stale
    );

    // Step 8: Deactivate the device.
    crate::commands::kds_device::deactivate_kds_device_scoped(
        "tok".into(),
        device.id.clone(),
        app.state(),
    )
    .await
    .unwrap();
    let fetched = crate::commands::kds_device::get_kds_device_scoped(
        "tok".into(),
        device.id.clone(),
        app.state(),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(!fetched.is_active, "device should be deactivated");
}

// ══════════════════════════════════════════════════════════════════
// Integration: Broadcast mode — empty station_ids gets all orders
// ══════════════════════════════════════════════════════════════════

/// A device with empty station_ids (broadcast mode) receives all orders
/// regardless of kitchen zone.
#[tokio::test]
async fn integration_broadcast_device_receives_all_orders() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let state = scoped_state_with_restaurant(
        conn,
        "tok",
        "user-owner",
        "role-owner",
        "s1",
        "resto-1",
        Some("resto-1".into()),
    );
    seed_terminal_in_store(&state, "s1", "resto-1", "Restaurant POS", "dev-resto");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    // Register a broadcast device (empty station_ids).
    let broadcast_device = crate::commands::kds_device::register_kds_device_scoped(
        "tok".into(),
        RegisterKdsDeviceInput {
            name: "Expo Screen".into(),
            restaurant_pos_id: "resto-1".into(),
            station_ids: vec![], // broadcast
            pairing_token_hash: "h-expo".into(),
            pairing_expires_at: "2099-01-01".into(),
        },
        app.state(),
    )
    .await
    .unwrap();

    // Create a KDS order.
    let order = create_kds_order_in_store(
        &app.state::<AppState>(),
        &KdsOrder {
            id: "order-any".into(),
            sale_id: "sale-any".into(),
            store_id: Some("s1".into()),
            target_instance_id: None,
            status: "pending".into(),
            items_summary: "Mixed items".into(),
            item_count: 3,
            display_number: None,
            received_at: "2026-08-21T10:00:00.000Z".into(),
            started_at: None,
            ready_at: None,
            served_at: None,
            prep_time_seconds: 0,
            kitchen_zone: Some("grill".into()),
            notes: String::new(),
            table_number: None,
            priority: false,
        },
    );

    // Broadcast device should receive it.
    let targets = crate::commands::kds_routing::resolve_kds_targets_scoped(
        "tok".into(),
        order.id.clone(),
        app.state(),
    )
    .await
    .unwrap();
    assert_eq!(
        targets.len(),
        1,
        "broadcast device should receive the order"
    );
    assert_eq!(targets[0], broadcast_device.id);
}

// ══════════════════════════════════════════════════════════════════
// Integration: Inactive device excluded from routing
// ══════════════════════════════════════════════════════════════════

/// Deactivated devices must not receive routed orders.
#[tokio::test]
async fn integration_inactive_device_excluded_from_routing() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let state = scoped_state_with_restaurant(
        conn,
        "tok",
        "user-owner",
        "role-owner",
        "s1",
        "resto-1",
        Some("resto-1".into()),
    );
    seed_terminal_in_store(&state, "s1", "resto-1", "Restaurant POS", "dev-resto");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    // Register a device then deactivate it.
    let device = crate::commands::kds_device::register_kds_device_scoped(
        "tok".into(),
        RegisterKdsDeviceInput {
            name: "Old Display".into(),
            restaurant_pos_id: "resto-1".into(),
            station_ids: vec![],
            pairing_token_hash: "h-old".into(),
            pairing_expires_at: "2099-01-01".into(),
        },
        app.state(),
    )
    .await
    .unwrap();

    crate::commands::kds_device::deactivate_kds_device_scoped(
        "tok".into(),
        device.id.clone(),
        app.state(),
    )
    .await
    .unwrap();

    // Create a KDS order.
    let order = create_kds_order_in_store(
        &app.state::<AppState>(),
        &KdsOrder {
            id: "order-inactive".into(),
            sale_id: "sale-inactive".into(),
            store_id: Some("s1".into()),
            target_instance_id: None,
            status: "pending".into(),
            items_summary: "Fries".into(),
            item_count: 1,
            display_number: None,
            received_at: "2026-08-21T10:00:00.000Z".into(),
            started_at: None,
            ready_at: None,
            served_at: None,
            prep_time_seconds: 0,
            kitchen_zone: None,
            notes: String::new(),
            table_number: None,
            priority: false,
        },
    );

    // Deactivated device should NOT receive the order.
    let targets = crate::commands::kds_routing::resolve_kds_targets_scoped(
        "tok".into(),
        order.id.clone(),
        app.state(),
    )
    .await
    .unwrap();
    assert!(
        targets.is_empty(),
        "deactivated device should not receive orders"
    );
}

// ══════════════════════════════════════════════════════════════════
// Integration: Duplicate name rejected per restaurant POS
// ══════════════════════════════════════════════════════════════════

#[tokio::test]
async fn integration_duplicate_device_name_rejected() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let state = scoped_state_with_restaurant(
        conn,
        "tok",
        "user-owner",
        "role-owner",
        "s1",
        "resto-1",
        Some("resto-1".into()),
    );
    seed_terminal_in_store(&state, "s1", "resto-1", "Restaurant POS", "dev-resto");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let input = RegisterKdsDeviceInput {
        name: "Grill Display".into(),
        restaurant_pos_id: "resto-1".into(),
        station_ids: vec![],
        pairing_token_hash: "h1".into(),
        pairing_expires_at: "2099-01-01".into(),
    };

    // First registration succeeds.
    let result1 = crate::commands::kds_device::register_kds_device_scoped(
        "tok".into(),
        input.clone(),
        app.state(),
    )
    .await;
    assert!(result1.is_ok(), "first registration should succeed");

    // Second registration with same name fails.
    let result2 =
        crate::commands::kds_device::register_kds_device_scoped("tok".into(), input, app.state())
            .await;
    assert!(result2.is_err(), "duplicate name should be rejected");
}

// ══════════════════════════════════════════════════════════════════
// Integration: Order already acked by another device
// ══════════════════════════════════════════════════════════════════

/// When two devices try to ack the same order, only the first wins.
#[tokio::test]
async fn integration_concurrent_ack_only_first_wins() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let state = scoped_state_with_restaurant(
        conn,
        "tok",
        "user-owner",
        "role-owner",
        "s1",
        "resto-1",
        Some("resto-1".into()),
    );
    seed_terminal_in_store(&state, "s1", "resto-1", "Restaurant POS", "dev-resto");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    // Register two devices.
    let device_a = crate::commands::kds_device::register_kds_device_scoped(
        "tok".into(),
        RegisterKdsDeviceInput {
            name: "Device A".into(),
            restaurant_pos_id: "resto-1".into(),
            station_ids: vec![],
            pairing_token_hash: "ha".into(),
            pairing_expires_at: "2099-01-01".into(),
        },
        app.state(),
    )
    .await
    .unwrap();

    let device_b = crate::commands::kds_device::register_kds_device_scoped(
        "tok".into(),
        RegisterKdsDeviceInput {
            name: "Device B".into(),
            restaurant_pos_id: "resto-1".into(),
            station_ids: vec![],
            pairing_token_hash: "hb".into(),
            pairing_expires_at: "2099-01-01".into(),
        },
        app.state(),
    )
    .await
    .unwrap();

    // Create a KDS order.
    let order = create_kds_order_in_store(
        &app.state::<AppState>(),
        &KdsOrder {
            id: "order-race".into(),
            sale_id: "sale-race".into(),
            store_id: Some("s1".into()),
            target_instance_id: None,
            status: "pending".into(),
            items_summary: "Pizza".into(),
            item_count: 1,
            display_number: None,
            received_at: "2026-08-21T10:00:00.000Z".into(),
            started_at: None,
            ready_at: None,
            served_at: None,
            prep_time_seconds: 0,
            kitchen_zone: None,
            notes: String::new(),
            table_number: None,
            priority: false,
        },
    );

    // Device A acks first — should succeed.
    let ack_a = crate::commands::kds_device::ack_kds_order_scoped(
        "tok".into(),
        order.id.clone(),
        device_a.id.clone(),
        app.state(),
    )
    .await
    .unwrap();
    assert!(ack_a, "device A should win the ack race");

    // Device B acks second — should fail.
    let ack_b = crate::commands::kds_device::ack_kds_order_scoped(
        "tok".into(),
        order.id.clone(),
        device_b.id.clone(),
        app.state(),
    )
    .await
    .unwrap();
    assert!(!ack_b, "device B should lose the ack race");
}

// ══════════════════════════════════════════════════════════════════
// Integration: Health monitoring daemon simulation
// ══════════════════════════════════════════════════════════════════

/// Simulates the health monitoring daemon cycle:
/// mark stale → deactivate long-offline → cleanup old orders.
#[tokio::test]
async fn integration_health_monitoring_cycle() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let state = scoped_state_with_restaurant(
        conn,
        "tok",
        "user-owner",
        "role-owner",
        "s1",
        "resto-1",
        Some("resto-1".into()),
    );
    seed_terminal_in_store(&state, "s1", "resto-1", "Restaurant POS", "dev-resto");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    // Register two devices.
    let device_good = crate::commands::kds_device::register_kds_device_scoped(
        "tok".into(),
        RegisterKdsDeviceInput {
            name: "Good Display".into(),
            restaurant_pos_id: "resto-1".into(),
            station_ids: vec![],
            pairing_token_hash: "hg".into(),
            pairing_expires_at: "2099-01-01".into(),
        },
        app.state(),
    )
    .await
    .unwrap();

    let device_stale = crate::commands::kds_device::register_kds_device_scoped(
        "tok".into(),
        RegisterKdsDeviceInput {
            name: "Stale Display".into(),
            restaurant_pos_id: "resto-1".into(),
            station_ids: vec![],
            pairing_token_hash: "hs".into(),
            pairing_expires_at: "2099-01-01".into(),
        },
        app.state(),
    )
    .await
    .unwrap();

    // Connect both, then backdate stale device's last_seen_at.
    crate::commands::kds_device::update_kds_device_status_scoped(
        "tok".into(),
        device_good.id.clone(),
        oz_core::kds::KdsConnectionStatus::Connected,
        app.state(),
    )
    .await
    .unwrap();
    crate::commands::kds_device::update_kds_device_status_scoped(
        "tok".into(),
        device_stale.id.clone(),
        oz_core::kds::KdsConnectionStatus::Connected,
        app.state(),
    )
    .await
    .unwrap();

    // Backdate stale device's last_seen_at to simulate disconnection.
    {
        let state_ref = app.state::<AppState>();
        let db_ref = state_ref.db_manager.open_store("s1").unwrap();
        let db = db_ref.lock().unwrap();
        db.execute(
            "UPDATE kds_devices SET last_seen_at = '2020-01-01T00:00:00.000Z' WHERE id = ?1",
            rusqlite::params![device_stale.id],
        )
        .unwrap();
    }

    // Run health daemon cycle via Store directly.
    {
        let state_ref = app.state::<AppState>();
        let db_ref = state_ref.db_manager.open_store("s1").unwrap();
        let db = db_ref.lock().unwrap();
        let store = Store::new(&db);

        // 1. Mark stale (30s threshold).
        let marked = store.mark_stale_kds_devices(30).unwrap();
        assert_eq!(marked, 1, "should mark 1 device stale");

        // 2. Good device should still be connected.
        let good = store.get_kds_device(&device_good.id).unwrap().unwrap();
        assert_eq!(
            good.connection_status,
            oz_core::kds::KdsConnectionStatus::Connected
        );

        // 3. Stale device should be marked stale.
        let stale = store.get_kds_device(&device_stale.id).unwrap().unwrap();
        assert_eq!(
            stale.connection_status,
            oz_core::kds::KdsConnectionStatus::Stale
        );

        // 4. Backdate stale device's updated_at to trigger auto-deactivation.
        db.execute(
            "UPDATE kds_devices SET updated_at = '2020-01-01T00:00:00.000Z' WHERE id = ?1",
            rusqlite::params![device_stale.id],
        )
        .unwrap();

        let deactivated = store.deactivate_stale_kds_devices(3600).unwrap();
        assert_eq!(deactivated, 1, "should auto-deactivate 1 stale device");

        // 5. Stale device should now be inactive.
        let stale = store.get_kds_device(&device_stale.id).unwrap().unwrap();
        assert!(!stale.is_active, "stale device should be deactivated");

        // 6. Good device should still be active.
        let good = store.get_kds_device(&device_good.id).unwrap().unwrap();
        assert!(good.is_active, "good device should remain active");
    }
}

// ══════════════════════════════════════════════════════════════════
// Integration: Device isolation between restaurants
// ══════════════════════════════════════════════════════════════════

/// Devices registered to different Restaurant POS instances are isolated.
#[tokio::test]
async fn integration_device_isolation_between_restaurants() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let state = scoped_state_with_restaurant(
        conn,
        "tok",
        "user-owner",
        "role-owner",
        "s1",
        "resto-1",
        Some("resto-1".into()),
    );
    seed_terminal_in_store(&state, "s1", "resto-1", "Restaurant A", "dev-a");
    seed_terminal_in_store(&state, "s1", "resto-2", "Restaurant B", "dev-b");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    // Register device under resto-1.
    let device_a = crate::commands::kds_device::register_kds_device_scoped(
        "tok".into(),
        RegisterKdsDeviceInput {
            name: "Display A".into(),
            restaurant_pos_id: "resto-1".into(),
            station_ids: vec![],
            pairing_token_hash: "ha".into(),
            pairing_expires_at: "2099-01-01".into(),
        },
        app.state(),
    )
    .await
    .unwrap();

    // Register device under resto-2 (via Store directly since session is for resto-1).
    {
        let state_ref = app.state::<AppState>();
        let db_ref = state_ref.db_manager.open_store("s1").unwrap();
        let db = db_ref.lock().unwrap();
        let store = Store::new(&db);
        store
            .register_kds_device(RegisterKdsDeviceInput {
                name: "Display B".into(),
                restaurant_pos_id: "resto-2".into(),
                station_ids: vec![],
                pairing_token_hash: "hb".into(),
                pairing_expires_at: "2099-01-01".into(),
            })
            .expect("register device B should succeed");
    }

    // list_kds_devices_scoped only returns devices for the session's restaurant.
    let devices = crate::commands::kds_device::list_kds_devices_scoped("tok".into(), app.state())
        .await
        .unwrap();
    assert_eq!(devices.len(), 1, "should only see resto-1 devices");
    assert_eq!(devices[0].id, device_a.id);
    assert_eq!(devices[0].restaurant_pos_id, "resto-1");
}

// ── Gap pins: line-item + items-edit + ticket-creation commands ────
//
// The scoped commands below route through session → store → instance
// scoping and KDS permissions, yet had zero command-layer coverage
// (grep evidence: no test referenced them). The oz-core layer beneath
// is pinned in crates/oz-core; these pin the wiring.

/// Seeds a restaurant product (BURGER) into the store DB so the fanout
/// creates a ticket.
fn seed_restaurant_product(state: &AppState) {
    let store_db = state.db_manager.open_store("s1").unwrap();
    let db = store_db.lock().unwrap();
    let s = Store::new(&db);
    s.create_product(
        "BURGER",
        "Burger",
        Money {
            minor_units: 500,
            currency: "USD".parse().unwrap(),
        },
        None,
        None,
        10,
        Some("restaurant"),
    )
    .unwrap();
}

/// Seeds a pending sale with one BURGER line into the store DB. The
/// existing `create_sale_in_store` helper creates a zero-line sale, which
/// the fanout correctly ignores (nothing to cook).
fn create_restaurant_sale_in_store(state: &AppState, sale_id: &str) {
    let store_db = state.db_manager.open_store("s1").unwrap();
    let db = store_db.lock().unwrap();
    let s = Store::new(&db);
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let usd: Currency = "USD".parse().unwrap();
    let unit = Money {
        minor_units: 500,
        currency: usd.clone(),
    };
    let line_id = uuid::Uuid::now_v7().to_string();
    let sale = Sale {
        id: sale_id.into(),
        status: SaleStatus::Pending,
        total: unit.clone(),
        line_count: 1,
        currency: usd.clone(),
        payment_method: None,
        tendered_minor: None,
        user_id: Some("user-owner".into()),
        created_at: now.clone(),
        updated_at: now.clone(),
        lines: vec![oz_core::SaleLine {
            id: line_id.clone(),
            sale_id: sale_id.into(),
            sku: "BURGER".into(),
            qty: 1,
            unit_price: unit.clone(),
            line_total: unit.clone(),
            line_position: 1,
            tax_amount: Money {
                minor_units: 0,
                currency: usd.clone(),
            },
            tax_rate_id: None,
            tax_breakdown_json: None,
            serial_number: None,
            course: None,
            modifiers_json: None,
        }],
        discount_percent: 0,
        discount_label: None,
        subtotal: unit.clone(),
        tax_total: Money {
            minor_units: 0,
            currency: usd,
        },
        customer_id: None,
        base_currency: None,
        base_total_minor: None,
        tender_rate_millionths: None,
        tip_minor: 0,
        service_charge_minor: 0,
        version: 1,
    };
    s.create_sale(&sale).unwrap();
}

fn mock_app(state: AppState) -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap()
}

#[tokio::test]
async fn scoped_line_item_status_update_and_read_end_to_end() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let state = scoped_state(conn, "tok", "user-owner", "role-owner", "s1", "kds-main");
    seed_restaurant_product(&state);
    create_restaurant_sale_in_store(&state, "sale-lines-1");
    let app = mock_app(state);

    let orders =
        create_kds_order_from_sale_scoped("tok".into(), "sale-lines-1".into(), app.state())
            .await
            .unwrap();
    assert_eq!(
        orders.len(),
        1,
        "restaurant product must fan out one unzoned ticket"
    );
    assert_eq!(orders[0].store_id.as_deref(), Some("s1"));

    let lines = get_kds_order_lines_scoped("tok".into(), orders[0].id.clone(), app.state())
        .await
        .unwrap();
    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0].item_status, "pending");

    let updated = update_kds_line_item_status_scoped(
        "tok".into(),
        lines[0].id.clone(),
        "preparing".into(),
        app.state(),
    )
    .await
    .unwrap();
    assert_eq!(updated.item_status, "preparing");
    assert!(updated.started_at.is_some(), "started_at stamped");
}

#[tokio::test]
async fn scoped_update_kds_order_items_edits_ticket() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let state = scoped_state(conn, "tok", "user-owner", "role-owner", "s1", "kds-main");
    seed_restaurant_product(&state);
    create_restaurant_sale_in_store(&state, "sale-items-1");
    let app = mock_app(state);

    let orders =
        create_kds_order_from_sale_scoped("tok".into(), "sale-items-1".into(), app.state())
            .await
            .unwrap();

    let edited = update_kds_order_items_scoped(
        "tok".into(),
        oz_core::UpdateKdsOrderItemsInput {
            id: orders[0].id.clone(),
            items_summary: "Burger, Fries".into(),
            item_count: 2,
            line_items: Some(vec![
                oz_core::CreateKdsLineItemInput {
                    sku: "BURGER".into(),
                    display_name: "Burger".into(),
                    qty: 1,
                    course: Some("main".into()),
                    modifiers: vec![],
                },
                oz_core::CreateKdsLineItemInput {
                    sku: "FRIES".into(),
                    display_name: "Fries".into(),
                    qty: 1,
                    course: Some("side".into()),
                    modifiers: vec![],
                },
            ]),
        },
        app.state(),
    )
    .await
    .unwrap();
    assert_eq!(edited.items_summary, "Burger, Fries");
    assert_eq!(edited.item_count, 2);

    let lines = get_kds_order_lines_scoped("tok".into(), orders[0].id.clone(), app.state())
        .await
        .unwrap();
    assert_eq!(
        lines.len(),
        2,
        "replacement items replace the original single line"
    );
    assert!(
        lines.iter().all(|l| l.item_status == "pending"),
        "fresh items start pending"
    );
}

#[tokio::test]
async fn scoped_line_item_update_rejects_invalid_token() {
    let conn = oz_core::migrations::fresh_db();
    let state = scoped_state(conn, "tok", "user-owner", "role-owner", "s1", "kds-main");
    let app = mock_app(state);

    let result = update_kds_line_item_status_scoped(
        "bad-token".into(),
        "item-1".into(),
        "preparing".into(),
        app.state(),
    )
    .await;
    assert!(matches!(result, Err(AppError::InvalidSession)));
}

#[tokio::test]
async fn scoped_get_order_lines_rejects_invalid_token() {
    let conn = oz_core::migrations::fresh_db();
    let state = scoped_state(conn, "tok", "user-owner", "role-owner", "s1", "kds-main");
    let app = mock_app(state);

    let result =
        get_kds_order_lines_scoped("bad-token".into(), "order-1".into(), app.state()).await;
    assert!(matches!(result, Err(AppError::InvalidSession)));
}

#[tokio::test]
async fn scoped_update_order_items_rejects_invalid_token() {
    let conn = oz_core::migrations::fresh_db();
    let state = scoped_state(conn, "tok", "user-owner", "role-owner", "s1", "kds-main");
    let app = mock_app(state);

    let result = update_kds_order_items_scoped(
        "bad-token".into(),
        oz_core::UpdateKdsOrderItemsInput {
            id: "order-1".into(),
            items_summary: String::new(),
            item_count: 0,
            line_items: None,
        },
        app.state(),
    )
    .await;
    assert!(matches!(result, Err(AppError::InvalidSession)));
}

#[tokio::test]
async fn scoped_create_tickets_rejects_invalid_token() {
    let conn = oz_core::migrations::fresh_db();
    let state = scoped_state(conn, "tok", "user-owner", "role-owner", "s1", "kds-main");
    let app = mock_app(state);

    let result =
        create_kds_order_from_sale_scoped("bad-token".into(), "sale-1".into(), app.state()).await;
    assert!(matches!(result, Err(AppError::InvalidSession)));
}
