use super::*;
use crate::testing::TestBridge;
use kasirmu_core::kds::{KdsRoutingRuleInput, KdsRuleMatcher};
use kasirmu_core::session::SessionContext;
use kasirmu_core::{
    CreateKdsLineItemInput, CreateKdsOrderInput, Currency, Money, RegisterKdsDeviceInput, Sale,
    SaleStatus,
};

// ── Helpers (mirroring kds_tests' harness shape) ────────────────

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

fn scoped_state_with_restaurant(
    conn: rusqlite::Connection,
    token: &str,
    user_id: &str,
    role_id: &str,
    store_id: &str,
    instance_id: &str,
    restaurant_pos_id: Option<String>,
) -> TestBridge {
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

/// Session whose restaurant scope falls back to `terminal-1` (a Restaurant
/// POS session without an explicit `restaurant_pos_id`).
fn scoped_pos_session(conn: rusqlite::Connection) -> TestBridge {
    scoped_state_with_restaurant(
        conn,
        "tok",
        "user-owner",
        "role-owner",
        "s1",
        "pos-main",
        None,
    )
}

fn seed_terminal_in_store(app: &TestBridge, store_id: &str, id: &str) {
    let store_db = app.db_manager().open_store(store_id).unwrap();
    let db = store_db.lock().unwrap();
    db.execute(
        "INSERT OR IGNORE INTO terminals (id, name, device_id, is_active, created_at, updated_at)
         VALUES (?1, ?2, ?3, 1, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        rusqlite::params![id, format!("Term {id}"), format!("dev-{id}")],
    )
    .unwrap();
}

/// Seed a two-line ticket: BURGER (zone `grill`) + COCKTAIL (no zone at
/// all). Devices: Grill serves `grill`, Bar serves `bar`. Returns the
/// order id; the Bar device receives this ticket ONLY through a rule.
fn seed_split_candidate_ticket(app: &TestBridge) -> String {
    {
        let store_db = app.db_manager().open_store("s1").unwrap();
        let db = store_db.lock().unwrap();
        let s = Store::new(&db);
        let usd: Currency = "USD".parse().unwrap();
        s.create_product(
            "BURGER",
            "Burger",
            Money {
                minor_units: 500,
                currency: usd,
            },
            None,
            None,
            10,
            Some("restaurant"),
        )
        .unwrap();
        s.create_product(
            "COCKTAIL",
            "Cocktail",
            Money {
                minor_units: 700,
                currency: usd,
            },
            None,
            None,
            10,
            Some("restaurant"),
        )
        .unwrap();
        // kitchen_zone is not on the create API (same route as kds_tests).
        db.execute(
            "UPDATE products SET kitchen_zone = 'grill' WHERE sku = 'BURGER'",
            [],
        )
        .unwrap();

        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let zero = Money {
            minor_units: 0,
            currency: usd,
        };
        let sale = Sale {
            id: "sale-split".into(),
            status: SaleStatus::Pending,
            total: Money {
                minor_units: 1200,
                currency: usd,
            },
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
        let order = s
            .create_kds_order(CreateKdsOrderInput {
                sale_id: sale.id.clone(),
                store_id: Some("s1".into()),
                items_summary: "Burger, Cocktail".into(),
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
                CreateKdsLineItemInput {
                    sku: "BURGER".into(),
                    display_name: "Burger".into(),
                    qty: 1,
                    course: Some("main".into()),
                    modifiers: vec![],
                },
                CreateKdsLineItemInput {
                    sku: "COCKTAIL".into(),
                    display_name: "Cocktail".into(),
                    qty: 1,
                    course: Some("beverage".into()),
                    modifiers: vec![],
                },
            ],
        )
        .unwrap();
        for (name, station) in [("Grill", "grill"), ("Bar", "bar")] {
            s.register_kds_device(RegisterKdsDeviceInput {
                name: name.into(),
                restaurant_pos_id: "terminal-1".into(),
                station_ids: vec![station.into()],
                pairing_token_hash: format!("h-{name}"),
                pairing_expires_at: "2099-01-01".into(),
            })
            .unwrap();
        }
        order.id
    }
}

fn sku_rule(priority: i64, sku: &str, station: &str) -> KdsRoutingRuleInput {
    KdsRoutingRuleInput {
        priority,
        matcher: KdsRuleMatcher::Sku,
        matcher_value: sku.into(),
        target_station: station.into(),
        is_active: true,
    }
}

// ── Session & permission guards ─────────────────────────────────

#[tokio::test]
async fn get_kds_routing_rules_rejects_invalid_token() {
    let app = TestBridge::new();
    let result = get_kds_routing_rules(&app.ctx(), "dead-token").await;
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

#[tokio::test]
async fn save_kds_routing_rules_rejects_invalid_token() {
    let app = TestBridge::new();
    let result = save_kds_routing_rules(&app.ctx(), "dead-token", vec![]).await;
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

#[tokio::test]
async fn save_kds_routing_rules_denied_without_kds_update() {
    // role-lite carries only sales:view: neither read nor write passes.
    let conn = crate::testing::temp_conn();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-lite', 'Lite', 'Limited', '[\"sales:view\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-lite', 'lite', 'hash', 'Lite', 'role-lite', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
    let app = scoped_state_with_restaurant(
        conn,
        "lite-tok",
        "user-lite",
        "role-lite",
        "s1",
        "pos-main",
        Some("terminal-1".into()),
    );

    let denied = save_kds_routing_rules(&app.ctx(), "lite-tok", vec![sku_rule(1, "X", "s")])
        .await
        .unwrap_err();
    assert!(matches!(denied, BridgeError::PermissionDenied(_)));
    let denied = get_kds_routing_rules(&app.ctx(), "lite-tok")
        .await
        .unwrap_err();
    assert!(matches!(denied, BridgeError::PermissionDenied(_)));
}

// ── get / save roundtrip ────────────────────────────────────────

#[tokio::test]
async fn save_then_get_roundtrip_scoped() {
    let conn = crate::testing::temp_conn();
    seed_owner(&conn);
    let app = scoped_pos_session(conn);
    seed_terminal_in_store(&app, "s1", "terminal-1");

    let saved = save_kds_routing_rules(
        &app.ctx(),
        "tok",
        vec![
            sku_rule(1, "BURGER", "grill"),
            KdsRoutingRuleInput {
                priority: 2,
                matcher: KdsRuleMatcher::Category,
                matcher_value: "cat-drinks".into(),
                target_station: "bar".into(),
                is_active: true,
            },
        ],
    )
    .await
    .unwrap();
    assert_eq!(saved.len(), 2);
    assert_eq!(saved[0].priority, 1);
    assert_eq!(saved[1].matcher, KdsRuleMatcher::Category);

    let listed = get_kds_routing_rules(&app.ctx(), "tok").await.unwrap();
    assert_eq!(listed, saved, "get must return exactly what save wrote");

    // Whole-set replace semantics over IPC: saving [] clears the scope.
    let cleared = save_kds_routing_rules(&app.ctx(), "tok", vec![])
        .await
        .unwrap();
    assert!(cleared.is_empty());
    assert!(
        get_kds_routing_rules(&app.ctx(), "tok")
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn save_validation_surfaces_as_core_error() {
    let conn = crate::testing::temp_conn();
    seed_owner(&conn);
    let app = scoped_pos_session(conn);
    seed_terminal_in_store(&app, "s1", "terminal-1");

    let err = save_kds_routing_rules(&app.ctx(), "tok", vec![sku_rule(1, "", "grill")])
        .await
        .unwrap_err();
    assert!(
        matches!(err, BridgeError::Core { .. }),
        "validation must surface as Core: {err:?}"
    );
    // And nothing was written.
    assert!(
        get_kds_routing_rules(&app.ctx(), "tok")
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn rules_scoped_via_terminal_id_fallback() {
    // Two sessions over one store: a POS session (no restaurant_pos_id,
    // scope falls back to terminal-1) writes; a KDS device session whose
    // restaurant_pos_id names terminal-1 reads the same set.
    let conn = crate::testing::temp_conn();
    seed_owner(&conn);
    let app = scoped_pos_session(conn);
    seed_terminal_in_store(&app, "s1", "terminal-1");
    save_kds_routing_rules(&app.ctx(), "tok", vec![sku_rule(1, "BURGER", "grill")])
        .await
        .unwrap();

    // Add a device session to the same bridge (a second TestBridge owns a
    // different temp store DB, which would not share the rules at all).
    app.sessions().write().unwrap().insert(
        "dev-tok".into(),
        SessionContext::new_with_restaurant_pos(
            "user-owner".into(),
            "role-owner".into(),
            "terminal-1".into(),
            "s1".into(),
            "kds-1".into(),
            "kds".into(),
            None,
            0,
            Some("terminal-1".into()),
        ),
    );
    let via_device = get_kds_routing_rules(&app.ctx(), "dev-tok").await.unwrap();
    assert_eq!(via_device.len(), 1);
    assert_eq!(via_device[0].matcher_value, "BURGER");
}

// ── Rule-aware resolve composition ──────────────────────────────

#[tokio::test]
async fn resolve_without_rules_is_zone_only() {
    // Equivalence at the bridge: the same ticket routes exactly as before
    // (only the Grill device — the zoneless COCKTAIL line contributes
    // nothing and claims no station).
    let conn = crate::testing::temp_conn();
    seed_owner(&conn);
    let app = scoped_pos_session(conn);
    seed_terminal_in_store(&app, "s1", "terminal-1");
    let order_id = seed_split_candidate_ticket(&app);

    let targets = resolve_kds_targets(&app.ctx(), "tok", &order_id)
        .await
        .unwrap();
    assert_eq!(targets.len(), 1, "empty rules = pure zone routing");
}

#[tokio::test]
async fn resolve_with_rule_splits_cocktail_line_to_bar_device() {
    // The work order's flagship over the real stack: a rule routes the
    // zoneless COCKTAIL line to the Bar station, so both devices get the
    // ticket without any catalog change.
    let conn = crate::testing::temp_conn();
    seed_owner(&conn);
    let app = scoped_pos_session(conn);
    seed_terminal_in_store(&app, "s1", "terminal-1");
    let order_id = seed_split_candidate_ticket(&app);

    save_kds_routing_rules(&app.ctx(), "tok", vec![sku_rule(1, "COCKTAIL", "bar")])
        .await
        .unwrap();

    let targets = resolve_kds_targets(&app.ctx(), "tok", &order_id)
        .await
        .unwrap();
    assert_eq!(
        targets.len(),
        2,
        "burger via zone -> Grill device, cocktail via rule -> Bar device"
    );
}

#[tokio::test]
async fn resolve_rule_station_unclaimed_still_hits_catch_all() {
    // A rule naming a station no device serves behaves like an unroutable
    // zone: phase-3 broadcast to every active device.
    let conn = crate::testing::temp_conn();
    seed_owner(&conn);
    let app = scoped_pos_session(conn);
    seed_terminal_in_store(&app, "s1", "terminal-1");
    let order_id = seed_split_candidate_ticket(&app);

    save_kds_routing_rules(
        &app.ctx(),
        "tok",
        vec![sku_rule(1, "BURGER", "station-ghost")],
    )
    .await
    .unwrap();

    let targets = resolve_kds_targets(&app.ctx(), "tok", &order_id)
        .await
        .unwrap();
    assert_eq!(
        targets.len(),
        2,
        "unclaimed rule station triggers catch-all"
    );
}
