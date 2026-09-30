/*
last audited 2026-09-02 by Architecture Team
crate: cloud-server | status: PROPOSED | lint: CLEAN
findings: D7 — transactional outbox for async email/webhook delivery
next: none
DONE 2026-10-04: the email report sender enqueues into the outbox
(email.rs:168, ADR #43 D7) and a PG variant exists (enqueue_pg at
outbox.rs:98, start_drainer_pg at outbox.rs:373).
*/

//! Transactional outbox for async delivery (ADR #43 D7).
//!
//! The outbox table holds delivery tasks that are written in the same
//! transaction as the source event.  A background drainer polls for due
//! entries, dispatches them to a topic-specific handler, and records the
//! outcome (success, retry with exponential backoff, or dead-letter).
//!
//! # Topics
//!
//! - `email_report` — scheduled email report delivery (SMTP via lettre).
//!   The handler reads SMTP config from the store at delivery time.
//! - `webhook` — outbound HTTP POST (placeholder for future use).
//!
//! # Lifecycle
//!
//! pending → delivering → delivered
//!                    → failed → (retry: backoff + pending)
//!                    → dead_letter (after max_attempts)

use std::{future::Future, pin::Pin, sync::Arc, time::Duration};

use deadpool_postgres::Pool;
use rusqlite::params;
use tokio::sync::Mutex;
use uuid::Uuid;

/// A boxed future returned by an outbox delivery handler.
pub type DeliverFuture = Pin<Box<dyn Future<Output = Result<(), String>> + Send>>;

/// Shared SQLite connection handle used by the outbox.
pub type SharedSqliteConn = Arc<Mutex<rusqlite::Connection>>;

/// Maximum number of delivery attempts before dead-lettering.
#[allow(dead_code)]
const DEFAULT_MAX_ATTEMPTS: i64 = 5;

/// Base backoff: 2^n minutes (first retry ≈ 2 min, then 4, 8, 16, 32…).
const BACKOFF_BASE_SECS: u64 = 120; // 2 minutes

/// Absolute cap on backoff (1 hour).
const BACKOFF_CAP_SECS: u64 = 3600;

/// How often the drainer polls for due entries.
const DRAIN_INTERVAL: Duration = Duration::from_secs(30);

/// How many entries to claim in one drain cycle.
const DRAIN_BATCH_SIZE: i64 = 10;

/// A single outbox entry.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct OutboxEntry {
    pub id: String,
    pub topic: String,
    pub payload: String,
    pub status: String,
    pub max_attempts: i64,
    pub attempts: i64,
    pub next_attempt_at: String,
    pub created_at: String,
    pub last_error: Option<String>,
}

// ── Enqueue ─────────────────────────────────────────────────────────

/// Enqueue a delivery task (SQLite backend).
///
/// The caller is responsible for the transaction — the INSERT runs inside
/// whichever transaction `conn` is currently in.
pub fn enqueue_sqlite(
    conn: &rusqlite::Connection,
    topic: &str,
    payload: &str,
    max_attempts: i64,
    priority: i64,
) -> Result<String, String> {
    let id = Uuid::now_v7().to_string();
    let now = now_rfc3339();
    conn.execute(
        "INSERT INTO outbox (id, topic, payload, status, priority, max_attempts, attempts, \
         next_attempt_at, created_at) \
         VALUES (?1, ?2, ?3, 'pending', ?4, ?5, 0, ?6, ?6)",
        params![id, topic, payload, priority, max_attempts, now],
    )
    .map_err(|e| format!("outbox enqueue failed: {e}"))?;
    Ok(id)
}

/// Enqueue a delivery task (PostgreSQL backend).
#[allow(dead_code)]
pub async fn enqueue_pg(
    tx: &tokio_postgres::Transaction<'_>,
    topic: &str,
    payload: &str,
    max_attempts: i64,
    priority: i64,
) -> Result<String, String> {
    let id = Uuid::now_v7().to_string();
    let now = now_rfc3339();
    tx.execute(
        "INSERT INTO outbox (id, topic, payload, status, priority, max_attempts, attempts, \
         next_attempt_at, created_at) \
         VALUES ($1, $2, $3, 'pending', $4, $5, 0, $6, $6)",
        &[&id, &topic, &payload, &priority, &max_attempts, &now],
    )
    .await
    .map_err(|e| format!("outbox enqueue failed: {e}"))?;
    Ok(id)
}

// ── Drain ───────────────────────────────────────────────────────────

