use super::*;

use crate::commands::testing::{assert_refused_by_the_tier_gate, seeded_row_reaches_a_paid_tier};

#[test]
fn audit_entry_dto_debug() {
    let dto = AuditEntryDto {
        id: "e1".into(),
        user_id: "u1".into(),
        action: "sale.void".into(),
        target_type: Some("sale".into()),
        target_id: Some("s1".into()),
        details: "voided by manager".into(),
        outcome: "success".into(),
        created_at: "2026-01-15T10:00:00Z".into(),
    };
    let debug = format!("{:?}", dto);
    assert!(debug.contains("sale.void"));
    assert!(debug.contains("u1"));
}

#[test]
fn audit_entry_dto_serialize() {
    let dto = AuditEntryDto {
        id: "e1".into(),
        user_id: "u1".into(),
        action: "login".into(),
        target_type: None,
        target_id: None,
        details: "staff login".into(),
        outcome: "success".into(),
        created_at: "2026-01-15T10:00:00Z".into(),
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["id"], "e1");
    assert_eq!(json["action"], "login");
    assert!(json["target_type"].is_null());
    assert!(json["target_id"].is_null());
}

#[test]
fn audit_entry_dto_from_core_entry() {
    let entry = kasirmu_core::AuditEntry {
        id: "e2".into(),
        user_id: "u2".into(),
        action: "product.create".into(),
        target_type: Some("product".into()),
        target_id: Some("p1".into()),
        details: "created".into(),
        outcome: "success".into(),
        created_at: "2026-01-15T12:00:00Z".into(),
    };
    let dto = AuditEntryDto::from(entry);
    assert_eq!(dto.action, "product.create");
    assert_eq!(dto.target_type.unwrap(), "product");
}

#[test]
fn list_audit_log_args_deserialize_minimal() {
    let json = r#"{}"#;
    let args: ListAuditLogArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.limit, 100);
    assert_eq!(args.offset, 0);
}

#[test]
fn list_audit_log_args_deserialize_full() {
    let json = r#"{"limit": 50, "offset": 10}"#;
    let args: ListAuditLogArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.limit, 50);
    assert_eq!(args.offset, 10);
}

