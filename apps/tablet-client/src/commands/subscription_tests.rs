//! Tests for the tablet subscription commands (capabilities + feature-availability verdicts).
//!
//! Mirror of the desktop subscription_tests.rs slice that gates the shared
//! wire contract: an unknown feature key must fail closed (AppError::Invalid)
//! and a known key's verdict must echo that key in feature.

use super::*;
use rusqlite::Connection;

use oz_core::migrations;

/// A fresh, fully-migrated in-memory identity database.
fn fresh_db() -> Connection {
    migrations::fresh_db()
}

/// An owner user: role-owner's '*' grant holds every gate permission,
/// so the role axis never fires and the other axes stand alone.
fn verdict_with_owner(conn: &Connection, feature: &str) -> FeatureVerdict {
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
fn verdict_rejects_unknown_keys_fail_closed() {
    let conn = fresh_db();
    // An unrecognized key must never resolve to available.
    assert!(matches!(
        load_feature_verdict(&conn, "nobody", "analytics", "default", "retail-pos"),
        Err(AppError::Invalid(_))
    ));
    assert!(matches!(
        load_feature_verdict(&conn, "nobody", "max_stores", "default", "retail-pos"),
        Err(AppError::Invalid(_))
    ));
}

/// The tablet verdict resolves to the same fail-closed Free + `unavailable`
/// the tablet capabilities command reports for the same empty subscription
/// row, on every key.
///
/// Why this is pinned rather than assumed: the tablet's `get_subscription_
/// capabilities` applies no debug Free→Premium upgrade, while desktop's does.
/// An earlier revision of this command mirrored *desktop's* upgrade into the
/// tablet verdict, which would have a debug tablet report `premium` beside a
/// caps payload saying `free` — a verdict claiming a feature is available on a
/// register whose tier gates are locked, contradicting the one payload the
/// gates actually read.
///
/// This fixture does reach the branch. `migrations::fresh_db()` seeds a
/// validly-signed `active` Free subscription, which is precisely the input
/// the desktop upgrade promotes to Premium. So in a `cfg(debug_assertions)`
/// test build the removed branch would have reported `premium` here and the
/// tier assertion below fails — a regression test that bites, not a
/// decorative one.
#[test]
fn verdict_resolves_fail_closed_like_the_tablet_caps_command() {
    let conn = fresh_db();
    for key in [
        "supports_qris",
        "supports_analytics",
        "supports_loyalty",
        "supports_daily_dashboard",
        "supports_cloud_sync",
        "sales_history_days",
        "locations",
        "staff_users",
        "pos_instances",
        "warehouses",
    ] {
        let v = verdict_with_owner(&conn, key);
        assert_eq!(v.detail.tier, "free", "{key}: tier must not be upgraded");
        assert_eq!(
            v.detail.state, "active",
            "{key}: seeded row is signed and active"
        );
    }
}

#[test]
fn verdict_echoes_feature_key_in_verdict() {
    let conn = fresh_db();
    let v = verdict_with_owner(&conn, "supports_analytics");
    assert_eq!(v.feature, "supports_analytics");

    let v = verdict_with_owner(&conn, "locations");
    assert_eq!(v.feature, "locations");

    let v = verdict_with_owner(&conn, "warehouses");
    assert_eq!(v.feature, "warehouses");
}

// ── Scope axis (ADR #47 v1 ruling: current-location) ─────────────────

/// A scoped, location-bound manager: assignment covers `loc-scoped` for
/// `retail-pos` workspaces only, and that location exists with its entity.
fn seed_scoped_manager(conn: &Connection) {
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
            VALUES ('user-scoped', 'retail-pos');
         INSERT INTO legal_entities (id, tenant_id, name)
            VALUES ('ent-1', 'default', 'Entity One');
         INSERT INTO locations (id, name, legal_entity_id)
            VALUES ('loc-scoped', 'Scoped Location', 'ent-1');"
    )
    .unwrap();
}

