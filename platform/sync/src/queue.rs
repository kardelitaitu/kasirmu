//! Sync Queue — local change log for offline-first replication.
/*
last audited 26-09-06 by DSH (offline-sync spec verification pass; prior slice-B deep read by RSA-Agent 25-07-26)
crate: platform-sync | status: SAFE | lint: CLEAN
findings: exemplary — apply_remote_atomic_full runs quarantine gate, receipt-exists check, domain mutation, and receipt insert in ONE transaction (crash-safe replay protection); failure path drops the tx then records the failure with retry budget 3 for dead-lettering; CRDT delta merge arms for stock payloads; SYNC-10 settings with non-fatal delta write (savepoint-safe inside caller tx); finalize_sale idempotent pending-to-completed only; unsupported actions fail closed; apply_push_conflict is the single SYNC-02 shared resolver entry; apply_remote is the deprecated non-atomic legacy mirror. CORRECTED prior note: the earlier "pull items are not validated" concern was WRONG — the product.created arm's unwrap_or("")/unwrap_or(-1) payload defaults are fully caught at the storage boundary: create_product_if_absent_in_tx rejects blank/oversize sku+name, negative price_minor and initial_stock, and returns CoreError::Conflict on a same-sku-different-data replay (a remote update that disagrees is NOT silently overwritten — it fails and dead-letters visibly). Every other pull arm parses a typed serde struct (missing required fields fail deserialization) or a validating store fn, so the whole pull path is fail-closed and conflict-visible without a separate payload-validation layer.
next: malformed/conflicting pull items are permanent failures but still burn the retry-3 budget before dead-lettering — consider classifying apply-time Validation/Conflict errors as non-retryable to fail fast (low value, behavior change in the highest-risk path, deliberately not done here) | perf: prepared upserts
*/
//!
//! Wraps the `oz_core` offline queue Store methods into a clean interface
//! with additional tracking for conflict resolution and last-sync timing.
//!
//! Settings items are the one action type that is NOT applied verbatim: both
//! dispatchers (`apply_remote_in_tx` and the legacy `apply_remote`) write through
//! `Settings::set_with_policy(..., IngestPolicy::RemoteSync)`, the sealed policy
//! owned by platform-core and delegated by the `oz_core::Settings` facade, so a
//! remote item cannot plant a credential
//! (`local_api.secret`, `license.api_key`, the gateway keys) or a device-bound
//! identity (`machine_id`, `sync_terminal_id`) on this install. Nothing in
//! `transport` or `sync_api` signs or MACs an item, so the sender is not an
//! authority. A refusal warns and continues — it never aborts the batch and
//! never logs the value.

use oz_core::db::Store;
use oz_core::db::offline::SyncStatusSummary;
use oz_core::error::CoreError;
use oz_core::offline::{OfflineQueueItem, OfflineQueueStatus};
use oz_core::settings::Settings;
use oz_core::settings::{IngestPolicy, IngestPolicyKind};
use serde::Deserialize;
use serde_json::Value;

/// The ONE remote-ingest gate for the sync lane.
///
/// Delegates to the sealed [`IngestPolicy::RemoteSync`] policy owned by
/// platform-core (re-exported through `oz_core::settings`), which refuses every
/// credential in `SECRET_KEY_DENY_LIST`, every device-bound identity in
/// `NON_EXPORTABLE_DEVICE_KEYS` (`machine_id`, `sync_terminal_id`) and every
/// lifecycle-manager prefix (`local_api.*`, `lan_server.*`). This lane owns no
/// key list of its own.
///
/// Both dispatchers now WRITE through the funnel accessor
/// `Settings::set_with_policy(..., IngestPolicy::RemoteSync)`, which decides and
/// warns in one place (delegated to platform-core through the `oz_core::Settings`
/// facade, so this crate needs no `platform-core` dependency edge). This
/// boundary remains for the one place that must ask the question WITHOUT
/// writing: [`settings_change_of`], which must not report a refused key as a
/// change. It is the same predicate the accessor applies, so the two cannot
/// disagree.
///
/// A refusal is warn-and-continue, never an error: the precedent is the
/// unsupported-action arm at the foot of `apply_remote` and the non-fatal delta
/// write in both settings arms. Aborting a pull over one disallowed key would
/// let the server deny service to the whole tenant.
fn remote_sync_admits(key: &str) -> bool {
    IngestPolicy::RemoteSync.admits(key)
}