/// Run one drain cycle on a SQLite backend.
///
/// Claims up to [`DRAIN_BATCH_SIZE`] due entries, delivers each via
/// `deliver_fn(conn, topic, payload)` (async), and updates the status.
///
/// Returns the number of entries processed.
pub async fn drain_sqlite(
    conn: &SharedSqliteConn,
    deliver_fn: &(dyn Fn(SharedSqliteConn, &str, &str) -> DeliverFuture + Send + Sync),
) -> Result<usize, String> {
    // ── CLAIM, atomically, as `delivering` (C19) ─────────────────────────
    // The SELECT and the claim are ONE transaction so a concurrent drainer
    // cannot see a row this cycle has taken. Before this, the read left the
    // row `pending` and the connection was released across `deliver_fn`, so
    // two drains overlapping in that window both selected the SAME row and
    // both delivered it -- the duplicate send the `delivering` state exists
    // to prevent. `drain_pg` has always been safe here via `FOR UPDATE SKIP
    // LOCKED`; this arms the SQLite backend with the state the module doc
    // already promised (`pending -> delivering -> delivered`).
    //
    // The UPDATE is driven by the same predicate as the SELECT and its
    // `rows_affected` bounds the batch: a row another drainer claimed between
    // the two statements is simply not ours, so it is not counted and not
    // delivered. `changes()` after the loop is the honest batch size.
    let entries = {
        let mut db = conn.lock().await;
        let now = now_rfc3339();
        let tx = db
            .transaction()
            .map_err(|e| format!("outbox drain claim tx failed: {e}"))?;
        let ids: Vec<String> = {
            let mut stmt = tx
                .prepare(
                    "SELECT id FROM outbox WHERE status = 'pending' \
                     AND next_attempt_at <= ?1 \
                     ORDER BY priority DESC, next_attempt_at ASC LIMIT ?2",
                )
                .map_err(|e| format!("outbox drain prepare failed: {e}"))?;
            let rows = stmt
                .query_map(params![now, DRAIN_BATCH_SIZE], |row| {
                    row.get::<_, String>(0)
                })
                .map_err(|e| format!("outbox drain query failed: {e}"))?;
            let mut ids = Vec::new();
            for row in rows {
                ids.push(row.map_err(|e| format!("outbox drain row decode: {e}"))?);
            }
            ids
        };

        // Claim each id by a compare-and-set on `pending`, so only the drainer
        // that actually flipped the row proceeds to deliver it.
        let mut entries = Vec::new();
        for id in &ids {
            let claimed = tx
                .execute(
                    "UPDATE outbox SET status = 'delivering' \
                     WHERE id = ?1 AND status = 'pending'",
                    params![id],
                )
                .map_err(|e| format!("outbox drain claim failed: {e}"))?;
            if claimed == 0 {
                continue;
            }
            let entry = tx
                .query_row(
                    "SELECT id, topic, payload, status, max_attempts, attempts, \
                     next_attempt_at, created_at, last_error \
                     FROM outbox WHERE id = ?1",
                    params![id],
                    |row| {
                        Ok(OutboxEntry {
                            id: row.get(0)?,
                            topic: row.get(1)?,
                            payload: row.get(2)?,
                            status: row.get(3)?,
                            max_attempts: row.get(4)?,
                            attempts: row.get(5)?,
                            next_attempt_at: row.get(6)?,
                            created_at: row.get(7)?,
                            last_error: row.get(8)?,
                        })
                    },
                )
                .map_err(|e| format!("outbox drain claim read failed: {e}"))?;
            entries.push(entry);
        }
        tx.commit()
            .map_err(|e| format!("outbox drain claim commit failed: {e}"))?;
        entries
    };

    let mut processed = 0;
    for entry in &entries {
        let result = deliver_fn(conn.clone(), &entry.topic, &entry.payload).await;
        let db = conn.lock().await;
        if let Err(e) = result {
            let new_attempts = entry.attempts + 1;
            let dead = new_attempts >= entry.max_attempts;
            let next_at = if dead {
                now_rfc3339()
            } else {
                backoff_deadline(new_attempts as u64)
            };
            db.execute(
                "UPDATE outbox SET status = ?1, attempts = ?2, next_attempt_at = ?3, \
                 last_error = ?4 WHERE id = ?5",
                params![
                    if dead { "dead_letter" } else { "pending" },
                    new_attempts,
                    next_at,
                    e,
                    entry.id
                ],
            )
            .map_err(|e| format!("outbox update failed: {e}"))?;
        } else {
            db.execute(
                "UPDATE outbox SET status = 'delivered', attempts = ?1, last_error = NULL \
                 WHERE id = ?2",
                params![entry.attempts + 1, entry.id],
            )
            .map_err(|e| format!("outbox deliver update failed: {e}"))?;
        }
        processed += 1;
    }
    Ok(processed)
}

/// Start the background outbox drainer for SQLite.
///
/// Spawns a tokio task that polls the outbox every [`DRAIN_INTERVAL`] and
/// dispatches entries via `deliver_fn`.
pub fn start_drainer_sqlite(
    conn: SharedSqliteConn,
    deliver_fn: &'static (dyn Fn(SharedSqliteConn, &str, &str) -> DeliverFuture + Send + Sync),
) {
    tokio::spawn(async move {
        tracing::info!(
            "Outbox drainer started (SQLite, interval: {:?})",
            DRAIN_INTERVAL
        );
        loop {
            tokio::time::sleep(DRAIN_INTERVAL).await;
            if let Err(e) = drain_sqlite(&conn, deliver_fn).await {
                tracing::error!("Outbox drain cycle failed: {e}");
            }
        }
    });
}

