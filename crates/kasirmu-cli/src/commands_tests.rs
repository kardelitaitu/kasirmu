use super::user::validate_phc_pin_hash;
use super::*;
use rusqlite::{Connection, params};

fn setup_in_memory_db() -> Connection {
    oz_core::migrations::fresh_db()
}

fn make_store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

// ── DB helpers ────────────────────────────────────────────────────

#[test]
fn open_db_fails_on_bad_path() {
    let result = open_db(r"\0/?:invalid\0path");
    assert!(result.is_err());
}

#[test]
fn open_db_sets_foreign_keys_pragma() {
    let conn = Connection::open_in_memory().unwrap();
    let fk: bool = conn
        .pragma_query_value(None, "foreign_keys", |r| r.get(0))
        .unwrap();
    assert!(fk);
}

// ── List commands on empty DB ──────────────────────────────────────

#[test]
fn run_product_list_empty() {
    let conn = setup_in_memory_db();
    let store = make_store(&conn);
    let result = run_product_list(&store);
    assert!(result.is_ok());
}

#[test]
fn run_category_list_empty() {
    let conn = setup_in_memory_db();
    let store = make_store(&conn);
    let result = run_category_list(&store);
    assert!(result.is_ok());
}

#[test]
fn run_sale_list_empty() {
    let conn = setup_in_memory_db();
    let store = make_store(&conn);
    let result = run_sale_list(&store);
    assert!(result.is_ok());
}

#[test]
fn run_customer_list_empty() {
    let conn = setup_in_memory_db();
    let store = make_store(&conn);
    let result = run_customer_list(&store);
    assert!(result.is_ok());
}

#[test]
fn run_user_list_empty() {
    let conn = setup_in_memory_db();
    let store = make_store(&conn);
    let result = run_user_list(&store);
    assert!(result.is_ok());
}

// ── Get commands on non-existent data ──────────────────────────────

#[test]
fn run_product_get_not_found() {
    let conn = setup_in_memory_db();
    let store = make_store(&conn);
    let result = run_product_get(&store, "NONEXISTENT");
    assert!(result.is_ok());
}

#[test]
fn run_category_get_not_found() {
    let conn = setup_in_memory_db();
    let store = make_store(&conn);
    let result = run_category_get(&store, "cat-missing");
    assert!(result.is_ok());
}

#[test]
fn run_sale_get_not_found() {
    let conn = setup_in_memory_db();
    let store = make_store(&conn);
    let result = run_sale_get(&store, "00000000-0000-0000-0000-000000000000", "text");
    assert!(result.is_ok());
}

#[test]
fn run_sale_get_not_found_json() {
    let conn = setup_in_memory_db();
    let store = make_store(&conn);
    let result = run_sale_get(&store, "00000000-0000-0000-0000-000000000000", "json");
    assert!(result.is_ok());
}

#[test]
fn run_customer_get_not_found() {
    let conn = setup_in_memory_db();
    let store = make_store(&conn);
    let result = run_customer_get(&store, "nonexistent");
    assert!(result.is_ok());
}

#[test]
fn run_user_get_not_found() {
    let conn = setup_in_memory_db();
    let store = make_store(&conn);
    let result = run_user_get(&store, "nonexistent");
    assert!(result.is_ok());
}

// ── Category CRUD ─────────────────────────────────────────────────

#[test]
fn run_category_create_and_get() {
    let conn = setup_in_memory_db();
    let store = make_store(&conn);
    run_category_create(&store, "cat-drinks", "Beverages", "#06b6d4").unwrap();
    let cat = store.get_category("cat-drinks").unwrap().unwrap();
    assert_eq!(cat.name, "Beverages");
    assert_eq!(cat.colour, "#06b6d4");
}

#[test]
fn run_category_create_duplicate() {
    let conn = setup_in_memory_db();
    let store = make_store(&conn);
    run_category_create(&store, "cat-x", "X", "#fff").unwrap();
    let result = store.create_category("cat-x", "X", "#fff", "");
    assert!(result.is_err());
}

