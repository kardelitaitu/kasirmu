//! Relocated data-command tests (Wave-F test relocation: moved out of
//! `apps/desktop-client/src/commands/data_tests.rs`).
//!
//! Mounted at the foot of `data.rs` with `#[cfg(test)] #[path]`, so
//! `use super::*` resolves the eight wire DTOs, `exportable_settings_rows`
//! and the two batch quota gates exactly as the desktop sibling module did
//! (its `AppError` adapters were thin wrappers over these bridge fns). No
//! context or harness is needed: every case is a pure DTO/serde check or a
//! direct `&Store` gate drive. The two typed quota refusals rename
//! `AppError::Core` to `BridgeError::Core` 1:1 — the gate now returns
//! `BridgeError` natively and the asserted message texts are unchanged.

use super::*;

// ── Settings export redaction (review MED-2) ────────────────────────

#[test]
fn export_drops_secret_and_managed_keys() {
    let rows = vec![
        ("store.name".into(), "Toko OZ".into()),
        ("local_api.secret".into(), "deadbeef".into()),
        ("local_api.enabled".into(), "1".into()),
        ("smtp_config".into(), r#"{"password":"hunter2"}"#.into()),
        ("lan_server.psk".into(), "psk".into()),
        // C-2 typo regression: the stored key is UNDERSCORED, while the deny
        // list carried only the dotted "sync.terminal_secret", so the terminal
        // secret rode out in every .ozpkg. The device-bound identity keys are
        // export-barred too (they fingerprint this install), even though they
        // stay readable through get_setting.
        ("sync_terminal_secret".into(), "enc:v1:ciphertext".into()),
        ("sync_terminal_id".into(), "term-42".into()),
        ("machine_id".into(), "MACHINE-FP".into()),
    ];
    let out = exportable_settings_rows(rows);
    let keys: Vec<&str> = out.iter().map(|v| v["key"].as_str().unwrap()).collect();
    assert_eq!(keys, ["store.name"], "only portable keys may be exported");
}

// ── BackupStatus ────────────────────────────────────────────────────

#[test]
fn backup_status_debug() {
    let bs = BackupStatus {
        last_backup: Some("2025-01-01 12:00:00".into()),
        last_backup_size: Some("1.5 MB".into()),
    };
    let d = format!("{bs:?}");
    assert!(d.contains("2025-01-01"));
}

#[test]
fn backup_status_serialize() {
    let bs = BackupStatus {
        last_backup: None,
        last_backup_size: None,
    };
    let json = serde_json::to_value(&bs).unwrap();
    assert!(
        !json.as_object().unwrap().contains_key("db_path"),
        "db_path must not be exposed in the DTO (M-7)"
    );
    assert!(json["last_backup"].is_null());
}

// ── BackupResult ────────────────────────────────────────────────────

#[test]
fn backup_result_debug() {
    let br = BackupResult {
        path: "/backups/oz.backup.db".into(),
        size_bytes: 1024,
    };
    let d = format!("{br:?}");
    assert!(d.contains("1024"));
}

#[test]
fn backup_result_serialize() {
    let br = BackupResult {
        path: "/b/test.bak".into(),
        size_bytes: 2048,
    };
    let json = serde_json::to_value(&br).unwrap();
    assert_eq!(json["size_bytes"], 2048);
}

// ── ExportDataArgs ──────────────────────────────────────────────────

#[test]
fn export_data_args_deserialize() {
    let json = r#"{"types":["products","categories"],"password":"secret","output_path":"/out/export.ozpkg"}"#;
    let args: ExportDataArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.types, vec!["products", "categories"]);
    assert_eq!(args.password, "secret");
    assert_eq!(args.date_from, None);
    assert_eq!(args.date_to, None);
}

#[test]
fn export_data_args_debug() {
    let args = ExportDataArgs {
        types: vec!["all".into()],
        password: "pw".into(),
        output_path: "/o".into(),
        date_from: None,
        date_to: None,
    };
    let d = format!("{args:?}");
    assert!(d.contains("all"));
}

// ── ExportDataResult ────────────────────────────────────────────────

