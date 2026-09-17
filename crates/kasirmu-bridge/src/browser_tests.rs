//! Relocated browser-command tests (Wave-F test relocation: moved out of
//! `apps/desktop-tauri/src/commands/browser_tests.rs`).
//!
//! Mounted at the foot of `browser.rs` with `#[cfg(test)] #[path]`, so
//! `use super::*` resolves the percent-encoder `urlencoding` (defined in
//! this module) exactly as the desktop re-export did. Pure-encoder cases:
//! no context, no harness, assertions unchanged.

use super::*;

#[test]
fn urlencoding_encodes_query() {
    assert_eq!(urlencoding("Coca Cola"), "Coca+Cola");
    assert_eq!(urlencoding("Indomie&Co"), "Indomie%26Co");
    assert_eq!(urlencoding("Bakso 100%"), "Bakso+100%25");
    assert_eq!(urlencoding("日本語"), "%E6%97%A5%E6%9C%AC%E8%AA%9E");
}

#[test]
fn urlencoding_keeps_unreserved_chars() {
    assert_eq!(urlencoding("a-z_A.Z~0"), "a-z_A.Z~0");
}
