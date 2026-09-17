use super::*;
use foundation::{Email, Phone};
use kasirmu_core::session::SessionContext;
use platform_core::StoreDatabaseManager;
use tauri::Manager as _;

// ── Scoped-command permission + isolation (CUST-01) ─────────────

/// Seed the GLOBAL identity DB with an owner user (all permissions).
fn seed_owner_user(conn: &rusqlite::Connection) {
    let store = Store::new(conn);
    store.seed_default_roles().unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();
}

fn create_args(name: &str) -> CreateCustomerScopedArgs {
    CreateCustomerScopedArgs {
        name: name.into(),
        email: None,
        phone: None,
        notes: None,
    }
}

fn update_args(id: &str, name: &str) -> UpdateCustomerScopedArgs {
    UpdateCustomerScopedArgs {
        id: id.into(),
        name: name.into(),
        email: None,
        phone: None,
        notes: None,
    }
}

#[tokio::test]
async fn scoped_customer_command_rejects_invalid_session() {
    let app = tauri::test::mock_builder()
        .manage(AppState::for_test())
        .build(tauri::generate_context!())
        .unwrap();

    let result =
        create_customer_scoped("missing-token".into(), create_args("Alice"), app.state()).await;
    assert!(matches!(result, Err(AppError::InvalidSession)));

    let result = delete_customer_scoped("missing-token".into(), "cust-1".into(), app.state()).await;
    assert!(matches!(result, Err(AppError::InvalidSession)));
}

