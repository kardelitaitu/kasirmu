//! Remote-effect appliers: replay one queued remote item inside a transaction.
//!
//! Split out of `queue.rs` on 2026-09-28. These are the free `*_in_tx` functions
//! that each interpret ONE action of a remote payload and write its effect - the
//! product/stock delta arms, the receipt-exists and already-applied idempotency
//! probes, the refund/void/payment appliers, and the loyalty/customer-spend
//! reversals.
//!
//! Every one is called ONLY from `SyncQueue::apply_remote_in_tx` (and its legacy
//! `apply_remote` mirror) in the parent module, so there is no public surface
//! here; `remote_sync_admits` is the one function the parent still calls
//! directly (`settings_change_of`), hence `pub(super)`.
//!
//! Invariant: each applier assumes it is already inside the caller transaction,
//! so it takes `&Transaction`/`&Connection` and must never commit.

use kasirmu_core::db::Store;
use kasirmu_core::error::CoreError;
use kasirmu_core::offline::OfflineQueueItem;
use kasirmu_core::settings::Settings;
// `IngestPolicyKind` is the TRAIT that provides `admits()`; importing only the
// `IngestPolicy` enum gives `E0599: no method named 'adm'`.
use kasirmu_core::settings::{IngestPolicy, IngestPolicyKind};
use rusqlite::OptionalExtension;
use serde::Deserialize;
use serde_json::Value;

/// The ONE remote-ingest gate for the sync lane.
///
/// Delegates to the sealed [`IngestPolicy::RemoteSync`] policy owned by
/// platform-core (re-exported through `kasirmu_core::settings`), which refuses every
/// credential in `SECRET_KEY_DENY_LIST`, every device-bound identity in
/// `NON_EXPORTABLE_DEVICE_KEYS` (`machine_id`, `sync_terminal_id`) and every
/// lifecycle-manager prefix (`local_api.*`, `lan_server.*`). This lane owns no
/// key list of its own.
///
/// Both dispatchers now WRITE through the funnel accessor
/// `Settings::set_with_policy(..., IngestPolicy::RemoteSync)`, which decides and
/// warns in one place (delegated to platform-core through the `kasirmu_core::Settings`
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
pub(super) fn remote_sync_admits(key: &str) -> bool {
    IngestPolicy::RemoteSync.admits(key)
}

/// `sale_id` is read by two callers, both of which must name the effect
/// WITHOUT applying it: `remote_effect_key` (which keys the receipt) and the
/// `complete_sale` arm's secondary origin guard (C3, slice S4), which asks
/// whether this terminal already completed that sale. It is `Option` so a
/// payload minted before the field existed still deserializes and is applied
/// exactly as it was.
#[derive(Deserialize)]
pub(super) struct SalePayload {
    #[serde(default)]
    pub(super) sale_id: Option<String>,
    #[serde(default)]
    pub(super) line_items: Vec<SaleLinePayload>,
}

#[derive(Deserialize)]
pub(super) struct SaleLinePayload {
    pub(super) sku: String,
    #[serde(default)]
    pub(super) qty: i64,
}

