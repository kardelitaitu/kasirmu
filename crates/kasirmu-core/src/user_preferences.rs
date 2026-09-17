//! Per-user display preferences — card size, font size, theme, locale, etc.
//!
//! Preferences are stored as key-value pairs in the `user_preferences` table,
//! scoped by `user_id`. Each staff member can have their own settings that
//! persist across sessions and terminals.

use std::collections::HashMap;

use rusqlite::Connection;

use crate::error::CoreError;

/// Key-value user preferences stored in the `user_preferences` table.
///
/// Each row is scoped by `user_id` so every staff member can have their
/// own display preferences (card size, font size, etc.) that persist
/// across sessions and terminals.
pub struct UserPreferences;

impl UserPreferences {
    /// Load every preference for a user as a `(key, value)` map.
    pub fn get_all(conn: &Connection, user_id: &str) -> Result<HashMap<String, String>, CoreError> {
        let mut stmt = conn.prepare_cached(
            "SELECT pref_key, pref_value FROM user_preferences WHERE user_id = ?1",
        )?;
        let rows = stmt.query_map([user_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut map = HashMap::new();
        for row in rows {
            let (k, v) = row?;
            map.insert(k, v);
        }
        Ok(map)
    }

    /// Upsert multiple preferences for a user inside a single transaction.
    pub fn set_batch(
        conn: &Connection,
        user_id: &str,
        prefs: &[(String, String)],
    ) -> Result<(), CoreError> {
        let tx = conn.unchecked_transaction()?;
        {
            let mut stmt = tx.prepare_cached(
                "INSERT INTO user_preferences (user_id, pref_key, pref_value, updated_at)
                 VALUES (?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                 ON CONFLICT(user_id, pref_key)
                 DO UPDATE SET pref_value = excluded.pref_value,
                               updated_at  = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
            )?;
            for (key, value) in prefs {
                stmt.execute(rusqlite::params![user_id, key, value])?;
            }
        }
        tx.commit()?;
        Ok(())
    }
}

#[cfg(test)]
#[path = "user_preferences_tests.rs"]
mod tests;
