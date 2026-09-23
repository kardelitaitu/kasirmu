//! Headless `#[cfg(test)]` harness for building a `BridgeCtx` in tests.
//!
//! Relocated command tests (mounted with `#[cfg(test)] #[path]` inside the
//! bridge modules) construct a context over a fresh migrated database here
//! instead of booting a Tauri `AppState`. The construction recipe mirrors
//! `AppState::for_test` (`apps/desktop-tauri/src/state.rs`) — every
//! `BridgeCtx` field is constructible without tauri, gtk or a driver
//! registry — and `temp_conn` delegates to the repo's canonical
//! migrated-test-conn helper `kasirmu_core::migrations::fresh_db` (snapshot
//! clone; one `schema_migrations` row per migration).
//!
//! The harness deliberately uses in-memory databases: `tempfile` is not a
//! dependency of this crate and this file's fence forbids manifest edits,
//! so a file-backed temp database cannot be built here. In-memory test
//! connections are the established pattern (`AppState::for_test` and every
//! `kasirmu-core` test module use them).
//!
//! Licence fixtures fork on build profile and this module is the shared
//! vocabulary for that fork: [`seeded_row_loads`] answers what a freshly seeded
//! subscription row ACTUALLY does in the profile running the test (its doc
//! carries the no-seam proof — read it before "fixing" a red licence fixture),
//! and the `FAIL_CLOSED_*` consts name what the product projects when it does
//! not load. Both answers are scoped to the `tenant_subscription` / caps read:
//! they do NOT describe `get_license_status`, which forks a third way — the scope
//! limit and the five causes hidden behind `seeded_row_loads() == false` are in
//! that helper's doc, and so is the release-side blind spot no CI exercises.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use kasirmu_core::cache::Cache;
use kasirmu_core::migrations;
use kasirmu_core::session::SessionContext;
use kasirmu_core::subscription::{
    SubscriptionLifecycleState, SubscriptionTier, TenantSubscription,
};
use kasirmu_hal::DriverRegistry;
use kasirmu_plugin::PluginManager;
use platform_core::StoreDatabaseManager;
use platform_kernel::Kernel;
use rusqlite::Connection;
use tokio::sync::{Mutex, oneshot};

use crate::ctx::{BridgeCtx, EventSink};

/// Session TTL the harness stamps into contexts: the same 24-hour default
/// `AppState::for_test` uses (production reads `session.ttl_seconds`).
pub const TEST_SESSION_TTL_SECONDS: i64 = 86400;

/// Instance counter disambiguating store directories within one test process.
static NEXT_BRIDGE_ID: AtomicU64 = AtomicU64::new(0);

/// Unique directory under the OS temp dir for `store-<id>.sqlite` files.
///
/// One directory per `TestBridge` keeps parallel test instances from
/// colliding on the same `store-<id>.sqlite` file (the manager creates the
/// directory lazily on first `open_store`). Leftover directories are left
/// for the OS temp cleaner, exactly like `AppState::for_test`'s store files.
fn unique_store_dir() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!(
        "kasirmu-bridge-test-{}-{}-{}",
        std::process::id(),
        nanos,
        NEXT_BRIDGE_ID.fetch_add(1, Ordering::Relaxed)
    ))
}

/// Open a fresh, fully migrated connection for a test.
///
/// Delegates to `kasirmu_core::migrations::fresh_db`: an in-memory database with
/// every migration from `kasirmu_core::migrations::ALL` applied (the canonical
/// migrated-test-conn pattern — the first call migrates a snapshot, later
/// calls clone it via the SQLite backup API, so per-test cost is a page
/// copy). Foreign keys are ON; `WAL`/`busy_timeout` PRAGMAs are irrelevant
/// for a single in-memory connection.
///
/// Then seeds the provisioned baseline (ADR #56 §2.6): the `default` location,
/// its legal entity, the five `default-*` workspace instances, and the
/// `BOOTSTRAP_FREE` `tenant_subscription` row. The baseline migration STOPPED
/// shipping those rows — `provision_device` creates them now, in one
/// transaction, because a store with no merchant should have no location and no
/// workspaces. Bridge tests exercise layers BELOW provisioning, so this harness
/// reproduces what provisioning produces. See
/// `kasirmu_core::migrations::seed_provisioned_baseline` for the single source
/// of those rows.
///
/// # Panics
///
/// Panics if the database cannot be created — a harness programming error,
/// matching `fresh_db`'s contract.
#[must_use]
pub fn temp_conn() -> Connection {
    let conn = migrations::fresh_db();
    migrations::seed_provisioned_baseline(&conn);
    conn
}

