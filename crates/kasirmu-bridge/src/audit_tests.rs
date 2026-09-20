use super::*;

use crate::testing::seeded_row_reaches_a_paid_tier;
use crate::testing::seeded_row_verdict_for_tier;
use crate::testing::{FAIL_CLOSED_GATES_LOCKED, FAIL_CLOSED_STATE, FAIL_CLOSED_TIER, TestBridge};
use kasirmu_core::subscription::TenantSubscription;

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
    let conn = kasirmu_core::migrations::fresh_db();
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

/// The tier projection behind the audit gate, asserted for whichever profile
/// is running — so BOTH legs gain an assertion, not just the release one.
///
/// `seeded_row_loads()` answers WHETHER the seeded subscription row verifies
/// in the running profile, never WHY it did not. A missing default row, an
/// unreadable table, a key that will not parse, the base64 reject this fixture
/// depends on and a genuine RSA mismatch all make it false, and the product's
/// fail-closed loaders project the same Free + `unavailable` for every one of
/// them (`entitlements.rs:280-300`). A release-side arm that asserted only the
/// projection could therefore read a BROKEN FIXTURE as a profile difference,
/// so the row's existence and its own verdict are pinned first, in both
/// profiles.
fn assert_gate_projection(conn: &rusqlite::Connection, stamped_tier: &str) {
    let row = TenantSubscription::load(conn, "default")
        .expect("the tenant_subscription read must succeed")
        .expect("the seeded default row must EXIST: `seeded_row_loads() == false` is also the answer for a lost seed, and a fixture fork must never be able to read a broken migration as a profile difference");
    assert_eq!(
        row.tier.tier_key(),
        stamped_tier,
        "the fixture's tier stamp must be on the row the gate is reading"
    );
    assert_eq!(
        row.verify_signature().is_ok(),
        seeded_row_verdict_for_tier(stamped_tier),
        "the row this fixture reads must be the row the fork's predicate is about"
    );

    let store = Store::new(conn);
    let ent = build_entitlements(&store, UsageCounts::default(), true);
    assert_eq!(
        ent.loaded,
        seeded_row_verdict_for_tier(stamped_tier),
        "the read model's loaded flag must agree with the load path"
    );
    if seeded_row_verdict_for_tier(stamped_tier) {
        // Debug: the sentinel verifies, so the stamped tier reaches the gate.
        assert_eq!(
            ent.tier.tier_key(),
            stamped_tier,
            "a verifying row must project the tier the fixture stamped"
        );
    } else {
        // Release: the FAIL-CLOSED PROJECTION, named through the shared consts
        // rather than remembered strings. This is the leg the fixture used to
        // pretend did not exist.
        assert_eq!(
            ent.state.as_str(),
            FAIL_CLOSED_STATE,
            "the gate must project the harness's fail-closed state"
        );
        assert_eq!(
            ent.tier.tier_key(),
            FAIL_CLOSED_TIER,
            "the gate must project the harness's fail-closed tier"
        );
        // Assert form ONLY, never `if FAIL_CLOSED_GATES_LOCKED { .. }`: the
        // const is `false` BECAUSE the gates are locked, so as a condition it
        // silently inverts the claim it pins. This spells the audit gate's own
        // predicate (`Premium | Enterprise`, audit.rs:275) through the const.
        assert_eq!(
            matches!(
                ent.tier,
                SubscriptionTier::Premium | SubscriptionTier::Enterprise
            ),
            FAIL_CLOSED_GATES_LOCKED,
            "the audit tier gate must be locked in the fail-closed projection"
        );
    }
}

