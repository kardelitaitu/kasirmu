/*
last audited 25-07-26 by RSA-Agent (platform-startup slice B: console verified)
crate: platform-startup | status: SAFE | lint: CLEAN
findings: clean console bootstrap helper
next: none | perf: N/A
*/
//! tokio-console integration.
//!
//! Enable with `RUSTFLAGS="--cfg tokio_unstable"` and the `console`
//! feature flag to visualise async task graphs, resource utilisation,
//! and polling durations in the `tokio-console` dashboard.

/// Initialise the tokio-console subscriber.
///
/// Should be called at the very start of `main()`, before any other
/// tracing setup, so that console instrumentation captures all tasks.
///
/// # Panics
///
/// Panics if called more than once (the underlying subscriber
/// registration is a `OnceCell`).
#[cfg(all(feature = "console", tokio_unstable))]
pub fn init_console_subscriber() {
    console_subscriber::init();
}

/// No-op unless the `console` feature AND `tokio_unstable` are both enabled
/// (console-subscriber panics without the cfg, so `--all-features` without
/// RUSTFLAGS must not crash startup).
#[cfg(not(all(feature = "console", tokio_unstable)))]
pub fn init_console_subscriber() {
    tracing::debug!(
        "tokio-console disabled (compile with `console` feature + RUSTFLAGS=\"--cfg tokio_unstable\")"
    );
}

#[cfg(test)]
#[path = "console_tests.rs"]
mod tests;
