use super::*;
use crate::testing::TestBridge;
use kasirmu_core::session::SessionContext;

// ── Existing deserialization tests (preserved) ────────────────────

#[test]
fn create_promotion_args_deserialize_minimal() {
    let json = r#"{"name":"10% Off","promo_type":"percentage","value_minor":10}"#;
    let args: CreatePromotionArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.name, "10% Off");
    assert_eq!(args.description, "");
    assert_eq!(args.promo_type, "percentage");
    assert_eq!(args.value_minor, 10);
    assert!(args.min_qty.is_none());
    assert!(args.trigger_sku.is_none());
    assert!(args.reward_sku.is_none());
    assert!(args.reward_qty.is_none());
    assert!(args.starts_at.is_none());
    assert!(args.ends_at.is_none());
    assert_eq!(args.min_order_minor, 0);
    assert!(args.category_id.is_none());
    assert!(args.active);
}

#[test]
fn create_promotion_args_deserialize_all_fields() {
    let json = r#"{
        "name": "Buy 2 Get 1",
        "description": "Buy two coffees, get one free",
        "promo_type": "buy_x_get_y",
        "value_minor": 100,
        "min_qty": 2,
        "trigger_sku": "COFFEE",
        "reward_sku": "COFFEE",
        "reward_qty": 1,
        "starts_at": "2026-01-01T00:00:00.000Z",
        "ends_at": "2026-12-31T23:59:59.000Z",
        "min_order_minor": 1000,
        "category_id": "cat-drinks",
        "active": true
    }"#;
    let args: CreatePromotionArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.name, "Buy 2 Get 1");
    assert_eq!(args.description, "Buy two coffees, get one free");
    assert_eq!(args.promo_type, "buy_x_get_y");
    assert_eq!(args.value_minor, 100);
    assert_eq!(args.min_qty, Some(2));
    assert_eq!(args.trigger_sku.as_deref(), Some("COFFEE"));
    assert_eq!(args.reward_sku.as_deref(), Some("COFFEE"));
    assert_eq!(args.reward_qty, Some(1));
    assert_eq!(args.min_order_minor, 1000);
    assert_eq!(args.category_id.as_deref(), Some("cat-drinks"));
    assert!(args.active);
}

#[test]
fn create_promotion_args_active_defaults_true() {
    let json = r#"{"name":"test","promo_type":"fixed_amount","value_minor":500}"#;
    let args: CreatePromotionArgs = serde_json::from_str(json).unwrap();
    assert!(args.active, "active should default to true");
}

#[test]
fn create_promotion_args_explicit_inactive() {
    let json =
        r#"{"name":"Disabled Promo","promo_type":"percentage","value_minor":5,"active":false}"#;
    let args: CreatePromotionArgs = serde_json::from_str(json).unwrap();
    assert!(!args.active);
}

#[test]
fn create_promotion_args_debug() {
    let args = CreatePromotionArgs {
        name: "Flash Sale".into(),
        description: "Limited time".into(),
        promo_type: "percentage".into(),
        value_minor: 20,
        min_qty: None,
        trigger_sku: None,
        reward_sku: None,
        reward_qty: None,
        starts_at: Some("2026-07-01T00:00:00.000Z".into()),
        ends_at: Some("2026-07-07T23:59:59.000Z".into()),
        min_order_minor: 0,
        category_id: None,
        active: true,
    };
    let debug = format!("{args:?}");
    assert!(debug.contains("Flash Sale"));
    assert!(debug.contains("percentage"));
    assert!(debug.contains("2026-07-01"));
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

fn seed_staff(conn: &rusqlite::Connection) {
    let store = Store::new(conn);
    store.seed_default_roles().unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-staff', 'staff', 'hash', 'Staff', 'role-staff', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
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
) -> TestBridge {
    let bridge = TestBridge::new().with_conn(conn);
    bridge.sessions().write().unwrap().insert(
        token.into(),
        SessionContext::new(
            user_id.into(),
            role_id.into(),
            "terminal-1".into(),
            store_id.into(),
            "instance-1".into(),
            "pos".into(),
            None,
            0,
        ),
    );
    bridge
}

fn make_promo_args(name: &str) -> CreatePromotionArgs {
    CreatePromotionArgs {
        name: name.into(),
        description: format!("Test promotion: {name}"),
        promo_type: "percentage".into(),
        value_minor: 10,
        min_qty: None,
        trigger_sku: None,
        reward_sku: None,
        reward_qty: None,
        starts_at: None,
        ends_at: None,
        min_order_minor: 0,
        category_id: None,
        active: true,
    }
}

// ── Session validation ────────────────────────────────────────────

#[tokio::test]
async fn scoped_list_promotions_rejects_invalid_token() {
    let conn = kasirmu_core::migrations::fresh_db();
    let bridge = scoped_state(conn, "tok", "user-owner", "role-owner", "s1");

    let result = list_promotions_scoped(&bridge.ctx(), "bad-token").await;
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

// ── Permission matrix: owner has PROMOTIONS_CREATE/EDIT/DELETE ────

#[tokio::test]
async fn owner_can_create_promotion() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    let bridge = scoped_state(conn, "tok", "user-owner", "role-owner", "s1");

    let result = create_promotion_scoped(&bridge.ctx(), "tok", &make_promo_args("10% Off")).await;
    assert!(result.is_ok(), "owner should create a promotion");
    let p = result.unwrap();
    assert_eq!(p.name, "10% Off");
    assert!(!p.id.is_empty());
}

#[tokio::test]
async fn owner_can_list_promotions() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    let bridge = scoped_state(conn, "tok", "user-owner", "role-owner", "s1");

    create_promotion_scoped(&bridge.ctx(), "tok", &make_promo_args("Promo A"))
        .await
        .unwrap();
    create_promotion_scoped(&bridge.ctx(), "tok", &make_promo_args("Promo B"))
        .await
        .unwrap();

    let list = list_promotions_scoped(&bridge.ctx(), "tok").await.unwrap();
    assert_eq!(list.len(), 2);
    assert!(list.iter().any(|p| p.name == "Promo A"));
    assert!(list.iter().any(|p| p.name == "Promo B"));
}

