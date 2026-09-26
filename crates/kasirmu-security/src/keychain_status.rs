//! Keychain status-code classification, shared by every platform backend.
//!
//! A credential store reports "there is no entry" as a status code rather than
//! as a `None`. Getting that comparison wrong is silent: a real failure read as
//! "absent" becomes an `Ok(None)` at a call site that then provisions a fresh
//! secret over the top of one that exists, or reports a key as unset while it
//! is present but unreadable.
//!
//! This module is deliberately **not** behind `#[cfg(target_os = ...)]`. The
//! macOS backend it serves is compiled only on macOS, so the decision function
//! was previously untestable on any other host — which is how SEC-1 shipped.
//! Keeping the predicate here means every CI host and every developer machine
//! exercises it.
//!
//! The constants are the Security-framework `errSec*` status codes, reproduced
//! from `security-framework-sys::base` (the crate the macOS backend already
//! depends on). They are stable published ABI values and are duplicated here
//! only because that dependency is macOS-gated.

/// `errSecItemNotFound` (`security-framework-sys::base::errSecItemNotFound`).
pub const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;

/// `errSecSuccess`.
pub const ERR_SEC_SUCCESS: i32 = 0;

/// Decide whether a Security-framework status code means "there is no such
/// item" — an expected outcome that callers render as absence — rather than a
/// genuine failure that must surface.
///
/// SEC-1: this decision used to be made by searching the **debug string** of
/// the error for the substrings `"-25300"` and `"-128"`. Two things were wrong
/// with that. The numeric code was already in hand and was being discarded.
/// And `"-128"` is a prefix of every code in the `-128xx` range, so a genuine
/// failure such as `-12800` contained the needle and was reported as "item not
/// found" — a storage error silently downgraded to `Ok(None)`.
///
/// `-128` is moreover not an errSec "not found" code at all:
/// `security-framework-sys` defines `errSecUnimplemented` as `-4`. Only the
/// exact `errSecItemNotFound` code means absence. The Windows backend has
/// always compared its constant exactly (`err == ERROR_NOT_FOUND`); this
/// matches that discipline.
#[must_use]
pub const fn status_means_item_not_found(code: i32) -> bool {
    code == ERR_SEC_ITEM_NOT_FOUND
}

#[cfg(test)]
#[path = "keychain_status_tests.rs"]
mod tests;