#[test]
fn export_data_result_debug() {
    let result = ExportDataResult {
        path: "/out/export.ozpkg".into(),
        size_bytes: 512,
        types: vec!["products".into(), "sales".into()],
    };
    let d = format!("{result:?}");
    assert!(d.contains("sales"));
}

#[test]
fn export_data_result_serialize() {
    let result = ExportDataResult {
        path: "/o/e.ozpkg".into(),
        size_bytes: 256,
        types: vec![],
    };
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["size_bytes"], 256);
    assert!(json["types"].as_array().unwrap().is_empty());
}

// ── ImportPreviewArgs ───────────────────────────────────────────────

#[test]
fn import_preview_args_deserialize() {
    let json = r#"{"file_path":"/data/import.ozpkg","password":"pw123"}"#;
    let args: ImportPreviewArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.file_path, "/data/import.ozpkg");
    assert_eq!(args.password, "pw123");
}

#[test]
fn import_preview_args_debug() {
    let args = ImportPreviewArgs {
        file_path: "/f".into(),
        password: "p".into(),
    };
    let d = format!("{args:?}");
    assert!(d.contains("/f"));
}

// ── ImportPreviewResult ─────────────────────────────────────────────

#[test]
fn import_preview_result_debug() {
    let result = ImportPreviewResult {
        store_name: "My Store".into(),
        app_version: "0.0.28".into(),
        created_at: "2025-01-01".into(),
        types: vec!["products".into()],
        product_count: 50,
        category_count: 5,
        sale_count: Some(100),
        customer_count: Some(20),
        user_count: Some(3),
        setting_count: None,
    };
    let d = format!("{result:?}");
    assert!(d.contains("My Store"));
    assert!(d.contains("50"));
}

#[test]
fn import_preview_result_serialize() {
    let result = ImportPreviewResult {
        store_name: "S".into(),
        app_version: "1.0".into(),
        created_at: "2025-01-01".into(),
        types: vec![],
        product_count: 0,
        category_count: 0,
        sale_count: None,
        customer_count: None,
        user_count: None,
        setting_count: None,
    };
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["store_name"], "S");
    assert!(json["sale_count"].is_null());
}

// ── ImportDataArgs ──────────────────────────────────────────────────

#[test]
fn import_data_args_deserialize() {
    let json = r#"{"file_path":"/data/import.ozpkg","password":"pw"}"#;
    let args: ImportDataArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.file_path, "/data/import.ozpkg");
}

#[test]
fn import_data_args_debug() {
    let args = ImportDataArgs {
        file_path: "/f".into(),
        password: "x".into(),
    };
    let d = format!("{args:?}");
    assert!(d.contains("/f"));
}

// ── ImportDataResult ────────────────────────────────────────────────

#[test]
fn import_data_result_debug() {
    let result = ImportDataResult {
        products_imported: 10,
        categories_imported: 3,
        sales_imported: 50,
        customers_imported: 5,
        users_imported: 2,
        settings_imported: 1,
    };
    let d = format!("{result:?}");
    assert!(d.contains("50"));
}

#[test]
fn import_data_result_serialize() {
    let result = ImportDataResult {
        products_imported: 0,
        categories_imported: 0,
        sales_imported: 0,
        customers_imported: 0,
        users_imported: 0,
        settings_imported: 0,
    };
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["products_imported"], 0);
    assert_eq!(json["settings_imported"], 0);
}

// ── W4-S2: import batch quota gate ──────────────────────────────────

fn fresh_conn() -> rusqlite::Connection {
    oz_core::migrations::fresh_db()
}

/// One importable product row as `payload.products` carries them (a
/// serialized `oz_core::Product`), keyed by SKU.
fn product_value(sku: &str) -> serde_json::Value {
    let product = oz_core::Product::new(
        sku,
        format!("Product {sku}"),
        oz_core::Money {
            minor_units: 100,
            currency: oz_core::Currency(*b"USD"),
        },
    );
    serde_json::to_value(&product).unwrap()
}