#[derive(Deserialize)]
struct SalePayload {
    #[serde(default)]
    line_items: Vec<SaleLinePayload>,
}

#[derive(Deserialize)]
struct SaleLinePayload {
    sku: String,
    #[serde(default)]
    qty: i64,
}

#[derive(Deserialize)]
struct StockAdjustmentPayload {
    sku: String,
    delta: i64,
    /// Optional per-location scope (ADR-19). ADR-19-aware senders and CRDT
    /// envelope sides name the location the delta belongs to; OLDER senders
    /// omit it (serde default), and the delta then keeps today's behaviour
    /// of landing at the canonical default location.
    #[serde(default)]
    location_id: Option<String>,
}
/// Apply one stock.adjusted delta inside the caller's transaction.
///
/// A delta that names a location_id routes through the canonical
/// per-location writer adjust_stock_at_location_with_reason, which upserts
/// stock_summary at the composite (item_id, location_id) key and recomputes
/// the legacy inventory aggregate as the SUM over per-location rows - never
/// an aggregate stamp (ADR-19 s3.1, the writer the store-level contract
/// test proves correct).
///
/// A delta WITHOUT a location keeps the pre-ADR-19 target (the canonical
/// default location) and picks the writer by install shape:
///
/// - no stock_summary rows for the product (legacy single-location
///   install): adjust_stock_in_tx - its aggregate stamp is consistent
///   there because the default row is the only row;
/// - rows exist (multi-location install): the canonical writer AT the
///   canonical default location - the legacy stamp would overwrite the
///   default row with the cross-location aggregate and re-create the
///   reader-vs-SUM disagreement this dispatch exists to prevent.
#[allow(deprecated)]
fn apply_stock_adjustment_delta_in_tx(
    tx: &rusqlite::Transaction<'_>,
    sub: &StockAdjustmentPayload,
) -> Result<(), CoreError> {
    let has_location_rows = product_has_location_rows(tx, &sub.sku)?;
    let canonical_at = |location: &str| -> Result<(), CoreError> {
        Store::new(tx).adjust_stock_at_location_with_reason(
            tx,
            &sub.sku,
            sub.delta,
            &oz_core::inventory::LocationId::from(location),
            None,
            None,
            None,
            None,
        )?;
        Ok(())
    };
    match sub.location_id.as_deref() {
        Some(location) => canonical_at(location)?,
        None if has_location_rows => {
            canonical_at(oz_core::inventory::CANONICAL_DEFAULT_LOCATION_UUID)?
        }
        None => {
            Store::new(tx).adjust_stock_in_tx(tx, &sub.sku, sub.delta)?;
        }
    }
    Ok(())
}

/// Whether the product behind sku already has any per-location
/// stock_summary row (i.e. the install tracks per-location stock for it).
fn product_has_location_rows(tx: &rusqlite::Transaction<'_>, sku: &str) -> Result<bool, CoreError> {
    let exists: i64 = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM stock_summary WHERE item_id = (SELECT id FROM products WHERE sku = ?1))",
            [sku],
            |row| row.get(0),
        )
        .map_err(CoreError::Db)?;
    Ok(exists != 0)
}

/// Payload for the `stock.movement` sync action (ADR #6 cross-store routing).
/// Carries a full `StockMovement` row for insertion into the local ledger.
#[derive(Deserialize)]
struct StockMovementPayload {
    id: String,
    item_id: String,
    delta: i64,
    reason: Option<String>,
    source_terminal_id: Option<String>,
    source_user_id: Option<String>,
    store_id: String,
    created_at: String,
}

