//! OZ-POS Sync Engine
/*
last audited DD-MM-YY by DSH-Agent (re-review)
crate: platform-sync | status: SAFE | lint: CLEAN
findings: verified exemplary — SYNC-01 durable pull anchor with MONOTONIC advancement, replay-safe apply_remote_atomic with idempotency receipts, SYNC-02 shared conflict resolver (ADR-21: sale status DAG, version LWW, CRDT merge), SYNC-06 pin_hash never travels, RUST-04 snapshot pre-validation, per-batch independent commits. TLS verified: rustls + native roots + SslMode::Require (fail-closed, no certificate bypass). 0 unsafe blocks. 1 production expect (transport.rs new() — documented RUST-05 invariant wrapper). COR-33 already resolved: lib.rs is 648 lines with sibling lib_tests.rs (the 25-07-26 "production-after-tests" note was stale).
next: none | perf: 64KB priority-sorted batches
*/
//!
//! Offline-first sync with eventual consistency. Provides:
//!
//! - **Queue** — local change log backed by the `offline_queue` SQLite table
//! - **Transport** — async HTTP client for communicating with a remote sync server
//! - **Replication** — push pending changes / pull remote updates orchestration
//! - **Conflict** — last-write-wins (LWW) conflict resolution
//!
//! # Usage
//! ```ignore
//! # use platform_sync::{SyncEngine, SyncConfig};
//! # use oz_core::db::Store;
//! # use oz_core::migrations;
//! # async fn example() -> Result<(), Box<dyn std::error::Error>> {
//! # let conn = migrations::fresh_db();
//! # let store = Store::new(&conn);
//! let config = SyncConfig {
//!     server_url: "http://localhost:3099".into(),
//!     api_key: None,
//! };
//! let engine = SyncEngine::new(config);
//! let result = engine.run_sync_cycle(&store).await?;
//! # Ok(())
//! # }
//! ```

#![allow(clippy::items_after_test_module)]

pub mod conflict;
pub mod crdt;
pub mod daemon;
pub mod image_push;
pub mod pg_daemon;
pub mod pg_transport;
pub mod queue;
pub mod replication;
pub mod transport;

#[cfg(test)]
pub(crate) mod test_helpers;

use oz_core::db::Store;
use oz_core::sync_client::SyncConfig;

use crate::queue::SyncQueue;
use crate::replication::ReplicationResult;
use crate::transport::SyncTransport;

/// Convenience result type for sync operations.
pub type SyncResult<T> = Result<T, SyncError>;

/// Common sync error type.
#[derive(Debug, thiserror::Error)]
pub enum SyncError {
    /// Network or HTTP error communicating with the sync server.
    #[error("transport error: {0}")]
    Transport(String),

    /// Local queue operation failed (read/write/mark).
    #[error("queue error: {0}")]
    Queue(String),

    /// Replication logic error (push/pull cycle).
    #[error("replication error: {0}")]
    Replication(String),

    /// Conflict resolution failed.
    #[error("conflict error: {0}")]
    Conflict(String),

    /// Invalid or missing sync configuration.
    #[error("configuration error: {0}")]
    Config(String),

    /// The client's sync anchor (`since` timestamp) is older than the
    /// oldest retained row on the server. Data in that gap has been
    /// pruned (P-1 retention). Sync clients should recover through the
    /// snapshot endpoint when available, then resume from that boundary.
    #[error("anchor expired: data older than {}", oldest_available.as_deref().unwrap_or("unknown"))]
    AnchorExpired {
        /// ISO-8601 timestamp of the oldest retained row on the server.
        oldest_available: Option<String>,
    },

    /// The sync server has been permanently migrated to a new URL
    /// (ADR #11). The client should update its local `sync_server_url`
    /// setting and reconnect on the next cycle.
    #[error("server migrated to {new_url}")]
    ServerMigrated {
        /// The new server URL to connect to.
        new_url: String,
    },