#[test]
fn list_audit_log_args_debug() {
    let args = ListAuditLogArgs {
        limit: 50,
        offset: 0,
    };
    let debug = format!("{:?}", args);
    assert!(debug.contains("50"));
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
    let conn = kasirmu_core::migrations::fresh_db();
    // ADR #56 §2.6: a migrated-only DB is UNPROVISIONED, so the tier stamp below would
    // silently update no row and every fixture would run as "no subscription" while its name
    // says which tier it drives. Rebuild the baseline the migration chain used to seed.
    kasirmu_core::migrations::seed_provisioned_baseline(&conn);
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
fn app_for(tier_key: &str) -> tauri::App<tauri::test::MockRuntime> {
    let conn = seeded_conn(tier_key);
    let temp_dir = tempfile::tempdir().unwrap();
    let mut state = AppState::for_test_with_conn(conn);
    state.db_manager =
        StoreDatabaseManager::new(temp_dir.path().to_path_buf(), kasirmu_core::migrations::ALL);
    state.session_store.write().unwrap().insert(
        "tok".into(),
        kasirmu_core::session::SessionContext::new(
            "user-owner".into(),
            "role-owner".into(),
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

fn page_args() -> ListAuditLogScopedArgs {
    ListAuditLogScopedArgs {
        limit: 50,
        outcome: None,
        query: None,
        before_created_at: None,
        before_id: None,
    }
}

fn security_page_args() -> ListSecurityEventsScopedArgs {
    ListSecurityEventsScopedArgs {
        limit: 50,
        outcome: None,
        query: None,
        before_created_at: None,
        before_id: None,
    }
}

#[tokio::test]
async fn list_command_passes_the_tier_gate_without_panicking() {
    // This case now carries the whole "the audit tier gate must not panic on the
    // list path" invariant. It used to have a twin aimed at the unscoped
    // `list_audit_log`, `deprecated_list_command_passes_the_tier_gate_without_panicking`,
    // which was the fifth of the five `require_audit_tier` call sites the panic touched.
    // That command was retired on 2026-09-16 (T37) -- registered in neither shell, named
    // by no production UI file, only by a dev-mock key that survives as an alias seed --
    // and its case was this one's structural duplicate: same `app_for("premium")`, same
    // assertion, different door. The free-tier refusal direction is covered by
    // `the_gate_denies_a_free_tier_session_without_panicking` below, also through the
    // scoped door. Nothing about the gate lost its test; one door that cannot be opened
    // stopped having one.
    let app = app_for("premium");
    let page = list_audit_log_scoped("tok".into(), page_args(), app.state()).await;
    if !seeded_row_reaches_a_paid_tier() {
        assert_refused_by_the_tier_gate(&page, "premium");
        return;
    }
    assert!(page.is_ok(), "{:?}", page.err());
    assert_eq!(page.unwrap().total, 0);
}

#[tokio::test]
async fn review_status_command_passes_the_tier_gate_without_panicking() {
    let app = app_for("premium");
    let status = get_audit_review_status_scoped("tok".into(), app.state()).await;
    if !seeded_row_reaches_a_paid_tier() {
        assert_refused_by_the_tier_gate(&status, "premium");
        return;
    }
    assert!(status.is_ok(), "{:?}", status.err());
}

#[tokio::test]
async fn export_command_passes_the_tier_gate_without_panicking() {
    let app = app_for("premium");
    let exported = export_audit_log_scoped(
        "tok".into(),
        ExportAuditLogArgs {
            outcome: None,
            query: None,
        },
        app.state(),
    )
    .await;
    if !seeded_row_reaches_a_paid_tier() {
        assert_refused_by_the_tier_gate(&exported, "premium");
        return;
    }
    assert!(exported.is_ok(), "{:?}", exported.err());
}

#[tokio::test]
async fn security_events_list_command_passes_the_tier_gate_without_panicking() {
    // The two security-event shims were the only doors the audit port left
    // without a tier-gate case here: the tablet-side coverage for them lived in
    // `audit_security_events_tests.rs`, whose subject was the tablet bodies that
    // moved to `kasirmu_bridge::audit`. Its replacement covers the bridge; this is
    // the shim's own fourth move, which the bridge cannot test.
    let app = app_for("premium");
    let page = list_security_events_scoped("tok".into(), security_page_args(), app.state()).await;
    if !seeded_row_reaches_a_paid_tier() {
        assert_refused_by_the_tier_gate(&page, "premium");
        return;
    }
    assert!(page.is_ok(), "{:?}", page.err());
    assert_eq!(page.unwrap().total, 0);
}

#[tokio::test]
async fn security_events_export_command_passes_the_tier_gate_without_panicking() {
    let app = app_for("premium");
    let exported = export_security_events_scoped(
        "tok".into(),
        ExportSecurityEventsArgs {
            actor: None,
            date_from: None,
            date_to: None,
        },
        app.state(),
    )
    .await;
    if !seeded_row_reaches_a_paid_tier() {
        assert_refused_by_the_tier_gate(&exported, "premium");
        return;
    }
    assert!(exported.is_ok(), "{:?}", exported.err());
}

#[tokio::test]
async fn security_events_page_denies_a_free_tier_session() {
    // The read side of the same per-client invariant the list case above pins,
    // on the security page specifically: the bridge has no below-premium case
    // for this page (its only one is on the export), so this is the case the
    // tablet's own suite was carrying when the bodies moved to kasirmu_bridge::audit.
    let app = app_for("free");
    let err = list_security_events_scoped("tok".into(), security_page_args(), app.state())
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
async fn the_gate_denies_a_free_tier_session_without_panicking() {
    // The tablet passes debug_upgrade: false to the entitlement read, so a
    // Free row really is Free here — even in a debug build. This is the
    // per-client divergence the desktop cannot test (its dev promotion turns
    // Free into Premium), and it proves the gate still refuses rather than
    // merely no longer panicking.
    let app = app_for("free");
    let denied = list_audit_log_scoped("tok".into(), page_args(), app.state()).await;
    match denied {
        Err(AppError::PermissionDenied(msg)) => assert!(
            msg.contains("Premium"),
            "expected the tier refusal, got: {msg}"
        ),
        other => panic!("expected a Premium tier refusal, got {other:?}"),
    }
}