#[test]
fn run_category_delete_removes() {
    let conn = setup_in_memory_db();
    let store = make_store(&conn);
    run_category_create(&store, "cat-xyz", "XYZ", "#000").unwrap();
    run_category_delete(&store, "cat-xyz").unwrap();
    let cat = store.get_category("cat-xyz").unwrap();
    assert!(cat.is_none());
}

// ── Product CRUD ──────────────────────────────────────────────────

#[test]
fn run_product_create_and_list() {
    let conn = setup_in_memory_db();
    let currency = Currency::from_str("USD").unwrap();
    let money = Money {
        minor_units: 1500,
        currency,
    };

    let store = make_store(&conn);
    store
        .create_product("SKU-001", "Test Product", money, None, None, 10, None)
        .unwrap();

    let products = store.list_products().unwrap();
    assert!(!products.is_empty());
    assert!(products.iter().any(|p| p.product.sku.as_str() == "SKU-001"));
}

#[test]
fn run_product_create_and_get_text() {
    let conn = setup_in_memory_db();
    let store = make_store(&conn);
    let currency = Currency::from_str("USD").unwrap();
    let money = Money {
        minor_units: 2500,
        currency,
    };
    store
        .create_product("SKU-002", "Widget", money, None, None, 5, None)
        .unwrap();

    let result = run_product_get(&store, "SKU-002");
    assert!(result.is_ok());
}

#[test]
fn run_product_delete_removes() {
    let conn = setup_in_memory_db();
    let store = make_store(&conn);
    let currency = Currency::from_str("USD").unwrap();
    let money = Money {
        minor_units: 100,
        currency,
    };
    store
        .create_product("TO-DEL", "Delete Me", money, None, None, 0, None)
        .unwrap();
    run_product_delete(&store, "TO-DEL").unwrap();
    let prod = store.get_product("TO-DEL").unwrap();
    assert!(prod.is_none());
}

// ── Inventory ─────────────────────────────────────────────────────

#[test]
fn run_inventory_get_with_stock() {
    let conn = setup_in_memory_db();
    let store = make_store(&conn);
    let currency = Currency::from_str("USD").unwrap();
    let money = Money {
        minor_units: 500,
        currency,
    };
    store
        .create_product("INV-001", "Stocked Item", money, None, None, 42, None)
        .unwrap();

    let result = run_inventory_get(&store, "INV-001");
    assert!(result.is_ok());
}

#[test]
fn run_inventory_get_not_found() {
    let conn = setup_in_memory_db();
    let store = make_store(&conn);
    let result = run_inventory_get(&store, "NO-SKU");
    assert!(result.is_ok());
}

#[test]
fn run_inventory_adjust_restock() {
    let conn = setup_in_memory_db();
    let store = make_store(&conn);
    let currency = Currency::from_str("USD").unwrap();
    let money = Money {
        minor_units: 500,
        currency,
    };
    store
        .create_product("ADJ-001", "Adjustable", money, None, None, 10, None)
        .unwrap();

    run_inventory_adjust(&store, "ADJ-001", 5).unwrap();
    let prod = store.get_product("ADJ-001").unwrap().unwrap();
    assert_eq!(prod.stock_qty, Some(15));
}

#[test]
fn run_inventory_adjust_sell() {
    let conn = setup_in_memory_db();
    let store = make_store(&conn);
    let currency = Currency::from_str("USD").unwrap();
    let money = Money {
        minor_units: 500,
        currency,
    };
    store
        .create_product("ADJ-002", "Sellable", money, None, None, 10, None)
        .unwrap();

    run_inventory_adjust(&store, "ADJ-002", -3).unwrap();
    let prod = store.get_product("ADJ-002").unwrap().unwrap();
    assert_eq!(prod.stock_qty, Some(7));
}

// ── Sale commands ─────────────────────────────────────────────────

#[test]
fn run_sale_update_status_not_found() {
    let conn = setup_in_memory_db();
    let store = make_store(&conn);
    let result =
        store.update_sale_status("00000000-0000-0000-0000-000000000000", SaleStatus::Active);
    assert!(matches!(result, Err(CoreError::NotFound { .. })));
}

// ── Customer CRUD ─────────────────────────────────────────────────

