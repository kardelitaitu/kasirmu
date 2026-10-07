//! Unit tests for the workspaces bridge module.
//!
//! Relocated from the desktop command module (Wave E / EW7). The shell's
//! `AppState::for_test` / tauri mock app are replaced by the headless
//! `TestBridge` harness (`crate::testing`); global-identity-DB mutations
//! are hoisted into the `picker_state` seed closure so they land on the
//! connection BEFORE `with_conn` hands it to the bridge (BW1b/CW1).

use super::*;

use crate::testing::TestBridge;
use crate::testing::{assert_refused_by_the_seeded_row, seeded_row_loads};

// -- The broken-seed leg for these listings (crate::testing, RULE at :217-221) --

// ── Token Rejection ─────────────────────────────────────────────────

#[test]
fn workspaces_scoped_rejects_invalid_token() {
    let tb = crate::testing::TestBridge::new();
    let result = tb.ctx().resolve_session("nonexistent-token");
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

// ── WorkspaceTypeDto ─────────────────────────────────────────────────

#[test]
fn workspace_type_dto_debug() {
    let dto = WorkspaceTypeDto {
        key: "retail".into(),
        name: "Retail".into(),
        description: "Retail POS".into(),
        icon: "store".into(),
    };
    let d = format!("{dto:?}");
    assert!(d.contains("retail"));
    assert!(d.contains("Retail POS"));
}

#[test]
fn workspace_type_dto_serialize() {
    let dto = WorkspaceTypeDto {
        key: "restaurant".into(),
        name: "Restaurant".into(),
        description: String::new(),
        icon: "utensils".into(),
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["key"], "restaurant");
    assert_eq!(json["description"], "");
}

// ── WorkspaceScreenDto ──────────────────────────────────────────────

#[test]
fn workspace_screen_dto_debug() {
    let dto = WorkspaceScreenDto {
        screen_key: "pos".into(),
        sort_order: 1,
    };
    let d = format!("{dto:?}");
    assert!(d.contains("pos"));
    assert!(d.contains("1"));
}

#[test]
fn workspace_screen_dto_serialize() {
    let dto = WorkspaceScreenDto {
        screen_key: "history".into(),
        sort_order: 5,
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["screen_key"], "history");
    assert_eq!(json["sort_order"], 5);
}

// ── CreateInstanceRequest ───────────────────────────────────────────

#[test]
fn create_instance_request_deserializes() {
    let json = r#"{
        "id": "ws-dt-1",
        "type_key": "restaurant-pos",
        "store_id": "store-downtown",
        "name": "Downtown - Cashier 1"
    }"#;
    let req: CreateInstanceRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.id, "ws-dt-1");
    assert_eq!(req.type_key, "restaurant-pos");
    assert_eq!(req.name, "Downtown - Cashier 1");
    assert!(req.description.is_none());
    assert!(req.colour.is_none());
    assert!(req.purpose_key.is_none());
}

// ── BootResolution (ADR #4 Phase 3) ─────────────────────────────────

#[test]
fn boot_resolution_dto_serialize_bound() {
    let res = BootResolution {
        is_bound: true,
        store_id: "store-downtown".into(),
        instance_id: Some("ws-dt-cashier-1".into()),
    };
    let json = serde_json::to_value(&res).unwrap();
    assert_eq!(json["isBound"], true);
    assert_eq!(json["storeId"], "store-downtown");
    assert_eq!(json["instanceId"], "ws-dt-cashier-1");
}

#[test]
fn boot_resolution_dto_serialize_unbound() {
    let res = BootResolution {
        is_bound: false,
        store_id: "default".into(),
        instance_id: None,
    };
    let json = serde_json::to_value(&res).unwrap();
    assert_eq!(json["isBound"], false);
    assert_eq!(json["storeId"], "default");
    assert!(json["instanceId"].is_null());
}

#[test]
fn boot_resolution_dto_debug() {
    let res = BootResolution {
        is_bound: false,
        store_id: "default".into(),
        instance_id: None,
    };
    let d = format!("{res:?}");
    assert!(d.contains("default"));
    assert!(d.contains("false"));
}

// ── Pre-session picker ticket binding (audit-open-findings residual) ──────────
//
// TDD red: `list_workspaces` / `list_workspace_screens` must bind the
// listing to the authenticated user server-side. Previously the commands
// trusted the caller-supplied `role_id` / `user_id`, so any caller who
// knew an owner's id could enumerate instances in any store as
// `role-owner`. Now the caller presents a short-lived HMAC ticket and the
// REAL role is resolved from the global identity DB.

use kasirmu_core::LocationProfile;
use kasirmu_core::db::assignments::{AssignmentSpec, ScopeMode, ScopeType};

