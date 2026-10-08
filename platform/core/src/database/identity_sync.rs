//! Session-user replication into store databases.
//!
//! INVARIANT (restored 2026-10-08): a session's `user_id` must exist in the
//! `users` table of every store database the session can open. Broken on the
//! tablet — `staff_login` authenticates the user in the GLOBAL identity DB and
//! the minted session binds to a store DB that provisioning created WITHOUT
//! any users, so every `require_permission_for_user` failed with
//! `PermissionDenied("user not found")` (currencies, exchange rates; measured
//! by the device walk). The desktop never noticed because its store DBs were
//! populated on the machine that created them.
//!
//! The replication deliberately does NOT copy `assignments`: the store-scope
//! model (ADR #35 D5) treats a user without a store assignment as
//! not scope-restricted, and inventing assignments could widen access.
//! Authorization keeps reading the store DB — nothing here weakens the
//! role-ID-forgery guard.
//!
//! The two databases are separate connections, so every read is a `SELECT`
//! against `global` and every write an upsert against `store` — there is no
//! cross-database SQL here.
//!
//! It is NON-DESTRUCTIVE by design: a store DB that already holds another
//! identity for the same `(tenant_id, username)` is reported, never
//! overwritten or deleted. Silently removing a `users` row could cascade into
//! assignments and history, and a loud failure is the honest outcome.

use crate::error::PlatformError;
use rusqlite::Connection;

