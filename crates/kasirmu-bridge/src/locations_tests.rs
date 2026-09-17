// Canonical location command tests. The pre-migration file also pinned the
// deprecated `store_profile` alias shapes and invoked the legacy IPC names;
// those aliases retired with the Store → Location caller migration
// (todo-global-saas-1.md slice 1c/1d), so the suite now exercises the
// canonical names only.
//! Location command tests relocated from the desktop
//! `commands/locations_tests.rs` (EW8). The scoped flows target
//! `kasirmu_bridge::locations` through the headless `TestBridge` harness;
//! serde shapes, seeding, and every assertion are unchanged from the
//! desktop originals (error variants map AppError -> BridgeError 1:1,
//! call args flip to (ctx, token, &args)).
#![allow(deprecated)]

use super::*;
use kasirmu_core::db::Store;

use crate::testing::{assert_refused_by_the_seeded_row, seeded_row_loads};

/// The release leg for a scoped command this file drives through the
//-- The release leg for these locations lives in crate::testing (RULE at assert_refused_by_the_seeded_row) --
use kasirmu_core::migrations;
use kasirmu_core::session::SessionContext;
use serde_json::json;

use crate::testing::TestBridge;

// ── DTO + args serde shapes ─────────────────────────────────────────

#[test]
fn location_profile_dto_serialize() {
    let dto = LocationProfileDto {
        id: "sp2".into(),
        name: "Branch".into(),
        address: String::new(),
        tax_id: String::new(),
        currency: "IDR".into(),
        timezone: "Asia/Jakarta".into(),
        is_primary: false,
        created_at: "2025-02-01".into(),
        updated_at: "2025-02-01".into(),
    };
    let v = serde_json::to_value(&dto).unwrap();
    assert_eq!(v["id"], "sp2");
    assert_eq!(v["name"], "Branch");
    assert_eq!(v["is_primary"], false);
    assert_eq!(v["currency"], "IDR");
    assert_eq!(v["timezone"], "Asia/Jakarta");
}

#[test]
fn create_location_args_deserialize_minimal() {
    let v = json!({"id":"sp-new","name":"New Location"});
    let args: CreateLocationArgs = serde_json::from_value(v).unwrap();
    assert_eq!(args.id, "sp-new");
    assert_eq!(args.address, None);
    assert_eq!(args.currency, None);
}

#[test]
fn create_location_args_deserialize_full() {
    let v = json!({"id":"sp-full","name":"Full Location","address":"123 Rd","tax_id":"T1","currency":"EUR","timezone":"CET"});
    let args: CreateLocationArgs = serde_json::from_value(v).unwrap();
    assert_eq!(args.currency.as_deref(), Some("EUR"));
    assert_eq!(args.timezone.as_deref(), Some("CET"));
}

#[test]
fn update_location_args_deserialize() {
    let v = json!({"id":"sp1","name":"Updated","address":"New Rd","tax_id":"T2","currency":"USD","timezone":"EST"});
    let args: UpdateLocationArgs = serde_json::from_value(v).unwrap();
    assert_eq!(args.name, "Updated");
    assert_eq!(args.address, "New Rd");
}

// ── create_location_profile_scoped flow ─────────────────────────────
//
// The scoped command resolves the session's location database and then runs
// the tenant-subscription quota gate + profile INSERT against it. These
// tests pin the end-to-end behaviour (C1.2 quota, seeded rows, permission
// gating) so the branch-creation flow cannot silently regress.

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

