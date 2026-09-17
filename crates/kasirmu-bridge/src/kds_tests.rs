use super::*;
use crate::testing::TestBridge;
use kasirmu_core::RegisterKdsDeviceInput;
use kasirmu_core::session::SessionContext;
use kasirmu_core::{CreateKdsOrderInput, Currency, Money, Sale, SaleStatus};

// ── Existing tests (preserved) ────────────────────────────────────

#[test]
fn empty_runtime_kds_targets_disable_ticket_creation() {
    let conn = kasirmu_core::migrations::fresh_db();
    let key = format!("{TOPOLOGY_RUNTIME_SETTING_KEY}/store-1");
    kasirmu_core::Settings::set(&conn, &key, r#"{"routes":[]}"#).unwrap();

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
        ticket_prefix: String::new(),
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
    let registry = kasirmu_hal::DriverRegistry::default();
    let grill = Arc::new(kasirmu_hal::drivers::mock::MockReceiptPrinter::new());
    let pass = Arc::new(kasirmu_hal::drivers::mock::MockReceiptPrinter::new());
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
) -> TestBridge {
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
) -> TestBridge {
    // The desktop swapped in a temp-dir-backed StoreDatabaseManager; TestBridge
    // already owns a per-store manager over a unique temp directory, so the
    // swap is unnecessary here.
    let app = TestBridge::new().with_conn(conn);
    app.sessions().write().unwrap().insert(
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
    app
}

/// Seed a terminal into the store DB (via db_manager) so FK constraints
/// on kds_devices.restaurant_pos_id are satisfied.
fn seed_terminal_in_store(app: &TestBridge, store_id: &str, id: &str, name: &str, device_id: &str) {
    let store_db = app.db_manager().open_store(store_id).unwrap();
    let db = store_db.lock().unwrap();
    db.execute(
        "INSERT OR IGNORE INTO terminals (id, name, device_id, is_active, created_at, updated_at)
         VALUES (?1, ?2, ?3, 1, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        rusqlite::params![id, name, device_id],
    )
    .unwrap();
}

fn create_sale_in_store(app: &TestBridge, sale_id: &str) {
    let store_db = app.db_manager().open_store("s1").unwrap();
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

fn create_kds_order_in_store(app: &TestBridge, order: &KdsOrder) -> KdsOrder {
    // First create the FK sale in the same store-DB.
    create_sale_in_store(app, &order.sale_id);
    let store_db = app.db_manager().open_store("s1").unwrap();
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
    let conn = kasirmu_core::migrations::fresh_db();
    let app = scoped_state(conn, "tok", "user-owner", "role-owner", "s1", "kds-main");

    let result = list_kds_orders_scoped(&app.ctx(), "bad-token", None).await;
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

#[tokio::test]
async fn scoped_get_kds_queue_rejects_invalid_token() {
    let conn = kasirmu_core::migrations::fresh_db();
    let app = scoped_state(conn, "tok", "user-owner", "role-owner", "s1", "kds-main");

    let result = get_kds_queue_scoped(&app.ctx(), "bad-token", None).await;
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

#[tokio::test]
async fn scoped_get_kds_order_rejects_invalid_token() {
    let conn = kasirmu_core::migrations::fresh_db();
    let app = scoped_state(conn, "tok", "user-owner", "role-owner", "s1", "kds-main");

    let result = get_kds_order_scoped(&app.ctx(), "bad-token", "order-1").await;
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

// ── CRUD operations ───────────────────────────────────────────────

#[tokio::test]
async fn owner_can_list_kds_orders_empty() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    let app = scoped_state(conn, "tok", "user-owner", "role-owner", "s1", "kds-main");

    let orders = list_kds_orders_scoped(&app.ctx(), "tok", None)
        .await
        .unwrap();
    assert!(orders.is_empty());
}

#[tokio::test]
async fn owner_can_list_kds_orders_with_data() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    let app = scoped_state(conn, "tok", "user-owner", "role-owner", "s1", "kds-main");

    let order = test_kds_order("o1");
    let created = create_kds_order_in_store(&app, &order);

    let orders = list_kds_orders_scoped(&app.ctx(), "tok", None)
        .await
        .unwrap();
    assert_eq!(orders.len(), 1);
    assert_eq!(orders[0].id, created.id);
}

#[tokio::test]
async fn list_kds_orders_filters_by_status() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    let app = scoped_state(conn, "tok", "user-owner", "role-owner", "s1", "kds-main");

    // Create two orders (both start as "pending" per DB default).
    let order1 = create_kds_order_in_store(&app, &test_kds_order("o1"));
    let order2 = create_kds_order_in_store(&app, &test_kds_order("o2"));

    // Move order2 through the valid forward-only chain: pending -> preparing -> ready.
    update_kds_status_scoped(&app.ctx(), "tok", &order2.id, "preparing")
        .await
        .unwrap();
    update_kds_status_scoped(&app.ctx(), "tok", &order2.id, "ready")
        .await
        .unwrap();

    // Now filter by status.
    let pending_orders = list_kds_orders_scoped(&app.ctx(), "tok", Some("pending".into()))
        .await
        .unwrap();
    assert_eq!(pending_orders.len(), 1);
    assert_eq!(pending_orders[0].id, order1.id);

    let ready_orders = list_kds_orders_scoped(&app.ctx(), "tok", Some("ready".into()))
        .await
        .unwrap();
    assert_eq!(ready_orders.len(), 1);
    assert_eq!(ready_orders[0].id, order2.id);
}

#[tokio::test]
async fn owner_can_get_kds_order_by_id() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    let app = scoped_state(conn, "tok", "user-owner", "role-owner", "s1", "kds-main");

    let order = test_kds_order("o1");
    let created = create_kds_order_in_store(&app, &order);

    let fetched = get_kds_order_scoped(&app.ctx(), "tok", &created.id).await;
    assert!(fetched.is_ok());
    assert!(fetched.unwrap().is_some());
}

#[tokio::test]
async fn get_kds_order_returns_none_for_unknown() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    let app = scoped_state(conn, "tok", "user-owner", "role-owner", "s1", "kds-main");

    let result = get_kds_order_scoped(&app.ctx(), "tok", "nonexistent")
        .await
        .unwrap();
    assert!(result.is_none());
}

#[tokio::test]
async fn owner_can_get_kds_queue() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    let app = scoped_state(conn, "tok", "user-owner", "role-owner", "s1", "kds-main");

    let order = test_kds_order("o1");
    let created = create_kds_order_in_store(&app, &order);

    let queue = get_kds_queue_scoped(&app.ctx(), "tok", None).await.unwrap();
    assert_eq!(queue.len(), 1);
    assert_eq!(queue[0].id, created.id);
}

#[tokio::test]
async fn update_kds_status_returns_error_for_unknown_order() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    let app = scoped_state(conn, "tok", "user-owner", "role-owner", "s1", "kds-main");

    let result = update_kds_status_scoped(&app.ctx(), "tok", "nonexistent", "ready").await;
    assert!(result.is_err());
}

