//! Relocated email-command tests (Wave-F test relocation: moved out of
//! `apps/desktop-client/src/commands/email_tests.rs`).
//!
//! Mounted at the foot of `email.rs` with `#[cfg(test)] #[path]`, so
//! `use super::*` resolves the bridge email fns exactly as the desktop
//! sibling module did. The desktop `tauri::test` mock app maps onto the
//! headless `TestBridge`; every assertion is unchanged.

use super::*;
use crate::testing::TestBridge;

// ── get_report_schedule ────────────────────────────────────────────

#[tokio::test]
async fn get_report_schedule_does_not_panic() {
    let tb = TestBridge::new();
    // The function should either return a default or an error — never panic.
    let _ = get_report_schedule(&tb.ctx()).await;
}

// ── send_test_report ──────────────────────────────────────────────

#[tokio::test]
async fn send_test_report_rejects_invalid_token() {
    let tb = TestBridge::new();
    let result = send_test_report(&tb.ctx(), "bogus-token").await;
    // Should fail because the session token is invalid.
    assert!(result.is_err(), "should fail with invalid session token");
}
