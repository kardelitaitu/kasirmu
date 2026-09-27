//! Enqueue side of the offline queue: local mutations awaiting sync.
//!
//! Split out of `db/offline.rs` on 2026-09-28. These are the `enqueue_offline*`
//! family and the four `enqueue_*_outbox_in_tx` writers, which are how a local
//! mutation (sale, refund, void, payment, settings change) becomes a durable
//! queue row that the daemon later pushes.
//!
//! Invariant: the `*_in_tx` variants take the caller's transaction and must
//! never commit — they exist so the queue row is written in the SAME transaction
//! as the mutation it describes, which is what makes the outbox crash-safe.

use rusqlite::params;

use crate::db::Store;
use crate::error::CoreError;
use crate::offline::OfflineQueueItem;
use crate::offline::SyncPriority;

use super::{currency_str, enqueue_origin, log_degraded};

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
}
