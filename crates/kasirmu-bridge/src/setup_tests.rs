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
    // is absent". Note what this CANNOT be fooled by: no row and no legacy
    // dismissal key, which is a fresh install exactly.
    let tb = TestBridge::new();
    let state = get_first_run_state(&tb.ctx(), "dev-1").await.unwrap();
    assert!(matches!(state, FirstRunStateDto::Unprovisioned));
}

#[tokio::test]
async fn the_retired_setup_keys_cannot_forge_a_provisioned_terminal() {
    // The counter-example that makes the test above worth having. `SETUP_COMPLETE`
    // is the retired wizard's other boolean and must move nothing; the legacy
    // dismissal key is NOT set here, so this is also the "the key is absent"
    // leg — see `a_terminal_with_no_legacy_signal_is_never_backfilled`.
    let tb = TestBridge::new();
    {
        let ctx = tb.ctx();
        let db = ctx.lock_global().await;
        Settings::set(&db, kasirmu_core::settings::keys::SETUP_COMPLETE, "1").unwrap();
    }

    let state = get_first_run_state(&tb.ctx(), "dev-1").await.unwrap();
    assert!(
        matches!(state, FirstRunStateDto::Unprovisioned),
        "ADR #56 §2.1: the row is the gate, so no legacy key may forge a provisioned terminal"
    );
}

// ── The runtime legacy backfill ─────────────────────────────────────
//
// The SQL migration 20261008 does the same job from SQL, keyed on
// `terminals.device_id`. It cannot help a legacy install that never registered a
// terminal row — which is exactly the device that reported this bug — because
// SQL cannot read the hostname the shell gates on. `get_first_run_state` is
// handed that hostname, so the backfill runs there. The three legs below mirror
// the migration's own tests (`migrations_tests.rs`):
//   legacy_setup_backfills_a_provisioning_row_only_for_terminals_the_wizard_set_up
//   a_terminal_without_the_legacy_signal_is_never_backfilled

/// Plant the legacy-only signal the two retired commands wrote.
async fn plant_legacy_dismissal(tb: &TestBridge) {
    let ctx = tb.ctx();
    let db = ctx.lock_global().await;
    Settings::set(
        &db,
        kasirmu_core::settings::keys::SHOW_SETUP_WIZARD,
        "false",
    )
    .unwrap();
}

/// Count the provisioning rows for one terminal, straight from the table.
async fn provisioning_rows(tb: &TestBridge, terminal_id: &str) -> i64 {
    let ctx = tb.ctx();
    let db = ctx.lock_global().await;
    db.query_row(
        "SELECT COUNT(*) FROM provisioning WHERE terminal_id = ?1",
        [terminal_id],
        |r| r.get(0),
    )
    .unwrap()
}

#[tokio::test]
async fn a_legacy_setup_device_is_backfilled_and_reads_as_provisioned() {
    // The bug this closes, in the shape the real device has: a fully set-up,
    // signed-in legacy install with NO `terminals` row at all, so the SQL
    // migration has nothing to key on and inserts nothing for it.
    let tb = TestBridge::new();
    plant_legacy_dismissal(&tb).await;

    let state = get_first_run_state(&tb.ctx(), "legacy-host").await.unwrap();
    match state {
        FirstRunStateDto::Provisioned {
            location_id,
            owner_user_id,
            mode,
            home_region,
            tenant_id,
        } => {
            // Exactly the migration's row shape for its legacy case: `local`,
            // residency `global`, and NULL tenant/owner/location because the
            // legacy install had none of those facts to claim.
            assert_eq!(mode, "local");
            assert_eq!(home_region, "global");
            assert_eq!(tenant_id, None);
            assert_eq!(owner_user_id, None);
            assert_eq!(location_id, None);
        }
        FirstRunStateDto::Unprovisioned => {
            panic!("a legacy device whose wizard completed must not re-enter onboarding")
        }
    }

    assert_eq!(
        provisioning_rows(&tb, "legacy-host").await,
        1,
        "the row is what the next boot reads; the state alone would not persist"
    );
}