/// Copy the user's `users` row — and the `roles` row it references, for the
/// foreign key — from the global identity database into a store database.
///
/// Returns `Ok(false)` when the global DB has no such user; callers decide
/// whether that is fatal. `Ok(true)` means the store DB now authorizes
/// `user_id` through its own tables.
///
/// Auth-relevant fields (`role_id`, `is_active`) are refreshed on conflict so
/// a re-mint picks up deactivations and role changes; display and contact
/// fields are left to whatever the store DB already holds.
///
/// The writes run in ONE transaction: a store DB holding a role row but no
/// user row — or the reverse — is worse than a failed mint, because that
/// partial state resurfaces as `PermissionDenied("user not found")` on every
/// scoped command.
pub fn ensure_session_user_in_store(
    global: &Connection,
    store: &Connection,
    user_id: &str,
) -> Result<bool, PlatformError> {
    let user: Option<(String, String, String, String, i64, String, String)> = global
        .query_row(
            "SELECT username, pin_hash, display_name, role_id, is_active, created_at, tenant_id
             FROM users WHERE id = ?1",
            [user_id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                ))
            },
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(PlatformError::Internal(format!(
                "reading session user for store replication: {other}"
            ))),
        })?;

    let Some((username, pin_hash, display_name, role_id, is_active, created_at, tenant_id)) = user
    else {
        return Ok(false);
    };

    // The role row must exist before the user row: `users.role_id` is a
    // foreign key into `roles`.
    let role: Option<(String, String, String, String)> = global
        .query_row(
            "SELECT name, description, permissions, created_at
             FROM roles WHERE id = ?1",
            [&role_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(PlatformError::Internal(format!(
                "reading session role for store replication: {other}"
            ))),
        })?;

    let tx = store
        .unchecked_transaction()
        .map_err(|e| PlatformError::Internal(format!("store db transaction: {e}")))?;

    if let Some((name, description, permissions, role_created_at)) = role {
        tx.execute(
            "INSERT INTO roles (id, name, description, permissions, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                description = excluded.description,
                permissions = excluded.permissions,
                updated_at = excluded.updated_at",
            rusqlite::params![role_id, name, description, permissions, role_created_at],
        )
        .map_err(|e| PlatformError::Internal(format!("store db role upsert: {e}")))?;
    }

    tx.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, tenant_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
         ON CONFLICT(id) DO UPDATE SET
            username = excluded.username,
            pin_hash = excluded.pin_hash,
            display_name = excluded.display_name,
            role_id = excluded.role_id,
            is_active = excluded.is_active,
            updated_at = excluded.updated_at",
        rusqlite::params![
            user_id,
            username,
            pin_hash,
            display_name,
            role_id,
            is_active,
            tenant_id,
            created_at
        ],
    )
    .map_err(|e| PlatformError::Internal(format!("store db user upsert: {e}")))?;

    tx.commit()
        .map_err(|e| PlatformError::Internal(format!("store db commit: {e}")))?;

    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Minimal slice of the real schema: the columns this module touches plus
    /// the two unique indexes that constrain them.
    fn schema(conn: &Connection) {
        conn.execute_batch(
            "CREATE TABLE roles (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                description TEXT NOT NULL DEFAULT '',
                permissions TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
             );
             CREATE TABLE users (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                pin_hash TEXT NOT NULL,
                display_name TEXT NOT NULL,
                role_id TEXT NOT NULL REFERENCES roles(id),
                is_active INTEGER NOT NULL DEFAULT 1,
                tenant_id TEXT NOT NULL DEFAULT 'default',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
             );
             CREATE UNIQUE INDEX idx_users_tenant_username ON users(tenant_id, username);",
        )
        .unwrap();
    }

    fn seed_global_user(conn: &Connection, id: &str, username: &str, active: i64) {
        conn.execute(
            "INSERT INTO roles (id, name, description, permissions, created_at, updated_at)
             VALUES ('role-owner', 'owner', '', '[\"*\"]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, tenant_id, created_at, updated_at)
             VALUES (?1, ?2, 'hash', 'Owner', 'role-owner', ?3, 'default', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
            rusqlite::params![id, username, active],
        )
        .unwrap();
    }

    #[test]
    fn reports_false_when_the_global_db_has_no_such_user() {
        let global = Connection::open_in_memory().unwrap();
        let store = Connection::open_in_memory().unwrap();
        schema(&global);
        schema(&store);

        assert!(
            !ensure_session_user_in_store(&global, &store, "ghost").unwrap(),
            "an unknown user must be reported, not fabricated"
        );
        let count: i64 = store
            .query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0, "nothing may be written for an unknown user");
    }

    #[test]
    fn replicates_the_user_and_its_role_into_the_store_db() {
        let global = Connection::open_in_memory().unwrap();
        let store = Connection::open_in_memory().unwrap();
        schema(&global);
        schema(&store);
        seed_global_user(&global, "user-1", "owner", 1);

        assert!(ensure_session_user_in_store(&global, &store, "user-1").unwrap());

        let (role_id, active): (String, i64) = store
            .query_row(
                "SELECT role_id, is_active FROM users WHERE id = 'user-1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(role_id, "role-owner");
        assert_eq!(active, 1);
        // The FK target must exist too, or the insert could not have run.
        let permissions: String = store
            .query_row(
                "SELECT permissions FROM roles WHERE id = 'role-owner'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(permissions, "[\"*\"]");
    }

    #[test]
    fn replicates_a_deactivated_user_as_inactive() {
        // Fail closed: authorization reads the STORE db, so a user the global
        // db has deactivated must not arrive active.
        let global = Connection::open_in_memory().unwrap();
        let store = Connection::open_in_memory().unwrap();
        schema(&global);
        schema(&store);
        seed_global_user(&global, "user-1", "owner", 0);

        assert!(ensure_session_user_in_store(&global, &store, "user-1").unwrap());
        let active: i64 = store
            .query_row("SELECT is_active FROM users WHERE id = 'user-1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(active, 0, "a deactivated user must replicate inactive");
    }

    #[test]
    fn refreshes_auth_fields_when_the_row_already_exists() {
        let global = Connection::open_in_memory().unwrap();
        let store = Connection::open_in_memory().unwrap();
        schema(&global);
        schema(&store);
        seed_global_user(&global, "user-1", "owner", 1);

        // The store db holds a stale copy: active, but with a lesser role.
        store
            .execute(
                "INSERT INTO roles (id, name, description, permissions, created_at, updated_at)
                 VALUES ('role-staff', 'staff', '', '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
                [],
            )
            .unwrap();
        store
            .execute(
                "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, tenant_id, created_at, updated_at)
                 VALUES ('user-1', 'owner', 'old-hash', 'Owner', 'role-staff', 1, 'default', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
                [],
            )
            .unwrap();

        assert!(ensure_session_user_in_store(&global, &store, "user-1").unwrap());
        let (role_id, hash): (String, String) = store
            .query_row(
                "SELECT role_id, pin_hash FROM users WHERE id = 'user-1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(
            role_id, "role-owner",
            "role must refresh from the global db"
        );
        assert_eq!(hash, "hash", "credential must refresh from the global db");
    }

    #[test]
    fn refuses_to_displace_another_identity_for_the_same_username() {
        // Non-destructive: a different user id already owns this
        // (tenant_id, username). Deleting or silently replacing it could
        // orphan assignments and history, so the conflict is reported.
        let global = Connection::open_in_memory().unwrap();
        let store = Connection::open_in_memory().unwrap();
        schema(&global);
        schema(&store);
        seed_global_user(&global, "user-new", "owner", 1);
        store
            .execute(
                "INSERT INTO roles (id, name, description, permissions, created_at, updated_at)
                 VALUES ('role-owner', 'owner', '', '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
                [],
            )
            .unwrap();
        store
            .execute(
                "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, tenant_id, created_at, updated_at)
                 VALUES ('user-old', 'owner', 'hash', 'Owner', 'role-owner', 1, 'default', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
                [],
            )
            .unwrap();

        let err = ensure_session_user_in_store(&global, &store, "user-new").unwrap_err();
        assert!(
            format!("{err}").contains("UNIQUE"),
            "the conflict must be reported, not swallowed: {err}"
        );
        let surviving: i64 = store
            .query_row(
                "SELECT COUNT(*) FROM users WHERE id = 'user-old'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(surviving, 1, "the store db's identity must not be deleted");
    }
}