/// Whether a freshly seeded subscription row actually verifies and loads,
/// derived from behaviour and never from `cfg!` / `debug_assertions` — and
/// since the 19-09-26 owner ruling the answer is `true` in BOTH profiles.
///
/// It runs the product's own two steps over the row `temp_conn()` seeds:
/// `TenantSubscription::load` for tenant `default` (the `BOOTSTRAP_FREE` row
/// `seed_provisioned_baseline` writes, which is what the squashed init
/// migration used to seed at `20260813_init.sql`, "Default tenant subscription
/// (from migration 061)"), then that row's `TenantSubscription::verify_signature`.
/// `true` only if BOTH succeed. The answer is produced BY the load path rather
/// than asserted about it, so it cannot drift from the truth it claims.
///
/// # The no-seam proof — read this before "fixing" a red licence fixture
///
/// **No test in this crate can mint a signature that verifies.**
/// `verify_license_signature` (`crates/kasirmu-core/src/license_verification.rs:387`)
/// takes only `(payload, signature_base64)`: no key parameter, and it reads the
/// key from the build-time `include_str!` of `crates/kasirmu-core/oz-license.key.pub`
/// (`LICENSE_PUBLIC_KEY_PEM`, `:44`) through `load_public_key()` (`:435`) and the
/// RSA verify at `:423-429`. That is the PUBLIC half of a keypair whose PRIVATE half is not
/// in this checkout — `*.key` is git-ignored (`.gitignore:69`) and
/// `crates/kasirmu-core/oz-license.key` is absent from disk — so nothing a test
/// writes can produce the RSA-2048 PKCS1v15/SHA-256 signature the embedded key
/// accepts. Nor is there a seam to inject one: no parameter, no trait, no
/// thread-local, no injected verifier, and all FOUR call sites reach it
/// directly: `subscription.rs:521` (`TenantSubscription::verify_signature`),
/// `license.rs:594` (the stored settings pair), and
/// `license_verification.rs:495` and `:538` — the two server-response
/// verifications on activate and refresh. Four, not two: a lane that greps four
/// callers against a block that names two concludes this proof is STALE and
/// re-opens the very seam the paragraph exists to close.
/// A verification seam would be an owner decision about production code, not a
/// fixture fix, and it is not this file's to make.
///
/// Consequence: a seeded subscription row is exactly ONE of three kinds, and
/// no fourth kind exists.
///
/// - **sentinel on a Free row** — the 14 bytes `BOOTSTRAP_FREE` with
///   `tier_key = 'free'`, which is what `seed_provisioned_baseline` writes for
///   `temp_conn()`.
///   `TenantSubscription::verify_signature` honours the sentinel in BOTH
///   profiles for a free-tier row (`subscription.rs`, owner ruling 19-09-26),
///   so the seeded row LOADS in both. This is the only kind a fixture gets for
///   free, and it is what [`seeded_row_loads`] measures.
/// - **sentinel on a PAID row** — the same 14 bytes with any other
///   `tier_key`. Debug verifies it through the permissive short-circuit at
///   `license_verification.rs:402-405`; release never reaches that arm, falls
///   through to the standard base64 decode at `:409`, and fails on the
///   underscore. Debug loads, release rejects — this is the fork
///   [`seeded_row_reaches_a_paid_tier`] measures.
/// - **invalid** — everything else, including a well-formed base64 blob signed
///   with any other key. Rejects in BOTH profiles.
///
/// So a red on a sentinel-seeded fixture is a profile-DISHONEST FIXTURE: not a
/// broken expectation to delete, and not a product bug. Fix it by forking the
/// fixture on the helper that matches the stamp it writes, or by asserting the
/// fail-closed projection below. Never by blanking, shortening or "resigning" a
/// signature — that turns a loud fail-closed outcome into a silently Free run,
/// and it destroys the pinned counter-example at `auth_tests.rs:413-462` — the
/// forged `UPDATE` is at `:423-427`, but the case is only a proof because of the
/// `expect_err` at `:449` and the match that follows it, so cite the whole case
/// (`:413-462`), never the UPDATE alone. Its forged row must stay `Err` in BOTH
/// profiles precisely because "this signature does not verify" is a result, not
/// a state to be erased.
///
/// Widening that honouring rule past `tier_key() == "free"` — or setting
/// debug-assertions in the release profile — would move a licence bypass into
/// the SHIPPED binary: any tenant could then claim any tier by editing one
/// column. That is an owner decision about production code, and it is the
/// boundary the 19-09-26 ruling drew rather than crossed.
///
/// # Scope limit — this answers about the SUBSCRIPTION READ only
///
/// It does NOT extend to the settings pair `get_license_status` reads. That pair
/// (`license.payload` / `license.signature`, `license.rs:590-591`) is a different
/// seed shape on a different table, and `temp_conn()` seeds NEITHER key:
/// `kasirmu_core::migrations::fresh_db` applies `20260813_init.sql`, which inserts the
/// `tenant_subscription` default row (`:1513`) and no `license.payload` or
/// `license.signature` settings row at all. On a fresh harness connection
/// `get_license_status` therefore takes its "no stored pair" branch.
///
/// Read `seeded_row_loads()` and the `FAIL_CLOSED_*` consts as claims about the
/// `tenant_subscription` / caps read ONLY. A `get_license_status` fixture must NOT
/// fork on them, because that command forks on its own, three ways, and not one
/// of the three projects the fail-closed pair:
///
/// - `license.rs:594-601` — a STORED pair that will not verify yields
///   `InvalidSignature` with `tier: None` (and `payload: None`), in BOTH profiles;
/// - `license.rs:698-708` — no stored pair yields `Missing` with `tier: None` in
///   release, while `license.rs:685-697` yields `is_active: true` / `Valid` /
///   `tier: Some("free")` in DEBUG — opposite projections of the same absent row,
///   neither of them the `Unavailable` + Free pair the consts pin;
/// - `license.rs:659-668` — a third fork: an EXPIRED payload that verified reads
///   `Valid` / `is_active: true` in debug and `Expired` in release.
///
/// Check those ranges before reusing this answer there. Asserting `FAIL_CLOSED_TIER`
/// against `get_license_status` on a fresh connection is wrong-GREEN in debug (the
/// debug arm happens to answer `Some("free")`) and wrong-red in release (`None`) —
/// a fixture that can only ever pass in one profile while claiming to describe both.
///
/// If a verification seam is ever genuinely added to the product, this helper's
/// answer changes on its own — and `seeded_row_loads_agrees_with_the_profile`
/// goes red, which is the point: it is the tripwire, not the truth.
///
/// # What `false` does NOT mean — five causes behind one bool
///
/// `seeded_row_loads() == false` is NOT "the sentinel was rejected".
/// The `let Ok(Some(sub)) = ... else { return false }` above collapses FIVE
/// different causes into the same answer:
///
/// 1. no `default` row in `tenant_subscription` (`Ok(None)` → `false`);
/// 2. `TenantSubscription::load` returning `Err` — a missing or mis-shaped table
///    is indistinguishable from an empty one here (`subscription.rs:438-473`);
/// 3. `load_public_key()` failing before the signature is ever looked at
///    (`license_verification.rs:435` → the RSA verify at `:423-429`);
/// 4. the base64 decode rejecting the 14 sentinel bytes — the ONE cause this
///    fixture vocabulary is actually about (`:398-404`);
/// 5. a genuine RSA mismatch against the embedded key (`:406-418`).
///
/// The product's own fail-closed loaders collapse the same five identically
/// (`Ok(None)`, `Err` and a verification `Err` all yield `Entitlements::fail_closed`,
/// `entitlements.rs:279-300`), so nothing below this helper can tell them apart
/// either — and a lane whose migration lost the seed row would go green asserting
/// "fail closed" for an ABSENT row, in a profile where nothing was ever rejected.
///
/// So this is the contract's RULE, not a warning, and both fixture lanes already
/// obey it (`1760a080d`, `b891f2db7`): **every arm that asserts the fail-closed
/// projection must ALSO assert the row exists** — load it, `expect` the row, check
/// the stamp the fixture wrote — before it projects. Assert the fork and the row
/// together, or the fork proves nothing.
#[must_use]
pub fn seeded_row_loads() -> bool {
    let conn = temp_conn();
    let Ok(Some(sub)) = TenantSubscription::load(&conn, "default") else {
        return false;
    };
    sub.verify_signature().is_ok()
}