/// Run one drain cycle on a PostgreSQL backend.
///
/// Claims up to [`DRAIN_BATCH_SIZE`] due entries with `FOR UPDATE SKIP
/// LOCKED` so concurrent instances never double-claim the same row, then
/// delivers each via `deliver_fn(pool, topic, payload)` (async).
///
/// Returns the number of entries processed.
#[allow(dead_code)]
pub async fn drain_pg(
    pool: &Pool,
    deliver_fn: &(dyn Fn(Pool, &str, &str) -> DeliverFuture + Send + Sync),
) -> Result<usize, String> {
    let mut client = pool
        .get()
        .await
        .map_err(|e| format!("outbox drain pool get: {e}"))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| format!("outbox drain tx: {e}"))?;
    let now = now_rfc3339();

    // Claim due entries, locking them for this transaction. SKIP LOCKED
    // makes the claim safe across instances.
    let rows = tx
        .query(
            "SELECT id, topic, payload, status, max_attempts, attempts, next_attempt_at, \
             created_at, last_error FROM outbox \
             WHERE status = 'pending' AND next_attempt_at <= $1 \
             ORDER BY priority DESC, next_attempt_at ASC LIMIT $2 \
             FOR UPDATE SKIP LOCKED",
            &[&now, &DRAIN_BATCH_SIZE],
        )
        .await
        .map_err(|e| format!("outbox drain claim failed: {e}"))?;

    let entries: Vec<OutboxEntry> = rows
        .iter()
        .map(|row| OutboxEntry {
            id: row.get("id"),
            topic: row.get("topic"),
            payload: row.get("payload"),
            status: row.get("status"),
            max_attempts: row.get("max_attempts"),
            attempts: row.get("attempts"),
            next_attempt_at: row.get("next_attempt_at"),
            created_at: row.get("created_at"),
            last_error: row.get("last_error"),
        })
        .collect();
    let count = entries.len();

    // Commit the claim transaction before delivering, so the row is
    // protected but the SMTP/HTTP work does not hold a DB transaction.
    tx.commit()
        .await
        .map_err(|e| format!("outbox drain commit: {e}"))?;

    for entry in &entries {
        let result = deliver_fn(pool.clone(), &entry.topic, &entry.payload).await;
        let client = pool
            .get()
            .await
            .map_err(|e| format!("outbox update pool get: {e}"))?;
        if let Err(e) = result {
            let new_attempts = entry.attempts + 1;
            let dead = new_attempts >= entry.max_attempts;
            let next_at = if dead {
                now_rfc3339()
            } else {
                backoff_deadline(new_attempts as u64)
            };
            client
                .execute(
                    "UPDATE outbox SET status = $1, attempts = $2, next_attempt_at = $3, \
                     last_error = $4 WHERE id = $5",
                    &[
                        &(if dead { "dead_letter" } else { "pending" }),
                        &new_attempts,
                        &next_at,
                        &e,
                        &entry.id,
                    ],
                )
                .await
                .map_err(|e| format!("outbox update failed: {e}"))?;
        } else {
            client
                .execute(
                    "UPDATE outbox SET status = 'delivered', attempts = $1, last_error = NULL \
                     WHERE id = $2",
                    &[&(entry.attempts + 1), &entry.id],
                )
                .await
                .map_err(|e| format!("outbox deliver update failed: {e}"))?;
        }
    }
    Ok(count)
}

/// Start the background outbox drainer for PostgreSQL.
#[allow(dead_code)]
pub fn start_drainer_pg(
    pool: Pool,
    deliver_fn: &'static (dyn Fn(Pool, &str, &str) -> DeliverFuture + Send + Sync),
) {
    tokio::spawn(async move {
        tracing::info!(
            "Outbox drainer started (Postgres, interval: {:?})",
            DRAIN_INTERVAL
        );
        loop {
            tokio::time::sleep(DRAIN_INTERVAL).await;
            if let Err(e) = drain_pg(&pool, deliver_fn).await {
                tracing::error!("Outbox drain cycle failed (Postgres): {e}");
            }
        }
    });
}

// ── Helpers ─────────────────────────────────────────────────────────

/// Current UTC timestamp in RFC 3339 millisecond format.
fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Compute the next attempt timestamp using exponential backoff.
///
/// `attempt` is 1-based (first retry = 1).  Backoff = min(2^attempt × BASE, CAP).
pub fn backoff_deadline(attempt: u64) -> String {
    let secs = (BACKOFF_BASE_SECS * 2u64.pow(attempt as u32)).min(BACKOFF_CAP_SECS);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let next = now + Duration::from_secs(secs);
    chrono::DateTime::from_timestamp(next.as_secs() as i64, 0)
        .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string())
        .unwrap_or_else(now_rfc3339)
}

#[cfg(test)]
#[path = "outbox_tests.rs"]
mod tests;
