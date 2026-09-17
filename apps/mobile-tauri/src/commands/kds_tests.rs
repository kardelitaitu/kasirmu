use super::*;
use kasirmu_core::migrations;
use kasirmu_core::session::SessionContext;
use platform_core::StoreDatabaseManager;
use tauri::Manager as _;

// ── Harness (mirrors analytics_tests.rs) ─────────────────────────────

fn seed_owner(conn: &rusqlite::Connection) {
    let store = Store::new(conn);
    store.seed_default_roles().unwrap();
    conn.execute_batch(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) VALUES
            ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
}

/// Global conn + store db ("store-a") holding one restaurant product and
/// one pending one-line sale, ready for the KDS fanout.
fn kds_state() -> (AppState, tempfile::TempDir) {
    let conn = migrations::fresh_db();
    seed_owner(&conn);
    let temp_dir = tempfile::tempdir().unwrap();
    let mut state = AppState::for_test_with_conn(conn);
    state.db_manager = StoreDatabaseManager::new(temp_dir.path().to_path_buf(), migrations::ALL);
    seed_restaurant_sale(&state);

    (state, temp_dir)
}

/// Seed store-a with one restaurant product ("BURGER") and one pending
/// one-line sale (`sale-kds-t1`) — the fanout input for create-from-sale
/// and the FK target for hand-created KDS orders.
fn seed_restaurant_sale(state: &AppState) {
    let store_db = state.db_manager.open_store("store-a").unwrap();
    let db = store_db.lock().unwrap();
    let s = Store::new(&db);
    s.create_product(
        "BURGER",
        "Burger",
        kasirmu_core::Money {
            minor_units: 500,
            currency: "USD".parse().unwrap(),
        },
        None,
        None,
        10,
        Some("restaurant"),
    )
    .unwrap();

    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let usd: kasirmu_core::Currency = "USD".parse().unwrap();
    let unit = kasirmu_core::Money {
        minor_units: 500,
        currency: usd,
    };
    let sale = kasirmu_core::Sale {
        id: "sale-kds-t1".into(),
        status: kasirmu_core::SaleStatus::Pending,
        total: unit,
        line_count: 1,
        currency: usd,
        payment_method: None,
        tendered_minor: None,
        user_id: Some("user-owner".into()),
        created_at: now.clone(),
        updated_at: now,
        lines: vec![kasirmu_core::SaleLine {
            id: "sl-kds-t1".into(),
            sale_id: "sale-kds-t1".into(),
            sku: "BURGER".into(),
            qty: 1,
            unit_price: unit,
            line_total: unit,
            line_position: 1,
            tax_amount: kasirmu_core::Money {
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
        tax_total: kasirmu_core::Money {
            minor_units: 0,
            currency: "USD".parse().unwrap(),
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

fn mint_session(state: &mut AppState, token: &str, user_id: &str, role_id: &str) {
    state.session_store.write().unwrap().insert(
        token.into(),
        SessionContext::new(
            user_id.into(),
            role_id.into(),
            "terminal-1".into(),
            "store-a".into(),
            "kds-main".into(),
            "kds".into(),
            None,
            0,
        ),
    );
}

fn mock_app(state: AppState) -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap()
}

fn create_order_in_store(state: &AppState, _id: &str) -> KdsOrder {
    let store_db = state.db_manager.open_store("store-a").unwrap();
    let db = store_db.lock().unwrap();
    let s = Store::new(&db);
    s.create_kds_order(kasirmu_core::CreateKdsOrderInput {
        sale_id: "sale-kds-t1".into(),
        store_id: Some("store-a".into()),
        items_summary: "Burger".into(),
        item_count: 1,
        kitchen_zone: Some("grill".into()),
        notes: String::new(),
        table_number: None,
        priority: false,
    })
    .unwrap()
}

// ── Tests ────────────────────────────────────────────────────────────

// The tablet KDS command file was the ONLY commands/*.rs without a test
// module; these pin the session→store→instance wiring the kitchen
// display actually runs on (ADR #7 parity with the desktop shell).

#[tokio::test]
async fn invalid_token_is_rejected_on_list() {
    let (state, _dir) = kds_state();
    let app = mock_app(state);

    let result = list_kds_orders_scoped("bad-token".into(), None, app.state()).await;
    assert!(matches!(result, Err(AppError::InvalidSession)));
}

#[tokio::test]
async fn owner_lists_kds_orders_through_the_tablet_command() {
    let (mut state, _dir) = kds_state();
    mint_session(&mut state, "tok", "user-owner", "role-owner");
    let created = create_order_in_store(&state, "o1");
    let app = mock_app(state);

    let orders = list_kds_orders_scoped("tok".into(), None, app.state())
        .await
        .unwrap();
    assert_eq!(orders.len(), 1);
    assert_eq!(orders[0].id, created.id);
    assert_eq!(orders[0].store_id.as_deref(), Some("store-a"));
}

#[tokio::test]
async fn update_kds_status_advances_and_stamps_started_at() {
    let (mut state, _dir) = kds_state();
    mint_session(&mut state, "tok", "user-owner", "role-owner");
    let created = create_order_in_store(&state, "o1");
    let app = mock_app(state);

    let updated = update_kds_status_scoped(
        "tok".into(),
        created.id.clone(),
        "preparing".into(),
        app.state(),
    )
    .await
    .unwrap();
    assert_eq!(updated.status, "preparing");
    assert!(updated.started_at.is_some(), "started_at stamped");
}

#[tokio::test]
async fn create_kds_order_from_sale_tags_the_session_store() {
    let (mut state, _dir) = kds_state();
    mint_session(&mut state, "tok", "user-owner", "role-owner");
    let app = mock_app(state);

    let orders = create_kds_order_from_sale_scoped("tok".into(), "sale-kds-t1".into(), app.state())
        .await
        .unwrap();
    assert_eq!(
        orders.len(),
        1,
        "one restaurant line fans out one untargeted ticket"
    );
    assert_eq!(orders[0].store_id.as_deref(), Some("store-a"));

    // The new ticket is immediately visible on this display's queue.
    let queue = get_kds_queue_scoped("tok".into(), None, app.state())
        .await
        .unwrap();
    assert_eq!(queue.len(), 1);
    assert_eq!(queue[0].id, orders[0].id);
}

#[tokio::test]
async fn get_kds_order_returns_none_for_another_instances_ticket() {
    let (mut state, _dir) = kds_state();
    mint_session(&mut state, "tok", "user-owner", "role-owner");
    {
        // A ticket explicitly targeted at a DIFFERENT display.
        let store_db = state.db_manager.open_store("store-a").unwrap();
        let db = store_db.lock().unwrap();
        let s = Store::new(&db);
        s.create_kds_order_routed(
            kasirmu_core::CreateKdsOrderInput {
                sale_id: "sale-kds-t1".into(),
                store_id: Some("store-a".into()),
                items_summary: "Burger".into(),
                item_count: 1,
                kitchen_zone: Some("grill".into()),
                notes: String::new(),
                table_number: None,
                priority: false,
            },
            Some("kds-other"),
        )
        .unwrap();
    }
    let app = mock_app(state);

    let result = get_kds_order_scoped("tok".into(), "o1".into(), app.state())
        .await
        .unwrap();
    assert!(
        result.is_none(),
        "another display's ticket must be invisible (no-existence-oracle)"
    );
}

#[tokio::test]
async fn role_without_permissions_cannot_update_kds_status() {
    // Permission checks resolve the user's role in the GLOBAL identity
    // database (require_permission_for_session locks state.db), so the
    // permission-less role must be seeded there — before AppState wraps it.
    let conn = migrations::fresh_db();
    seed_owner(&conn);
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at)
         VALUES ('role-none', 'None', 'No permissions', '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) VALUES
            ('user-none', 'none', 'hash', 'None', 'role-none', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
    let temp_dir = tempfile::tempdir().unwrap();
    let mut state = AppState::for_test_with_conn(conn);
    state.db_manager = StoreDatabaseManager::new(temp_dir.path().to_path_buf(), migrations::ALL);

    // The ticket exists and is even visible to this session's instance —
    // the denial must come from the permission gate, not absence of data.
    seed_restaurant_sale(&state);
    mint_session(&mut state, "tok", "user-none", "role-none");
    let created = create_order_in_store(&state, "o1");
    let app = mock_app(state);

    let result = update_kds_status_scoped(
        "tok".into(),
        created.id.clone(),
        "preparing".into(),
        app.state(),
    )
    .await;
    assert!(matches!(result, Err(AppError::PermissionDenied(_))));
}