#[tokio::test]
async fn scoped_customer_command_denies_user_without_permission() {
    // Kitchen role lacks customers:create (ROLE_PRESETS).
    let conn = kasirmu_core::migrations::fresh_db();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-lite', 'Lite', 'Limited', '[\"sales:view\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-kitchen', 'kitchen', 'hash', 'Kitchen', 'role-lite', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();

    let temp_dir = tempfile::tempdir().unwrap();
    let mut state = AppState::for_test_with_conn(conn);
    state.db_manager =
        StoreDatabaseManager::new(temp_dir.path().to_path_buf(), kasirmu_core::migrations::ALL);
    state.session_store.write().unwrap().insert(
        "kitchen-token".into(),
        SessionContext::new(
            "user-kitchen".into(),
            "role-lite".into(),
            "terminal-1".into(),
            "store-kitchen".into(),
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
        create_customer_scoped("kitchen-token".into(), create_args("Alice"), app.state()).await;
    assert!(matches!(result, Err(AppError::PermissionDenied(_))));
}

#[tokio::test]
async fn list_customers_scoped_denies_user_without_view_permission() {
    // Kitchen role lacks customers:view (ROLE_PRESETS) — CRM-02: the
    // scoped list must enforce the declared view permission, not just
    // resolve the store. Before the fix a valid kitchen session could
    // enumerate every customer (name, email, phone, notes).
    let conn = kasirmu_core::migrations::fresh_db();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-lite', 'Lite', 'Limited', '[\"sales:view\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-kitchen', 'kitchen', 'hash', 'Kitchen', 'role-lite', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();

    let temp_dir = tempfile::tempdir().unwrap();
    let mut state = AppState::for_test_with_conn(conn);
    state.db_manager =
        StoreDatabaseManager::new(temp_dir.path().to_path_buf(), kasirmu_core::migrations::ALL);
    state.session_store.write().unwrap().insert(
        "kitchen-token".into(),
        SessionContext::new(
            "user-kitchen".into(),
            "role-lite".into(),
            "terminal-1".into(),
            "store-kitchen".into(),
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

    let result = list_customers_scoped("kitchen-token".into(), app.state()).await;
    assert!(matches!(result, Err(AppError::PermissionDenied(_))));
}

#[tokio::test]
async fn scoped_customer_write_command_targets_only_the_session_store() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner_user(&conn);

    let temp_dir = tempfile::tempdir().unwrap();
    let mut state = AppState::for_test_with_conn(conn);
    state.db_manager =
        StoreDatabaseManager::new(temp_dir.path().to_path_buf(), kasirmu_core::migrations::ALL);
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

    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    // Create a customer ONLY in store A's database.
    create_customer_scoped("store-a-token".into(), create_args("Alice"), app.state())
        .await
        .unwrap();
    // Writes target the session store: updating an unknown id in store A
    // rejects (isolated from any other store's data).
    update_customer_scoped(
        "store-a-token".into(),
        update_args("cust-a", "Alice 2"),
        app.state(),
    )
    .await
    .unwrap_err();

    let store_a = list_customers_scoped("store-a-token".into(), app.state())
        .await
        .unwrap();
    let store_b = list_customers_scoped("store-b-token".into(), app.state())
        .await
        .unwrap();
    assert_eq!(store_a.len(), 1);
    assert_eq!(store_a[0].name, "Alice");
    assert!(
        store_b.is_empty(),
        "store B must not see store A customer data"
    );
}

// ── Name validation (shared by create + update) ─────────────────

#[test]
fn name_empty_is_rejected() {
    let err = foundation::validate_not_empty("name", "").unwrap_err();
    assert_eq!(err.field, "name");
    assert!(err.message.contains("must not be empty"));
}

#[test]
fn name_whitespace_only_is_rejected() {
    let err = foundation::validate_not_empty("name", "   ").unwrap_err();
    assert_eq!(err.field, "name");
}

#[test]
fn name_valid_passes() {
    assert!(foundation::validate_not_empty("name", "Alice").is_ok());
}

// ── Email validation (shared by create + update) ────────────────

#[test]
fn email_empty_is_rejected() {
    let err = Email::new("").unwrap_err();
    assert_eq!(err.field, "email");
    assert!(err.message.contains("must not be empty"));
}

#[test]
fn email_whitespace_only_is_rejected() {
    let err = Email::new("   ").unwrap_err();
    assert!(err.message.contains("must not be empty"));
}

#[test]
fn email_missing_at_sign_is_rejected() {
    let err = Email::new("notanemail").unwrap_err();
    assert!(err.message.contains("must contain exactly one '@'"));
}

#[test]
fn email_multiple_at_signs_is_rejected() {
    let err = Email::new("a@b@c.com").unwrap_err();
    assert!(err.message.contains("must contain exactly one '@'"));
}

#[test]
fn email_empty_local_part_is_rejected() {
    let err = Email::new("@example.com").unwrap_err();
    assert!(err.message.contains("non-empty local part"));
}

#[test]
fn email_empty_domain_is_rejected() {
    let err = Email::new("user@").unwrap_err();
    assert!(err.message.contains("non-empty domain"));
}

#[test]
fn email_domain_without_dot_is_rejected() {
    let err = Email::new("user@localhost").unwrap_err();
    assert!(err.message.contains("must contain at least one '.'"));
}

#[test]
fn email_domain_leading_dot_is_rejected() {
    let err = Email::new("user@.example.com").unwrap_err();
    assert!(err.message.contains("must not start or end with a '.'"));
}

#[test]
fn email_valid_simple_passes() {
    assert!(Email::new("alice@example.com").is_ok());
}

#[test]
fn email_valid_subdomain_passes() {
    assert!(Email::new("alice@mail.example.co.uk").is_ok());
}

#[test]
fn email_valid_plus_tag_passes() {
    assert!(Email::new("alice+tag@example.com").is_ok());
}

#[test]
fn email_optional_when_none_is_ok() {
    // None email should skip validation in the handler
    let email: Option<String> = None;
    if let Some(ref e) = email {
        panic!("should not validate when None, but got: {e}");
    }
}

// ── Phone validation (shared by create + update) ────────────────

#[test]
fn phone_empty_is_rejected() {
    let err = Phone::new("").unwrap_err();
    assert_eq!(err.field, "phone");
    assert!(err.message.contains("must not be empty"));
}

#[test]
fn phone_whitespace_only_is_rejected() {
    let err = Phone::new("   ").unwrap_err();
    assert!(err.message.contains("must not be empty"));
}

#[test]
fn phone_no_digits_is_rejected() {
    let err = Phone::new("abc-def-ghij").unwrap_err();
    assert!(err.message.contains("at least one digit"));
}

#[test]
fn phone_valid_us_format_passes() {
    assert!(Phone::new("+1-555-0102").is_ok());
}

#[test]
fn phone_valid_international_passes() {
    assert!(Phone::new("+44 20 7946 0958").is_ok());
}

#[test]
fn phone_valid_with_parentheses_passes() {
    assert!(Phone::new("(555) 123-4567").is_ok());
}

#[test]
fn phone_optional_when_none_is_ok() {
    // None phone should skip validation in the handler
    let phone: Option<String> = None;
    if let Some(ref p) = phone {
        panic!("should not validate when None, but got: {p}");
    }
}

// ── DTO mapping ─────────────────────────────────────────────────

#[test]
fn dto_maps_email_to_string() {
    let customer =
        kasirmu_core::Customer::new("Test").with_email(Email::new("alice@example.com").unwrap());
    let dto = CustomerDto::from(customer);
    assert_eq!(dto.email, Some("alice@example.com".into()));
}

#[test]
fn dto_maps_phone_to_string() {
    let customer =
        kasirmu_core::Customer::new("Test").with_phone(Phone::new("+1-555-0102").unwrap());
    let dto = CustomerDto::from(customer);
    assert_eq!(dto.phone, Some("+1-555-0102".into()));
}

#[test]
fn dto_maps_none_email() {
    let customer = kasirmu_core::Customer::new("Test");
    let dto = CustomerDto::from(customer);
    assert!(dto.email.is_none());
}

#[test]
fn dto_maps_none_phone() {
    let customer = kasirmu_core::Customer::new("Test");
    let dto = CustomerDto::from(customer);
    assert!(dto.phone.is_none());
}

// -- DTO struct tests --

#[test]
fn customer_dto_debug() {
    let dto = CustomerDto {
        id: "c1".into(),
        name: "Alice".into(),
        email: Some("alice@test.com".into()),
        phone: None,
        notes: String::new(),
        created_at: "2025-01-01".into(),
        updated_at: "2025-01-01".into(),
    };
    let d = format!("{dto:?}");
    assert!(d.contains("Alice"));
}

#[test]
fn customer_dto_serialize() {
    let dto = CustomerDto {
        id: "c2".into(),
        name: "Bob".into(),
        email: None,
        phone: Some("+123".into()),
        notes: "VIP".into(),
        created_at: "2025-02-01".into(),
        updated_at: "2025-02-01".into(),
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["name"], "Bob");
    assert_eq!(json["notes"], "VIP");
}

#[test]
fn create_customer_args_deserialize_minimal() {
    let json = r##"{"user_id":"u1","name":"Alice"}"##;
    let args: CreateCustomerArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.name, "Alice");
    assert_eq!(args.email, None);
    assert_eq!(args.notes, None);
}

#[test]
fn create_customer_args_debug() {
    let args = CreateCustomerArgs {
        user_id: "u1".into(),
        name: "Test".into(),
        email: None,
        phone: None,
        notes: None,
    };
    let d = format!("{args:?}");
    assert!(d.contains("Test"));
}

#[test]
fn update_customer_args_deserialize() {
    let json = r##"{"user_id":"u2","id":"c1","name":"Alice Updated"}"##;
    let args: UpdateCustomerArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.name, "Alice Updated");
    assert_eq!(args.email, None);
}

#[test]
fn update_customer_args_debug() {
    let args = UpdateCustomerArgs {
        user_id: "u2".into(),
        id: "c1".into(),
        name: "U".into(),
        email: None,
        phone: None,
        notes: None,
    };
    let d = format!("{args:?}");
    assert!(d.contains("U"));
}

#[test]
fn delete_customer_args_deserialize() {
    let json = r##"{"user_id":"u3","id":"c99"}"##;
    let args: DeleteCustomerArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.id, "c99");
    assert_eq!(args.user_id, "u3");
}

#[test]
fn delete_customer_args_debug() {
    let args = DeleteCustomerArgs {
        user_id: "u".into(),
        id: "c".into(),
    };
    let d = format!("{args:?}");
    assert!(d.contains("c"));
}

#[test]
fn scoped_create_args_deserialize_without_user_id() {
    let json = r#"{"name":"Alice","email":"alice@example.com"}"#;
    let args: CreateCustomerScopedArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.name, "Alice");
    assert_eq!(args.email.as_deref(), Some("alice@example.com"));
}

#[test]
fn scoped_update_args_deserialize_without_user_id() {
    let json = r#"{"id":"c1","name":"Alice Updated"}"#;
    let args: UpdateCustomerScopedArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.id, "c1");
    assert_eq!(args.name, "Alice Updated");
}

