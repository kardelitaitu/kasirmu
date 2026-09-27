//! Per-terminal feature override store methods.
/*
last audited 25-07-26 by RSA-Agent (kasirmu-core slice B5 part 6)
crate: kasirmu-core | status: SAFE | lint: CLEAN
findings: set_terminal_override UPDATE-then-INSERT without tx (advisory TOCTOU, single-connection safe — upsert ON CONFLICT would be simpler)
next: none | perf: N/A
*/
//!
//! Provides CRUD operations for the `terminal_feature_overrides` table.
//! Each row maps a terminal + feature key to a boolean enabled state,
//! allowing terminals to deviate from the global feature set.

use rusqlite::params;

use crate::TerminalFeatureOverride;
use crate::error::CoreError;

use super::Store;

impl Store<'_> {
    /// List all feature overrides for a given terminal.
    pub fn list_terminal_overrides(
        &self,
        terminal_id: &str,
    ) -> Result<Vec<TerminalFeatureOverride>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT terminal_id, feature, enabled, created_at, updated_at
                 FROM terminal_feature_overrides
                 WHERE terminal_id = ?1
                 ORDER BY feature ASC",
        )?;
        let rows = stmt.query_map(params![terminal_id], Self::row_to_terminal_override)?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// Get a single feature override by terminal and feature key.
    pub fn get_terminal_override(
        &self,
        terminal_id: &str,
        feature: &str,
    ) -> Result<Option<TerminalFeatureOverride>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT terminal_id, feature, enabled, created_at, updated_at
                 FROM terminal_feature_overrides
                 WHERE terminal_id = ?1 AND feature = ?2",
        )?;
        let result = stmt.query_row(
            params![terminal_id, feature],
            Self::row_to_terminal_override,
        );
        match result {
            Ok(o) => Ok(Some(o)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Set (upsert) a feature override for a terminal.
    ///
    /// If an override for the same terminal_id + feature already exists,
    /// its `enabled` and `updated_at` are updated. Otherwise a new row
    /// is inserted.
    ///
    /// CORE-A: this is ONE atomic statement, not an UPDATE-then-INSERT pair.
    /// The previous two-statement form read `affected == 0` and only then
    /// inserted, so two concurrent callers could both see zero and both insert,
    /// the second failing with a UNIQUE violation on the
    /// `(terminal_id, feature)` primary key. `ON CONFLICT ... DO UPDATE` is
    /// the same shape `set_terminal_profile` already uses.
    pub fn set_terminal_override(
        &self,
        terminal_id: &str,
        feature: &str,
        enabled: bool,
    ) -> Result<(), CoreError> {
        let now = format_now();
        self.conn.execute(
            "INSERT INTO terminal_feature_overrides
                 (terminal_id, feature, enabled, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)
             ON CONFLICT(terminal_id, feature) DO UPDATE SET
                 enabled = excluded.enabled,
                 updated_at = excluded.updated_at",
            params![terminal_id, feature, i64::from(enabled), now],
        )?;
        Ok(())
    }

    /// Delete a single feature override for a terminal.
    pub fn delete_terminal_override(
        &self,
        terminal_id: &str,
        feature: &str,
    ) -> Result<(), CoreError> {
        let affected = self.conn.execute(
            "DELETE FROM terminal_feature_overrides
                 WHERE terminal_id = ?1 AND feature = ?2",
            params![terminal_id, feature],
        )?;
        if affected == 0 {
            return Err(CoreError::NotFound {
                entity: "terminal_feature_override",
                id: format!("{terminal_id}/{feature}"),
            });
        }
        Ok(())
    }

    /// Delete all feature overrides for a terminal.
    pub fn clear_terminal_overrides(&self, terminal_id: &str) -> Result<(), CoreError> {
        self.conn.execute(
            "DELETE FROM terminal_feature_overrides WHERE terminal_id = ?1",
            params![terminal_id],
        )?;
        Ok(())
    }

    // ── Row mapping ──────────────────────────────────────────────────

    fn row_to_terminal_override(row: &rusqlite::Row) -> rusqlite::Result<TerminalFeatureOverride> {
        Ok(TerminalFeatureOverride {
            terminal_id: row.get("terminal_id")?,
            feature: row.get("feature")?,
            enabled: row.get::<_, i64>("enabled")? != 0,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

/// Now, in the SAME shape the column's own DEFAULT writes.
///
/// `terminal_feature_overrides.created_at` / `updated_at` default to
/// `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`, which is MILLISECOND precision:
/// `2026-09-25T23:46:15.606Z`, 24 characters. This helper feeds the explicit
/// `VALUES` bind of the upsert — the row cannot simply take the DEFAULT,
/// because `ON CONFLICT ... DO UPDATE` has to set `updated_at` — so the shape
/// is spelled here too and has to agree.
///
/// It did not agree: `%S%.6fZ` is MICROSECONDS (`…15.606805Z`, 27 characters),
/// and the old comment claiming "same format used by the SQL `strftime`
/// default" was simply false. The two shapes sort incompatibly for the same
/// whole second — at index 24 the SQLite stamp has `Z` (0x5A) and this one a
/// digit — so a millisecond-precision row compares AFTER a microsecond row
/// that is older. Nothing compares these columns today, which is why this was
/// never visible; it is fixed so the first caller that DOES order by
/// `updated_at` does not inherit the inversion. `%.3f` renders the dot, which
/// is what `%f` means in SQLite (measured: both give `…15.606Z`).
fn format_now() -> String {
    chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string()
}

// ── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "terminal_overrides_tests.rs"]
mod tests;
