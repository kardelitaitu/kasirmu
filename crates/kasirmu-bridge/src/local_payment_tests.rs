//! Tests for the local payment method commands (slice 6).
//!
//! Relocated from `apps/desktop-tauri/src/commands/local_payment_tests.rs`
//! (Wave F); the tauri `flow_state`/`mock_app` pair becomes `TestBridge`
//! with an isolated store-db manager over a unique temp directory.

use super::*;
use crate::testing::TestBridge;
use kasirmu_core::migrations;
use kasirmu_core::regional::ConfigScope;
use kasirmu_core::session::SessionContext;
use platform_core::StoreDatabaseManager;

/// Seed roles + the owner user (full permissions) into the global DB.
fn seed_owner(conn: &rusqlite::Connection) {
    let store = Store::new(conn);
    store.seed_default_roles().unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();
}

static STORE_DIR_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Unique store-db directory per test - the mechanical twin of the desktop
/// `flow_state`'s `tempfile::tempdir().unwrap().keep()`.
fn unique_store_dir() -> std::path::PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!(
        "kasirmu-bridge-local-payment-{}-{}-{}",
        std::process::id(),
        nanos,
        STORE_DIR_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ))
}

/// `TestBridge` with a fresh migrated global DB and an isolated store-db
/// manager over a unique directory - the bridge twin of the desktop
/// `flow_state` + `mock_app` pair.
fn flow_bridge(conn: rusqlite::Connection) -> TestBridge {
    TestBridge::new()
        .with_conn(conn)
        .with_db_manager(StoreDatabaseManager::new(
            unique_store_dir(),
            migrations::ALL,
        ))
}

fn owner_session(tb: &TestBridge, token: &str) {
    tb.sessions().write().unwrap().insert(
        token.to_string(),
        SessionContext::new(
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
}

#[tokio::test]
async fn set_then_get_round_trips_the_rail_surface() {
    let conn = migrations::fresh_db();
    seed_owner(&conn);
    let tb = flow_bridge(conn);
    owner_session(&tb, "owner-tok");

    let effective = set_local_payment_methods_scoped(
        &tb.ctx(),
        "default",
        vec![LocalPaymentRailArgs {
            rail_code: "qris".into(),
            label: "QRIS".into(),
            is_enabled: true,
            parameters: "{}".into(),
        }],
        "owner-tok",
    )
    .await
    .unwrap();

    assert_eq!(effective.len(), 1);
    assert_eq!(effective[0].rail_code, "qris");
    assert_eq!(effective[0].scope, ConfigScope::Location);

    // A plain read (slice-6 read command) must agree with the write's
    // read-back.
    let again = get_local_payment_methods_scoped(&tb.ctx(), "default", "owner-tok")
        .await
        .unwrap();
    assert_eq!(again, effective);
}

#[tokio::test]
async fn write_rejects_credential_shaped_parameters_as_validation() {
    let conn = migrations::fresh_db();
    seed_owner(&conn);
    let tb = flow_bridge(conn);
    owner_session(&tb, "owner-tok");

    let result = set_local_payment_methods_scoped(
        &tb.ctx(),
        "default",
        vec![LocalPaymentRailArgs {
            rail_code: "qris".into(),
            label: "QRIS".into(),
            is_enabled: true,
            parameters: r#"{"gateway_credential": "x"}"#.into(),
        }],
        "owner-tok",
    )
    .await;

    match result {
        Err(BridgeError::Core { sub_kind, .. }) => {
            assert!(
                matches!(sub_kind, kasirmu_core::CoreErrorKind::Validation),
                "{sub_kind:?}"
            );
        }
        other => panic!("expected typed Validation rejection, got: {other:?}"),
    }
}

#[tokio::test]
async fn read_answers_empty_for_a_location_with_no_market_rows() {
    let conn = migrations::fresh_db();
    seed_owner(&conn);
    let tb = flow_bridge(conn);
    owner_session(&tb, "owner-tok");

    let rails = get_local_payment_methods_scoped(&tb.ctx(), "default", "owner-tok")
        .await
        .unwrap();
    assert!(rails.is_empty());
}

#[tokio::test]
async fn denies_staff_without_settings_edit() {
    let conn = migrations::fresh_db();
    {
        let store = Store::new(&conn);
        store.seed_default_roles().unwrap();
    }
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at)
         VALUES ('role-lite', 'Lite', 'Limited', '[\"sales:view\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-lite', 'lite', 'hash', 'Lite User', 'role-lite', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
    let tb = flow_bridge(conn);
    tb.sessions().write().unwrap().insert(
        "lite-tok".into(),
        SessionContext::new(
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

    let result = set_local_payment_methods_scoped(
        &tb.ctx(),
        "default",
        vec![LocalPaymentRailArgs {
            rail_code: "qris".into(),
            label: "QRIS".into(),
            is_enabled: true,
            parameters: "{}".into(),
        }],
        "lite-tok",
    )
    .await;

    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

#[test]
fn rail_args_accept_the_snake_case_wire_the_ui_sends() {
    // The regression this closes (2026-09-13): the DTO carried
    // `rename_all = "camelCase"` from slice 6, but the only caller —
    // the local-payment settings card's save handler — has always sent
    // snake_case (`rail_code`, `is_enabled`, verified back to c549f7e5ab).
    // Tauri does not case-fold, so the real save path failed with
    // `missing field 'railCode'` on every submission, on desktop AND
    // tablet. This test pins the exact wire payload the card builds.
    let json = r#"[{"rail_code":"qris","label":"QRIS","is_enabled":true,"parameters":"{}"}]"#;
    let rails: Vec<LocalPaymentRailArgs> = serde_json::from_str(json).unwrap();
    assert_eq!(rails[0].rail_code, "qris");
    assert!(rails[0].is_enabled);
    assert_eq!(rails[0].parameters, "{}");
}

#[test]
fn rail_args_still_accept_the_camelcase_alias() {
    // Back-compat for any caller that adopted the (never-wire-proven)
    // camelCase shape: the alias keeps it working rather than breaking
    // a second time in the opposite direction.
    let json = r#"[{"railCode":"va-bca","label":"BCA VA","isEnabled":false,"parameters":""}]"#;
    let rails: Vec<LocalPaymentRailArgs> = serde_json::from_str(json).unwrap();
    assert_eq!(rails[0].rail_code, "va-bca");
    assert!(!rails[0].is_enabled);
}