/// An app whose `tok` session is the owner, with a real store DB behind it.
fn app_for(user_id: &str, role_id: &str, tier_key: &str) -> TestBridge {
    let conn = seeded_conn(tier_key);
    let bridge = TestBridge::new().with_conn(conn);
    bridge.sessions().write().unwrap().insert(
        "tok".into(),
        kasirmu_core::session::SessionContext::new(
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
    // SHAPE 1 (fork the expectation on the product fact) + SHAPE 2 (the
    // release leg asserts the fail-closed projection, so it GAINS rather than
    // only losing).
    //
    // `seeded_conn` stamps `tier_key = 'premium'` onto the migration-seeded
    // row and leaves that row's signature alone, so whether the gate can SEE
    // the stamp is exactly what `seeded_row_verdict_for_tier("premium")`
    // answers by running the product's load path: debug verifies the
    // BOOTSTRAP_FREE sentinel and reads premium, release rejects it and fails
    // closed to Free. Both halves are product facts; the fixture was only ever
    // dishonest in claiming the debug half for both profiles. A `free` stamp is
    // the OTHER curve since 19-09-26 - it loads in both profiles, so it takes
    // the load arm in both rather than this fork.
    //
    // What this does NOT do is weaken either leg: the panic the test exists
    // for is a `blocking_lock()` on a tokio Mutex, which aborts in BOTH
    // profiles, so pinning the release leg as a clean `Err` still fails the
    // instant the gate reverts — and the tier check below is what proves the
    // denial is the fail-closed read rather than an unrelated error.
    let db = ctx.lock_global().await;
    assert_gate_projection(&db, "premium");
    if seeded_row_reaches_a_paid_tier() {
        let page = page.expect("the seeded premium row verifies, so the gate must open");
        assert_eq!(page.total, 0);
    } else {
        assert!(
            matches!(page, Err(BridgeError::PermissionDenied(_))),
            "an unverifiable row must deny cleanly, not panic: {page:?}"
        );
    }
}

#[tokio::test]
async fn review_status_command_passes_the_tier_gate_without_panicking() {
    let bridge = app_for("user-owner", "role-owner", "premium");
    let ctx = bridge.ctx();
    let status = get_audit_review_status_scoped(&ctx, "tok").await;
    // Shape 1 + 2, same fork as `list_command_passes_the_tier_gate_*`: the
    // stamped tier is visible to the gate only while the seeded row verifies.
    // The no-panic pin (a `blocking_lock()` aborts in both profiles) is kept
    // in each leg.
    let db = ctx.lock_global().await;
    assert_gate_projection(&db, "premium");
    if seeded_row_reaches_a_paid_tier() {
        assert!(status.is_ok(), "{:?}", status.err());
    } else {
        assert!(
            matches!(status, Err(BridgeError::PermissionDenied(_))),
            "an unverifiable row must deny cleanly, not panic: {status:?}"
        );
    }
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
    // Shape 1 + 2, same fork as the sibling legs above.
    let db = ctx.lock_global().await;
    assert_gate_projection(&db, "premium");
    if seeded_row_reaches_a_paid_tier() {
        assert!(exported.is_ok(), "{:?}", exported.err());
    } else {
        assert!(
            matches!(exported, Err(BridgeError::PermissionDenied(_))),
            "an unverifiable row must deny cleanly, not panic: {exported:?}"
        );
    }
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
    // Shape 1 on the owner leg: the fixture's premium stamp is only visible
    // to the gate while the seeded row verifies, so debug opens and release
    // fails closed. The lite leg further down is what this test is NAMED for,
    // and it is kept honest on its own terms — in release the tier gate
    // answers first, which would otherwise let that leg pass for a reason that
    // has nothing to do with `audit:view`.
    let db = ctx.lock_global().await;
    assert_gate_projection(&db, "premium");
    drop(db);
    if seeded_row_reaches_a_paid_tier() {
        assert!(err.is_none(), "owner has audit:view: {err:?}");
    } else {
        assert!(
            matches!(err, Some(BridgeError::PermissionDenied(_))),
            "an unverifiable row must deny cleanly, not panic: {err:?}"
        );
    }

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
        kasirmu_core::session::SessionContext::new(
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
    // Shape 2's real work is HERE, on a leg that already went GREEN in
    // release. Gate order is tier-then-permission (`audit.rs:128-130`), so in
    // the fail-closed profile this denial comes from the TIER gate and the
    // `audit:view` check this test is named for never runs — the leg passes
    // for a reason unrelated to what it claims. Ask the permission gate
    // directly so the claim is proven in BOTH profiles:
    // `require_audit_permission` is the same gate the command calls one step
    // later, reached on its own.
    let direct = require_audit_permission(&lite_ctx, "user-lite", permissions::AUDIT_VIEW).await;
    assert!(
        matches!(direct, Err(BridgeError::PermissionDenied(_))),
        "a role without audit:view must be refused by the permission gate itself, not only by a tier gate standing in front of it: {direct:?}"
    );
    if seeded_row_reaches_a_paid_tier() {
        // And the tier gate must NOT be what rescued the owner: on a verifying
        // row the owner clears the tier gate, so the refusal above is the only
        // difference between the two sessions.
        let owner_tier = require_audit_tier(&ctx).await;
        assert!(owner_tier.is_ok(), "{:?}", owner_tier.err());
    }
}