    /// The server rejected our authentication because the token expired
    /// (HTTP 401 + `token_expired`, or a bare 401 from an older server).
    /// Callers refresh the API key and retry exactly once
    /// (ADR sync-auth-hardening P1/P4).
    #[error("sync server rejected authentication: token expired (HTTP 401)")]
    AuthExpired,

    /// The server rejected our authentication because the token is invalid
    /// or missing (HTTP 401 + `invalid_token` / `missing_token`) — a local
    /// configuration problem. Do NOT refresh; surface the error
    /// (ADR sync-auth-hardening P4).
    #[error("sync server rejected authentication: invalid token (HTTP 401)")]
    AuthInvalid,

    /// The tenant is on the `free` plan and cloud sync is gated
    /// (HTTP 403 + `plan_required`, ADR sync-plan-gating). Terminal: do
    /// NOT refresh, retry, or quarantine — surface the upgrade prompt.
    #[error("cloud sync requires a paid plan (HTTP 403 plan_required)")]
    PlanRequired,

    /// Database error from the underlying oz-core store.
    #[error("database error: {0}")]
    Database(#[from] oz_core::error::CoreError),
}

impl From<reqwest::Error> for SyncError {
    fn from(e: reqwest::Error) -> Self {
        SyncError::Transport(e.to_string())
    }
}

/// The top-level sync engine that orchestrates queue, transport, replication,
/// and conflict resolution for a single sync cycle.
pub struct SyncEngine {
    /// Sync configuration (server URL, API key).
    pub config: SyncConfig,
    /// HTTP transport for communicating with the remote sync server.
    pub transport: SyncTransport,
}

/// Maximum bytes per batch (64 KB). P-1 retention spec §Batching.
pub const MAX_BATCH_BYTES: usize = 64 * 1024;

/// Split pending items into batches that each serialise to ≤ `max_bytes`
/// bytes of JSON. Ensures at least one item per batch (no empty requests).
///
/// Items are sorted by priority (P-2) before chunking: all Critical items
/// transmit before any Normal item, which transmit before Low items.
/// Within each priority tier, original arrival order is preserved.
pub fn build_batches(
    items: &[oz_core::offline::OfflineQueueItem],
    max_bytes: usize,
) -> Vec<Vec<oz_core::offline::OfflineQueueItem>> {
    // Sort by priority (Critical=0, Normal=1, Low=2) — stable sort
    // preserves arrival order within each tier.
    let mut sorted: Vec<oz_core::offline::OfflineQueueItem> = items.to_vec();
    sorted.sort_by_key(|item| item.priority);

    let mut batches: Vec<Vec<oz_core::offline::OfflineQueueItem>> = Vec::new();
    let mut current: Vec<oz_core::offline::OfflineQueueItem> = Vec::new();
    let mut current_bytes = 0usize;

    for item in &sorted {
        // Estimate the JSON size of this item alone.
        let item_bytes = serde_json::to_vec(item).map(|v| v.len()).unwrap_or(0);

        // If adding this item would exceed the budget and we already have
        // items in the current batch, finalise and start a new batch.
        if !current.is_empty() && current_bytes + item_bytes > max_bytes {
            batches.push(std::mem::take(&mut current));
            current_bytes = 0;
        }

        current_bytes += item_bytes;
        current.push(item.clone());
    }

    // Don't drop the last partial batch.
    if !current.is_empty() {
        batches.push(current);
    }

    batches
}

/// Whether a snapshot tax rate's scope can be honoured in this database.
///
/// `true` means the row may be written. `false` covers two refusals:
///
/// * the row is scoped to a legal entity or location this store does not have
///   — the FK would reject the write, and NULLing the scope out instead is the
///   exact failure this guard exists to prevent, because a NULL scope IS the
///   tenant-global answer and a single-location rate would start pricing every
///   location;
/// * the row is scoped to BOTH, which is ambiguous rather than narrower
///   (one-or-the-other-or-neither — the same rule
///   `oz_core::db::tax::TaxRateScope` encodes in its variants).
///
/// Refusing degrades safely: with no scoped row present, the resolver falls
/// back to the tenant-global rate, which is what the branch used before the
/// pull. Mirrored in `crate::sync_pull` (oz-core), the other end of this
/// contract.
fn snapshot_tax_rate_scope_is_applicable(
    tx: &rusqlite::Transaction<'_>,
    rate: &transport::SnapshotTaxRate,
) -> SyncResult<bool> {
    let exists = |sql: &str, id: &str| -> SyncResult<bool> {
        match tx.query_row(sql, rusqlite::params![id], |_| Ok(())) {
            Ok(()) => Ok(true),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(false),
            Err(e) => Err(SyncError::Replication(format!(
                "tax rate scope lookup failed: {e}"
            ))),
        }
    };
    match (rate.legal_entity_id.as_deref(), rate.location_id.as_deref()) {
        (None, None) => Ok(true),
        (Some(_), Some(_)) => Ok(false),
        (Some(entity), None) => exists("SELECT 1 FROM legal_entities WHERE id = ?1", entity),
        (None, Some(location)) => exists("SELECT 1 FROM locations WHERE id = ?1", location),
    }
}

/// Import a server snapshot into the local store (P-3 Step 5).
///
/// Upserts products (by SKU), tax rates (by ID, with their scope and validity
/// window), and users (by username) inside a single transaction. Returns the
/// total number of rows written.
pub(crate) fn import_snapshot(
    store: &Store<'_>,
    snapshot: &transport::SyncSnapshotResponse,
) -> SyncResult<usize> {
    // RUST-04: reject malformed reference data BEFORE opening the import
    // transaction. The typed DTOs already fail deserialization when required
    // fields are missing; here we reject blank values and invalid numeric
    // ranges that serde cannot catch (empty strings deserialize fine).
    if snapshot.version > transport::SNAPSHOT_SCHEMA_VERSION {
        return Err(SyncError::Replication(format!(
            "snapshot schema version {} is newer than supported version {}",
            snapshot.version,
            transport::SNAPSHOT_SCHEMA_VERSION
        )));
    }
    for p in &snapshot.products {
        if p.sku.trim().is_empty() || p.name.trim().is_empty() || p.currency.trim().is_empty() {
            return Err(SyncError::Replication(format!(
                "snapshot product has blank required field (sku='{}', name='{}', currency='{}')",
                p.sku, p.name, p.currency
            )));
        }
        if p.price_minor < 0 {
            return Err(SyncError::Replication(format!(
                "snapshot product '{}' has negative price_minor {}",
                p.sku, p.price_minor
            )));
        }
    }
    for r in &snapshot.tax_rates {
        if r.id.trim().is_empty() || r.name.trim().is_empty() {
            return Err(SyncError::Replication(
                "snapshot tax rate has blank id or name".to_owned(),
            ));
        }
        if r.rate_bps < 0 {
            return Err(SyncError::Replication(format!(
                "snapshot tax rate '{}' has negative rate_bps {}",
                r.id, r.rate_bps
            )));
        }
    }
    for u in &snapshot.users {
        if u.username.trim().is_empty()
            || u.display_name.trim().is_empty()
            || u.role_id.trim().is_empty()
        {
            return Err(SyncError::Replication(format!(
                "snapshot user '{}' has blank username/display_name/role_id",
                u.username
            )));
        }
    }

    let conn = store.conn();
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| SyncError::Replication(format!("snapshot import tx: {e}")))?;

    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let mut count = 0usize;

