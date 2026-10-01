//! Unit tests for `console`.
//!
//! Moved out of `console.rs` to satisfy the AGENTS.md section 2 rule that unit
//! tests live in a sibling `*_tests.rs` file rather than inside a production
//! `.rs` file. Wired from `console.rs` with:
//!   `#[cfg(test)] #[path = "console_tests.rs"] mod tests;`

use super::*;

#[test]
fn init_console_subscriber_does_not_panic() {
    // The function must not panic — it's called unconditionally at startup.
    // In tests the console feature is disabled, so this exercises the no-op path.
    init_console_subscriber();
}

#[test]
fn init_console_subscriber_is_callable_multiple_times() {
    // The no-op variant must be idempotent — tracing::debug! is safe to call
    // repeatedly.
    init_console_subscriber();
    init_console_subscriber();
    init_console_subscriber();
}