#[tokio::test]
async fn owner_can_get_promotion_by_id() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    let bridge = scoped_state(conn, "tok", "user-owner", "role-owner", "s1");

    let created = create_promotion_scoped(&bridge.ctx(), "tok", &make_promo_args("Promo"))
        .await
        .unwrap();
    let fetched = get_promotion_scoped(&bridge.ctx(), "tok", &created.id).await;
    assert!(fetched.is_ok());
    assert!(fetched.unwrap().is_some());
}

#[tokio::test]
async fn owner_can_update_promotion() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    let bridge = scoped_state(conn, "tok", "user-owner", "role-owner", "s1");

    let mut created = create_promotion_scoped(&bridge.ctx(), "tok", &make_promo_args("Old Name"))
        .await
        .unwrap();
    created.name = "New Name".into();
    let result = update_promotion_scoped(&bridge.ctx(), "tok", created).await;
    assert!(result.is_ok(), "owner should update a promotion");
    assert_eq!(result.unwrap().name, "New Name");
}

#[tokio::test]
async fn owner_can_delete_promotion() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    let bridge = scoped_state(conn, "tok", "user-owner", "role-owner", "s1");

    let created = create_promotion_scoped(&bridge.ctx(), "tok", &make_promo_args("Delete Me"))
        .await
        .unwrap();
    let result = delete_promotion_scoped(&bridge.ctx(), "tok", &created.id).await;
    assert!(result.is_ok(), "owner should delete a promotion");

    let fetched = get_promotion_scoped(&bridge.ctx(), "tok", &created.id)
        .await
        .unwrap();
    assert!(fetched.is_none(), "deleted promotion should not exist");
}

// ── Permission matrix: staff (no PROMOTIONS_* permissions) ────────

#[tokio::test]
async fn staff_denied_create_promotion() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_staff(&conn);
    let bridge = scoped_state(conn, "tok", "user-staff", "role-staff", "s1");

    let result =
        create_promotion_scoped(&bridge.ctx(), "tok", &make_promo_args("Staff Promo")).await;
    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

#[tokio::test]
async fn staff_can_list_promotions() {
    // list_promotions_scoped has no permission gate — it's a read-only
    // endpoint that only requires a valid session.
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    seed_staff(&conn);
    let bridge = scoped_state(conn, "tok", "user-staff", "role-staff", "s1");

    let result = list_promotions_scoped(&bridge.ctx(), "tok").await;
    assert!(
        result.is_ok(),
        "read-only list should be accessible to staff"
    );
    assert!(result.unwrap().is_empty());
}

#[tokio::test]
async fn staff_denied_delete_promotion() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    seed_staff(&conn);
    let bridge = scoped_state(conn, "owner-tok", "user-owner", "role-owner", "s1");
    bridge.sessions().write().unwrap().insert(
        "staff-tok".into(),
        SessionContext::new(
            "user-staff".into(),
            "role-staff".into(),
            "terminal-1".into(),
            "s1".into(),
            "instance-1".into(),
            "pos".into(),
            None,
            0,
        ),
    );

    let result = delete_promotion_scoped(&bridge.ctx(), "staff-tok", "nonexistent").await;
    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

// ── Edge cases ────────────────────────────────────────────────────

#[tokio::test]
async fn list_promotions_empty_when_none() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    let bridge = scoped_state(conn, "tok", "user-owner", "role-owner", "s1");

    let list = list_promotions_scoped(&bridge.ctx(), "tok").await.unwrap();
    assert!(list.is_empty());
}

#[tokio::test]
async fn get_promotion_returns_none_for_unknown() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    let bridge = scoped_state(conn, "tok", "user-owner", "role-owner", "s1");

    let result = get_promotion_scoped(&bridge.ctx(), "tok", "nonexistent-id")
        .await
        .unwrap();
    assert!(result.is_none());
}
