/*
last audited 25-07-26 by RSA-Agent (modules-settings slice A: repository verified)
crate: modules-settings | status: SAFE | lint: CLEAN
findings: MSL-5 — SettingsRepository.set writes the settings table directly WITHOUT the DB-08 delta ledger (no versioned delta row) and without platform-core typed.rs encrypted-at-rest handling. STATUS AS MEASURED 12-09-26: DORMANT, DOCUMENTED, PINNED — zero production callers (tree-wide untruncated git grep for SettingsRepository / SettingsService / modules_settings:: plus alias and re-export forms; the only non-test caller of this fn is SettingsService::set, which is itself a door and not a consumer). The hazard is now stated on the function and pinned by known_hazard_set_writes_a_deny_listed_credential_in_cleartext.
DECISION DECLINED, recorded so it stays visible: no credential refusal was added here. platform-core is not a dependency of this crate (cargo metadata --no-deps: 9 normal deps, none named platform-core; oz-core is dev-only and therefore invisible to src/), and a dependency must not be added to make a guard fit. An in-crate guard would also have to re-transcribe SECRET_KEY_DENY_LIST, creating the second source of truth that keys.rs:206-213 and raw.rs:352-354 exist to warn against. Narrowing visibility was declined too: this mirror is meant to become the runtime settings path, and a pub(crate) writer with no non-test caller trips dead_code under CI's RUSTFLAGS=-D warnings.
next: when this mirror is wired into the runtime, route writes through platform_core::settings::Settings::set_tracked and flip the known_hazard pin into a refusal assertion | perf: N/A
*/
//! Settings Repository — key-value database persistence layer.

use crate::error::SettingsError;
use rusqlite::{Connection, params};

/// Database access repository for key-value settings.
pub struct SettingsRepository<'a> {
    conn: &'a Connection,
}

impl<'a> SettingsRepository<'a> {
    /// Create a new `SettingsRepository`.
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    /// Retrieve setting value by key.
    pub fn get(&self, key: &str) -> Result<Option<String>, SettingsError> {
        let mut stmt = self
            .conn
            .prepare("SELECT value FROM settings WHERE key = ?1")?;
        let mut rows = stmt.query(params![key])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    /// Insert or update a setting value by key.
    ///
    /// # Known hazard — this write path is UNGUARDED
    ///
    /// The risk in one line: a caller of this function stores a secret in
    /// cleartext through a door every credential guard in the tree already
    /// assumes is closed, because those guards key on the settings funnel and
    /// not on this repository.
    ///
    /// Nothing is asked before the UPSERT runs:
    ///
    /// - **no credential refusal** — a key on platform-core's
    ///   `SECRET_KEY_DENY_LIST` (`platform/core/src/settings/keys.rs:265`) is
    ///   written exactly as `store.name` would be;
    /// - **no permission check** — `settings:edit`, the permission this
    ///   module's own `manifest.json` declares, is never consulted here;
    /// - **no ingest policy** — `IngestPolicy` is never consulted, so nothing
    ///   separates a trusted-local write from one that must not egress;
    /// - **no `terminal_id`**, so nothing reaches the DB-08 delta ledger
    ///   (`setting_updated`) and the write stays invisible to version tracking.
    ///
    /// The policy-aware funnel is
    /// `platform_core::settings::Settings::set_tracked`, which asks
    /// `cleartext_credential_refusal` before it writes and records the delta row
    /// inside the caller's transaction. It is named here and NOT called: this
    /// crate does not depend on `platform-core`, and adding that dependency to
    /// fit a guard was declined — see the MSL-5 record in this file's audit
    /// header.
    ///
    /// # State as measured, so the next reader need not guess
    ///
    /// As of this commit this door has ZERO production callers. Verified
    /// tree-wide, untruncated, by `git grep -n "SettingsRepository" -- .`,
    /// `git grep -n "SettingsService" -- .` and
    /// `git grep -n "modules_settings::" -- .` (3 hits — this crate, its
    /// README, and `platform/startup/src/lib.rs:97`, which registers
    /// `SettingsModule` and touches no setter), plus a search for alias and
    /// re-export forms (`as SettingsService`, `modules_settings::service`) that
    /// returned nothing. Every remaining call site is a unit test in this
    /// crate, so the hazard is **latent, not live**.
    ///
    /// That status is pinned rather than asserted in prose:
    /// `known_hazard_set_writes_a_deny_listed_credential_in_cleartext` in
    /// `repository_tests.rs` walks the real deny list through the existing
    /// `oz-core` dev-dependency and asserts today's truth — that a deny-listed
    /// key IS written here, in cleartext, unchanged. If a guard ever lands,
    /// that pin goes red and this comment must be updated with it.
    pub fn set(&self, key: &str, value: &str) -> Result<(), SettingsError> {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        self.conn.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3",
            params![key, value, now],
        )?;
        Ok(())
    }
}

#[cfg(test)]
#[path = "repository_tests.rs"]
mod tests;