/// Whether the schema-seeded row can reach the caller carrying a **paid** tier
/// in the profile running this test — derived from behaviour, never from `cfg!`.
///
/// This is the question the paid fixtures actually ask, and since 19-09-26 it
/// is no longer the same question [`seeded_row_loads`] answers. Honouring the
/// schema-seeded sentinel in release made the seeded row load in BOTH
/// profiles, but only as Free: `TenantSubscription::verify_signature` accepts
/// the sentinel only for a free-tier row, so a row carrying the sentinel with
/// a PAID `tier_key` still falls through to RSA verification and is rejected
/// there. While the sentinel was debug-only the two questions had one and the
/// same answer, which is why a single helper served both — and why every paid
/// fixture that forked on [`seeded_row_loads`] began taking the load-arm in
/// release and asserting Plus/Pro/Premium caps a sentinel row cannot have.
///
/// # Two routes reach a paid tier, and this helper covers both
///
/// The name is deliberately not "rewritten", because only one of the two
/// routes rewrites anything:
///
/// 1. **The fixture restamps the tier** — `seed_tier`, `owner_app("premium")`,
///    `app_for(.., "pro")`, a direct `sub.tier = …`. Nothing verifies any more;
///    the tier rides the sentinel through, and it rides it only in debug.
/// 2. **The dev shim upgrades bootstrap Free** — debug builds promote the
///    seeded Free row to Premium before the quota and audit-retention gates
///    (mirroring `get_subscription_capabilities`). The fixture never touches
///    the tier; it just asks whether the promotion is live.
///
/// Both are the same underlying fact — a row signed with the bootstrap
/// sentinel can carry a paid tier in debug and cannot in release — so both
/// fork on this helper. A "free"-stamped fixture such as
/// `create_location_profile_scoped_end_to_end_owner` is route 2, not a
/// mis-repoint of route 1.
///
/// Keep [`seeded_row_loads`] when the question is about the seeded row ITSELF —
/// that one now answers `true` in both profiles, and its callers self-heal.
///
/// The restamp is on the in-memory struct only, and nothing is written back to
/// the database, so like [`seeded_row_loads`] this stays a read and cannot
/// perturb the fixture that calls it.
///
/// # There is a twin, and this copy is the authority
///
/// `apps/mobile-tauri/src/commands/testing.rs` restates this predicate and the
/// refusal guards built on it. It cannot import them: this module is a private
/// `mod testing;` and the tablet has no test-support crate to share, while
/// promoting them into `kasirmu-core` would add a `test-utils` feature and
/// public API to a production crate for the sake of ~45 lines. So the tablet
/// carries a copy — and **a change to the ruling, to this predicate, or to the
/// guards must be mirrored there**, because nothing in CI compares the two.
#[must_use]
pub fn seeded_row_reaches_a_paid_tier() -> bool {
    let conn = temp_conn();
    let Ok(Some(mut sub)) = TenantSubscription::load(&conn, "default") else {
        return false;
    };
    sub.tier = SubscriptionTier::Plus;
    sub.verify_signature().is_ok()
}