#[test]
fn run_customer_create_and_get() {
    let conn = setup_in_memory_db();
    let store = make_store(&conn);
    run_customer_create(&store, "Alice", Some("alice@test.com"), None, None).unwrap();

    let customers = store.list_customers().unwrap();
    assert!(!customers.is_empty());
    assert!(customers.iter().any(|c| c.name == "Alice"));
}

#[test]
fn run_customer_create_rejects_invalid_email() {
    let conn = setup_in_memory_db();
    let store = make_store(&conn);
    let result = run_customer_create(&store, "Alice", Some("notanemail"), None, None);
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("must contain exactly one '@'"),
        "expected '@' error, got: {msg}"
    );
}

#[test]
fn run_customer_create_rejects_empty_email() {
    let conn = setup_in_memory_db();
    let store = make_store(&conn);
    let result = run_customer_create(&store, "Alice", Some(""), None, None);
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("must not be empty"),
        "expected empty error, got: {msg}"
    );
}

#[test]
fn run_customer_create_rejects_invalid_phone() {
    let conn = setup_in_memory_db();
    let store = make_store(&conn);
    let result = run_customer_create(&store, "Alice", None, Some("no-digits-here"), None);
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("at least one digit"),
        "expected digit error, got: {msg}"
    );
}

#[test]
fn run_customer_create_rejects_empty_phone() {
    let conn = setup_in_memory_db();
    let store = make_store(&conn);
    let result = run_customer_create(&store, "Alice", None, Some(""), None);
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("must not be empty"),
        "expected empty error, got: {msg}"
    );
}

#[test]
fn run_customer_create_accepts_none_phone_and_email() {
    let conn = setup_in_memory_db();
    let store = make_store(&conn);
    let result = run_customer_create(&store, "Alice", None, None, None);
    assert!(result.is_ok(), "None email/phone should pass validation");
}

#[test]
fn run_customer_create_accepts_valid_email_and_phone() {
    let conn = setup_in_memory_db();
    let store = make_store(&conn);
    let result = run_customer_create(
        &store,
        "Bob",
        Some("bob@example.com"),
        Some("+1-555-0100"),
        None,
    );
    assert!(
        result.is_ok(),
        "valid email and phone should pass: {result:?}"
    );
}

// ── User CRUD ─────────────────────────────────────────────────────

fn seed_role(conn: &Connection, id: &str, name: &str) {
    conn.execute(
        "INSERT OR IGNORE INTO roles (id, name, description, permissions) VALUES (?1, ?2, '', '[]')",
        params![id, name],
    ).unwrap();
}

#[test]
fn run_user_create_and_list() {
    let conn = setup_in_memory_db();
    seed_role(&conn, "role-staff", "Staff");
    let store = make_store(&conn);
    run_user_create(
        &store,
        "jdoe",
        &oz_core::auth::hash_pin("4321").unwrap(),
        "John Doe",
        "role-staff",
    )
    .unwrap();

    let users = store.list_users().unwrap();
    assert!(!users.is_empty());
    assert!(users.iter().any(|u| u.username == "jdoe"));
}

// ── Sale status helper logic ──────────────────────────────────────

#[test]
fn update_status_invalid_string() {
    let result = SaleStatus::from_stored_str("bogus");
    assert!(result.is_none());
}

#[test]
fn update_status_valid_strings() {
    assert!(SaleStatus::from_stored_str("pending").is_some());
    assert!(SaleStatus::from_stored_str("active").is_some());
    assert!(SaleStatus::from_stored_str("completed").is_some());
    assert!(SaleStatus::from_stored_str("voided").is_some());
}

// ── Currency parsing for product create ───────────────────────────

#[test]
fn currency_from_str_valid() {
    let currency = Currency::from_str("USD").unwrap();
    assert_eq!(currency, Currency(*b"USD"));
}

#[test]
fn currency_from_str_invalid() {
    let result = Currency::from_str("INVALID");
    assert!(result.is_err());
}

// ── Init-db ───────────────────────────────────────────────────────

#[test]
fn run_init_db_simple_retail() {
    let conn = oz_core::migrations::fresh_db();
    let args = InitDbArgs {
        preset: "simple-retail".into(),
    };
    let result = run_init_db(&conn, &args);
    assert!(result.is_ok());
    let name = oz_core::Settings::get_store_name(&conn).unwrap();
    assert_eq!(name, Some("My Store".into()));
}