    // Upsert products by SKU.
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO products (id, sku, name, price_minor, currency,
                                       category_id, barcode, created_at, updated_at,
                                       price_updated_at, track_serial, store_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7,
                         COALESCE(?8, ?11), COALESCE(?9, ?11), COALESCE(?10, ?11), ?12, ?13)
                 ON CONFLICT (tenant_id, sku) DO UPDATE SET
                     name            = excluded.name,
                     price_minor     = excluded.price_minor,
                     currency        = excluded.currency,
                     category_id     = excluded.category_id,
                     barcode         = excluded.barcode,
                     updated_at      = COALESCE(excluded.updated_at, ?11),
                     price_updated_at = COALESCE(excluded.price_updated_at, ?11),
                     track_serial    = excluded.track_serial,
                     store_id        = excluded.store_id",
            )
            .map_err(|e| SyncError::Replication(format!("prepare products: {e}")))?;

        for p in &snapshot.products {
            stmt.execute(rusqlite::params![
                p.id,
                p.sku,
                p.name,
                p.price_minor,
                p.currency,
                p.category_id.as_deref(),
                p.barcode.as_deref(),
                p.created_at.as_deref(),
                p.updated_at.as_deref(),
                p.price_updated_at.as_deref(),
                now,
                p.track_serial as i64,
                p.store_id.as_deref(),
            ])
            .map_err(|e| SyncError::Replication(format!("upsert product: {e}")))?;
            count += 1;
        }
    }

    // Upsert tax rates by ID — INCLUDING their scope and validity window.
    //
    // The four columns must travel or the pull is a money bug: a rate scoped
    // to one location that lands with NULL scope reads as the TENANT-GLOBAL
    // answer at the branch, so every location starts pricing with it. Kept
    // column-for-column with oz-core's own pull path (crate::sync_pull), which
    // is the other end of this contract.
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO tax_rates (id, name, rate_bps, is_default, is_inclusive,
                                        created_at, updated_at,
                                        legal_entity_id, location_id,
                                        effective_from, effective_to,
                                        rounding_mode)
                 VALUES (?1, ?2, ?3, ?4, ?5, COALESCE(?6, ?8), COALESCE(?7, ?8),
                         ?9, ?10, ?11, ?12, ?13)
                 ON CONFLICT(id) DO UPDATE SET
                     name            = excluded.name,
                     rate_bps        = excluded.rate_bps,
                     is_default      = excluded.is_default,
                     is_inclusive    = excluded.is_inclusive,
                     updated_at      = COALESCE(excluded.updated_at, ?8),
                     legal_entity_id = excluded.legal_entity_id,
                     location_id     = excluded.location_id,
                     effective_from  = excluded.effective_from,
                     effective_to    = excluded.effective_to,
                     rounding_mode   = excluded.rounding_mode",
            )
            .map_err(|e| SyncError::Replication(format!("prepare tax_rates: {e}")))?;

        let mut skipped: Vec<String> = Vec::new();
        for r in &snapshot.tax_rates {
            // A scope this database cannot honour is REFUSED, never flattened:
            // writing NULL would promote a single-location rate to the
            // tenant-global answer, and the FK would reject the write anyway.
            // Skipping degrades to "no scoped row here", which is the answer
            // the branch already had.
            if !snapshot_tax_rate_scope_is_applicable(&tx, r)? {
                skipped.push(r.id.clone());
                continue;
            }
            stmt.execute(rusqlite::params![
                r.id,
                r.name,
                r.rate_bps,
                r.is_default as i64,
                r.is_inclusive as i64,
                r.created_at.as_deref(),
                r.updated_at.as_deref(),
                now,
                r.legal_entity_id.as_deref(),
                r.location_id.as_deref(),
                r.effective_from.as_deref(),
                r.effective_to.as_deref(),
                r.rounding_mode.as_str(),
            ])
            .map_err(|e| SyncError::Replication(format!("upsert tax_rate: {e}")))?;
            count += 1;
        }
        if !skipped.is_empty() {
            tracing::warn!(
                tax_rate_ids = ?skipped,
                count = skipped.len(),
                "snapshot tax rates skipped: scope target absent locally, or the row is \
                 scoped to both an entity and a location"
            );
        }
    }

    // Upsert users by username.
    //
    // SYNC-06: `pin_hash` is deliberately NEVER read from the snapshot —
    // credential verifier material must not travel over the sync channel.
    // New rows get a non-verifiable placeholder, and on conflict the
    // EXISTING local hash is preserved (the UPDATE clause omits pin_hash),
    // so an import can neither replicate credentials nor lock out an
    // operator who already has a working PIN.
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO users (id, username, pin_hash, display_name, role_id,
                                    is_active, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, COALESCE(?7, ?9), COALESCE(?8, ?9))
                 ON CONFLICT (tenant_id, username) DO UPDATE SET
                     display_name = excluded.display_name,
                     role_id      = excluded.role_id,
                     is_active    = excluded.is_active,
                     updated_at   = COALESCE(excluded.updated_at, ?9)",
            )
            .map_err(|e| SyncError::Replication(format!("prepare users: {e}")))?;

        for u in &snapshot.users {
            stmt.execute(rusqlite::params![
                u.id,
                u.username,
                oz_core::sync_client::SNAPSHOT_PIN_HASH_PLACEHOLDER,
                u.display_name,
                u.role_id,
                u.is_active as i64,
                u.created_at.as_deref(),
                u.updated_at.as_deref(),
                now,
            ])
            .map_err(|e| SyncError::Replication(format!("upsert user: {e}")))?;
            count += 1;
        }
    }

    tx.commit()
        .map_err(|e| SyncError::Replication(format!("snapshot import commit: {e}")))?;

    Ok(count)
}