/// What `verify_signature` must answer for the seeded row once it carries
/// `stamped_tier` — the invariant the four `assert_*_row` guards pin.
///
/// The sentinel is honoured exactly when the row's `tier_key()` is `free`, so
/// a row stamped `free` follows [`seeded_row_loads`] (true in both profiles
/// since 19-09-26) and any other stamp follows
/// [`seeded_row_reaches_a_paid_tier`] (debug only). Before the ruling the two
/// curves were the same curve, which is why one call site served both and why
/// every guard began comparing a restamped PAID row against the unstamped
/// answer — `false == true` in release, forty failures, one cause.
///
/// Passing the stamp rather than a bool is the point: the guard then says
/// "this row must behave like the row the fork is about", which stays true if
/// either predicate moves again.
#[must_use]
pub fn seeded_row_verdict_for_tier(stamped_tier: &str) -> bool {
    if stamped_tier == "free" {
        seeded_row_loads()
    } else {
        seeded_row_reaches_a_paid_tier()
    }
}

/// The `state` / `status` a subscription read projects when NO row verifies:
/// the FAIL-CLOSED PROJECTION, not a licence verdict.
///
/// "Unavailable" is a statement about the READ, not about the tenant: it is the
/// only honest answer for data that could not be trusted, and it is deliberately
/// NOT `expired` — a rejected signature yields "unknown", never a date. Mirrors
/// `SubscriptionLifecycleState::Unavailable.as_str()` (pinned by
/// `fail_closed_consts_match_the_products_own_accessors`).
pub const FAIL_CLOSED_STATE: &str = "unavailable";

