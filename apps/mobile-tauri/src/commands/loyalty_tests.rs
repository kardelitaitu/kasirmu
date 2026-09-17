use super::*;
use kasirmu_core::db::Store;
use kasirmu_core::permissions;
use kasirmu_core::session::SessionContext;
use platform_core::StoreDatabaseManager;
use tauri::Manager as _;

fn sample_txn() -> LoyaltyTransaction {
    LoyaltyTransaction {
        id: "txn-1".into(),
        account_id: "acct-1".into(),
        sale_id: Some("sale-1".into()),
        points: -100,
        txn_type: "redeem".into(),
        description: "Redeemed 100 points".into(),
        created_at: "2025-01-01T00:00:00.000Z".into(),
    }
}

#[test]
fn redeem_result_debug() {
    let result = RedeemResult {
        transaction: sample_txn(),
        discount_minor: 100,
    };
    let debug = format!("{result:?}");
    assert!(debug.contains("redeem"));
    assert!(debug.contains("100"));
}

#[test]
fn redeem_result_serialize() {
    let result = RedeemResult {
        transaction: sample_txn(),
        discount_minor: 50,
    };
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["discount_minor"], 50);
    assert_eq!(json["transaction"]["txn_type"], "redeem");
    assert_eq!(json["transaction"]["points"], -100);
}

#[test]
fn redeem_result_zero_discount() {
    let result = RedeemResult {
        transaction: sample_txn(),
        discount_minor: 0,
    };
    assert_eq!(result.discount_minor, 0);
}

#[tokio::test]
async fn permission_check_uses_global_identity_db() {
    let conn = kasirmu_core::migrations::fresh_db();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-lite', 'Lite', 'Limited loyalty view', '[\"loyalty:view\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-cashier', 'cashier', 'hash', 'Cashier', 'role-lite', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
    let state = AppState::for_test_with_conn(conn);

    assert!(
        require_loyalty_permission(&state, "user-cashier", permissions::LOYALTY_VIEW)
            .await
            .is_ok()
    );
    assert!(matches!(
        require_loyalty_permission(&state, "user-cashier", permissions::LOYALTY_MANAGE).await,
        Err(AppError::PermissionDenied(_))
    ));
}

#[tokio::test]
async fn permission_check_rejects_missing_user() {
    let conn = kasirmu_core::migrations::fresh_db();
    let state = AppState::for_test_with_conn(conn);

    assert!(matches!(
        require_loyalty_permission(&state, "missing-user", permissions::LOYALTY_VIEW).await,
        Err(AppError::PermissionDenied(_))
    ));
}

#[tokio::test]
async fn scoped_command_rejects_invalid_session() {
    let app = tauri::test::mock_builder()
        .manage(AppState::for_test())
        .build(tauri::generate_context!())
        .unwrap();

    let result = list_loyalty_accounts_scoped("missing-token".into(), app.state()).await;
    assert!(matches!(result, Err(AppError::InvalidSession)));
}

#[tokio::test]
async fn scoped_command_denies_user_without_loyalty_permission() {
    let conn = kasirmu_core::migrations::fresh_db();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-cashier', 'cashier', 'hash', 'Cashier', 'role-custom', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();

    let temp_dir = std::env::temp_dir().join(format!(
        "kasirmu-mobile-loyalty-test-{}",
        uuid::Uuid::now_v7()
    ));
    let mut state = AppState::for_test_with_conn(conn);
    state.db_manager = StoreDatabaseManager::new(temp_dir.clone(), kasirmu_core::migrations::ALL);
    state.session_store.write().unwrap().insert(
        "cashier-token".into(),
        SessionContext::new(
            "user-cashier".into(),
            "role-owner".into(),
            "terminal-1".into(),
            "store-cashier".into(),
            "instance-1".into(),
            "pos".into(),
            None,
            0,
        ),
    );
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let result = list_loyalty_accounts_scoped("cashier-token".into(), app.state()).await;
    assert!(matches!(result, Err(AppError::PermissionDenied(_))));
}

#[tokio::test]
async fn scoped_command_reads_only_the_session_store() {
    let conn = kasirmu_core::migrations::fresh_db();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();

    let temp_dir = std::env::temp_dir().join(format!(
        "kasirmu-mobile-loyalty-test-{}",
        uuid::Uuid::now_v7()
    ));
    let mut state = AppState::for_test_with_conn(conn);
    state.db_manager = StoreDatabaseManager::new(temp_dir.clone(), kasirmu_core::migrations::ALL);
    for (token, store_id) in [("store-a-token", "store-a"), ("store-b-token", "store-b")] {
        state.session_store.write().unwrap().insert(
            token.into(),
            SessionContext::new(
                "user-owner".into(),
                "role-owner".into(),
                "terminal-1".into(),
                store_id.into(),
                "instance-1".into(),
                "pos".into(),
                None,
                0,
            ),
        );
    }

    {
        let store_a_conn = state.db_manager.open_store("store-a").unwrap();
        let store_a_db = store_a_conn.lock().unwrap();
        store_a_db
            .execute(
                "INSERT INTO customers (id, name) VALUES ('customer-a', 'Store A Customer')",
                [],
            )
            .unwrap();
        Store::new(&store_a_db)
            .get_or_create_loyalty_account("customer-a")
            .unwrap();
    }

    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let store_a_accounts = list_loyalty_accounts_scoped("store-a-token".into(), app.state())
        .await
        .unwrap();
    let store_b_accounts = list_loyalty_accounts_scoped("store-b-token".into(), app.state())
        .await
        .unwrap();
    assert_eq!(store_a_accounts.len(), 1);
    assert_eq!(store_a_accounts[0].account.customer_id, "customer-a");
    assert!(
        store_b_accounts.is_empty(),
        "store B must not see store A loyalty data"
    );
    drop(app);
    let _ = std::fs::remove_dir_all(temp_dir);
}
