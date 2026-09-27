//! User create serving layer for the cloud Postgres replica.
//!
//! Owns `create_user`: it inserts the row and stamps `tenant_id` inside the
//! same transaction, mirroring `Store::create_user` on the SQLite path so the
//! two deployments accept the same request shape and enforce the same
//! uniqueness rule.
//!
//! Invariant: the tenant stamp is part of the INSERT, not a follow-up UPDATE,
//! so a row can never be observable at the default tenant before it is scoped.

use deadpool_postgres::Pool;

use kasirmu_core::User;

use super::{PgError, bump_snapshot_version, is_fk_violation, is_unique_violation, now_rfc3339};

/// Create a user, scoped to `tenant_id`, mirroring `Store::create_user`
/// (validation, the role FK check, the default `assignments` row).
pub async fn create_user(
    pool: &Pool,
    tenant_id: &str,
    username: &str,
    pin_hash: &str,
    display_name: &str,
    role_id: &str,
) -> Result<User, PgError> {
    let username = username.trim().to_lowercase();
    if username.is_empty() {
        return Err(PgError::Validation("username must not be empty".into()));
    }
    if username.len() > 100 {
        return Err(PgError::Validation(format!(
            "username must not exceed 100 characters, got {}",
            username.len()
        )));
    }
    if display_name.trim().is_empty() {
        return Err(PgError::Validation("display name must not be empty".into()));
    }
    if display_name.len() > 255 {
        return Err(PgError::Validation(format!(
            "display name must not exceed 255 characters, got {}",
            display_name.len()
        )));
    }

    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    // RLS: scope this transaction to the tenant (LOCAL, auto-resets on commit).
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;

    // The SQLite path surfaces an unknown role as a constraint violation;
    // here we fail closed with a clear validation error instead.
    let role_exists: bool = tx
        .query_one(
            "SELECT EXISTS(SELECT 1 FROM roles WHERE id = $1)",
            &[&role_id],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?
        .get(0);
    if !role_exists {
        return Err(PgError::Validation(format!(
            "role_id '{role_id}' does not reference an existing role"
        )));
    }

    let id = uuid::Uuid::now_v7().to_string();
    let now = now_rfc3339();
    if let Err(e) = tx
        .execute(
            "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at, tenant_id)
             VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8)",
            &[
                &id,
                &username,
                &pin_hash,
                &display_name.trim(),
                &role_id,
                &now,
                &now,
                &tenant_id,
            ],
        )
        .await
    {
        if is_unique_violation(&e) {
            return Err(PgError::Conflict);
        }
        if is_fk_violation(&e) {
            return Err(PgError::Validation(format!(
                "role_id '{role_id}' does not reference an existing role"
            )));
        }
        return Err(PgError::Db(e.to_string()));
    }

    // Every user gets their single effective assignment (ADR #35 D5).
    tx.execute(
        "INSERT INTO assignments (user_id, role_id, scope_mode, branch_scope, workspace_scope)
         VALUES ($1, $2, 'global', 'all', 'all')",
        &[&id, &role_id],
    )
    .await
    .map_err(|e| PgError::Db(e.to_string()))?;

    bump_snapshot_version(&tx, tenant_id).await?;

    tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;

    Ok(User {
        id,
        username,
        pin_hash: pin_hash.to_owned(),
        display_name: display_name.trim().to_owned(),
        role_id: role_id.to_owned(),
        is_active: true,
        created_at: now.clone(),
        updated_at: now,
    })
}
