//! The organization-level security-events read path (tablet).
//!
//! A separate module from `audit_tests.rs` so the DTO/CSV unit tests and the
//! tier-gate regression tests stay focused and these — which need a full app
//! harness — sit on their own.
//!
//! The point of these tests is the seam the slice exists to close: security
//! events are written to the GLOBAL identity DB (logins happen before a store
//! is chosen; `users` is a global table), while the ordinary audit screen
//! reads the session store's file. This command is what makes the global rows
//! visible, and it must show ONLY the security class.

use super::*;

use platform_core::StoreDatabaseManager;
use tauri::Manager as _;

/// Global DB: owner (all permissions) + a Lite user (none), on a paid tier.
fn seeded_conn(tier_key: &str) -> rusqlite::Connection {
    let conn = oz_core::migrations::fresh_db();
    {
        let store = Store::new(&conn);
        store.seed_default_roles().unwrap();
    }
    conn.execute(
        r#"INSERT INTO roles (id, name, description, permissions, created_at, updated_at)
         VALUES ('role-lite', 'Lite', 'Limited', '["sales:view"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')"#,
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
                ('user-lite',  'lite',  'hash', 'Lite',  'role-lite',  1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
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

/// One security row and one business row, in the GLOBAL DB — the pair that
/// must come apart on the security surface.
fn seed_global_rows(conn: &rusqlite::Connection) {
    conn.execute(
        "INSERT INTO audit_log (id, user_id, action, target_type, target_id, details, outcome, created_at)
         VALUES ('aud-sec','user-owner','login','user','user-owner','{}','success','2026-08-01T00:00:00.000Z'),
                ('aud-biz','user-owner','sale.void','sale','s-1','{}','success','2026-08-01T00:00:01.000Z')",
        [],
    )
    .unwrap();
}

fn app_for(user_id: &str, role_id: &str, tier_key: &str) -> tauri::App<tauri::test::MockRuntime> {
    let conn = seeded_conn(tier_key);
    seed_global_rows(&conn);
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

fn args(limit: u64) -> ListSecurityEventsScopedArgs {
    ListSecurityEventsScopedArgs {
        limit,
        outcome: None,
        query: None,
        before_created_at: None,
        before_id: None,
    }
}

#[tokio::test]
async fn security_events_page_shows_only_the_security_class() {
    let app = app_for("user-owner", "role-owner", "premium");
    let page = list_security_events_scoped("tok".into(), args(50), app.state())
        .await
        .unwrap();
    assert_eq!(page.total, 1, "the business row must not count");
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].action, "login");
    assert!(!page.items.iter().any(|e| e.action == "sale.void"));
    assert!(!page.has_more);
}

#[tokio::test]
async fn security_events_page_filters_by_outcome() {
    let app = app_for("user-owner", "role-owner", "premium");
    {
        let state = app.state::<AppState>();
        let db = state.db.lock().await;
        db.execute(
            "INSERT INTO audit_log (id, user_id, action, details, outcome, created_at)
             VALUES ('aud-fail','system','login.failed','{}','failure','2026-08-02T00:00:00.000Z')",
            [],
        )
        .unwrap();
    }
    let all = list_security_events_scoped("tok".into(), args(50), app.state())
        .await
        .unwrap();
    assert_eq!(all.total, 2);
    let failures = list_security_events_scoped(
        "tok".into(),
        ListSecurityEventsScopedArgs {
            limit: 50,
            outcome: Some("failure".into()),
            query: None,
            before_created_at: None,
            before_id: None,
        },
        app.state(),
    )
    .await
    .unwrap();
    assert_eq!(failures.items.len(), 1);
    assert_eq!(failures.items[0].action, "login.failed");
}

#[tokio::test]
async fn security_events_page_denies_a_session_without_audit_view() {
    // Same permission surface as the audit screen: a session that cannot open
    // the audit log cannot open this either.
    let app = app_for("user-lite", "role-lite", "premium");
    let err = list_security_events_scoped("tok".into(), args(50), app.state())
        .await
        .unwrap_err();
    assert!(
        matches!(err, AppError::PermissionDenied(_)),
        "expected a permission denial, got {err:?}"
    );
}

#[tokio::test]
async fn security_events_page_denies_a_free_tier_session() {
    // The tablet never mirrors the desktop's dev Free→Premium promotion, so
    // the Premium+ audit gate genuinely refuses here — the read side of the
    // same per-client invariant the write side pins.
    let app = app_for("user-owner", "role-owner", "free");
    let err = list_security_events_scoped("tok".into(), args(50), app.state())
        .await
        .unwrap_err();
    match err {
        AppError::PermissionDenied(msg) => {
            assert!(msg.contains("Premium"), "expected the tier refusal: {msg}")
        }
        other => panic!("expected a Premium tier refusal, got {other:?}"),
    }
}

#[tokio::test]
async fn security_events_page_rejects_an_unknown_session() {
    let app = app_for("user-owner", "role-owner", "premium");
    let err = list_security_events_scoped("nope".into(), args(50), app.state())
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::InvalidSession), "got {err:?}");
}

#[test]
fn security_events_args_deserialize_camel_case_and_default_the_limit() {
    // The UI sends camelCase; a missing limit must fall back to 100 rather
    // than 0 (which the core clamp would silently raise to 1).
    let empty: ListSecurityEventsScopedArgs = serde_json::from_str("{}").unwrap();
    assert_eq!(empty.limit, 100);
    assert!(empty.outcome.is_none());
    let full: ListSecurityEventsScopedArgs = serde_json::from_str(
        r#"{"limit":10,"outcome":"failure","query":"owner","beforeCreatedAt":"2026-08-01T00:00:00.000Z","beforeId":"aud-1"}"#,
    )
    .unwrap();
    assert_eq!(full.limit, 10);
    assert_eq!(
        full.before_created_at.as_deref(),
        Some("2026-08-01T00:00:00.000Z")
    );
    assert_eq!(full.before_id.as_deref(), Some("aud-1"));
}