/// Default originating terminal for remote settings items whose payload
/// omits `terminal_id` (older servers / relay terminals).
fn default_sync_terminal() -> String {
    "sync".into()
}

/// Payload for the `settings.update` / `settings.change` sync action
/// (SYNC-10). Carries the key, the new value, and the terminal that made
/// the change so the local delta ledger records the originator and the
/// daemon can re-emit a `SettingsUpdated` event for UI reactivity.
#[derive(Deserialize)]
struct SettingsUpdatePayload {
    key: String,
    value: String,
    #[serde(default = "default_sync_terminal")]
    terminal_id: String,
}

/// Payload for the `finalize_sale` sync action — the cloud webhook path
/// enqueues `{"sale_id": …}` after payment capture so the pending sale
/// completes on the terminal.
#[derive(Deserialize)]
struct FinalizeSalePayload {
    sale_id: String,
}

/// Outcome of applying a remote item atomically (SYNC-10).
///
/// [`SyncQueue::apply_remote_atomic`] returns only `applied` for legacy
/// callers; the reporting variant [`SyncQueue::apply_remote_atomic_full`]
/// additionally surfaces a settings change (changed key + originating
/// terminal) so the sync daemon can publish `SettingsUpdated` after the
/// transaction commits.
#[derive(Debug, Clone, Default)]
pub struct ApplyOutcome {
    /// Whether the mutation was applied (false on idempotent replay skip).
    pub applied: bool,
    /// `Some((key, terminal_id))` when this item applied a settings change.
    pub settings_change: Option<(String, String)>,
}

/// A resolved item after conflict resolution — may be accepted from either
/// the local or remote side, or a merged version.
#[derive(Debug, Clone)]
pub struct ResolvedItem {
    /// The original local item, if applicable.
    pub local: Option<OfflineQueueItem>,
    /// The original remote item, if applicable.
    pub remote: Option<OfflineQueueItem>,
    /// The winning item to persist.
    pub winner: OfflineQueueItem,
}

/// Wraps the offline queue database operations with sync-specific helpers.
pub struct SyncQueue;

impl SyncQueue {
    /// Create a new sync queue interface.
    pub fn new() -> Self {
        Self
    }

    /// List all pending (unsynced) items, oldest first.
    pub fn list_pending(&self, store: &Store<'_>) -> Result<Vec<OfflineQueueItem>, CoreError> {
        store.list_pending_offline()
    }

    /// List all items (most recent first).
    pub fn list_all(&self, store: &Store<'_>) -> Result<Vec<OfflineQueueItem>, CoreError> {
        store.list_all_offline()
    }

    /// Enqueue a new offline transaction.
    pub fn enqueue(
        &self,
        store: &Store<'_>,
        action: &str,
        payload: &str,
    ) -> Result<OfflineQueueItem, CoreError> {
        store.enqueue_offline(action, payload)
    }

    /// Enqueue a transaction with dedup by action + payload.
    ///
    /// If a pending item with the same `action` and `payload` already
    /// exists, returns `Ok(None)` — no duplicate is created.
    /// This prevents duplicate entries when the same event is enqueued
    /// multiple times across different terminals or due to retry logic.
    pub fn enqueue_dedup(
        &self,
        store: &Store<'_>,
        action: &str,
        payload: &str,
    ) -> Result<Option<OfflineQueueItem>, CoreError> {
        store.enqueue_offline_dedup(action, payload)
    }

    /// Mark an item as successfully synced.
    pub fn mark_synced(&self, store: &Store<'_>, id: &str) -> Result<(), CoreError> {
        store.mark_offline_synced(id)
    }

    /// Mark an item as failed with an error message.
    pub fn mark_failed(&self, store: &Store<'_>, id: &str, error: &str) -> Result<(), CoreError> {
        store.mark_offline_failed(id, error)
    }

    /// Get the count of pending items.
    pub fn pending_count(&self, store: &Store<'_>) -> Result<i64, CoreError> {
        store.pending_offline_count()
    }

