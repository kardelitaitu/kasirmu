//! Tests for the bridge's setup / first-run provisioning surface (ADR #56).
//!
//! This file REPLACED a suite built around `complete_setup` and the two setup
//! booleans. Those are retired (§2.2), so their tests could not survive — but
//! the properties they pinned did not all belong to the command, and the ones
//! that did not are kept below.
//!
//! What is deliberately NOT re-tested here: the provisioning transaction. It
//! is covered by 21 tests in `kasirmu_core::db::provisioning` — the guard, the
//! replay, the rollback, both schema CHECKs and the workspace topology.
//! Re-asserting it through this shim would be the mirrored-copy failure mode
//! this module's own history warns about.

use super::*;
use crate::testing::TestBridge;

fn fresh_conn() -> rusqlite::Connection {
    crate::testing::temp_conn()
}

/// Seed the two rows `provisioning` carries foreign keys to.
///
/// `provisioning.location_id` REFERENCES `locations(id)` and
/// `owner_user_id` REFERENCES `users(id)`, so a fixture naming an unseeded id
/// is refused by SQLite — which is the constraint working, not an obstacle to
/// route around.
fn seed_refs(conn: &rusqlite::Connection) {
    conn.execute_batch(
        "INSERT INTO locations (id, name) VALUES ('loc-1', 'Main');
         INSERT INTO roles (id, name) VALUES ('owner', 'Owner');
         INSERT INTO users (id, username, pin_hash, display_name, role_id) VALUES ('user-1', 'owner', 'x', 'Owner', 'owner');",
    )
    .unwrap();
}

// ── The derived first-run state (ADR #56 §2.1) ──────────────────────

#[tokio::test]
async fn first_run_state_is_unprovisioned_with_no_row() {
    // The replacement for "get_setup_status returns not completed when the key
    // is absent". Note what this CANNOT be fooled by: there is no key to set,
    // so a caller cannot reach `provisioned` by writing a setting.
    let tb = TestBridge::new();
    let state = get_first_run_state(&tb.ctx(), "dev-1").await.unwrap();
    assert!(matches!(state, FirstRunStateDto::Unprovisioned));
}

#[tokio::test]
async fn the_retired_setup_keys_cannot_forge_a_provisioned_terminal() {
    // The counter-example that makes the test above worth having. These are the
    // exact two writes the retired commands performed (`SETUP_COMPLETE` and
    // `SHOW_SETUP_WIZARD`); neither may move the derived state. If a future
    // refactor reintroduced a boolean fallback, this is what catches it.
    let tb = TestBridge::new();
    {
        let ctx = tb.ctx();
        let db = ctx.lock_global().await;
        Settings::set(
            &db,
            kasirmu_core::settings::keys::SHOW_SETUP_WIZARD,
            "false",
        )
        .unwrap();
        Settings::set(&db, kasirmu_core::settings::keys::SETUP_COMPLETE, "1").unwrap();
    }

    let state = get_first_run_state(&tb.ctx(), "dev-1").await.unwrap();
    assert!(
        matches!(state, FirstRunStateDto::Unprovisioned),
        "ADR #56 §2.1: the row is the gate, so no legacy key may forge a provisioned terminal"
    );
}

#[tokio::test]
async fn a_provisioning_row_is_what_makes_a_terminal_provisioned() {
    // The positive leg, and the only one that can produce `Provisioned`: the
    // gate reads a real row through the same accessor the shell's command uses.
    let conn = fresh_conn();
    seed_refs(&conn);
    let store = Store::new(&conn);
    store
        .provision_terminal(&kasirmu_core::db::provisioning::ProvisioningRecord {
            terminal_id: "dev-1".into(),
            tenant_id: None,
            location_id: Some("loc-1".into()),
            owner_user_id: Some("user-1".into()),
            device_id: None,
            mode: kasirmu_core::db::provisioning::ProvisioningMode::Local,
            home_region: "global".into(),
            provisioned_at: String::new(),
        })
        .unwrap();

    let tb = TestBridge::new().with_conn(conn);
    let state = get_first_run_state(&tb.ctx(), "dev-1").await.unwrap();
    match state {
        FirstRunStateDto::Provisioned {
            location_id,
            owner_user_id,
            mode,
            home_region,
            tenant_id,
        } => {
            assert_eq!(location_id.as_deref(), Some("loc-1"));
            assert_eq!(owner_user_id.as_deref(), Some("user-1"));
            assert_eq!(mode, "local");
            assert_eq!(home_region, "global");
            assert_eq!(tenant_id, None);
        }
        FirstRunStateDto::Unprovisioned => panic!("a stored row must read as provisioned"),
    }
}

#[tokio::test]
async fn the_gate_is_keyed_per_terminal() {
    // §5 Q4: a tablet can be replaced independently of the store, so the
    // question is per-device. Provisioning one must not answer for its
    // neighbour — the failure this prevents is a second terminal silently
    // inheriting the first one's setup.
    let conn = fresh_conn();
    seed_refs(&conn);
    Store::new(&conn)
        .provision_terminal(&kasirmu_core::db::provisioning::ProvisioningRecord {
            terminal_id: "dev-1".into(),
            tenant_id: None,
            location_id: Some("loc-1".into()),
            owner_user_id: None,
            device_id: None,
            mode: kasirmu_core::db::provisioning::ProvisioningMode::Local,
            home_region: "global".into(),
            provisioned_at: String::new(),
        })
        .unwrap();

    let tb = TestBridge::new().with_conn(conn);
    assert!(matches!(
        get_first_run_state(&tb.ctx(), "dev-1").await.unwrap(),
        FirstRunStateDto::Provisioned { .. }
    ));
    assert!(matches!(
        get_first_run_state(&tb.ctx(), "dev-2").await.unwrap(),
        FirstRunStateDto::Unprovisioned
    ));
}

// ── Enabled features (unchanged surface) ────────────────────────────

#[tokio::test]
async fn enabled_features_reads_the_feature_registry() {
    let conn = fresh_conn();
    let tb = TestBridge::new().with_conn(conn);
    // A fresh store has no enabled features; the read must answer, not fail.
    let result = get_enabled_features(&tb.ctx()).await.unwrap();
    assert!(result.features.is_empty());
}
