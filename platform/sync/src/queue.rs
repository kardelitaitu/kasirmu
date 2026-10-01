//! Sync Queue — local change log for offline-first replication.
/*
last audited 26-09-06 by DSH (offline-sync spec verification pass; prior slice-B deep read by RSA-Agent 25-07-26)
crate: platform-sync | status: SAFE | lint: CLEAN
findings: exemplary — apply_remote_atomic_full runs quarantine gate, receipt-exists check, domain mutation, and receipt insert in ONE transaction (crash-safe replay protection); failure path drops the tx then records the failure — with retry budget 1 for a permanent failure (CoreError::is_permanent: Validation/NotFound/Conflict, quarantined on the FIRST failure) and 3 for a transient one; CRDT delta merge arms for stock payloads; SYNC-10 settings with non-fatal delta write (savepoint-safe inside caller tx); finalize_sale idempotent pending-to-completed only; unsupported actions fail closed; apply_push_conflict is the single SYNC-02 shared resolver entry; apply_remote is the deprecated non-atomic legacy mirror. CORRECTED TWICE — the earlier "pull items are not validated" concern was WRONG for sku/name/price/currency: the product.created arm's unwrap_or("")/unwrap_or(-1) defaults are caught at the storage boundary, since create_product_if_absent_in_tx rejects blank/oversize sku+name and negative price_minor/initial_stock, and returns CoreError::Conflict on a same-sku-different-data replay (a remote update that disagrees is NOT silently overwritten — it fails and dead-letters visibly). BUT the same claim was FALSE for product_type (MSL-81): the producer's ProductCreated event cannot carry a type at all, so the arm's unwrap_or("retail") invented a LEGAL value that the validation layer cannot distinguish from data, and the store then compared it — dead-lettering a byte-identical replay of any non-retail product as a spurious Conflict. Fixed by passing absence through as absence (create_product_if_absent_with_tx takes Option<&str>; None is not compared). LESSON: a default that is a PLAUSIBLE value is more dangerous than one that is invalid, because the validation designed to catch the invalid ones cannot see it. Every other pull arm parses a typed serde struct (missing required fields fail deserialization) or a validating store fn, so the whole pull path is fail-closed and conflict-visible without a separate payload-validation layer.
next: none | perf: prepared upserts
DONE 2026-10-04: the former next item — 'malformed/conflicting pull items burn the
retry-3 budget before dead-lettering; consider classifying apply-time
Validation/Conflict errors as non-retryable to fail fast' — is closed.
CoreError::is_permanent (Validation/NotFound/Conflict) now records max_attempts=1
at the failure site, so a permanent poison item is quarantined on its FIRST
failure instead of holding the pull anchor for two more cycles; a transient
failure (Db/Platform/Internal/MoneyOverflow/stock contention, plus
permission/subscription/licence conditions) keeps the three-attempt budget.
*/
//!
//! Wraps the `kasirmu_core` offline queue Store methods into a clean interface
//! with additional tracking for conflict resolution and last-sync timing.
//!
//! Settings items are the one action type that is NOT applied verbatim: both
//! dispatchers (`apply_remote_in_tx` and the legacy `apply_remote`) write through
//! `Settings::set_with_policy(..., IngestPolicy::RemoteSync)`, the sealed policy
//! owned by platform-core and delegated by the `kasirmu_core::Settings` facade, so a
//! remote item cannot plant a credential
//! (`local_api.secret`, `license.api_key`, the gateway keys) or a device-bound
//! identity (`machine_id`, `sync_terminal_id`) on this install. Nothing in
//! `transport` or `sync_api` signs or MACs an item, so the sender is not an
//! authority. A refusal warns and continues — it never aborts the batch and
//! never logs the value.

