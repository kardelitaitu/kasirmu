//! Unit tests for `testing`.
//!
//! Moved out of `testing.rs` to satisfy the AGENTS.md section 2 rule that unit
//! tests live in a sibling `*_tests.rs` file rather than inside a production
//! `.rs` file. Wired from `testing.rs` with:
//!   `#[cfg(test)] #[path = "testing_tests.rs"] mod tests;`

use super::*;

use crate::error::BridgeError;

/// The harness constructs a real `BridgeCtx` headless, and the context's
/// session path works: an empty session map rejects an unknown token with
/// `InvalidSession` (sync — no tokio runtime needed).
#[test]
fn harness_constructs_headless_bridge_ctx() {
    let bridge = TestBridge::new();
    let ctx = bridge.ctx();
    assert!(matches!(
        ctx.resolve_session("no-such-token"),
        Err(BridgeError::InvalidSession)
    ));
}

/// `temp_conn` returns a connection with every migration applied
/// (one `schema_migrations` row per entry in `migrations::ALL`).
#[test]
fn temp_conn_is_fully_migrated() {
    let conn = temp_conn();
    let applied: i64 = conn
        .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
            row.get(0)
        })
        .expect("schema_migrations table readable");
    assert_eq!(applied, migrations::ALL.len() as i64);
}

/// The pilot for the whole fixture programme: the helper's answer is derived
/// by RUNNING the load path rather than by reading `cfg!`, so it cannot drift
/// from the truth it claims — and since the 19-09-26 owner ruling that truth is
/// "the schema-seeded Free row loads in EVERY profile". This test pins it, and
/// is deliberately UNGATED: an assertion that only ran in debug is how the
/// release profile shipped unable to reach a session in the first place.
///
/// # Its blind spot, in writing
///
/// The oracle here is the helper itself, so this tripwire catches only a load
/// path that stops honouring the sentinel on a FREE-tier row. It cannot catch
/// the RULE moving, and it no longer pretends to: the profile-dependent
/// question moved to [`seeded_row_reaches_a_paid_tier`], whose oracle is
/// `cfg!(debug_assertions)` — the same predicate the product forks on
/// (`license_verification.rs:402`, `license.rs:687`/`:698`). That is the test
/// that goes red if someone widens the honouring rule past
/// `tier_key() == "free"`. The smallest change that would do it SILENTLY IN
/// BOTH profiles is one line in the root manifest:
/// `[profile.release] debug-assertions = true` (`Cargo.toml:199-204` does not
/// set it today), which compiles the sentinel arm into the SHIPPED binary and
/// lets it accept `BOOTSTRAP_FREE` for ANY payload.
///
/// CI covers the release side only late: `dev-ci.yml`'s `release-bridge-test`
/// job (`cargo nextest run -p kasirmu-bridge --release`) is gated
/// `github.event_name == 'push'`, so a pull-request build skips it, and no
/// `--release` test invocation exists in `scripts/check.sh`,
/// `scripts/release.sh` or `scripts/run-pre-push.py`. The release-leg
/// assertions that make this vocabulary honest therefore run automatically
/// only after the push. A lane that reads a green PR build as proof the
/// release arms still hold is reading the wrong box: this file's own blind
/// spot, stated so no future reader has to rediscover it.
#[test]
fn seeded_row_loads_in_every_profile() {
    assert!(
        seeded_row_loads(),
        "the schema-seeded Free row must load in release as well as debug"
    );
}

/// The tripwire, moved onto the question that is STILL profile-dependent.
///
/// A rewritten paid tier rides the sentinel in debug (the any-payload
/// short-circuit) and must not ride it in release, or the sentinel becomes
/// a signature that mints entitlements. This is what
/// `seeded_row_loads_agrees_with_the_profile` used to carry: that name was
/// the tripwire for "someone made release accept the sentinel", and it
/// fired exactly as its doc predicted.
#[test]
fn seeded_row_reaches_a_paid_tier_agrees_with_the_profile() {
    assert_eq!(
        seeded_row_reaches_a_paid_tier(),
        cfg!(debug_assertions),
        "the helper must report what the load path did, not what cfg! claims"
    );
}

/// The fail-closed consts name the product's own projection, so they are
/// pinned to the product's own accessors rather than to remembered strings:
/// a state or tier rename is one red test here, not 73 red fixtures.
#[test]
fn fail_closed_consts_match_the_products_own_accessors() {
    assert_eq!(
        FAIL_CLOSED_STATE,
        SubscriptionLifecycleState::Unavailable.as_str()
    );
    assert_eq!(FAIL_CLOSED_TIER, SubscriptionTier::Free.tier_key());
    // `const`, not `assert!`: a runtime assertion on a const folds to
    // `assert!(true)` and pins nothing (clippy::assertions_on_constants),
    // whereas this form fails the BUILD if the const is ever flipped.
    const _: () = assert!(!FAIL_CLOSED_GATES_LOCKED, "a locked gate reads false");
}
