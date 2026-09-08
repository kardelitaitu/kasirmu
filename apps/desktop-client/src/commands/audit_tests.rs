use super::*;

// ── AuditEntryDto ───────────────────────────────────────────────────

#[test]
fn audit_entry_dto_serialize() {
    let dto = AuditEntryDto {
        id: "a2".into(),
        user_id: "u2".into(),
        action: "login".into(),
        target_type: None,
        target_id: None,
        details: String::new(),
        outcome: "success".into(),
        created_at: "2025-02-01T00:00:00.000Z".into(),
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["action"], "login");
    assert!(json["target_type"].is_null());
}

// ── ListAuditLogArgs ────────────────────────────────────────────────

#[test]
fn list_audit_log_args_deserialize_minimal() {
    let json = r#"{}"#;
    let args: ListAuditLogArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.limit, 100);
    assert_eq!(args.offset, 0);
}

#[test]
fn list_audit_log_args_deserialize_full() {
    let json = r#"{"limit":50,"offset":10}"#;
    let args: ListAuditLogArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.limit, 50);
    assert_eq!(args.offset, 10);
}

#[test]
fn list_audit_log_args_debug() {
    let args = ListAuditLogArgs {
        limit: 25,
        offset: 0,
    };
    let d = format!("{args:?}");
    assert!(d.contains("25"));
}

// ── Export (AUD-09) ────────────────────────────────────────────

#[test]
fn export_args_deserialize_camel_case() {
    let json = r#"{"outcome":"failure","query":"sale"}"#;
    let args: ExportAuditLogArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.outcome.as_deref(), Some("failure"));
    assert_eq!(args.query.as_deref(), Some("sale"));
}

#[test]
fn export_args_deserialize_empty() {
    let json = r#"{}"#;
    let args: ExportAuditLogArgs = serde_json::from_str(json).unwrap();
    assert!(args.outcome.is_none());
    assert!(args.query.is_none());
}

#[test]
fn csv_row_quotes_embedded_quotes_and_commas() {
    // RFC-4180: embedded quotes are doubled; every field is quoted.
    let row = csv_row(&["a\"b", "c,d", "plain"]);
    assert_eq!(row, "\"a\"\"b\",\"c,d\",\"plain\"");
}

#[test]
fn csv_row_empty_and_nullable_fields() {
    let row = csv_row(&["id-1", "", "user-1"]);
    assert_eq!(row, "\"id-1\",\"\",\"user-1\"");
}

#[test]
fn export_dto_serialize_has_all_fields() {
    let dto = AuditExportDto {
        csv: "\u{FEFF}id\n".into(),
        row_count: 1,
        generated_at: "2026-08-01T00:00:00.000Z".into(),
        requested_by: "user-1".into(),
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["row_count"], 1);
    assert_eq!(json["requested_by"], "user-1");
    assert!(json["csv"].as_str().unwrap().starts_with('\u{FEFF}'));
}

// ── the Premium+ tier gate (fix: blocking_lock panicked in every command) ──
//
// `require_audit_tier` used `state.db.blocking_lock()` on a tokio Mutex.
// tokio 1.49 implements it as `future::block_on(self.lock())`, which panics
// unconditionally when the current thread is driving async tasks — so every
// audit command was a guaranteed panic on first real use. Nothing caught it:
// no Rust test called these commands, and the E2E dev-mock answers the invoke
// in JavaScript without running Rust. These are those missing tests, and they
// fail with the panic if the gate is ever reverted.

use platform_core::StoreDatabaseManager;
use tauri::Manager as _;

/// Global DB with an owner (all permissions) on the given tier.
fn seeded_conn(tier_key: &str) -> rusqlite::Connection {
    let conn = oz_core::migrations::fresh_db();
    {
        let store = Store::new(&conn);
        store.seed_default_roles().unwrap();
    }
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();
    conn.execute(
        "UPDATE tenant_subscription SET tier_key = ?1 WHERE tenant_id = 'default'",
        [tier_key],
    )
    .unwrap();
    conn
}