impl SyncEngine {
    /// Create a new sync engine from the given configuration.
    pub fn new(config: SyncConfig) -> Self {
        Self {
            transport: SyncTransport::new(&config.server_url, config.api_key.as_deref()),
            config,
        }
    }

    /// Stamp outgoing pushes with this terminal's causality metadata.
    ///
    /// [`SyncEngine::new`] cannot do this itself: it takes only a
    /// [`SyncConfig`] and has no database handle, and the counter must be read
    /// from the persisted clock — see
    /// [`SyncTransport::with_vector_stamping`] for why seeding from zero is
    /// wrong. Callers that hold a store should read
    /// [`crate::crdt::CLOCK_KEY`] and the configured terminal id, then call
    /// this, and persist [`SyncTransport::last_stamped_counter`] afterwards.
    ///
    /// Without it the immediate-sync path pushes unstamped payloads, and the
    /// server skips conflict detection for them.
    pub fn with_vector_stamping(mut self, terminal_id: &str, initial_counter: u64) -> Self {
        self.transport = self
            .transport
            .with_vector_stamping(terminal_id, initial_counter);
        self
    }

    /// Highest counter stamped so far, or `None` when stamping is disabled.
    ///
    /// Persist this after a successful sync cycle; otherwise the next process
    /// restarts from the old value and the server classifies every push as
    /// stale.
    pub fn last_stamped_counter(&self) -> Option<u64> {
        self.transport.last_stamped_counter()
    }