#[tokio::test]
async fn a_terminal_with_no_legacy_signal_is_never_backfilled() {
    // The leg that protects a GENUINELY NEW install: no key at all, which is
    // what a fresh ADR-#56 database looks like (`provision_device` never writes
    // this key and no migration seeds one). A forged row here would silently
    // skip onboarding — strictly worse than the bug being fixed.
    let tb = TestBridge::new();
    assert!(matches!(
        get_first_run_state(&tb.ctx(), "new-host").await.unwrap(),
        FirstRunStateDto::Unprovisioned
    ));
    assert_eq!(provisioning_rows(&tb, "new-host").await, 0);

    // A present-but-not-`"false"` value is the wizard's "show me" state, not a
    // completion. `store.setup_complete` is the CLI's DIFFERENT key and is not
    // the dismissal either.
    {
        let ctx = tb.ctx();
        let db = ctx.lock_global().await;
        Settings::set(&db, kasirmu_core::settings::keys::SHOW_SETUP_WIZARD, "true").unwrap();
        Settings::set(&db, kasirmu_core::settings::keys::SETUP_COMPLETE, "true").unwrap();
    }
    assert!(
        matches!(
            get_first_run_state(&tb.ctx(), "new-host").await.unwrap(),
            FirstRunStateDto::Unprovisioned
        ),
        "only 'false' is the dismissal the retired commands wrote"
    );
    assert_eq!(provisioning_rows(&tb, "new-host").await, 0);
}

#[tokio::test]
async fn the_legacy_backfill_is_idempotent_and_never_overwrites() {
    // Boot happens many times per device, so the backfill must be a no-op after
    // the first write. A duplicate is impossible (`terminal_id` is the PRIMARY
    // KEY) and an overwrite is what this pins: the row a real provisioning run
    // wrote must survive a legacy-keyed re-read untouched.
    let tb = TestBridge::new();
    plant_legacy_dismissal(&tb).await;

    get_first_run_state(&tb.ctx(), "legacy-host").await.unwrap();
    let first = {
        let ctx = tb.ctx();
        let db = ctx.lock_global().await;
        db.query_row(
            "SELECT provisioned_at FROM provisioning WHERE terminal_id = 'legacy-host'",
            [],
            |r| r.get::<_, String>(0),
        )
        .unwrap()
    };

    let second = get_first_run_state(&tb.ctx(), "legacy-host").await.unwrap();
    assert!(matches!(second, FirstRunStateDto::Provisioned { .. }));
    assert_eq!(
        provisioning_rows(&tb, "legacy-host").await,
        1,
        "a second boot must not duplicate the row"
    );
    let again = {
        let ctx = tb.ctx();
        let db = ctx.lock_global().await;
        db.query_row(
            "SELECT provisioned_at FROM provisioning WHERE terminal_id = 'legacy-host'",
            [],
            |r| r.get::<_, String>(0),
        )
        .unwrap()
    };
    assert_eq!(
        first, again,
        "the existing row must be replayed, not rewritten"
    );

    // And the other direction: a terminal a REAL provisioning run already set up
    // keeps its tenant/owner even though the legacy key is also present.
    let conn = fresh_conn();
    seed_refs(&conn);
    Store::new(&conn)
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
    plant_legacy_dismissal(&tb).await;
    match get_first_run_state(&tb.ctx(), "dev-1").await.unwrap() {
        FirstRunStateDto::Provisioned {
            owner_user_id,
            location_id,
            ..
        } => {
            assert_eq!(owner_user_id.as_deref(), Some("user-1"));
            assert_eq!(location_id.as_deref(), Some("loc-1"));
        }
        FirstRunStateDto::Unprovisioned => panic!("an existing row must read as provisioned"),
    }
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
