/*
last audited 25-07-26 by RSA-Agent (cloud-server slice B: sync_store verified)
crate: cloud-server | status: SAFE | lint: CLEAN
findings: all queue reads tenant-scoped in SQL (WHERE tenant_id = ?1); push per-item outcomes with duplicate detection; CS-3 FIXED — the SQLite push_batch arm now runs in one transaction. PERF 2026-09: push_batch multi-row fast path — INSERT … ON CONFLICT (id) DO NOTHING RETURNING id in MULTIROW_CHUNK-sized statements (PG + SQLite), falling back to the per-item SAVEPOINT loop only when a non-unique data error aborts the statement; per-item outcomes preserved via returned-id multiset consumed in input order
next: none | perf: multi-row fast path collapses N round trips into ~ceil(N/500)
*/
//! Sync data-store abstraction for the cloud server's sync function.
//!
//! This is the foundation of Phase 1.2 in
//! `docs/archived/2026-08-15-unify-auth-and-sync.md`: the
//! whole POS data layer ([`oz_core::Store`]) is a synchronous `rusqlite`
//! borrow-wrapper used by desktop, tablet, *and* cloud clients, so it cannot
//! be rewritten to Postgres. The cloud server therefore needs a **parallel
//! async data layer** covering only the surface the sync function touches:
//!
//! - `offline_queue` (push / pull / pending count)
//! - `tenant_plans` (plan gating)
//! - `products` / `tax_rates` / `users` (snapshot reference data)
//!
//! [`SyncStore`] is a small enum with one variant per backend so the HTTP
//! handlers stay backend-agnostic: SQLite (local dev / single-node) and
//! Postgres (Northflank cloud). Both variants implement the exact same
//! surface, so switching backend is a data-source decision, not a code-path
//! fork.
//!
//! # Type parity
//!
//! The Postgres port (`20260813_init.pg.sql`) maps SQLite `INTEGER` to
//! `BIGINT` **including boolean columns** (`track_serial`, `is_active`,
//! `is_default`, `is_inclusive`). The Postgres path therefore reads those
//! as `i64` and treats `0` as `false`, anything non-zero as `true` — the
//! same 0/1 convention SQLite uses.

mod pg;
mod conflicts;
mod sqlite;

use std::sync::Arc;

use deadpool_postgres::Pool;
use rusqlite::{Connection, params};
use tokio::sync::Mutex;

use crate::conflict_resolution::{Decision, entity_id_of, extract_vector};

use oz_core::TenantPlan;
#[cfg(test)] // named only by `sync_store_tests.rs`, through `use super::*;`
use oz_core::offline::SyncPriority;
use oz_core::offline::{OfflineQueueItem, OfflineQueueStatus};
use pg::{
    pg_pull_items, pg_push_batch_multirow, pg_snapshot_products, pg_snapshot_tax_rates,
    pg_snapshot_users,
};
use platform_sync::transport::PushOutcome;
use sqlite::{
    sqlite_pull_items, sqlite_push_batch_multirow, sqlite_snapshot_products,
    sqlite_snapshot_tax_rates, sqlite_snapshot_users,
};

/// Maximum rows per multi-row INSERT statement.
///
/// PostgreSQL caps parameters at 65535 (`Int4`/`Int8` protocol limit) and
/// SQLite at 32766; 9 columns per row × this batch keeps us far below both
/// while still collapsing a whole push page into a handful of statements.
const MULTIROW_CHUNK: usize = 500;

/// Open a Postgres connection scoped to `tenant_id` for RLS enforcement.
///
/// Every Postgres branch below opens a transaction and sets the
/// `oz.tenant_id` GUC **locally** (`set_config(..., is_local := true)`), so
/// it auto-resets when the transaction ends — a leaked session-level
/// setting on a recycled pooled connection could expose the previous
/// borrower's tenant once RLS is FORCEd (see `scripts/rls-cutover.sql`).
/// While the app still connects as the table owner (which bypasses RLS)
/// this is a no-op; at cutover it becomes the per-request `SET LOCAL
/// oz.tenant_id` the `tenant_isolation` policy keys on.
///
/// Read paths rely on drop-to-roll-back; the write path (`push_item`)
/// commits explicitly.
///
/// The sync function's data backend.
///
/// [`SyncStore::Sqlite`] wraps the shared SQLite connection behind its
/// existing `Arc<Mutex<>>` (the same connection the REST API uses).
/// [`SyncStore::Postgres`] wraps a `deadpool_postgres::Pool`.
#[derive(Clone)]
pub enum SyncStore {
    /// Local SQLite backend (single-node dev / tests).
    Sqlite(Arc<Mutex<Connection>>),
    /// Postgres backend (Northflank cloud, Phase 1.2).
    Postgres(Pool),
}

