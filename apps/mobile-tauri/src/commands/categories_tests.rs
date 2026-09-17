use super::*;
use kasirmu_core::session::SessionContext;
use platform_core::StoreDatabaseManager;
use tauri::Manager as _;

#[test]
fn category_dto_debug() {
    let dto = CategoryDto {
        id: "cat-1".into(),
        name: "Drinks".into(),
        colour: "#06b6d4".into(),
        icon: "coffee".into(),
    };
    let debug = format!("{:?}", dto);
    assert!(debug.contains("Drinks"));
}

#[test]
fn category_dto_serialize() {
    let dto = CategoryDto {
        id: "cat-1".into(),
        name: "Food".into(),
        colour: "#ff0000".into(),
        icon: "utensils".into(),
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["id"], "cat-1");
    assert_eq!(json["name"], "Food");
    assert_eq!(json["colour"], "#ff0000");
}

#[test]
fn create_category_args_deserialize() {
    let json = r##"{"id":"cat-bakery","name":"Bakery","colour":"#f59e0b","icon":"croissant"}"##;
    let args: CreateCategoryArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.id, "cat-bakery");
    assert_eq!(args.name, "Bakery");
}

#[test]
fn create_category_args_debug() {
    let args = CreateCategoryArgs {
        id: "cat-test".into(),
        name: "Test".into(),
        colour: "#000".into(),
        icon: "test".into(),
    };
    let debug = format!("{:?}", args);
    assert!(debug.contains("cat-test"));
}

#[test]
fn create_category_result_debug_and_serialize() {
    let result = CreateCategoryResult {
        id: "cat-99".into(),
    };
    let debug = format!("{:?}", result);
    assert!(debug.contains("cat-99"));
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["id"], "cat-99");
}

// ── Scoped-command permission + isolation (CAT-01) ─────────────────

fn create_args(id: &str) -> CreateCategoryArgs {
    CreateCategoryArgs {
        id: id.into(),
        name: format!("Category {id}"),
        colour: "#06b6d4".into(),
        icon: "coffee".into(),
    }
}

#[tokio::test]
async fn scoped_category_command_rejects_invalid_session() {
    let app = tauri::test::mock_builder()
        .manage(AppState::for_test())
        .build(tauri::generate_context!())
        .unwrap();

    let result =
        create_category_scoped("missing-token".into(), create_args("c"), app.state()).await;
    assert!(matches!(result, Err(AppError::InvalidSession)));
}

#[tokio::test]
async fn scoped_category_command_denies_user_without_permission() {
    // Cashier role lacks products:create/update/delete (ROLE_PRESETS).
    let conn = kasirmu_core::migrations::fresh_db();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-lite', 'Lite', 'Limited', '[\"sales:view\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-cashier', 'cashier', 'hash', 'Cashier', 'role-lite', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();

    let temp_dir = tempfile::tempdir().unwrap();
    let mut state = AppState::for_test_with_conn(conn);
    state.db_manager =
        StoreDatabaseManager::new(temp_dir.path().to_path_buf(), kasirmu_core::migrations::ALL);
    state.session_store.write().unwrap().insert(
        "cashier-token".into(),
        SessionContext::new(
            "user-cashier".into(),
            "role-lite".into(),
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

    let result =
        create_category_scoped("cashier-token".into(), create_args("c"), app.state()).await;
    assert!(matches!(result, Err(AppError::PermissionDenied(_))));
}