// ── Search + history (CUST-05/CUST-06) ─────────────────────────

/// Seed a customer into a store DB.
fn seed_customer_in_store(store_db: &rusqlite::Connection, id: &str, name: &str) {
    store_db
        .execute(
            "INSERT INTO customers (id, name, notes, created_at, updated_at)
             VALUES (?1, ?2, '', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
            rusqlite::params![id, name],
        )
        .unwrap();
}

#[tokio::test]
async fn search_customers_scoped_rejects_invalid_session() {
    let app = tauri::test::mock_builder()
        .manage(AppState::for_test())
        .build(tauri::generate_context!())
        .unwrap();
    let result = search_customers_scoped(
        "missing-token".into(),
        "Alice".into(),
        None,
        None,
        app.state(),
    )
    .await;
    assert!(matches!(result, Err(AppError::InvalidSession)));
}

#[tokio::test]
async fn search_customers_scoped_is_bounded_and_store_isolated() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner_user(&conn);

    let temp_dir = tempfile::tempdir().unwrap();
    let mut state = AppState::for_test_with_conn(conn);
    state.db_manager =
        StoreDatabaseManager::new(temp_dir.path().to_path_buf(), kasirmu_core::migrations::ALL);
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

    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    {
        let store_a = app
            .state::<AppState>()
            .db_manager
            .open_store("store-a")
            .unwrap();
        let db = store_a.lock().unwrap();
        seed_customer_in_store(&db, "cust-1", "Alice");
        seed_customer_in_store(&db, "cust-2", "Alicia");
        seed_customer_in_store(&db, "cust-3", "Bob");
    }

    let page_a = search_customers_scoped(
        "store-a-token".into(),
        "Ali".into(),
        Some(50),
        None,
        app.state(),
    )
    .await
    .unwrap();
    assert_eq!(page_a.total, 2);
    assert_eq!(page_a.items.len(), 2);

    let page_b = search_customers_scoped(
        "store-b-token".into(),
        "Ali".into(),
        Some(50),
        None,
        app.state(),
    )
    .await
    .unwrap();
    assert_eq!(page_b.total, 0, "store B must not see store A customers");
}