#[derive(Deserialize)]
pub(super) struct StockAdjustmentPayload {
    pub(super) sku: String,
    pub(super) delta: i64,
    /// Optional per-location scope (ADR-19). ADR-19-aware senders and CRDT
    /// envelope sides name the location the delta belongs to; OLDER senders
    /// omit it (serde default), and the delta then keeps today's behaviour
    /// of landing at the canonical default location.
    #[serde(default)]
    pub(super) location_id: Option<String>,
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
pub(super) fn apply_stock_adjustment_delta_in_tx(
    tx: &rusqlite::Transaction<'_>,
    sub: &StockAdjustmentPayload,
) -> Result<(), CoreError> {
    let has_location_rows = product_has_location_rows(tx, &sub.sku)?;
    let canonical_at = |location: &str| -> Result<(), CoreError> {
        Store::new(tx).adjust_stock_at_location_with_reason(
            tx,
            &sub.sku,
            sub.delta,
            &kasirmu_core::inventory::LocationId::from(location),
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
            canonical_at(kasirmu_core::inventory::CANONICAL_DEFAULT_LOCATION_UUID)?
        }
        None => {
            Store::new(tx).adjust_stock_in_tx(tx, &sub.sku, sub.delta)?;
        }
    }
    Ok(())
}

/// Whether the product behind sku already has any per-location
/// stock_summary row (i.e. the install tracks per-location stock for it).
///
/// Delegates to `Store::product_has_location_rows` in kasirmu-core — the ONE
/// item_id-scoped existence predicate, shared with the Layer-1 pre-check, the
/// batch Phase-1 pre-read and the legacy bridge gate. This lane keeps only the
/// sku-to-id resolution, because the sync payload carries a sku and the
/// predicate takes an id; the SQL itself exists in exactly one place now.
/// An unknown sku resolves to `false`, which is what the in-line EXISTS over a
/// subselect returned before, so a delta for a product that does not exist
/// here still takes the same path.
pub(super) fn product_has_location_rows(
    tx: &rusqlite::Transaction<'_>,
    sku: &str,
) -> Result<bool, CoreError> {
    let product_id = Store::new(tx).product_id_by_sku(sku)?;
    match product_id {
        Some(id) => Store::product_has_location_rows(tx, &id),
        None => Ok(false),
    }
}

/// Payload for the `stock.movement` sync action (ADR #6 cross-store routing).
/// Carries a full `StockMovement` row for insertion into the local ledger.
#[derive(Deserialize)]
pub(super) struct StockMovementPayload {
    pub(super) id: String,
    pub(super) item_id: String,
    pub(super) delta: i64,
    pub(super) reason: Option<String>,
    pub(super) source_terminal_id: Option<String>,
    pub(super) source_user_id: Option<String>,
    pub(super) store_id: String,
    pub(super) created_at: String,
}

/// Default originating terminal for remote settings items whose payload
/// omits `terminal_id` (older servers / relay terminals).
pub(super) fn default_sync_terminal() -> String {
    "sync".into()
}

/// Payload for the `settings.update` / `settings.change` sync action
/// (SYNC-10). Carries the key, the new value, and the terminal that made
/// the change so the local delta ledger records the originator and the
/// daemon can re-emit a `SettingsUpdated` event for UI reactivity.
#[derive(Deserialize)]
pub(super) struct SettingsUpdatePayload {
    pub(super) key: String,
    pub(super) value: String,
    #[serde(default = "default_sync_terminal")]
    pub(super) terminal_id: String,
}

/// Payload for the `finalize_sale` sync action — the cloud webhook path
/// enqueues `{"sale_id": …}` after payment capture so the pending sale
/// completes on the terminal.
#[derive(Deserialize)]
pub(super) struct FinalizeSalePayload {
    pub(super) sale_id: String,
}

/// Payload for the `refund_sale` sync action (checklist C4, slice S1).
///
/// Carries the WHOLE refund the originator minted, including its primary key
/// `id`. That id is the refund's own durable row and is the ONLY thing this
/// lane probes for idempotency: `sync_applied_items` records delivery, not
/// effect, so a receipt that advanced is no proof the refund landed (and a
/// receipt that was lost is no proof it did not).
///
/// `deny_unknown_fields` is deliberately absent: a later origin build adds a
/// field and this applier must keep parsing the payload rather than
/// dead-lettering it.
#[derive(Deserialize)]
pub(super) struct RefundPayload {
    /// The refund's own primary key, minted on the originator.
    pub(super) id: String,
    /// FK to the original sale. The sales row is a REAL foreign key
    /// (`refunds.sale_id REFERENCES sales(id)`), so a refund can only be
    /// replicated where the sale already exists.
    pub(super) sale_id: String,
    /// Refund total in minor units.
    #[serde(default)]
    pub(super) total_minor: i64,
    /// Refund currency (ISO-4217).
    #[serde(default)]
    pub(super) currency: String,
    #[serde(default)]
    pub(super) reason: String,
    #[serde(default)]
    pub(super) note: String,
    /// Staff member who processed the refund on the originator.
    #[serde(default)]
    pub(super) processed_by: String,
    #[serde(default)]
    pub(super) created_at: String,
    #[serde(default)]
    pub(super) lines: Vec<RefundLinePayload>,
}

/// One line of a `refund_sale` payload.
#[derive(Deserialize)]
pub(super) struct RefundLinePayload {
    /// The refund line's own primary key, minted on the originator.
    pub(super) id: String,
    #[serde(default)]
    pub(super) sale_line_id: String,
    #[serde(default)]
    pub(super) sku: String,
    #[serde(default)]
    pub(super) qty: i64,
    #[serde(default)]
    pub(super) unit_minor: i64,
    #[serde(default)]
    pub(super) line_minor: i64,
    #[serde(default)]
    pub(super) currency: String,
    #[serde(default)]
    pub(super) created_at: String,
    /// The location the originator deducted these units from. Absent on older
    /// senders and on legacy sales; the credit then lands at the canonical
    /// default location.
    #[serde(default)]
    pub(super) location_id: Option<String>,
}

/// Payload for the `void_sale` sync action.
///
/// A void carries no refund rows — its whole effect is the sale's own status,
/// so idempotency is decided by a compare-and-set on that status rather than
/// by a row of its own.
#[derive(Deserialize)]
pub(super) struct VoidSalePayload {
    /// The sale to void. The originator's `reason`/`user_id` (when sent) are
    /// tolerated and ignored: a void's whole effect is the sale's status, and
    /// the local audit row for it is written by the path that owns the status.
    pub(super) sale_id: String,
}

/// Payload for the `payment.recorded` sync action.
///
/// The payment's own durable row is `payments.id`; a gateway tender also
/// carries an `idempotency_key` with a UNIQUE index behind it, which is the
/// stronger identity when it is present.
#[derive(Deserialize)]
pub(super) struct PaymentPayload {
    /// The payment's own primary key, minted on the originator.
    pub(super) id: String,
    /// FK to the sale. Also a real foreign key, so a payment can only be
    /// replicated where the sale already exists.
    pub(super) sale_id: String,
    #[serde(default)]
    pub(super) method: String,
    #[serde(default)]
    pub(super) amount_minor: i64,
    #[serde(default)]
    pub(super) currency: String,
    #[serde(default)]
    pub(super) created_at: String,
    #[serde(default)]
    pub(super) gateway_reference: Option<String>,
    #[serde(default)]
    pub(super) gateway_status: Option<String>,
    #[serde(default)]
    pub(super) gateway_response: Option<String>,
    /// Unique when present — the idempotency probe prefers it.
    #[serde(default)]
    pub(super) idempotency_key: Option<String>,
}

/// Whether this database already contains the refund the payload describes,
/// decided by the refund's OWN durable row (checklist C4).
///
/// A refund's downstream effects — stock credits, the loyalty reversal, the
/// customer spend reversal, the audit row — are all functions of
/// `refunds.id` and share its transaction, so this ONE probe suppresses them
/// together. `sync_applied_items` is deliberately NOT consulted: it records
/// that an item was delivered, not that its effect landed.
pub(super) fn refund_already_applied(
    conn: &rusqlite::Connection,
    refund_id: &str,
) -> Result<bool, CoreError> {
    let tx = conn;
    let exists: i64 = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM refunds WHERE id = ?1)",
        rusqlite::params![refund_id],
        |row| row.get(0),
    )?;
    Ok(exists == 1)
}