/// Seed `n` catalog rows with SKUs `seed-0..n-1` via the same table the
/// gate's existence probe reads.
fn seed_catalog(conn: &rusqlite::Connection, n: i64) {
    for i in 0..n {
        conn.execute(
            "INSERT INTO products (id, sku, name, price_minor, currency) VALUES (?1, ?2, ?3, 100, 'USD')",
            rusqlite::params![format!("p-{i}"), format!("seed-{i}"), format!("Seed {i}")],
        )
        .unwrap();
    }
}

fn catalog_count(conn: &rusqlite::Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM products", [], |r| r.get(0))
        .unwrap()
}

#[test]
fn import_gate_counts_only_unseen_skus() {
    // Batch arithmetic: existing-SKU rows are updates/merges, not new
    // creations — only rows whose SKU is NOT in the catalog count toward
    // the quota.
    let conn = fresh_conn();
    seed_catalog(&conn, 2); // seed-0, seed-1 present
    let store = Store::new(&conn);
    let payload = vec![
        product_value("seed-0"), // update, not counted
        product_value("new-1"),  // new
        product_value("new-2"),  // new
    ];
    let counted = gate_import_product_batch(&store, &payload).unwrap();
    assert_eq!(counted, 2, "existing SKU must not count as a creation");
    assert_eq!(catalog_count(&conn), 2, "the gate itself never writes rows");
}

#[test]
fn import_gate_rejects_at_cap_and_writes_nothing() {
    // Fail-closed tier (no subscription row -> Free, cap 200): 199 present
    // + 3 new = 202 > 200. The refusal happens BEFORE the transaction
    // opens, so nothing is partially imported.
    let conn = fresh_conn();
    conn.execute("DELETE FROM tenant_subscription", []).unwrap();
    seed_catalog(&conn, 199);
    let store = Store::new(&conn);
    let payload = vec![
        product_value("new-1"),
        product_value("new-2"),
        product_value("new-3"),
    ];
    let err = gate_import_product_batch(&store, &payload).unwrap_err();
    match err {
        BridgeError::Core { message, .. } => {
            assert!(message.contains("maximum 200 products"), "got: {message}");
            assert!(message.contains("currently have 199"), "got: {message}");
        }
        other => panic!("expected typed quota refusal, got {other:?}"),
    }
    assert_eq!(
        catalog_count(&conn),
        199,
        "a refused import must not write anything"
    );
}

#[test]
fn import_gate_proceeds_under_cap_and_pins_the_boundary() {
    let conn = fresh_conn();
    conn.execute("DELETE FROM tenant_subscription", []).unwrap();
    seed_catalog(&conn, 2);
    let store = Store::new(&conn);
    // 2 + 2 new = 4, well under the Free cap of 200.
    let counted =
        gate_import_product_batch(&store, &[product_value("new-1"), product_value("new-2")])
            .unwrap();
    assert_eq!(counted, 2);
    // Simulate the import loop's inserts, then pin the exact edge: a batch
    // landing exactly ON the cap (196 more = 200) is the last allowed one;
    // one more row over it is refused.
    seed_catalog(&conn, 0);
    for i in 0..2 {
        conn.execute(
            "INSERT INTO products (id, sku, name, price_minor, currency) VALUES (?1, ?2, ?3, 100, 'USD')",
            rusqlite::params![format!("imp-{i}"), format!("new-{}", i + 1), "Imported"],
        )
        .unwrap();
    }
    let edge: Vec<_> = (0..196)
        .map(|i| product_value(&format!("bulk-{i}")))
        .collect();
    gate_import_product_batch(&store, &edge).unwrap(); // 200 == limit: allowed
    // The gate only counts; the caller inserts. Materialize the approved
    // batch exactly as the import loop would, THEN ask again.
    for v in edge.iter() {
        let p: oz_core::Product = serde_json::from_value(v.clone()).unwrap();
        conn.execute(
            "INSERT INTO products (id, sku, name, price_minor, currency) VALUES (?1, ?2, ?3, 100, 'USD')",
            rusqlite::params![p.id, p.sku.to_string(), p.name],
        )
        .unwrap();
    }
    assert_eq!(catalog_count(&conn), 200);
    let over = vec![product_value("bulk-over")];
    assert!(
        gate_import_product_batch(&store, &over).is_err(),
        "200 + 1 must refuse"
    );
}

