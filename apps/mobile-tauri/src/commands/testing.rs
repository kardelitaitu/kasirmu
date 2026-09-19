//! Shared release-profile vocabulary for the tablet command fixtures.
//!
//! ## Why this is a twin and not a shared module
//!
//! The tablet's `*_tests.rs` files are private `#[path]` modules declared
//! inside their parent command file (e.g. `audit.rs:224`), each inheriting
//! `use super::*`. There is no crate-level test-support module to put shared
//! helpers in, and `kasirmu_bridge::testing` — where the bridge's copy of this
//! vocabulary lives — is a **private** `mod testing;`
//! (`crates/kasirmu-bridge/src/lib.rs:158`), so it cannot be reached from here.
//! Promoting it to `kasirmu-core` would add a new public surface to a
//! production crate for the benefit of tests.
//!
//! Two definitions is the lesser of those evils, but it is still a drift risk:
//! **the bridge's copy is the authority for the ruling and for the rationale
//! below. Keep the two in step.**
//!
//! ## The ruling (2026-09-26, `fd925d5c7`)
//!
//! `TenantSubscription::verify_signature` honours the schema-seeded
//! `BOOTSTRAP_FREE` sentinel in **every** profile, but only when the row's
//! `tier_key()` is `free`. A row carrying the sentinel with a PAID tier still
//! falls through to RSA verification and is rejected there — which is the
//! security property, and is what keeps the sentinel from minting
//! entitlements. So the seeded row loads in both profiles, but only ever as
//! Free: **a paid tier is reachable in debug and unreachable in release.**
//!
//! The tablet's fixtures were written before that split existed and carry no
//! fork at all, so every paid-tier case here went red in `--release` — and
//! stayed invisible, because nothing in CI runs a release build (see
//! `crates/kasirmu-bridge/src/testing.rs`: "no `--release` test invocation
//! anywhere in it").
//!
//! ## How to use it
//!
//! ```rust,ignore
//! let result = some_command(..).await;
//! if !seeded_row_reaches_a_paid_tier() {
//!     assert_refused_by_the_seeded_row(&result, "premium");
//!     return;
//! }
//! assert!(result.is_ok(), "{:?}", result.err());
//! ```
//!
//! `assert_refused_by_the_seeded_row` is for **paid stamps only**. A `free`
//! stamp loads in release too, so it is never refused at the signature — the
//! bridge's `seeded_row_verdict_for_tier` is the general form if a free case
//! ever needs one.

use kasirmu_core::migrations;
use kasirmu_core::subscription::{SubscriptionTier, TenantSubscription};

/// Whether the schema-seeded row can reach the caller carrying a **paid** tier
/// in the profile running this test — derived from behaviour, never from `cfg!`.
///
/// `true` in debug, `false` in release. Two routes reach a paid tier and both
/// are covered: a fixture restamping the tier (`UPDATE tenant_subscription SET
/// tier_key = 'premium'`, which is what `seeded_conn` does), and the dev shim's
/// bootstrap Free→Premium upgrade.
///
/// The restamp is in-memory only and nothing is written back, so this stays a
/// read and cannot perturb the fixture that calls it.
#[must_use]
pub fn seeded_row_reaches_a_paid_tier() -> bool {
    let conn = migrations::fresh_db();
    let Ok(Some(mut sub)) = TenantSubscription::load(&conn, "default") else {
        return false;
    };
    sub.tier = SubscriptionTier::Plus;
    sub.verify_signature().is_ok()
}

/// The verdict a feature read projects when NO row verifies: the FAIL-CLOSED
/// PROJECTION, not a licence verdict. Values mirror the bridge's `FAIL_CLOSED_*`
/// consts (`crates/kasirmu-bridge/src/testing.rs:300-316`) rather than being
/// remembered here — a second copy of a string is how the two crates drift.
pub fn assert_verdict_fail_closed(v: &kasirmu_core::availability::FeatureVerdict) {
    assert!(!v.available, "no gate opens for an unverifiable row");
    assert_eq!(
        v.reason_code(),
        Some("lifecycle"),
        "lifecycle is the highest-precedence denial left standing when nothing verified"
    );
    assert_eq!(
        v.detail.tier, "free",
        "the verdict echoes the fail-closed tier"
    );
}

