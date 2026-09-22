use super::*;

use crate::testing::{
    FAIL_CLOSED_GATES_LOCKED, FAIL_CLOSED_STATE, FAIL_CLOSED_TIER, seeded_row_loads,
    seeded_row_reaches_a_paid_tier, seeded_row_verdict_for_tier,
};
use kasirmu_core::availability::AvailabilityReason;
use kasirmu_core::subscription::TenantSubscription;

/// A provisioned store, via the shared harness so the seeded baseline
/// (ADR #56 §2.6: location, legal entity, workspace instances, BOOTSTRAP_FREE
/// subscription) is present. Calling `migrations::fresh_db()` directly would
/// skip that seed and make every fail-closed arm pass for the wrong reason.
fn fresh_db() -> rusqlite::Connection {
    crate::testing::temp_conn()
}

fn seed_tier(conn: &rusqlite::Connection, tier_key: &str) {
    conn.execute(
        "UPDATE tenant_subscription SET tier_key = ?1 WHERE tenant_id = 'default'",
        [tier_key],
    )
    .unwrap();
}

fn caps(conn: &rusqlite::Connection) -> SubscriptionCapabilitiesDto {
    load_capabilities(conn).unwrap()
}

// -- The shared fork contract (crate::testing; RULE at testing.rs:217-221) --

// Every entitlement expectation below is a RUNTIME fork, never a single
// arm, and since 19-09-26 it forks on TWO predicates rather than one: a row
// stamped `free` follows `seeded_row_verdict_for_tier("free")` =
// `seeded_row_loads()` (true in BOTH profiles - the sentinel is honoured on a
// free-tier row everywhere), while any PAID stamp follows
// `seeded_row_reaches_a_paid_tier()` (debug only). The unverifiable arm
// asserts the FAIL-CLOSED PROJECTION rather than the debug truth. No
// #[cfg(not(debug_assertions))] arm is introduced here: such an arm cannot be
// reached through a runtime branch, and it also trips unused_imports under
// RUSTFLAGS=-D warnings in dev-ci#cargo-check.

/// The guard every unverifiable-row arm runs FIRST. seeded_row_loads() == false
// collapses five causes (lost row, mis-shaped table, public-key failure, the
// intended base64 reject, a real RSA mismatch), so a fail-closed assertion
// about an ABSENT row proves nothing: pin the row, the tier stamp this
// fixture wrote, and the row's own signature verdict before projecting.
fn assert_seeded_row(conn: &rusqlite::Connection, stamped_tier: &str) -> TenantSubscription {
    let row = TenantSubscription::load(conn, "default")
        .expect("the tenant_subscription read must succeed")
        .expect("the seeded default row must EXIST: seeded_row_loads() == false is also the answer for a lost seed, and a fixture fork must never read a broken migration as a profile difference");
    assert_eq!(
        row.tier.tier_key(),
        stamped_tier,
        "the fixture's tier stamp must be on the row the release arm is reading"
    );
    assert_eq!(
        row.verify_signature().is_ok(),
        seeded_row_verdict_for_tier(stamped_tier),
        "the row this fixture reads must be the row the fork predicate is about"
    );
    row
}

/// The caps DTO as the read projects it when NO row verifies. The Free caps
// (1 / 1 / 1 / 90 days) are the same numbers
// capabilities_reflect_free_tier_and_zero_usage pins on its release leg, so
// nothing here is invented to fit this fork.
fn assert_caps_fail_closed(dto: &SubscriptionCapabilitiesDto) {
    assert_eq!(
        dto.tier, FAIL_CLOSED_TIER,
        "an unverifiable row projects the fail-closed tier, never the stamped one"
    );
    assert_eq!(
        dto.state, FAIL_CLOSED_STATE,
        "the lifecycle axis reports the failed read, not the row's status column"
    );
    assert_eq!(dto.status, FAIL_CLOSED_STATE, "status reads the same row");
    assert_eq!(dto.expires_at, None, "an unreadable row yields no date");
    assert_eq!(dto.grace_until, None, "and no grace deadline");
    assert!(!dto.is_expired, "Unavailable is deliberately not Expired");
    assert!(dto.addons.is_empty(), "no add-on survives a failed read");
    assert_eq!(
        dto.max_locations,
        Some(1),
        "the caps are Free caps, because the tier is the fail-closed Free"
    );
    assert_eq!(dto.max_pos_instances, Some(1), "Free POS cap");
    assert_eq!(dto.max_staff_users, Some(1), "Free staff cap");
    assert_eq!(dto.sales_history_days, Some(90), "Free history cap");
    assert_eq!(
        dto.supports_qris, FAIL_CLOSED_GATES_LOCKED,
        "a rejected row grants nothing"
    );
    assert_eq!(
        dto.supports_analytics, FAIL_CLOSED_GATES_LOCKED,
        "a rejected row grants nothing"
    );
    assert_eq!(
        dto.supports_loyalty, FAIL_CLOSED_GATES_LOCKED,
        "a rejected row grants nothing"
    );
}

/// The verdict as the read explains itself when NO row verifies: lifecycle
// outranks the other five axes, so a forked verdict fixture lands on
// lifecycle whatever tier, quota, role, scope or server-policy answer the
// debug arm names. Pinned to the product accessor, not a remembered string.
fn assert_verdict_fail_closed(v: &FeatureVerdict) {
    assert_eq!(
        v.available, FAIL_CLOSED_GATES_LOCKED,
        "no gate opens for an unverifiable row"
    );
    assert_eq!(
        v.reason_code(),
        Some(AvailabilityReason::Lifecycle.as_str()),
        "lifecycle is the highest-precedence denial left standing when nothing verified"
    );
    assert_eq!(
        v.detail.tier, FAIL_CLOSED_TIER,
        "the verdict echoes the fail-closed tier"
    );
    assert_eq!(
        v.detail.state, FAIL_CLOSED_STATE,
        "the verdict echoes the fail-closed state"
    );
    assert_eq!(
        v.detail.expires_at, None,
        "no expiry is readable from the row"
    );
    assert_eq!(v.detail.grace_until, None, "and no grace deadline");
}