/// Whether this database already contains the payment the payload describes,
/// decided by the payment's OWN durable row (checklist C4).
///
/// The idempotency key is the stronger identity when the originator sent one —
/// `idx_payments_idempotency_key` is UNIQUE, so a re-sent tender is the same
/// tender whatever id it arrives under. A payment with no key (legacy cash
/// rows) falls back to its primary key.
pub(super) fn payment_already_applied(
    conn: &rusqlite::Connection,
    payload: &PaymentPayload,
) -> Result<bool, CoreError> {
    let tx = conn;
    let exists: i64 = match payload.idempotency_key.as_deref() {
        Some(key) => tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM payments WHERE idempotency_key = ?1)",
            rusqlite::params![key],
            |row| row.get(0),
        )?,
        None => tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM payments WHERE id = ?1)",
            rusqlite::params![payload.id],
            |row| row.get(0),
        )?,
    };
    Ok(exists == 1)
}

/// Whether the `complete_sale` this payload names was already completed BY
/// THIS TERMINAL (C3, slice S4) — the arm's SECONDARY origin guard.
///
/// The primary gate reads `offline_queue.origin_terminal_id`, which is NULL on
/// every row written before the schema slice and on any producer that does not
/// stamp it, so those rows are invisible to it. `sales.terminal_id` is written
/// by the settlement itself (`mint_receipt_code` → the INSERT in
/// sales_checkout.rs / sales_lifecycle.rs) and is therefore available for
/// exactly the rows the origin column cannot name.
///
/// Conservative by construction, like the primary gate: an absent `sale_id`, a
/// NULL `sales.terminal_id`, an unknown sale and an unpaired install all
/// answer `false`, so the deduction is applied exactly as it is today. Only a
/// sale row that exists HERE and names THIS terminal proves the deduction
/// already happened on this inventory.
///
/// The `complete_sale` arm never creates a `sales` row, so there is no way
/// for this probe to suppress a deduction this terminal has not made.
pub(super) fn sale_completed_here_in_tx(
    tx: &rusqlite::Transaction<'_>,
    sale_id: &str,
) -> Result<bool, CoreError> {
    let Some(this_terminal) = Settings::get_sync_terminal_id(tx)? else {
        return Ok(false);
    };
    let row: Option<(Option<String>, Option<String>)> = tx
        .query_row(
            "SELECT terminal_id, tenant_id FROM sales WHERE id = ?1",
            rusqlite::params![sale_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((Some(sale_terminal), tenant)) = row else {
        return Ok(false);
    };
    if sale_terminal == this_terminal {
        return Ok(true);
    }
    // Two homes for the same terminal: the pairing id this install syncs
    // under (a `terminals.id`) and the identity a session stamped onto the sale
    // (the device id a login carried). `resolve_terminal_row_id` is the tree's
    // one translation between them, so it is the one used here; an identity
    // that resolves to no row is NOT proof and the deduction is applied.
    let store = Store::new(tx);
    let tenant = tenant.unwrap_or_else(|| "default".into());
    let here = store.resolve_terminal_row_id(&tenant, &this_terminal)?;
    let there = store.resolve_terminal_row_id(&tenant, &sale_terminal)?;
    Ok(matches!((here, there), (Some(a), Some(b)) if a == b))
}

/// The EFFECT a remote item will have, derived from its action and payload (C3).
///
/// `sync_applied_items` records DELIVERY: `item_id` proves this item arrived
/// once, and nothing about the mutation it caused. A redelivery of the same
/// mutation under a DIFFERENT item id is therefore invisible to an item-keyed
/// receipt, and the mutation is applied a second time — a second stock
/// deduction. The effect key is the identity of the mutation itself, and it is
/// this function — not the arms — that names it, because the receipt is
/// pre-checked BEFORE the item is applied, so the key must be derivable
/// without applying it.
///
/// One key per arm, and the identity is always the one the originator minted:
///
/// - `complete_sale`   → `sale:<sale_id>:deduct`
/// - `finalize_sale`   → `sale:<sale_id>:finalize`
/// - `void_sale`       → `sale:<sale_id>:void`
/// - `refund_sale`     → `refund:<refund_id>`
/// - `payment.recorded`→ `payment:<payment_id>`
/// - `stock.movement`  → `stock_movement:<movement_id>`
/// - `product.created` → `product:<sku>:create`
/// - `settings.update` / `settings.change` → `setting:<key>`
///
/// TWO ARMS CANNOT CARRY A SINGLE KEY, and they return `None` rather than a
/// fabricated one:
///
/// - `stock.adjusted` — `StockAdjustmentPayload` is `{sku, delta, location_id}`
///   with no id, and two genuinely distinct identical deltas ARE two effects
///   (`adjust_stock` is not idempotent by design). Any key invented from the
///   sku and delta would silently swallow the second, legitimate one.
/// - `stock.movement` under the `crdt_delta` envelope — one item carrying two
///   sub-effects (the `local` and the `remote` side of a merge), so no single
///   key describes it.
///
/// A `None` key stays SQL NULL: the partial unique index ignores NULL, so
/// these rows behave exactly as they did before C3 — recorded per delivery —
/// and can never collide with each other.
///
/// A payload whose identity field is absent or unreadable yields `None` rather
/// than an error: the arm itself is the authority on malformed payloads and
/// reports them with its own message, so this function must not shadow that.
/// The ordered, DEDUPLICATED leaf deltas a stock envelope carries.
///
/// The four stock arms in `crate::queue` (stock.adjusted and stock.movement,
/// in both the atomic and legacy dispatchers) must apply the SAME set of
/// facts, so the walk lives here once rather than four times.
///
/// A plain (non-envelope) payload yields itself. A `crdt_delta` envelope
/// yields `local`, `remote`, then each entry of its `extra` array (the
/// surplus a flattened re-merge carries). Exact duplicates are collapsed,
/// keeping first occurrence: a re-merge of a row with itself repeats every
/// delta, and the appliers are not all idempotent — `adjust_stock` appends a
/// fresh mutation, so applying the repeats would double-count. Two
/// independent adjustments arrive on the distinct local/remote sides and stay
/// distinct (a `stock.adjusted` delta carries no id, so content is its only
/// identity).
///
/// `Value::Null` sides pass through untouched — the arm's own deserialiser
/// owns that error message, and this walk must not shadow it.
pub(super) fn envelope_deltas(payload: &Value) -> Vec<Value> {
    let is_envelope = payload.get("merge_type").and_then(|m| m.as_str()) == Some("crdt_delta");
    let mut out: Vec<Value> = Vec::new();
    if !is_envelope {
        out.push(payload.clone());
        return out;
    }
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut push = |side: &Value, out: &mut Vec<Value>| {
        if side.is_null() || seen.insert(side.to_string()) {
            out.push(side.clone());
        }
    };
    for key in ["local", "remote"] {
        if let Some(side) = payload.get(key) {
            push(side, &mut out);
        }
    }
    if let Some(extras) = payload.get("extra").and_then(|e| e.as_array()) {
        for extra in extras {
            push(extra, &mut out);
        }
    }
    out
}

pub(super) fn remote_effect_key(action: &str, payload: &str) -> Option<String> {
    let value: Value = serde_json::from_str(payload).ok()?;
    // The CRDT merge envelope carries two sub-effects in one item — see the
    // module note above on why it cannot carry one key.
    let is_crdt_envelope = value.get("merge_type").and_then(|m| m.as_str()) == Some("crdt_delta");
    let field = |name: &str| -> Option<&str> { value.get(name).and_then(|v| v.as_str()) };
    match action {
        "complete_sale" => Some(format!("sale:{}:deduct", field("sale_id")?)),
        "finalize_sale" => Some(format!("sale:{}:finalize", field("sale_id")?)),
        "void_sale" => Some(format!("sale:{}:void", field("sale_id")?)),
        "refund_sale" => Some(format!("refund:{}", field("id")?)),
        "payment.recorded" => Some(format!("payment:{}", field("id")?)),
        "stock.movement" if !is_crdt_envelope => Some(format!("stock_movement:{}", field("id")?)),
        "product.created" => Some(format!("product:{}:create", field("sku")?)),
        "settings.update" | "settings.change" => Some(format!("setting:{}", field("key")?)),
        // stock.adjusted, a CRDT-enveloped stock.movement, and any unknown
        // action: no single effect to name (see the doc comment).
        _ => None,
    }
}

/// Replicate a refund - its rows and its effects - where the sale EXISTS.
///
/// Called only after the refunds.id probe said this refund is absent here,
/// so every write below is a first write. Store::create_refund cannot be
/// used: it opens its own transaction and SQLite has no nested BEGIN, so the
/// row shapes it writes are mirrored here and committed by the caller's
/// transaction together with the queue receipt.
///
/// Mirrored: the refunds header, its refund_lines, the stock credit (see
/// [credit_refund_effect_without_sale] for the location rule), the loyalty
/// reversal, the CRM-06 customer lifetime-spend reversal and the sale.refund
/// audit row. NOT mirrored: the over-refund
/// money and quantity bounds, which are the originator's decision to make
/// (this lane replays a refund that was already accepted there, and
/// re-deriving the bounds from a partially-replicated history would reject
/// legitimate items); and the KDS ticket cancellation, which is a local board
/// concern the daemon's own KDS path owns.
pub(super) fn apply_refund_with_sale_in_tx(
    tx: &rusqlite::Transaction<'_>,
    payload: &RefundPayload,
) -> Result<(), CoreError> {
    // TENANT: read from the LOCAL SALE row this arm already required to exist
    // (the caller probes `sales` before dispatching here, and `refunds.sale_id`
    // is a real FK to it) — the same source the originator's create_refund
    // stamps from, so both terminals file the refund under one tenant. NOT from
    // the payload and NOT a literal: the payload's tenant would be the
    // originator's claim rather than this database's own scoping, and
    // `refunds.tenant_id` is RLS-covered in PostgreSQL
    // (scripts/generate-pg-migration.py RLS_TABLES). The value is bound as
    // read, never substituted: a NULL local tenant binds NULL and the column's
    // own NOT NULL constraint refuses the row rather than the refund silently
    // becoming 'default'.
    let tenant_id: Option<String> = tx.query_row(
        "SELECT tenant_id FROM sales WHERE id = ?1",
        rusqlite::params![payload.sale_id],
        |row| row.get(0),
    )?;
    tx.execute(
        "INSERT INTO refunds (id, sale_id, total_minor, currency, reason, note, processed_by, created_at, tenant_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            payload.id,
            payload.sale_id,
            payload.total_minor,
            payload.currency,
            payload.reason,
            payload.note,
            payload.processed_by,
            payload.created_at,
            tenant_id,
        ],
    )?;

    for line in &payload.lines {
        tx.execute(
            "INSERT INTO refund_lines (id, refund_id, sale_line_id, sku, qty, unit_minor, line_minor, currency, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                line.id,
                payload.id,
                line.sale_line_id,
                line.sku,
                line.qty,
                line.unit_minor,
                line.line_minor,
                line.currency,
                line.created_at,
            ],
        )?;
    }

    credit_refund_effect_without_sale(tx, payload)?;
    if let Err(e) = reverse_loyalty_for_refund_in_tx(tx, payload) {
        // Non-fatal, matching create_refund: a loyalty failure must not roll
        // back a refund whose money and stock rows are already correct.
        tracing::warn!(
            refund_id = %payload.id,
            sale_id = %payload.sale_id,
            error = %e,
            "sync loyalty refund reversal failed (non-fatal)"
        );
    }
    // CRM-06, same non-fatal policy as the originator's step 2c: a customer
    // row that cannot be updated must not roll back money already credited.
    if let Err(e) = reverse_customer_spend_for_refund_in_tx(tx, payload) {
        tracing::warn!(
            refund_id = %payload.id,
            sale_id = %payload.sale_id,
            error = %e,
            "sync customer spend reversal failed (non-fatal)"
        );
    }

    tx.execute(
        "INSERT INTO audit_log (id, user_id, action, target_type, target_id, details, outcome, created_at)
         VALUES (?1, ?2, 'sale.refund', 'sale', ?3, ?4, 'success', ?5)",
        rusqlite::params![
            uuid::Uuid::now_v7().to_string(),
            payload.processed_by,
            payload.sale_id,
            serde_json::json!({
                "refund_id": payload.id,
                "reason": payload.reason,
                "total_minor": payload.total_minor,
                "currency": payload.currency,
                "line_count": payload.lines.len(),
                "origin": "sync",
            })
            .to_string(),
            payload.created_at,
        ],
    )?;
    Ok(())
}