/// Pin the row the fixture is driving — existence, the stamp it wrote, and the
/// row's own verdict — before ANY release-side assertion.
///
/// Pinning is what makes a release arm a claim about the subscription rather
/// than about a fixture that failed to set itself up: both a signature error
/// and a tier denial are also what a *lost seed*, a mis-shaped table or a
/// broken migration produce.
///
/// The pin rebuilds the fixture's row rather than reaching into the command's
/// own connection: `seeded_conn` is deterministic (`fresh_db()` plus one
/// `UPDATE tenant_subscription SET tier_key = ?`), so a freshly built row is
/// the same row. Say so rather than let the reader assume the command's DB was
/// inspected.
fn pin_seeded_row(stamped_tier: &str) {
    assert_ne!(
        stamped_tier, "free",
        "a free-stamped row loads in release too, so it is never refused — these \
         guards are for paid stamps"
    );

    let conn = migrations::fresh_db();
    conn.execute(
        "UPDATE tenant_subscription SET tier_key = ?1 WHERE tenant_id = 'default'",
        [stamped_tier],
    )
    .unwrap();
    let row = TenantSubscription::load(&conn, "default")
        .expect("the tenant_subscription read must succeed")
        .expect("the seeded default row must EXIST");
    assert_eq!(
        row.tier.tier_key(),
        stamped_tier,
        "the fixture's tier stamp must be on the row the gate is reading"
    );
    assert_eq!(
        row.verify_signature().is_ok(),
        seeded_row_reaches_a_paid_tier(),
        "the row this fixture drives must be the row the fork predicate is about"
    );
}

/// Every release arm starts here: `settled` must be a refusal.
fn require_refusal<T>(settled: &Result<T, crate::error::AppError>) -> &crate::error::AppError {
    match settled {
        Err(err) => err,
        Ok(_) => panic!(
            "this leg runs only where a paid tier is unreachable, so the command \
             must have been refused"
        ),
    }
}

/// Assert that `settled` is the **propagated signature error**, for a command
/// whose subscription read is the first gate it meets.
pub fn assert_refused_by_the_seeded_row<T>(
    settled: &Result<T, crate::error::AppError>,
    stamped_tier: &str,
) {
    pin_seeded_row(stamped_tier);
    let err = require_refusal(settled);
    assert!(
        matches!(
            err,
            crate::error::AppError::Core {
                sub_kind: kasirmu_core::CoreErrorKind::InvalidSubscriptionSignature,
                ..
            }
        ),
        "the release refusal must be the propagated signature error, not a looser \
         failure: {err:?}"
    );
}

/// Assert that `settled` is the **tier gate's own denial**, for a command whose
/// tier gate stands *in front of* the subscription read.
///
/// The audit commands are this shape: an unverifiable row makes the entitlements
/// read project the fail-closed Free tier, and `require_audit_tier` then refuses
/// with `PermissionDenied("audit log requires the Premium plan or above (current
/// tier: Free)")` — the signature never surfaces. Asserting
/// `InvalidSubscriptionSignature` here would pin a mechanism the command does
/// not use; asserting only "is an Err" would pass for any cause at all, so the
/// variant is pinned too.
pub fn assert_refused_by_the_tier_gate<T>(
    settled: &Result<T, crate::error::AppError>,
    stamped_tier: &str,
) {
    pin_seeded_row(stamped_tier);
    let err = require_refusal(settled);
    let msg = match err {
        crate::error::AppError::PermissionDenied(msg) => msg,
        other => panic!(
            "a command whose tier gate precedes the subscription read must be refused \
             by that gate, not by the signature: {other:?}"
        ),
    };
    assert!(
        msg.contains("Premium") || msg.contains("plan"),
        "the tier refusal must name the tier it refused: {msg}"
    );
}
