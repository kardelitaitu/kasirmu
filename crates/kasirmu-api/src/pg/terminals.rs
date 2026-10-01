//! Terminal serving layer for the cloud Postgres replica.
//!
//! Owns registration (create or rotate the device secret) and the
//! credential-verification read the sync handshake uses before any
//! tenant-scoped work begins.
//!
//! Main functions: [`register_terminal`], [`verify_terminal_credentials`].
//!
//! Invariant: `verify_terminal_credentials` is a documented PRE-TENANT read —
//! it resolves the terminal under a scoped discovery role inside a read-only
//! transaction, because it runs before `oz.tenant_id` can be known.

use deadpool_postgres::Pool;

use crate::routes::terminals::RegisteredTerminal;

use super::PgError;
use super::helpers::now_rfc3339;

/// Register (or rotate the secret of) a sync terminal.
pub async fn register_terminal(
    pool: &Pool,
    terminal_id: &str,
    secret_hash: &str,
    label: &str,
    tenant_id: Option<&str>,
) -> Result<(), PgError> {
    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    if let Some(tenant) = tenant_id {
        // RLS: scope to the tenant (LOCAL setting — auto-resets on commit).
        // A `None` tenant is a legacy/NULL-tenant row: no GUC can be set, and
        // under FORCE the RLS WITH CHECK rejects the write anyway.
        tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant])
            .await
            .map_err(|e| PgError::Db(e.to_string()))?;
    }
    tx.execute(
        "INSERT INTO sync_terminals (terminal_id, secret_hash, label, tenant_id, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (terminal_id) DO UPDATE SET
            secret_hash = excluded.secret_hash,
            label = excluded.label,
            tenant_id = excluded.tenant_id",
        &[
            &terminal_id,
            &secret_hash,
            &label,
            &tenant_id,
            &now_rfc3339(),
        ],
    )
    .await
    .map_err(|e| PgError::Db(e.to_string()))?;
    tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;
    Ok(())
}

/// Resolve a terminal from client credentials, or `None` on mismatch.
///
/// RLS exception (pre-tenant by design): this lookup IS the tenant-resolution
/// step — the `oz.tenant_id` GUC is read FROM the terminal row it returns, so
/// it cannot set the GUC first. Under `FORCE ROW LEVEL SECURITY` with the
/// restricted `oz_app` role a bare query returns zero rows. The function
/// therefore scopes the read to the BYPASSRLS `oz_email_discovery` role
/// (when the session user is a member) — the same pattern as the webhook
/// resolver and `active_tenants_pg`, so client-credential minting works
/// post-cutover. Pre-cutover (no discovery role yet) it reads unscoped, as
/// before.
pub async fn verify_terminal_credentials(
    pool: &Pool,
    client_id: &str,
    client_secret: &str,
) -> Result<Option<RegisteredTerminal>, PgError> {
    let digest = crate::routes::terminals::hash_secret(client_secret);
    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;

    // Terminal credential verification is a PRE-tenant read: the whole
    // point of the lookup is to learn the tenant_id. After RLS cutover
    // (oz_app + FORCE RLS), a bare read on sync_terminals sees zero rows
    // because current_setting('oz.tenant_id') is NULL. Mirror the
    // active_tenants_pg pattern: if the session user is a member of the
    // BYPASSRLS discovery role, scope the read to it.
    let is_discovery_member: bool = tx
        .query_one(
            "SELECT EXISTS(
                SELECT 1 FROM pg_roles r
                JOIN pg_auth_members m ON m.roleid = r.oid
                WHERE r.rolname = 'oz_email_discovery'
                  AND m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user)
             )",
            &[],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?
        .get(0);
    if is_discovery_member {
        tx.execute("SET LOCAL ROLE oz_email_discovery", &[])
            .await
            .map_err(|e| PgError::Db(e.to_string()))?;
    }

    let row = tx
        .query_opt(
            "SELECT terminal_id, tenant_id FROM sync_terminals WHERE terminal_id = $1 AND secret_hash = $2",
            &[&client_id, &digest],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    let result = row
        .map(|r| {
            Ok(RegisteredTerminal {
                terminal_id: r.try_get(0).map_err(|e| PgError::Db(e.to_string()))?,
                tenant_id: r.try_get(1).map_err(|e| PgError::Db(e.to_string()))?,
            })
        })
        .transpose();
    // Transaction drops here → rollback (read-only) → GUC and role reset.
    result
}