/// Reverse the sale's loyalty award proportionally, on the caller's transaction.
///
/// DELEGATES to the one writer of this effect,
/// [`kasirmu_core::db::loyalty::reverse_loyalty_on_refund`] — the very
/// function `Store::create_refund` calls on the originator. This crate used
/// to mirror that function's body because it was `pub(crate)` to
/// kasirmu-core and therefore unreachable from here; that mirror was a second
/// writer of the same effect, free to drift from the original.
///
/// Idempotence is the helper's own: the ledger row's primary key is
/// deterministic (`loyalty-reversal-<refund_id>`), so a replay of the same
/// refund returns `Ok(None)` without touching a balance.
///
/// The `sales.total_minor` read is this lane's only addition: the helper
/// takes the sale total as an argument rather than reading it, so the
/// denominator of the proportional reversal is supplied here.
pub(super) fn reverse_loyalty_for_refund_in_tx(
    tx: &rusqlite::Transaction<'_>,
    payload: &RefundPayload,
) -> Result<(), CoreError> {
    let sale_total_minor: i64 = tx.query_row(
        "SELECT total_minor FROM sales WHERE id = ?1",
        rusqlite::params![payload.sale_id],
        |row| row.get(0),
    )?;
    kasirmu_core::db::loyalty::reverse_loyalty_on_refund(
        tx,
        &payload.sale_id,
        &payload.id,
        payload.total_minor,
        sale_total_minor,
    )?;
    Ok(())
}