/// An app whose `tok` session is the owner, with a real store DB behind it.
fn app_for(user_id: &str, role_id: &str, tier_key: &str) -> tauri::App<tauri::test::MockRuntime> {
    let conn = seeded_conn(tier_key);
    let temp_dir = tempfile::tempdir().unwrap();
    let mut state = AppState::for_test_with_conn(conn);
    state.db_manager =
        StoreDatabaseManager::new(temp_dir.path().to_path_buf(), oz_core::migrations::ALL);
    state.session_store.write().unwrap().insert(
        "tok".into(),
        oz_core::session::SessionContext::new(
            user_id.into(),
            role_id.into(),
            "terminal-1".into(),
            "default".into(),
            "instance-1".into(),
            "pos".into(),
            None,
            0,
        ),
    );
    tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap()
}

#[tokio::test]
async fn list_command_passes_the_tier_gate_without_panicking() {
    let app = app_for("user-owner", "role-owner", "premium");
    let page = list_audit_log_scoped(
        "tok".into(),
        ListAuditLogScopedArgs {
            limit: 50,
            outcome: None,
            query: None,
            before_created_at: None,
            before_id: None,
        },
        app.state(),
    )
    .await;
    assert!(page.is_ok(), "{:?}", page.err());
    assert_eq!(page.unwrap().total, 0);
}

#[tokio::test]
async fn review_status_command_passes_the_tier_gate_without_panicking() {
    let app = app_for("user-owner", "role-owner", "premium");
    let status = get_audit_review_status_scoped("tok".into(), app.state()).await;
    assert!(status.is_ok(), "{:?}", status.err());
}

#[tokio::test]
async fn export_command_passes_the_tier_gate_without_panicking() {
    let app = app_for("user-owner", "role-owner", "premium");
    let exported = export_audit_log_scoped(
        "tok".into(),
        ExportAuditLogArgs {
            outcome: None,
            query: None,
        },
        app.state(),
    )
    .await;
    assert!(exported.is_ok(), "{:?}", exported.err());
}

#[tokio::test]
async fn the_gate_still_denies_a_session_without_audit_view() {
    // Making the gate async must not have softened it: the permission check
    // still runs and still refuses.
    let app = app_for("user-owner", "role-owner", "premium");
    let err = list_audit_log_scoped(
        "tok".into(),
        ListAuditLogScopedArgs {
            limit: 50,
            outcome: None,
            query: None,
            before_created_at: None,
            before_id: None,
        },
        app.state(),
    )
    .await
    .err();
    assert!(err.is_none(), "owner has audit:view: {err:?}");

    let lite = app_for("user-owner", "role-owner", "premium");
    {
        let state = lite.state::<AppState>();
        let db = state.db.lock().await;
        db.execute(
            r#"INSERT INTO roles (id, name, description, permissions, created_at, updated_at)
             VALUES ('role-lite', 'Lite', 'Limited', '["sales:view"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')"#,
            [],
        )
        .unwrap();
        db.execute(
            "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
             VALUES ('user-lite', 'lite', 'hash', 'Lite', 'role-lite', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
            [],
        )
        .unwrap();
    }
    let state = lite.state::<AppState>();
    state.session_store.write().unwrap().insert(
        "lite-tok".into(),
        oz_core::session::SessionContext::new(
            "user-lite".into(),
            "role-lite".into(),
            "terminal-1".into(),
            "default".into(),
            "instance-1".into(),
            "pos".into(),
            None,
            0,
        ),
    );
    let denied = list_audit_log_scoped(
        "lite-tok".into(),
        ListAuditLogScopedArgs {
            limit: 50,
            outcome: None,
            query: None,
            before_created_at: None,
            before_id: None,
        },
        lite.state(),
    )
    .await;
    assert!(
        matches!(denied, Err(AppError::PermissionDenied(_))),
        "the gate must still refuse: {denied:?}"
    );
}