#[test]
fn capabilities_reflect_free_tier_and_zero_usage() {
    let conn = fresh_db();
    let dto = caps(&conn);
    // In debug builds, load_capabilities upgrades Free -> Premium
    // so all features are available during development.
    #[cfg(debug_assertions)]
    {
        assert_eq!(
            dto.tier, "premium",
            "debug builds upgrade Free tier to Premium"
        );
        assert_eq!(dto.max_locations, Some(5));
        assert_eq!(dto.max_staff_users, Some(50));
        assert_eq!(dto.sales_history_days, None, "Premium = unlimited history");
        assert!(dto.supports_qris);
        assert!(dto.supports_analytics);
        assert!(dto.supports_loyalty);
    }
    #[cfg(not(debug_assertions))]
    {
        assert_eq!(dto.tier, "free");
        assert_eq!(dto.max_locations, Some(1));
        assert_eq!(dto.max_staff_users, Some(1));
        assert_eq!(dto.sales_history_days, Some(90));
        assert!(!dto.supports_qris);
        assert!(!dto.supports_analytics);
        assert!(!dto.supports_loyalty);
    }
    assert_eq!(dto.location_count, 1, "fresh DB seeds the primary store");
    assert_eq!(dto.staff_count, 0);
    assert_eq!(dto.terminal_count, 0);
}

#[test]
fn capabilities_reflect_plus_and_pro_tiers() {
    let conn = fresh_db();
    seed_tier(&conn, "plus");
    let dto = caps(&conn);
    if seeded_row_reaches_a_paid_tier() {
        assert_eq!(dto.tier, "plus");
        assert_eq!(dto.max_locations, Some(1));
        assert_eq!(dto.max_pos_instances, Some(2));
        assert_eq!(dto.max_staff_users, Some(5));
        assert_eq!(dto.sales_history_days, Some(365));
        assert!(dto.supports_qris);
        assert!(!dto.supports_analytics, "analytics stays Pro+");
        assert!(!dto.supports_loyalty, "loyalty stays Premium+");

        seed_tier(&conn, "pro");
        let dto = caps(&conn);
        assert_eq!(dto.tier, "pro");
        assert_eq!(dto.max_locations, Some(2));
        assert_eq!(dto.max_pos_instances, Some(5));
        assert_eq!(dto.max_staff_users, Some(20));
        assert!(dto.supports_analytics);
        assert!(!dto.supports_loyalty);
    } else {
        // Release: the row exists and still carries the PLUS stamp in its own
        // column, and none of it reaches the caller — the caps are the
        // fail-closed Free projection for both legs.
        assert_seeded_row(&conn, "plus");
        assert_caps_fail_closed(&dto);
        seed_tier(&conn, "pro");
        let dto = caps(&conn);
        assert_seeded_row(&conn, "pro");
        assert_caps_fail_closed(&dto);
    }
}

#[test]
fn capabilities_reflect_premium_tier() {
    let conn = fresh_db();
    seed_tier(&conn, "premium");
    let dto = caps(&conn);
    if seeded_row_reaches_a_paid_tier() {
        assert_eq!(dto.tier, "premium");
        // C4.2: Premium allows up to 5 stores self-serve
        assert_eq!(dto.max_locations, Some(5));
        assert_eq!(dto.max_pos_instances, None);
        assert_eq!(dto.max_staff_users, Some(50));
        assert_eq!(dto.sales_history_days, None); // unlimited
        assert!(dto.supports_qris);
        assert!(dto.supports_analytics);
        assert!(dto.supports_loyalty);
    } else {
        // Release: the PREMIUM stamp is on the row; the caps are Free.
        assert_seeded_row(&conn, "premium");
        assert_caps_fail_closed(&dto);
    }
}

// ── Lifecycle state + fail-closed (todo-global-saas-1.md §B) ─────────

#[test]
fn capabilities_report_active_state_for_bootstrap_row() {
    let conn = fresh_db();
    let dto = caps(&conn);
    if seeded_row_loads() {
        assert_eq!(dto.state, "active");
        assert_eq!(dto.status, "active");
        assert_eq!(dto.expires_at, None);
        assert_eq!(dto.grace_until, None);
        assert!(!dto.is_expired);
    } else {
        // Release: the row is present, its status COLUMN still reads active,
        // and the read projects unavailable for all of it.
        let row = assert_seeded_row(&conn, "free");
        assert_eq!(
            row.status, "active",
            "the seeded column must still say active - it is the READ that fails, not the data"
        );
        assert_eq!(dto.state, FAIL_CLOSED_STATE, "the read is unavailable");
        assert_eq!(dto.status, FAIL_CLOSED_STATE, "status reads the same row");
        assert_eq!(dto.expires_at, None, "no date survives an unreadable row");
        assert_eq!(dto.grace_until, None);
        assert!(!dto.is_expired, "Unavailable is not Expired");
    }
}

#[test]
fn capabilities_fail_closed_when_subscription_row_missing() {
    let conn = fresh_db();
    conn.execute(
        "DELETE FROM tenant_subscription WHERE tenant_id = 'default'",
        [],
    )
    .unwrap();
    let dto = caps(&conn);
    assert_eq!(dto.state, "unavailable");
    assert_eq!(dto.status, "unavailable");
    assert_eq!(dto.expires_at, None);
    assert_eq!(dto.grace_until, None);
    assert!(!dto.is_expired);
    // Fail closed: Free entitlements — the debug Premium upgrade must not
    // apply, so every tier gate locks even in dev builds.
    assert_eq!(dto.tier, "free");
    assert!(!dto.supports_qris);
    assert!(!dto.supports_analytics);
    assert!(!dto.supports_loyalty);
    assert!(dto.addons.is_empty());
    // Usage counts stay best-effort readable (banner inputs only).
    assert_eq!(dto.location_count, 1, "fresh DB seeds the primary store");
}

#[test]
fn capabilities_fail_closed_when_signature_tampered() {
    let conn = fresh_db();
    conn.execute(
        "UPDATE tenant_subscription SET signature = 'tampered' WHERE tenant_id = 'default'",
        [],
    )
    .unwrap();
    let dto = caps(&conn);
    assert_eq!(dto.state, "unavailable");
    assert_eq!(dto.status, "unavailable");
    assert_eq!(dto.tier, "free");
    assert!(!dto.supports_qris);
}

