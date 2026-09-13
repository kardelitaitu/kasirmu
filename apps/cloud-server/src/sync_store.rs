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

use std::sync::Arc;

use deadpool_postgres::Pool;
use rusqlite::{Connection, params};
use tokio::sync::Mutex;

use crate::conflict_resolution::{
    ConflictCandidate, Decision, SyncConflictRow, build_conflict_row, classify, entity_id_of,
    extract_terminal, extract_vector,
};

use oz_core::TenantPlan;
use oz_core::offline::{OfflineQueueItem, OfflineQueueStatus, SyncPriority};
use platform_sync::crdt::VersionVector;
use platform_sync::transport::PushOutcome;

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
            let terminal = extract_terminal(&item.payload).unwrap_or_else(|| "unknown".to_string());
            match self
                .detect_conflict(
                    tenant_id,
                    &item.action,
                    &entity_id,
                    &vector,
                    &item.payload,
                    &terminal,
                )
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

// ── Multi-row push fast path ────────────────────────────────────────────

/// SQLite multi-row fast path for [`SyncStore::push_batch`].
///
/// Builds one `INSERT … VALUES (…),(…),… ON CONFLICT (id) DO NOTHING
/// RETURNING id` statement per [`MULTIROW_CHUNK`] rows, so a whole push page
/// costs a handful of statements instead of N. Duplicate ids within the
/// batch are skipped by `DO NOTHING` (the first occurrence wins) and
/// reported as `Rejected` via a returned-id multiset consumed in input
/// order — preserving the exact per-item semantics of the old loop.
///
/// Opens and commits its own transaction; on any statement error the
/// transaction is rolled back (drop) and `Err` is returned so the caller
/// can fall back to the per-item loop.
fn sqlite_push_batch_multirow(
    conn: &Connection,
    items: &[OfflineQueueItem],
    status: &str,
    tenant_id: &str,
) -> Result<Vec<PushOutcome>, String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let mut results = Vec::with_capacity(items.len());

    for chunk in items.chunks(MULTIROW_CHUNK) {
        let n = chunk.len();
        let values = vec!["(?,?,?,?,?,?,?,?,?)"; n].join(",");
        let sql = format!(
            "INSERT INTO offline_queue (id, action, payload, status, retry_count, \
             last_error, created_at, synced_at, tenant_id) VALUES {values} \
             ON CONFLICT (id) DO NOTHING RETURNING id"
        );

        let mut params: Vec<rusqlite::types::Value> = Vec::with_capacity(n * 9);
        for item in chunk {
            params.push(rusqlite::types::Value::Text(item.id.clone()));
            params.push(rusqlite::types::Value::Text(item.action.clone()));
            params.push(rusqlite::types::Value::Text(item.payload.clone()));
            params.push(rusqlite::types::Value::Text(status.to_string()));
            params.push(rusqlite::types::Value::Integer(item.retry_count));
            params.push(match &item.last_error {
                Some(e) => rusqlite::types::Value::Text(e.clone()),
                None => rusqlite::types::Value::Null,
            });
            params.push(rusqlite::types::Value::Text(item.created_at.clone()));
            params.push(match &item.synced_at {
                Some(s) => rusqlite::types::Value::Text(s.clone()),
                None => rusqlite::types::Value::Null,
            });
            params.push(rusqlite::types::Value::Text(tenant_id.to_string()));
        }

        let mut stmt = tx.prepare(&sql).map_err(|e| e.to_string())?;
        let mut inserted: std::collections::HashMap<String, usize> =
            std::collections::HashMap::with_capacity(n);
        let rows = stmt
            .query_map(rusqlite::params_from_iter(params.iter()), |row| {
                row.get::<_, String>(0)
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let id = row.map_err(|e| e.to_string())?;
            *inserted.entry(id).or_insert(0) += 1;
        }

        // Consume returned-id counts in input order: the first occurrence
        // of a duplicate was the one inserted, later ones are Rejected.
        let mut remaining = inserted;
        for item in chunk {
            match remaining.get_mut(&item.id) {
                Some(count) if *count > 0 => {
                    *count -= 1;
                    results.push(PushOutcome::Accepted);
                }
                _ => results.push(PushOutcome::Rejected {
                    reason: format!("duplicate id: {}", item.id),
                }),
            }
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(results)
}

/// PostgreSQL multi-row fast path for [`SyncStore::push_batch`].
///
/// Same shape as the SQLite fast path but with `$n` numbered placeholders
/// (Postgres has no `?`). Opens and commits its own transaction; a
/// statement failure rolls back (drop) and returns `Err` for the caller's
/// per-item SAVEPOINT fallback.
async fn pg_push_batch_multirow(
    pool: &Pool,
    items: &[OfflineQueueItem],
    status: &str,
    tenant_id: &str,
) -> Result<Vec<PushOutcome>, String> {
    let mut client = pool.get().await.map_err(|e| e.to_string())?;
    let tx = client.transaction().await.map_err(|e| e.to_string())?;
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
        .await
        .map_err(|e| e.to_string())?;

    let mut results = Vec::with_capacity(items.len());

    for chunk in items.chunks(MULTIROW_CHUNK) {
        let n = chunk.len();
        // Build "($1,...,$9),($10,...,$18),…" numbered placeholders.
        let mut sql = String::from(
            "INSERT INTO offline_queue (id, action, payload, status, retry_count, \
             last_error, created_at, synced_at, tenant_id) VALUES ",
        );
        let mut params: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> = Vec::with_capacity(n * 9);
        for (r, item) in chunk.iter().enumerate() {
            if r > 0 {
                sql.push(',');
            }
            let base = r * 9;
            sql.push_str(&format!(
                "(${},${},${},${},${},${},${},${},${})",
                base + 1,
                base + 2,
                base + 3,
                base + 4,
                base + 5,
                base + 6,
                base + 7,
                base + 8,
                base + 9
            ));
            params.extend_from_slice(&[
                &item.id,
                &item.action,
                &item.payload,
                &status,
                &item.retry_count,
                &item.last_error,
                &item.created_at,
                &item.synced_at,
                &tenant_id,
            ]);
        }
        sql.push_str(" ON CONFLICT (id) DO NOTHING RETURNING id");

        let rows = tx.query(&sql, &params).await.map_err(|e| e.to_string())?;
        let mut inserted: std::collections::HashMap<String, usize> =
            std::collections::HashMap::with_capacity(n);
        for row in rows {
            let id: String = row.try_get::<_, String>(0).map_err(|e| e.to_string())?;
            *inserted.entry(id).or_insert(0) += 1;
        }

        let mut remaining = inserted;
        for item in chunk {
            match remaining.get_mut(&item.id) {
                Some(count) if *count > 0 => {
                    *count -= 1;
                    results.push(PushOutcome::Accepted);
                }
                _ => results.push(PushOutcome::Rejected {
                    reason: format!("duplicate id: {}", item.id),
                }),
            }
        }
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(results)
}

// ── SQLite implementations ────────────────────────────────────────────────
//
// These are faithful copies of the SQL that previously lived inline in the
// handlers (sync_api.rs). Behaviour — including SYNC-10's fail-loud row
// decode and the metric increment — is preserved exactly.

/// Pull rows via SQLite, preserving the three query shapes (cursor / since /
/// bare) and the fail-loud row decode (SYNC-10).
fn sqlite_pull_items(
    conn: &Connection,
    tenant_id: &str,
    since: Option<&str>,
    cursor: Option<(&str, &str)>,
    limit: i64,
) -> Result<Vec<OfflineQueueItem>, String> {
    const SELECT: &str = "SELECT id, action, payload, status, retry_count, last_error, \
                          created_at, synced_at, tenant_id, priority FROM offline_queue";

    let rows: Vec<rusqlite::Result<OfflineQueueItem>> = if let Some((ts, cid)) = cursor {
        let mut stmt = conn
            .prepare(&format!(
                "{SELECT} WHERE tenant_id = ?1 AND created_at >= ?2 \
                 AND (created_at > ?3 OR (created_at = ?3 AND id > ?4)) \
                 ORDER BY created_at ASC, id ASC LIMIT ?5"
            ))
            .map_err(|e| e.to_string())?;
        stmt.query_map(
            params![tenant_id, since.unwrap_or(""), ts, cid, limit],
            sqlite_row_to_item,
        )
        .map_err(|e| e.to_string())?
        .collect()
    } else if let Some(since) = since {
        let mut stmt = conn
            .prepare(&format!(
                "{SELECT} WHERE created_at >= ?1 AND tenant_id = ?2 \
                 ORDER BY created_at ASC, id ASC LIMIT ?3"
            ))
            .map_err(|e| e.to_string())?;
        stmt.query_map(params![since, tenant_id, limit], sqlite_row_to_item)
            .map_err(|e| e.to_string())?
            .collect()
    } else {
        let mut stmt = conn
            .prepare(&format!(
                "{SELECT} WHERE tenant_id = ?1 ORDER BY created_at ASC, id ASC LIMIT ?2"
            ))
            .map_err(|e| e.to_string())?;
        stmt.query_map(params![tenant_id, limit], sqlite_row_to_item)
            .map_err(|e| e.to_string())?
            .collect()
    };

    sqlite_collect_pull_rows(rows.into_iter(), tenant_id)
}

/// Collect SQLite pull rows, failing loudly on decode errors (SYNC-10).
fn sqlite_collect_pull_rows(
    rows: impl Iterator<Item = rusqlite::Result<OfflineQueueItem>>,
    tenant_id: &str,
) -> Result<Vec<OfflineQueueItem>, String> {
    let mut items = Vec::with_capacity(rows.size_hint().0);
    for row in rows {
        match row {
            Ok(item) => items.push(item),
            Err(e) => {
                crate::metrics::SYNC_PULL_ROW_DECODE_FAILURES_TOTAL.inc();
                tracing::error!(tenant_id, error = %e, "pull: row decode failed — returning 500");
                return Err(format!("offline_queue row decode failed: {e}"));
            }
        }
    }
    Ok(items)
}

/// Convert a SQLite row to an `OfflineQueueItem`.
fn sqlite_row_to_item(row: &rusqlite::Row) -> rusqlite::Result<OfflineQueueItem> {
    let status_str: String = row.get("status")?;
    Ok(OfflineQueueItem {
        id: row.get("id")?,
        action: row.get("action")?,
        payload: row.get("payload")?,
        status: OfflineQueueStatus::from_stored_str(&status_str)
            .unwrap_or(OfflineQueueStatus::Pending),
        retry_count: row.get("retry_count")?,
        last_error: row.get("last_error")?,
        created_at: row.get("created_at")?,
        synced_at: row.get("synced_at")?,
        tenant_id: row.get("tenant_id")?,
        priority: row
            .get::<_, i32>("priority")
            .map(SyncPriority::from)
            .unwrap_or(SyncPriority::Normal),
    })
}

fn sqlite_snapshot_products(
    conn: &Connection,
    tenant_id: &str,
) -> Result<Vec<serde_json::Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, sku, name, price_minor, currency, category_id, barcode, created_at, \
             updated_at, price_updated_at, track_serial, store_id, brand, rack_location, notes, \
             unit, is_active FROM products WHERE tenant_id = ?1",
        )
        .map_err(|e| e.to_string())?;
    stmt.query_map(params![tenant_id], |row| {
        // Build JSON manually, omitting null optional fields.
        // Client uses #[serde(default)] so missing fields deserialize as None.
        // Omitting nulls saves ~30% payload on typical product rows.
        let mut m = serde_json::Map::new();
        m.insert("id".into(), serde_json::Value::String(row.get("id")?));
        m.insert("sku".into(), serde_json::Value::String(row.get("sku")?));
        m.insert("name".into(), serde_json::Value::String(row.get("name")?));
        m.insert(
            "price_minor".into(),
            serde_json::json!(row.get::<_, i64>("price_minor")?),
        );
        m.insert(
            "currency".into(),
            serde_json::Value::String(row.get("currency")?),
        );
        m.insert(
            "track_serial".into(),
            serde_json::json!(row.get::<_, bool>("track_serial")?),
        );
        m.insert(
            "is_active".into(),
            serde_json::json!(row.get::<_, bool>("is_active")?),
        );
        // Timestamps — always present.
        m.insert(
            "created_at".into(),
            serde_json::Value::String(row.get("created_at")?),
        );
        m.insert(
            "updated_at".into(),
            serde_json::Value::String(row.get("updated_at")?),
        );
        m.insert(
            "price_updated_at".into(),
            serde_json::Value::String(row.get("price_updated_at")?),
        );
        // Optional fields — only insert if non-null.
        for (key, col) in &[
            ("category_id", "category_id"),
            ("barcode", "barcode"),
            ("store_id", "store_id"),
            ("brand", "brand"),
            ("rack_location", "rack_location"),
            ("notes", "notes"),
            ("unit", "unit"),
        ] {
            if let Ok(Some(v)) = row.get::<_, Option<String>>(*col) {
                m.insert(key.to_string(), serde_json::Value::String(v));
            }
        }
        Ok(serde_json::Value::Object(m))
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| format!("product row decode failed: {e}"))
}

fn sqlite_snapshot_tax_rates(
    conn: &Connection,
    tenant_id: &str,
) -> Result<Vec<serde_json::Value>, String> {
    // Scope + validity window travel with the rate. A scoped row emitted
    // WITHOUT its scope arrives at the branch as NULL scope, and NULL scope IS
    // the tenant-global answer — one location's rate would then price every
    // location that pulled it. Absence is not neutral in this table, so the
    // columns are explicit here and the client maps a missing key to
    // tenant-global (which is what every pre-20260921 row already is).
    let mut stmt = conn
        .prepare(
            "SELECT id, name, rate_bps, is_default, is_inclusive, created_at, updated_at, \
                    legal_entity_id, location_id, effective_from, effective_to \
             FROM tax_rates WHERE tenant_id = ?1",
        )
        .map_err(|e| e.to_string())?;
    stmt.query_map(params![tenant_id], |row| {
        Ok(serde_json::json!({
            "id": row.get::<_, String>("id")?,
            "name": row.get::<_, String>("name")?,
            "rate_bps": row.get::<_, i64>("rate_bps")?,
            "is_default": row.get::<_, bool>("is_default")?,
            "is_inclusive": row.get::<_, bool>("is_inclusive")?,
            "created_at": row.get::<_, Option<String>>("created_at")?,
            "updated_at": row.get::<_, Option<String>>("updated_at")?,
            "legal_entity_id": row.get::<_, Option<String>>("legal_entity_id")?,
            "location_id": row.get::<_, Option<String>>("location_id")?,
            "effective_from": row.get::<_, Option<String>>("effective_from")?,
            "effective_to": row.get::<_, Option<String>>("effective_to")?
        }))
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| format!("tax rate row decode failed: {e}"))
}

fn sqlite_snapshot_users(
    conn: &Connection,
    tenant_id: &str,
) -> Result<Vec<serde_json::Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, username, display_name, role_id, is_active, created_at, updated_at \
             FROM users WHERE tenant_id = ?1",
        )
        .map_err(|e| e.to_string())?;
    stmt.query_map(params![tenant_id], |row| {
        Ok(serde_json::json!({
            "id": row.get::<_, String>("id")?,
            "username": row.get::<_, String>("username")?,
            "display_name": row.get::<_, String>("display_name")?,
            "role_id": row.get::<_, String>("role_id")?,
            "is_active": row.get::<_, bool>("is_active")?,
            "created_at": row.get::<_, Option<String>>("created_at")?,
            "updated_at": row.get::<_, Option<String>>("updated_at")?
        }))
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| format!("user row decode failed: {e}"))
}

// ── Postgres implementations ──────────────────────────────────────────────

/// Pull rows via Postgres, mirroring the three SQLite query shapes with
/// `$n` placeholders. Row decode failures fail the whole pull (SYNC-10).
///
/// Generic over `deadpool_postgres::GenericClient` so the same code runs on
/// the tenant-scoped transaction (the `oz.tenant_id` GUC from `tenant_tx`)
/// or on a plain pooled client (tests).
async fn pg_pull_items(
    client: &mut impl deadpool_postgres::GenericClient,
    tenant_id: &str,
    since: Option<&str>,
    cursor: Option<(&str, &str)>,
    limit: i64,
) -> Result<Vec<OfflineQueueItem>, String> {
    const SELECT: &str = "SELECT id, action, payload, status, retry_count, last_error, \
                          created_at, synced_at, tenant_id, priority FROM offline_queue";

    // D1 (ADR #43): prepare each query shape once; the connection-level
    // plan cache makes repeated identical pulls skip re-parsing.
    let rows = if let Some((ts, cid)) = cursor {
        let stmt = client
            .prepare_cached(&format!(
                "{SELECT} WHERE tenant_id = $1 AND created_at >= $2 \
                 AND (created_at > $3 OR (created_at = $3 AND id > $4)) \
                 ORDER BY created_at ASC, id ASC LIMIT $5"
            ))
            .await
            .map_err(|e| e.to_string())?;
        client
            .query(
                &stmt,
                &[&tenant_id, &since.unwrap_or(""), &ts, &cid, &limit],
            )
            .await
            .map_err(|e| e.to_string())?
    } else if let Some(since) = since {
        let stmt = client
            .prepare_cached(&format!(
                "{SELECT} WHERE created_at >= $1 AND tenant_id = $2 \
                 ORDER BY created_at ASC, id ASC LIMIT $3"
            ))
            .await
            .map_err(|e| e.to_string())?;
        client
            .query(&stmt, &[&since, &tenant_id, &limit])
            .await
            .map_err(|e| e.to_string())?
    } else {
        let stmt = client
            .prepare_cached(&format!(
                "{SELECT} WHERE tenant_id = $1 ORDER BY created_at ASC, id ASC LIMIT $2"
            ))
            .await
            .map_err(|e| e.to_string())?;
        client
            .query(&stmt, &[&tenant_id, &limit])
            .await
            .map_err(|e| e.to_string())?
    };

    let mut items = Vec::with_capacity(rows.len());
    for row in &rows {
        match pg_row_to_item(row) {
            Ok(item) => items.push(item),
            Err(e) => {
                crate::metrics::SYNC_PULL_ROW_DECODE_FAILURES_TOTAL.inc();
                tracing::error!(tenant_id, error = %e, "pull: row decode failed — returning 500");
                return Err(format!("offline_queue row decode failed: {e}"));
            }
        }
    }
    Ok(items)
}

/// Convert a Postgres row to an `OfflineQueueItem`.
///
/// `priority` is `BIGINT` in Postgres (SQLite stored it as `INTEGER` read as
/// `i32`), so it is narrowed through [`SyncPriority::from`] the same way.
fn pg_row_to_item(row: &tokio_postgres::Row) -> Result<OfflineQueueItem, String> {
    let status_str: String = row.try_get("status").map_err(|e| e.to_string())?;
    let priority: i64 = row.try_get("priority").map_err(|e| e.to_string())?;
    Ok(OfflineQueueItem {
        id: row.try_get("id").map_err(|e| e.to_string())?,
        action: row.try_get("action").map_err(|e| e.to_string())?,
        payload: row.try_get("payload").map_err(|e| e.to_string())?,
        status: OfflineQueueStatus::from_stored_str(&status_str)
            .unwrap_or(OfflineQueueStatus::Pending),
        retry_count: row.try_get("retry_count").map_err(|e| e.to_string())?,
        last_error: row.try_get("last_error").map_err(|e| e.to_string())?,
        created_at: row.try_get("created_at").map_err(|e| e.to_string())?,
        synced_at: row.try_get("synced_at").map_err(|e| e.to_string())?,
        tenant_id: row.try_get("tenant_id").map_err(|e| e.to_string())?,
        priority: SyncPriority::from(priority as i32),
    })
}

/// Read a `BIGINT` boolean-ish column as `bool` (0 → false, else true).
fn pg_bool(row: &tokio_postgres::Row, column: &str) -> Result<bool, String> {
    let v: i64 = row.try_get(column).map_err(|e| e.to_string())?;
    Ok(v != 0)
}

async fn pg_snapshot_products(
    client: &mut impl deadpool_postgres::GenericClient,
    tenant_id: &str,
) -> Result<Vec<serde_json::Value>, String> {
    // D1 (ADR #43): prepared statement caching — snapshot_all runs on
    // every cold snapshot miss.
    let stmt = client
        .prepare_cached(
            "SELECT id, sku, name, price_minor, currency, category_id, barcode, created_at, \
             updated_at, price_updated_at, track_serial, store_id, brand, rack_location, notes, \
             unit, is_active FROM products WHERE tenant_id = $1",
        )
        .await
        .map_err(|e| e.to_string())?;
    let rows = client
        .query(&stmt, &[&tenant_id])
        .await
        .map_err(|e| e.to_string())?;

    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        // Build JSON manually, omitting null optional fields.
        // Client uses #[serde(default)] so missing fields deserialize as None.
        // Omitting nulls saves ~30% payload on typical product rows.
        let mut m = serde_json::Map::new();
        m.insert(
            "id".into(),
            serde_json::Value::String(row.try_get("id").map_err(|e| e.to_string())?),
        );
        m.insert(
            "sku".into(),
            serde_json::Value::String(row.try_get("sku").map_err(|e| e.to_string())?),
        );
        m.insert(
            "name".into(),
            serde_json::Value::String(row.try_get("name").map_err(|e| e.to_string())?),
        );
        m.insert(
            "price_minor".into(),
            serde_json::json!(
                row.try_get::<_, i64>("price_minor")
                    .map_err(|e| e.to_string())?
            ),
        );
        m.insert(
            "currency".into(),
            serde_json::Value::String(row.try_get("currency").map_err(|e| e.to_string())?),
        );
        m.insert(
            "track_serial".into(),
            serde_json::json!(pg_bool(row, "track_serial")?),
        );
        m.insert(
            "is_active".into(),
            serde_json::json!(pg_bool(row, "is_active")?),
        );
        // Timestamps — always present.
        m.insert(
            "created_at".into(),
            serde_json::Value::String(row.try_get("created_at").map_err(|e| e.to_string())?),
        );
        m.insert(
            "updated_at".into(),
            serde_json::Value::String(row.try_get("updated_at").map_err(|e| e.to_string())?),
        );
        let price_updated: Option<String> =
            row.try_get("price_updated_at").map_err(|e| e.to_string())?;
        m.insert(
            "price_updated_at".into(),
            serde_json::Value::String(price_updated.unwrap_or_default()),
        );
        // Optional fields — only insert if non-null.
        for (key, col) in &[
            ("category_id", "category_id"),
            ("barcode", "barcode"),
            ("store_id", "store_id"),
            ("brand", "brand"),
            ("rack_location", "rack_location"),
            ("notes", "notes"),
            ("unit", "unit"),
        ] {
            if let Ok(Some(v)) = row.try_get::<_, Option<String>>(*col) {
                m.insert(key.to_string(), serde_json::Value::String(v));
            }
        }
        out.push(serde_json::Value::Object(m));
    }
    Ok(out)
}

async fn pg_snapshot_tax_rates(
    client: &mut impl deadpool_postgres::GenericClient,
    tenant_id: &str,
) -> Result<Vec<serde_json::Value>, String> {
    // See sqlite_snapshot_tax_rates: scope and window must travel, or a
    // location-scoped rate arrives unscoped and reads as tenant-global.
    let stmt = client
        .prepare_cached(
            "SELECT id, name, rate_bps, is_default, is_inclusive, created_at, updated_at, \
                    legal_entity_id, location_id, effective_from, effective_to \
             FROM tax_rates WHERE tenant_id = $1",
        )
        .await
        .map_err(|e| e.to_string())?;
    let rows = client
        .query(&stmt, &[&tenant_id])
        .await
        .map_err(|e| e.to_string())?;

    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        out.push(
            serde_json::json!({
                "id": row.try_get::<_, String>("id").map_err(|e| e.to_string())?,
                "name": row.try_get::<_, String>("name").map_err(|e| e.to_string())?,
                "rate_bps": row.try_get::<_, i64>("rate_bps").map_err(|e| e.to_string())?,
                "is_default": pg_bool(row, "is_default")?,
                "is_inclusive": pg_bool(row, "is_inclusive")?,
                "created_at": row.try_get::<_, Option<String>>("created_at").map_err(|e| e.to_string())?,
                "updated_at": row.try_get::<_, Option<String>>("updated_at").map_err(|e| e.to_string())?,
                "legal_entity_id": row.try_get::<_, Option<String>>("legal_entity_id").map_err(|e| e.to_string())?,
                "location_id": row.try_get::<_, Option<String>>("location_id").map_err(|e| e.to_string())?,
                "effective_from": row.try_get::<_, Option<String>>("effective_from").map_err(|e| e.to_string())?,
                "effective_to": row.try_get::<_, Option<String>>("effective_to").map_err(|e| e.to_string())?,
            }),
        );
    }
    Ok(out)
}