    /// Delete an item from the queue.
    pub fn delete(&self, store: &Store<'_>, id: &str) -> Result<(), CoreError> {
        store.delete_offline_item(id)
    }

    /// Get a summary of the offline queue status.
    ///
    /// Returns counts by status, total retries, last sync timestamp,
    /// and oldest pending timestamp — for dashboard observability.
    pub fn status_summary(&self, store: &Store<'_>) -> Result<SyncStatusSummary, CoreError> {
        store.offline_queue_status_summary()
    }

    /// Get the timestamp of the most recently synced item.
    ///
    /// Returns `None` if nothing has been synced yet.
    pub fn last_synced_at(&self, store: &Store<'_>) -> Result<Option<String>, CoreError> {
        let all = store.list_all_offline()?;
        Ok(all
            .iter()
            .filter(|i| matches!(i.status, OfflineQueueStatus::Synced))
            .filter_map(|i| i.synced_at.as_deref())
            .max_by(|a, b| a.cmp(b))
            .map(|s| s.to_owned()))
    }

    /// Apply a conflict-resolution outcome to the queue.
    ///
    /// Marks the local item with a conflict-resolution marker in its
    /// `last_error` field so the status summary can count it. If the
    /// winner is a merged (CRDT) item, a new queue entry is created.
    pub fn apply_resolution(
        &self,
        store: &Store<'_>,
        resolved: &ResolvedItem,
    ) -> Result<(), CoreError> {
        // Determine the resolution type from the winner identity.
        let resolution_tag = match (&resolved.local, &resolved.remote) {
            (Some(local), _) if resolved.winner.id == local.id => "local won",
            (_, Some(remote)) if resolved.winner.id == remote.id => "remote won",
            _ => "crdt merge",
        };
        // Mark the local item with a conflict marker and sync it.
        if let Some(ref local) = resolved.local {
            store.mark_offline_resolved(&local.id, resolution_tag)?;
        }
        // If the winner is a merged item (neither purely local nor remote),
        // enqueue it for the next sync cycle.
        let is_new_winner = match (&resolved.local, &resolved.remote) {
            (Some(local), _) if resolved.winner.id == local.id => false,
            (_, Some(remote)) if resolved.winner.id == remote.id => false,
            _ => true,
        };
        if is_new_winner {
            store.enqueue_offline(&resolved.winner.action, &resolved.winner.payload)?;
        }
        Ok(())
    }

    /// Apply a push-conflict outcome using the shared ADR #21 resolver.
    ///
    /// **This is the single conflict-application service** used by both the
    /// immediate [`SyncEngine`](crate::SyncEngine) and the background
    /// [`SyncDaemon`](crate::daemon::SyncDaemon), so the same ADR #21
    /// strategy (version LWW / sale status DAG / stock CRDT merge) applies
    /// regardless of which trigger processes the conflict (SYNC-02).
    ///
    /// Resolves the conflict, persists the resolution (marking the local
    /// item resolved with an auditable tag), and re-enqueues the merged
    /// winner when the resolver produced a CRDT merge — whose payload is
    /// now consumable by [`SyncQueue::apply_remote`] (SYNC-05).
    pub fn apply_push_conflict(
        &self,
        store: &Store<'_>,
        local: &OfflineQueueItem,
        server_item: &OfflineQueueItem,
    ) -> Result<(), CoreError> {
        let resolved = crate::conflict::resolve_conflict(local, server_item);
        self.apply_resolution(store, &resolved)
    }

    /// Apply a remote item and its idempotency receipt atomically.
    ///
    /// The existence check, domain mutation, and receipt insert share one
    /// SQLite transaction. A crash before commit therefore rolls back both
    /// the mutation and the receipt, while a replay after commit is skipped.
    ///
    /// Returns only whether the mutation applied — see
    /// [`apply_remote_atomic_full`](Self::apply_remote_atomic_full) for the
    /// variant that also reports settings changes for `SettingsUpdated`.
    pub fn apply_remote_atomic(
        &self,
        store: &Store<'_>,
        item: &OfflineQueueItem,
    ) -> Result<bool, CoreError> {
        Ok(self.apply_remote_atomic_full(store, item)?.applied)
    }

