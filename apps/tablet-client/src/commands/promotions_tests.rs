use super::*;

#[test]
fn create_promotion_args_deserialize_minimal() {
    let json = r#"{"name":"Summer Sale","promo_type":"percentage","value_minor":10}"#;
    let args: CreatePromotionArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.name, "Summer Sale");
    assert_eq!(args.promo_type, "percentage");
    assert_eq!(args.value_minor, 10);
    assert!(args.active);
    assert_eq!(args.min_order_minor, 0);
    assert_eq!(args.description, "");
}

#[test]
fn create_promotion_args_deserialize_all_fields() {
    let json = r#"{"name":"Flash Deal","description":"Limited time","promo_type":"fixed_amount","value_minor":500,"min_qty":2,"trigger_sku":"SKU-A","reward_sku":"SKU-B","reward_qty":1,"starts_at":"2026-01-01","ends_at":"2026-12-31","min_order_minor":5000,"category_id":"cat-1","active":true}"#;
    let args: CreatePromotionArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.name, "Flash Deal");
    assert_eq!(args.min_order_minor, 5000);
    assert_eq!(args.category_id.unwrap(), "cat-1");
}

#[test]
fn create_promotion_args_explicit_inactive() {
    let json = r#"{"name":"Draft","promo_type":"percentage","value_minor":5,"active":false}"#;
    let args: CreatePromotionArgs = serde_json::from_str(json).unwrap();
    assert!(!args.active);
}

#[test]
fn create_promotion_args_debug() {
    let args = CreatePromotionArgs {
        name: "Test".into(),
        description: "Desc".into(),
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
    };
    let debug = format!("{:?}", args);
    assert!(debug.contains("Test"));
}

// ── Scoped-write permission gates (T8) ────────────────────────────────
//
// Everything above this line is store- and DTO-level: none of it reaches a
// `#[command]`, which is why the four scoped promotion writes could demand a
// required `user_id: String` that the promotion wrappers in
// `ui/src/api/promotions.ts` never send (`{sessionToken, args}`, `{sessionToken, promotion}`,
// `{sessionToken, id}`, `{sessionToken, saleId, promotionId}`) without anything
// in the tree noticing. Tauri rejected all four at
// `tauri-2.11.3/src/ipc/command.rs:100` before their bodies ran, so the whole
// promotion write and apply surface was dead on this shell — the fourth
// occurrence of the pattern after settings, terminals and tables.
//
// The permission mapping is read off the preset, not guessed:
// `platform/core/src/rbac_presets.rs:136-159` gives Staff `discounts:apply` but
// **no `promotions:*` key at all**. So a cashier may discount a line at the
// register and may not create, edit, delete or *apply* a promotion. If that
// asymmetry is wrong as a matter of product intent, this is the test that will
// say so when it is fixed — and the denial half below is the one to change, not
// delete.
//
// Harness duplicated from `tables_tests.rs` for the same reason noted there.

use oz_core::session::SessionContext;
use platform_core::StoreDatabaseManager;
use tauri::Manager as _;

fn seed_identity(conn: &rusqlite::Connection) {
    Store::new(conn).seed_default_roles().unwrap();
    for (id, role) in [("user-owner", "role-owner"), ("user-cashier", "role-staff")] {
        conn.execute(
            "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active,
                                created_at, updated_at)
             VALUES (?1, ?1, 'hash', ?1, ?2, 1, '2026-07-31T00:00:00.000Z',
                     '2026-07-31T00:00:00.000Z')",
            rusqlite::params![id, role],
        )
        .unwrap();
    }
}

fn promotions_app(
    sessions: &[(&str, &str)],
) -> (tauri::App<tauri::test::MockRuntime>, tempfile::TempDir) {
    let conn = oz_core::migrations::fresh_db();
    seed_identity(&conn);
    let temp = tempfile::tempdir().unwrap();
    let mut state = AppState::for_test_with_conn(conn);
    state.db_manager =
        StoreDatabaseManager::new(temp.path().to_path_buf(), oz_core::migrations::ALL);
    for (token, user_id) in sessions {
        let role = if *user_id == "user-owner" {
            "role-owner"
        } else {
            "role-staff"
        };
        state.session_store.write().unwrap().insert(
            (*token).into(),
            SessionContext::new(
                (*user_id).into(),
                role.into(),
                "terminal-1".into(),
                "store-promotions".into(),
                "instance-1".into(),
                "pos".into(),
                None,
                0,
            ),
        );
    }
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();
    (app, temp)
}

fn create_args(name: &str) -> CreatePromotionArgs {
    CreatePromotionArgs {
        name: name.into(),
        description: String::new(),
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

/// All four scoped promotion writes refuse a Staff session, which holds no
/// `promotions:*` grant. The update case is driven with a Promotion the owner
/// really created, so the refusal is the gate and not a shape problem.
#[tokio::test]
async fn scoped_promotion_writes_deny_a_session_without_promotions_grants() {
    let (app, _temp) = promotions_app(&[
        ("cashier-token", "user-cashier"),
        ("owner-token", "user-owner"),
    ]);
    let created = create_promotion_scoped(
        "owner-token".into(),
        create_args("Owner Promo"),
        app.state(),
    )
    .await
    .expect("the owner can create a promotion to test against");

    assert!(matches!(
        create_promotion_scoped(
            "cashier-token".into(),
            create_args("Cashier Promo"),
            app.state()
        )
        .await,
        Err(AppError::PermissionDenied(_))
    ));
    assert!(matches!(
        update_promotion_scoped("cashier-token".into(), created, app.state()).await,
        Err(AppError::PermissionDenied(_))
    ));
    assert!(matches!(
        delete_promotion_scoped("cashier-token".into(), "p-missing".into(), app.state()).await,
        Err(AppError::PermissionDenied(_))
    ));
    assert!(matches!(
        apply_promotion_scoped(
            "cashier-token".into(),
            "sale-1".into(),
            "p-1".into(),
            app.state()
        )
        .await,
        Err(AppError::PermissionDenied(_))
    ));
}

/// The functional half: create, read back, edit, delete — every one of them
/// impossible on a tablet before this pass because the renderer does not send a
/// `userId`.
#[tokio::test]
async fn scoped_promotion_write_path_actually_writes_for_an_owner() {
    let (app, _temp) = promotions_app(&[("owner-token", "user-owner")]);

    let created = create_promotion_scoped(
        "owner-token".into(),
        create_args("Summer Sale"),
        app.state(),
    )
    .await
    .expect("create_promotion_scoped must succeed for an owner");
    assert_eq!(created.name, "Summer Sale");

    let fetched = get_promotion_scoped("owner-token".into(), created.id.clone(), app.state())
        .await
        .expect("get_promotion_scoped must succeed for an owner");
    assert!(
        fetched.is_some(),
        "the created promotion must be readable back"
    );

    let mut edited = created.clone();
    edited.name = "Autumn Sale".into();
    let updated = update_promotion_scoped("owner-token".into(), edited, app.state())
        .await
        .expect("update_promotion_scoped must succeed for an owner");
    assert_eq!(updated.name, "Autumn Sale");

    delete_promotion_scoped("owner-token".into(), created.id.clone(), app.state())
        .await
        .expect("delete_promotion_scoped must succeed for an owner");
    assert!(
        get_promotion_scoped("owner-token".into(), created.id, app.state())
            .await
            .expect("get after delete")
            .is_none(),
        "the delete must take effect in the store, not merely answer Ok"
    );
}