    /// Run a full sync cycle: push pending items in batches, then pull remote updates.
    ///
    /// Items are split into ≤ 64 KB batches (P-1 batching) and sent sequentially.
    /// Each batch commits independently — a failure in batch N does not roll back
    /// the results of batches 1..N-1.
    ///
    /// A pre-sync health check verifies the server is reachable before pushing
    /// any data. If the health check fails, the cycle is skipped with an info log
    /// rather than an error — this prevents noisy error logs when the server is
    /// intentionally offline.
    ///
    /// The pull phase is replay-safe (SYNC-01 parity with the daemon): remote
    /// items are applied atomically with a durable `sync_applied_items` receipt,
    /// poison items are dead-lettered after their retry budget, and the durable
    /// [`oz_core::db::offline::SyncPullState`] anchor advances only after a page
    /// applied successfully — so a server replay or lost anchor never applies a
    /// mutation twice.
    ///
    /// Returns a [`ReplicationResult`] with counts of pushed/pulled items.
    pub async fn run_sync_cycle(&self, store: &Store<'_>) -> SyncResult<ReplicationResult> {
        // Pre-sync health check — skip the full cycle if the server is unreachable.
        match self.transport.health_check().await {
            Ok(()) => {
                tracing::debug!(
                    url = %self.config.server_url,
                    "sync health check passed"
                );
            }
            Err(e) => {
                tracing::info!(
                    url = %self.config.server_url,
                    error = %e,
                    "sync health check failed — skipping sync cycle"
                );
                return Ok(ReplicationResult {
                    pushed: 0,
                    pulled: 0,
                });
            }
        }

        let cycle_start = std::time::Instant::now();
        let queue = SyncQueue::new();

        // Phase 1: Push pending local changes in batches.
        let pending = queue.list_pending(store)?;
        let pending_count = pending.len();
        let mut total_pushed = 0usize;
        let mut total_bytes_sent = 0usize;
        let batch_count;

        if !pending.is_empty() {
            let batches = build_batches(&pending, MAX_BATCH_BYTES);
            batch_count = batches.len();
            for (batch_idx, batch) in batches.iter().enumerate() {
                let batch_items = batch.len();
                let batch_bytes = serde_json::to_vec(batch).map(|v| v.len()).unwrap_or(0);
                total_bytes_sent += batch_bytes;

                tracing::debug!(
                    batch = batch_idx + 1,
                    total_batches = batch_count,
                    items = batch_items,
                    bytes = batch_bytes,
                    "pushing batch"
                );

                let results = self.transport.push_items(batch).await?;
                for (item, outcome) in batch.iter().zip(results.iter()) {
                    match outcome {
                        transport::PushOutcome::Accepted => {
                            queue.mark_synced(store, &item.id)?;
                        }
                        transport::PushOutcome::Conflict(server_item) => {
                            // SYNC-02: single shared conflict-application
                            // service — identical ADR #21 strategy whether the
                            // conflict is processed here or by the daemon.
                            queue.apply_push_conflict(store, item, server_item)?;
                        }
                        transport::PushOutcome::Rejected { reason } => {
                            queue.mark_failed(store, &item.id, reason)?;
                        }
                    }
                }
                total_pushed += results.len();
            }
        } else {
            batch_count = 0;
        }

        // Phase 2: Pull remote updates from the server.
        // P-3: Paginated pull — loop until next_cursor is null.
        // SYNC-01 (parity with the daemon): the `since` anchor comes from
        // the DURABLE `sync_pull_state` row, not from the local queue's
        // synced timestamps. `last_synced_at` only reflects what THIS
        // terminal pushed — pulled remote items never move it — so the old
        // anchor re-fetched and re-applied the same remote pages on every
        // cycle. The durable anchor advances only after a page applied
        // successfully, so a crash mid-pull replays safely.
        let pull_state = store.get_sync_pull_state()?;
        let mut pull_since = pull_state.since;
        let mut total_pulled = 0usize;
        let mut cursor = pull_state.cursor;
        let mut pages = 0u32;

        loop {
            pages += 1;
            let pull_result = match self
                .transport
                .pull_updates(pull_since.as_deref(), cursor.as_deref())
                .await
            {
                Ok(result) => result,
                Err(SyncError::AnchorExpired { oldest_available }) => {
                    tracing::warn!(
                        oldest_available = oldest_available,
                        "sync anchor expired — fetching snapshot to recover"
                    );
                    // P-3 Step 5: fetch the server's snapshot and import it.
                    match self.transport.fetch_snapshot().await {
                        Ok(snapshot) => {
                            let snapshot_count = import_snapshot(store, &snapshot)?;
                            tracing::info!(
                                products = snapshot.products.len(),
                                tax_rates = snapshot.tax_rates.len(),
                                users = snapshot.users.len(),
                                imported = snapshot_count,
                                "snapshot imported successfully after anchor expiry"
                            );
                            // The snapshot is the authoritative full state,
                            // so the durable pull anchor can advance to the
                            // server's oldest retained row — the client no
                            // longer needs anything older. Without this
                            // reset the STALE anchor survives the import and
                            // every subsequent cycle re-triggers
                            // AnchorExpired → re-fetches the whole snapshot
                            // (wasted bandwidth + server load). When the
                            // server omitted `oldest_available`, clear the
                            // anchor instead — the next pull starts fresh
                            // and the idempotency ledger absorbs any replay.
                            store.set_sync_pull_state(oldest_available.as_deref(), None)?;
                        }
                        Err(e) => {
                            // ADR #11: Propagate server migration redirect so
                            // the daemon can update the local sync_server_url.
                            if matches!(&e, SyncError::ServerMigrated { .. }) {
                                return Err(e);
                            }
                            tracing::error!(
                                error = %e,
                                "snapshot fetch failed after anchor expiry; will retry next cycle"
                            );
                        }
                    }
                    return Ok(ReplicationResult {
                        pushed: total_pushed,
                        pulled: total_pulled,
                    });
                }
                Err(e) => return Err(e),
            };

            let page_count = pull_result.items.len();
            total_pulled += page_count;
            let has_more = pull_result.next_cursor.is_some();

            tracing::debug!(
                page = pages,
                items = page_count,
                has_more = has_more,
                "pulled page"
            );

            // SYNC-01: apply each item atomically — the domain mutation and
            // its idempotency receipt commit together, and a poison item is
            // dead-lettered after its retry budget — exactly like the
            // daemon. An already-applied replay is a no-op. A retryable
            // failure retains the durable anchor so the next cycle re-pulls
            // the same page; a dead-lettered item is quarantined and counts
            // as applied (the page may advance past it).
            let mut page_all_applied = true;
            for remote_item in &pull_result.items {
                match queue.apply_remote_atomic(store, remote_item) {
                    Ok(applied) => {
                        if !applied
                            && store
                                .is_remote_failure_dead_lettered(&remote_item.id)
                                .unwrap_or(false)
                        {
                            tracing::error!(
                                item_id = %remote_item.id,
                                action = %remote_item.action,
                                "remote item remains quarantined; advancing page anchor"
                            );
                        }
                    }
                    Err(e) => {
                        let dead_lettered = store
                            .is_remote_failure_dead_lettered(&remote_item.id)
                            .unwrap_or(false);
                        if dead_lettered {
                            tracing::error!(
                                item_id = %remote_item.id,
                                action = %remote_item.action,
                                error = %e,
                                "remote item quarantined after repeated failures; advancing page anchor"
                            );
                        } else {
                            page_all_applied = false;
                            tracing::error!(
                                item_id = %remote_item.id,
                                action = %remote_item.action,
                                error = %e,
                                "failed to atomically apply remote item; retaining pull anchor for retry"
                            );
                        }
                    }
                }
            }

            // SYNC-01: advance the durable anchor ONLY after the whole
            // page applied successfully (dead-lettered items count as
            // applied — they are quarantined). A retryable failure leaves
            // the old anchor and stops pagination so the next cycle
            // re-pulls from the same point; the idempotency ledger absorbs
            // any replay. Retrying the same page is safe because the
            // bundled server's `(created_at, id)` cursors are stable
            // (same cursor → same page).
            if !page_all_applied {
                break;
            }
            // The anchor must be MONOTONIC: take the later of the current
            // anchor and the page's newest row. `.or()` alone could regress
            // the anchor when the server returns rows older than `since`
            // (clock skew / late delivery), which would re-fetch history on
            // every cycle. ISO-8601 timestamps are fixed-format, so
            // lexicographic ordering equals chronological ordering here.
            let page_max = pull_result.items.iter().map(|i| i.created_at.clone()).max();
            let new_since = std::cmp::max(pull_since.clone(), page_max);
            store.set_sync_pull_state(new_since.as_deref(), pull_result.next_cursor.as_deref())?;
            pull_since = new_since;
            cursor = pull_result.next_cursor;
            if !has_more {
                break;
            }
        }

        let elapsed_ms = cycle_start.elapsed().as_millis() as u64;

        tracing::info!(
            pending = pending_count,
            pushed = total_pushed,
            pulled = total_pulled,
            batches = batch_count,
            pages = pages,
            bytes_sent = total_bytes_sent,
            elapsed_ms = elapsed_ms,
            "sync cycle complete"
        );

        Ok(ReplicationResult {
            pushed: total_pushed,
            pulled: total_pulled,
        })
    }
}
#[cfg(test)]
#[allow(clippy::unnecessary_literal_unwrap)]
#[path = "lib_tests.rs"]
mod tests;