/// The `tier` a subscription read projects when NO row verifies: the
/// FAIL-CLOSED PROJECTION, not a licence verdict.
///
/// Free is the floor everything degrades to so the quota axes still have an
/// answer — a lock, not a grant, and never to be asserted as "this tenant is on
/// the free plan". Mirrors `SubscriptionTier::Free.tier_key()` (pinned by
/// `fail_closed_consts_match_the_products_own_accessors`).
pub const FAIL_CLOSED_TIER: &str = "free";

/// What every tier-gated `supports_*` flag reads in the FAIL-CLOSED PROJECTION,
/// not a licence verdict: gates locked, because an unverifiable row grants
/// nothing. `Entitlements::fail_closed` pairs the Free tier with the
/// `Unavailable` state and the flags derive from that pair, so a fixture that
/// sees `FAIL_CLOSED_STATE` must see this on every gate as well.
pub const FAIL_CLOSED_GATES_LOCKED: bool = false;

/// The broken-seed leg shared by every fixture that asserts a refusal on a
/// `free`-stamped row.
///
/// A command that propagates the seeded subscription row (`sub.verify_signature()?` -
/// `staff.rs:1080`, `auth.rs:617`, `terminals.rs:432`, `workspaces.rs:232`,
/// `inventory` create-location and the profile-scoped location commands) returns an
/// ERROR when the row it reads does not verify. Since 19-09-26 that is NOT the release
/// profile: `verify_signature` honours the bootstrap sentinel whenever `tier_key()` is
/// `free`, so the seeded Free row verifies in BOTH profiles and a `"free"` caller of
/// this helper is reached only by a genuinely broken seed - causes 4 and 5 above, where
/// the row EXISTS and fails verification. Its callers are therefore seed-integrity
/// fallbacks, not profile forks, and a healthy tree never enters them. A fixture on a
/// PAID stamp wants [`seeded_row_reaches_a_paid_tier`] instead.
///
/// When it does run, the command has no result to project: no DTO, no id, no written
/// row - which is why `FAIL_CLOSED_*` never appears as anything but an
/// `assert_eq!` right-hand side, and why no row-counting fixture may use this helper
/// at all (release writes skip only `loaded: true`, `audit_security.rs:389`).
///
/// Existence is pinned FIRST: `seeded_row_loads() == false` collapses five distinct
/// causes (`:196-209` above - no default row, a load `Err`, a public-key failure, the
/// intended sentinel reject, a genuine RSA mismatch) and only the last two are fixture
/// vocabulary, so a broken migration must never be able to read as a profile
/// difference. Then the tier the caller expects is checked ON THE ROW THE PIN READS
/// (`lock_global()`), which is where the locations trap was found: a re-tier written
/// through `db_manager().open_store(..)` lands in the store db, not here.
///
/// Wave-one extraction note: this is the MAJORITY form of eight file-local copies.
/// Seven take the settled result as `settled` and say "the command must have been
/// refused"; `workspaces_tests.rs` alone names it `listed` and says "the listing",
/// and its row message reads "lists against" where the others say "mutates against",
/// "signs a session against", "writes against" and so on. No copy differed in an
/// assertion - all eight carry the same five, with a byte-identical existence-pin
/// message - so the drift is vocabulary only and wave two must expect to lose those
/// domain words from two assert messages per file, not to change behaviour.
pub async fn assert_refused_by_the_seeded_row<T>(
    tb: &TestBridge,
    settled: Result<T, crate::error::BridgeError>,
    stamped_tier: &str,
) {
    let ctx = tb.ctx();
    let db = ctx.lock_global().await;
    // INVARIANT: the test bridge seeds a valid TenantSubscription row for "default"
    // before any test that calls assert_refused_by_the_seeded_row runs; a missing row
    // means the fixture setup failed, not a live user-facing error path.
    let row = TenantSubscription::load(&db, "default")
        .expect("the tenant_subscription read must succeed")
        // INVARIANT: seeded_row_loads() is the predicate for whether the fixture is
        // healthy; None here means the seed migration or the TestBridge setup panicked
        // earlier — a harness bug, not a condition a production code path can reach.
        .expect("the seeded default row must EXIST: seeded_row_loads() == false is also the answer for a lost seed, and a fixture fork must never be able to read a broken migration as a profile difference");
    assert_eq!(
        row.tier.tier_key(),
        stamped_tier,
        "the tier this fixture inherits must be on the row the release arm reads"
    );
    assert_eq!(
        row.verify_signature().is_ok(),
        seeded_row_verdict_for_tier(stamped_tier),
        "the row this fixture drives must be the row the fork predicate is about"
    );
    drop(db);
    let err = match settled {
        Err(err) => err,
        Ok(_) => panic!(
            "this leg runs only where the seeded row does not verify, so the command must have been refused"
        ),
    };
    assert!(
        matches!(
            err,
            crate::error::BridgeError::Core {
                sub_kind: kasirmu_core::CoreErrorKind::InvalidSubscriptionSignature,
                ..
            }
        ),
        "the refusal must be the propagated signature error, not a looser failure: {err:?}"
    );
}

