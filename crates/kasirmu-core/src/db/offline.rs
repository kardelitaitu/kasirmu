//! Offline Queue — enqueue, list, mark, delete offline sync items.
/*
last audited 25-07-26 by RSA-Agent (kasirmu-core slice B5: offline queue deep read)
crate: kasirmu-core | status: SAFE | lint: CLEAN
findings: sync plumbing production-grade — tenant-scoped variants throughout (SYNC-07: cross-tenant reads as NotFound/no-op), sync_applied_items idempotency ledger (INSERT OR IGNORE + in-tx variant co-located with the domain mutation), durable pull anchor with crash-safe write-after-apply ordering, atomic dead-letter requeue (predicate inside the DELETE) with anchor rewind; COR-20 CLOSED 2026-09-06: the dedup EXISTS check and the observability summary still degrade to their benign defaults (duplicate enqueue is replay-safe; dashboards show zeros), but every degradation now logs op + underlying error via log_degraded, and query_or_none separates the normal QueryReturnedNoRows empty case from real DB errors that .ok() previously conflated
next: none | perf: status summary is 4 small queries, fine at desktop scale
*/

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::error::CoreError;
use crate::offline::{OfflineQueueItem, OfflineQueueStatus, SyncPriority};

use super::Store;

/// COR-20: a degraded observability query must be visible in the log.
///
/// The defaults chosen on DB error are deliberately benign — the dedup
/// EXISTS check falls through to a normal enqueue (duplicate enqueues are
/// replay-safe via the server's idempotency ledger), and the status summary
/// reports zeros/None so dashboards degrade instead of failing. But a queue
/// that silently reads "0 failed" because its database is unhealthy is
/// exactly the hidden failure state the Phase 2 offline-sync spec forbids.
/// Every degradation logs the operation name and the underlying error so
/// the cause is discoverable without changing the benign behavior.
fn log_degraded(operation: &str, err: &rusqlite::Error) {
    tracing::warn!(
        op = operation,
        error = %err,
        "offline_queue query degraded to default (COR-20)"
    );
}

/// The identity this install stamps on the rows it produces (C3, slice S5a).
///
/// Read ONCE per enqueue call — never per row — from the same persisted
/// `sync_terminal_id` the sync daemons read to stamp their pushes. An
/// unpaired install has no id and the row keeps SQL NULL, which is the
/// migration's explicit contract: a guessed origin would make the
/// self-origin gate suppress a legitimate deduction (silent stock loss).
///
/// A read ERROR propagates instead of degrading to `None`. A NULL written
/// because the lookup failed is indistinguishable from a genuine "unpaired",
/// and it would silently reopen the double deduction this stamp exists to
/// close — the failure must be visible, not benign.
fn enqueue_origin(conn: &rusqlite::Connection) -> Result<Option<String>, CoreError> {
    Ok(crate::settings::Settings::get_sync_terminal_id(conn)?)
}

/// Decode a currency's raw bytes for a sync payload.
///
/// The outbox payload is JSON the pull side parses, so a non-UTF-8 currency
/// must be a hard error here (the same rejection `create_refund` performs
/// before it writes the row) rather than a payload the applier dead-letters
/// after the refund has already committed locally.
fn currency_str<'a>(
    currency: &'a crate::money::Currency,
    field: &'static str,
) -> Result<&'a str, CoreError> {
    std::str::from_utf8(&currency.0).map_err(|e| CoreError::Validation {
        field,
        message: format!("invalid UTF-8 in currency bytes: {e}"),
    })
}

/// Run a single-row observability query whose "no rows" answer is normal.
///
/// `Ok` → value; `QueryReturnedNoRows` → `None` silently (an empty queue is the
/// expected common case, not an error); any other DB error → `None` logged
/// via [`log_degraded`]. This separates the conflation `.ok()` performed.
fn query_or_none(operation: &str, result: Result<String, rusqlite::Error>) -> Option<String> {
    match result {
        Ok(v) => Some(v),
        Err(rusqlite::Error::QueryReturnedNoRows) => None,
        Err(e) => {
            log_degraded(operation, &e);
            None
        }
    }
}

/// Summary of offline queue status — counts by status and sync timing.
/// Used by P1-6 sync observability dashboard widgets.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncStatusSummary {
    /// Number of pending (unsynced) items.
    pub pending_count: i64,
    /// Number of successfully synced items.
    pub synced_count: i64,
    /// Number of failed items.
    pub failed_count: i64,
    /// Total retry count across all failed items.
    pub total_retry_count: i64,
    /// ISO-8601 timestamp of the most recently synced item, if any.
    pub last_synced_at: Option<String>,
    /// ISO-8601 timestamp of the oldest pending item, if any.
    pub oldest_pending_at: Option<String>,
    /// Number of items resolved via conflict during the last sync cycle.
    /// (P1-3: items whose last_error starts with "resolved: conflict").
    pub conflict_count: i64,
}

/// Durable pull anchor/cursor for the background sync daemon (SYNC-01).
///
/// Persisted in the single-row `sync_pull_state` table so the daemon only
/// fetches remote updates newer than the last successfully-applied page
/// (plus the opaque pagination cursor for the next page, P-3).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SyncPullState {
    /// ISO-8601 anchor timestamp of the last successfully applied page.
    pub since: Option<String>,
    /// Opaque pagination cursor for the next page (P-3). `None` when the
    /// previous page was the final one.
    pub cursor: Option<String>,
}