#[test]
fn capabilities_report_grace_state_within_offline_grace() {
    // Row columns are independent of the signature (verify_signature
    // covers only signed_payload), so a local snapshot edit is enough to
    // drive the state machine. Premium grace is 30 days.
    let conn = fresh_db();
    seed_tier(&conn, "premium");
    let recent = (chrono::Utc::now() - chrono::Duration::days(7)).to_rfc3339();
    conn.execute(
        "UPDATE tenant_subscription SET expires_at = ?1 WHERE tenant_id = 'default'",
        [&recent],
    )
    .unwrap();
    let dto = caps(&conn);
    if seeded_row_reaches_a_paid_tier() {
        assert_eq!(dto.state, "grace");
        assert_eq!(dto.status, "active");
        assert_eq!(dto.expires_at.as_deref(), Some(recent.as_str()));
        assert!(dto.grace_until.is_some(), "grace deadline must be computed");
        assert!(!dto.is_expired);
        // Within grace the REAL tier applies (operational continuity) — the
        // debug Free→Premium upgrade does not mask the state.
        assert_eq!(dto.tier, "premium");
    } else {
        // Release: the PREMIUM stamp and the expiry this fixture wrote are both
        // still on the row; the grace machine never sees them, because the
        // signature gate closes before the state machine runs.
        let row = assert_seeded_row(&conn, "premium");
        assert_eq!(
            row.expires_at.as_deref(),
            Some(recent.as_str()),
            "the fixture expiry stamp must be on the row the release arm reads"
        );
        assert_caps_fail_closed(&dto);
    }
}

#[test]
fn capabilities_report_expired_state_and_free_entitlements() {
    let conn = fresh_db();
    seed_tier(&conn, "plus");
    // Plus grace is 14 days — 30 days past expiry is outside it.
    let old = (chrono::Utc::now() - chrono::Duration::days(30)).to_rfc3339();
    conn.execute(
        "UPDATE tenant_subscription SET expires_at = ?1 WHERE tenant_id = 'default'",
        [&old],
    )
    .unwrap();
    let dto = caps(&conn);
    if seeded_row_reaches_a_paid_tier() {
        assert_eq!(dto.state, "expired");
        assert_eq!(dto.status, "active");
        assert_eq!(dto.expires_at.as_deref(), Some(old.as_str()));
        assert_eq!(dto.grace_until, None, "grace deadline is None when expired");
        assert!(dto.is_expired, "is_expired is true when in expired state");
        assert_eq!(
            dto.tier, "free",
            "outside grace the tier downgrades to Free"
        );
        assert!(!dto.supports_qris);
    } else {
        // Release: the PLUS stamp and the past expiry are on the row, and the
        // read still cannot get to them - so the answer is the fail-closed
        // projection, which is NOT the same fact as "expired": a rejected
        // signature yields unknown, never a date.
        let row = assert_seeded_row(&conn, "plus");
        assert_eq!(
            row.expires_at.as_deref(),
            Some(old.as_str()),
            "the fixture expiry stamp must be on the row the release arm reads"
        );
        assert_caps_fail_closed(&dto);
    }
}

#[test]
fn capabilities_report_canceled_state_even_with_live_expiry() {
    let conn = fresh_db();
    seed_tier(&conn, "pro");
    let future = (chrono::Utc::now() + chrono::Duration::days(30)).to_rfc3339();
    conn.execute(
        "UPDATE tenant_subscription SET status = 'canceled', expires_at = ?1
         WHERE tenant_id = 'default'",
        [future],
    )
    .unwrap();
    let dto = caps(&conn);
    if seeded_row_reaches_a_paid_tier() {
        assert_eq!(dto.state, "canceled");
        assert_eq!(dto.tier, "free", "canceled is never within grace");
    } else {
        // Release: the CANCELED status is on the row (and the PRO stamp), yet
        // the projected state is unavailable - the read never reaches the
        // lifecycle machine that would name it canceled.
        let row = assert_seeded_row(&conn, "pro");
        assert_eq!(
            row.status, "canceled",
            "the fixture status stamp must be on the row"
        );
        assert_caps_fail_closed(&dto);
    }
}

#[test]
fn capabilities_report_paused_state() {
    let conn = fresh_db();
    seed_tier(&conn, "plus");
    conn.execute(
        "UPDATE tenant_subscription SET status = 'paused' WHERE tenant_id = 'default'",
        [],
    )
    .unwrap();
    let dto = caps(&conn);
    if seeded_row_reaches_a_paid_tier() {
        assert_eq!(dto.state, "paused");
        assert_eq!(
            dto.tier, "plus",
            "pause flags the state; entitlements unchanged here"
        );
    } else {
        // Release: PAUSED is on the row and PLUS is the stamped tier; the
        // projection is unavailable + Free because nothing verified.
        let row = assert_seeded_row(&conn, "plus");
        assert_eq!(
            row.status, "paused",
            "the fixture status stamp must be on the row"
        );
        assert_caps_fail_closed(&dto);
    }
}

