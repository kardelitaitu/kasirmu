/*
last audited 25-07-26 by RSA-Agent (modules-settings slice A: service verified)
crate: modules-settings | status: SAFE | lint: CLEAN
findings: clean thin service facade (see MSL-5 note on repository)
next: none | perf: N/A
*/
//! Settings Service — configuration business logic.

use crate::error::SettingsError;
use crate::repository::SettingsRepository;
use rusqlite::Connection;

/// Service encapsulating settings workflows.
pub struct SettingsService;

impl SettingsService {
    /// Retrieve setting by key.
    pub fn get(conn: &Connection, key: &str) -> Result<Option<String>, SettingsError> {
        let repo = SettingsRepository::new(conn);
        repo.get(key)
    }

    /// Insert or update a setting value by key.
    ///
    /// # Known hazard — this write path is UNGUARDED
    ///
    /// The risk in one line: a caller of this function stores a secret in
    /// cleartext through a door every credential guard in the tree already
    /// assumes is closed, because those guards key on the settings funnel and
    /// not on this service. This is a two-line forward to
    /// `SettingsRepository::set`, so it inherits that function's whole hazard —
    /// no credential refusal, no permission check, no ingest policy, and no
    /// `terminal_id` with which to reach the DB-08 delta ledger. Read that
    /// comment before using this one; it is the measurement, this is the door.
    ///
    /// The policy-aware funnel is
    /// `platform_core::settings::Settings::set_tracked`, which asks
    /// `cleartext_credential_refusal` before writing and records the delta row.
    /// It is named and not called: `platform-core` is not a dependency of this
    /// crate, and adding a dependency to fit a guard was declined — see the
    /// MSL-5 record in `repository.rs`'s audit header.
    ///
    /// # State as measured
    ///
    /// Zero production callers as of this commit: `git grep -n
    /// "SettingsService" -- .` returns this definition, the `pub use` in
    /// `lib.rs`, a doc-comment `use` of the type in `lib.rs`, prose in the
    /// crate README, and three test calls in `service_tests.rs`. No file
    /// outside this crate calls it. Latent, not live — and pinned as latent by
    /// `known_hazard_set_writes_a_deny_listed_credential_in_cleartext` in
    /// `repository_tests.rs`, which flips to a refusal assertion (and requires
    /// this comment to be updated) the day a guard lands.
    pub fn set(conn: &Connection, key: &str, value: &str) -> Result<(), SettingsError> {
        let repo = SettingsRepository::new(conn);
        repo.set(key, value)
    }
}

#[cfg(test)]
#[path = "service_tests.rs"]
mod tests;