/// Owns the backing state a borrowed `BridgeCtx` points at.
///
/// The bridge crate holds no global state, so a test needs one owner for the
/// `Arc`s / locks behind the context. `TestBridge` builds headless defaults
/// mirroring `AppState::for_test` (empty session map, 24-hour TTL, no-op
/// cache, empty kernel, unregistered terminal, `media_cache_dir: None`); the
/// `with_*` builders override single fields for a specific test. Call
/// `TestBridge::ctx` to borrow a `BridgeCtx` for the duration of a call —
/// keep the `TestBridge` alive for as long as the context is used.
pub struct TestBridge {
    /// Global identity DB (single connection, tokio Mutex).
    db: Arc<Mutex<Connection>>,
    /// Per-store SQLite file manager (unique temp dir per instance).
    db_manager: StoreDatabaseManager,
    /// Token -> SessionContext map (shared Arc; tests mutate it directly).
    sessions: Arc<RwLock<HashMap<String, SessionContext>>>,
    /// Session TTL seconds.
    session_ttl_seconds: i64,
    /// Cache layer for `Store::with_cache` (no-op unless Redis is reachable).
    cache: Arc<dyn Cache>,
    /// Kernel, for domain-event publishing on the event bus.
    kernel: Mutex<Kernel>,
    /// Current terminal identity (None = unregistered).
    terminal_id: Arc<Mutex<Option<String>>>,
    /// Resolved media root (None in headless tests).
    media_cache_dir: Option<PathBuf>,
    /// HMAC key for picker tickets (empty by default; seed it to exercise the
    /// `picker` paths).
    picker_ticket_secret: Vec<u8>,
    /// Empty HAL registry (Wave D fields are injected, never probed by the
    /// relocated suites).
    registry: Arc<DriverRegistry>,
    /// No plugin manager (headless default, mirroring `AppState`).
    plugins: Arc<Mutex<Option<PluginManager>>>,
    /// Event sink: `None` = silent no-op; see `with_emitter`.
    emitter: Option<Arc<dyn EventSink>>,
    /// Unused scanner-cancel slot (hardware tests inject their own).
    scanner_cancel: Arc<Mutex<Option<oneshot::Sender<()>>>>,
    /// Harness-owned topology apply lock. Tests never run topology Applies
    /// concurrently, so an uncontended unit lock is enough to satisfy the
    /// borrow `BridgeCtx` expects.
    topology_apply_lock: Mutex<()>,
}

impl TestBridge {
    /// Build a bridge with the canonical headless defaults.
    ///
    /// Mirrors `AppState::for_test` field-for-field: in-memory migrated
    /// global DB, per-store manager over a unique temp directory, empty
    /// session map, 24-hour TTL, no-op cache, empty kernel, no terminal.
    ///
    /// # Panics
    ///
    /// Panics if the migrated database cannot be created (see `temp_conn`).
    #[must_use]
    pub fn new() -> Self {
        Self {
            db: Arc::new(Mutex::new(temp_conn())),
            db_manager: Self::provisioned_store_manager(),
            sessions: Arc::new(RwLock::new(HashMap::new())),
            session_ttl_seconds: TEST_SESSION_TTL_SECONDS,
            // "redis://127.0.0.1/" is unreachable in tests: create_cache
            // falls back to the no-op cache (same default as AppState::for_test).
            cache: kasirmu_core::cache::create_cache("redis://127.0.0.1/", 300),
            kernel: Mutex::new(Kernel::new()),
            terminal_id: Arc::new(Mutex::new(None)),
            media_cache_dir: None,
            picker_ticket_secret: Vec::new(),
            registry: Arc::new(DriverRegistry::new()),
            plugins: Arc::new(Mutex::new(None)),
            emitter: None,
            scanner_cancel: Arc::new(Mutex::new(None)),
            topology_apply_lock: Mutex::new(()),
        }
    }

    /// Replace the global identity DB with a caller-provided connection.
    ///
    /// Mirrors `AppState::for_test_with_conn`: lets authorization tests seed
    /// exact rows and keeps them independent of the default in-memory DB.
    #[must_use]
    pub fn with_conn(mut self, conn: Connection) -> Self {
        self.db = Arc::new(Mutex::new(conn));
        self
    }