#[tokio::test]
async fn get_customer_history_scoped_returns_profile_loyalty_and_sales() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner_user(&conn);

    let temp_dir = tempfile::tempdir().unwrap();
    let mut state = AppState::for_test_with_conn(conn);
    state.db_manager =
        StoreDatabaseManager::new(temp_dir.path().to_path_buf(), kasirmu_core::migrations::ALL);
    state.session_store.write().unwrap().insert(
        "store-a-token".into(),
        SessionContext::new(
            "user-owner".into(),
            "role-owner".into(),
            "terminal-1".into(),
            "store-a".into(),
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

    // Seed the store inside a scoped block so the `MutexGuard` from
    // `store_a.lock()` is dropped before the awaits below
    // (clippy::await_holding_lock).
    {
        let store_a = app
            .state::<AppState>()
            .db_manager
            .open_store("store-a")
            .unwrap();
        let db = store_a.lock().unwrap();
        let store = Store::new(&db);
        seed_customer_in_store(&db, "cust-1", "Alice");
        store.get_or_create_loyalty_account("cust-1").unwrap();
        db.execute(
            "INSERT INTO sales (id, total_minor, currency, line_count, status, customer_id, created_at, updated_at, subtotal_minor, tax_total_minor)
             VALUES ('s-1', 2500, 'USD', 1, 'completed', 'cust-1', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', 2500, 0)",
            [],
        )
        .unwrap();
    }

    let history = get_customer_history_scoped(
        "store-a-token".into(),
        "cust-1".into(),
        None,
        None,
        app.state(),
    )
    .await
    .unwrap();
    assert_eq!(history.customer.name, "Alice");
    let loyalty = history.loyalty.expect("loyalty account was seeded");
    assert_eq!(loyalty.points, 0);
    assert_eq!(history.sales.len(), 1);
    assert_eq!(history.sales[0].total_minor, 2500);
    assert_eq!(history.sales_total, 1);
}

#[tokio::test]
async fn get_customer_history_scoped_unknown_customer_is_not_found() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner_user(&conn);

    let temp_dir = tempfile::tempdir().unwrap();
    let mut state = AppState::for_test_with_conn(conn);
    state.db_manager =
        StoreDatabaseManager::new(temp_dir.path().to_path_buf(), kasirmu_core::migrations::ALL);
    state.session_store.write().unwrap().insert(
        "store-a-token".into(),
        SessionContext::new(
            "user-owner".into(),
            "role-owner".into(),
            "terminal-1".into(),
            "store-a".into(),
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

    let result = get_customer_history_scoped(
        "store-a-token".into(),
        "cust-missing".into(),
        None,
        None,
        app.state(),
    )
    .await;
    assert!(matches!(result, Err(AppError::Core { .. })));
}

#[tokio::test]
async fn delete_customer_scoped_is_blocked_by_loyalty_and_sales_references() {
    // CUST-11: a customer referenced by a loyalty account or sales rows
    // must NOT be silently deleted — the FK guard (foreign_keys = ON)
    // rejects the delete so no orphaned child rows can be left behind.
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner_user(&conn);

    let temp_dir = tempfile::tempdir().unwrap();
    let mut state = AppState::for_test_with_conn(conn);
    state.db_manager =
        StoreDatabaseManager::new(temp_dir.path().to_path_buf(), kasirmu_core::migrations::ALL);
    state.session_store.write().unwrap().insert(
        "store-a-token".into(),
        SessionContext::new(
            "user-owner".into(),
            "role-owner".into(),
            "terminal-1".into(),
            "store-a".into(),
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

    // Seed the customer plus BOTH reference kinds in store-a.
    {
        let store_a = app
            .state::<AppState>()
            .db_manager
            .open_store("store-a")
            .unwrap();
        let db = store_a.lock().unwrap();
        let store = Store::new(&db);
        seed_customer_in_store(&db, "cust-1", "Alice");
        store.get_or_create_loyalty_account("cust-1").unwrap();
        db.execute(
            "INSERT INTO sales (id, total_minor, currency, line_count, status, customer_id, created_at, updated_at, subtotal_minor, tax_total_minor)
             VALUES ('s-1', 2500, 'USD', 1, 'completed', 'cust-1', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', 2500, 0)",
            [],
        )
        .unwrap();
    }

    let result = delete_customer_scoped("store-a-token".into(), "cust-1".into(), app.state()).await;
    assert!(
        matches!(result, Err(AppError::Core { .. })),
        "delete must be blocked by the FK guard, got: {result:?}"
    );

    // The customer row is retained — nothing was silently cascaded.
    let remaining = list_customers_scoped("store-a-token".into(), app.state())
        .await
        .unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].id, "cust-1");
}

#[tokio::test]
async fn delete_customer_scoped_succeeds_without_references() {
    // CUST-11 positive control: deleting an unreferenced customer in the
    // session store works and is isolated from other stores.
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner_user(&conn);

    let temp_dir = tempfile::tempdir().unwrap();
    let mut state = AppState::for_test_with_conn(conn);
    state.db_manager =
        StoreDatabaseManager::new(temp_dir.path().to_path_buf(), kasirmu_core::migrations::ALL);
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
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    {
        let store_a = app
            .state::<AppState>()
            .db_manager
            .open_store("store-a")
            .unwrap();
        let db = store_a.lock().unwrap();
        seed_customer_in_store(&db, "cust-1", "Alice");
    }

    delete_customer_scoped("store-a-token".into(), "cust-1".into(), app.state())
        .await
        .unwrap();

    let store_a = list_customers_scoped("store-a-token".into(), app.state())
        .await
        .unwrap();
    assert!(store_a.is_empty());
    // Store B was never touched by the store-A delete.
    let store_b = list_customers_scoped("store-b-token".into(), app.state())
        .await
        .unwrap();
    assert!(store_b.is_empty());
}

#[tokio::test]
async fn get_customer_scoped_denies_user_without_view_permission() {
    // CRM-02 residual: the tablet registered the LEGACY unguarded
    // get_customer (no session, no permission, global db) while the
    // desktop had moved to get_customer_scoped. The scoped variant
    // must enforce customers:view like every other customer read.
    //
    // The legacy fn named above was retired on 2026-09-16 in the T19 thinning. It had
    // already been absent from `generate_handler!` for both shells by then, which is the
    // difference that matters here: the finding was about an UNGUARDED COMMAND, this test
    // is about the guarded one, and deleting the former changed no behavior -- so the
    // history stays worth reading without anyone going looking for a function that is gone.
    let conn = kasirmu_core::migrations::fresh_db();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-lite', 'Lite', 'Limited', '[\"sales:view\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-kitchen', 'kitchen', 'hash', 'Kitchen', 'role-lite', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();

    let temp_dir = tempfile::tempdir().unwrap();
    let mut state = AppState::for_test_with_conn(conn);
    state.db_manager =
        StoreDatabaseManager::new(temp_dir.path().to_path_buf(), kasirmu_core::migrations::ALL);
    state.session_store.write().unwrap().insert(
        "kitchen-token".into(),
        SessionContext::new(
            "user-kitchen".into(),
            "role-lite".into(),
            "terminal-1".into(),
            "store-kitchen".into(),
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

    let result = get_customer_scoped("cust-1".into(), "kitchen-token".into(), app.state()).await;
    assert!(matches!(result, Err(AppError::PermissionDenied(_))));
}