/// A retained failure from applying a remote sync item.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RemoteSyncFailure {
    /// Remote item identifier.
    pub item_id: String,
    /// Remote action name.
    pub action: String,
    /// Original payload retained for operator inspection.
    pub payload: String,
    /// Number of failed application attempts.
    pub attempts: i64,
    /// Most recent application error.
    pub last_error: String,
    /// Whether retry is exhausted and the item is quarantined.
    pub dead_lettered: bool,
}

impl Store<'_> {
    /// Enqueue a transaction for later sync (default tenant).
    pub fn enqueue_offline(
        &self,
        action: &str,
        payload: &str,
    ) -> Result<OfflineQueueItem, CoreError> {
        self.enqueue_offline_with_tenant(action, payload, "default")
    }

    /// Enqueue a transaction with dedup by action + payload.
    ///
    /// If a pending item with the same `action` and `payload` already
    /// exists, returns `Ok(None)` — no duplicate is created.
    /// Otherwise, enqueues normally and returns `Ok(Some(item))`.
    ///
    /// This prevents duplicate entries when the same sale completion,
    /// void, or adjustment is enqueued multiple times (e.g. due to
    /// network retry or cross-terminal propagation).
    pub fn enqueue_offline_dedup(
        &self,
        action: &str,
        payload: &str,
    ) -> Result<Option<OfflineQueueItem>, CoreError> {
        let exists: bool = match self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM offline_queue
              WHERE status = 'pending' AND action = ?1 AND payload = ?2)",
            params![action, payload],
            |row| row.get(0),
        ) {
            Ok(v) => v,
            // COR-20: a failed dedup check falls through to a normal enqueue
            // (replay-safe), but the DB error must be visible.
            Err(e) => {
                log_degraded("enqueue_offline_dedup.exists", &e);
                false
            }
        };

        if exists {
            return Ok(None);
        }
        self.enqueue_offline(action, payload).map(Some)
    }

    /// Enqueue a transaction for later sync, scoped to the given tenant.
    pub fn enqueue_offline_with_tenant(
        &self,
        action: &str,
        payload: &str,
        tenant_id: &str,
    ) -> Result<OfflineQueueItem, CoreError> {
        self.enqueue_offline_inner(action, payload, tenant_id, SyncPriority::Normal)
    }

    /// Enqueue a transaction with a specific sync priority (P-2).
    pub fn enqueue_offline_priority(
        &self,
        action: &str,
        payload: &str,
        priority: SyncPriority,
    ) -> Result<OfflineQueueItem, CoreError> {
        self.enqueue_offline_inner(action, payload, "default", priority)
    }

    /// Enqueue a transaction scoped to a tenant with a specific priority.
    ///
    /// OFF-09: this is the combined tenant + priority entry point so the
    /// command boundary can preserve both multi-store isolation and the
    /// P-2 priority tier in a single call.
    pub fn enqueue_offline_scoped(
        &self,
        action: &str,
        payload: &str,
        tenant_id: &str,
        priority: SyncPriority,
    ) -> Result<OfflineQueueItem, CoreError> {
        self.enqueue_offline_inner(action, payload, tenant_id, priority)
    }

    /// Enqueue a `settings.update` sync item for a local settings write,
    /// superseding any still-pending items for the same key in the same
    /// tenant (SYNC-10).
    ///
    /// The payload matches `SettingsUpdatePayload` (key/value/terminal_id)
    /// so the sync apply side can parse it. Items are Low priority —
    /// settings are low-frequency and the conflict resolver treats
    /// `settings.*` as version-LWW. Ordering is ENQUEUE-THEN-SUPERSEDE: an
    /// enqueue failure leaves the older pending items intact (pre-supersede
    /// behavior), while a supersede failure degrades to a duplicate pair
    /// that the replay-safe apply side already handles — never a lost update.
    pub fn enqueue_settings_update_superseding(
        &self,
        key: &str,
        value: &str,
        terminal_id: &str,
        tenant_id: &str,
    ) -> Result<(), CoreError> {
        let payload = serde_json::json!({
            "key": key,
            "value": value,
            "terminal_id": terminal_id,
        });
        let fresh = self.enqueue_offline_scoped(
            "settings.update",
            &payload.to_string(),
            tenant_id,
            SyncPriority::Low,
        )?;
        // Supersede older pending items for the SAME key AND SAME
        // terminal, exempting the item just created — it IS the newest
        // intent. The terminal filter keeps the supersede per-terminal:
        // terminal A's re-save must never cancel terminal B's still-pending
        // save for the same key (version-LWW attributes per terminal).
        // Malformed payloads are skipped defensively.
        let pending = self.list_pending_offline_for_tenant(tenant_id)?;
        for item in pending {
            if item.id == fresh.id || item.action != "settings.update" {
                continue;
            }
            let v: serde_json::Value = serde_json::from_str(&item.payload).unwrap_or_default();
            if v["key"].as_str() == Some(key) && v["terminal_id"].as_str() == Some(terminal_id) {
                self.delete_offline_item_for_tenant(&item.id, tenant_id)?;
            }
        }
        Ok(())
    }

    fn enqueue_offline_inner(
        &self,
        action: &str,
        payload: &str,
        tenant_id: &str,
        priority: SyncPriority,
    ) -> Result<OfflineQueueItem, CoreError> {
        // Enforce subscription offline grace period / read-only lock.
        // Once the offline grace period expires, transactions cannot be enqueued.
        self.enforce_pos_writable_for_tenant(tenant_id)?;

        let mut item = OfflineQueueItem::with_tenant(action, payload, tenant_id);
        item.priority = priority;
        item.origin_terminal_id = enqueue_origin(self.conn)?;
        self.conn.execute(
            "INSERT INTO offline_queue (id, action, payload, status, retry_count, last_error, created_at, synced_at, tenant_id, priority, origin_terminal_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![item.id, item.action, item.payload, item.status.as_stored_str(), item.retry_count, item.last_error, item.created_at, item.synced_at, item.tenant_id, item.priority as i32, item.origin_terminal_id],
        )?;
        Ok(item)
    }

    /// OUTBOX PRIMITIVE: write the queue row inside a CALLER-OWNED
    /// transaction, so the row is committed or rolled back together with the
    /// business write it describes.
    ///
    /// Why it exists: sync for sales is outbox-only - push reads
    /// `list_pending_offline` and nothing else, and there is no
    /// reconciliation sweep anywhere in the tree (every sweep found is
    /// session/memo expiry, audit retention or a cloud prune, and
    /// `payment_settlements.rs:9` says "stubs until the reconciliation job
    /// is implemented"). An enqueue that runs AFTER the sale commits - today
    /// it runs in an event handler on a SEPARATE connection
    /// (`platform/startup/src/lib.rs:112`), because the bus is in-process and
    /// the settlement's DB lock is already dropped - can be lost forever by a
    /// crash or a handler error in that window. `event_bus.rs:259-267` logs a
    /// handler Err and continues and `:268-281` catches a handler panic and
    /// continues, so the loss is silent; and it is invisible to the operator,
    /// because the queue screen reports pending / synced / failed /
    /// oldest-pending and a sale that was never enqueued contributes to none
    /// of them.
    ///
    /// Tenant is a REQUIRED argument on purpose. `enqueue_offline_priority`
    /// hardcodes `"default"` while the `SaleCompleted` event carries a
    /// `store_id`, so a multi-store caller that reaches for the priority
    /// helper enqueues another store's sale under `"default"` - a real
    /// pre-existing bug, found here and NOT fixed here because its callers are
    /// outside this change. This helper cannot be called that way by accident.
    ///
    /// Deliberately does NOT call `enforce_pos_writable_for_tenant`: the
    /// settlement path already enforced it on its own transaction
    /// (`sales_lifecycle.rs:176`), and re-checking through `self.conn` here
    /// would read outside the very transaction whose atomicity is the point.
    pub fn enqueue_offline_in_tx(
        tx: &rusqlite::Transaction<'_>,
        action: &str,
        payload: &str,
        tenant_id: &str,
        priority: SyncPriority,
    ) -> Result<OfflineQueueItem, CoreError> {
        let mut item = OfflineQueueItem::with_tenant(action, payload, tenant_id);
        item.priority = priority;
        // C3 S5a: same origin stamp as the non-transactional lane. This is the
        // lane the sale settlement uses, so a miss here would leave the gate
        // dormant for exactly the mutation the double deduction was seen on.
        item.origin_terminal_id = enqueue_origin(tx)?;
        tx.execute(
            "INSERT INTO offline_queue (id, action, payload, status, retry_count, last_error, created_at, synced_at, tenant_id, priority, origin_terminal_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![item.id, item.action, item.payload, item.status.as_stored_str(), item.retry_count, item.last_error, item.created_at, item.synced_at, item.tenant_id, item.priority as i32, item.origin_terminal_id],
        )?;
        Ok(item)
    }

    /// OUTBOX: write this sale's `complete_sale` row inside the settlement
    /// transaction, so the sync row and the sale are one atomic unit.
    ///
    /// Position is deliberate: the doors call this AFTER the sale row and its
    /// lines are written but BEFORE the payment inserts, so a failure later in
    /// the same transaction (a UNIQUE collision on payments.idempotency_key,
    /// say) takes the outbox row down with the sale. Placed just before
    /// `tx.commit()` it would be equally atomic but untestable - nothing can
    /// fail after it - so the earlier seat buys a real rollback proof.
    ///
    /// Tenant comes from the sale row, not from a literal: the queue is read
    /// per tenant and `enqueue_offline_priority` hardcodes "default".
    ///
    /// The payload is SHAPED like the one SaleSyncEnqueuer builds today
    /// (sale_id / total_minor / currency / customer_id / line_items with the
    /// same five line keys) so the apply side cannot tell the two writers
    /// apart. It is NOT relied on to be byte-identical to it - which is why
    /// the guard below keys on the sale id and not on the string.
    pub fn enqueue_sale_outbox_in_tx(
        tx: &rusqlite::Transaction<'_>,
        sale: &crate::Sale,
        currency: &str,
    ) -> Result<(), CoreError> {
        let tenant_id: String = tx.query_row(
            "SELECT COALESCE(tenant_id, 'default') FROM sales WHERE id = ?1",
            params![sale.id],
            |row| row.get(0),
        )?;
        let line_items: Vec<serde_json::Value> = sale
            .lines
            .iter()
            .map(|l| {
                serde_json::json!({
                    "sku": l.sku,
                    "qty": l.qty,
                    "unit_price_minor": l.unit_price.minor_units,
                    "tax_minor": l.tax_amount.minor_units,
                    "tax_rate_id": l.tax_rate_id,
                })
            })
            .collect();
        let payload = serde_json::json!({
            "sale_id": sale.id,
            "total_minor": sale.total.minor_units,
            "currency": currency,
            "customer_id": sale.customer_id,
            "line_items": line_items,
        })
        .to_string();
        Self::enqueue_offline_in_tx(
            tx,
            "complete_sale",
            &payload,
            &tenant_id,
            SyncPriority::Critical,
        )?;
        Ok(())
    }

    /// OUTBOX: write a refund's `refund_sale` row inside the refund
    /// transaction, so the sync row and the refund are one atomic unit.
    ///
    /// Position is deliberate: `create_refund` calls this AFTER the refunds
    /// header and its lines are written but BEFORE the stock credit, so a
    /// failure later in the same transaction (a line whose `sale_line_id` is
    /// absent from `deduction_locations`, say) takes the outbox row down with
    /// the refund. Placed just before `tx.commit()` it would be equally atomic
    /// but untestable - nothing can fail after it - so the earlier seat buys a
    /// real rollback proof.
    ///
    /// Tenant comes from the SALE row, not from `refunds.tenant_id`: the
    /// column exists (migration 20260827) but `create_refund` never sets it,
    /// so it reads 'default' for every refund this path writes. Reading it
    /// would file a multi-store refund under 'default' - the exact bug the
    /// sale helper's tenant argument exists to avoid.
    ///
    /// The payload is SHAPED like the one the pull-side arm parses
    /// (`platform/sync/src/queue.rs` `RefundPayload`: id / sale_id /
    /// total_minor / currency / reason / note / processed_by / created_at /
    /// lines with the same eight line keys), so the applier cannot tell this
    /// writer from any other. The refund `id` is the identity the arm is
    /// idempotent on (`refunds.id` is its own durable row), so it is carried
    /// verbatim. No origin field: `enqueue_offline_in_tx` stamps it.
    pub fn enqueue_refund_outbox_in_tx(
        tx: &rusqlite::Transaction<'_>,
        refund: &crate::Refund,
    ) -> Result<(), CoreError> {
        let tenant_id: String = tx.query_row(
            "SELECT COALESCE(tenant_id, 'default') FROM sales WHERE id = ?1",
            params![refund.sale_id],
            |row| row.get(0),
        )?;
        // Fail-closed on a malformed currency, exactly as `create_refund` does
        // before it writes the row: a payload the applier cannot read is a
        // dead-lettered refund, not a silent one.
        let currency = currency_str(&refund.total.currency, "currency")?;
        let mut lines = Vec::with_capacity(refund.lines.len());
        for line in &refund.lines {
            lines.push(serde_json::json!({
                "id": line.id,
                "sale_line_id": line.sale_line_id,
                "sku": line.sku,
                "qty": line.qty,
                "unit_minor": line.unit_price.minor_units,
                "line_minor": line.line_total.minor_units,
                "currency": currency_str(&line.unit_price.currency, "refund_line.currency")?,
                "created_at": line.created_at,
            }));
        }
        let payload = serde_json::json!({
            "id": refund.id,
            "sale_id": refund.sale_id,
            "total_minor": refund.total.minor_units,
            "currency": currency,
            "reason": refund.reason,
            "note": refund.note,
            "processed_by": refund.processed_by,
            "created_at": refund.created_at,
            "lines": lines,
        })
        .to_string();
        Self::enqueue_offline_in_tx(
            tx,
            "refund_sale",
            &payload,
            &tenant_id,
            SyncPriority::Critical,
        )?;
        Ok(())
    }

    /// OUTBOX: write a void's `void_sale` row inside the void transaction.
    ///
    /// A void's whole effect is the sale's own status, so the payload carries
    /// nothing but the sale id the pull-side arm compare-and-sets on - and
    /// that id is also the arm's identity (`sale:<id>:void`). Tenant comes
    /// from the sale row, same as the settlement helper.
    pub fn enqueue_void_sale_outbox_in_tx(
        tx: &rusqlite::Transaction<'_>,
        sale_id: &str,
    ) -> Result<(), CoreError> {
        let tenant_id: String = tx.query_row(
            "SELECT COALESCE(tenant_id, 'default') FROM sales WHERE id = ?1",
            params![sale_id],
            |row| row.get(0),
        )?;
        let payload = serde_json::json!({ "sale_id": sale_id }).to_string();
        Self::enqueue_offline_in_tx(
            tx,
            "void_sale",
            &payload,
            &tenant_id,
            SyncPriority::Critical,
        )?;
        Ok(())
    }

    /// OUTBOX: write one `payment.recorded` row per payment split, inside the
    /// settlement transaction, immediately after that split's INSERT.
    ///
    /// Per-split, not one row for the sale: the pull-side arm inserts ONE
    /// `payments` row per item and probes that row's own identity, so a single
    /// item carrying several tenders could not be replayed idempotently.
    ///
    /// The identity the arm probes is `idempotency_key` when the originator
    /// minted one (`idx_payments_idempotency_key` is UNIQUE, so a re-sent
    /// tender is the same tender whatever id it arrives under) and
    /// `payments.id` otherwise - both are carried, the key only when present.
    ///
    /// Tenant comes from the sale row: `payments` has no tenant column.
    pub fn enqueue_payment_recorded_outbox_in_tx(
        tx: &rusqlite::Transaction<'_>,
        payment_id: &str,
        sale_id: &str,
        split: &crate::PaymentSplitArg,
        currency: &str,
        created_at: &str,
    ) -> Result<(), CoreError> {
        let tenant_id: String = tx.query_row(
            "SELECT COALESCE(tenant_id, 'default') FROM sales WHERE id = ?1",
            params![sale_id],
            |row| row.get(0),
        )?;
        let payload = serde_json::json!({
            "id": payment_id,
            "sale_id": sale_id,
            "method": split.method,
            "amount_minor": split.amount_minor,
            "currency": currency,
            "created_at": created_at,
            "gateway_reference": split.gateway_reference,
            "gateway_status": split.gateway_status,
            "gateway_response": split.gateway_response,
            "idempotency_key": split.idempotency_key,
        })
        .to_string();
        Self::enqueue_offline_in_tx(
            tx,
            "payment.recorded",
            &payload,
            &tenant_id,
            SyncPriority::Critical,
        )?;
        Ok(())
    }

    /// OUTBOX: does a still-pending row for this action already exist for
    /// THIS SALE?
    ///
    /// Keyed on the sale id inside the payload rather than on the whole
    /// payload string, on purpose: `enqueue_offline_dedup` compares
    /// `action + payload` byte-for-byte, and the two writers of this row build
    /// the JSON from different places (a settlement from the `Sale` struct,
    /// the handler from the event), so any shape or key-order drift between
    /// them would silently turn "skip" into "second row" and push the sale
    /// twice. A substring probe on the quoted sale id needs no JSON1
    /// extension, cannot match a prefix of a longer id because the closing
    /// quote is part of the needle, and makes the invariant a property of the
    /// queue rather than a property of the caller.
    pub fn has_pending_outbox_row_for_sale(
        &self,
        action: &str,
        sale_id: &str,
    ) -> Result<bool, CoreError> {
        let needle = format!("\"sale_id\":\"{sale_id}\"");
        let exists: bool = self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM offline_queue
              WHERE status = 'pending' AND action = ?1 AND instr(payload, ?2) > 0)",
            params![action, needle],
            |row| row.get(0),
        )?;
        Ok(exists)
    }

    /// List all pending (unsynced) offline queue items, oldest first.
    pub fn list_pending_offline(&self) -> Result<Vec<OfflineQueueItem>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, action, payload, status, retry_count, last_error, created_at, synced_at, tenant_id, priority, origin_terminal_id
             FROM offline_queue WHERE status = 'pending' ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map([], Self::row_to_offline_queue_item)?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// List all offline queue items.
    pub fn list_all_offline(&self) -> Result<Vec<OfflineQueueItem>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, action, payload, status, retry_count, last_error, created_at, synced_at, tenant_id, priority, origin_terminal_id
             FROM offline_queue ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], Self::row_to_offline_queue_item)?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// List pending offline items scoped to a tenant.
    pub fn list_pending_offline_for_tenant(
        &self,
        tenant_id: &str,
    ) -> Result<Vec<OfflineQueueItem>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, action, payload, status, retry_count, last_error, created_at, synced_at, tenant_id, priority, origin_terminal_id
             FROM offline_queue WHERE status = 'pending' AND tenant_id = ?1 ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![tenant_id], Self::row_to_offline_queue_item)?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// Mark an offline queue item as synced.
    ///
    /// The transition is a guarded compare-and-set, not a blind write: the row
    /// must still be `pending` for the update to land, so a stale or double
    /// caller can neither re-mark an already-synced item nor — the case that
    /// loses data — overwrite a dead-lettered (`failed`) row's terminal state
    /// with `synced`. Same conditional-transition shape as `finalize_sale`
    /// (`WHERE id = ?2 AND status = 'pending'`).
    ///
    /// # Transaction behaviour
    ///
    /// SQLite has no nested `BEGIN`, so — exactly like [`Store::log_audit`] —
    /// this JOINS a caller-owned transaction and only opens its own in
    /// autocommit. A caller that rolls back therefore leaves the row un-marked;
    /// a caller with no transaction gets one, so the existence probe and the
    /// write that depends on it are atomic.
    ///
    /// # Errors
    ///
    /// [`CoreError::NotFound`] when the id does not exist. An id that exists in
    /// a non-pending state is an idempotent no-op returning `Ok(())` — duplicate
    /// id replays and daemon retries must not fail, and
    /// `mark_offline_synced_is_idempotent` pins that contract.
    pub fn mark_offline_synced(&self, id: &str) -> Result<(), CoreError> {
        if self.conn.is_autocommit() {
            let tx = self.conn.unchecked_transaction()?;
            Self::mark_synced_on(&tx, id)?;
            tx.commit()?;
            Ok(())
        } else {
            Self::mark_synced_on(self.conn, id)
        }
    }

    /// The guarded `pending -> synced` write, on a connection or on a
    /// caller-owned transaction (`Transaction` derefs to `Connection`).
    ///
    /// A row that exists but is not `pending` is not an error: the CAS
    /// correctly changed nothing, and the caller gets `Ok(())`.
    fn mark_synced_on(conn: &rusqlite::Connection, id: &str) -> Result<(), CoreError> {
        let affected = conn.execute(
            "UPDATE offline_queue SET status = 'synced', synced_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1 AND status = 'pending'",
            params![id],
        )?;
        if affected == 1 {
            return Ok(());
        }
        // rows == 0: the id is absent, or it is present in a non-pending state.
        // Only the first is an error; the second is the no-op the CAS exists to
        // produce. Probe instead of guessing which one happened.
        let exists: i64 = conn.query_row(
            "SELECT COUNT(*) FROM offline_queue WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;
        if exists == 0 {
            return Err(CoreError::NotFound {
                entity: "offline_queue",
                id: id.to_owned(),
            });
        }
        Ok(())
    }

    /// Mark an offline queue item as synced, scoped to a tenant (SYNC-07).
    ///
    /// Returns [`CoreError::NotFound`] when the id does not exist **or**
    /// belongs to a different tenant — a cross-tenant mutation is treated
    /// exactly like a missing item so the client queue boundary is safe by
    /// construction even in a multi-tenant process.
    pub fn mark_offline_synced_for_tenant(
        &self,
        id: &str,
        tenant_id: &str,
    ) -> Result<(), CoreError> {
        let affected = self.conn.execute(
            "UPDATE offline_queue SET status = 'synced', synced_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1 AND tenant_id = ?2",
            params![id, tenant_id],
        )?;
        if affected == 0 {
            return Err(CoreError::NotFound {
                entity: "offline_queue",
                id: id.to_owned(),
            });
        }
        Ok(())
    }

    /// Mark an offline queue item as resolved via conflict (P1-3).
    ///
    /// Sets status to 'synced' and records the resolution type in
    /// `last_error` so the status summary can count conflict resolutions.
    pub fn mark_offline_resolved(&self, id: &str, resolution: &str) -> Result<(), CoreError> {
        let marker = format!("resolved: conflict ({})", resolution);
        let affected = self.conn.execute(
            "UPDATE offline_queue SET status = 'synced', synced_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), last_error = ?1 WHERE id = ?2",
            params![marker, id],
        )?;
        if affected == 0 {
            return Err(CoreError::NotFound {
                entity: "offline_queue",
                id: id.to_owned(),
            });
        }
        Ok(())
    }

    /// Mark an offline queue item as failed with an error message.
    pub fn mark_offline_failed(&self, id: &str, error: &str) -> Result<(), CoreError> {
        self.conn.execute(
            "UPDATE offline_queue SET status = 'failed', last_error = ?1, retry_count = retry_count + 1 WHERE id = ?2",
            params![error, id],
        )?;
        Ok(())
    }

    /// Mark an offline queue item as failed, scoped to a tenant (SYNC-07).
    ///
    /// A cross-tenant id is a no-op (`Ok(())`), matching the unscoped
    /// variant's lenient semantics but never mutating another tenant's row.
    pub fn mark_offline_failed_for_tenant(
        &self,
        id: &str,
        tenant_id: &str,
        error: &str,
    ) -> Result<(), CoreError> {
        self.conn.execute(
            "UPDATE offline_queue SET status = 'failed', last_error = ?1, retry_count = retry_count + 1
             WHERE id = ?2 AND tenant_id = ?3",
            params![error, id, tenant_id],
        )?;
        Ok(())
    }

    /// Get the count of pending offline items.
    pub fn pending_offline_count(&self) -> Result<i64, CoreError> {
        self.conn
            .query_row(
                "SELECT COUNT(*) FROM offline_queue WHERE status = 'pending'",
                [],
                |row| row.get(0),
            )
            .map_err(Into::into)
    }

    /// Get the count of pending offline items scoped to a tenant (SYNC-07).
    pub fn pending_offline_count_for_tenant(&self, tenant_id: &str) -> Result<i64, CoreError> {
        self.conn
            .query_row(
                "SELECT COUNT(*) FROM offline_queue WHERE status = 'pending' AND tenant_id = ?1",
                params![tenant_id],
                |row| row.get(0),
            )
            .map_err(Into::into)
    }

    /// Delete a processed offline queue item.
    pub fn delete_offline_item(&self, id: &str) -> Result<(), CoreError> {
        self.conn
            .execute("DELETE FROM offline_queue WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Delete an offline queue item, scoped to a tenant (SYNC-07).
    ///
    /// A cross-tenant id is a no-op — the row (if any) is left untouched.
    pub fn delete_offline_item_for_tenant(
        &self,
        id: &str,
        tenant_id: &str,
    ) -> Result<(), CoreError> {
        self.conn.execute(
            "DELETE FROM offline_queue WHERE id = ?1 AND tenant_id = ?2",
            params![id, tenant_id],
        )?;
        Ok(())
    }

    /// Get a summary of the offline queue status (P1-6 sync observability).
    ///
    /// Returns counts by status, total retry count, last sync timestamp,
    /// and oldest pending timestamp — all in a single query.
    pub fn offline_queue_status_summary(&self) -> Result<SyncStatusSummary, CoreError> {
        // Status counts
        let counts: Vec<(String, i64)> = self
            .conn
            .prepare("SELECT status, COUNT(*) FROM offline_queue GROUP BY status")?
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })?
            .filter_map(|r| match r {
                Ok(v) => Some(v),
                // COR-20: a row that fails to read must not silently vanish
                // from the counts the dashboard renders.
                Err(e) => {
                    log_degraded("offline_queue_status_summary.counts_row", &e);
                    None
                }
            })
            .collect();

        let mut pending_count: i64 = 0;
        let mut synced_count: i64 = 0;
        let mut failed_count: i64 = 0;
        for (status, count) in &counts {
            match status.as_str() {
                "pending" => pending_count = *count,
                "synced" => synced_count = *count,
                "failed" => failed_count = *count,
                _ => {}
            }
        }

        // Total retry count across all failed items
        let total_retry_count: i64 = match self.conn.query_row(
            "SELECT COALESCE(SUM(retry_count), 0) FROM offline_queue WHERE status = 'failed'",
            [],
            |row| row.get(0),
        ) {
            Ok(v) => v,
            Err(e) => {
                log_degraded("offline_queue_status_summary.total_retry_count", &e);
                0
            }
        };

        // Last synced at (most recent synced_at timestamp)
        let last_synced_at: Option<String> = query_or_none(
            "offline_queue_status_summary.last_synced_at",
            self.conn.query_row(
                "SELECT synced_at FROM offline_queue WHERE status = 'synced' AND synced_at IS NOT NULL ORDER BY synced_at DESC LIMIT 1",
                [],
                |row| row.get(0),
            ),
        );

        // Oldest pending at (earliest created_at among pending items)
        let oldest_pending_at: Option<String> = query_or_none(
            "offline_queue_status_summary.oldest_pending_at",
            self.conn.query_row(
                "SELECT created_at FROM offline_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1",
                [],
                |row| row.get(0),
            ),
        );

        // P1-3: Count items resolved via conflict (last_error starts with "resolved: conflict")
        let conflict_count: i64 = match self.conn.query_row(
            "SELECT COUNT(*) FROM offline_queue WHERE last_error LIKE 'resolved: conflict%'",
            [],
            |row| row.get(0),
        ) {
            Ok(v) => v,
            Err(e) => {
                log_degraded("offline_queue_status_summary.conflict_count", &e);
                0
            }
        };

        Ok(SyncStatusSummary {
            pending_count,
            synced_count,
            failed_count,
            total_retry_count,
            last_synced_at,
            oldest_pending_at,
            conflict_count,
        })
    }

    /// Read the persisted sync pull anchor and cursor (SYNC-01).
    ///
    /// Returns the `since` timestamp and `cursor` from the last
    /// successfully-applied page. Both are `None` on first sync (pull
    /// everything). A missing row (pre-114 database) defaults to `None`.
    pub fn get_sync_pull_state(&self) -> Result<SyncPullState, CoreError> {
        use rusqlite::OptionalExtension;
        self.conn
            .query_row(
                "SELECT since, cursor FROM sync_pull_state WHERE id = 1",
                [],
                |row| {
                    Ok(SyncPullState {
                        since: row.get(0)?,
                        cursor: row.get(1)?,
                    })
                },
            )
            .optional()
            .map(|row| row.unwrap_or_default())
            .map_err(Into::into)
    }

    /// Persist the sync pull anchor and cursor (SYNC-01).
    ///
    /// Called only AFTER a page of remote items was applied successfully,
    /// so a crash mid-pull replays safely — the idempotency ledger then
    /// skips any already-applied items.
    pub fn set_sync_pull_state(
        &self,
        since: Option<&str>,
        cursor: Option<&str>,
    ) -> Result<(), CoreError> {
        self.conn.execute(
            "INSERT INTO sync_pull_state (id, since, cursor) VALUES (1, ?1, ?2)
             ON CONFLICT(id) DO UPDATE SET since = excluded.since, cursor = excluded.cursor",
            params![since, cursor],
        )?;
        Ok(())
    }

    /// Check whether a remote item has already been applied locally (SYNC-01).
    pub fn is_remote_item_applied(&self, item_id: &str) -> Result<bool, CoreError> {
        self.conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sync_applied_items WHERE item_id = ?1)",
                params![item_id],
                |row| row.get(0),
            )
            .map_err(Into::into)
    }

    /// Record a remote item as applied locally (SYNC-01 idempotency ledger).
    ///
    /// `INSERT OR IGNORE` — re-recording the same id is a no-op, so replay
    /// of a page never double-counts a mutation.
    ///
    /// Records no effect: delegates to
    /// [`Self::mark_remote_item_applied_with_effect`] with `None`. A caller
    /// that knows the effect the application had must use that one — this
    /// signature is kept so the delivery-only callers keep working.
    pub fn mark_remote_item_applied(&self, item_id: &str, action: &str) -> Result<(), CoreError> {
        self.mark_remote_item_applied_with_effect(item_id, action, None)
    }

    /// Record a remote item as applied locally, keyed by the EFFECT it had (C3).
    ///
    /// `item_id` proves the item was DELIVERED once; it says nothing about the
    /// effect that delivery had, so a retry that produces a second deduction is
    /// a second effect and must be visible as one. `effect_key` is that effect,
    /// and `idx_sync_applied_items_effect_key` (PARTIAL, `WHERE effect_key IS
    /// NOT NULL`) enforces it appears once.
    ///
    /// `None` is the honest value for a caller that does not know the effect:
    /// it stays NULL — never a default and never an empty string — and the
    /// partial index deliberately ignores it, so the pre-C3 rows and the
    /// not-yet-effect-aware writers cannot collide with each other.
    pub fn mark_remote_item_applied_with_effect(
        &self,
        item_id: &str,
        action: &str,
        effect_key: Option<&str>,
    ) -> Result<(), CoreError> {
        self.conn.execute(
            "INSERT OR IGNORE INTO sync_applied_items (item_id, action, effect_key) \
             VALUES (?1, ?2, ?3)",
            params![item_id, action, effect_key],
        )?;
        Ok(())
    }

    /// Record a remote application failure and advance its retry/dead-letter state.
    ///
    /// The payload is retained for operator inspection. Once `max_attempts`
    /// is reached, the item is quarantined and no longer eligible for page
    /// application until a future explicit operator requeue workflow is added.
    pub fn record_remote_failure(
        &self,
        item_id: &str,
        action: &str,
        payload: &str,
        error: &str,
        max_attempts: i64,
    ) -> Result<bool, CoreError> {
        let max_attempts = max_attempts.max(1);
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO sync_remote_failures
                (item_id, action, payload, attempts, last_error, dead_lettered)
             VALUES (?1, ?2, ?3, 1, ?4, CASE WHEN 1 >= ?5 THEN 1 ELSE 0 END)
             ON CONFLICT(item_id) DO UPDATE SET
                action = excluded.action,
                payload = excluded.payload,
                attempts = sync_remote_failures.attempts + 1,
                last_error = excluded.last_error,
                last_failed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                dead_lettered = CASE
                    WHEN sync_remote_failures.attempts + 1 >= ?5 THEN 1
                    ELSE 0
                END",
            params![item_id, action, payload, error, max_attempts],
        )?;
        let dead_lettered: bool = tx.query_row(
            "SELECT dead_lettered FROM sync_remote_failures WHERE item_id = ?1",
            params![item_id],
            |row| row.get(0),
        )?;
        tx.commit()?;
        Ok(dead_lettered)
    }

    /// List retained remote application failures, newest failure first.
    pub fn list_remote_failures(&self) -> Result<Vec<RemoteSyncFailure>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT item_id, action, payload, attempts, last_error, dead_lettered
             FROM sync_remote_failures ORDER BY last_failed_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(RemoteSyncFailure {
                item_id: row.get(0)?,
                action: row.get(1)?,
                payload: row.get(2)?,
                attempts: row.get(3)?,
                last_error: row.get(4)?,
                dead_lettered: row.get::<_, i64>(5)? != 0,
            })
        })?;
        rows.map(|row| row.map_err(CoreError::from)).collect()
    }

    /// Return whether a remote item has been quarantined as a dead letter.
    pub fn is_remote_failure_dead_lettered(&self, item_id: &str) -> Result<bool, CoreError> {
        self.conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sync_remote_failures WHERE item_id = ?1 AND dead_lettered = 1)",
                params![item_id],
                |row| row.get(0),
            )
            .map_err(Into::into)
    }

    /// Clear a resolved remote failure after its item is applied successfully.
    pub fn clear_remote_failure(&self, item_id: &str) -> Result<(), CoreError> {
        let tx = self.conn.unchecked_transaction()?;
        self.clear_remote_failure_in_tx(&tx, item_id)?;
        tx.commit()?;
        Ok(())
    }

    /// Clear a remote failure using a caller-owned transaction.
    pub fn clear_remote_failure_in_tx(
        &self,
        tx: &rusqlite::Transaction<'_>,
        item_id: &str,
    ) -> Result<(), CoreError> {
        tx.execute(
            "DELETE FROM sync_remote_failures WHERE item_id = ?1",
            params![item_id],
        )?;
        Ok(())
    }

    /// Requeue a dead-lettered remote item so the next sync cycle retries it.
    ///
    /// Operators call this after remediating the item's source (for example
    /// creating the missing product a remote sale referenced, or upgrading a
    /// client whose version rejected the payload). The quarantine row is
    /// deleted and the durable pull anchor (`sync_pull_state`) is rewound to
    /// a full re-pull, so the next daemon cycle re-fetches the item and
    /// retries it with a fresh attempt budget. The re-pull is safe because
    /// the `sync_applied_items` idempotency ledger skips every already-
    /// applied item — only the requeued (never-applied) item mutates.
    ///
    /// Returns [`CoreError::NotFound`] when the item is not currently
    /// dead-lettered (either never recorded or still retryable) — a mistyped
    /// id or a request to requeue an item that is already being retried must
    /// not be a silent no-op.
    pub fn requeue_remote_failure(&self, item_id: &str) -> Result<(), CoreError> {
        let tx = self.conn.unchecked_transaction()?;
        // The dead-letter predicate lives in the DELETE so the check and the
        // mutation are atomic — an id that is not currently quarantined
        // (never recorded, or still being retried) deletes nothing and fails
        // with NotFound instead of silently no-op'ing.
        let affected = tx.execute(
            "DELETE FROM sync_remote_failures WHERE item_id = ?1 AND dead_lettered = 1",
            params![item_id],
        )?;
        if affected == 0 {
            return Err(CoreError::NotFound {
                entity: "sync_remote_failures",
                id: item_id.to_owned(),
            });
        }
        // Rewind the durable pull anchor (single-row table). A NULL `since`
        // means "pull everything" on the next cycle — the idempotency
        // ledger makes that safe. No row (pre-114 database) is a no-op.
        tx.execute(
            "UPDATE sync_pull_state SET since = NULL, cursor = NULL WHERE id = 1",
            [],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Record a remote item using a caller-owned transaction.
    ///
    /// The sync applier uses this method in the same transaction as the
    /// domain mutation, preventing a crash between mutation and receipt from
    /// causing a second application on replay.
    ///
    /// Records no effect — delegates to
    /// [`Self::mark_remote_item_applied_with_effect_in_tx`] with `None`, so
    /// the delivery-only callers keep working unchanged.
    pub fn mark_remote_item_applied_in_tx(
        &self,
        tx: &rusqlite::Transaction<'_>,
        item_id: &str,
        action: &str,
    ) -> Result<(), CoreError> {
        self.mark_remote_item_applied_with_effect_in_tx(tx, item_id, action, None)
    }

    /// [`Self::mark_remote_item_applied_with_effect`] in a caller-owned
    /// transaction, so the receipt commits or rolls back with the mutation it
    /// describes. See that method for what `effect_key` means and why `None` is
    /// a real value rather than a missing one.
    pub fn mark_remote_item_applied_with_effect_in_tx(
        &self,
        tx: &rusqlite::Transaction<'_>,
        item_id: &str,
        action: &str,
        effect_key: Option<&str>,
    ) -> Result<(), CoreError> {
        tx.execute(
            "INSERT OR IGNORE INTO sync_applied_items (item_id, action, effect_key) \
             VALUES (?1, ?2, ?3)",
            params![item_id, action, effect_key],
        )?;
        Ok(())
    }

    fn row_to_offline_queue_item(row: &rusqlite::Row) -> rusqlite::Result<OfflineQueueItem> {
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
                .map(crate::offline::SyncPriority::from)
                .unwrap_or(crate::offline::SyncPriority::Normal),
            // NULL stays NULL: "unknown origin", never a default.
            origin_terminal_id: row.get("origin_terminal_id")?,
        })
    }
}

// ── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "offline_tests.rs"]
mod tests;
