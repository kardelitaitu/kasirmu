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

use crate::testing::seeded_row_loads;
use crate::testing::{FAIL_CLOSED_GATES_LOCKED, FAIL_CLOSED_STATE, FAIL_CLOSED_TIER, TestBridge};
use oz_core::db::audit_security::{SECURITY_ACTIONS, SYSTEM_ACTOR};
use oz_core::subscription::TenantSubscription;

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

/// The tier projection behind these gates, asserted for whichever profile is
/// running — so BOTH legs of a forked case gain an assertion, and a green leg
/// can say WHICH reason produced its denial.
///
/// `seeded_row_loads()` answers WHETHER the seeded `tenant_subscription` row
/// verifies in the running profile, never WHY it did not: a missing default
/// row, an unreadable table, a key that will not parse, the base64 reject and a
/// genuine RSA mismatch all make it false, and the product's fail-closed loader
/// projects Free + `unavailable` for every one of them. A release-side arm that
/// asserted only the projection could therefore read a BROKEN FIXTURE as a
/// profile difference, so the row's existence, its stamp and its own verdict are
/// pinned first, in both profiles.
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
        seeded_row_loads(),
        "the row this fixture reads must be the row the fork's predicate is about"
    );

    let store = Store::new(conn);
    let ent = build_entitlements(&store, UsageCounts::default(), true);
    assert_eq!(
        ent.loaded,
        seeded_row_loads(),
        "the read model's loaded flag must agree with the load path"
    );
    if seeded_row_loads() {
        // Debug: the sentinel verifies, so the stamped tier reaches the gate.
        assert_eq!(
            ent.tier.tier_key(),
            stamped_tier,
            "a verifying row must project the tier the fixture stamped"
        );
    } else {
        // Release: the FAIL-CLOSED PROJECTION, named through the shared consts
        // rather than remembered strings. This is the leg these fixtures used to
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
        // silently inverts the claim it pins. This spells the audit tier gate's
        // own predicate (`Premium | Enterprise`, audit.rs:276) through the const.
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

fn app_for(user_id: &str, role_id: &str, tier_key: &str) -> TestBridge {
    let conn = seeded_conn(tier_key);
    seed_global_rows(&conn);
    let bridge = TestBridge::new().with_conn(conn);
    bridge.sessions().write().unwrap().insert(
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
    bridge
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
    let bridge = app_for("user-owner", "role-owner", "premium");
    let ctx = bridge.ctx();
    let page = list_security_events_scoped(&ctx, "tok", args(50)).await;
    let db = ctx.lock_global().await;
    assert_gate_projection(&db, "premium");
    if seeded_row_loads() {
        let page = page.expect("a verifying premium row must open the tier gate");
        assert_eq!(page.total, 1, "the business row must not count");
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].action, "login");
        assert!(!page.items.iter().any(|e| e.action == "sale.void"));
        assert!(!page.has_more);
    } else {
        // Release: the end-to-end denial is the FAIL-CLOSED tier gate, not the
        // class filter — and gate order is tier-then-read (audit.rs:207-211), so
        // the read this case is named for is never reached here. Assert the
        // denial, then ask the store read the command performs one step later
        // DIRECTLY, so the class split is proven in both profiles.
        assert!(
            matches!(page, Err(BridgeError::PermissionDenied(_))),
            "an unverifiable row must deny cleanly, not panic: {page:?}"
        );
        let (items, total, has_more) = Store::new(&db)
            .list_security_events(None, None, None, None, 50)
            .unwrap();
        assert_eq!(total, 1, "the business row must not count");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].action, "login");
        assert!(!items.iter().any(|e| e.action == "sale.void"));
        assert!(!has_more);
    }
}