// ── Instance isolation ────────────────────────────────────────────

#[tokio::test]
async fn kds_orders_scoped_to_instance() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    let app = scoped_state(conn, "tok", "user-owner", "role-owner", "s1", "kds-main");

    // Order for kds-main — should be visible.
    let mut order_main = test_kds_order("o1");
    order_main.target_instance_id = Some("kds-main".into());
    let created_main = create_kds_order_in_store(&app, &order_main);

    // Order for kds-expediter — should NOT be visible.
    let mut order_exp = test_kds_order("o2");
    order_exp.target_instance_id = Some("kds-expediter".into());
    create_kds_order_in_store(&app, &order_exp);

    let orders = list_kds_orders_scoped(&app.ctx(), "tok", None)
        .await
        .unwrap();
    assert_eq!(orders.len(), 1, "only kds-main orders should be visible");
    assert_eq!(orders[0].id, created_main.id);
}

// ── Staff permission tests ────────────────────────────────────────

#[tokio::test]
async fn staff_can_list_kds_orders() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-staff', 'staff', 'hash', 'Staff', 'role-staff', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();
    let app = scoped_state(conn, "tok", "user-staff", "role-staff", "s1", "kds-main");

    let result = list_kds_orders_scoped(&app.ctx(), "tok", None).await;
    assert!(result.is_ok(), "staff has KDS_VIEW permission");
    assert!(result.unwrap().is_empty());
}

#[tokio::test]
async fn staff_can_update_kds_status() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-staff', 'staff', 'hash', 'Staff', 'role-staff', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();
    let app = scoped_state(conn, "tok", "user-staff", "role-staff", "s1", "kds-main");

    let order = test_kds_order("o1");
    let created = create_kds_order_in_store(&app, &order);

    let result = update_kds_status_scoped(&app.ctx(), "tok", &created.id, "preparing").await;
    assert!(result.is_ok(), "staff has KDS_UPDATE permission");
}

// ── Tests for kds_device.rs scoped commands ─────────────────────

#[tokio::test]
async fn register_kds_device_scoped_rejects_invalid_token() {
    let conn = kasirmu_core::migrations::fresh_db();
    let app = scoped_state(conn, "tok", "u1", "r1", "s1", "kds-main");

    let result = crate::kds_device::register_kds_device(
        &app.ctx(),
        "bad-token",
        RegisterKdsDeviceInput {
            name: "Test KDS".into(),
            restaurant_pos_id: "resto-1".into(),
            station_ids: vec![],
            pairing_token_hash: "hash-test".into(),
            pairing_expires_at: "2099-01-01T00:00:00.000Z".into(),
        },
    )
    .await;
    assert!(result.is_err(), "invalid token should be rejected");
}