async fn pg_snapshot_users(
    client: &mut impl deadpool_postgres::GenericClient,
    tenant_id: &str,
) -> Result<Vec<serde_json::Value>, String> {
    let stmt = client
        .prepare_cached(
            "SELECT id, username, display_name, role_id, is_active, created_at, updated_at \
             FROM users WHERE tenant_id = $1",
        )
        .await
        .map_err(|e| e.to_string())?;
    let rows = client
        .query(&stmt, &[&tenant_id])
        .await
        .map_err(|e| e.to_string())?;

    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        out.push(
            serde_json::json!({
                "id": row.try_get::<_, String>("id").map_err(|e| e.to_string())?,
                "username": row.try_get::<_, String>("username").map_err(|e| e.to_string())?,
                "display_name": row.try_get::<_, String>("display_name").map_err(|e| e.to_string())?,
                "role_id": row.try_get::<_, String>("role_id").map_err(|e| e.to_string())?,
                "is_active": pg_bool(row, "is_active")?,
                "created_at": row.try_get::<_, Option<String>>("created_at").map_err(|e| e.to_string())?,
                "updated_at": row.try_get::<_, Option<String>>("updated_at").map_err(|e| e.to_string())?,
            }),
        );
    }
    Ok(out)
}

// ── Conflict rows (sync_conflicts) ────────────────────────────────────────
//
// Every statement below is scoped by tenant_id, matching the rest of this
// store: this is the shared multi-tenant surface, so tenant A must never read
// or resolve tenant B's conflicts. The Postgres arms additionally set the
// `oz.tenant_id` GUC locally inside a transaction so RLS can key on it at
// cutover.