#[tokio::test]
async fn security_events_page_clamps_the_limit_and_reports_more() {
    let bridge = app_for("user-owner", "role-owner", "premium");
    let ctx = bridge.ctx();
    {
        let db = ctx.lock_global().await;
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
    let page = list_security_events_scoped(&ctx, "tok", args(2)).await;
    let db = ctx.lock_global().await;
    assert_gate_projection(&db, "premium");
    if seeded_row_loads() {
        let page = page.expect("a verifying premium row must open the tier gate");
        assert_eq!(page.items.len(), 2);
        assert_eq!(
            page.total, 4,
            "login + 3 logouts, still excluding sale.void"
        );
        assert!(page.has_more);
    } else {
        assert!(
            matches!(page, Err(BridgeError::PermissionDenied(_))),
            "an unverifiable row must deny cleanly, not panic: {page:?}"
        );
        // Same closing as the sibling case: the clamp/pagination claim sits
        // behind the gate, so ask the paged read directly in this profile.
        let (items, total, has_more) = Store::new(&db)
            .list_security_events(None, None, None, None, 2)
            .unwrap();
        assert_eq!(items.len(), 2, "the limit must be honoured");
        assert_eq!(total, 4, "login + 3 logouts, still excluding sale.void");
        assert!(has_more, "a full page below the total must report more");
    }
}

#[tokio::test]
async fn security_events_page_denies_a_session_without_audit_view() {
    // Same permission surface as the audit screen: a session that cannot open
    // the audit log cannot open this either.
    let bridge = app_for("user-lite", "role-lite", "premium");
    let ctx = bridge.ctx();
    let err = list_security_events_scoped(&ctx, "tok", args(50))
        .await
        .unwrap_err();
    assert!(
        matches!(err, BridgeError::PermissionDenied(_)),
        "expected a permission denial, got {err:?}"
    );

    let db = ctx.lock_global().await;
    assert_gate_projection(&db, "premium");
    drop(db);
    // VACUOUS LEG CLOSED (this case was already GREEN in release): gate order is
    // tier-then-permission (`audit.rs:207-208`), so in the fail-closed profile
    // the TIER gate denies and `audit:view` is never consulted — the assertion
    // above would still pass if the permission check were deleted entirely. Ask
    // the permission gate itself, the same call the command makes one step
    // later, so the claim this case is NAMED for holds in BOTH profiles.
    let direct = require_audit_permission(&ctx, "user-lite", permissions::AUDIT_VIEW).await;
    assert!(
        matches!(direct, Err(BridgeError::PermissionDenied(_))),
        "a role without audit:view must be refused by the permission gate itself, \
         not by a tier gate standing in front of it: {direct:?}"
    );
    let tier = require_audit_tier(&ctx).await;
    if seeded_row_loads() {
        // Debug: the tier gate is OPEN for this session, so the end-to-end
        // refusal above really was the permission check — the only difference
        // between this session and the owner session is `audit:view`.
        assert!(
            tier.is_ok(),
            "the tier gate must be open on a verifying premium row, or the \
             refusal above proves nothing about audit:view: {:?}",
            tier.err()
        );
    } else {
        // Release: name the reason the end-to-end denial actually had.
        assert!(
            matches!(tier, Err(BridgeError::PermissionDenied(_))),
            "in release the tier gate answers first: {tier:?}"
        );
    }
}

#[tokio::test]
async fn security_events_page_rejects_an_unknown_session() {
    let bridge = app_for("user-owner", "role-owner", "premium");
    let ctx = bridge.ctx();
    let err = list_security_events_scoped(&ctx, "nope", args(50))
        .await
        .unwrap_err();
    // NOT vacuous in either profile, and needs no fork: `resolve_scope` is the
    // FIRST gate (`audit.rs:206`), ahead of the tier gate, so nothing stands in
    // front of this assertion — and it reads no subscription row at all.
    assert!(matches!(err, BridgeError::InvalidSession), "got {err:?}");
}

#[test]
fn security_events_args_deserialize_camel_case_and_default_the_limit() {
    // The UI sends camelCase; a missing limit must fall back to 100 rather
    // than 0 (which the core clamp would silently raise to 1). No gate and no
    // subscription read: profile-independent, nothing to fork.
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
async fn seed_actor_rows(bridge: &TestBridge) {
    let ctx = bridge.ctx();
    let db = ctx.lock_global().await;
    db.execute(
        "INSERT INTO audit_log (id, user_id, action, target_type, target_id, details, outcome, created_at)
         VALUES ('aud-sys','system','login.failed','user',NULL,'{}','failure','2026-08-02T00:00:00.000Z'),
                 ('aud-owner2','user-owner','logout','user','user-owner','{}','success','2026-08-03T00:00:00.000Z')",
        [],
    )
    .unwrap();
}

/// Three security rows around the Aug-5/Aug-6 boundary in the GLOBAL DB.
async fn seed_date_rows(bridge: &TestBridge) {
    let ctx = bridge.ctx();
    let db = ctx.lock_global().await;
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
    let bridge = app_for("user-owner", "role-owner", "premium");
    let ctx = bridge.ctx();
    let out = export_security_events_scoped(&ctx, "tok", export_args(None, None, None)).await;
    let db = ctx.lock_global().await;
    assert_gate_projection(&db, "premium");
    if seeded_row_loads() {
        let out = out.expect("a verifying premium row must open the tier gate");
        assert_eq!(out.row_count, 1, "the business row must not export");
        assert!(out.csv.starts_with('\u{FEFF}'), "BOM required");
        assert!(
            out.csv
                .contains("id,created_at,user_id,action,target_type,target_id,outcome,details\n")
        );
        assert!(out.csv.contains("login"));
        assert!(!out.csv.contains("sale.void"));
        // `requested_by` is only observable through the command, and the
        // fail-closed gate stops the command before it is ever set: this one
        // assertion is debug-only by construction, not by convenience.
        assert_eq!(out.requested_by, "user-owner");
    } else {
        assert!(
            matches!(out, Err(BridgeError::PermissionDenied(_))),
            "an unverifiable row must deny cleanly, not panic: {out:?}"
        );
        // The class filter and the CSV shape this case is named for both sit
        // behind the tier gate, so the leg above proves only the gate. Run the
        // two steps the command performs after it — the allowlisted read and
        // `audit_csv` — directly.
        let entries = Store::new(&db)
            .list_audit_entries_export_filtered(
                Some(SECURITY_ACTIONS),
                None,
                None,
                None,
                None,
                None,
            )
            .unwrap();
        let csv = audit_csv(&entries);
        assert_eq!(entries.len(), 1, "the business row must not export");
        assert!(csv.starts_with('\u{FEFF}'), "BOM required");
        assert!(
            csv.contains("id,created_at,user_id,action,target_type,target_id,outcome,details\n")
        );
        assert!(csv.contains("login"));
        assert!(!csv.contains("sale.void"));
    }
}

#[tokio::test]
async fn actor_filter_is_exact_and_system_resolves() {
    let bridge = app_for("user-owner", "role-owner", "premium");
    let ctx = bridge.ctx();
    seed_actor_rows(&bridge).await;
    let owner =
        export_security_events_scoped(&ctx, "tok", export_args(Some("user-owner"), None, None))
            .await;
    let sys =
        export_security_events_scoped(&ctx, "tok", export_args(Some("system"), None, None)).await;
    let db = ctx.lock_global().await;
    assert_gate_projection(&db, "premium");
    if seeded_row_loads() {
        // Exact user_id: only that actor's rows.
        let owner = owner.expect("a verifying premium row must open the tier gate");
        assert_eq!(owner.row_count, 2, "seeded login + logout for user-owner");
        // "system" resolves to SYSTEM_ACTOR and matches only those rows.
        let sys = sys.expect("a verifying premium row must open the tier gate");
        assert_eq!(sys.row_count, 1);
        assert!(sys.csv.contains("login.failed"));
        assert!(!sys.csv.contains("logout"));
    } else {
        for out in [owner, sys] {
            assert!(
                matches!(out, Err(BridgeError::PermissionDenied(_))),
                "an unverifiable row must deny cleanly, not panic: {out:?}"
            );
        }
        // Exactness and the `"system"` → SYSTEM_ACTOR mapping are the claims
        // here, and both live behind the gate. The command hands the resolved
        // actor straight to this read (audit.rs:579-589), so asking the read
        // with the same arguments keeps the mapping tested in this profile too.
        let owner = Store::new(&db)
            .list_audit_entries_export_filtered(
                Some(SECURITY_ACTIONS),
                Some("user-owner"),
                None,
                None,
                None,
                None,
            )
            .unwrap();
        assert_eq!(owner.len(), 2, "seeded login + logout for user-owner");
        let sys = Store::new(&db)
            .list_audit_entries_export_filtered(
                Some(SECURITY_ACTIONS),
                Some(SYSTEM_ACTOR),
                None,
                None,
                None,
                None,
            )
            .unwrap();
        assert_eq!(sys.len(), 1, "only the system-actor row");
        let csv = audit_csv(&sys);
        assert!(csv.contains("login.failed"));
        assert!(!csv.contains("logout"));
    }
}

#[tokio::test]
async fn date_range_normalizes_day_bounds() {
    let bridge = app_for("user-owner", "role-owner", "premium");
    let ctx = bridge.ctx();
    seed_date_rows(&bridge).await;
    // dateTo = 2026-08-05 must INCLUDE the whole day (the exclusive
    // bound normalizes to midnight of Aug 6) and exclude Aug 6.
    let out = export_security_events_scoped(
        &ctx,
        "tok",
        export_args(None, Some("2026-08-05"), Some("2026-08-05")),
    )
    .await;
    let db = ctx.lock_global().await;
    assert_gate_projection(&db, "premium");
    if seeded_row_loads() {
        let out = out.expect("a verifying premium row must open the tier gate");
        assert_eq!(out.row_count, 2, "both Aug-5 events, none of Aug-6");
        assert!(out.csv.contains("aud-d1"));
        assert!(out.csv.contains("aud-d2"));
        assert!(!out.csv.contains("aud-d3"));
    } else {
        assert!(
            matches!(out, Err(BridgeError::PermissionDenied(_))),
            "an unverifiable row must deny cleanly, not panic: {out:?}"
        );
        // The D84 ruling-3 day-bound normalization IS this case's claim and it
        // is gated, so pin the normalizer and the filtered read directly.
        let after = normalize_day_bound("2026-08-05", false).unwrap();
        let before = normalize_day_bound("2026-08-05", true).unwrap();
        assert_eq!(after, "2026-08-05T00:00:00.000Z", "inclusive lower bound");
        assert_eq!(
            before, "2026-08-06T00:00:00.000Z",
            "the upper bound is EXCLUSIVE midnight of the FOLLOWING day, which \
             is what makes the whole end day count"
        );
        let entries = Store::new(&db)
            .list_audit_entries_export_filtered(
                Some(SECURITY_ACTIONS),
                None,
                Some(after),
                Some(before),
                None,
                None,
            )
            .unwrap();
        let csv = audit_csv(&entries);
        assert_eq!(entries.len(), 2, "both Aug-5 events, none of Aug-6");
        assert!(csv.contains("aud-d1"));
        assert!(csv.contains("aud-d2"));
        assert!(!csv.contains("aud-d3"));
    }
}

#[tokio::test]
async fn a_malformed_day_is_rejected_not_silently_ignored() {
    let bridge = app_for("user-owner", "role-owner", "premium");
    let ctx = bridge.ctx();
    let err =
        export_security_events_scoped(&ctx, "tok", export_args(None, Some("2026-13-01"), None))
            .await
            .unwrap_err();
    let db = ctx.lock_global().await;
    assert_gate_projection(&db, "premium");
    drop(db);
    if seeded_row_loads() {
        assert!(matches!(err, BridgeError::Invalid(_)), "got {err:?}");
    } else {
        // VACUOUS LEG CLOSED: the tier gate runs BEFORE the date filters are
        // parsed (`audit.rs:561-562`, then `:570-577`), so in release the
        // end-to-end error is PermissionDenied and asserting `Invalid` here
        // would be a claim about a code path that never ran.
        assert!(
            matches!(err, BridgeError::PermissionDenied(_)),
            "in release the fail-closed tier gate answers the malformed day first: {err:?}"
        );
        // Ask the validator the command itself calls, so "rejected, not
        // silently ignored" is proven in this profile too.
        let direct = normalize_day_bound("2026-13-01", false);
        assert!(
            matches!(direct, Err(BridgeError::Invalid(_))),
            "a malformed day must be rejected by the validator: {direct:?}"
        );
        let direct_end = normalize_day_bound("2026-13-01", true);
        assert!(
            matches!(direct_end, Err(BridgeError::Invalid(_))),
            "the end-of-day bound must reject it too: {direct_end:?}"
        );
    }
}

#[tokio::test]
async fn export_refuses_below_the_premium_tier() {
    let bridge = app_for("user-owner", "role-owner", "plus");
    let ctx = bridge.ctx();
    let err = export_security_events_scoped(&ctx, "tok", export_args(None, None, None))
        .await
        .unwrap_err();
    assert!(
        matches!(err, BridgeError::PermissionDenied(_)),
        "tier gate must refuse below Premium: {err:?}"
    );
    let db = ctx.lock_global().await;
    assert_gate_projection(&db, "plus");
    drop(db);
    // VACUOUS LEG CLOSED (this case was already GREEN in release): the denial
    // here is attributed to `plus` sitting below Premium, but in release the row
    // never verifies, so the gate refuses on the fail-closed FREE projection —
    // the identical PermissionDenied would appear even if the sub-Premium rule
    // were deleted. The denial message names the tier the gate actually read, so
    // assert WHICH of the two reasons fired.
    let msg = match err {
        BridgeError::PermissionDenied(m) => m,
        other => panic!("expected a tier denial, got {other:?}"),
    };
    let direct = require_audit_tier(&ctx).await;
    assert!(
        matches!(direct, Err(BridgeError::PermissionDenied(_))),
        "the tier gate itself must refuse: {direct:?}"
    );
    if seeded_row_loads() {
        assert!(
            msg.contains("current tier: Plus"),
            "on a verifying row the gate must refuse because Plus is below \
             Premium — the rule this case exists for: {msg}"
        );
    } else {
        assert!(
            msg.contains("current tier: Free"),
            "in release this gate denies from the fail-closed projection, NOT \
             from the plus stamp; saying so keeps the leg honest about what it \
             proves: {msg}"
        );
    }
    // And the permission gate is NOT what this case is denying: the owner holds
    // `audit:export`, so the refusal above is the tier's alone — in both profiles.
    let perm = require_audit_permission(&ctx, "user-owner", permissions::AUDIT_EXPORT).await;
    assert!(
        perm.is_ok(),
        "the owner must clear the permission gate, or the refusal above is not \
         the tier's doing: {:?}",
        perm.err()
    );
}

#[tokio::test]
async fn export_refuses_a_caller_without_audit_export() {
    let bridge = app_for("user-lite", "role-lite", "premium");
    let ctx = bridge.ctx();
    let err = export_security_events_scoped(&ctx, "tok", export_args(None, None, None))
        .await
        .unwrap_err();
    assert!(
        matches!(err, BridgeError::PermissionDenied(_)),
        "non-exporter must be refused: {err:?}"
    );
    let db = ctx.lock_global().await;
    assert_gate_projection(&db, "premium");
    drop(db);
    // VACUOUS LEG CLOSED (this case was already GREEN in release): tier-then-
    // permission order (`audit.rs:561-562`) means release denies at the tier
    // gate and never consults `audit:export`. Ask the permission gate directly so
    // the claim this case is named for holds in BOTH profiles.
    let direct = require_audit_permission(&ctx, "user-lite", permissions::AUDIT_EXPORT).await;
    assert!(
        matches!(direct, Err(BridgeError::PermissionDenied(_))),
        "a role without audit:export must be refused by the permission gate \
         itself, not by a tier gate standing in front of it: {direct:?}"
    );
    let tier = require_audit_tier(&ctx).await;
    if seeded_row_loads() {
        assert!(
            tier.is_ok(),
            "the tier gate must be open here, or the refusal above proves \
             nothing about audit:export: {:?}",
            tier.err()
        );
    } else {
        assert!(
            matches!(tier, Err(BridgeError::PermissionDenied(_))),
            "in release the tier gate answers first: {tier:?}"
        );
    }
}

#[tokio::test]
async fn the_handoff_writes_a_self_audit_row_to_the_store_log() {
    let bridge = app_for("user-owner", "role-owner", "premium");
    let ctx = bridge.ctx();
    let out = export_security_events_scoped(&ctx, "tok", export_args(None, None, None)).await;
    // AUD-09's surface reads the store DB: the self-audit row must be
    // visible there (it is deliberately NOT in SECURITY_ACTIONS, so it
    // never re-enters this export).
    let full = export_audit_log_scoped(
        &ctx,
        "tok",
        ExportAuditLogArgs {
            outcome: None,
            query: None,
        },
    )
    .await;
    let db = ctx.lock_global().await;
    assert_gate_projection(&db, "premium");
    drop(db);
    if seeded_row_loads() {
        out.expect("a verifying premium row must open the tier gate");
        let full = full.expect("a verifying premium row must open the AUD-09 gate");
        assert!(
            full.csv.contains("system.export"),
            "self-audit row must land in the store log"
        );
    } else {
        // Both commands are tier-gated, so nothing reaches the handoff in this
        // profile. Assert the denials, then assert the two claims that do not
        // need the gate at the layer the command uses.
        for res in [out.map(|_| ()), full.map(|_| ())] {
            assert!(
                matches!(res, Err(BridgeError::PermissionDenied(_))),
                "an unverifiable row must deny cleanly, not panic: {res:?}"
            );
        }
        let (_session, store_conn) = ctx.resolve_scope("tok").unwrap();
        let store_db = store_conn.lock().unwrap();
        let store = Store::new(&store_db);
        // (1) A fail-closed denial must leave NOTHING behind: no self-audit row
        // for an export that never happened.
        let rows = store
            .list_audit_entries_export_filtered(None, None, None, None, None, None)
            .unwrap();
        assert!(
            rows.iter().all(|e| e.action != "system.export"),
            "a denied export must not write a self-audit row: {rows:?}"
        );
        // (2) The handoff's own contract, gated off in release and so asserted
        // through the same two store calls the command makes: the row belongs to
        // the STORE log, and because `system.export` is NOT in SECURITY_ACTIONS
        // it can never re-enter the security export.
        store
            .log_audit(&oz_core::AuditEntry::new(
                "user-owner".to_string(),
                "system.export".to_string(),
                Some("audit".to_string()),
                None::<String>,
                Some("{}".to_string()),
                "success".to_string(),
            ))
            .unwrap();
        let store_rows = store
            .list_audit_entries_export_filtered(None, None, None, None, None, None)
            .unwrap();
        assert!(
            store_rows.iter().any(|e| e.action == "system.export"),
            "the store log is where the handoff row lands"
        );
        let sec_rows = store
            .list_audit_entries_export_filtered(
                Some(SECURITY_ACTIONS),
                None,
                None,
                None,
                None,
                None,
            )
            .unwrap();
        assert!(
            sec_rows.iter().all(|e| e.action != "system.export"),
            "system.export is not a security action, so it must never re-enter \
             the security export: {sec_rows:?}"
        );
    }
}