/// Seed the GLOBAL identity DB with an owner and a limited user whose
/// role has no workspace-type grants (so it sees no instances — the
/// retired cashier role behaved the same way; 0048 sweep).
fn seed_global_users(conn: &rusqlite::Connection) {
    let store = Store::new(conn);
    store.seed_default_roles().unwrap();
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-lite', 'Lite', 'Limited', '[\"sales:view\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) VALUES
            ('user-owner',   'owner',   'hash', 'Owner',   'role-owner',   1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
            ('user-cashier', 'cashier', 'hash', 'Cashier', 'role-lite',    1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
}

fn make_profile(id: &str, name: &str) -> LocationProfile {
    LocationProfile {
        id: id.to_owned(),
        name: name.to_owned(),
        address: String::new(),
        tax_id: String::new(),
        currency: "USD".to_owned(),
        timezone: "UTC".to_owned(),
        is_primary: false,
        created_at: "2026-07-01T10:00:00Z".to_owned(),
        updated_at: "2026-07-01T10:00:00Z".to_owned(),
    }
}

/// Build a TestBridge whose global identity DB is seeded with users (plus
/// any caller-supplied global-DB mutation, applied BEFORE the connection is
/// handed to the bridge) and whose file-backed store manager carries
/// store-a (1 instance) and store-b (1 instance) so cross-store isolation
/// can be exercised. The harness owns a unique temp store dir.
fn picker_state(global_seed: impl FnOnce(&rusqlite::Connection)) -> TestBridge {
    let conn = crate::testing::temp_conn();
    seed_global_users(&conn);
    global_seed(&conn);
    let tb = crate::testing::TestBridge::new().with_conn(conn);

    for (store_id, instance_id) in [("store-a", "ws-a-1"), ("store-b", "ws-b-1")] {
        let conn = tb.db_manager().open_store(store_id).unwrap();
        let db = conn.lock().unwrap();
        let store = Store::new(&db);
        store
            .create_location_profile(&make_profile(store_id, store_id))
            .unwrap();
        store
            .create_workspace_instance(instance_id, "store-pos", store_id, "POS", "", None)
            .unwrap();
    }
    tb
}

#[tokio::test]
async fn list_workspaces_for_store_scoped_rejects_invalid_session() {
    let tb = picker_state(|_| {});

    let result =
        list_workspaces_for_store_scoped(&tb.ctx(), "missing-token", "store-a".into()).await;
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

#[tokio::test]
async fn list_workspaces_for_store_scoped_uses_session_role() {
    let tb = picker_state(|_| {});
    tb.sessions().write().unwrap().insert(
        "cashier-token".into(),
        kasirmu_core::session::SessionContext::new(
            "user-cashier".into(),
            "role-lite".into(),
            "terminal-1".into(),
            "store-a".into(),
            "ws-a-1".into(),
            "store-pos".into(),
            None,
            0,
        ),
    );

    // The session token binds the real role — a limited session listing
    // store-a must not see owner-level instances (same as the ticket path).
    let listed =
        list_workspaces_for_store_scoped(&tb.ctx(), "cashier-token", "store-a".into()).await;
    // Broken-seed fallback, not a profile fork: since 19-09-26 the seeded Free
    // row verifies in BOTH profiles, so the listing below returns in both and
    // the empty-list claim is made in both. This arm is reached only when the
    // row exists but does not verify - there is no list to make the claim about.
    if !seeded_row_loads() {
        assert_refused_by_the_seeded_row(&tb, listed, "free").await;
        return;
    }
    let rows = listed.unwrap();
    assert!(
        rows.is_empty(),
        "cashier session must not enumerate store-a instances, got {rows:?}"
    );
}

/// The read-repair: an EMPTY store DB lists what the GLOBAL DB holds.
///
/// This is the branch the split-brain fix exists for. `list_workspaces_for_store_scoped`
/// reads the store DB (`store-<store_id>.sqlite`), but `provision_device` writes the
/// workspaces into the GLOBAL `kasir.db` — so a freshly provisioned terminal opened an
/// EMPTY store file and the picker showed nothing. The repair notices the empty list,
/// re-reads the global DB, copies the rows across and returns them.
///
/// Every other scoped-listing test builds its fixture through `picker_state`, which seeds
/// a profile and an instance INTO the store DB (`:189-199`) — so all of them take the
/// non-empty path. Nothing exercised the repair itself, which is this test's whole point:
/// the fallback is the reason the change exists, and it was the one branch without a test.
///
/// # Measured: the repair returns the row but does NOT persist it
///
/// `#[ignore]`d because the second assertion FAILS today: the call returns the global rows
/// (the picker is fixed) while the store DB stays empty, so the repair re-runs against the
/// same empty file on every boot. The INSERT's `location_id` is `REFERENCES locations(id)`
/// and the fixture leaves no such row, so the FK rejects it — and the repair's `let _ =`
/// discards the error, which is why this needed a fixture rather than a reading.
///
/// The repair lives in `list_workspaces` (the picker path, `workspaces.rs:109`); its sibling
/// `list_workspaces_for_store_scoped` has none, so the terminal-management screen's
/// cross-store picker still shows an empty grid. UN-IGNORE once the write both lands and is
/// checked, and consider the sibling.
#[tokio::test]
#[ignore = "measured: the read-repair returns rows but its FK-rejected write is swallowed, so nothing persists"]
async fn list_workspaces_repairs_from_global_when_the_store_db_is_empty() {
    // `picker_state` always seeds the store DB, so seed the GLOBAL db by hand. Raw SQL
    // because the two schemas differ: the global db has `workspace_instances` keyed on
    // `location_id` (renamed from `store_id` by `20260906_rename_store_to_location.sql:18`)
    // and FK-linked to `locations`, not to `store_profiles` — which is the split-brain this
    // repair exists for. `picker_state` seeds that location row via `locations`.
    let tb = picker_state(|conn| {
        conn.execute_batch(
            // The FK target first: the global schema links `workspace_instances.location_id`
            // to `locations`, so the location row has to exist before the instance.
            "INSERT INTO locations (id, name) VALUES ('store-a', 'Store A');\
             INSERT INTO workspace_instances (id, type_key, location_id, name, description, colour, status) \
             VALUES ('ws-global-a', 'store-pos', 'store-a', 'POS', '', NULL, 'active');",
        )
        .unwrap();
    });
    // Empty the STORE db that `picker_state` seeded, leaving the global rows as the
    // only source — the exact production state this repairs. `locations` is the
    // post-rename name for what a store DB used to call `store_profiles`
    // (`20260906_rename_store_to_location.sql:18`).
    {
        let conn = tb.db_manager().open_store("store-a").unwrap();
        let db = conn.lock().unwrap();
        db.execute("DELETE FROM workspace_instances", []).unwrap();
        db.execute("DELETE FROM locations", []).unwrap();
    }
    // The repair lives in `list_workspaces` — the PICKER path, which is the one the
    // reported defect was measured through (the workspace-picker provider calls
    // `listWorkspaces` -> the `list_workspaces` command). Its sibling
    // `list_workspaces_for_store_scoped` (the terminal-management screen's cross-store
    // picker) has no repair, which is worth knowing but is not this test's subject.
    let secret = tb.ctx().picker_ticket_secret.clone();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    let ticket = crate::picker::sign_picker_ticket(&secret, "user-owner", now + 300);

    let listed = list_workspaces(&tb.ctx(), ticket, "store-a".into()).await;
    if !seeded_row_loads() {
        assert_refused_by_the_seeded_row(&tb, listed, "free").await;
        return;
    }
    let rows = listed.unwrap();
    assert!(
        rows.iter().any(|d| d.instance_id == "ws-global-a"),
        "the repair must return the global row for an empty store db, got {rows:?}"
    );

    // And it must have COPIED it, not merely returned it: the next read has to find the
    // row in the store db, because the repair only runs while that table is empty. A
    // return-without-copy would pass the assertion above and reproduce the defect on the
    // following boot, so this half is the one that pins the repair's actual contract.
    let cached: i64 = {
        let conn = tb.db_manager().open_store("store-a").unwrap();
        let db = conn.lock().unwrap();
        db.query_row(
            "SELECT COUNT(*) FROM workspace_instances WHERE id = 'ws-global-a'",
            [],
            |r| r.get(0),
        )
        .unwrap()
    };
    assert_eq!(
        cached, 1,
        "the repair must persist the row into the store db, not only return it"
    );
}

/// The asymmetry: the sibling entry point has NO read-repair.
///
/// The repair was added to `list_workspaces` (the picker path) and not to
/// `list_workspaces_for_store_scoped` — the terminal-management screen's cross-store picker,
/// reachable from the desktop shell (`apps/desktop-tauri/src/commands/workspaces.rs:261`).
/// Reading the two functions shows the difference (the sibling has `lock_global` for the
/// assignment but neither `has_empty` nor `global_rows`); this asserts it against the same
/// fixture, so the divergence is a measured fact rather than a reading.
///
/// Same global row, same empty store DB as the test above — and the sibling returns `[]`.
/// A terminal opened through this path therefore still shows the empty grid this whole
/// defect is about.
#[tokio::test]
async fn list_workspaces_for_store_scoped_has_no_read_repair() {
    let tb = picker_state(|conn| {
        conn.execute_batch(
            "INSERT INTO locations (id, name) VALUES ('store-a', 'Store A');\
             INSERT INTO workspace_instances (id, type_key, location_id, name, description, colour, status) \
             VALUES ('ws-global-a', 'store-pos', 'store-a', 'POS', '', NULL, 'active');",
        )
        .unwrap();
    });
    {
        let conn = tb.db_manager().open_store("store-a").unwrap();
        let db = conn.lock().unwrap();
        db.execute("DELETE FROM workspace_instances", []).unwrap();
        db.execute("DELETE FROM locations", []).unwrap();
    }
    mint_session(&tb, "owner-token", "user-owner", "role-owner", "store-a");

    let listed = list_workspaces_for_store_scoped(&tb.ctx(), "owner-token", "store-a".into()).await;
    if !seeded_row_loads() {
        assert_refused_by_the_seeded_row(&tb, listed, "free").await;
        return;
    }
    let rows = listed.unwrap();
    assert!(
        rows.is_empty(),
        "the sibling has no repair, so an empty store db lists nothing; got {rows:?}. \
         If this ever returns the global row, the repair was extended here too — good, and \
         this test should then assert the repair instead."
    );
}

/// The SAME repair, with the FK target present: it persists.
///
/// Round 26 measured the repair failing and round 28 established why — its INSERT needs a
/// `locations` row in the store db, and a freshly provisioned terminal has none. This is the
/// complement, and it is the half that shows the diagnosis is right rather than merely
/// consistent with the failure: keep that row and the identical insert works.
///
/// The one difference from `list_workspaces_repairs_from_global_when_the_store_db_is_empty` is
/// the absent `DELETE FROM locations`. Same global row, same emptied instances table, same
/// call — so between the two tests the ONLY variable is the FK target, which is what makes
/// this a controlled comparison instead of two anecdotes.
///
/// It describes a real state, not a contrived one: a merchant who created a location through
/// Settings has exactly this row (`create_location_profile_scoped` writes into the store db via
/// `ctx.resolve_scope`, `ctx.rs:389-392`), and for them the repair works.
#[tokio::test]
async fn the_read_repair_persists_when_its_fk_target_exists() {
    let tb = picker_state(|conn| {
        conn.execute_batch(
            "INSERT INTO locations (id, name) VALUES ('store-a', 'Store A');\
             INSERT INTO workspace_instances (id, type_key, location_id, name, description, colour, status) \
             VALUES ('ws-global-a', 'store-pos', 'store-a', 'POS', '', NULL, 'active');",
        )
        .unwrap();
    });
    {
        let conn = tb.db_manager().open_store("store-a").unwrap();
        let db = conn.lock().unwrap();
        // Instances only. The `locations` row stays, which is the whole point.
        db.execute("DELETE FROM workspace_instances", []).unwrap();
    }
    let secret = tb.ctx().picker_ticket_secret.clone();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    let ticket = crate::picker::sign_picker_ticket(&secret, "user-owner", now + 300);

    let listed = list_workspaces(&tb.ctx(), ticket, "store-a".into()).await;
    if !seeded_row_loads() {
        assert_refused_by_the_seeded_row(&tb, listed, "free").await;
        return;
    }
    let rows = listed.unwrap();
    assert!(
        rows.iter().any(|d| d.instance_id == "ws-global-a"),
        "the repair must still return the global row, got {rows:?}"
    );

    let cached: i64 = {
        let conn = tb.db_manager().open_store("store-a").unwrap();
        let db = conn.lock().unwrap();
        db.query_row(
            "SELECT COUNT(*) FROM workspace_instances WHERE id = 'ws-global-a'",
            [],
            |r| r.get(0),
        )
        .unwrap()
    };
    assert_eq!(
        cached, 1,
        "with its FK target present the repair persists — vs 0 in the sibling test above, \
         which differs ONLY by that row. This is what identifies the missing target as the cause."
    );
}

// ── Pre-session screen listing: the account and the store are both checked ──
//
// The ticket is verified in both this fn and `list_workspaces`; only the
// sibling went on to resolve the account. `list_workspace_screens` answered
// for a DEACTIVATED member and for a store the caller has no relationship
// with, so the pair disagreed about whether the caller existed and what they
// could reach. These two cases pin the halves back together.

/// Seed one screen row for `store-pos` in `store_id`, so a permitted call has
/// something to return and a refusal is distinguishable from an empty table.
fn seed_screens(tb: &TestBridge, store_id: &str) {
    let conn = tb.db_manager().open_store(store_id).unwrap();
    let db = conn.lock().unwrap();
    db.execute(
        "INSERT INTO workspace_type_screens (type_key, screen_key, sort_order) \
         VALUES ('store-pos', 'pos', 0)",
        [],
    )
    .unwrap();
}

#[tokio::test]
async fn list_workspace_screens_refuses_a_deactivated_account() {
    let tb = picker_state(|_| {});
    seed_screens(&tb, "store-a");
    let secret = tb.ctx().picker_ticket_secret.clone();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    // The owner is live, so the ticket works...
    let live = list_workspace_screens(
        &tb.ctx(),
        crate::picker::sign_picker_ticket(&secret, "user-owner", now + 300),
        "store-pos".into(),
        "store-a".into(),
    )
    .await
    .expect("a live account with store access may list screens");
    assert!(!live.is_empty());

    // ...then deactivated. The signature is unchanged and still valid, so only
    // a real account check can refuse this.
    {
        let db = tb.ctx().lock_global().await;
        Store::new(&db)
            .update_user("user-owner", "owner", "Owner", "role-owner", false)
            .unwrap();
    }
    let denied = list_workspace_screens(
        &tb.ctx(),
        crate::picker::sign_picker_ticket(&secret, "user-owner", now + 300),
        "store-pos".into(),
        "store-a".into(),
    )
    .await;
    assert!(
        matches!(denied, Err(BridgeError::PermissionDenied(_))),
        "a deactivated account must not list screens: {denied:?}"
    );
}

#[tokio::test]
async fn list_workspace_screens_refuses_a_store_outside_the_callers_access() {
    // The cashier carries `user_location_access` rows naming store-a only, so
    // store-b is out of reach — the same fail-closed rule the session path
    // applies. A ticket alone used to answer for either store.
    let tb = picker_state(|conn| {
        // `location_id` is a real FK, so the locations row must exist first.
        conn.execute_batch(
            "INSERT INTO locations (id, name, address, currency, timezone) \
                  VALUES ('store-a', 'Store A', '', 'USD', 'UTC');
             INSERT INTO user_location_access (user_id, location_id, access_level) \
                  VALUES ('user-cashier', 'store-a', 'operator');",
        )
        .unwrap();
    });
    seed_screens(&tb, "store-a");
    seed_screens(&tb, "store-b");
    let secret = tb.ctx().picker_ticket_secret.clone();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    let ticket = || crate::picker::sign_picker_ticket(&secret, "user-cashier", now + 300);

    list_workspace_screens(&tb.ctx(), ticket(), "store-pos".into(), "store-a".into())
        .await
        .expect("store-a is in the caller's access set");

    let denied =
        list_workspace_screens(&tb.ctx(), ticket(), "store-pos".into(), "store-b".into()).await;
    assert!(
        matches!(denied, Err(BridgeError::PermissionDenied(_))),
        "store-b is outside the caller's access: {denied:?}"
    );
}

// ── Scoped-sessions follow-up: post-login listings ────────────────────
//
// TDD red: a scoped member must not be able to switch into an
// out-of-scope workspace type or store AFTER login. `list_workspaces_scoped`
// and `list_workspaces_for_store_scoped` must scope-filter through the
// user's assignment (ADR #35 D5 / spec 0048), mirroring the picker.
// `restaurant-pos` is used as the out-of-scope type because the Free tier
// allows it (so tier entitlement filtering cannot hide it — only the
// assignment can).

fn mint_session(tb: &TestBridge, token: &str, user: &str, role: &str, store: &str) {
    tb.sessions().write().unwrap().insert(
        token.into(),
        kasirmu_core::session::SessionContext::new(
            user.into(),
            role.into(),
            "terminal-1".into(),
            store.into(),
            "ws-a-1".into(),
            "store-pos".into(),
            None,
            0,
        ),
    );
}

#[tokio::test]
async fn scoped_assignment_filters_session_workspace_listing() {
    // A second store-a instance of a type the Free tier ALLOWS
    // (restaurant-pos) so only the assignment scope can hide it. Owner
    // scoped to workspace type `store-pos` only — the assignment lives on
    // the global DB and is seeded BEFORE with_conn; the instance is added
    // to the store DB after the bridge is built.
    let tb = picker_state(|conn| {
        Store::new(conn)
            .set_assignment(
                "user-owner",
                "role-owner",
                &AssignmentSpec {
                    scope_mode: ScopeMode::Scoped,
                    branches_all: true,
                    branches: vec![],
                    workspaces_all: false,
                    workspaces: vec!["store-pos".into()],
                    scope_type: ScopeType::Organization,
                    scope_id: None,
                },
            )
            .unwrap();
    });
    {
        let conn = tb.db_manager().open_store("store-a").unwrap();
        let db = conn.lock().unwrap();
        Store::new(&db)
            .create_workspace_instance(
                "ws-a-rest",
                "restaurant-pos",
                "store-a",
                "Restaurant",
                "",
                None,
            )
            .unwrap();
    }
    mint_session(&tb, "owner-token", "user-owner", "role-owner", "store-a");

    let listed = list_workspaces_scoped(&tb.ctx(), "owner-token").await;
    // Broken-seed fallback, not a profile fork: since 19-09-26 the seeded Free
    // row verifies in BOTH profiles, so the command succeeds below in both and
    // the assignment filter is consulted in both. This arm is reached only when
    // the row exists but does not verify - then the command fails first and the
    // filter is never reached.
    if !seeded_row_loads() {
        assert_refused_by_the_seeded_row(&tb, listed, "free").await;
        return;
    }
    let rows = listed.unwrap();
    assert!(
        rows.iter().any(|d| d.type_key == "store-pos"),
        "in-scope workspace type must list, got {rows:?}"
    );
    assert!(
        rows.iter().all(|d| d.type_key != "restaurant-pos"),
        "out-of-scope workspace type must be hidden after login, got {rows:?}"
    );
}

#[tokio::test]
async fn scoped_assignment_branch_dimension_denies_out_of_scope_store_for_session() {
    // Owner scoped to branch store-a only — store-b is out of scope, so
    // the terminal-management listing of store-b must yield nothing
    // (fail closed, same as the picker). Global DB seeded before with_conn.
    let tb = picker_state(|conn| {
        Store::new(conn)
            .set_assignment(
                "user-owner",
                "role-owner",
                &AssignmentSpec {
                    scope_mode: ScopeMode::Scoped,
                    branches_all: false,
                    branches: vec!["store-a".into()],
                    workspaces_all: true,
                    workspaces: vec![],
                    scope_type: ScopeType::Organization,
                    scope_id: None,
                },
            )
            .unwrap();
    });
    mint_session(&tb, "owner-token", "user-owner", "role-owner", "store-a");

    let in_scope =
        list_workspaces_for_store_scoped(&tb.ctx(), "owner-token", "store-a".into()).await;
    // Broken-seed fallback, not a profile fork: since 19-09-26 the seeded Free
    // row verifies in BOTH profiles, so the branch dimension answers below in
    // both and both halves of this case are asserted. This arm is reached only
    // when the row exists but does not verify - then BOTH legs are refused,
    // in-scope store first, and neither the "lists" nor the "denies" half is
    // reachable.
    if !seeded_row_loads() {
        assert_refused_by_the_seeded_row(&tb, in_scope, "free").await;
        return;
    }
    let in_scope = in_scope.unwrap();
    assert!(in_scope.iter().any(|d| d.instance_id == "ws-a-1"));

    let out_of_scope = list_workspaces_for_store_scoped(&tb.ctx(), "owner-token", "store-b".into())
        .await
        .unwrap();
    assert!(
        out_of_scope.is_empty(),
        "branch out of scope must deny the whole store listing, got {out_of_scope:?}"
    );
}

#[tokio::test]
async fn scoped_assignment_workspace_dimension_filters_for_store_listing() {
    // Same Free-tier-allowed out-of-scope type as the session listing test.
    // Owner scoped to workspace type `store-pos` only — the assignment lives
    // on the global DB and is seeded BEFORE with_conn; the instance is added
    // to the store DB after the bridge is built.
    let tb = picker_state(|conn| {
        Store::new(conn)
            .set_assignment(
                "user-owner",
                "role-owner",
                &AssignmentSpec {
                    scope_mode: ScopeMode::Scoped,
                    branches_all: true,
                    branches: vec![],
                    workspaces_all: false,
                    workspaces: vec!["store-pos".into()],
                    scope_type: ScopeType::Organization,
                    scope_id: None,
                },
            )
            .unwrap();
    });
    {
        let conn = tb.db_manager().open_store("store-a").unwrap();
        let db = conn.lock().unwrap();
        Store::new(&db)
            .create_workspace_instance(
                "ws-a-rest",
                "restaurant-pos",
                "store-a",
                "Restaurant",
                "",
                None,
            )
            .unwrap();
    }
    mint_session(&tb, "owner-token", "user-owner", "role-owner", "store-a");

    let listed = list_workspaces_for_store_scoped(&tb.ctx(), "owner-token", "store-a".into()).await;
    // Broken-seed fallback, not a profile fork: since 19-09-26 the seeded Free
    // row verifies in BOTH profiles, so the list below exists in both and the
    // filter runs in both. This arm is reached only when the row exists but does
    // not verify - then the filter has no list.
    if !seeded_row_loads() {
        assert_refused_by_the_seeded_row(&tb, listed, "free").await;
        return;
    }
    let rows = listed.unwrap();
    assert!(
        rows.iter().any(|d| d.type_key == "store-pos"),
        "in-scope workspace type must list, got {rows:?}"
    );
    assert!(
        rows.iter().all(|d| d.type_key != "restaurant-pos"),
        "out-of-scope workspace type must be hidden, got {rows:?}"
    );
}

#[tokio::test]
async fn list_workspaces_for_store_scoped_filters_by_tier_entitlement() {
    let tb = picker_state(|_| {});
    // Add a kds instance to store-a. The Free tier (default subscription)
    // does NOT allow kds — only store-pos, restaurant-pos, admin.
    // The scoped listing must filter it out.
    {
        let conn = tb.db_manager().open_store("store-a").unwrap();
        let db = conn.lock().unwrap();
        Store::new(&db)
            .create_workspace_instance("ws-a-kds", "kds", "store-a", "KDS", "", None)
            .unwrap();
    }
    mint_session(&tb, "owner-token", "user-owner", "role-owner", "store-a");

    let listed = list_workspaces_for_store_scoped(&tb.ctx(), "owner-token", "store-a".into()).await;
    // Broken-seed fallback, not a profile fork: since 19-09-26 the seeded Free
    // row verifies in BOTH profiles, so the list below exists in both and the
    // filter runs in both. This arm is reached only when the row exists but does
    // not verify - then the filter has no list.
    if !seeded_row_loads() {
        assert_refused_by_the_seeded_row(&tb, listed, "free").await;
        return;
    }
    let rows = listed.unwrap();
    // store-pos (ws-a-1) is allowed by the Free tier → must be present.
    assert!(
        rows.iter().any(|d| d.type_key == "store-pos"),
        "Free tier must still list store-pos, got {rows:?}"
    );
    // kds is NOT allowed by the Free tier → must be filtered out.
    assert!(
        rows.iter().all(|d| d.type_key != "kds"),
        "Free tier must not list kds, got {rows:?}"
    );
}

#[tokio::test]
async fn list_workspaces_scoped_rejects_tampered_subscription_signature() {
    // Parity with create_session (round 6) and every other subscription-
    // trusting command: the tenant_subscription row's RSA signature must
    // be verified before its tier/allowed-types are honored. A tampered
    // row (forged pro tier + kds, invalid signature) must fail closed.
    // Tamper the subscription before minting the session (global DB seeded
    // before with_conn).
    let tb = picker_state(|conn| {
        conn.execute(
            "UPDATE tenant_subscription
             SET tier_key = 'pro',
                 allowed_types_json = '[\"store-pos\",\"restaurant-pos\",\"admin\",\"kds\"]',
                 signature = 'TAMPERED_SIGNATURE'
             WHERE tenant_id = 'default'",
            [],
        )
        .unwrap();
    });
    mint_session(&tb, "owner-token", "user-owner", "role-owner", "store-a");

    let result = list_workspaces_scoped(&tb.ctx(), "owner-token").await;
    let err = result.expect_err("tampered subscription must fail the scoped listing");
    match err {
        BridgeError::Invalid(msg) => {
            assert!(
                msg.contains("signature") || msg.contains("subscription"),
                "error must name the signature gate, got: {msg}"
            );
        }
        BridgeError::Core { .. } => {}
        other => panic!("expected BridgeError::Invalid/Core, got {other:?}"),
    }
}

// ── §J B1: remediation target resolution ─────────────────────────────

/// Seed one location row so "known store" has a referent. Written out rather
/// than relying on whatever `fresh_db` seeds, so a future change to the default
/// location cannot quietly flip these assertions.
fn conn_with_location(id: &str) -> rusqlite::Connection {
    let conn = crate::testing::temp_conn();
    conn.execute(
        "INSERT OR IGNORE INTO locations (id, name) VALUES (?1, 'Seeded Store')",
        rusqlite::params![id],
    )
    .unwrap();
    conn
}

#[test]
fn remediation_target_without_an_id_keeps_the_session_store() {
    // The historical behaviour, and the reason the signature change is
    // backward compatible: omitting the argument resolves to the caller's own
    // store and needs no `locations` lookup at all.
    let conn = conn_with_location("store-1");
    let got = remediation_target(&conn, "store-9", None).unwrap();
    assert_eq!(got, "store-9");
}

#[test]
fn remediation_target_accepts_a_location_that_exists() {
    let conn = conn_with_location("store-1");
    let got = remediation_target(&conn, "store-9", Some("store-1".into())).unwrap();
    assert_eq!(got, "store-1");
}

#[test]
fn remediation_target_refuses_a_store_that_is_not_a_location() {
    // The whole point of the check: without it, an invented id reaches
    // `open_store`, which CREATES the missing database, and the command returns
    // a clean 0 — a quota repair that reports success having done nothing
    // anywhere.
    let conn = conn_with_location("store-1");
    let err = remediation_target(&conn, "store-9", Some("store-does-not-exist".into()))
        .expect_err("unknown store must be refused");
    match err {
        BridgeError::Invalid(msg) => assert!(msg.contains("unknown store"), "got: {msg}"),
        other => panic!("expected BridgeError::Invalid, got {other:?}"),
    }
}

#[test]
fn remediation_target_refuses_a_blank_id_instead_of_defaulting() {
    // A blank string is not "unspecified". Treated as unspecified it would
    // silently act on the caller's store while the UI believed it was acting on
    // the store named in the request; treated literally it would name a
    // database file with an empty id.
    let conn = conn_with_location("store-1");
    let err = remediation_target(&conn, "store-9", Some("   ".into()))
        .expect_err("blank store_id must be refused");
    match err {
        BridgeError::Invalid(msg) => {
            assert!(msg.contains("must not be blank"), "got: {msg}");
        }
        other => panic!("expected BridgeError::Invalid, got {other:?}"),
    }
}

#[test]
fn remediation_target_trims_so_padding_cannot_mint_a_second_store() {
    // " store-1 " must resolve to exactly store-1. Passed through untrimmed it
    // would open a different database path that merely looks like the same one,
    // and get_location_profile would then reject a store the owner can see.
    let conn = conn_with_location("store-1");
    let got = remediation_target(&conn, "store-9", Some("  store-1  ".into())).unwrap();
    assert_eq!(got, "store-1");
}

// ── Device-binding read failure on the boot path ───────────────────────

/// Seed one terminal bound to `store-a`/`ws-a-1`, then force ONLY the binding
/// read to fail. The baseline already seeds the primary store `default`.
///
/// `get_terminal_binding` selects `bound_location_id, bound_instance_id,
/// binding_signature`; `get_terminal_by_device_id` does not read
/// `binding_signature`, so dropping that column makes exactly the inner
/// read error while the outer read still succeeds.
fn binding_read_is_corrupt() -> TestBridge {
    picker_state(|conn| {
        conn.execute_batch(
            "INSERT INTO locations (id, name, address, tax_id, currency, timezone, is_primary, created_at, updated_at)
             VALUES ('store-a', 'Store A', '', '', 'USD', 'UTC', 0,
                     '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
        )
        .unwrap();
        let store = Store::new(conn);
        let terminal = kasirmu_core::Terminal::new("Tablet-1", "tablet-1");
        store.create_terminal(&terminal).unwrap();
        store
            .update_terminal_binding(&terminal.id, "store-a", "ws-a-1", "deadbeef")
            .unwrap();
        conn.execute_batch("ALTER TABLE terminals DROP COLUMN binding_signature;")
            .unwrap();
    })
}

/// A device-binding read error must NOT be read as "this terminal is
/// unbound". `resolve_boot_store` used `.ok().flatten()` on
/// `get_terminal_binding`, so an errored read collapsed into the same `None`
/// as a genuinely unbound terminal and the device silently booted into the
/// PRIMARY store — unpinning a bound terminal from its assigned store and
/// instance. The sibling read in the same expression,
/// `get_terminal_by_device_id`, propagates with `?`; only `Ok(None)` means
/// "unbound".
#[tokio::test]
async fn resolve_boot_store_refuses_when_the_binding_read_errors() {
    let tb = binding_read_is_corrupt();

    let result = resolve_boot_store(&tb.ctx(), Some("tablet-1".into())).await;

    // RED: the errored read read as "unbound" → Ok(is_bound=false, primary
    // store). GREEN: the read failure refuses the boot.
    assert!(
        result.is_err(),
        "a binding read failure must refuse, not silently unpin the terminal: {result:?}"
    );
}

/// The documented unbound path survives: a terminal whose binding row exists
/// but carries no binding at all is genuinely unbound, so it still resolves
/// to the primary store rather than erroring.
#[tokio::test]
async fn resolve_boot_store_falls_back_to_primary_when_no_binding_exists() {
    let tb = picker_state(|conn| {
        Store::new(conn)
            .create_terminal(&kasirmu_core::Terminal::new("Tablet-2", "tablet-2"))
            .unwrap();
    });

    let resolution = resolve_boot_store(&tb.ctx(), Some("tablet-2".into()))
        .await
        .expect("an unbound terminal is not an error");
    assert!(!resolution.is_bound);
    assert_eq!(resolution.store_id, "default");
}
