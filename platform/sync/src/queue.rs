//! Sync Queue — local change log for offline-first replication.
/*
last audited 26-09-06 by DSH (offline-sync spec verification pass; prior slice-B deep read by RSA-Agent 25-07-26)
crate: platform-sync | status: SAFE | lint: CLEAN
findings: exemplary — apply_remote_atomic_full runs quarantine gate, receipt-exists check, domain mutation, and receipt insert in ONE transaction (crash-safe replay protection); failure path drops the tx then records the failure with retry budget 3 for dead-lettering; CRDT delta merge arms for stock payloads; SYNC-10 settings with non-fatal delta write (savepoint-safe inside caller tx); finalize_sale idempotent pending-to-completed only; unsupported actions fail closed; apply_push_conflict is the single SYNC-02 shared resolver entry; apply_remote is the deprecated non-atomic legacy mirror. CORRECTED prior note: the earlier "pull items are not validated" concern was WRONG — the product.created arm's unwrap_or("")/unwrap_or(-1) payload defaults are fully caught at the storage boundary: create_product_if_absent_in_tx rejects blank/oversize sku+name, negative price_minor and initial_stock, and returns CoreError::Conflict on a same-sku-different-data replay (a remote update that disagrees is NOT silently overwritten — it fails and dead-letters visibly). Every other pull arm parses a typed serde struct (missing required fields fail deserialization) or a validating store fn, so the whole pull path is fail-closed and conflict-visible without a separate payload-validation layer.
next: malformed/conflicting pull items are permanent failures but still burn the retry-3 budget before dead-lettering — consider classifying apply-time Validation/Conflict errors as non-retryable to fail fast (low value, behavior change in the highest-risk path, deliberately not done here) | perf: prepared upserts
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
use kasirmu_core::settings::Settings;
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
fn remote_sync_admits(key: &str) -> bool {
    IngestPolicy::RemoteSync.admits(key)
}

/// `sale_id` is read by two callers, both of which must name the effect
/// WITHOUT applying it: `remote_effect_key` (which keys the receipt) and the
/// `complete_sale` arm's secondary origin guard (C3, slice S4), which asks
/// whether this terminal already completed that sale. It is `Option` so a
/// payload minted before the field existed still deserializes and is applied
/// exactly as it was.
#[derive(Deserialize)]
struct SalePayload {
    #[serde(default)]
    sale_id: Option<String>,
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
fn product_has_location_rows(tx: &rusqlite::Transaction<'_>, sku: &str) -> Result<bool, CoreError> {
    let product_id = Store::new(tx).product_id_by_sku(sku)?;
    match product_id {
        Some(id) => Store::product_has_location_rows(tx, &id),
        None => Ok(false),
    }
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
struct RefundPayload {
    /// The refund's own primary key, minted on the originator.
    id: String,
    /// FK to the original sale. The sales row is a REAL foreign key
    /// (`refunds.sale_id REFERENCES sales(id)`), so a refund can only be
    /// replicated where the sale already exists.
    sale_id: String,
    /// Refund total in minor units.
    #[serde(default)]
    total_minor: i64,
    /// Refund currency (ISO-4217).
    #[serde(default)]
    currency: String,
    #[serde(default)]
    reason: String,
    #[serde(default)]
    note: String,
    /// Staff member who processed the refund on the originator.
    #[serde(default)]
    processed_by: String,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    lines: Vec<RefundLinePayload>,
}

/// One line of a `refund_sale` payload.
#[derive(Deserialize)]
struct RefundLinePayload {
    /// The refund line's own primary key, minted on the originator.
    id: String,
    #[serde(default)]
    sale_line_id: String,
    #[serde(default)]
    sku: String,
    #[serde(default)]
    qty: i64,
    #[serde(default)]
    unit_minor: i64,
    #[serde(default)]
    line_minor: i64,
    #[serde(default)]
    currency: String,
    #[serde(default)]
    created_at: String,
    /// The location the originator deducted these units from. Absent on older
    /// senders and on legacy sales; the credit then lands at the canonical
    /// default location.
    #[serde(default)]
    location_id: Option<String>,
}

/// Payload for the `void_sale` sync action.
///
/// A void carries no refund rows — its whole effect is the sale's own status,
/// so idempotency is decided by a compare-and-set on that status rather than
/// by a row of its own.
#[derive(Deserialize)]
struct VoidSalePayload {
    /// The sale to void. The originator's `reason`/`user_id` (when sent) are
    /// tolerated and ignored: a void's whole effect is the sale's status, and
    /// the local audit row for it is written by the path that owns the status.
    sale_id: String,
}

/// Payload for the `payment.recorded` sync action.
///
/// The payment's own durable row is `payments.id`; a gateway tender also
/// carries an `idempotency_key` with a UNIQUE index behind it, which is the
/// stronger identity when it is present.
#[derive(Deserialize)]
struct PaymentPayload {
    /// The payment's own primary key, minted on the originator.
    id: String,
    /// FK to the sale. Also a real foreign key, so a payment can only be
    /// replicated where the sale already exists.
    sale_id: String,
    #[serde(default)]
    method: String,
    #[serde(default)]
    amount_minor: i64,
    #[serde(default)]
    currency: String,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    gateway_reference: Option<String>,
    #[serde(default)]
    gateway_status: Option<String>,
    #[serde(default)]
    gateway_response: Option<String>,
    /// Unique when present — the idempotency probe prefers it.
    #[serde(default)]
    idempotency_key: Option<String>,
}

/// Whether this database already contains the refund the payload describes,
/// decided by the refund's OWN durable row (checklist C4).
///
/// A refund's downstream effects — stock credits, the loyalty reversal, the
/// customer spend reversal, the audit row — are all functions of
/// `refunds.id` and share its transaction, so this ONE probe suppresses them
/// together. `sync_applied_items` is deliberately NOT consulted: it records
/// that an item was delivered, not that its effect landed.
fn refund_already_applied(conn: &rusqlite::Connection, refund_id: &str) -> Result<bool, CoreError> {
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
fn payment_already_applied(
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
fn sale_completed_here_in_tx(
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
fn remote_effect_key(action: &str, payload: &str) -> Option<String> {
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
fn apply_refund_with_sale_in_tx(
    tx: &rusqlite::Transaction<'_>,
    payload: &RefundPayload,
) -> Result<(), CoreError> {
    tx.execute(
        "INSERT INTO refunds (id, sale_id, total_minor, currency, reason, note, processed_by, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            payload.id,
            payload.sale_id,
            payload.total_minor,
            payload.currency,
            payload.reason,
            payload.note,
            payload.processed_by,
            payload.created_at,
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
fn reverse_loyalty_for_refund_in_tx(
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
fn reverse_customer_spend_for_refund_in_tx(
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
fn apply_void_sale_in_tx(
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
fn insert_payment_in_tx(
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
fn credit_refund_effect_without_sale(
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
                let currency_parsed: kasirmu_core::Currency =
                    currency
                        .parse()
                        .map_err(|e: kasirmu_core::money::InvalidCurrencyCode| {
                            CoreError::Internal(format!("invalid currency in sync payload: {e}"))
                        })?;
                let initial_stock = payload["initial_stock"].as_i64().unwrap_or(0);
                let product_type = payload["product_type"].as_str().unwrap_or("retail");
                Store::new(tx).create_product_if_absent_in_tx(
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
