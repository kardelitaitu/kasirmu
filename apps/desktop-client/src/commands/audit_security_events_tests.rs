//! The organization-level security-events read path.
//!
//! A separate module from `audit_tests.rs` so the DTO/CSV unit tests stay
//! untouched and these — which need a full app harness — sit on their own.
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
async fn security_events_page_clamps_the_limit_and_reports_more() {
    let app = app_for("user-owner", "role-owner", "premium");
    {
        let state = app.state::<AppState>();
        let db = state.db.lock().await;
        for i in 0..3 {
            let n = i + 2;
            db.execute(
                "INSERT INTO audit_log (id, user_id, action, details, outcome, created_at)
                 VALUES (?1,'user-owner','logout','{}','success',?2)",
                rusqlite::params![format!("aud-l{i}"), format!("2026-08-0{n}T00:00:00.000Z")],
            )
            .unwrap();
        }
    }
    let page = list_security_events_scoped("tok".into(), args(2), app.state())
        .await
        .unwrap();
    assert_eq!(page.items.len(), 2);
    assert_eq!(
        page.total, 4,
        "login + 3 logouts, still excluding sale.void"
    );
    assert!(page.has_more);
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

// ── export_security_events_scoped (owner ruling D61-7 / D84) ────────

fn export_args(
    actor: Option<&str>,
    from: Option<&str>,
    to: Option<&str>,
) -> ExportSecurityEventsArgs {
    ExportSecurityEventsArgs {
        actor: actor.map(str::to_string),
        date_from: from.map(str::to_string),
        date_to: to.map(str::to_string),
    }
}

/// Two extra security rows in the GLOBAL DB: a second user-owner event
/// and a system-actor login failure (the unknown-account case).
async fn seed_actor_rows(app: &tauri::App<tauri::test::MockRuntime>) {
    let state = app.state::<AppState>();
    let db = state.db.lock().await;
    db.execute(
        "INSERT INTO audit_log (id, user_id, action, target_type, target_id, details, outcome, created_at)
         VALUES ('aud-sys','system','login.failed','user',NULL,'{}','failure','2026-08-02T00:00:00.000Z'),
                 ('aud-owner2','user-owner','logout','user','user-owner','{}','success','2026-08-03T00:00:00.000Z')",
        [],
    )
    .unwrap();
}

/// Three security rows around the Aug-5/Aug-6 boundary in the GLOBAL DB.
async fn seed_date_rows(app: &tauri::App<tauri::test::MockRuntime>) {
    let state = app.state::<AppState>();
    let db = state.db.lock().await;
    db.execute(
        "INSERT INTO audit_log (id, user_id, action, target_type, target_id, details, outcome, created_at)
         VALUES ('aud-d1','user-owner','login','user','user-owner','{}','success','2026-08-05T09:30:00.000Z'),
                 ('aud-d2','user-owner','login','user','user-owner','{}','success','2026-08-05T23:59:59.999Z'),
                 ('aud-d3','user-owner','login','user','user-owner','{}','success','2026-08-06T00:00:00.000Z')",
        [],
    )
    .unwrap();
}

#[tokio::test]
async fn export_contains_only_security_rows() {
    let app = app_for("user-owner", "role-owner", "premium");
    let out =
        export_security_events_scoped("tok".into(), export_args(None, None, None), app.state())
            .await
            .unwrap();
    assert_eq!(out.row_count, 1, "the business row must not export");
    assert!(out.csv.starts_with('\u{FEFF}'), "BOM required");
    assert!(
        out.csv
            .contains("id,created_at,user_id,action,target_type,target_id,outcome,details\n")
    );
    assert!(out.csv.contains("login"));
    assert!(!out.csv.contains("sale.void"));
    assert_eq!(out.requested_by, "user-owner");
}

#[tokio::test]
async fn actor_filter_is_exact_and_system_resolves() {
    let app = app_for("user-owner", "role-owner", "premium");
    seed_actor_rows(&app).await;
    // Exact user_id: only that actor's rows.
    let owner = export_security_events_scoped(
        "tok".into(),
        export_args(Some("user-owner"), None, None),
        app.state(),
    )
    .await
    .unwrap();
    assert_eq!(owner.row_count, 2, "seeded login + logout for user-owner");
    // "system" resolves to SYSTEM_ACTOR and matches only those rows.
    let sys = export_security_events_scoped(
        "tok".into(),
        export_args(Some("system"), None, None),
        app.state(),
    )
    .await
    .unwrap();
    assert_eq!(sys.row_count, 1);
    assert!(sys.csv.contains("login.failed"));
    assert!(!sys.csv.contains("logout"));
}

#[tokio::test]
async fn date_range_normalizes_day_bounds() {
    let app = app_for("user-owner", "role-owner", "premium");
    seed_date_rows(&app).await;
    // dateTo = 2026-08-05 must INCLUDE the whole day (the exclusive
    // bound normalizes to midnight of Aug 6) and exclude Aug 6.
    let out = export_security_events_scoped(
        "tok".into(),
        export_args(None, Some("2026-08-05"), Some("2026-08-05")),
        app.state(),
    )
    .await
    .unwrap();
    assert_eq!(out.row_count, 2, "both Aug-5 events, none of Aug-6");
    assert!(out.csv.contains("aud-d1"));
    assert!(out.csv.contains("aud-d2"));
    assert!(!out.csv.contains("aud-d3"));
}

#[tokio::test]
async fn a_malformed_day_is_rejected_not_silently_ignored() {
    let app = app_for("user-owner", "role-owner", "premium");
    let err = export_security_events_scoped(
        "tok".into(),
        export_args(None, Some("2026-13-01"), None),
        app.state(),
    )
    .await
    .unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)), "got {err:?}");
}

#[tokio::test]
async fn export_refuses_below_the_premium_tier() {
    let app = app_for("user-owner", "role-owner", "plus");
    let err =
        export_security_events_scoped("tok".into(), export_args(None, None, None), app.state())
            .await
            .unwrap_err();
    assert!(
        matches!(err, AppError::PermissionDenied(_)),
        "tier gate must refuse below Premium: {err:?}"
    );
}

#[tokio::test]
async fn export_refuses_a_caller_without_audit_export() {
    let app = app_for("user-lite", "role-lite", "premium");
    let err =
        export_security_events_scoped("tok".into(), export_args(None, None, None), app.state())
            .await
            .unwrap_err();
    assert!(
        matches!(err, AppError::PermissionDenied(_)),
        "non-exporter must be refused: {err:?}"
    );
}

#[tokio::test]
async fn the_handoff_writes_a_self_audit_row_to_the_store_log() {
    let app = app_for("user-owner", "role-owner", "premium");
    export_security_events_scoped("tok".into(), export_args(None, None, None), app.state())
        .await
        .unwrap();
    // AUD-09's surface reads the store DB: the self-audit row must be
    // visible there (it is deliberately NOT in SECURITY_ACTIONS, so it
    // never re-enters this export).
    let full = export_audit_log_scoped(
        "tok".into(),
        ExportAuditLogArgs {
            outcome: None,
            query: None,
        },
        app.state(),
    )
    .await
    .unwrap();
    assert!(
        full.csv.contains("system.export"),
        "self-audit row must land in the store log"
    );
}
