//! Unit tests for the workspaces bridge module.
//!
//! Relocated from the desktop command module (Wave E / EW7). The shell's
//! `AppState::for_test` / tauri mock app are replaced by the headless
//! `TestBridge` harness (`crate::testing`); global-identity-DB mutations
//! are hoisted into the `picker_state` seed closure so they land on the
//! connection BEFORE `with_conn` hands it to the bridge (BW1b/CW1).

use super::*;

use crate::testing::TestBridge;
use crate::testing::seeded_row_loads;
use oz_core::subscription::TenantSubscription;

// -- The release leg for these listings (crate::testing, RULE at :204-208) --

/// Every scoped listing this file drives reaches the subscription row through
/// `sub.verify_signature()?` (`workspaces.rs:232`, `:657` - the same propagating
/// shape as `terminals.rs:432`), so in release the command RETURNS AN ERROR: no
/// Vec is produced, no tier is projected, no row is written. There is therefore
/// no fail-closed projection to assert here and the template is deliberately not
/// used - the honest release leg is the error arm, named exactly.
///
/// Existence is pinned FIRST. `seeded_row_loads() == false` collapses five
/// distinct causes (lost default row, a load `Err` on a mis-shaped table, a
/// public-key failure, the intended base64 reject on the BOOTSTRAP_FREE
/// sentinel, a genuine RSA mismatch); only the fourth is this fixture
/// vocabulary, so the row and its stamp are asserted before the refusal is.
async fn assert_refused_by_the_seeded_row<T>(
    tb: &TestBridge,
    listed: Result<T, BridgeError>,
    stamped_tier: &str,
) {
    let ctx = tb.ctx();
    let db = ctx.lock_global().await;
    let row = TenantSubscription::load(&db, "default")
        .expect("the tenant_subscription read must succeed")
        .expect("the seeded default row must EXIST: seeded_row_loads() == false is also the answer for a lost seed, and a fixture fork must never be able to read a broken migration as a profile difference");
    assert_eq!(
        row.tier.tier_key(),
        stamped_tier,
        "the tier this fixture inherits must be on the row the release arm reads"
    );
    assert_eq!(
        row.verify_signature().is_ok(),
        seeded_row_loads(),
        "the row this fixture lists against must be the row the fork predicate is about"
    );
    drop(db);
    let err = match listed {
        Err(err) => err,
        Ok(_) => panic!(
            "this leg runs only where the seeded row does not verify, so the listing must have been refused"
        ),
    };
    assert!(
        matches!(
            err,
            BridgeError::Core {
                sub_kind: oz_core::CoreErrorKind::InvalidSubscriptionSignature,
                ..
            }
        ),
        "the release refusal must be the propagated signature error, not a looser failure: {err:?}"
    );
}

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

use oz_core::LocationProfile;
use oz_core::db::assignments::{AssignmentSpec, ScopeMode, ScopeType};
use oz_core::migrations;

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
    let conn = migrations::fresh_db();
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
        oz_core::session::SessionContext::new(
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
    // Release: the listing is refused at the signature before any scoping or
    // tier filter runs, so the empty-list claim below has no list to make.
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
        oz_core::session::SessionContext::new(
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
    // Release: the assignment filter is never consulted - the row behind the
    // tier and the allowed-types is unreadable, so the command fails first.
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
    // Release: BOTH legs are refused, in-scope store first - the branch
    // dimension never gets to answer, so neither the "lists" nor the "denies"
    // half of this case is reachable. Assert the refusal and stop.
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
    // Release: refused at the signature, so the filter below has no list.
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
    // Release: refused at the signature, so the filter below has no list.
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
    let conn = oz_core::migrations::fresh_db();
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