// ── W6-A / S2.1: users-arm batch gate (Staff dimension) ─────────────

/// One importable user row as `payload.users` carries them (a serialized
/// `oz_core::User`), keyed by the row id.
fn user_value(id: &str, username: &str) -> serde_json::Value {
    let mut user = oz_core::User::new(username, "", username, "role-staff");
    user.id = id.into();
    serde_json::to_value(&user).unwrap()
}

/// Seed `n` ACTIVE staff users (the rows `count_staff_users` consults) with
/// ids `u-seed-0..n-1`.
fn seed_staff(conn: &rusqlite::Connection, store: &Store<'_>, n: i64) {
    store.seed_default_roles().unwrap();
    for i in 0..n {
        conn.execute(
            "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
             VALUES (?1, ?2, 'h', ?3, 'role-staff', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
            rusqlite::params![format!("u-seed-{i}"), format!("seed-{i}"), format!("Seed {i}")],
        )
        .unwrap();
    }
}

fn staff_count(conn: &rusqlite::Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM users WHERE is_active = 1", [], |r| {
        r.get(0)
    })
    .unwrap()
}

#[test]
fn import_gate_users_counts_only_unseen_ids() {
    // Batch arithmetic mirrors the product gate: existing ids are updates,
    // not creations — only unseen ids count toward the staff quota. The
    // seed row is INACTIVE (0 active staff) so the batch stays under the
    // Free staff cap of 1: 0 + 1 new = allowed.
    let conn = fresh_conn();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('u-seed-0', 'seed-0', 'h', 'Seed 0', 'role-staff', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
        [],
    )
    .unwrap();
    let payload = vec![
        user_value("u-seed-0", "seed-0"), // update, not counted
        user_value("u-new-1", "new-1"),   // new — the only counted row
    ];
    let counted = gate_import_user_batch(&store, &payload).unwrap();
    assert_eq!(counted, 1, "existing id must not count as a creation");
    assert_eq!(staff_count(&conn), 0, "the gate itself never writes rows");
}

#[test]
fn import_gate_users_rejects_at_cap_and_writes_nothing() {
    // Fail-closed tier (subscription row deleted -> Free, staff cap 1):
    // 1 active staff present + 1 new = 2 > 1. The refusal happens BEFORE
    // the transaction opens, so nothing is partially imported.
    let conn = fresh_conn();
    let store = Store::new(&conn);
    conn.execute("DELETE FROM tenant_subscription", []).unwrap();
    seed_staff(&conn, &store, 1);
    let payload = vec![user_value("u-new-1", "new-1")];
    let err = gate_import_user_batch(&store, &payload).unwrap_err();
    match err {
        BridgeError::Core { message, .. } => {
            assert!(message.contains("maximum 1 staff users"), "got: {message}");
            assert!(message.contains("currently have 1"), "got: {message}");
        }
        other => panic!("expected typed quota refusal, got {other:?}"),
    }
    assert_eq!(
        staff_count(&conn),
        1,
        "a refused import must not write anything"
    );
}

#[test]
fn import_gate_users_proceeds_under_cap_and_pins_the_boundary() {
    // Free staff cap 1: zero active staff -> 1 new user is exactly at the
    // cap (allowed); materialize it, then the next new id must refuse.
    let conn = fresh_conn();
    let store = Store::new(&conn);
    conn.execute("DELETE FROM tenant_subscription", []).unwrap();
    seed_staff(&conn, &store, 0);
    let first = vec![user_value("u-new-1", "new-1")];
    let counted = gate_import_user_batch(&store, &first).unwrap();
    assert_eq!(counted, 1, "0 + 1 == cap 1 is allowed");
    // Materialize the approved row exactly as the import loop would.
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('u-new-1', 'new-1', 'h', 'Imported', 'role-staff', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
        [],
    )
    .unwrap();
    let over = vec![user_value("u-new-2", "new-2")];
    assert!(
        gate_import_user_batch(&store, &over).is_err(),
        "1 + 1 over the Free staff cap must refuse"
    );
}
