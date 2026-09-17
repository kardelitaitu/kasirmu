/*
last audited 25-07-26 by RSA-Agent
crate: oz-security | status: SAFE | lint: CLEAN (cfg(test)-only)
findings: RAII CredentialGuard + poll-based set_and_verify sound; unique names prevent nextest cross-test collisions
next: none | perf: N/A
*/
//! Shared helpers for tests that touch the OS credential stores.
//!
//! These helpers are only compiled when running tests.

use std::sync::atomic::{AtomicUsize, Ordering};

use crate::Keyring;

static COUNTER: AtomicUsize = AtomicUsize::new(0);

/// Generate a unique test credential name.
///
/// Combines the given prefix, the current process id, and an atomic
/// counter so parallel nextest threads never collide on the same
/// keyring item.
pub fn unique_test_name(prefix: &str) -> String {
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{}-{n}", std::process::id())
}

/// Set a credential and poll until the value is observed.
///
/// Some OS credential stores (Windows Credential Manager, macOS
/// Keychain, libsecret) can be asynchronous about writes. This helper
/// retries the write/poll cycle up to 50 times, which is more robust
/// than a fixed sleep.
pub fn set_and_verify<K: Keyring>(keyring: &K, name: &str, value: &str) {
    let mut last: Result<Option<String>, crate::error::SecurityError> = Ok(None);
    for attempt in 1..=50 {
        if let Err(e) = keyring.set_secret(name, value) {
            panic!("set_secret failed for '{name}' on attempt {attempt}: {e}");
        }
        last = keyring.get_secret(name);
        if matches!(&last, Ok(Some(v)) if v == value) {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    panic!("failed to set credential '{name}'; expected '{value}', last observed: {last:?}");
}

/// RAII guard that deletes the named credential when it goes out of
/// scope.
///
/// This ensures cleanup even if a test panics mid-way. The guard is
/// generic over any [`Keyring`] implementation, so it can be shared by
/// the Windows, macOS, and Linux tests.
pub struct CredentialGuard<'a, K: Keyring> {
    name: String,
    keyring: &'a K,
}

impl<'a, K: Keyring> CredentialGuard<'a, K> {
    /// Create a new guard that will delete `name` via `keyring` on drop.
    pub fn new(name: String, keyring: &'a K) -> Self {
        Self { name, keyring }
    }
}

impl<'a, K: Keyring> Drop for CredentialGuard<'a, K> {
    fn drop(&mut self) {
        let _ = self.keyring.delete_secret(&self.name);
    }
}

impl<'a, K: Keyring> std::fmt::Debug for CredentialGuard<'a, K> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CredentialGuard")
            .field("name", &self.name)
            .finish()
    }
}