#[tokio::test]
async fn register_and_list_kds_devices_scoped() {
    let conn = kasirmu_core::migrations::fresh_db();
    // Seed owner.
    seed_owner(&conn);
    let app = scoped_state_with_restaurant(
        conn,
        "tok",
        "user-owner",
        "role-owner",
        "s1",
        "resto-1",
        Some("resto-1".into()),
    );
    // Seed terminal in the store DB (where kds_devices lives).
    seed_terminal_in_store(&app, "s1", "resto-1", "Restaurant POS", "dev-resto");

    // Register a device.
    let reg_result = crate::kds_device::register_kds_device(
        &app.ctx(),
        "tok",
        RegisterKdsDeviceInput {
            name: "Kitchen Screen".into(),
            restaurant_pos_id: "resto-1".into(),
            station_ids: vec!["grill".into(), "bar".into()],
            pairing_token_hash: "hash-test".into(),
            pairing_expires_at: "2099-01-01T00:00:00.000Z".into(),
        },
    )
    .await;
    assert!(
        reg_result.is_ok(),
        "register should succeed: {:?}",
        reg_result.err()
    );

    // List devices.
    let list_result = crate::kds_device::list_kds_devices(&app.ctx(), "tok").await;
    assert!(list_result.is_ok(), "list should succeed");
    let devices = list_result.unwrap();
    assert_eq!(devices.len(), 1, "should have 1 device");
    assert_eq!(devices[0].name, "Kitchen Screen");
}

#[tokio::test]
async fn ack_kds_order_scoped_rejects_invalid_token() {
    let conn = kasirmu_core::migrations::fresh_db();
    let app = scoped_state(conn, "tok", "u1", "r1", "s1", "kds-main");

    let result =
        crate::kds_device::ack_kds_order(&app.ctx(), "bad-token", "some-order-id", "kds-device-1")
            .await;
    assert!(result.is_err(), "invalid token should be rejected");
}

// ── Tests for kds_routing.rs scoped command ─────────────────────

#[tokio::test]
async fn resolve_kds_targets_scoped_rejects_invalid_token() {
    let conn = kasirmu_core::migrations::fresh_db();
    let app = scoped_state(conn, "tok", "u1", "r1", "s1", "kds-main");

    let result = crate::kds_routing::resolve_kds_targets(&app.ctx(), "bad-token", "sale-123").await;
    assert!(result.is_err(), "invalid token should be rejected");
}

// ══════════════════════════════════════════════════════════════════
// Integration: Full KDS enrollment flow
// ══════════════════════════════════════════════════════════════════

