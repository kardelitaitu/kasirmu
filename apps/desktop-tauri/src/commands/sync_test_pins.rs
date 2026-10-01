//! Source-level pins for the desktop sync commands.
//!
//! These read `sync.rs` itself rather than exercising a Tauri runtime, which
//! is how the sibling command modules pin contract-shaped properties. They
//! guard two COR-31/contract regressions that a future edit could reintroduce
//! silently. The runtime-bound sync TESTS live in the bridge
//! (`crates/kasirmu-bridge/src/sync_tests.rs`) since commit 9b14d9d0b moved the
//! `sync_tests.rs` sibling out of this shell.

/// COR-31: both conflict commands must build their HTTP client through the
/// bounded helper. A bare `reqwest::Client::new()` has no timeout, so a hung
/// conflict list/resolve pins the command forever and the operator's spinner
/// never clears.
#[test]
fn sync_conflict_commands_use_a_bounded_client() {
    let src = include_str!("sync.rs");
    assert!(
        src.contains("fn bounded_conflict_client()"),
        "the conflict commands must build their client through the bounded helper",
    );
    assert!(
        src.contains(".connect_timeout(") && src.contains(".timeout("),
        "the conflict client must bound both the connect phase and the total request",
    );
    // A bare `Client::new()` used directly as the request builder is what must
    // not come back. The bounded helper keeps its own `Client::new()` FALLBACK
    // for the unreachable builder failure, so match the request-builder shapes.
    assert!(
        !src.contains("reqwest::Client::new().get(")
            && !src.contains("reqwest::Client::new()\n        .post("),
        "a bare Client::new() request builder has no timeout; the conflict commands must not reintroduce it",
    );
    assert!(
        src.matches("bounded_conflict_client()").count() >= 3,
        "the helper plus its two call sites",
    );
}

/// The Wave-F adapters name a test file that MOVED OUT OF THIS SHELL.
///
/// Commit 9b14d9d0b relocated `sync_tests.rs` from this commands directory to
/// `crates/kasirmu-bridge/src/`. The adapters were kept (their `AppError`
/// return is the Wave-F extraction contract) but the `#[allow(dead_code)]`
/// comments kept pointing at the deleted sibling. Pin the corrected pointer so
/// the reference does not drift back to a path that does not exist.
#[test]
fn wave_f_adapters_point_at_the_real_test_file() {
    let src = include_str!("sync.rs");
    assert!(
        src.contains("crates/kasirmu-bridge/src/sync_tests.rs"),
        "the retained adapters must name the bridge test file their tests moved to",
    );
    assert!(
        !src.contains("sibling sync_tests.rs"),
        "the deleted sibling must not be named again",
    );
    // The sibling really is gone from this shell; if it comes back, this pin
    // should be revisited rather than silently satisfied.
    assert!(
        !std::path::Path::new(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/src/commands/sync_tests.rs"
        ))
        .exists(),
        "if a local sync_tests.rs returns, update this pin to point at it",
    );
}