/// CRM-06: reverse the customer's lifetime spend for a replicated refund.
///
/// DELEGATES to the one writer of this effect,
/// [`kasirmu_core::db::refunds::reverse_customer_spend_on_refund`] — the very
/// function `Store::create_refund` calls on the originator. This crate used
/// to mirror that function's body because it was inlined in `create_refund`
/// and therefore unreachable from here; that mirror was a second writer of
/// the same money rule, free to drift from the original.
///
/// The `sales` read is this lane's only addition: the helper takes the sale
/// total and base total as arguments rather than reading them, so the
/// conversion the refund is measured at is supplied here from the same row
/// the originator reads.
///
/// Idempotence is the caller's: this runs only on the sale-present path,
/// which has already inserted the refunds row that `refund_already_applied`
/// probes, so a replayed refund never reaches here a second time.
pub(super) fn reverse_customer_spend_for_refund_in_tx(
    tx: &rusqlite::Transaction<'_>,
    payload: &RefundPayload,
) -> Result<(), CoreError> {
    let (sale_customer_id, sale_total, sale_base_total): (Option<String>, i64, Option<i64>) = tx
        .query_row(
            "SELECT customer_id, total_minor, base_total_minor FROM sales WHERE id = ?1",
            rusqlite::params![payload.sale_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
    let Some(customer_id) = sale_customer_id.as_deref() else {
        return Ok(());
    };
    kasirmu_core::db::refunds::reverse_customer_spend_on_refund(
        tx,
        customer_id,
        payload.total_minor,
        sale_total,
        sale_base_total,
        &payload.created_at,
    )
}

/// Apply a void by compare-and-set on the sale's own status.
///
/// The CAS is the idempotency decision. Its zero-row branch is then
/// DISAMBIGUATED by probing the status, because three very different
/// situations all produce rows == 0:
///
/// - the sale is absent here - nothing to void, a benign replay;
/// - it is already voided - the first void stands, a benign replay;
/// - it is completed or pending - a genuine conflict (a paid or in-flight
///   sale must not be overwritten to voided), returned as Conflict so the
///   item dead-letters VISIBLY instead of vanishing into a silent Ok.
///
/// Only active reaches the CAS, which is the transition the sale's own status
/// graph allows (Active to Voided).
pub(super) fn apply_void_sale_in_tx(
    tx: &rusqlite::Transaction<'_>,
    payload: &VoidSalePayload,
) -> Result<(), CoreError> {
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let rows = tx.execute(
        "UPDATE sales SET status = 'voided', updated_at = ?1, version = version + 1
         WHERE id = ?2 AND status = 'active'",
        rusqlite::params![now, payload.sale_id],
    )?;
    if rows == 1 {
        return Ok(());
    }

    let status: Option<String> = tx
        .query_row(
            "SELECT status FROM sales WHERE id = ?1",
            rusqlite::params![payload.sale_id],
            |row| row.get(0),
        )
        .optional()?;
    match status.as_deref() {
        // Absent here, or already voided: the effect this item describes is
        // either impossible on this terminal or already present. Consume it.
        None | Some("voided") => Ok(()),
        // A completed or pending sale is NOT a void - surface it.
        _ => Err(CoreError::Conflict {
            entity: "sale",
            field: "status",
        }),
    }
}

/// Insert a remote payment's own row where the sale EXISTS.
///
/// Called only after the idempotency probe said this payment is absent here,
/// so this is a first write. Store::create_payments cannot be used: it mints
/// its own id, opens its own transaction, and takes a different
/// (split-argument) shape, none of which fits a replay of an already-minted
/// row.
pub(super) fn insert_payment_in_tx(
    tx: &rusqlite::Transaction<'_>,
    payload: &PaymentPayload,
) -> Result<(), CoreError> {
    tx.execute(
        "INSERT INTO payments (id, sale_id, method, amount_minor, currency, created_at,
                               gateway_reference, gateway_status, gateway_response, idempotency_key)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![
            payload.id,
            payload.sale_id,
            payload.method,
            payload.amount_minor,
            payload.currency,
            payload.created_at,
            payload.gateway_reference,
            payload.gateway_status,
            payload.gateway_response,
            payload.idempotency_key,
        ],
    )?;
    Ok(())
}

/// Credit stock for a refund whose sale row is ABSENT on this terminal
/// (checklist C4, the non-origin case).
///
/// `refunds.sale_id` is a real foreign key to `sales(id)` with
/// `foreign_keys ON`, so the refund row — and every row that hangs off it —
/// cannot be written here at all. The EFFECT still can and must: a refund
/// recorded on the terminal that sold the goods has to put those units back
/// into the stock this terminal shares. Only the stock effect is reproducible
/// from the payload; loyalty and customer spend are keyed off the sale and
/// have nothing to attach to, and this arm never fabricates a sale row.
///
/// The location comes from the payload line's recorded deduction location when
/// the originator named one, and from the canonical default location otherwise
/// — the same fallback `credit_refund_to_default_location` takes for a legacy
/// sale with no `deduction_locations`.
///
/// A negative or zero quantity is skipped, not credited backwards: the
/// `refund_lines.qty CHECK (qty > 0)` bound is unavailable on this path
/// because there is no row to constrain.
pub(super) fn credit_refund_effect_without_sale(
    tx: &rusqlite::Transaction<'_>,
    payload: &RefundPayload,
) -> Result<(), CoreError> {
    let store = Store::new(tx);
    for line in &payload.lines {
        if line.qty <= 0 {
            continue;
        }
        let location = line
            .location_id
            .as_deref()
            .unwrap_or(kasirmu_core::inventory::CANONICAL_DEFAULT_LOCATION_UUID);
        store.adjust_stock_at_location_with_reason(
            tx,
            &line.sku,
            line.qty,
            &kasirmu_core::inventory::LocationId::from(location),
            Some("refund"),
            None,
            None,
            None,
        )?;
    }
    Ok(())
}

/// Outcome of applying a remote item atomically (SYNC-10).
///
/// [`SyncQueue::apply_remote_atomic`](super::SyncQueue::apply_remote_atomic)
/// returns only `applied` for legacy callers; the reporting variant
/// [`SyncQueue::apply_remote_atomic_full`](super::SyncQueue::apply_remote_atomic_full)
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