use kasirmu_core::db::Store;
use kasirmu_core::db::offline::SyncStatusSummary;
use kasirmu_core::error::CoreError;
use kasirmu_core::offline::{OfflineQueueItem, OfflineQueueStatus};
use kasirmu_core::settings::IngestPolicy;
// `queue_tests.rs` reaches the `admits()` trait through `use super::*` to pin the
// remote-ingest gate directly; the library build gets it via `queue::appliers`,
// so an unconditional import here would be unused.
#[cfg(test)]
use kasirmu_core::settings::IngestPolicyKind;
use kasirmu_core::settings::Settings;
use serde_json::Value;
pub mod appliers;
pub use appliers::{ApplyOutcome, ResolvedItem};
// The appliers are private to the sync::queue MODULE: the dispatcher here calls
// the ones it needs, and nothing outside needs the payload types.
use appliers::{
    FinalizeSalePayload, PaymentPayload, RefundPayload, SalePayload, SettingsUpdatePayload,
    StockAdjustmentPayload, StockMovementPayload, VoidSalePayload, apply_refund_with_sale_in_tx,
    apply_stock_adjustment_delta_in_tx, apply_void_sale_in_tx, credit_refund_effect_without_sale,
    envelope_deltas, insert_payment_in_tx, payment_already_applied, refund_already_applied,
    remote_effect_key, remote_sync_admits, sale_completed_here_in_tx,
};

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
            // Preserve the winner's IDENTITY, not just its action and payload.
            // The resolver built this row on purpose (conflict.rs
            // resolve_stock_crdt): the id it minted, the tenant the delta
            // belongs to, the `max(local, remote)` retry ceiling and the
            // originating terminal. The plain enqueue helpers would mint a
            // fresh uuid, reset retry_count to 0 and move the row to tenant
            // "default" — so a merge that keeps conflicting would acquire a new
            // server-side identity every cycle, never hit the retry bound, and a
            // multi-store delta would re-enqueue under the wrong tenant. Reusing
            // the SAME row id is what keeps the replay idempotent (ADR #6).
            store.enqueue_offline_preserving_item(&resolved.winner)?;
        }
        Ok(())
    }

    /// Apply a push-conflict outcome using the shared ADR #21 resolver.
    ///
    /// **This is the single conflict-application service** used by both the
    /// immediate `SyncEngine` (crate::SyncEngine) and the background
    /// `SyncDaemon` (crate::daemon::SyncDaemon), so the same ADR #21
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
    /// `apply_remote_atomic_full` (Self::apply_remote_atomic_full) for the
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
    /// `apply_remote_atomic` (Self::apply_remote_atomic), but the outcome
    /// also carries the changed settings key and its originating terminal so
    /// the sync daemon can publish `SettingsUpdated` after the commit —
    /// making a change made on another terminal reactive in this one's UI.
    ///
    /// C3: the receipt is keyed on the EFFECT, not only on the delivery. A
    /// re-delivered effect — the same sale or refund arriving under a
    /// DIFFERENT item id — is recognised by its effect key and is not applied
    /// a second time. The effect is named by `remote_effect_key` before the
    /// item is applied; an action that cannot name a single effect yields
    /// `None` and keeps the pre-C3 delivery-only behaviour.
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

        // ── C3 (slice S4): THE ORIGIN GATE ──────────────────────────────
        // A mutation THIS terminal originated has already been applied here —
        // the sale deducted its own stock before it was ever pushed — so
        // pulling it back and applying it again deducts a second time. On the
        // tablet the daemons and checkout share one database, so the duplicate
        // lands on the very inventory the sale already reduced.
        //
        // The gate runs BEFORE the transaction and WRITES A RECEIPT rather
        // than merely returning: an unreceipted skip would be re-attempted on
        // every page, and the effect would stay unrecorded; a receipt makes
        // the skip exactly as durable as an application.
        //
        // A NULL origin means UNKNOWN, never "self". The column was added with
        // no backfill and the producers that stamp it live outside this slice,
        // so a legacy or in-flight row is applied exactly as it is today. That
        // is the safe default: a wrongly suppressed deduction is silent stock
        // loss, which is worse than the duplicate being fixed.
        //
        // The identity is the persisted sync pairing id this install already
        // authenticates its pushes with — the same accessor the daemons read
        // (`daemon_tick.rs`, `daemon.rs`), reachable here because the store's
        // connection carries the settings row. It is only consulted when the
        // item actually carries an origin, so an ordinary pull pays no extra
        // query.
        if let Some(origin) = item.origin_terminal_id.as_deref()
            && Settings::get_sync_terminal_id(store.conn())?.as_deref() == Some(origin)
        {
            let tx = store.conn().unchecked_transaction()?;
            store.mark_remote_item_applied_with_effect_in_tx(
                &tx,
                &item.id,
                &item.action,
                remote_effect_key(&item.action, &item.payload).as_deref(),
            )?;
            store.clear_remote_failure_in_tx(&tx, &item.id)?;
            tx.commit()?;
            tracing::debug!(
                item_id = %item.id,
                action = %item.action,
                origin = %origin,
                "skipping a pulled item this terminal originated (already applied here)"
            );
            return Ok(ApplyOutcome::default());
        }

        let tx = store.conn().unchecked_transaction()?;

        // C3: the EFFECT is derived from the action and payload BEFORE the
        // item is applied, because the receipt below is keyed on it and the
        // duplicate must be recognised before the mutation runs, not undone
        // after it. The arms are unchanged: every effect key is a field of
        // the payload the originator minted (see `remote_effect_key`).
        let effect_key = remote_effect_key(&item.action, &item.payload);

        // Two questions, two probes. `item_id` proves THIS item was
        // delivered; `effect_key` proves the mutation it caused happened. A
        // redelivery of the same effect under a DIFFERENT item id is caught
        // only by the effect key — the defect this receipt exists to close.
        let already: bool = if let Some(key) = effect_key.as_deref() {
            tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM sync_applied_items WHERE item_id = ?1 OR effect_key = ?2)",
                rusqlite::params![item.id, key],
                |row| row.get(0),
            )?
        } else {
            tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM sync_applied_items WHERE item_id = ?1)",
                rusqlite::params![item.id],
                |row| row.get(0),
            )?
        };
        if already {
            tx.commit()?;
            return Ok(ApplyOutcome::default());
        }

        match self.apply_remote_in_tx(&tx, item) {
            Ok(()) => {
                store.mark_remote_item_applied_with_effect_in_tx(
                    &tx,
                    &item.id,
                    &item.action,
                    effect_key.as_deref(),
                )?;
                store.clear_remote_failure_in_tx(&tx, &item.id)?;
                tx.commit()?;
                Ok(ApplyOutcome {
                    applied: true,
                    settings_change: settings_change_of(item),
                })
            }
            Err(error) => {
                drop(tx);
                // A permanent failure (a malformed payload, a missing
                // referenced row, an id/conflict, a denied permission) will
                // never succeed on replay, so it is quarantined on its FIRST
                // failure rather than burning the three-attempt budget and
                // holding the pull anchor back for two more cycles. A
                // transient failure (Db/Platform/Internal/MoneyOverflow/
                // stock contention) keeps the full budget. See
                // CoreError::is_permanent.
                let max_attempts = if error.is_permanent() { 1 } else { 3 };
                store.record_remote_failure(
                    &item.id,
                    &item.action,
                    &item.payload,
                    &error.to_string(),
                    max_attempts,
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
                // C3 (slice S4) SECONDARY guard: the origin column is absent on
                // every row written before the schema slice and on any producer
                // that did not stamp it, so the pre-transaction gate cannot see
                // those. The sale's OWN durable row is a cheap second opinion —
                // this arm never creates a sales row, so a local row for this
                // sale_id that NAMES this terminal means this terminal already
                // completed the sale and already deducted its stock.
                //
                // Same policy as the primary gate: absent, NULL or unresolvable
                // means "not proven self-originated", never "not
                // self-originated", so the deduction is applied as today.
                if let Some(sale_id) = payload.sale_id.as_deref()
                    && sale_completed_here_in_tx(tx, sale_id)?
                {
                    tracing::debug!(
                        item_id = %item.id,
                        sale_id = %sale_id,
                        "complete_sale already applied on this terminal; not deducting again"
                    );
                    return Ok(());
                }
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
                for delta in envelope_deltas(&payload) {
                    apply_one(delta)?;
                }
            }
            "product.created" => {
                let payload: Value = serde_json::from_str(&item.payload)
                    .map_err(|e| CoreError::Internal(format!("invalid product payload: {e}")))?;
                let sku = payload["sku"].as_str().unwrap_or("");
                let name = payload["name"].as_str().unwrap_or("");
                let price_minor = payload["price_minor"].as_i64().unwrap_or(-1);
                let currency = payload["currency"].as_str().unwrap_or("");
                let currency_parsed: kasirmu_core::Currency =
                    currency
                        .parse()
                        .map_err(|e: kasirmu_core::money::InvalidCurrencyCode| {
                            CoreError::Internal(format!("invalid currency in sync payload: {e}"))
                        })?;
                let initial_stock = payload["initial_stock"].as_i64().unwrap_or(0);
                // The `ProductCreated` domain event has no `product_type` field
                // (`foundation/src/events.rs`), so the enqueuer cannot send one
                // and the key is legitimately absent on every payload this arm
                // sees. Defaulting it to `"retail"` here made the store's
                // identity comparison reject a faithful replay of any non-retail
                // product as a same-SKU-different-payload conflict, dead-lettering
                // the item. Absent is passed through as absent.
                let product_type = payload["product_type"].as_str();
                Store::new(tx).create_product_if_absent_with_tx(
                    tx,
                    sku,
                    name,
                    kasirmu_core::Money {
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
                for delta in envelope_deltas(&payload) {
                    apply_one(&delta)?;
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
                )? && let Err(e) =
                    Settings::write_delta(tx, &payload.key, &payload.value, &payload.terminal_id)
                {
                    tracing::warn!(
                        key = %payload.key,
                        terminal_id = %payload.terminal_id,
                        error = %e,
                        "sync settings delta write failed (non-fatal)"
                    );
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
            // C4 (slice S1): a refund recorded on another terminal. Idempotent
            // on the refund's OWN durable row, never on the queue receipt.
            "refund_sale" => {
                let payload: RefundPayload = serde_json::from_str(&item.payload)
                    .map_err(|e| CoreError::Internal(format!("invalid refund payload: {e}")))?;
                if refund_already_applied(tx, &payload.id)? {
                    return Ok(());
                }
                let sale_present: bool = tx.query_row(
                    "SELECT EXISTS(SELECT 1 FROM sales WHERE id = ?1)",
                    rusqlite::params![payload.sale_id],
                    |row| row.get(0),
                )?;
                if sale_present {
                    apply_refund_with_sale_in_tx(tx, &payload)?;
                } else {
                    // The refund row cannot be written here: `refunds.sale_id`
                    // is a real FK to `sales(id)` and this terminal has no
                    // sales row for it. The EFFECT still applies, and the item
                    // is consumed rather than dead-lettered — an absent sale is
                    // a topology fact, not a malformed payload.
                    credit_refund_effect_without_sale(tx, &payload)?;
                }
            }
            // C4 (slice S1): a void recorded on another terminal. The status
            // CAS is the idempotency decision, and its zero-row branch is
            // disambiguated so a benign replay and a genuine conflict are not
            // the same outcome.
            "void_sale" => {
                let payload: VoidSalePayload = serde_json::from_str(&item.payload)
                    .map_err(|e| CoreError::Internal(format!("invalid void payload: {e}")))?;
                apply_void_sale_in_tx(tx, &payload)?;
            }
            // C4 (slice S1): a tender recorded on another terminal.
            "payment.recorded" => {
                let payload: PaymentPayload = serde_json::from_str(&item.payload)
                    .map_err(|e| CoreError::Internal(format!("invalid payment payload: {e}")))?;
                if payment_already_applied(tx, &payload)? {
                    return Ok(());
                }
                let sale_present: bool = tx.query_row(
                    "SELECT EXISTS(SELECT 1 FROM sales WHERE id = ?1)",
                    rusqlite::params![payload.sale_id],
                    |row| row.get(0),
                )?;
                if sale_present {
                    insert_payment_in_tx(tx, &payload)?;
                }
                // No sale here means no `payments` row (the FK forbids it) and
                // no further effect to reproduce: a payment moves no stock and
                // no loyalty, and this arm must never fabricate a sales row.
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
            // must be applied. A flattened re-merge additionally carries its
            // surplus deltas in `extra`; every one is applied. NOTE: `adjust_stock` is NOT idempotent (it
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
                for delta in envelope_deltas(&payload) {
                    apply_one(delta)?;
                }
                Ok(())
            }
            // A new product created on another terminal — create locally.
            //
            // ⚠️ THIS ARM BELONGS TO A NON-PRODUCTION MIRROR, and its probe keeps a
            // fail-blind shape the LIVE arm does not have. Recorded rather than
            // repaired: repairing it would change what 40+ existing tests exercise
            // while altering no production behaviour.
            //
            // "Non-production" is MEASURED, not inferred from the name. `apply_remote`
            // (this fn) has ZERO production callers — every production path goes
            // through `apply_remote_atomic` / `apply_remote_atomic_full`
            // (`lib.rs:742`, `daemon_tick.rs:776`, `pg_daemon.rs:904`), and this
            // function is reached only from `queue_tests.rs`. The LIVE
            // `product.created` arm above dispatches to
            // `create_product_if_absent_with_tx`, which probes with
            // `query_row(...).optional()?` — the `?` PROPAGATES a read error, so the
            // live path has no such swallow.
            //
            // TWO defects here are real for anyone who reads this arm as production
            // code, and BOTH are fixed by copying the live arm above rather than by
            // patching this one in place:
            //
            // (a) `.ok().flatten().is_none()` on the probe below (line ~660) makes a
            //     FAILED read indistinguishable from a missing product, so a
            //     transient store fault falls into the create branch and then fails
            //     on `products.sku`'s UNIQUE constraint (`20260813_init.sql:441`) —
            //     reporting a duplicate-product problem that does not exist while
            //     the real fault stays hidden.
            //
            // (b) The payload defaults are VALID-LOOKING, which is the sharper
            //     defect and the reason this arm cannot simply be copied verbatim
            //     from the live one. Here `name` defaults to "Unknown",
            //     `price_minor` to `0` and `currency` to "USD". A drifted payload
            //     missing those keys therefore creates a REAL product named
            //     "Unknown" priced at 0 USD, because every downstream guard passes:
            //     `create_product` checks only that the name is non-empty and the
            //     price is non-negative, and both hold. Contrast the LIVE arm
            //     (line ~417), which defaults `price_minor` to the INVALID sentinel
            //     `-1` so the same guard rejects it, and leaves `sku`/`name` as ""
            //     so the empty-string checks fire. The live arm's defaults all land
            //     on a REFUSAL; this arm's all land on a plausible product.
            "product.created" => {
                let payload: serde_json::Value = serde_json::from_str(&item.payload)
                    .map_err(|e| CoreError::Internal(format!("invalid product payload: {e}")))?;
                let sku = payload["sku"].as_str().unwrap_or("");
                let name = payload["name"].as_str().unwrap_or("Unknown");
                let price_minor = payload["price_minor"].as_i64().unwrap_or(0);
                let currency = payload["currency"].as_str().unwrap_or("USD");
                let currency_parsed: kasirmu_core::Currency =
                    currency
                        .parse()
                        .map_err(|e: kasirmu_core::money::InvalidCurrencyCode| {
                            CoreError::Internal(format!("invalid currency in sync payload: {e}"))
                        })?;
                if !sku.is_empty() && store.get_product(sku).ok().flatten().is_none() {
                    let price = kasirmu_core::Money {
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
            // accepts the SYNC-05 CRDT merge envelope (all rows inserted, including
            // a flattened re-merge's `extra` deltas).
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
                for delta in envelope_deltas(&payload) {
                    apply_one(&delta)?;
                }
                Ok(())
            }
            // SYNC-10 parity: the legacy (non-atomic) dispatcher applies
            // remote settings changes with the same row + delta semantics.
            "settings.update" | "settings.change" => {
                let payload: SettingsUpdatePayload = serde_json::from_str(&item.payload)
                    .map_err(|e| CoreError::Internal(format!("invalid settings payload: {e}")))?;
                // Same accessor as the atomic arm, and the ONLY value write
                // on this arm: a refusal returns false (the accessor warned,
                // nothing was written) and the early return consumes the item
                // rather than retrying it forever; an admit has already
                // written the row through the funnel, so only the delta
                // remains. No raw second write may follow — a refused key must
                // never reach the database through any writer on this lane.
                if !Settings::set_with_policy(
                    store.conn(),
                    &payload.key,
                    &payload.value,
                    IngestPolicy::RemoteSync,
                )? {
                    return Ok(());
                }
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
            // C4 (slice S1) parity: the legacy dispatcher applies the three
            // arms with the same effect-level idempotency as the atomic one.
            // The caller's connection is used directly - the legacy path owns
            // no transaction and must not open one here.
            "refund_sale" => {
                let payload: RefundPayload = serde_json::from_str(&item.payload)
                    .map_err(|e| CoreError::Internal(format!("invalid refund payload: {e}")))?;
                let already: i64 = store.conn().query_row(
                    "SELECT EXISTS(SELECT 1 FROM refunds WHERE id = ?1)",
                    rusqlite::params![payload.id],
                    |row| row.get(0),
                )?;
                if already == 1 {
                    return Ok(());
                }
                let sale_present: bool = store.conn().query_row(
                    "SELECT EXISTS(SELECT 1 FROM sales WHERE id = ?1)",
                    rusqlite::params![payload.sale_id],
                    |row| row.get(0),
                )?;
                let tx = store.conn().unchecked_transaction()?;
                if sale_present {
                    apply_refund_with_sale_in_tx(&tx, &payload)?;
                } else {
                    credit_refund_effect_without_sale(&tx, &payload)?;
                }
                tx.commit()?;
                Ok(())
            }
            "void_sale" => {
                let payload: VoidSalePayload = serde_json::from_str(&item.payload)
                    .map_err(|e| CoreError::Internal(format!("invalid void payload: {e}")))?;
                let tx = store.conn().unchecked_transaction()?;
                apply_void_sale_in_tx(&tx, &payload)?;
                tx.commit()?;
                Ok(())
            }
            "payment.recorded" => {
                let payload: PaymentPayload = serde_json::from_str(&item.payload)
                    .map_err(|e| CoreError::Internal(format!("invalid payment payload: {e}")))?;
                if payment_already_applied(store.conn(), &payload)? {
                    return Ok(());
                }
                let sale_present: bool = store.conn().query_row(
                    "SELECT EXISTS(SELECT 1 FROM sales WHERE id = ?1)",
                    rusqlite::params![payload.sale_id],
                    |row| row.get(0),
                )?;
                if sale_present {
                    let tx = store.conn().unchecked_transaction()?;
                    insert_payment_in_tx(&tx, &payload)?;
                    tx.commit()?;
                }
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

#[cfg(test)]
#[path = "sync_client_divergence_tests.rs"]
mod divergence_tests;