/// End-to-end enrollment flow through Tauri commands:
/// register device → list devices → update status → ack order → stale detection.
#[tokio::test]
async fn integration_enrollment_full_lifecycle() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    let app = scoped_state_with_restaurant(
        conn,
        "tok",
        "user-owner",
        "role-owner",
        "s1",
        "resto-1",
        Some("resto-1".into()),
    );
    seed_terminal_in_store(&app, "s1", "resto-1", "Restaurant POS", "dev-resto");

    // Step 1: Register a KDS device.
    let device = crate::kds_device::register_kds_device(
        &app.ctx(),
        "tok",
        RegisterKdsDeviceInput {
            name: "Grill Display".into(),
            restaurant_pos_id: "resto-1".into(),
            station_ids: vec!["grill".into(), "fryer".into()],
            pairing_token_hash: "hash-grill".into(),
            pairing_expires_at: "2099-01-01T00:00:00Z".into(),
        },
    )
    .await
    .unwrap();
    assert!(!device.id.is_empty());
    assert_eq!(device.name, "Grill Display");
    assert_eq!(device.station_ids, vec!["grill", "fryer"]);
    assert!(device.is_active);
    assert_eq!(
        device.connection_status,
        kasirmu_core::kds::KdsConnectionStatus::Disconnected
    );

    // Step 2: List devices — should show the registered device.
    let devices = crate::kds_device::list_kds_devices(&app.ctx(), "tok")
        .await
        .unwrap();
    assert_eq!(devices.len(), 1);
    assert_eq!(devices[0].id, device.id);

    // Step 3: Get single device.
    let fetched = crate::kds_device::get_kds_device(&app.ctx(), "tok", &device.id)
        .await
        .unwrap();
    assert!(fetched.is_some());
    assert_eq!(fetched.unwrap().id, device.id);

    // Step 4: Device connects — update status to connected.
    crate::kds_device::update_kds_device_status(
        &app.ctx(),
        "tok",
        &device.id,
        kasirmu_core::kds::KdsConnectionStatus::Connected,
    )
    .await
    .unwrap();
    let fetched = crate::kds_device::get_kds_device(&app.ctx(), "tok", &device.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        fetched.connection_status,
        kasirmu_core::kds::KdsConnectionStatus::Connected
    );
    assert!(fetched.last_seen_at.is_some());

    // Step 5: Create a sale + KDS order, then ack it.
    let order = create_kds_order_in_store(
        &app,
        &KdsOrder {
            id: "order-1".into(),
            sale_id: "sale-1".into(),
            store_id: Some("s1".into()),
            target_instance_id: None,
            status: "pending".into(),
            items_summary: "Burger x2".into(),
            item_count: 2,
            display_number: None,
            ticket_prefix: String::new(),
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

    let acked = crate::kds_device::ack_kds_order(&app.ctx(), "tok", &order.id, &device.id)
        .await
        .unwrap();
    assert!(acked, "first ack should succeed");

    // Step 6: Double-ack should fail.
    let acked2 = crate::kds_device::ack_kds_order(&app.ctx(), "tok", &order.id, "other-device")
        .await
        .unwrap();
    assert!(!acked2, "second ack should return false");

    // Step 7: Device goes stale — backdate last_seen_at.
    {
        let state_ref = &app;
        let db_ref = state_ref.db_manager().open_store("s1").unwrap();
        let db = db_ref.lock().unwrap();
        db.execute(
            "UPDATE kds_devices SET last_seen_at = '2020-01-01T00:00:00.000Z', connection_status = 'connected' WHERE id = ?1",
            rusqlite::params![device.id],
        )
        .unwrap();
    }
    // Run stale detection via the Store directly (simulates health daemon).
    {
        let state_ref = &app;
        let db_ref = state_ref.db_manager().open_store("s1").unwrap();
        let db = db_ref.lock().unwrap();
        let store = Store::new(&db);
        let marked = store.mark_stale_kds_devices(30).unwrap();
        assert_eq!(marked, 1, "should mark 1 device stale");
    }
    let fetched = crate::kds_device::get_kds_device(&app.ctx(), "tok", &device.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        fetched.connection_status,
        kasirmu_core::kds::KdsConnectionStatus::Stale
    );

    // Step 8: Deactivate the device.
    crate::kds_device::deactivate_kds_device(&app.ctx(), "tok", &device.id)
        .await
        .unwrap();
    let fetched = crate::kds_device::get_kds_device(&app.ctx(), "tok", &device.id)
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
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    let app = scoped_state_with_restaurant(
        conn,
        "tok",
        "user-owner",
        "role-owner",
        "s1",
        "resto-1",
        Some("resto-1".into()),
    );
    seed_terminal_in_store(&app, "s1", "resto-1", "Restaurant POS", "dev-resto");

    // Register a broadcast device (empty station_ids).
    let broadcast_device = crate::kds_device::register_kds_device(
        &app.ctx(),
        "tok",
        RegisterKdsDeviceInput {
            name: "Expo Screen".into(),
            restaurant_pos_id: "resto-1".into(),
            station_ids: vec![], // broadcast
            pairing_token_hash: "h-expo".into(),
            pairing_expires_at: "2099-01-01".into(),
        },
    )
    .await
    .unwrap();

    // Create a KDS order.
    let order = create_kds_order_in_store(
        &app,
        &KdsOrder {
            id: "order-any".into(),
            sale_id: "sale-any".into(),
            store_id: Some("s1".into()),
            target_instance_id: None,
            status: "pending".into(),
            items_summary: "Mixed items".into(),
            item_count: 3,
            display_number: None,
            ticket_prefix: String::new(),
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
    let targets = crate::kds_routing::resolve_kds_targets(&app.ctx(), "tok", &order.id)
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
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    let app = scoped_state_with_restaurant(
        conn,
        "tok",
        "user-owner",
        "role-owner",
        "s1",
        "resto-1",
        Some("resto-1".into()),
    );
    seed_terminal_in_store(&app, "s1", "resto-1", "Restaurant POS", "dev-resto");

    // Register a device then deactivate it.
    let device = crate::kds_device::register_kds_device(
        &app.ctx(),
        "tok",
        RegisterKdsDeviceInput {
            name: "Old Display".into(),
            restaurant_pos_id: "resto-1".into(),
            station_ids: vec![],
            pairing_token_hash: "h-old".into(),
            pairing_expires_at: "2099-01-01".into(),
        },
    )
    .await
    .unwrap();

    crate::kds_device::deactivate_kds_device(&app.ctx(), "tok", &device.id)
        .await
        .unwrap();

    // Create a KDS order.
    let order = create_kds_order_in_store(
        &app,
        &KdsOrder {
            id: "order-inactive".into(),
            sale_id: "sale-inactive".into(),
            store_id: Some("s1".into()),
            target_instance_id: None,
            status: "pending".into(),
            items_summary: "Fries".into(),
            item_count: 1,
            display_number: None,
            ticket_prefix: String::new(),
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
    let targets = crate::kds_routing::resolve_kds_targets(&app.ctx(), "tok", &order.id)
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
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    let app = scoped_state_with_restaurant(
        conn,
        "tok",
        "user-owner",
        "role-owner",
        "s1",
        "resto-1",
        Some("resto-1".into()),
    );
    seed_terminal_in_store(&app, "s1", "resto-1", "Restaurant POS", "dev-resto");

    let input = RegisterKdsDeviceInput {
        name: "Grill Display".into(),
        restaurant_pos_id: "resto-1".into(),
        station_ids: vec![],
        pairing_token_hash: "h1".into(),
        pairing_expires_at: "2099-01-01".into(),
    };

    // First registration succeeds.
    let result1 = crate::kds_device::register_kds_device(&app.ctx(), "tok", input.clone()).await;
    assert!(result1.is_ok(), "first registration should succeed");

    // Second registration with same name fails.
    let result2 = crate::kds_device::register_kds_device(&app.ctx(), "tok", input).await;
    assert!(result2.is_err(), "duplicate name should be rejected");
}

// ══════════════════════════════════════════════════════════════════
// Integration: Order already acked by another device
// ══════════════════════════════════════════════════════════════════

/// When two devices try to ack the same order, only the first wins.
#[tokio::test]
async fn integration_concurrent_ack_only_first_wins() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    let app = scoped_state_with_restaurant(
        conn,
        "tok",
        "user-owner",
        "role-owner",
        "s1",
        "resto-1",
        Some("resto-1".into()),
    );
    seed_terminal_in_store(&app, "s1", "resto-1", "Restaurant POS", "dev-resto");

    // Register two devices.
    let device_a = crate::kds_device::register_kds_device(
        &app.ctx(),
        "tok",
        RegisterKdsDeviceInput {
            name: "Device A".into(),
            restaurant_pos_id: "resto-1".into(),
            station_ids: vec![],
            pairing_token_hash: "ha".into(),
            pairing_expires_at: "2099-01-01".into(),
        },
    )
    .await
    .unwrap();

    let device_b = crate::kds_device::register_kds_device(
        &app.ctx(),
        "tok",
        RegisterKdsDeviceInput {
            name: "Device B".into(),
            restaurant_pos_id: "resto-1".into(),
            station_ids: vec![],
            pairing_token_hash: "hb".into(),
            pairing_expires_at: "2099-01-01".into(),
        },
    )
    .await
    .unwrap();

    // Create a KDS order.
    let order = create_kds_order_in_store(
        &app,
        &KdsOrder {
            id: "order-race".into(),
            sale_id: "sale-race".into(),
            store_id: Some("s1".into()),
            target_instance_id: None,
            status: "pending".into(),
            items_summary: "Pizza".into(),
            item_count: 1,
            display_number: None,
            ticket_prefix: String::new(),
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
    let ack_a = crate::kds_device::ack_kds_order(&app.ctx(), "tok", &order.id, &device_a.id)
        .await
        .unwrap();
    assert!(ack_a, "device A should win the ack race");

    // Device B acks second — should fail.
    let ack_b = crate::kds_device::ack_kds_order(&app.ctx(), "tok", &order.id, &device_b.id)
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
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    let app = scoped_state_with_restaurant(
        conn,
        "tok",
        "user-owner",
        "role-owner",
        "s1",
        "resto-1",
        Some("resto-1".into()),
    );
    seed_terminal_in_store(&app, "s1", "resto-1", "Restaurant POS", "dev-resto");

    // Register two devices.
    let device_good = crate::kds_device::register_kds_device(
        &app.ctx(),
        "tok",
        RegisterKdsDeviceInput {
            name: "Good Display".into(),
            restaurant_pos_id: "resto-1".into(),
            station_ids: vec![],
            pairing_token_hash: "hg".into(),
            pairing_expires_at: "2099-01-01".into(),
        },
    )
    .await
    .unwrap();

    let device_stale = crate::kds_device::register_kds_device(
        &app.ctx(),
        "tok",
        RegisterKdsDeviceInput {
            name: "Stale Display".into(),
            restaurant_pos_id: "resto-1".into(),
            station_ids: vec![],
            pairing_token_hash: "hs".into(),
            pairing_expires_at: "2099-01-01".into(),
        },
    )
    .await
    .unwrap();

    // Connect both, then backdate stale device's last_seen_at.
    crate::kds_device::update_kds_device_status(
        &app.ctx(),
        "tok",
        &device_good.id,
        kasirmu_core::kds::KdsConnectionStatus::Connected,
    )
    .await
    .unwrap();
    crate::kds_device::update_kds_device_status(
        &app.ctx(),
        "tok",
        &device_stale.id,
        kasirmu_core::kds::KdsConnectionStatus::Connected,
    )
    .await
    .unwrap();

    // Backdate stale device's last_seen_at to simulate disconnection.
    {
        let state_ref = &app;
        let db_ref = state_ref.db_manager().open_store("s1").unwrap();
        let db = db_ref.lock().unwrap();
        db.execute(
            "UPDATE kds_devices SET last_seen_at = '2020-01-01T00:00:00.000Z' WHERE id = ?1",
            rusqlite::params![device_stale.id],
        )
        .unwrap();
    }

    // Run health daemon cycle via Store directly.
    {
        let state_ref = &app;
        let db_ref = state_ref.db_manager().open_store("s1").unwrap();
        let db = db_ref.lock().unwrap();
        let store = Store::new(&db);

        // 1. Mark stale (30s threshold).
        let marked = store.mark_stale_kds_devices(30).unwrap();
        assert_eq!(marked, 1, "should mark 1 device stale");

        // 2. Good device should still be connected.
        let good = store.get_kds_device(&device_good.id).unwrap().unwrap();
        assert_eq!(
            good.connection_status,
            kasirmu_core::kds::KdsConnectionStatus::Connected
        );

        // 3. Stale device should be marked stale.
        let stale = store.get_kds_device(&device_stale.id).unwrap().unwrap();
        assert_eq!(
            stale.connection_status,
            kasirmu_core::kds::KdsConnectionStatus::Stale
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
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    let app = scoped_state_with_restaurant(
        conn,
        "tok",
        "user-owner",
        "role-owner",
        "s1",
        "resto-1",
        Some("resto-1".into()),
    );
    seed_terminal_in_store(&app, "s1", "resto-1", "Restaurant A", "dev-a");
    seed_terminal_in_store(&app, "s1", "resto-2", "Restaurant B", "dev-b");

    // Register device under resto-1.
    let device_a = crate::kds_device::register_kds_device(
        &app.ctx(),
        "tok",
        RegisterKdsDeviceInput {
            name: "Display A".into(),
            restaurant_pos_id: "resto-1".into(),
            station_ids: vec![],
            pairing_token_hash: "ha".into(),
            pairing_expires_at: "2099-01-01".into(),
        },
    )
    .await
    .unwrap();

    // Register device under resto-2 (via Store directly since session is for resto-1).
    {
        let state_ref = &app;
        let db_ref = state_ref.db_manager().open_store("s1").unwrap();
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
    let devices = crate::kds_device::list_kds_devices(&app.ctx(), "tok")
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
// (grep evidence: no test referenced them). The kasirmu-core layer beneath
// is pinned in crates/kasirmu-core; these pin the wiring.

/// Seeds a restaurant product (BURGER) into the store DB so the fanout
/// creates a ticket.
fn seed_restaurant_product(app: &TestBridge) {
    let store_db = app.db_manager().open_store("s1").unwrap();
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
fn create_restaurant_sale_in_store(app: &TestBridge, sale_id: &str) {
    let store_db = app.db_manager().open_store("s1").unwrap();
    let db = store_db.lock().unwrap();
    let s = Store::new(&db);
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let usd: Currency = "USD".parse().unwrap();
    let unit = Money {
        minor_units: 500,
        currency: usd,
    };
    let line_id = uuid::Uuid::now_v7().to_string();
    let sale = Sale {
        id: sale_id.into(),
        status: SaleStatus::Pending,
        total: unit,
        line_count: 1,
        currency: usd,
        payment_method: None,
        tendered_minor: None,
        user_id: Some("user-owner".into()),
        created_at: now.clone(),
        updated_at: now.clone(),
        lines: vec![kasirmu_core::SaleLine {
            id: line_id.clone(),
            sale_id: sale_id.into(),
            sku: "BURGER".into(),
            qty: 1,
            unit_price: unit,
            line_total: unit,
            line_position: 1,
            tax_amount: Money {
                minor_units: 0,
                currency: usd,
            },
            tax_rate_id: None,
            tax_breakdown_json: None,
            serial_number: None,
            course: None,
            modifiers_json: None,
        }],
        discount_percent: 0,
        discount_label: None,
        subtotal: unit,
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

#[tokio::test]
async fn scoped_line_item_status_update_and_read_end_to_end() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    let app = scoped_state(conn, "tok", "user-owner", "role-owner", "s1", "kds-main");
    seed_restaurant_product(&app);
    create_restaurant_sale_in_store(&app, "sale-lines-1");

    let orders = create_kds_order_from_sale_scoped(&app.ctx(), "tok", "sale-lines-1")
        .await
        .unwrap();
    assert_eq!(
        orders.len(),
        1,
        "restaurant product must fan out one unzoned ticket"
    );
    assert_eq!(orders[0].store_id.as_deref(), Some("s1"));

    let lines = get_kds_order_lines_scoped(&app.ctx(), "tok", &orders[0].id)
        .await
        .unwrap();
    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0].item_status, "pending");

    let updated = update_kds_line_item_status_scoped(&app.ctx(), "tok", &lines[0].id, "preparing")
        .await
        .unwrap();
    assert_eq!(updated.item_status, "preparing");
    assert!(updated.started_at.is_some(), "started_at stamped");
}

#[tokio::test]
async fn scoped_update_kds_order_items_edits_ticket() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    let app = scoped_state(conn, "tok", "user-owner", "role-owner", "s1", "kds-main");
    seed_restaurant_product(&app);
    create_restaurant_sale_in_store(&app, "sale-items-1");

    let orders = create_kds_order_from_sale_scoped(&app.ctx(), "tok", "sale-items-1")
        .await
        .unwrap();

    let edited = update_kds_order_items_scoped(
        &app.ctx(),
        "tok",
        kasirmu_core::UpdateKdsOrderItemsInput {
            id: orders[0].id.clone(),
            items_summary: "Burger, Fries".into(),
            item_count: 2,
            line_items: Some(vec![
                kasirmu_core::CreateKdsLineItemInput {
                    sku: "BURGER".into(),
                    display_name: "Burger".into(),
                    qty: 1,
                    course: Some("main".into()),
                    modifiers: vec![],
                },
                kasirmu_core::CreateKdsLineItemInput {
                    sku: "FRIES".into(),
                    display_name: "Fries".into(),
                    qty: 1,
                    course: Some("side".into()),
                    modifiers: vec![],
                },
            ]),
        },
    )
    .await
    .unwrap();
    assert_eq!(edited.items_summary, "Burger, Fries");
    assert_eq!(edited.item_count, 2);

    let lines = get_kds_order_lines_scoped(&app.ctx(), "tok", &orders[0].id)
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
    let conn = kasirmu_core::migrations::fresh_db();
    let app = scoped_state(conn, "tok", "user-owner", "role-owner", "s1", "kds-main");

    let result =
        update_kds_line_item_status_scoped(&app.ctx(), "bad-token", "item-1", "preparing").await;
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

#[tokio::test]
async fn scoped_get_order_lines_rejects_invalid_token() {
    let conn = kasirmu_core::migrations::fresh_db();
    let app = scoped_state(conn, "tok", "user-owner", "role-owner", "s1", "kds-main");

    let result = get_kds_order_lines_scoped(&app.ctx(), "bad-token", "order-1").await;
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

#[tokio::test]
async fn scoped_update_order_items_rejects_invalid_token() {
    let conn = kasirmu_core::migrations::fresh_db();
    let app = scoped_state(conn, "tok", "user-owner", "role-owner", "s1", "kds-main");

    let result = update_kds_order_items_scoped(
        &app.ctx(),
        "bad-token",
        kasirmu_core::UpdateKdsOrderItemsInput {
            id: "order-1".into(),
            items_summary: String::new(),
            item_count: 0,
            line_items: None,
        },
    )
    .await;
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

#[tokio::test]
async fn scoped_create_tickets_rejects_invalid_token() {
    let conn = kasirmu_core::migrations::fresh_db();
    let app = scoped_state(conn, "tok", "user-owner", "role-owner", "s1", "kds-main");

    let result = create_kds_order_from_sale_scoped(&app.ctx(), "bad-token", "sale-1").await;
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

// ── Gap pins: resolve_kds_targets_scoped command-level routing ──────
//
// The integration tests above cover broadcast-mode and inactive-device
// exclusion; the station-claim path (line items → product kitchen_zone →
// device station_ids), the terminal-id fallback for Restaurant POS
// sessions, the phase-3 catch-all, and the unknown-order error were
// unpinned at the command layer.

/// Seed BURGER + FRIES products, set their kitchen zones via SQL (not
/// exposed on create_product), and return the order with two structured
/// line items (round-W helper shape).
fn seed_zoned_ticket(app: &TestBridge) -> KdsOrder {
    seed_restaurant_product(app);
    let store_db = app.db_manager().open_store("s1").unwrap();
    let db = store_db.lock().unwrap();
    // The core helper seeds only BURGER; FRIES must exist before its
    // kitchen_zone can be set (create_product, then SQL for the zone —
    // not exposed on the create_product API).
    Store::new(&db)
        .create_product(
            "FRIES",
            "Fries",
            Money {
                minor_units: 300,
                currency: "USD".parse().unwrap(),
            },
            None,
            None,
            10,
            Some("restaurant"),
        )
        .unwrap();
    db.execute(
        "UPDATE products SET kitchen_zone = 'grill' WHERE sku = 'BURGER'",
        [],
    )
    .unwrap();
    db.execute(
        "UPDATE products SET kitchen_zone = 'fry' WHERE sku = 'FRIES'",
        [],
    )
    .unwrap();

    let s = Store::new(&db);
    let mut cart = kasirmu_core::Cart::new(usd());
    cart.add_line(kasirmu_core::CartLine::new(
        kasirmu_core::Sku::new("BURGER"),
        1,
        usd_price(500),
    ))
    .unwrap();
    cart.add_line(kasirmu_core::CartLine::new(
        kasirmu_core::Sku::new("FRIES"),
        1,
        usd_price(300),
    ))
    .unwrap();
    let sale = kasirmu_core::Sale::from_cart(&cart).unwrap();
    s.create_sale(&sale).unwrap();

    let order = s
        .create_kds_order(CreateKdsOrderInput {
            sale_id: sale.id.clone(),
            store_id: Some("s1".into()),
            items_summary: "Burger, Fries".into(),
            item_count: 2,
            kitchen_zone: Some("grill".into()),
            notes: String::new(),
            table_number: None,
            priority: false,
        })
        .unwrap();
    s.create_kds_line_items(
        &order.id,
        &[
            kasirmu_core::CreateKdsLineItemInput {
                sku: "BURGER".into(),
                display_name: "Burger".into(),
                qty: 1,
                course: Some("main".into()),
                modifiers: vec![],
            },
            kasirmu_core::CreateKdsLineItemInput {
                sku: "FRIES".into(),
                display_name: "Fries".into(),
                qty: 1,
                course: Some("side".into()),
                modifiers: vec![],
            },
        ],
    )
    .unwrap();
    order
}

fn usd() -> kasirmu_core::Currency {
    "USD".parse().unwrap()
}

fn usd_price(minor: i64) -> Money {
    Money {
        minor_units: minor,
        currency: usd(),
    }
}

#[tokio::test]
async fn routing_station_claim_sends_each_line_to_its_zone_device() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    let app = scoped_state_with_restaurant(
        conn,
        "tok",
        "user-owner",
        "role-owner",
        "s1",
        "resto-1",
        Some("resto-1".into()),
    );
    let order = seed_zoned_ticket(&app);
    seed_terminal_in_store(&app, "s1", "resto-1", "Restaurant POS", "dev-resto");
    {
        let store_db = app.db_manager().open_store("s1").unwrap();
        let db = store_db.lock().unwrap();
        let s = Store::new(&db);
        s.register_kds_device(RegisterKdsDeviceInput {
            name: "Grill".into(),
            restaurant_pos_id: "resto-1".into(),
            station_ids: vec!["grill".into()],
            pairing_token_hash: "h1".into(),
            pairing_expires_at: "2099-01-01".into(),
        })
        .unwrap();
        s.register_kds_device(RegisterKdsDeviceInput {
            name: "Fry".into(),
            restaurant_pos_id: "resto-1".into(),
            station_ids: vec!["fry".into()],
            pairing_token_hash: "h2".into(),
            pairing_expires_at: "2099-01-01".into(),
        })
        .unwrap();
    }

    let targets = crate::kds_routing::resolve_kds_targets(&app.ctx(), "tok", &order.id)
        .await
        .unwrap();
    assert_eq!(
        targets.len(),
        2,
        "grill line → grill device, fry line → fry device"
    );
}

#[tokio::test]
async fn routing_catch_all_when_no_device_claims_a_station() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    let app = scoped_state_with_restaurant(
        conn,
        "tok",
        "user-owner",
        "role-owner",
        "s1",
        "resto-1",
        Some("resto-1".into()),
    );
    let order = seed_zoned_ticket(&app);
    seed_terminal_in_store(&app, "s1", "resto-1", "Restaurant POS", "dev-resto");
    {
        let store_db = app.db_manager().open_store("s1").unwrap();
        let db = store_db.lock().unwrap();
        let s = Store::new(&db);
        // Only the fry station is claimed; 'grill' has no device →
        // phase-3 catch-all broadcasts to every active device.
        s.register_kds_device(RegisterKdsDeviceInput {
            name: "Fry".into(),
            restaurant_pos_id: "resto-1".into(),
            station_ids: vec!["fry".into()],
            pairing_token_hash: "h2".into(),
            pairing_expires_at: "2099-01-01".into(),
        })
        .unwrap();
    }

    let targets = crate::kds_routing::resolve_kds_targets(&app.ctx(), "tok", &order.id)
        .await
        .unwrap();
    assert_eq!(
        targets.len(),
        1,
        "unclaimed 'grill' station triggers catch-all broadcast"
    );
}

#[tokio::test]
async fn routing_restaurant_pos_session_falls_back_to_terminal_id() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    // NO restaurant_pos_id: the command must fall back to terminal_id and
    // find devices registered to "terminal-1" (scoped_state's terminal).
    let app = scoped_state(conn, "tok", "user-owner", "role-owner", "s1", "terminal-1");
    seed_terminal_in_store(&app, "s1", "terminal-1", "Restaurant POS", "dev-term");
    {
        let store_db = app.db_manager().open_store("s1").unwrap();
        let db = store_db.lock().unwrap();
        let s = Store::new(&db);
        s.register_kds_device(RegisterKdsDeviceInput {
            name: "Expo".into(),
            restaurant_pos_id: "terminal-1".into(),
            station_ids: vec![],
            pairing_token_hash: "h3".into(),
            pairing_expires_at: "2099-01-01".into(),
        })
        .unwrap();
    }
    // Sale seeded BEFORE the guard: create_sale_in_store opens the same
    // store and locks the same non-reentrant std Mutex — calling it inside
    // the guard below deadlocks (the 7-hour zombie run).
    create_sale_in_store(&app, "sale-fb");
    let order = {
        let store_db = app.db_manager().open_store("s1").unwrap();
        let db = store_db.lock().unwrap();
        let s = Store::new(&db);
        s.create_kds_order(CreateKdsOrderInput {
            sale_id: "sale-fb".into(),
            store_id: Some("s1".into()),
            items_summary: "Burger".into(),
            item_count: 1,
            kitchen_zone: Some("grill".into()),
            notes: String::new(),
            table_number: None,
            priority: false,
        })
        .unwrap()
    };

    let devices = crate::kds_device::list_kds_devices(&app.ctx(), "tok")
        .await
        .unwrap();
    assert_eq!(devices.len(), 1, "fallback finds the device");
    let targets = crate::kds_routing::resolve_kds_targets(&app.ctx(), "tok", &order.id)
        .await
        .unwrap();
    assert_eq!(targets.len(), 1, "broadcast device receives the order");
}

#[tokio::test]
async fn routing_unknown_order_fails_with_invalid() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    let app = scoped_state(conn, "tok", "user-owner", "role-owner", "s1", "kds-main");

    let result = crate::kds_routing::resolve_kds_targets(&app.ctx(), "tok", "no-such-order").await;
    assert!(matches!(result, Err(BridgeError::Invalid(_))));
}