#[test]
fn capabilities_reflect_server_status_refresh() {
    let conn = fresh_db();
    seed_tier(&conn, "pro");
    let future = (chrono::Utc::now() + chrono::Duration::days(45)).to_rfc3339();

    // Initially active without expiry
    let before = caps(&conn);
    if seeded_row_reaches_a_paid_tier() {
        assert_eq!(before.status, "active");
        assert_eq!(before.expires_at, None);
    } else {
        assert_seeded_row(&conn, "pro");
        assert_eq!(
            before.status, FAIL_CLOSED_STATE,
            "release reads unavailable whatever the status column says"
        );
        assert_eq!(before.expires_at, None);
    }

    // Refresh status from server (e.g. check_license_status response)
    kasirmu_core::license_verification::refresh_subscription_status_from_server(
        &conn,
        "default",
        "active",
        Some(&future),
    )
    .unwrap();

    // Cache should immediately reflect refreshed status and expiry
    let after = caps(&conn);
    if seeded_row_reaches_a_paid_tier() {
        assert_eq!(after.status, "active");
        assert_eq!(after.expires_at.as_deref(), Some(future.as_str()));
        assert_eq!(after.state, "active");
        assert!(!after.is_expired);
    } else {
        // Release: the refresh DID write - the row carries both stamps - and
        // the read still projects the fail-closed pair, because an
        // unverifiable row is never trusted with a status or a date.
        let row = assert_seeded_row(&conn, "pro");
        assert_eq!(
            row.status, "active",
            "the refreshed status stamp must be on the row"
        );
        assert_eq!(
            row.expires_at.as_deref(),
            Some(future.as_str()),
            "the refreshed expiry stamp must be on the row"
        );
        assert_caps_fail_closed(&after);
    }

    // Now simulate cancellation from server
    kasirmu_core::license_verification::refresh_subscription_status_from_server(
        &conn,
        "default",
        "canceled",
        Some(&future),
    )
    .unwrap();

    let canceled = caps(&conn);
    if seeded_row_reaches_a_paid_tier() {
        assert_eq!(canceled.status, "canceled");
        assert_eq!(canceled.state, "canceled");
    } else {
        let row = assert_seeded_row(&conn, "pro");
        assert_eq!(
            row.status, "canceled",
            "the server-sent cancellation must be on the row the release arm reads"
        );
        assert_caps_fail_closed(&canceled);
    }
}

// ── Feature-availability verdicts (Phase 3 observability) ────────────

/// An owner user: `role-owner`'s `*` grant holds every gate permission,
/// so the role axis never fires and the other axes stand alone.
fn verdict_with_owner(conn: &rusqlite::Connection, feature: &str) -> FeatureVerdict {
    conn.execute(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at)
         VALUES ('role-owner', 'Owner', '', '[\"*\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')
         ON CONFLICT(id) DO NOTHING",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')
         ON CONFLICT(id) DO NOTHING",
        [],
    )
    .unwrap();
    // Session context: the seeded primary location ("default") and a
    // retail-pos workspace — the pair the session gate itself scopes on.
    load_feature_verdict(conn, "user-owner", feature, "default", "retail-pos").unwrap()
}

#[test]
fn verdict_names_tier_when_the_flag_is_missing() {
    let conn = fresh_db();
    seed_tier(&conn, "plus");
    let v = verdict_with_owner(&conn, "supports_analytics");
    // The feature key and the gate permission it consults are read from the
    // registry, not from the subscription, so they are profile-independent.
    assert_eq!(v.feature, "supports_analytics");
    assert_eq!(v.detail.permission.as_deref(), Some("analytics:view"));
    if seeded_row_reaches_a_paid_tier() {
        assert!(!v.available);
        assert_eq!(v.reason_code(), Some("tier"));
        assert_eq!(v.detail.state, "active");
    } else {
        // Release: the tier axis is never reached - lifecycle outranks it.
        assert_seeded_row(&conn, "plus");
        assert_verdict_fail_closed(&v);
    }
}

#[test]
fn verdict_names_quota_at_the_cap_and_clears_one_below() {
    let conn = fresh_db();
    seed_tier(&conn, "pro");
    // Pro caps locations at 2; the fresh DB seeds the primary store, so
    // one more reaches the cap.
    conn.execute(
        "INSERT INTO locations (id, name) VALUES ('loc-2', 'Second')",
        [],
    )
    .unwrap();
    let v = verdict_with_owner(&conn, "locations");
    if seeded_row_reaches_a_paid_tier() {
        assert!(!v.available, "pro at its 2-location cap must deny");
        assert_eq!(v.reason_code(), Some("quota"));
        assert_eq!(v.detail.limit, Some(2));
        assert_eq!(v.detail.usage, Some(2));

        conn.execute("DELETE FROM locations WHERE id = 'loc-2'", [])
            .unwrap();
        let v = load_feature_verdict(&conn, "user-owner", "locations", "default", "retail-pos")
            .unwrap();
        assert!(v.available, "one below the cap must clear");
        assert_eq!(v.reason_code(), None);
    } else {
        // Release: the quota machine is never consulted - and note the
        // fail-closed Entitlements carries DEFAULT usage, not gathered usage,
        // so even the numbers below are the failed read, not the topology.
        assert_seeded_row(&conn, "pro");
        assert_verdict_fail_closed(&v);

        conn.execute("DELETE FROM locations WHERE id = 'loc-2'", [])
            .unwrap();
        let v = load_feature_verdict(&conn, "user-owner", "locations", "default", "retail-pos")
            .unwrap();
        assert_seeded_row(&conn, "pro");
        assert_verdict_fail_closed(&v);
    }
}

#[test]
fn verdict_names_server_policy_when_the_tier_withholds_the_workspace_type() {
    let conn = fresh_db();
    seed_tier(&conn, "plus");
    let v = verdict_with_owner(&conn, "supports_qris");
    if seeded_row_reaches_a_paid_tier() {
        assert!(v.available, "plus supports qris");
    } else {
        // Release: PLUS supports qris on the tier ladder and the row says so;
        // the caller never learns, because the row did not verify.
        assert_seeded_row(&conn, "plus");
        assert_verdict_fail_closed(&v);
    }

    // The bootstrap Free row's allowed workspace types exclude
    // `warehouse` — the same `allows_workspace_type` answer the
    // workspace-creation gate enforces, so the verdict is server_policy
    // whatever the effective tier's flags say.
    let conn = fresh_db();
    let v = verdict_with_owner(&conn, "warehouses");
    // The gate permission is registry data, not subscription data, so it
    // echoes for diagnostics in either profile.
    assert_eq!(
        v.detail.permission.as_deref(),
        Some("inventory:locations_manage")
    );
    // Since 19-09-26 the bootstrap Free row loads in release as well as in
    // debug, so the allowed-workspace-types answer is readable in BOTH profiles
    // and the fork that used to separate them is gone. The old release arm
    // asserted fail-closed `lifecycle` on the premise that the payload was
    // unreadable — the very premise the ruling removed — so keeping it would
    // pin a verdict the product no longer produces.
    assert_seeded_row(&conn, "free");
    assert!(!v.available);
    assert_eq!(v.reason_code(), Some("server_policy"));
}