/// The tablet verdict must agree with the desktop twin on the same
/// assignment: the covered location clears, a foreign location denies
/// with reason `scope`, and a legacy user without an assignment row
/// keeps ruling 5's not-scope-restricted semantics (axis silent).
/// Premium is seeded because the tablet applies no debug tier upgrade —
/// on the seeded Free row the tier axis would outrank scope and the
/// test would silently verify the wrong denial.
#[test]
fn verdict_scope_mirrors_the_desktop_verdict_on_the_same_assignment() {
    let conn = fresh_db();
    conn.execute(
        "UPDATE tenant_subscription SET tier_key = 'premium' WHERE tenant_id = 'default'",
        [],
    )
    .unwrap();
    seed_scoped_manager(&conn);

    // Covered location + covered workspace type: available, axis true.
    let v = load_feature_verdict(
        &conn,
        "user-scoped",
        "supports_loyalty",
        "loc-scoped",
        "retail-pos",
    )
    .unwrap();
    assert!(v.available, "in-scope session must clear on premium");
    assert_eq!(v.detail.scope_granted, Some(true));

    // Foreign location: scope denies, matching desktop's reason.
    let v = load_feature_verdict(
        &conn,
        "user-scoped",
        "supports_loyalty",
        "default",
        "retail-pos",
    )
    .unwrap();
    assert!(!v.available, "out-of-scope session location must deny");
    assert_eq!(v.reason_code(), Some("scope"));
    assert_eq!(v.detail.scope_granted, Some(false));

    // Legacy user (no assignment row): the axis stays silent (ruling 5).
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-owner', 'Owner', '', '[\"*\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
            VALUES ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');"
    )
    .unwrap();
    let v = load_feature_verdict(
        &conn,
        "user-owner",
        "supports_loyalty",
        "default",
        "retail-pos",
    )
    .unwrap();
    assert_eq!(
        v.detail.scope_granted, None,
        "no assignment row, not scope-restricted"
    );
}

/// The tablet over-quota report mirrors desktop: it assesses against the
/// effective tier the caps command reports. On the seeded Free row the
/// seeded primary location sits at-cap-not-over — the §J "compliant but
/// blocks creation" distinction the remediation view renders.
#[test]
fn over_quota_report_assesses_the_effective_tier() {
    let conn = fresh_db();
    // The exact production body both over-quota commands wrap (scoped and
    // unscoped twins), minus the session gate the commands share.
    let (report, _tier) = load_over_quota_report(&conn).unwrap();
    assert_eq!(report.tier_key, "free");
    let locations = report
        .usage(oz_core::downgrade::QuotaDimension::Locations)
        .unwrap();
    assert_eq!(locations.limit, Some(1));
    assert!(!locations.is_over_quota());
    assert!(!report.is_over_quota());
}

/// The seam returns the EFFECTIVE tier alongside the report — what the
/// gates enforce — so a caller can render against it without re-deriving
/// entitlements (the desktop twin of this contract, desktop B3). Seeding
/// Premium moves the locations cap from the Free 1 to the Premium 5,
/// proving the report follows the tier, not a hardcoded default.
#[test]
fn over_quota_report_seam_returns_the_effective_tier() {
    let conn = fresh_db();
    seed_tier(&conn, "premium");
    let (report, _tier) = load_over_quota_report(&conn).unwrap();
    assert_eq!(report.tier_key, "premium");
    let locations = report
        .usage(oz_core::downgrade::QuotaDimension::Locations)
        .unwrap();
    assert_eq!(locations.limit, Some(5));
    assert!(!locations.is_over_quota());
}

// ── Phase D1 payload feature-grant precedence (recorded debt: coder-1 ──
// landed the verdicts without pinning the explicit-grant precedence) ──
// Mirrors the desktop slice; the tablet applies no debug Free→Premium
// upgrade, so Free would stay Free here — we use Plus/Premium tiers that
// agree with the desktop twin and keep the assertions symmetric.

/// Set the tenant tier (mirror of the desktop test helper).
fn seed_tier(conn: &Connection, tier_key: &str) {
    conn.execute(
        "UPDATE tenant_subscription SET tier_key = ?1 WHERE tenant_id = 'default'",
        [tier_key],
    )
    .unwrap();
}

/// Seed a signed payload. Debug test builds accept the `BOOTSTRAP_FREE`
/// sentinel signature for ANY payload, so the default seeded row's
/// signature keeps verifying after this update — no license server needed
/// to exercise the Phase D1 `features` block.
fn seed_payload(conn: &Connection, payload: &str) {
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
    assert_eq!(v.reason_code(), Some("server_policy"));
}

#[test]
fn verdict_payload_true_grants_beyond_tier() {
    let conn = fresh_db();
    // Plus does NOT natively support analytics (Pro+ only, no add-on here).
    seed_tier(&conn, "plus");
    // An explicit `true` in the signed `features` block grants the feature
    // beyond what the tier would allow.
    seed_payload(&conn, r#"{"features":{"supports_analytics":true}}"#);
    let v = verdict_with_owner(&conn, "supports_analytics");
    assert!(v.available, "explicit true must grant beyond the tier");
    assert_eq!(v.reason_code(), None);
}

#[test]
fn verdict_absent_features_block_leaves_the_tier_answer() {
    let conn = fresh_db();
    // Premium natively supports analytics: with no `features` block the
    // tier answer stands (available, no denial reason).
    seed_tier(&conn, "premium");
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
}