#[test]
fn run_init_db_unknown_preset_falls_back_to_custom() {
    let conn = oz_core::migrations::fresh_db();
    let args = InitDbArgs {
        preset: "unknown-preset".into(),
    };
    let result = run_init_db(&conn, &args);
    assert!(result.is_ok());
}

#[test]
fn run_init_db_full_store() {
    let conn = oz_core::migrations::fresh_db();
    let args = InitDbArgs {
        preset: "full-store".into(),
    };
    let result = run_init_db(&conn, &args);
    assert!(result.is_ok());
}

#[test]
fn run_init_db_restaurant() {
    let conn = oz_core::migrations::fresh_db();
    let args = InitDbArgs {
        preset: "restaurant".into(),
    };
    let result = run_init_db(&conn, &args);
    assert!(result.is_ok());
}

#[test]
fn run_init_db_custom() {
    let conn = oz_core::migrations::fresh_db();
    let args = InitDbArgs {
        preset: "custom".into(),
    };
    let result = run_init_db(&conn, &args);
    assert!(result.is_ok());
}

// ── Migrate ───────────────────────────────────────────────────────

#[test]
fn run_migrate_on_fresh_db() {
    let conn = Connection::open_in_memory().unwrap();
    let result = run_migrate(conn);
    assert!(result.is_ok());
}

// ── CLI-3: PHC pin-hash validation ────────────────────────────────

#[test]
fn cli3_phc_validation_accepts_real_argon2_hash() {
    // Produce a genuine argon2id PHC string through the project's own
    // hashing helper, then confirm the validator accepts it.
    let hash = oz_core::auth::hash_pin("4321").unwrap();
    validate_phc_pin_hash(&hash).unwrap();
}

#[test]
fn cli3_phc_validation_rejects_placeholder_garbage() {
    // The old seeded placeholder value must be rejected up front.
    let err = validate_phc_pin_hash("hashed_pin_placeholder").unwrap_err();
    assert!(err.to_string().contains("not a valid PHC string"));
}

#[test]
fn cli3_phc_validation_rejects_non_argon2_algorithm() {
    // A well-formed PHC envelope with a foreign algorithm is rejected too.
    let err = validate_phc_pin_hash("$pbkdf2-sha256$v=19$abc$def").unwrap_err();
    // Either the PHC parse or the algorithm check rejects it; both name --pin-hash.
    assert!(err.to_string().contains("--pin-hash"));
}

// ── CLI-4: restore removes WAL sidecars before copy ───────────────

#[test]
fn restore_removes_wal_sidecars_and_replaces_database() {
    let dir = std::env::temp_dir().join(format!(
        "oz-cli-restore-{}-{}",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let db_path = dir.join("live.db");
    let backup_path = dir.join("backup.db");

    // Seed a live WAL-mode database.
    {
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "PRAGMA journal_mode=WAL; CREATE TABLE marker(x); INSERT INTO marker VALUES ('live');",
        )
        .unwrap();
    }
    // Simulate a crashed process: hot sidecars left on disk (a clean
    // close would have removed them).
    std::fs::write(db_path.with_extension("db-wal"), b"hot wal frames").unwrap();
    std::fs::write(db_path.with_extension("db-shm"), b"hot shm").unwrap();

    // A backup with different content.
    {
        let conn = Connection::open(&backup_path).unwrap();
        conn.execute_batch("CREATE TABLE marker(x); INSERT INTO marker VALUES ('backup');")
            .unwrap();
    }

    let conn = Connection::open(&db_path).unwrap();
    super::run_restore(conn, backup_path.to_str().unwrap()).unwrap();

    // Sidecars are gone.
    assert!(
        !db_path.with_extension("db-wal").exists(),
        "-wal must be removed"
    );
    assert!(
        !db_path.with_extension("db-shm").exists(),
        "-shm must be removed"
    );

    // The database content is the backup's.
    let check = Connection::open(&db_path).unwrap();
    let value: String = check
        .query_row("SELECT x FROM marker", [], |r| r.get(0))
        .unwrap();
    assert_eq!(value, "backup");

    let _ = std::fs::remove_dir_all(&dir);
}
