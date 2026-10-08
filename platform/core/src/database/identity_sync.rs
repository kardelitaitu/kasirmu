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

    if let Some((name, description, permissions, role_created_at)) = role {
        store
            .execute(
                "INSERT INTO roles (id, name, description, permissions, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?5)
                 ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    description = excluded.description,
                    permissions = excluded.permissions,
                    updated_at = excluded.updated_at",
                rusqlite::params![role_id, name, description, permissions, role_created_at],
            )
            .map_err(|e| PlatformError::Internal(format!("replicating session role: {e}")))?;
    }

    // A re-provisioned device can hold a STALE row for the same person under
    // a different id (user ids are minted per provisioning). Usernames are
    // unique per (tenant_id, username), so the stale row would collide with
    // the insert. Remove it first — a live reference (FK RESTRICT) fails
    // loudly here instead of corrupting anything.
    store
        .execute(
            "DELETE FROM users WHERE tenant_id = ?1 AND username = ?2 AND id <> ?3",
            rusqlite::params![tenant_id, username, user_id],
        )
        .map_err(|e| PlatformError::Internal(format!("clearing stale store user: {e}")))?;

    store
        .execute(
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
        .map_err(|e| PlatformError::Internal(format!("replicating session user: {e}")))?;

    Ok(true)
}