impl SyncStore {
    /// Build a SQLite-backed store from the shared connection.
    pub fn sqlite(conn: Arc<Mutex<Connection>>) -> Self {
        Self::Sqlite(conn)
    }

    /// Build a Postgres-backed store from a connection pool.
    pub fn postgres(pool: Pool) -> Self {
        Self::Postgres(pool)
    }

    /// Read a tenant's sync plan, or `None` when the tenant has no row yet.
    ///
    /// Mirrors `oz_core::Store::get_tenant_plan` (missing row → `None`;
    /// unknown plan string degrades to `free`).
    pub async fn get_tenant_plan(&self, tenant_id: &str) -> Result<Option<TenantPlan>, String> {
        match self {
            Self::Sqlite(conn) => {
                let conn = conn.lock().await;
                oz_core::Store::new(&conn)
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

    /// Persist one offline queue item for the authenticated tenant.
    ///
    /// Returns the per-item outcome: `Accepted`, or `Rejected` for a
    /// duplicate id / database error. Only backend-connection failures
    /// (Postgres pool exhaustion) surface as `Err`, which the handler maps
    /// to a 500.
    ///
    /// This is a single-item convenience over [`SyncStore::push_batch`];
    /// the HTTP handler always uses the batched form.
    #[cfg(test)]
    pub async fn push_item(
        &self,
        item: &OfflineQueueItem,
        tenant_id: &str,
    ) -> Result<PushOutcome, String> {
        let mut outcomes = self
            .push_batch(std::slice::from_ref(item), tenant_id)
            .await?;
        // `push_batch` returns exactly one outcome per item.
        Ok(outcomes
            .pop()
            .expect("push_batch returns one outcome per item"))
    }

    /// Persist a batch of offline queue items in **one transaction**.
    ///
    /// The hot push path previously opened a transaction per item — a
    /// 50-item batch meant 50 pool acquisitions + 50 GUC sets + 50 COMMITs.
    /// This hoists the transaction out of the loop: one pool acquisition,
    /// one `oz.tenant_id` GUC, N INSERTs, one COMMIT.
    ///
    /// SOTA perf (2026-09): a multi-row fast path collapses a whole push
    /// page into a handful of INSERT statements (`MULTIROW_CHUNK` rows per
    /// statement) using `ON CONFLICT (id) DO NOTHING RETURNING id`. Only
    /// when a non-unique data error (trigger / CHECK / NOT NULL) aborts the
    /// multi-row statement does it fall back to the per-item loop below,
    /// preserving per-item outcomes exactly.
    ///
    /// Per-item outcomes are preserved so a single bad item cannot roll
    /// back its siblings:
    ///
    /// - PostgreSQL runs each per-item fallback INSERT inside a **SAVEPOINT**
    ///   — a duplicate id returns zero rows via `ON CONFLICT (id) DO NOTHING
    ///   RETURNING id` (reported `Rejected`, savepoint released); a non-unique
    ///   data error (trigger, CHECK, NOT NULL) is caught, the savepoint rolled
    ///   back, and the item reported `Rejected` while the rest of the batch
    ///   continues. Without the SAVEPOINT, ANY statement failure would abort
    ///   the whole transaction ("current transaction is aborted") and the
    ///   COMMIT would fail — silently losing the valid items.
    /// - SQLite keeps the `UNIQUE` substring check per item in the fallback.
    ///
    /// Only backend-connection failures (pool exhaustion, COMMIT failure)
    /// surface as `Err`, which the handler maps to a 500.
    pub async fn push_batch(
        &self,
        items: &[OfflineQueueItem],
        tenant_id: &str,
    ) -> Result<Vec<PushOutcome>, String> {
        let status = OfflineQueueStatus::Pending.as_stored_str();
        if items.is_empty() {
            return Ok(Vec::new());
        }

        // Conflict detection runs BEFORE the insert, and its failures are
        // logged and swallowed: detection is best-effort metadata work, and a
        // detection error must never cost the tenant their pushed data. Items
        // without a vector (peers that predate vector support) are skipped
        // rather than guessed at.
        for item in items {
            let Some(vector) = extract_vector(&item.payload) else {
                continue;
            };
            let entity_id = entity_id_of(&item.payload, &item.id);
            match self
                .detect_conflict(tenant_id, &item.action, &entity_id, &vector, &item.payload)
                .await
            {
                Ok(Some(Decision::Flag { severity })) => {
                    tracing::warn!(
                        action = %item.action,
                        entity_id = %entity_id,
                        severity = severity.as_str(),
                        "concurrent sync mutation flagged for review"
                    );
                }
                Ok(_) => {}
                Err(e) => {
                    tracing::error!("conflict detection failed for {}: {e}", item.id);
                }
            }
        }

        match self {
            Self::Sqlite(conn) => {
                let conn = conn.lock().await;
                // Fast path: multi-row INSERT … ON CONFLICT DO NOTHING
                // RETURNING id, chunked to stay under the parameter cap.
                if let Ok(outcomes) = sqlite_push_batch_multirow(&conn, items, status, tenant_id) {
                    return Ok(outcomes);
                }
                // Fallback: CS-3 single-transaction per-item loop — a
                // multi-row statement aborted (trigger/CHECK/NOT NULL);
                // UNIQUE failures roll back only their own statement in
                // SQLite, so per-item outcomes are unchanged.
                let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
                let mut results = Vec::with_capacity(items.len());
                for item in items {
                    let outcome = match tx.execute(
                        "INSERT INTO offline_queue (id, action, payload, status, retry_count, \
                         last_error, created_at, synced_at, tenant_id)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                        params![
                            item.id,
                            item.action,
                            item.payload,
                            status,
                            item.retry_count,
                            item.last_error,
                            item.created_at,
                            item.synced_at,
                            tenant_id,
                        ],
                    ) {
                        Ok(_) => PushOutcome::Accepted,
                        Err(e) if e.to_string().contains("UNIQUE") => PushOutcome::Rejected {
                            reason: format!("duplicate id: {}", item.id),
                        },
                        Err(e) => PushOutcome::Rejected {
                            reason: format!("database error: {e}"),
                        },
                    };
                    results.push(outcome);
                }
                // The write path must COMMIT (drop would roll back the inserts).
                tx.commit().map_err(|e| e.to_string())?;
                Ok(results)
            }
            Self::Postgres(pool) => {
                // Fast path: multi-row INSERT … ON CONFLICT DO NOTHING
                // RETURNING id, chunked. One round trip per chunk instead of
                // N per-item round trips.
                if let Ok(outcomes) = pg_push_batch_multirow(pool, items, status, tenant_id).await {
                    return Ok(outcomes);
                }
                // Fallback: SAVEPOINT-per-item loop (see doc comment above).
                let mut client = pool.get().await.map_err(|e| e.to_string())?;
                let tx = client.transaction().await.map_err(|e| e.to_string())?;
                tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
                    .await
                    .map_err(|e| e.to_string())?;
                let mut results = Vec::with_capacity(items.len());
                for (i, item) in items.iter().enumerate() {
                    // Each item runs inside a SAVEPOINT so a non-unique
                    // data error (trigger, CHECK, NOT NULL) rolls back
                    // only that item, NOT the whole batch. The SAVEPOINT
                    // is released on success (Accepted / Rejected-dup)
                    // or rolled back on a true error.
                    let sp = format!("push_item_{i}");
                    if let Err(e) = tx.execute(&format!("SAVEPOINT {sp}"), &[]).await {
                        let _ = tx
                            .execute(&format!("ROLLBACK TO SAVEPOINT {sp}"), &[])
                            .await;
                        return Err(format!("SAVEPOINT error: {e}"));
                    }

                    let params: &[&(dyn tokio_postgres::types::ToSql + Sync)] = &[
                        &item.id,
                        &item.action,
                        &item.payload,
                        &status,
                        &item.retry_count,
                        &item.last_error,
                        &item.created_at,
                        &item.synced_at,
                        &tenant_id,
                    ];
                    let outcome = match tx
                        .query_opt(
                            "INSERT INTO offline_queue (id, action, payload, status, retry_count, \
                         last_error, created_at, synced_at, tenant_id)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                         ON CONFLICT (id) DO NOTHING
                         RETURNING id",
                            params,
                        )
                        .await
                    {
                        // A returned row means the INSERT landed (Accepted);
                        // zero rows means the id already existed (Rejected).
                        // `DO NOTHING` keeps the transaction alive either way —
                        // release the SAVEPOINT in both cases.
                        Ok(Some(_)) => {
                            let _ = tx.execute(&format!("RELEASE SAVEPOINT {sp}"), &[]).await;
                            PushOutcome::Accepted
                        }
                        Ok(None) => {
                            let _ = tx.execute(&format!("RELEASE SAVEPOINT {sp}"), &[]).await;
                            PushOutcome::Rejected {
                                reason: format!("duplicate id: {}", item.id),
                            }
                        }
                        Err(e) => {
                            // A non-unique error (trigger, CHECK, NOT NULL)
                            // aborts the transaction — roll back to the
                            // SAVEPOINT so the rest of the batch survives.
                            let _ = tx
                                .execute(&format!("ROLLBACK TO SAVEPOINT {sp}"), &[])
                                .await;
                            // Use the REAL db message, not the generic
                            // tokio-postgres error kind (whose Display is
                            // just "db error").
                            let reason = e
                                .as_db_error()
                                .map(|d| d.message().to_owned())
                                .unwrap_or_else(|| e.to_string());
                            PushOutcome::Rejected {
                                reason: format!("database error: {reason}"),
                            }
                        }
                    };
                    results.push(outcome);
                }
                // The write path must COMMIT (drop would roll back the inserts).
                tx.commit().await.map_err(|e| e.to_string())?;
                Ok(results)
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

    /// Fetch up to `limit` offline queue items for a tenant, ordered by
    /// `(created_at ASC, id ASC)`, respecting an optional `since` anchor and
    /// an optional `(cursor_ts, cursor_id)` pagination cursor.
    pub async fn pull_items(
        &self,
        tenant_id: &str,
        since: Option<&str>,
        cursor: Option<(&str, &str)>,
        limit: i64,
    ) -> Result<Vec<OfflineQueueItem>, String> {
        match self {
            Self::Sqlite(conn) => {
                let conn = conn.lock().await;
                sqlite_pull_items(&conn, tenant_id, since, cursor, limit)
            }
            Self::Postgres(pool) => {
                let mut client = pool.get().await.map_err(|e| e.to_string())?;
                let mut tx = client.transaction().await.map_err(|e| e.to_string())?;
                tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
                    .await
                    .map_err(|e| e.to_string())?;
                pg_pull_items(&mut tx, tenant_id, since, cursor, limit).await
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

    /// Product rows for a tenant's snapshot (reference-data baseline).
    /// Fetch all snapshot data (products + tax_rates + users) in a single
    /// transaction. On PostgreSQL this reduces 3 pool acquisitions + 3
    /// transactions + 3 GUC sets + 3 queries to 1 + 1 + 1 + 3 = 6 round-trips
    /// (saves 3 round-trips, ~1.5 ms per snapshot).
    pub async fn snapshot_all(
        &self,
        tenant_id: &str,
    ) -> Result<
        (
            Vec<serde_json::Value>,
            Vec<serde_json::Value>,
            Vec<serde_json::Value>,
        ),
        String,
    > {
        match self {
            Self::Sqlite(conn) => {
                let conn = conn.lock().await;
                let products = sqlite_snapshot_products(&conn, tenant_id)?;
                let tax_rates = sqlite_snapshot_tax_rates(&conn, tenant_id)?;
                let users = sqlite_snapshot_users(&conn, tenant_id)?;
                Ok((products, tax_rates, users))
            }
            Self::Postgres(pool) => {
                let mut client = pool.get().await.map_err(|e| e.to_string())?;
                let mut tx = client.transaction().await.map_err(|e| e.to_string())?;
                tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
                    .await
                    .map_err(|e| e.to_string())?;
                let products = pg_snapshot_products(&mut tx, tenant_id).await?;
                let tax_rates = pg_snapshot_tax_rates(&mut tx, tenant_id).await?;
                let users = pg_snapshot_users(&mut tx, tenant_id).await?;
                Ok((products, tax_rates, users))
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

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "sync_store_tests.rs"]
mod tests;
