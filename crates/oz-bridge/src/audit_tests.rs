use super::*;

use crate::testing::TestBridge;

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
fn app_for(user_id: &str, role_id: &str, tier_key: &str) -> TestBridge {
    let conn = seeded_conn(tier_key);
    let bridge = TestBridge::new().with_conn(conn);
    bridge.sessions().write().unwrap().insert(
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
    bridge
}

#[tokio::test]
async fn list_command_passes_the_tier_gate_without_panicking() {
    let bridge = app_for("user-owner", "role-owner", "premium");
    let ctx = bridge.ctx();
    let page = list_audit_log_scoped(
        &ctx,
        "tok",
        ListAuditLogScopedArgs {
            limit: 50,
            outcome: None,
            query: None,
            before_created_at: None,
            before_id: None,
        },
    )
    .await;
    assert!(page.is_ok(), "{:?}", page.err());
    assert_eq!(page.unwrap().total, 0);
}

#[tokio::test]
async fn review_status_command_passes_the_tier_gate_without_panicking() {
    let bridge = app_for("user-owner", "role-owner", "premium");
    let ctx = bridge.ctx();
    let status = get_audit_review_status_scoped(&ctx, "tok").await;
    assert!(status.is_ok(), "{:?}", status.err());
}

#[tokio::test]
async fn export_command_passes_the_tier_gate_without_panicking() {
    let bridge = app_for("user-owner", "role-owner", "premium");
    let ctx = bridge.ctx();
    let exported = export_audit_log_scoped(
        &ctx,
        "tok",
        ExportAuditLogArgs {
            outcome: None,
            query: None,
        },
    )
    .await;
    assert!(exported.is_ok(), "{:?}", exported.err());
}

#[tokio::test]
async fn the_gate_still_denies_a_session_without_audit_view() {
    // Making the gate async must not have softened it: the permission check
    // still runs and still refuses.
    let bridge = app_for("user-owner", "role-owner", "premium");
    let ctx = bridge.ctx();
    let err = list_audit_log_scoped(
        &ctx,
        "tok",
        ListAuditLogScopedArgs {
            limit: 50,
            outcome: None,
            query: None,
            before_created_at: None,
            before_id: None,
        },
    )
    .await
    .err();
    assert!(err.is_none(), "owner has audit:view: {err:?}");

    let lite_conn = seeded_conn("premium");
    lite_conn.execute(
        r#"INSERT INTO roles (id, name, description, permissions, created_at, updated_at)
         VALUES ('role-lite', 'Lite', 'Limited', '["sales:view"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')"#,
        [],
    )
    .unwrap();
    lite_conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-lite', 'lite', 'hash', 'Lite', 'role-lite', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();
    let lite = TestBridge::new().with_conn(lite_conn);
    lite.sessions().write().unwrap().insert(
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
    let lite_ctx = lite.ctx();
    let denied = list_audit_log_scoped(
        &lite_ctx,
        "lite-tok",
        ListAuditLogScopedArgs {
            limit: 50,
            outcome: None,
            query: None,
            before_created_at: None,
            before_id: None,
        },
    )
    .await;
    assert!(
        matches!(denied, Err(BridgeError::PermissionDenied(_))),
        "the gate must still refuse: {denied:?}"
    );
}
