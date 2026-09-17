//! Per-tenant bookkeeping queries on [`SyncStore`]: the read-only surface around
//! a tenant's queue and plan — `get_tenant_plan`, `oldest_created_at`,
//! `pending_count`, `distinct_tenant_count`, `snapshot_version` — moved verbatim
//! out of the parent by the 2026-09-15 split, which leaves the dispatch enum, the
//! two constructors and the push / pull / snapshot statement families there.
//!
//! This is an `impl SyncStore` block in a child module, so nothing is re-exported:
//! a method resolves through the type, not through the module path, and each of the
//! five was already `pub`. Same shape as `conflicts.rs`, which carries two of them.
//!
//! Invariant carried with the code: every query here is scoped by `tenant_id` in
//! SQL and, on Postgres, sets the `oz.tenant_id` GUC locally inside its own
//! transaction — except `distinct_tenant_count`, the one deliberate global
//! aggregate, documented at its own signature.

use kasirmu_core::TenantPlan;
use rusqlite::params;

use super::SyncStore;

impl SyncStore {
    /// Read a tenant's sync plan, or `None` when the tenant has no row yet.
    ///
    /// Mirrors `kasirmu_core::Store::get_tenant_plan` (missing row → `None`;
    /// unknown plan string degrades to `free`).
    pub async fn get_tenant_plan(&self, tenant_id: &str) -> Result<Option<TenantPlan>, String> {
        match self {
            Self::Sqlite(conn) => {
                let conn = conn.lock().await;
                kasirmu_core::Store::new(&conn)
                    .get_tenant_plan(tenant_id)
                    .map_err(|e| e.to_string())
            }
            Self::Postgres(pool) => {
                let mut client = pool.get().await.map_err(|e| e.to_string())?;
                let tx = client.transaction().await.map_err(|e| e.to_string())?;
                tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
                    .await
                    .map_err(|e| e.to_string())?;
                let row = tx
                    .query_opt(
                        "SELECT plan FROM tenant_plans WHERE tenant_id = $1",
                        &[&tenant_id],
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                row.map(|r| {
                    let plan: String = r.try_get(0).map_err(|e| e.to_string())?;
                    Ok(TenantPlan::from_db(&plan))
                })
                .transpose()
            }
        }
    }

    /// Return the oldest retained `created_at` for a tenant, if any.
    ///
    /// Used for the P-1 anchor-expiry check. Errors are silently swallowed
    /// (returned as `None`) to match the historical SQLite behaviour — a
    /// failed min-scan degrades to "no anchor check" rather than failing
    /// the pull.
    pub async fn oldest_created_at(&self, tenant_id: &str) -> Option<String> {
        match self {
            Self::Sqlite(conn) => {
                let conn = conn.lock().await;
                conn.query_row(
                    "SELECT MIN(created_at) FROM offline_queue WHERE tenant_id = ?1",
                    params![tenant_id],
                    |row| row.get(0),
                )
                .ok()
                .flatten()
            }
            Self::Postgres(pool) => {
                let mut client = pool.get().await.ok()?;
                let tx = client.transaction().await.ok()?;
                tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
                    .await
                    .ok()?;
                let stmt = tx
                    .prepare_cached(
                        "SELECT MIN(created_at) FROM offline_queue WHERE tenant_id = $1",
                    )
                    .await
                    .ok()?;
                tx.query_opt(&stmt, &[&tenant_id])
                    .await
                    .ok()
                    .flatten()
                    .and_then(|r| r.try_get::<_, Option<String>>(0).ok().flatten())
            }
        }
    }

    /// Number of `pending` items for a tenant (status endpoint).
    pub async fn pending_count(&self, tenant_id: &str) -> i64 {
        match self {
            Self::Sqlite(conn) => {
                let conn = conn.lock().await;
                conn.query_row(
                    "SELECT COUNT(*) FROM offline_queue WHERE status = 'pending' AND tenant_id = ?1",
                    params![tenant_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap_or(0)
            }
            Self::Postgres(pool) => {
                let mut client = match pool.get().await {
                    Ok(c) => c,
                    Err(_) => return 0,
                };
                let tx = match client.transaction().await {
                    Ok(t) => t,
                    Err(_) => return 0,
                };
                if tx
                    .execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
                    .await
                    .is_err()
                {
                    return 0;
                }
                // D1 (ADR #43): prepared statement caching — this COUNT runs
                // on every status heartbeat; re-parsing identical SQL each
                // time wastes PG CPU. prepare_cached is keyed by SQL text on
                // the pooled connection, so repeated calls reuse the plan.
                match tx
                    .prepare_cached(
                        "SELECT COUNT(*) FROM offline_queue WHERE status = 'pending' AND tenant_id = $1",
                    )
                    .await
                {
                    Ok(stmt) => tx
                        .query_one(&stmt, &[&tenant_id])
                        .await
                        .map(|r| r.get::<_, i64>(0))
                        .unwrap_or(0),
                    Err(_) => 0,
                }
            }
        }
    }

    /// Number of distinct tenants in the queue (status endpoint).
    ///
    /// Deliberately NOT tenant-scoped: this is a global operator-facing
    /// aggregate, so it intentionally runs without the `oz.tenant_id` GUC.
    /// Once RLS is FORCEd at cutover (`scripts/rls-cutover.sql`), the policy
    /// hides every row from the app role and this counter reads 0 — the
    /// status endpoint keeps working, the number is simply not visible to
    /// the restricted role.
    pub async fn distinct_tenant_count(&self) -> i64 {
        match self {
            Self::Sqlite(conn) => {
                let conn = conn.lock().await;
                conn.query_row(
                    "SELECT COUNT(DISTINCT tenant_id) FROM offline_queue",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap_or(0)
            }
            Self::Postgres(pool) => {
                let Ok(client) = pool.get().await else {
                    return 0;
                };
                let Ok(stmt) = client
                    .prepare_cached("SELECT COUNT(DISTINCT tenant_id) FROM offline_queue")
                    .await
                else {
                    return 0;
                };
                client
                    .query_one(&stmt, &[])
                    .await
                    .map(|r| r.get::<_, i64>(0))
                    .unwrap_or(0)
            }
        }
    }

    /// Compute the version token for a tenant's snapshot reference data.
    ///
    /// On PostgreSQL this reads the per-tenant counter from
    /// `snapshot_versions` (ADR #43 D2) — a single PK read that changes
    /// whenever a reference-data write (create_product / create_tax_rate /
    /// create_user) bumps it in the same transaction, so the snapshot
    /// handler revalidates "nothing changed" without re-scanning the three
    /// reference tables.  An absent row means no hooked write has run for
    /// this tenant: version 0, and the first write makes the next
    /// revalidation see the change.
    ///
    /// On SQLite the version stamp is the per-table (row count,
    /// MAX(updated_at)) triple joined into one string — the fallback for
    /// backends with no write hook (dev / single-node).
    pub async fn snapshot_version(&self, tenant_id: &str) -> Result<String, String> {
        match self {
            Self::Sqlite(conn) => {
                let conn = conn.lock().await;
                conn.query_row(
                    "SELECT \
                     (SELECT COUNT(*) FROM products WHERE tenant_id = ?1) || ':' || \
                     COALESCE((SELECT MAX(updated_at) FROM products WHERE tenant_id = ?1), '') || '|' || \
                     (SELECT COUNT(*) FROM tax_rates WHERE tenant_id = ?1) || ':' || \
                     COALESCE((SELECT MAX(updated_at) FROM tax_rates WHERE tenant_id = ?1), '') || '|' || \
                     (SELECT COUNT(*) FROM users WHERE tenant_id = ?1) || ':' || \
                     COALESCE((SELECT MAX(updated_at) FROM users WHERE tenant_id = ?1), '')",
                    rusqlite::params![tenant_id],
                    |row| row.get::<_, String>(0),
                )
                .map_err(|e| e.to_string())
            }
            Self::Postgres(pool) => {
                let mut client = pool.get().await.map_err(|e| e.to_string())?;
                let tx = client.transaction().await.map_err(|e| e.to_string())?;
                tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
                    .await
                    .map_err(|e| e.to_string())?;
                let stmt = tx
                    .prepare_cached("SELECT version FROM snapshot_versions WHERE tenant_id = $1")
                    .await
                    .map_err(|e| e.to_string())?;
                Ok(tx
                    .query_opt(&stmt, &[&tenant_id])
                    .await
                    .map_err(|e| e.to_string())?
                    .map(|r| r.get::<_, i64>(0))
                    .unwrap_or(0)
                    .to_string())
            }
        }
    }
}
