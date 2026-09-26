/*
last audited 26-09-26 by DSH (SEC-1 CLOSED)
crate: kasirmu-security | status: SAFE | lint: N/A (platform-gated, source-reviewed on Windows host)
findings: SEC-1 CLOSED. Not-found detection no longer searches the debug string; both sites compare the numeric code via `crate::keychain_status::status_means_item_not_found`, which is defined in a NON-platform-gated module precisely because this file cannot be compiled or tested off macOS. The old predicate contained two independent defects, both measured this pass: `e.code()` was already in hand and was being discarded, and `"-128"` is a prefix of every code in the `-128xx` range, so a genuine failure such as `-12800` was reported as an absent item — a storage error silently downgraded to `Ok(None)` in `get_secret`, and to `Ok(false)` ("already gone") in `delete_secret`. The old comment also recorded `errSecUnimplemented = -128`; `security-framework-sys` defines it as `-4`, and `-128` is not an errSec not-found code at all.
next: none for SEC-1 | perf: N/A
*/
//! macOS Keychain implementation of [`Keyring`].
//!
//! Wraps the Security framework (`Security.framework`) to store
//! secrets in the user's default keychain.

use crate::Keyring;
use crate::error::SecurityError;
use security_framework::passwords::{
    delete_generic_password, get_generic_password, set_generic_password,
};

use crate::keychain_status::status_means_item_not_found;

/// macOS Keychain keyring.
///
/// Stores secrets in the user's default login keychain using the
/// Security framework's generic password API with service `OZ-POS`
/// and account name `{name}`.
pub struct MacOsKeychain;

impl MacOsKeychain {
    /// Create a new macOS Keychain instance.
    pub fn new() -> Result<Self, SecurityError> {
        Ok(Self)
    }
}

impl Keyring for MacOsKeychain {
    fn get_secret(&self, name: &str) -> Result<Option<String>, SecurityError> {
        match get_generic_password("OZ-POS", name) {
            Ok(bytes) => {
                let s = String::from_utf8(bytes).map_err(|e| {
                    SecurityError::KeyUnavailable(format!("keychain password not valid UTF-8: {e}"))
                })?;
                Ok(Some(s))
            }
            Err(e) if status_means_item_not_found(e.code()) => Ok(None),
            Err(e) => Err(SecurityError::KeyUnavailable(format!(
                "get_generic_password failed: {e}"
            ))),
        }
    }

    fn set_secret(&self, name: &str, value: &str) -> Result<(), SecurityError> {
        set_generic_password("OZ-POS", name, value.as_bytes())
            .map_err(|e| SecurityError::KeyUnavailable(format!("set_generic_password failed: {e}")))
    }

    fn delete_secret(&self, name: &str) -> Result<bool, SecurityError> {
        match delete_generic_password("OZ-POS", name) {
            Ok(()) => Ok(true),
            Err(e) if status_means_item_not_found(e.code()) => Ok(false),
            Err(e) => Err(SecurityError::KeyUnavailable(format!(
                "delete_generic_password failed: {e}"
            ))),
        }
    }

    // `rotate_key` and `key_created_at` use the default implementations
    // from the `Keyring` trait.
}

#[cfg(test)]
#[path = "macos_tests.rs"]
mod tests;