/// The full happy path on a fresh migrated state: the location db the session
/// resolves to already contains exactly one `default` profile row (the
/// migration seed). Debug builds mirror `get_subscription_capabilities`'s
/// dev shim — the bootstrap Free tier is upgraded to Premium before the
/// quota gate — so branch creation must SUCCEED here. This is the exact
/// flow that used to dead-end every dev user with a subscription-limit
/// rejection despite the UI reporting unlimited locations.
#[tokio::test]
async fn create_location_profile_scoped_end_to_end_owner() {
    let conn = migrations::fresh_db();
    seed_owner(&conn);
    let tb = TestBridge::new().with_conn(conn);
    tb.sessions().write().unwrap().insert(
        "owner-tok".into(),
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

    let result = create_location_profile_scoped(
        &tb.ctx(),
        "owner-tok",
        &CreateLocationArgs {
            id: "location-test-1".into(),
            name: "Second Branch".into(),
            address: None,
            tax_id: None,
            currency: None,
            timezone: None,
        },
    )
    .await;

    // Release: the create is refused at the signature, so there is no DTO and
    // the `COUNT(*) FROM locations == 2` below has no written row to count -
    // it stays debug-only rather than being re-cut into a second assertion of
    // the same cause.
    if !seeded_row_loads() {
        assert_refused_by_the_seeded_row(&tb, result, "free").await;
        return;
    }
    let created = result.unwrap();
    assert_eq!(created.id, "location-test-1");
    assert_eq!(created.name, "Second Branch");
    assert!(!created.is_primary);

    // The row must now exist in the location-scoped profile registry.
    let conn = tb.db_manager().open_store("default").unwrap();
    let count: i64 = conn
        .lock()
        .unwrap()
        .query_row("SELECT COUNT(*) FROM locations", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 2); // migration seed + the new branch
}

/// A Plus tenant allows 1 location, and the migrated location db already
/// contains the `default` profile row — so a second creation must be rejected
/// with the typed subscription-limit error (mapped to the localized plan copy
/// on the front-end), NEVER a generic Internal/Db error. Plus is used instead
/// of Free because debug builds upgrade only the bootstrap Free tier.
#[tokio::test]
async fn create_location_profile_scoped_rejects_when_plus_quota_reached() {
    let conn = migrations::fresh_db();
    seed_owner(&conn);
    let tb = TestBridge::new().with_conn(conn);
    tb.sessions().write().unwrap().insert(
        "owner-tok".into(),
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
    // Re-tier the tenant to Plus (max 1 location — already consumed by the
    // migration-seeded `default` profile). Debug builds shim only Free, so
    // this row exercises the real quota gate.
    {
        let store_conn = tb.db_manager().open_store("default").unwrap();
        store_conn
            .lock()
            .unwrap()
            .execute(
                "UPDATE tenant_subscription SET tier_key = 'plus' WHERE tenant_id = 'default'",
                [],
            )
            .unwrap();
    }

    let result = create_location_profile_scoped(
        &tb.ctx(),
        "owner-tok",
        &CreateLocationArgs {
            id: "location-test-2".into(),
            name: "Third Branch".into(),
            address: None,
            tax_id: None,
            currency: None,
            timezone: None,
        },
    )
    .await;

    // Release: this fixture re-tiers the row to plus, which by itself breaks
    // the signature over the payload, so the command refuses on the signature
    // BEFORE the quota gate can answer - the same wrong-sub_kind shape as
    // auth's tier-denial case. The assert below would otherwise read
    // "invalidsubscriptionsignature" and call it a quota bug.
    //
    // The stamp is "free" on purpose: the re-tier above writes tier_key='plus'
    // into the STORE db (db_manager().open_store("default")) - the row the quota
    // gate reads - while the pin reads the GLOBAL identity row that
    // seeded_row_loads() is about, still free and still the sentinel. Passing
    // "plus" here would assert the wrong table's fact.
    if !seeded_row_loads() {
        assert_refused_by_the_seeded_row(&tb, result, "free").await;
        return;
    }
    match result {
        // Typed quota rejection is the CORRECT outcome (mapped to the
        // subscription error copy on the front-end).
        Err(BridgeError::Core { sub_kind, .. }) => {
            assert_eq!(
                format!("{sub_kind:?}").to_lowercase(),
                "subscriptionlimitexceeded"
            );
        }
        other => panic!("expected typed subscription-limit rejection, got: {other:?}"),
    }
}

/// A staff session without `settings:edit` must be denied — typed
/// PermissionDenied, not Internal.
#[tokio::test]
async fn create_location_profile_scoped_denies_staff_without_settings_edit() {
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
    let tb = TestBridge::new().with_conn(conn);
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

    let result = create_location_profile_scoped(
        &tb.ctx(),
        "lite-tok",
        &CreateLocationArgs {
            id: "location-test-3".into(),
            name: "Staff Branch".into(),
            address: None,
            tax_id: None,
            currency: None,
            timezone: None,
        },
    )
    .await;

    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

// ── ADR #47 resource-scope gating ───────────────────────────────────

/// Seed a manager user whose assignment is location-scoped to
/// `location_id`. `scope_mode` stays `global` so the spec-0048
/// branch/workspace axis passes any session context and the ADR #47
/// resource gate is exercised in isolation.
fn seed_location_scoped_manager(conn: &rusqlite::Connection, location_id: &str) {
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at)
         VALUES ('role-manager', 'Manager', 'Location manager', '[\"settings:edit\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-manager', 'manager', 'hash', 'Manager', 'role-manager', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
    conn.execute(
        "INSERT INTO assignments (user_id, role_id, scope_mode, branch_scope, workspace_scope, scope_type, scope_id)
         VALUES ('user-manager', 'role-manager', 'global', 'all', 'all', 'location', ?1)",
        [location_id],
    )
    .unwrap();
}

fn manager_session(tb: &TestBridge, token: &str) {
    tb.sessions().write().unwrap().insert(
        token.to_string(),
        SessionContext::new(
            "user-manager".into(),
            "role-manager".into(),
            "terminal-1".into(),
            "default".into(),
            "instance-1".into(),
            "pos".into(),
            None,
            0,
        ),
    );
}

/// ADR #47 ruling-3 pin: a manager assigned to location A cannot update
/// location B. The branch/workspace axis deliberately passes (global
/// scope_mode), so the typed denial can only come from the resource
/// scope — the gate this slice added.
#[tokio::test]
async fn update_location_profile_scoped_denies_manager_of_other_location() {
    let conn = migrations::fresh_db();
    seed_location_scoped_manager(&conn, "loc-a");
    let tb = TestBridge::new().with_conn(conn);
    manager_session(&tb, "mgr-tok");

    let result = update_location_profile_scoped(
        &tb.ctx(),
        "mgr-tok",
        &UpdateLocationArgs {
            id: "loc-b".into(),
            name: "Hostile Rename".into(),
            address: "1 Elsewhere".into(),
            tax_id: String::new(),
            currency: "USD".into(),
            timezone: "UTC".into(),
        },
    )
    .await;

    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

/// The mirror pin: the SAME manager CAN update the location their
/// assignment covers (here `default`, whose profile row exists in the
/// session's migrated location db) — the gate narrows scoped roles, it
/// does not blanket-deny them.
#[tokio::test]
async fn update_location_profile_scoped_allows_manager_of_own_location() {
    let conn = migrations::fresh_db();
    seed_location_scoped_manager(&conn, "default");
    let tb = TestBridge::new().with_conn(conn);
    manager_session(&tb, "mgr-tok");

    let result = update_location_profile_scoped(
        &tb.ctx(),
        "mgr-tok",
        &UpdateLocationArgs {
            id: "default".into(),
            name: "Renamed Flagship".into(),
            address: "1 Main St".into(),
            tax_id: String::new(),
            currency: "USD".into(),
            timezone: "UTC".into(),
        },
    )
    .await;

    let updated = result.expect("own-location update must pass the resource gate");
    assert_eq!(updated.name, "Renamed Flagship");
}

/// Slice-4 (ADR #48, Decision 2): the regional write boundary rejects any
/// timezone outside the three Indonesian IANA presets. UTC is the only accepted
/// non-preset value, as the legacy column default for un-migrated rows.
#[tokio::test]
async fn update_location_profile_scoped_rejects_unsupported_timezone() {
    let conn = migrations::fresh_db();
    seed_location_scoped_manager(&conn, "default");
    let tb = TestBridge::new().with_conn(conn);
    manager_session(&tb, "mgr-tok");

    let result = update_location_profile_scoped(
        &tb.ctx(),
        "mgr-tok",
        &UpdateLocationArgs {
            id: "default".into(),
            name: "Renamed Flagship".into(),
            address: "1 Main St".into(),
            tax_id: String::new(),
            currency: "USD".into(),
            timezone: "Europe/Berlin".into(),
        },
    )
    .await;

    assert!(matches!(result, Err(BridgeError::Invalid(_))));
}