#[test]
fn verdict_names_role_for_a_role_without_the_gate_permission() {
    let conn = fresh_db();
    seed_tier(&conn, "premium");
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-lite', 'Lite', 'No analytics', '[\"loyalty:view\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-lite', 'lite', 'hash', 'Lite', 'role-lite', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
    let v = load_feature_verdict(
        &conn,
        "user-lite",
        "supports_analytics",
        "default",
        "retail-pos",
    )
    .unwrap();
    if seeded_row_reaches_a_paid_tier() {
        // Premium grants analytics on the tier; the caller's role is the
        // missing axis.
        assert!(!v.available);
        assert_eq!(v.reason_code(), Some("role"));
    } else {
        // Release: lifecycle outranks role, so the role axis is never named.
        assert_seeded_row(&conn, "premium");
        assert_verdict_fail_closed(&v);
    }

    let v = load_feature_verdict(
        &conn,
        "user-lite",
        "supports_loyalty",
        "default",
        "retail-pos",
    )
    .unwrap();
    if seeded_row_reaches_a_paid_tier() {
        assert!(v.available, "loyalty:view holds the loyalty gate");
    } else {
        // Release: the row exists and the role axis really does hold - the
        // permission is registry data and still echoes - but the failed
        // subscription read denies before any of it is consulted.
        assert_seeded_row(&conn, "premium");
        assert_eq!(v.detail.permission.as_deref(), Some("loyalty:view"));
        assert_verdict_fail_closed(&v);
    }
}

#[test]
fn verdict_names_lifecycle_for_an_expired_subscription() {
    let conn = fresh_db();
    seed_tier(&conn, "premium");
    // Long past both expiry and the 60-day enterprise/premium grace —
    // hard-expired.
    conn.execute(
        "UPDATE tenant_subscription SET status = 'active', expires_at = '2025-01-01T00:00:00Z'
         WHERE tenant_id = 'default'",
        [],
    )
    .unwrap();
    let v = verdict_with_owner(&conn, "supports_loyalty");
    assert!(!v.available);
    assert_eq!(v.reason_code(), Some("lifecycle"));
    if seeded_row_reaches_a_paid_tier() {
        assert_eq!(v.detail.state, "expired");
        assert_eq!(v.detail.expires_at.as_deref(), Some("2025-01-01T00:00:00Z"));
    } else {
        // Release: the SAME reason code for a different reason. Debug names
        // this verdict lifecycle off a real expiry the row carries; release
        // names it lifecycle off the failed read - so the detail, which is
        // the part that came from the row, reads unavailable with no date.
        let row = assert_seeded_row(&conn, "premium");
        assert_eq!(
            row.expires_at.as_deref(),
            Some("2025-01-01T00:00:00Z"),
            "the expired-row stamp must be on the row the release arm reads"
        );
        assert_eq!(v.detail.state, FAIL_CLOSED_STATE);
        assert_eq!(v.detail.expires_at, None);
        assert_eq!(v.detail.grace_until, None);
    }
}

#[test]
fn verdict_in_grace_stays_available_and_carries_the_deadline() {
    let conn = fresh_db();
    seed_tier(&conn, "premium");
    // Expired 3 days ago: inside premium's 60-day grace window.
    let three_days_ago = (chrono::Utc::now() - chrono::Duration::days(3)).to_rfc3339();
    conn.execute(
        "UPDATE tenant_subscription SET status = 'active', expires_at = ?1
         WHERE tenant_id = 'default'",
        [three_days_ago],
    )
    .unwrap();
    let v = verdict_with_owner(&conn, "supports_loyalty");
    if seeded_row_reaches_a_paid_tier() {
        assert!(v.available, "grace passes operational entitlements (§B)");
        assert_eq!(v.reason_code(), None);
        assert_eq!(v.detail.state, "grace");
        assert!(v.detail.grace_until.is_some(), "UI renders the deadline");
    } else {
        // Release: the grace window is a property of a VERIFIED row; an
        // unverifiable one has no window to grant, so the deadline the UI
        // would render is gone with the rest of it.
        assert_seeded_row(&conn, "premium");
        assert_verdict_fail_closed(&v);
    }
}

#[test]
fn verdict_addon_grant_clears_the_tier_denial_for_analytics() {
    let conn = fresh_db();
    seed_tier(&conn, "plus");
    // Signed payload carrying the advanced_analytics add-on (C4.3).
    conn.execute(
        "UPDATE tenant_subscription SET signed_payload = ?1 WHERE tenant_id = 'default'",
        [r#"{"addons":["advanced_analytics"]}"#],
    )
    .unwrap();
    let v = verdict_with_owner(&conn, "supports_analytics");
    if seeded_row_reaches_a_paid_tier() {
        assert!(v.available, "the add-on answers the tier question");
        assert_eq!(v.reason_code(), None);
    } else {
        // Release: the add-on list is read OUT of the signed payload, so a
        // row that will not verify carries no add-on the caller can spend.
        let row = assert_seeded_row(&conn, "plus");
        assert!(
            row.signed_payload.contains("advanced_analytics"),
            "the fixture must still have written the add-on payload onto the row - otherwise this leg would be asserting about a row it never shaped"
        );
        assert_verdict_fail_closed(&v);
    }
}

// ── Over-quota report (§J remediation) ───────────────────────────────

/// The report assesses against the EFFECTIVE tier — the one the creation
/// gates enforce — so a dimension reported over quota is exactly one
/// whose next creation the gate rejects. On the fresh seeded row (Free,
/// active) the report shows the Free quotas and the seeded primary
/// location at-cap-not-over.
#[test]
fn over_quota_report_assesses_the_effective_tier() {
    let conn = fresh_db();
    // B3: the seam now also returns the effective tier the per-location
    // fan-out is driven by; these tenant-global tests do not need it.
    let (report, _tier) = load_over_quota_report(&conn).unwrap();
    assert_eq!(report.tier_key, "free");
    // Locations: the seeded primary location sits at the Free cap (1) —
    // at-cap-not-over, the §J "compliant but blocks creation" distinction.
    let locations = report
        .usage(kasirmu_core::downgrade::QuotaDimension::Locations)
        .unwrap();
    assert_eq!(locations.limit, Some(1));
    assert_eq!(locations.current, 1);
    assert!(!locations.is_over_quota());
    // Nothing is over quota on the fresh row.
    assert!(!report.is_over_quota());
}

/// A downgrade simulation: stuffing the DB past the Free caps makes the
/// report name exactly the over dimensions with the right excess — the
/// numbers an archive-or-upgrade view renders. Staff users sit under the
/// `role-staff` preset id (count_staff_users excludes only the owner);
/// terminals need the schema's NOT NULL device_id.
#[test]
fn over_quota_report_names_dimensions_and_excess_after_downgrade() {
    let conn = fresh_db();
    conn.execute_batch(
        "INSERT INTO locations (id, name) VALUES ('loc-2', 'Second'), ('loc-3', 'Third');
         INSERT INTO terminals (id, name, device_id) VALUES ('t-1', 'T1', 'dev-1'), ('t-2', 'T2', 'dev-2');
         INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-staff', 'Staff', '', '[\"sales:process\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) VALUES
            ('u-1', 'a', 'h', 'A', 'role-staff', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
            ('u-2', 'b', 'h', 'B', 'role-staff', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
    // B3: the seam now also returns the effective tier the per-location
    // fan-out is driven by; these tenant-global tests do not need it.
    let (report, _tier) = load_over_quota_report(&conn).unwrap();
    assert!(
        report.is_over_quota(),
        "3 locations / 3 staff / 3 terminals on Free must report over"
    );
    let locations = report
        .usage(kasirmu_core::downgrade::QuotaDimension::Locations)
        .unwrap();
    assert_eq!(locations.excess(), 2);
    let staff = report
        .usage(kasirmu_core::downgrade::QuotaDimension::Staff)
        .unwrap();
    assert_eq!(
        staff.excess(),
        1,
        "2 staff on the Free cap of 1 -> excess 1"
    );
    let terminals = report
        .usage(kasirmu_core::downgrade::QuotaDimension::PosRegisters)
        .unwrap();
    assert_eq!(
        terminals.excess(),
        1,
        "2 terminals on the Free cap of 1 -> excess 1"
    );
    assert_eq!(report.total_excess(), 4);
}

#[test]
fn verdict_rejects_unknown_keys_fail_closed() {
    let conn = fresh_db();
    assert!(matches!(
        load_feature_verdict(&conn, "nobody", "analytics", "default", "retail-pos"),
        Err(BridgeError::Invalid(_))
    ));
    assert!(matches!(
        load_feature_verdict(&conn, "nobody", "max_stores", "default", "retail-pos"),
        Err(BridgeError::Invalid(_))
    ));
}

// ── Scope axis (ADR #47 v1 ruling: current-location) ─────────────────

/// A user whose assignment row is a scoped, location-bound manager.
struct ScopedUser;

impl ScopedUser {
    const USER: &str = "user-scoped";
    const LOCATION: &str = "loc-scoped";

    /// Seed the role, user, assignment (scoped to [`Self::LOCATION`]
    /// for the `retail-pos` workspace only), and that location itself.
    fn seed(conn: &rusqlite::Connection) {
        conn.execute_batch(
            "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
                ('role-scoped', 'Scoped Manager', '', '[\"loyalty:view\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
             INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
                VALUES ('user-scoped', 'scoped', 'hash', 'Scoped', 'role-scoped', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
             INSERT INTO assignments (user_id, role_id, scope_mode, branch_scope, workspace_scope)
                VALUES ('user-scoped', 'role-scoped', 'scoped', 'list', 'list');
             INSERT INTO assignment_branches (assignment_user_id, branch_id)
                VALUES ('user-scoped', 'loc-scoped');
             INSERT INTO assignment_workspaces (assignment_user_id, workspace_key)
                VALUES ('user-scoped', 'retail-pos');"
        )
        .unwrap();
        // The location the assignment is bound to, with its entity.
        conn.execute_batch(
            "INSERT INTO legal_entities (id, tenant_id, name) VALUES
                ('ent-1', 'default', 'Entity One');
             INSERT INTO locations (id, name, legal_entity_id)
                VALUES ('loc-scoped', 'Scoped Location', 'ent-1');",
        )
        .unwrap();
    }
}

#[test]
fn verdict_scope_denies_when_the_assignment_excludes_the_session_location() {
    let conn = fresh_db();
    seed_tier(&conn, "premium");
    ScopedUser::seed(&conn);
    // Session stands in the seeded primary location ("default"), which
    // the assignment does NOT cover — the 0048 branch dimension denies.
    let v = load_feature_verdict(
        &conn,
        ScopedUser::USER,
        "supports_loyalty",
        "default",
        "retail-pos",
    )
    .unwrap();
    // The scope axis is an assignment question, not a subscription question,
    // so it answers the same way in either profile.
    assert_eq!(v.detail.scope_granted, Some(false));
    if seeded_row_reaches_a_paid_tier() {
        // Premium + the gate permission both clear; scope is the missing axis.
        assert!(!v.available, "out-of-scope session location must deny");
        assert_eq!(v.reason_code(), Some("scope"));
    } else {
        // Release: scope still denies on the facts, but lifecycle outranks it,
        // so the verdict is not about scope at all.
        assert_seeded_row(&conn, "premium");
        assert_verdict_fail_closed(&v);
    }
}

#[test]
fn verdict_scope_clears_inside_the_assigned_location() {
    let conn = fresh_db();
    seed_tier(&conn, "premium");
    ScopedUser::seed(&conn);
    // Session stands in the location the assignment covers.
    let v = load_feature_verdict(
        &conn,
        ScopedUser::USER,
        "supports_loyalty",
        ScopedUser::LOCATION,
        "retail-pos",
    )
    .unwrap();
    // The scope axis is an assignment question, not a subscription question:
    // in-scope clears on the facts in either profile.
    assert_eq!(v.detail.scope_granted, Some(true));
    if seeded_row_reaches_a_paid_tier() {
        assert!(v.available, "in-scope session location must clear");
        assert_eq!(v.reason_code(), None);
    } else {
        // Release: an in-scope caller on an unverifiable row is still denied,
        // and the reason is the read, not the assignment.
        assert_seeded_row(&conn, "premium");
        assert_verdict_fail_closed(&v);
    }
}

#[test]
fn verdict_scope_denies_when_the_workspace_dimension_excludes_the_session_type() {
    let conn = fresh_db();
    seed_tier(&conn, "premium");
    ScopedUser::seed(&conn);
    // Right location, but the assignment only covers retail-pos workspaces.
    let v = load_feature_verdict(
        &conn,
        ScopedUser::USER,
        "supports_loyalty",
        ScopedUser::LOCATION,
        "warehouse",
    )
    .unwrap();
    assert_eq!(v.detail.scope_granted, Some(false));
    if seeded_row_reaches_a_paid_tier() {
        assert!(!v.available, "out-of-scope workspace type must deny");
        assert_eq!(v.reason_code(), Some("scope"));
    } else {
        // Release: same shape as the location leg - the workspace axis is
        // answered, and lifecycle is what the verdict reports.
        assert_seeded_row(&conn, "premium");
        assert_verdict_fail_closed(&v);
    }
}

// ── Phase D1 payload feature-grant precedence (recorded debt: coder-1 ──
// landed the verdicts without pinning the explicit-grant precedence) ──

/// Seed a signed payload. Debug test builds accept the `BOOTSTRAP_FREE`
/// sentinel signature for ANY payload, so the default seeded row's
/// signature keeps verifying after this update — no license server needed
/// to exercise the Phase D1 `features` block.
fn seed_payload(conn: &rusqlite::Connection, payload: &str) {
    conn.execute(
        "UPDATE tenant_subscription SET signed_payload = ?1 WHERE tenant_id = 'default'",
        [payload],
    )
    .unwrap();
}

#[test]
fn verdict_payload_false_withholds_where_tier_allows() {
    let conn = fresh_db();
    seed_tier(&conn, "premium");
    // Premium natively supports analytics; an explicit `false` in the
    // signed `features` block must outrank the tier and withhold it.
    seed_payload(&conn, r#"{"features":{"supports_analytics":false}}"#);
    let v = verdict_with_owner(&conn, "supports_analytics");
    assert!(
        !v.available,
        "explicit false must withhold where the tier allows"
    );
    if seeded_row_reaches_a_paid_tier() {
        assert_eq!(v.reason_code(), Some("server_policy"));
    } else {
        // Release: the explicit instruction lives INSIDE the signed payload,
        // so an unverifiable row cannot deliver it. The denial is the same
        // size, but it is named lifecycle and not server_policy - and the
        // payload is still on the row, so this is a read failure, not a lost
        // write.
        let row = assert_seeded_row(&conn, "premium");
        assert!(
            row.signed_payload.contains("supports_analytics"),
            "the fixture must still have written the payload onto the row the release arm reads"
        );
        assert_verdict_fail_closed(&v);
    }
}

#[test]
fn verdict_payload_true_grants_beyond_tier() {
    let conn = fresh_db();
    // Plus does NOT natively support analytics (Pro+ only, no add-on here).
    seed_tier(&conn, "plus");
    // An explicit `true` in the signed `features` block grants the feature
    // beyond what the tier would allow. Uses Plus (not Free) deliberately:
    // the desktop debug Free→Premium upgrade would otherwise mask the
    // "beyond tier" behaviour.
    seed_payload(&conn, r#"{"features":{"supports_analytics":true}}"#);
    let v = verdict_with_owner(&conn, "supports_analytics");
    if seeded_row_reaches_a_paid_tier() {
        assert!(v.available, "explicit true must grant beyond the tier");
        assert_eq!(v.reason_code(), None);
    } else {
        // Release: a server grant can outrank the TIER axis, but it never
        // outlives the signature that carries it. The explicit true is on the
        // row and grants nothing to a caller who cannot read it.
        let row = assert_seeded_row(&conn, "plus");
        assert!(
            row.signed_payload.contains("supports_analytics"),
            "the fixture must still have written the payload onto the row the release arm reads"
        );
        assert_verdict_fail_closed(&v);
    }
}

#[test]
fn verdict_absent_features_block_leaves_the_tier_answer() {
    let conn = fresh_db();
    // Premium natively supports analytics: with no `features` block the
    // tier answer stands (available, no denial reason).
    seed_tier(&conn, "premium");
    if seeded_row_reaches_a_paid_tier() {
        let v = verdict_with_owner(&conn, "supports_analytics");
        assert!(
            v.available,
            "absent payload must not withhold a tier-granted feature"
        );
        assert_eq!(v.reason_code(), None);

        // Plus denies analytics on the tier: with no `features` block the tier
        // denial stands (no payload opinion, so the tier answers).
        let conn = fresh_db();
        seed_tier(&conn, "plus");
        let v = verdict_with_owner(&conn, "supports_analytics");
        assert!(
            !v.available,
            "absent payload must not grant a tier-denied feature"
        );
        assert_eq!(v.reason_code(), Some("tier"));
    } else {
        // Release: with no readable payload there is no tier answer either.
        // Both legs collapse onto the same fail-closed projection - the
        // precedence table this case is really about stays pinned in
        // kasirmu-core/availability_tests.rs, where no sentinel row is involved.
        let v = verdict_with_owner(&conn, "supports_analytics");
        assert_seeded_row(&conn, "premium");
        assert_verdict_fail_closed(&v);

        let conn = fresh_db();
        seed_tier(&conn, "plus");
        let v = verdict_with_owner(&conn, "supports_analytics");
        assert_seeded_row(&conn, "plus");
        assert_verdict_fail_closed(&v);
    }
}

// ── §J B3: per-location quota rows ───────────────────────────────────

fn b3_manager() -> StoreDatabaseManager {
    StoreDatabaseManager::new(std::env::temp_dir(), kasirmu_core::migrations::ALL)
}

/// A store id unique to this process and test, because `b3_manager` writes into
/// the real temp directory: a fixed name would let one run's leftover database
/// satisfy the next run's `store_db_exists` and turn the skip test into a pass
/// that proves nothing.
fn b3_store_id(tag: &str) -> String {
    format!("b3-{}-{}", std::process::id(), tag)
}

#[test]
fn per_location_rows_skip_a_store_with_no_database_and_create_none() {
    // The invariant the ruling asked for: this runs on the read path of a
    // settings screen, and `open_store` CREATES the file when missing. A
    // location row whose database does not exist yet must be skipped, and the
    // skip must not leave a file behind.
    let manager = b3_manager();
    let sid = b3_store_id("ghost");
    assert!(!manager.store_db_exists(&sid));
    let rows = per_location_over_quota_rows(
        &[(sid.clone(), "Ghost Store".into())],
        &manager,
        &SubscriptionTier::Pro,
    )
    .unwrap();
    assert!(
        rows.is_empty(),
        "a store with no database has no instances to flag"
    );
    assert!(
        !manager.store_db_exists(&sid),
        "reads must never create a store database"
    );
}

#[test]
fn per_location_rows_emit_at_cap_and_omit_zero_counts() {
    let manager = b3_manager();
    let sid = b3_store_id("pro-kds");
    {
        let conn = manager.open_store(&sid).unwrap();
        let db = conn.lock().unwrap();
        let store = Store::new(&db);
        store
            .create_location_profile(&kasirmu_core::LocationProfile {
                id: sid.clone(),
                name: "Pro Store".into(),
                address: String::new(),
                tax_id: String::new(),
                currency: "IDR".into(),
                timezone: "UTC".into(),
                is_primary: true,
                created_at: "2026-07-01T00:00:00Z".into(),
                updated_at: "2026-07-01T00:00:00Z".into(),
            })
            .unwrap();
        // Pro caps KDS screens at 2 per location: exactly 2 is `at`, not `over`.
        for n in 1..=2 {
            store
                .create_workspace_instance(
                    &format!("{sid}-kds-{n}"),
                    "kds",
                    &sid,
                    &format!("Kitchen {n}"),
                    "",
                    None,
                )
                .unwrap();
        }
        // One quota-suspended instance: the production suspension state
        // (`suspend_surplus` parks instances as 'quota_suspended'). It still
        // exists in the topology — so it counts as a node — and its presence
        // alone is the "over" verdict for the aggregate row.
        store
            .create_workspace_instance(&format!("{sid}-kds-3"), "kds", &sid, "Kitchen 3", "", None)
            .unwrap();
        store
            .conn
            .execute(
                "UPDATE workspace_instances SET status = 'quota_suspended' WHERE id = ?1",
                rusqlite::params![format!("{sid}-kds-3")],
            )
            .unwrap();
    }
    let rows = per_location_over_quota_rows(
        &[(sid.clone(), "Pro Store".into())],
        &manager,
        &SubscriptionTier::Pro,
    )
    .unwrap();
    let kds: Vec<_> = rows
        .iter()
        .filter(|r| r.dimension == QuotaDimension::KdsScreens)
        .collect();
    assert_eq!(
        kds.len(),
        1,
        "exactly one KDS row for the store, got {kds:?}"
    );
    assert_eq!(kds[0].current, 2);
    assert_eq!(kds[0].limit, Some(2));
    assert_eq!(kds[0].severity, OverQuotaSeverity::At);
    assert_eq!(
        kds[0].resource_id, sid,
        "the row carries its own store as target"
    );
    assert_eq!(kds[0].resource_type, "kds_screen");
    // Zero warehouses is not an "at cap" row even though Pro caps warehouses:
    // an empty category is nothing to remediate, and Free/Plus cap KDS at 0
    // which would otherwise flag every single store.
    assert!(
        !rows.iter().any(|r| r.resource_type == "warehouse"),
        "{rows:?}"
    );
    // Topology-node aggregate (D61 ruling: marker-only dimension riding the
    // existing per-location caps — no tier cap of its own). Limit = SUM of
    // Pro's finite caps: pos 5 + warehouses 3 + kds 2 = 10. Current = the
    // store's non-archived instances (2 active KDS + 1 suspended = 3), and
    // the suspended instance alone forces the Over verdict even though 3 is
    // far below the summed cap.
    let topo: Vec<_> = rows
        .iter()
        .filter(|r| r.resource_type == "topology_node")
        .collect();
    assert_eq!(
        topo.len(),
        1,
        "exactly one topology-node row for the store, got {rows:?}"
    );
    assert_eq!(topo[0].dimension, QuotaDimension::TopologyNodes);
    assert_eq!(topo[0].resource_id, sid);
    assert_eq!(topo[0].current, 3, "suspended nodes still exist");
    assert_eq!(
        topo[0].limit,
        Some(10),
        "sum of Pro's finite per-location caps"
    );
    assert_eq!(
        topo[0].severity,
        OverQuotaSeverity::Over,
        "≥1 quota-suspended instance is the over verdict"
    );
}

#[test]
fn per_location_rows_emit_nothing_for_an_unlimited_cap() {
    // Premium is unlimited on both dims, so no location can be at or over — the
    // reason the dev-mock fixture legitimately returns an empty marker list
    // rather than an invented one.
    let mut rows = Vec::new();
    push_dim_row(
        &mut rows,
        "now",
        "store-1",
        "kds_screen",
        QuotaDimension::KdsScreens,
        None,
        9,
        0,
    );
    push_dim_row(
        &mut rows,
        "now",
        "store-1",
        "warehouse",
        QuotaDimension::Warehouses,
        None,
        9,
        0,
    );
    // The topology aggregate on an all-unlimited tier: no constraint exists
    // (the limit would be the SUM of zero finite caps), so even data that
    // somehow carries quota-suspended instances produces no honest row.
    push_dim_row(
        &mut rows,
        "now",
        "store-1",
        "topology_node",
        QuotaDimension::TopologyNodes,
        None,
        9,
        2,
    );
    assert!(rows.is_empty(), "an unlimited cap must never produce a row");
}