    /// Apply a remote item and its idempotency receipt atomically, reporting
    /// settings changes (SYNC-10).
    ///
    /// Identical transaction semantics to
    /// [`apply_remote_atomic`](Self::apply_remote_atomic), but the outcome
    /// also carries the changed settings key and its originating terminal so
    /// the sync daemon can publish `SettingsUpdated` after the commit —
    /// making a change made on another terminal reactive in this one's UI.
    pub fn apply_remote_atomic_full(
        &self,
        store: &Store<'_>,
        item: &OfflineQueueItem,
    ) -> Result<ApplyOutcome, CoreError> {
        // A quarantined item must not be retried by every subsequent page
        // pull. Operators can inspect the retained payload and explicitly
        // requeue it after correcting the source or client version.
        if store.is_remote_failure_dead_lettered(&item.id)? {
            return Ok(ApplyOutcome::default());
        }

        let tx = store.conn().unchecked_transaction()?;
        let already: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM sync_applied_items WHERE item_id = ?1)",
            rusqlite::params![item.id],
            |row| row.get(0),
        )?;
        if already {
            tx.commit()?;
            return Ok(ApplyOutcome::default());
        }

        match self.apply_remote_in_tx(&tx, item) {
            Ok(()) => {
                store.mark_remote_item_applied_in_tx(&tx, &item.id, &item.action)?;
                store.clear_remote_failure_in_tx(&tx, &item.id)?;
                tx.commit()?;
                Ok(ApplyOutcome {
                    applied: true,
                    settings_change: settings_change_of(item),
                })
            }
            Err(error) => {
                drop(tx);
                store.record_remote_failure(
                    &item.id,
                    &item.action,
                    &item.payload,
                    &error.to_string(),
                    3,
                )?;
                Err(error)
            }
        }
    }

    /// Apply a remote mutation using a caller-owned transaction.
    #[allow(deprecated)]
    fn apply_remote_in_tx(
        &self,
        tx: &rusqlite::Transaction<'_>,
        item: &OfflineQueueItem,
    ) -> Result<(), CoreError> {
        match item.action.as_str() {
            "complete_sale" => {
                let payload: SalePayload = serde_json::from_str(&item.payload)
                    .map_err(|e| CoreError::Internal(format!("invalid sale payload: {e}")))?;
                for line in &payload.line_items {
                    Store::new(tx).adjust_stock_in_tx(tx, &line.sku, -line.qty)?;
                }
            }
            "stock.adjusted" => {
                let payload: Value = serde_json::from_str(&item.payload)
                    .map_err(|e| CoreError::Internal(format!("invalid stock payload: {e}")))?;
                let apply_one = |value: Value| -> Result<(), CoreError> {
                    let sub: StockAdjustmentPayload = serde_json::from_value(value)
                        .map_err(|e| CoreError::Internal(format!("invalid stock payload: {e}")))?;
                    apply_stock_adjustment_delta_in_tx(tx, &sub)?;
                    Ok(())
                };
                if payload.get("merge_type").and_then(|m| m.as_str()) == Some("crdt_delta") {
                    apply_one(payload.get("local").cloned().unwrap_or(Value::Null))?;
                    apply_one(payload.get("remote").cloned().unwrap_or(Value::Null))?;
                } else {
                    apply_one(payload)?;
                }
            }
            "product.created" => {
                let payload: Value = serde_json::from_str(&item.payload)
                    .map_err(|e| CoreError::Internal(format!("invalid product payload: {e}")))?;
                let sku = payload["sku"].as_str().unwrap_or("");
                let name = payload["name"].as_str().unwrap_or("");
                let price_minor = payload["price_minor"].as_i64().unwrap_or(-1);
                let currency = payload["currency"].as_str().unwrap_or("");
                let currency_parsed: oz_core::Currency =
                    currency
                        .parse()
                        .map_err(|e: oz_core::money::InvalidCurrencyCode| {
                            CoreError::Internal(format!("invalid currency in sync payload: {e}"))
                        })?;
                let initial_stock = payload["initial_stock"].as_i64().unwrap_or(0);
                let product_type = payload["product_type"].as_str().unwrap_or("retail");
                Store::new(tx).create_product_if_absent_in_tx(
                    tx,
                    sku,
                    name,
                    oz_core::Money {
                        minor_units: price_minor,
                        currency: currency_parsed,
                    },
                    payload["category_id"].as_str(),
                    payload["barcode"].as_str(),
                    initial_stock,
                    product_type,
                )?;
            }
            "stock.movement" => {
                let payload: Value = serde_json::from_str(&item.payload).map_err(|e| {
                    CoreError::Internal(format!("invalid stock.movement payload: {e}"))
                })?;
                let apply_one = |value: &Value| -> Result<(), CoreError> {
                    let m: StockMovementPayload =
                        serde_json::from_value(value.clone()).map_err(|e| {
                            CoreError::Internal(format!("invalid stock.movement payload: {e}"))
                        })?;
                    Store::new(tx).insert_stock_movement_in_tx(
                        tx,
                        &m.id,
                        &m.item_id,
                        m.delta,
                        m.reason.as_deref(),
                        m.source_terminal_id.as_deref(),
                        m.source_user_id.as_deref(),
                        &m.store_id,
                        &m.created_at,
                    )
                };
                if payload.get("merge_type").and_then(|m| m.as_str()) == Some("crdt_delta") {
                    apply_one(payload.get("local").unwrap_or(&Value::Null))?;
                    apply_one(payload.get("remote").unwrap_or(&Value::Null))?;
                } else {
                    apply_one(&payload)?;
                }
            }
            // SYNC-10: a settings change made on another terminal — write the
            // value row and a versioned delta row inside this transaction.
            // `write_delta` uses a nested SAVEPOINT, which is safe inside the
            // caller's transaction; a delta failure is non-fatal (the value
            // row still landed) and the change is still reported so the UI
            // refetches (matches `set_tracked`'s delta philosophy).
            "settings.update" | "settings.change" => {
                let payload: SettingsUpdatePayload = serde_json::from_str(&item.payload)
                    .map_err(|e| CoreError::Internal(format!("invalid settings payload: {e}")))?;
                // The funnel accessor decides AND warns (key + policy label,
                // never the value). A false return is a refusal — the row and its
                // delta are both skipped and the batch continues; an Err is a SQL
                // failure, which `?` propagates exactly as before.
                if Settings::set_with_policy(
                    tx,
                    &payload.key,
                    &payload.value,
                    IngestPolicy::RemoteSync,
                )? {
                    if let Err(e) = Settings::write_delta(
                        tx,
                        &payload.key,
                        &payload.value,
                        &payload.terminal_id,
                    ) {
                        tracing::warn!(
                            key = %payload.key,
                            terminal_id = %payload.terminal_id,
                            error = %e,
                            "sync settings delta write failed (non-fatal)"
                        );
                    }
                }
            }
            // A sale completed on the CLOUD (payment captured via the
            // Stripe/Square webhook) — finalize the pending sale locally.
            // The webhook enqueues `{"sale_id": …}`; without this arm the
            // item dead-lettered as "unsupported" and the sale stayed
            // pending forever. `finalize_sale` is idempotent (only
            // transitions status='pending' → 'completed').
            "finalize_sale" => {
                let payload: FinalizeSalePayload = serde_json::from_str(&item.payload)
                    .map_err(|e| CoreError::Internal(format!("invalid finalize payload: {e}")))?;
                Store::finalize_sale_in_tx(tx, &payload.sale_id)?;
            }
            _ => {
                return Err(CoreError::Internal(format!(
                    "unsupported remote sync action: {}",
                    item.action
                )));
            }
        }
        Ok(())
    }

    /// Apply a remote item to the local store.
    ///
    /// Parses the `action` field and dispatches to the appropriate local
    /// mutation (stock deduction for sales, stock adjustment, etc.).
    #[allow(deprecated)]
    pub fn apply_remote(
        &self,
        store: &Store<'_>,
        item: &OfflineQueueItem,
    ) -> Result<(), CoreError> {
        match item.action.as_str() {
            // A sale completed on another terminal — deduct stock.
            "complete_sale" => {
                let payload: SalePayload = serde_json::from_str(&item.payload)
                    .map_err(|e| CoreError::Internal(format!("invalid sale payload: {e}")))?;
                for line in &payload.line_items {
                    store.adjust_stock(&line.sku, -line.qty)?;
                }
                Ok(())
            }
            // Stock adjustment from another terminal. Supports BOTH a flat
            // `{sku, delta}` payload AND the SYNC-05 CRDT merge envelope
            // (`{local, remote, merge_type: "crdt_delta"}`) produced by
            // `resolve_stock_crdt` — both deltas are valid CRDT facts and
            // must be applied. NOTE: `adjust_stock` is NOT idempotent (it
            // appends a new stock_movements row), so re-applying a merged
            // winner must be prevented by the caller's replay ledger / queue
            // dedup (the daemon's sync_applied_items + mark-synced guards).
            "stock.adjusted" => {
                let payload: Value = serde_json::from_str(&item.payload)
                    .map_err(|e| CoreError::Internal(format!("invalid stock payload: {e}")))?;
                let apply_one = |value: Value| -> Result<(), CoreError> {
                    let sub: StockAdjustmentPayload = serde_json::from_value(value)
                        .map_err(|e| CoreError::Internal(format!("invalid stock payload: {e}")))?;
                    // Same dispatch as the atomic arm: both pull paths must
                    // land a delta identically, located or not. Each delta
                    // commits in its own rusqlite transaction.
                    let tx = store.conn().unchecked_transaction()?;
                    apply_stock_adjustment_delta_in_tx(&tx, &sub)?;
                    tx.commit()?;
                    Ok(())
                };
                if payload.get("merge_type").and_then(|m| m.as_str()) == Some("crdt_delta") {
                    apply_one(payload.get("local").cloned().unwrap_or(Value::Null))?;
                    apply_one(payload.get("remote").cloned().unwrap_or(Value::Null))?;
                } else {
                    apply_one(payload)?;
                }
                Ok(())
            }
            // A new product created on another terminal — create locally.
            "product.created" => {
                let payload: serde_json::Value = serde_json::from_str(&item.payload)
                    .map_err(|e| CoreError::Internal(format!("invalid product payload: {e}")))?;
                let sku = payload["sku"].as_str().unwrap_or("");
                let name = payload["name"].as_str().unwrap_or("Unknown");
                let price_minor = payload["price_minor"].as_i64().unwrap_or(0);
                let currency = payload["currency"].as_str().unwrap_or("USD");
                let currency_parsed: oz_core::Currency =
                    currency
                        .parse()
                        .map_err(|e: oz_core::money::InvalidCurrencyCode| {
                            CoreError::Internal(format!("invalid currency in sync payload: {e}"))
                        })?;
                if !sku.is_empty() && store.get_product(sku).ok().flatten().is_none() {
                    let price = oz_core::Money {
                        minor_units: price_minor,
                        currency: currency_parsed,
                    };
                    let category_id = payload["category_id"].as_str();
                    let barcode = payload["barcode"].as_str();
                    let initial_stock = payload["initial_stock"].as_i64().unwrap_or(0);
                    let product_type = payload["product_type"].as_str().unwrap_or("retail");
                    store.create_product(
                        sku,
                        name,
                        price,
                        category_id,
                        barcode,
                        initial_stock,
                        Some(product_type),
                    )?;
                }
                Ok(())
            }
            // ADR #6: Remote stock movement from another store or register.
            // Insert directly into the ledger; the daemon rebuilds the
            // stock_summary cache after applying all remote items. Also
            // accepts the SYNC-05 CRDT merge envelope (both rows inserted).
            "stock.movement" => {
                let payload: Value = serde_json::from_str(&item.payload).map_err(|e| {
                    CoreError::Internal(format!("invalid stock.movement payload: {e}"))
                })?;
                let apply_one = |value: &Value| -> Result<(), CoreError> {
                    let m: StockMovementPayload =
                        serde_json::from_value(value.clone()).map_err(|e| {
                            CoreError::Internal(format!("invalid stock.movement payload: {e}"))
                        })?;
                    store.insert_stock_movement(
                        &m.id,
                        &m.item_id,
                        m.delta,
                        m.reason.as_deref(),
                        m.source_terminal_id.as_deref(),
                        m.source_user_id.as_deref(),
                        &m.store_id,
                        &m.created_at,
                    )
                };
                if payload.get("merge_type").and_then(|m| m.as_str()) == Some("crdt_delta") {
                    apply_one(payload.get("local").unwrap_or(&Value::Null))?;
                    apply_one(payload.get("remote").unwrap_or(&Value::Null))?;
                } else {
                    apply_one(&payload)?;
                }
                Ok(())
            }
            // SYNC-10 parity: the legacy (non-atomic) dispatcher applies
            // remote settings changes with the same row + delta semantics.
            "settings.update" | "settings.change" => {
                let payload: SettingsUpdatePayload = serde_json::from_str(&item.payload)
                    .map_err(|e| CoreError::Internal(format!("invalid settings payload: {e}")))?;
                // Same accessor as the atomic arm. A refusal returns false,
                // writes nothing, and consumes the item rather than retrying it
                // forever; the accessor already emitted the warn line.
                if !Settings::set_with_policy(
                    store.conn(),
                    &payload.key,
                    &payload.value,
                    IngestPolicy::RemoteSync,
                )? {
                    return Ok(());
                }
                Settings::set(store.conn(), &payload.key, &payload.value)?;
                if let Err(e) = Settings::write_delta(
                    store.conn(),
                    &payload.key,
                    &payload.value,
                    &payload.terminal_id,
                ) {
                    tracing::warn!(
                        key = %payload.key,
                        terminal_id = %payload.terminal_id,
                        error = %e,
                        "sync settings delta write failed (non-fatal)"
                    );
                }
                Ok(())
            }
            // A sale completed on the CLOUD (payment captured via the
            // Stripe/Square webhook) — finalize the pending sale locally.
            // Idempotent: only transitions status='pending' → 'completed'.
            "finalize_sale" => {
                let payload: FinalizeSalePayload = serde_json::from_str(&item.payload)
                    .map_err(|e| CoreError::Internal(format!("invalid finalize payload: {e}")))?;
                store.finalize_sale(&payload.sale_id)?;
                Ok(())
            }
            // Unsupported action — log and skip.
            _ => {
                tracing::warn!(action = %item.action, "unsupported remote sync action");
                Ok(())
            }
        }
    }
}

/// Extract the settings change an item carries, if any (SYNC-10).
///
/// Called only on the successful-apply path of
/// [`SyncQueue::apply_remote_atomic_full`]. The apply arm parses the same
/// `SettingsUpdatePayload` before it can succeed, so this re-parse can
/// never diverge from what was applied — it only exists to surface the
/// changed key and originating terminal for `SettingsUpdated`.
fn settings_change_of(item: &OfflineQueueItem) -> Option<(String, String)> {
    if item.action != "settings.update" && item.action != "settings.change" {
        return None;
    }
    let payload: SettingsUpdatePayload = serde_json::from_str(&item.payload).ok()?;
    // A refused key was never applied, so it must not be reported as a change:
    // the daemon publishes `SettingsUpdated` from this and the UI would refetch
    // a value that the ingest gate deliberately did not write.
    if !remote_sync_admits(&payload.key) {
        return None;
    }
    Some((payload.key, payload.terminal_id))
}

impl Default for SyncQueue {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
#[path = "queue_tests.rs"]
mod tests;