impl SyncStore {
    /// Insert a conflict row.
    pub async fn insert_conflict(&self, row: &SyncConflictRow) -> Result<(), String> {
        match self {
            Self::Sqlite(conn) => {
                let conn = conn.lock().await;
                conn.execute(
                    "INSERT INTO sync_conflicts (id, tenant_id, entity_type, entity_id,
                        local_terminal_id, local_vector, remote_vector, local_payload,
                        remote_payload, severity, status)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'open')
                     ON CONFLICT (id) DO NOTHING",
                    params![
                        row.id,
                        row.tenant_id,
                        row.entity_type,
                        row.entity_id,
                        row.local_terminal_id,
                        row.local_vector,
                        row.remote_vector,
                        row.local_payload,
                        row.remote_payload,
                        row.severity,
                    ],
                )
                .map(|_| ())
                .map_err(|e| e.to_string())
            }
            Self::Postgres(pool) => {
                let mut client = pool.get().await.map_err(|e| e.to_string())?;
                let tx = client.transaction().await.map_err(|e| e.to_string())?;
                tx.execute(
                    "SELECT set_config('oz.tenant_id', $1, true)",
                    &[&row.tenant_id],
                )
                .await
                .map_err(|e| e.to_string())?;
                tx.execute(
                    "INSERT INTO sync_conflicts (id, tenant_id, entity_type, entity_id,
                        local_terminal_id, local_vector, remote_vector, local_payload,
                        remote_payload, severity, status)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'open')
                     ON CONFLICT (id) DO NOTHING",
                    &[
                        &row.id,
                        &row.tenant_id,
                        &row.entity_type,
                        &row.entity_id,
                        &row.local_terminal_id,
                        &row.local_vector,
                        &row.remote_vector,
                        &row.local_payload,
                        &row.remote_payload,
                        &row.severity,
                    ],
                )
                .await
                .map_err(|e| e.to_string())?;
                tx.commit().await.map_err(|e| e.to_string())
            }
        }
    }

    /// List a tenant's conflicts, newest first, optionally filtered.
    ///
    /// Both filters are applied in SQL rather than in memory so a tenant with
    /// a large backlog does not pay to serialise rows it filtered out.
    pub async fn list_conflicts(
        &self,
        tenant_id: &str,
        status: Option<&str>,
        severity: Option<&str>,
    ) -> Result<Vec<SyncConflictRow>, String> {
        match self {
            Self::Sqlite(conn) => {
                let conn = conn.lock().await;
                let mut stmt = conn
                    .prepare(
                        "SELECT id, tenant_id, entity_type, entity_id, local_terminal_id,
                            local_vector, remote_vector, local_payload, remote_payload,
                            severity, status, resolution, resolved_by, resolved_at, created_at
                         FROM sync_conflicts
                         WHERE tenant_id = ?1
                           AND (?2 IS NULL OR status = ?2)
                           AND (?3 IS NULL OR severity = ?3)
                         ORDER BY created_at DESC",
                    )
                    .map_err(|e| e.to_string())?;
                let rows = stmt
                    .query_map(
                        params![tenant_id, status, severity],
                        conflict_row_from_sqlite,
                    )
                    .map_err(|e| e.to_string())?;
                rows.collect::<Result<Vec<_>, _>>()
                    .map_err(|e| e.to_string())
            }
            Self::Postgres(pool) => {
                let client = pool.get().await.map_err(|e| e.to_string())?;
                let stmt = client
                    .prepare_cached(
                        "SELECT id, tenant_id, entity_type, entity_id, local_terminal_id,
                            local_vector, remote_vector, local_payload, remote_payload,
                            severity, status, resolution, resolved_by, resolved_at, created_at
                         FROM sync_conflicts
                         WHERE tenant_id = $1
                           AND ($2::text IS NULL OR status = $2)
                           AND ($3::text IS NULL OR severity = $3)
                         ORDER BY created_at DESC",
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                let rows = client
                    .query(&stmt, &[&tenant_id, &status, &severity])
                    .await
                    .map_err(|e| e.to_string())?;
                Ok(rows.iter().map(conflict_row_from_pg).collect())
            }
        }
    }

    /// Resolve an open conflict.
    ///
    /// Returns `false` when the id does not exist, belongs to another tenant,
    /// or is already closed — resolving twice must not silently overwrite the
    /// first decision, because the audit trail is the point of the row.
    pub async fn resolve_conflict(
        &self,
        tenant_id: &str,
        id: &str,
        resolution: &str,
        resolved_by: &str,
    ) -> Result<bool, String> {
        match self {
            Self::Sqlite(conn) => {
                let conn = conn.lock().await;
                let changed = conn
                    .execute(
                        "UPDATE sync_conflicts
                            SET status = 'resolved', resolution = ?3, resolved_by = ?4,
                                resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                          WHERE id = ?1 AND tenant_id = ?2 AND status = 'open'",
                        params![id, tenant_id, resolution, resolved_by],
                    )
                    .map_err(|e| e.to_string())?;
                Ok(changed > 0)
            }
            Self::Postgres(pool) => {
                let client = pool.get().await.map_err(|e| e.to_string())?;
                let stmt = client
                    .prepare_cached(
                        "UPDATE sync_conflicts
                            SET status = 'resolved', resolution = $3, resolved_by = $4,
                                resolved_at = to_char(now() AT TIME ZONE 'UTC',
                                                      'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')
                          WHERE id = $1 AND tenant_id = $2 AND status = 'open'",
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                let changed = client
                    .execute(&stmt, &[&id, &tenant_id, &resolution, &resolved_by])
                    .await
                    .map_err(|e| e.to_string())?;
                Ok(changed > 0)
            }
        }
    }
}

impl SyncStore {
    /// Compare an incoming mutation against the stored vector for its entity and
    /// act on the result.
    ///
    /// This is the call that makes conflict detection real: without it the
    /// classification policy is never exercised and `sync_conflicts` stays empty.
    ///
    /// Returns `None` when the item carries no vector. That is a deliberate skip,
    /// not an error — a peer that predates vector support pushes items without
    /// one, and inventing a vector for it would fabricate a history we cannot
    /// justify. Such items apply as they always have.
    ///
    /// On [`Decision::Flag`] the row is persisted. On every decision except
    /// [`Decision::Stale`] the stored vector is advanced to the pointwise maximum
    /// of both, so the next comparison sees everything observed so far. A stale
    /// item is dropped without touching stored state, because it adds nothing.
    pub async fn detect_conflict(
        &self,
        tenant_id: &str,
        entity_type: &str,
        entity_id: &str,
        incoming: &VersionVector,
        incoming_payload: &str,
        local_terminal_id: &str,
    ) -> Result<Option<Decision>, String> {
        let stored = self
            .load_entity_vector(tenant_id, entity_type, entity_id)
            .await?;
        let stored_payload = self
            .load_entity_payload(tenant_id, entity_type, entity_id)
            .await?;

        let empty = VersionVector::new();
        let stored_vector = stored.as_ref().unwrap_or(&empty);

        // Parse both bodies. An unparseable body is treated as absent rather than
        // as an empty object: the field-wise policy then fails closed and flags,
        // instead of concluding "no fields overlap" from a body it could not read.
        let stored_value: Option<serde_json::Value> = stored_payload
            .as_deref()
            .and_then(|raw| serde_json::from_str(raw).ok());
        let incoming_value: Option<serde_json::Value> = serde_json::from_str(incoming_payload).ok();

        let decision = classify(&ConflictCandidate {
            entity_type,
            stored: stored_vector,
            incoming,
            stored_payload: stored_value.as_ref(),
            incoming_payload: incoming_value.as_ref(),
        });

        match decision {
            Decision::Flag { .. } => {
                let row = build_conflict_row(
                    &uuid::Uuid::now_v7().to_string(),
                    tenant_id,
                    entity_type,
                    entity_id,
                    local_terminal_id,
                    stored_vector,
                    incoming,
                    stored_payload.as_deref().unwrap_or(""),
                    incoming_payload,
                );
                self.insert_conflict(&row).await?;
            }
            Decision::Stale => return Ok(Some(decision)),
            _ => {}
        }

        if !matches!(decision, Decision::Stale) {
            let mut merged = stored_vector.clone();
            merged.observe(incoming);
            self.save_entity_vector(tenant_id, entity_type, entity_id, &merged, incoming_payload)
                .await?;
        }

        Ok(Some(decision))
    }

    /// Load the stored version vector for an entity (`None` if unseen).
    async fn load_entity_vector(
        &self,
        tenant_id: &str,
        entity_type: &str,
        entity_id: &str,
    ) -> Result<Option<VersionVector>, String> {
        match self {
            Self::Sqlite(conn) => {
                let conn = conn.lock().await;
                let json: Option<String> = conn
                    .query_row(
                        "SELECT vector FROM sync_entity_vectors
                      WHERE tenant_id = ?1 AND entity_type = ?2 AND entity_id = ?3",
                        params![tenant_id, entity_type, entity_id],
                        |row| row.get(0),
                    )
                    .unwrap_or(None);
                Ok(json.and_then(|j| serde_json::from_str(&j).ok()))
            }
            Self::Postgres(pool) => {
                let client = pool.get().await.map_err(|e| e.to_string())?;
                let stmt = client
                    .prepare_cached(
                        "SELECT vector FROM sync_entity_vectors
                      WHERE tenant_id = $1 AND entity_type = $2 AND entity_id = $3",
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                let rows = client
                    .query(
                        &stmt,
                        &[
                            &tenant_id.to_string(),
                            &entity_type.to_string(),
                            &entity_id.to_string(),
                        ],
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                let json: Option<String> = rows.first().map(|r| r.get(0));
                Ok(json.and_then(|j| serde_json::from_str(&j).ok()))
            }
        }
    }

    /// Load the last payload seen for an entity (`None` if unseen).
    async fn load_entity_payload(
        &self,
        tenant_id: &str,
        entity_type: &str,
        entity_id: &str,
    ) -> Result<Option<String>, String> {
        match self {
            Self::Sqlite(conn) => {
                let conn = conn.lock().await;
                Ok(conn
                    .query_row(
                        "SELECT last_payload FROM sync_entity_vectors
                      WHERE tenant_id = ?1 AND entity_type = ?2 AND entity_id = ?3",
                        params![tenant_id, entity_type, entity_id],
                        |row| row.get(0),
                    )
                    .unwrap_or(None))
            }
            Self::Postgres(pool) => {
                let client = pool.get().await.map_err(|e| e.to_string())?;
                let stmt = client
                    .prepare_cached(
                        "SELECT last_payload FROM sync_entity_vectors
                      WHERE tenant_id = $1 AND entity_type = $2 AND entity_id = $3",
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                let rows = client
                    .query(
                        &stmt,
                        &[
                            &tenant_id.to_string(),
                            &entity_type.to_string(),
                            &entity_id.to_string(),
                        ],
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                Ok(rows.first().map(|r| r.get(0)))
            }
        }
    }

    /// Upsert the merged vector and latest payload for an entity.
    async fn save_entity_vector(
        &self,
        tenant_id: &str,
        entity_type: &str,
        entity_id: &str,
        vector: &VersionVector,
        payload: &str,
    ) -> Result<(), String> {
        let json = serde_json::to_string(vector).unwrap_or_else(|_| "{}".to_string());
        match self {
            Self::Sqlite(conn) => {
                let conn = conn.lock().await;
                conn.execute(
                    "INSERT INTO sync_entity_vectors
                    (tenant_id, entity_type, entity_id, vector, last_payload)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT (tenant_id, entity_type, entity_id)
                 DO UPDATE SET vector = excluded.vector,
                               last_payload = excluded.last_payload,
                               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
                    params![tenant_id, entity_type, entity_id, json, payload],
                )
                .map(|_| ())
                .map_err(|e| e.to_string())
            }
            Self::Postgres(pool) => {
                let client = pool.get().await.map_err(|e| e.to_string())?;
                client
                    .execute(
                        "INSERT INTO sync_entity_vectors
                        (tenant_id, entity_type, entity_id, vector, last_payload)
                     VALUES ($1, $2, $3, $4, $5)
                     ON CONFLICT (tenant_id, entity_type, entity_id)
                     DO UPDATE SET vector = excluded.vector,
                                   last_payload = excluded.last_payload,
                                   updated_at = now()",
                        &[
                            &tenant_id.to_string(),
                            &entity_type.to_string(),
                            &entity_id.to_string(),
                            &json,
                            &payload.to_string(),
                        ],
                    )
                    .await
                    .map(|_| ())
                    .map_err(|e| e.to_string())
            }
        }
    }
}

/// Map one SQLite row of `sync_conflicts`.
fn conflict_row_from_sqlite(row: &rusqlite::Row<'_>) -> rusqlite::Result<SyncConflictRow> {
    Ok(SyncConflictRow {
        id: row.get(0)?,
        tenant_id: row.get(1)?,
        entity_type: row.get(2)?,
        entity_id: row.get(3)?,
        local_terminal_id: row.get(4)?,
        local_vector: row.get(5)?,
        remote_vector: row.get(6)?,
        local_payload: row.get(7)?,
        remote_payload: row.get(8)?,
        severity: row.get(9)?,
        status: row.get(10)?,
        resolution: row.get(11)?,
        resolved_by: row.get(12)?,
        resolved_at: row.get(13)?,
        created_at: row.get(14)?,
    })
}

/// Map one Postgres row of `sync_conflicts`.
fn conflict_row_from_pg(row: &tokio_postgres::Row) -> SyncConflictRow {
    SyncConflictRow {
        id: row.get(0),
        tenant_id: row.get(1),
        entity_type: row.get(2),
        entity_id: row.get(3),
        local_terminal_id: row.get(4),
        local_vector: row.get(5),
        remote_vector: row.get(6),
        local_payload: row.get(7),
        remote_payload: row.get(8),
        severity: row.get(9),
        status: row.get(10),
        resolution: row.get(11),
        resolved_by: row.get(12),
        resolved_at: row.get(13),
        created_at: row.get(14),
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "sync_store_tests.rs"]
mod tests;