    /// A per-store manager whose `default` store DB carries the provisioned
    /// baseline.
    ///
    /// ADR #56 §2.6 stopped the baseline migration shipping the `default` location,
    /// its legal entity, the five `default-*` workspace instances and the
    /// BOOTSTRAP_FREE subscription; `provision_device` creates them now. Scoped
    /// commands address a store DB by `"default"`, so a test store must be
    /// provisioned the same way a real one is — otherwise every scoped read
    /// answers NotFound against a migrated-but-empty store.
    ///
    /// The store is opened once here so the seed lands before a test's first
    /// `open_store`; `StoreDatabaseManager` keeps it for the handle's lifetime.
    #[must_use]
    fn provisioned_store_manager() -> StoreDatabaseManager {
        let manager = StoreDatabaseManager::new(unique_store_dir(), migrations::ALL);
        {
            let store_conn = manager
                .open_store("default")
                .expect("opening the default store for baseline seeding");
            let guard = store_conn
                .lock()
                .expect("store db lock for baseline seeding");
            migrations::seed_provisioned_baseline(&guard);
        }
        manager
    }

    /// The provisioned version of a caller-built manager, for tests that construct
    /// their own `StoreDatabaseManager`. Seeds the same `default` store; a no-op
    /// if that store was already seeded.
    ///
    /// # Panics
    ///
    /// Panics if the default store cannot be opened or seeded.
    pub fn seed_store_manager(manager: StoreDatabaseManager) -> StoreDatabaseManager {
        {
            let store_conn = manager
                .open_store("default")
                .expect("opening the default store for baseline seeding");
            let guard = store_conn
                .lock()
                .expect("store db lock for baseline seeding");
            // ON CONFLICT DO NOTHING semantics: the seeder's INSERTs use plain
            // INSERT, so re-seeding an already-populated store would collide.
            // Guard on the location row that provisioning writes first.
            let seeded: bool = guard
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM locations WHERE id = 'default')",
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(false);
            if !seeded {
                migrations::seed_provisioned_baseline(&guard);
            }
        }
        manager
    }

    /// Replace the per-store manager (mirrors `AppState::for_test_with_db_manager`).
    #[must_use]
    pub fn with_db_manager(mut self, db_manager: StoreDatabaseManager) -> Self {
        self.db_manager = db_manager;
        self
    }

    /// Borrow the per-store manager (scoped tests seed store DBs through it).
    #[must_use]
    pub fn db_manager(&self) -> &StoreDatabaseManager {
        &self.db_manager
    }

    /// Point `media_cache_dir` at a real directory (products-images tests).
    #[must_use]
    #[allow(dead_code)] // retained TestBridge builder - harness API, not dead
    pub fn with_media_cache_dir(mut self, dir: impl Into<PathBuf>) -> Self {
        self.media_cache_dir = Some(dir.into());
        self
    }

    /// Seed the picker-ticket HMAC key (picker/auth ticket tests).
    #[must_use]
    pub fn with_picker_ticket_secret(mut self, secret: Vec<u8>) -> Self {
        self.picker_ticket_secret = secret;
        self
    }

    /// Override the session TTL (expiry tests pass `0` or a negative value).
    #[must_use]
    #[allow(dead_code)] // retained TestBridge builder - harness API, not dead
    pub fn with_session_ttl(mut self, seconds: i64) -> Self {
        self.session_ttl_seconds = seconds;
        self
    }

    /// Clone of the session map handle, for inserting sessions before a call
    /// (the same post-construction mutation `AppState.session_store` allows).
    #[must_use]
    /// Read-only access to the headless HAL registry (tests register mock
    /// drivers before handing out a `BridgeCtx`).
    pub fn registry(&self) -> &DriverRegistry {
        &self.registry
    }

    pub fn sessions(&self) -> Arc<RwLock<HashMap<String, SessionContext>>> {
        Arc::clone(&self.sessions)
    }

    /// Seed a user whose role grants EXACTLY the named permission, register a
    /// session for them, and return the token that resolves to it.
    ///
    /// This does not bypass the permission check, it SATISFIES it, and the
    /// difference is the whole point: the grant is a real `roles.permissions` row
    /// read by `Store::require_permission_scoped` through
    /// `BridgeCtx::require_session_permission`, and the role carries only
    /// `permission`, so a command asking for any other permission still denies.
    /// A bypass would make every pin built on this helper test nothing.
    ///
    /// It exists because the scoped-zero leg of the backup event pin
    /// (`backup_ungated_no_session`, data_tests.rs) was a silent pass without it:
    /// a scoped call that fails authorization returns before reaching its
    /// delegate, so it emits nothing whether or not the delegate is correct.
    ///
    /// Idempotent per permission (`INSERT OR REPLACE`), so a test may call it
    /// twice; distinct permissions get distinct role/user/token rows and never
    /// collide. Users are seeded WITHOUT an `assignments` row, i.e. the legacy
    /// shape `require_permission_scoped` treats as not scope-restricted
    /// (ADR #35 D5) — the permission itself is still enforced on this path.
    #[must_use]
    pub async fn token_granting(&self, permission: &str) -> String {
        let slug = permission.replace('.', "-");
        let role_id = format!("role-pin-{slug}");
        let user_id = format!("user-pin-{slug}");
        let token = format!("token-pin-{slug}");
        let stamp = "2026-07-31T00:00:00.000Z";
        {
            let conn = self.db.lock().await;
            conn.execute(
                "INSERT OR REPLACE INTO roles (id, name, description, permissions, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    &role_id,
                    format!("Pin {permission}"),
                    format!("Seeded by TestBridge::token_granting for the single permission {permission}"),
                    format!("[\"{permission}\"]"),
                    stamp,
                    stamp,
                ],
            )
            // SAFETY: `mod testing` is `#[cfg(test)]`-gated at its declaration in
            // `lib.rs`, so this file compiles only into the kasirmu-bridge test binary and into
            // no shipped process. This seed fails only if the column list above stops
            // matching the migrated `roles` schema — a harness programming error, which is
            // the state ADR #33 lets panic: the abort lands in the test that asked for the
            // token, never in a running till.
            .expect("seed the pin role row (columns mirror categories_tests.rs)");
            conn.execute(
                "INSERT OR REPLACE INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) VALUES (?1, ?2, 'hash', ?3, ?4, 1, ?5, ?5)",
                rusqlite::params![
                    &user_id,
                    format!("pin-{slug}"),
                    format!("Pin user for {permission}"),
                    &role_id,
                    stamp,
                ],
            )
            // SAFETY: same `#[cfg(test)]`-only module as the role seed above, and the
            // `users` column list here matches the migrated schema (the `role_id` it stamps
            // is the row seeded immediately above it). A drift is a harness programming
            // error that fails the requesting test; no shipped build contains this call.
            .expect("seed the pin user row");
        }
        // SAFETY: `sessions` is a `std::sync::RwLock` owned by this `TestBridge`, so
        // `write()` fails only on poison, and poisoning this map requires a panic while a
        // guard of the same per-harness map is held. ADR #33's poisoned-lock clause
        // accepts the panic in that case, and this module is `#[cfg(test)]`-only, so it
        // is a failing test's failure signal rather than a till crashing.
        self.sessions.write().unwrap().insert(
            token.clone(),
            SessionContext::new(
                user_id,
                role_id,
                "terminal-pin".into(),
                "store-pin".into(),
                "instance-pin".into(),
                "pos".into(),
                None,
                0,
            ),
        );
        token
    }

    /// Install a UI event sink (Wave D kds/hardware emit-path tests).
    #[must_use]
    #[allow(dead_code)] // retained TestBridge builder - harness API, not dead
    pub fn with_emitter(mut self, sink: Arc<dyn EventSink>) -> Self {
        self.emitter = Some(sink);
        self
    }

    /// Borrow a headless `BridgeCtx` over this bridge's state.
    ///
    /// The context borrows from `&self`, so it must not outlive the
    /// `TestBridge`; borrow it per call like a command shim does.
    #[must_use]
    pub fn ctx(&self) -> BridgeCtx<'_> {
        BridgeCtx {
            db: &self.db,
            db_manager: &self.db_manager,
            sessions: &self.sessions,
            session_ttl_seconds: self.session_ttl_seconds,
            cache: &self.cache,
            kernel: &self.kernel,
            terminal_id: &self.terminal_id,
            media_cache_dir: self.media_cache_dir.clone(),
            picker_ticket_secret: self.picker_ticket_secret.clone(),
            registry: &self.registry,
            plugins: &self.plugins,
            emitter: self.emitter.clone(),
            scanner_cancel: &self.scanner_cancel,
            topology_apply_lock: &self.topology_apply_lock,
        }
    }
}

impl Default for TestBridge {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
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
}
