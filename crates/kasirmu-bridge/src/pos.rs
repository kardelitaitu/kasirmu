//! POS cart and held-bill bridge module (Wave D / D1a) - the tauri-free half of
//! apps/desktop-tauri/src/commands/pos.rs.
//!
//! Key functions: the session-scoped cart operations set_cart_discount_scoped,
//! start_sale_scoped, add_line_scoped, override_line_price_scoped,
//! override_cart_deduction_location_scoped, get_cart_deduction_location_scoped,
//! compute_cart_tax_scoped, and the hold / list / get / delete held-cart plus
//! open-bill group, plus the shared pure helpers tax_scope_now,
//! runtime_stock_target_instances, line_unit_price and the topology runtime-plan
//! resolvers that the desktop pos and kds command modules re-export.
//!
//! Checkout (complete_sale_scoped, the shortfall retry) and the two promotion
//! previews land in D1b. Gate order, the explicit Lock 1 / Lock 2 scoping that
//! keeps the rusqlite guard from crossing an await, and every error text are
//! verbatim ports of the command bodies: a shim builds the context, calls one
//! function here, and maps BridgeError back to AppError so the wire shape never
//! moves. Nothing here awaits while a store guard is alive - the shell
//! tauri::command futures must stay Send.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use foundation::Percentage;
use kasirmu_core::db::Store;
use kasirmu_core::events::{SaleCompleted, SaleCompletedLine};
use kasirmu_core::{CartId, Currency, Money, PaymentSplitArg};
// Only `pos_tests.rs` reaches these through `use super::*` — the cart-authoring
// code that used them moved to `pos/cart.rs`, which imports them directly. Gated
// to the test build so the lib build stays warning-free.
#[cfg(test)]
use kasirmu_core::{LineId, Sku};

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// The settings key under which the workspace topology runtime plan is stored.
///
/// Owned here since Wave D / D1 because pos is its primary reader; the desktop
/// commands::topology module re-exports this one constant so its own readers and
/// the sibling kds module keep resolving the same path unchanged, and the
/// "oz-pos/topology-runtime" string keeps exactly one definition.
pub const TOPOLOGY_RUNTIME_SETTING_KEY: &str = "oz-pos/topology-runtime";

/// The tax scope for a sale rung up at `location_id` right now.
///
/// `as_of` is the STORE-LOCAL business date (ADR #48 Decision 3), resolved by
/// applying the location's IANA zone to the current instant — not the raw UTC
/// date. It matters because `effective_to` is exclusive, so a boundary day must
/// have exactly one answer: a 00:30 WIB sale is that local day, and resolving it
/// in UTC would look up yesterday's rate while the receipt shows today's date.
///
/// A missing or corrupt `locations.timezone` falls back to UTC inside
/// [`kasirmu_core::timezone::business_date_in_zone`], which is the old behaviour
/// and never resolves a wrong day rather than guessing an offset.
pub fn tax_scope_now(store: &Store, location_id: &str) -> kasirmu_core::TaxSaleScope {
    // ADR #48 (Decision 3): as_of is the location business date, so resolve it in
    // the store's IANA zone, not raw UTC. The instant stays Utc::now(); only the
    // zone applied before formatting changes. A missing/corrupt timezone falls
    // back to UTC, which is the old behaviour and never resolves a wrong day.
    let timezone = store
        .get_location_profile(location_id)
        .ok()
        .flatten()
        .map(|p| p.timezone)
        .unwrap_or_else(|| "UTC".to_string());
    kasirmu_core::TaxSaleScope {
        location_id: location_id.to_string(),
        as_of: kasirmu_core::timezone::business_date_in_zone(chrono::Utc::now(), &timezone),
    }
}

/// Select every distinct warehouse target from validated POS stock routes.
///
/// Runtime-plan order is the allocation priority: the first route is the
/// preferred warehouse, and later routes fill the remaining quantity.
pub fn runtime_stock_target_instances(plan: &Value, source_instance_id: &str) -> Vec<String> {
    let mut targets = Vec::new();
    if let Some(routes) = plan.get("routes").and_then(Value::as_array) {
        for route in routes {
            let is_stock_route = route.get("source_instance_id").and_then(Value::as_str)
                == Some(source_instance_id)
                && route.get("from_port_id").and_then(Value::as_str) == Some("stock-out")
                && route.get("to_port_id").and_then(Value::as_str) == Some("stock-in")
                && route.get("relationship_type").and_then(Value::as_str) == Some("stock-routing");
            // A Retail POS → Warehouse Operation edge is the warehouse's
            // one primary input. The compiler annotates its target kind so
            // it can also serve as the stock-deduction target without
            // confusing Restaurant POS → KDS operation feeds with stock.
            let is_retail_operation_route = route.get("source_instance_id").and_then(Value::as_str)
                == Some(source_instance_id)
                && route.get("from_port_id").and_then(Value::as_str) == Some("operation-out")
                && route.get("to_port_id").and_then(Value::as_str) == Some("operation-in")
                && route.get("relationship_type").and_then(Value::as_str) == Some("generic")
                && route.get("target_node_kind").and_then(Value::as_str) == Some("warehouse");
            let Some(target) = (is_stock_route || is_retail_operation_route)
                .then(|| route.get("target_instance_id").and_then(Value::as_str))
                .flatten()
            else {
                continue;
            };
            if !targets.iter().any(|existing| existing == target) {
                targets.push(target.to_owned());
            }
        }
    }
    targets
}

/// All warehouse target instances for a source POS instance, in runtime-plan
/// (allocation-priority) order. An empty plan means no topology routing is set.
pub fn resolve_runtime_stock_targets(
    conn: &rusqlite::Connection,
    store_id: &str,
    source_instance_id: &str,
) -> Result<Vec<String>, BridgeError> {
    let key = format!("{TOPOLOGY_RUNTIME_SETTING_KEY}/{store_id}");
    let Some(json) = kasirmu_core::Settings::get(conn, &key)? else {
        return Ok(Vec::new());
    };
    let plan: Value = serde_json::from_str(&json)
        .map_err(|e| BridgeError::Internal(format!("parse topology runtime plan: {e}")))?;
    Ok(runtime_stock_target_instances(&plan, source_instance_id))
}

/// The preferred warehouse target for a source POS instance, if any.
pub fn resolve_runtime_stock_target(
    conn: &rusqlite::Connection,
    store_id: &str,
    source_instance_id: &str,
) -> Result<Option<String>, BridgeError> {
    Ok(
        resolve_runtime_stock_targets(conn, store_id, source_instance_id)?
            .into_iter()
            .next(),
    )
}
// ── Discount ─────────────────────────────────────────────────────────
#[path = "pos/cart.rs"]
mod cart;
pub use cart::{
    AddLineArgs, AddLineResult, DeductionLocationInfo, OverrideLinePriceArgs,
    OverrideLinePriceScopedArgs, PublishCourseFiredArgs, PublishCourseFiredItem,
    SetCartDiscountArgs, SetCartDiscountScopedArgs, SetLineCourseArgs, StartSaleArgs,
    StartSaleResult, add_line_scoped, compute_cart_tax_scoped, get_cart_deduction_location_scoped,
    line_unit_price, override_cart_deduction_location_scoped, override_line_price_scoped,
    publish_course_fired_scoped, run_override_line_price_unchecked, run_set_line_course_unchecked,
    set_cart_discount_scoped, set_line_course_scoped, start_sale_scoped,
};

// ── Hold Orders ──────────────────────────────────────────────────────

mod hold_orders;
pub use hold_orders::{
    BILL_TYPE_OPEN_BILL, HoldCartArgs, HoldCartResult, default_bill_type, delete_held_cart_scoped,
    get_held_cart_scoped, hold_cart_scoped, is_restaurant_pos_workspace, list_held_carts_scoped,
    list_open_bills_scoped,
};

// ── Tests ─────────────────────────────────────────────────────────────

// ── Checkout & preview commands (Wave D / D1b) ──────────────────────────

/// Discriminator for [`CompleteSaleArgs`]/[`CompleteSaleScopedArgs`] payment
/// state.
///
/// ADR #20 (payment-capture ordering) stores the canonical marker string
/// [`PaymentKind::SPLIT_MARKER`] in the `sales.payment_method` column
/// whenever the sale is settled via multiple tenders. This enum wraps the
/// marker so the code path no longer references a bare string literal (L-1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PaymentKind {
    /// Sale settled via a single payment method (cash, card, QRIS, etc.).
    /// The wire value is the user-supplied `payment_method` argument.
    Single,
    /// Sale settled via multiple payment methods (split-tender).
    /// The wire value is the canonical marker [`PaymentKind::SPLIT_MARKER`].
    Split,
}

impl PaymentKind {
    /// Canonical wire-format string for split-tender sales. Persisted
    /// in `sales.payment_method` and roundtripped through the IPC DTO.
    pub const SPLIT_MARKER: &'static str = "split";

    /// Resolve this payment kind to the wire-format string stored in
    /// `sales.payment_method`. Both variants earn their place: `Single`
    /// returns the user-supplied method verbatim; `Split` returns the
    /// canonical ADR #20 marker.
    ///
    /// Instance method (not associated function) so the type system
    /// forces callers to construct a `PaymentKind` value — keeps the
    /// enum's variants from going orphan.
    pub fn wire_method(&self, single_method: &str) -> String {
        match self {
            Self::Single => single_method.to_string(),
            Self::Split => Self::SPLIT_MARKER.to_string(),
        }
    }
}

// ── Complete Sale ────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Serialnumberarg.
pub struct SerialNumberArg {
    /// Stock-keeping unit identifier.
    pub sku: String,
    /// Serial.
    pub serial: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Completesaleargs.
pub struct CompleteSaleArgs {
    /// ID of the associated cart.
    pub cart_id: CartId,
    /// Payment Method.
    pub payment_method: String,
    /// Tendered Minor.
    pub tendered_minor: Option<i64>,
    /// ID of the associated user.
    pub user_id: String,
    /// Optional customer id to link this sale to a customer
    /// for loyalty tracking and purchase history.
    pub customer_id: Option<String>,
    /// Optional payment splits for multi-method payments.
    /// When provided, the `payment_method` on the sale is set to "split"
    /// and each split is recorded in the `payments` table.
    pub payment_splits: Option<Vec<PaymentSplitArg>>,
    /// Optional customer name (for credit sales).
    pub customer_name: Option<String>,
    /// Optional serial numbers captured at checkout for track_serial products.
    pub serial_numbers: Option<Vec<SerialNumberArg>>,
    /// CUR-02: original sale currency when multi-currency checkout is used.
    pub base_currency: Option<String>,
    /// CUR-02: original sale total in `base_currency` minor units.
    pub base_total_minor: Option<i64>,
    /// CUR-02: fixed-point rate (millionths) `base_currency → sale currency`.
    pub tender_rate_millionths: Option<i64>,
    /// Tip amount in minor units collected at checkout (default 0).
    pub tip_minor: Option<i64>,
    /// Service-charge amount in minor units collected at checkout (default 0).
    pub service_charge_minor: Option<i64>,
    /// PROMO-3 checkout integration: promotions to engine-apply against
    /// the post-tax sale. Each reduces the payable total (stacking) and
    /// the application rows persist inside the checkout transaction;
    /// payment splits are validated against the reduced total.
    pub promotion_ids: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
/// Completesalescopedargs.
///
/// `deny_unknown_fields` is deliberate hardening, ported from the tablet
/// shell's copy (Phase 3.3 T4): the absence of it is what let the shipped
/// UI's `attemptId` vanish silently on the tablet while looking guarded.
/// Every field the wire can carry is listed field-for-field against
/// `ui/src/api/sales.ts::CompleteSaleScopedArgs` (15 fields) and both
/// senders in the payment modal (the main path and
/// the QRIS path, whose extra spread is `tenderSnapshot` — tip, service
/// charge and the three CUR-02 fields, all present below). An unknown key
/// now fails loudly instead of being dropped — on every shell.
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompleteSaleScopedArgs {
    /// ID of the associated cart.
    pub cart_id: CartId,
    /// Payment Method.
    pub payment_method: String,
    /// Tendered Minor.
    pub tendered_minor: Option<i64>,
    /// ID of the associated customer.
    pub customer_id: Option<String>,
    /// Payment Splits.
    pub payment_splits: Option<Vec<PaymentSplitArg>>,
    /// Customer Name.
    pub customer_name: Option<String>,
    /// Serial Numbers.
    pub serial_numbers: Option<Vec<SerialNumberArg>>,
    /// CUR-02: original sale currency when multi-currency checkout is used.
    pub base_currency: Option<String>,
    /// CUR-02: original sale total in `base_currency` minor units.
    pub base_total_minor: Option<i64>,
    /// CUR-02: fixed-point rate (millionths) `base_currency → sale currency`.
    pub tender_rate_millionths: Option<i64>,
    /// Tip amount in minor units collected at checkout (default 0).
    pub tip_minor: Option<i64>,
    /// Service-charge amount in minor units collected at checkout (default 0).
    pub service_charge_minor: Option<i64>,
    /// PROMO-3 checkout integration: promotions to engine-apply against
    /// the post-tax sale (see `CompleteSaleArgs::promotion_ids`).
    pub promotion_ids: Option<Vec<String>>,
    /// COR-7: identifies one checkout attempt. Every submission of the same
    /// attempt (first tap, shortfall retry, re-tap after a lost response)
    /// carries the same value, so a replay returns the receipt that already
    /// exists instead of ringing up a second sale. Absent means no guard.
    pub attempt_id: Option<String>,
    /// F2-6: the client's claim that the displayed tax was an ESTIMATE (tax
    /// cache stale/unknown at checkout). Core verifies by computing the tax
    /// itself and stamps claim + computed tax into `sales.tax_estimate_note`
    /// (D61 ruling 4: flag for recompute, never silent). Absent/false is
    /// the zero-change default: no stamp.
    pub tax_estimated: Option<bool>,
}

#[derive(Debug, Serialize)]
/// Completesaleresult.
pub struct CompleteSaleResult {
    /// ID of the associated sale.
    pub sale_id: String,
    /// Total amount in minor currency units.
    pub total: Option<Money>,
    /// Line Count.
    pub line_count: usize,
}

/// Stamp one idempotency key per split from a checkout attempt id.
///
/// The index is required, not cosmetic: a split tender whose rows all carried
/// the same key would collide with itself on the second row and reject a
/// legitimate first sale. `{attempt}:{n}` is deterministic, so replaying an
/// attempt reproduces exactly the same set of keys and the UNIQUE index on
/// `payments.idempotency_key` closes the race.
///
/// No attempt id means no guard, which keeps legacy callers and CLI imports
/// working unchanged.
pub fn stamp_attempt_split_keys(attempt_id: Option<&str>, splits: &mut [PaymentSplitArg]) {
    if let Some(attempt) = attempt_id {
        for (i, split) in splits.iter_mut().enumerate() {
            split.idempotency_key = Some(format!("{attempt}:{i}"));
        }
    }
}

/// What the COR-7 replay guard decided for this submission.
enum ReplayVerdict {
    /// The attempt already completed: hand back this receipt and touch
    /// nothing.
    Replayed(CompleteSaleResult),
    /// No completed attempt sits behind this key: settle normally with the
    /// request's own attempt id.
    Fresh,
    /// A key matched but must not answer this submission — its sale is
    /// VOIDED, or it belongs to a different basket. The `String` is the
    /// basket-derived re-key stem the caller must stamp instead: it binds
    /// the attempt id to THIS submission's basket identity, so a retry of
    /// the same submission finds its own receipt and the orphaned-receipt
    /// trap a random re-key once created cannot recur.
    Rekey(String),
}

/// Build the receipt a replay hands back for a matched sale.
fn replay_receipt(sale: &kasirmu_core::Sale) -> CompleteSaleResult {
    CompleteSaleResult {
        sale_id: sale.id.clone(),
        total: Some(sale.total),
        line_count: sale.lines.len(),
    }
}

/// Validate a client-supplied checkout attempt id.
///
/// Mirrors the tablet's `normalized_attempt_id` — trim, and absent/empty/
/// whitespace-only all collapse to `None` (UNGUARDED) — with one hard
/// rejection the tablet normalizer does not have: an attempt id containing
/// `:' is refused. The id is OPAQUE and never parsed, but the KEY namespace
/// around it is colon-separated, so a crafted id like `a:rekey:b` would
/// stamp a base key identical to another attempt's re-key LOOKUP key and
/// hand one basket the wrong receipt. Colons never appear in the UUIDs the
/// UI mints, so honest clients never see this error.
fn validated_attempt_id(raw: Option<&str>) -> Result<Option<String>, BridgeError> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.contains(':') {
        return Err(BridgeError::Invalid(
            "checkout attempt id must not contain ':'".into(),
        ));
    }
    Ok(Some(trimmed.to_owned()))
}

/// Stable identity of the basket a shortfall submission re-sells.
///
/// The resolved-shortfalls command re-builds its cart from the request body
/// under a SYNTHETIC `resolved-<timestamp>` cart id that is regenerated on
/// every submit, so the cart id cannot anchor a re-key — the basket CONTENTS
/// can: one dialog retry re-sends the same lines, total, currency and
/// discount. Lines are sorted before hashing so mere ordering cannot split
/// one basket into two identities. Never parses the `resolved` prefix —
/// the prefix is treated as noise and the contents as the identity.
fn shortfall_basket_key(args: &CompleteSaleWithResolvedShortfallsArgs) -> String {
    use sha2::Digest as _;
    let mut hasher = sha2::Sha256::new();
    hasher.update(args.currency.as_bytes());
    hasher.update(args.total_minor.to_le_bytes());
    hasher.update(args.discount_percent.to_le_bytes());
    let mut lines: Vec<&CartLineData> = args.lines.iter().collect();
    lines.sort_by(|a, b| {
        (&a.sku, a.qty, a.unit_price_minor, &a.unit_price_currency).cmp(&(
            &b.sku,
            b.qty,
            b.unit_price_minor,
            &b.unit_price_currency,
        ))
    });
    for line in lines {
        hasher.update(line.sku.as_bytes());
        hasher.update(line.qty.to_le_bytes());
        hasher.update(line.unit_price_minor.to_le_bytes());
        hasher.update(line.unit_price_currency.as_deref().unwrap_or("").as_bytes());
    }
    format!("items:{}", hex::encode(&hasher.finalize()[..12]))
}

/// Build the re-key stem for one void epoch of an (attempt, basket) pair.
fn rekey_stem(attempt: &str, basket_key: &str, epoch: i64) -> String {
    format!("{attempt}:rekey:{basket_key}:v{epoch}")
}

/// Count settlements already recorded under a re-key stem prefix.
///
/// Each settlement contributes exactly one first-split row ending in `:0`,
/// so the count doubles as the next free void epoch. The prefix is compared
/// with `substr`, never LIKE — attempt ids are client-supplied and `%` or
/// `_` inside them would be LIKE wildcards.
fn count_rekey_settlements(conn: &rusqlite::Connection, prefix: &str) -> Result<i64, BridgeError> {
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM payments              WHERE substr(idempotency_key, 1, ?2) = ?1 AND substr(idempotency_key, -2) = ':0'",
            rusqlite::params![prefix, prefix.len()],
            |row| row.get(0),
        )
        .map_err(|e| BridgeError::Internal(format!("counting re-keyed settlements: {e}")))?;
    Ok(n)
}

/// Decide whether a submission replays an already-completed attempt.
///
/// The caller cannot supply the sale id — the response that carried it is the
/// very thing that was lost — so the attempt key is the only handle back to
/// the original sale. Resolving it here, before any write, is what makes a
/// replay return a receipt instead of an error:
///
/// - `complete_sale_scoped` removes the cart as its first step, so a retry
///   would otherwise fail with "cart not found" while the sale sits completed.
/// - the shortfall command rebuilds its lines from the request body under a
///   synthetic per-submit cart id, so it has no cart dependency at all and
///   would otherwise sell the same basket a second time.
///
/// A match is trusted as THIS request's receipt only when it can be tied to
/// the request's own basket:
///
/// - Step 1 consults the re-key namespace `{attempt}:rekey:{basket}:v{n}:0`.
///   The stem binds the attempt id to THIS submission's basket identity
///   (real cart id for the scoped command, contents hash for the shortfall
///   command), and attempt ids are validated colon-free, so a hit here is
///   this basket's own settlement and answers with ITS receipt — never an
///   older attempt's. The latest void epoch answers; a VOIDED latest epoch
///   re-keys to the next epoch instead of dead-ending.
/// - Step 2 consults the base key `{attempt}:0`. A VOIDED match satisfies
///   no replay (it took no money and returned its stock) but must not block
///   a new sale either, so it re-keys into the basket namespace. A LIVE
///   match answers only while the request's cart is already consumed; if
///   that cart still exists the matched sale belongs to a DIFFERENT basket
///   and this submission settles under its own basket-derived key — a
///   silent re-key with a RANDOM stem once orphaned receipts, but a
///   basket-derived stem keeps every settlement discoverable, so the
///   second basket can still be sold (a hard refusal here would make a
///   legitimate sale impossible after a lost response).
///
/// Only the first split's key is consulted: every key of one attempt maps to
/// the same sale.
fn replay_verdict(
    conn: &rusqlite::Connection,
    attempt_id: Option<&str>,
    basket_key: Option<&str>,
    request_cart_id: Option<&CartId>,
) -> Result<ReplayVerdict, BridgeError> {
    let Some(attempt) = attempt_id else {
        return Ok(ReplayVerdict::Fresh);
    };
    let store = Store::new(conn);
    // Step 1 — the re-key namespace: provably bound to (attempt, basket).
    if let Some(basket) = basket_key {
        let prefix = format!("{attempt}:rekey:{basket}:v");
        let settled = count_rekey_settlements(conn, &prefix)?;
        if settled > 0 {
            let latest_key = format!("{}:0", rekey_stem(attempt, basket, settled - 1));
            if let Some(sale_id) = store.find_sale_by_idempotency_key(&latest_key)? {
                let sale = store.get_sale(&sale_id)?.ok_or_else(|| {
                    BridgeError::Internal("re-keyed payment points at a missing sale".into())
                })?;
                if sale.status == foundation::SaleStatus::Voided {
                    return Ok(ReplayVerdict::Rekey(rekey_stem(attempt, basket, settled)));
                }
                return Ok(ReplayVerdict::Replayed(replay_receipt(&sale)));
            }
        }
    }
    // Step 2 — the attempt's own first-split key.
    let Some(sale_id) = store.find_sale_by_idempotency_key(&format!("{attempt}:0"))? else {
        return Ok(ReplayVerdict::Fresh);
    };
    let sale = store
        .get_sale(&sale_id)?
        .ok_or_else(|| BridgeError::Internal("replayed payment points at a missing sale".into()))?;
    if sale.status == foundation::SaleStatus::Voided {
        let Some(basket) = basket_key else {
            return Err(BridgeError::Invalid(format!(
                "checkout attempt {attempt} was voided and no basket identity was supplied — start a new checkout"
            )));
        };
        let settled = count_rekey_settlements(conn, &format!("{attempt}:rekey:{basket}:v"))?;
        return Ok(ReplayVerdict::Rekey(rekey_stem(attempt, basket, settled)));
    }
    // Key equality is not basket identity: while the request's cart still
    // exists, the matched sale belongs to a DIFFERENT basket. Settle this
    // one under its own basket-derived key — discoverable by Step 1, so no
    // receipt is orphaned and no legitimate sale is refused.
    if let Some(cart_id) = request_cart_id
        && store.load_active_cart(cart_id)?.is_some()
    {
        let Some(basket) = basket_key else {
            return Err(BridgeError::Invalid(format!(
                "checkout attempt {attempt} already completed a different basket (sale {sale_id})"
            )));
        };
        let settled = count_rekey_settlements(conn, &format!("{attempt}:rekey:{basket}:v"))?;
        return Ok(ReplayVerdict::Rekey(rekey_stem(attempt, basket, settled)));
    }
    Ok(ReplayVerdict::Replayed(replay_receipt(&sale)))
}

/// A single cart line reconstructed by the frontend for the second command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CartLineData {
    /// SKU identifier.
    pub sku: String,
    /// Quantity.
    pub qty: i64,
    /// Unit price in minor units.
    pub unit_price_minor: i64,
    /// FRONTEND-03 follow-up: ISO-4217 code the line is priced in. When
    /// present the reconstruction builds the line in this currency and
    /// `Cart::add_line` enforces it matches the sale currency; absent
    /// (legacy callers) falls back to the sale currency as before.
    pub unit_price_currency: Option<String>,
    /// Restaurant course assignment, carried on the shortfall-retry
    /// reconstruction so the retried sale keeps the first submission's
    /// course. Normalized through `foundation::cart::normalize_course`.
    #[serde(default)]
    pub course: Option<String>,
}

/// Resolve the unit price for a reconstructed shortfall line
/// (FRONTEND-03 follow-up). Mirrors [`line_unit_price`]: the line's own
/// currency crosses the IPC boundary so a mismatch is rejected instead of
/// silently re-stamped to the sale currency.
pub fn shortfall_line_unit_price(
    line_data: &CartLineData,
    sale_currency: Currency,
) -> Result<Money, BridgeError> {
    let currency = match line_data.unit_price_currency.as_deref() {
        Some(s) => s
            .parse::<Currency>()
            .map_err(|_| BridgeError::Invalid(format!("invalid unit price currency: {s}")))?,
        None => sale_currency,
    };
    Ok(Money {
        minor_units: line_data.unit_price_minor,
        currency,
    })
}

/// Arguments for completing a sale with resolved shortfalls (split fulfillment).
///
/// `deny_unknown_fields` for the same reason as
/// [`CompleteSaleScopedArgs`]: enumerated field-for-field against
/// `ui/src/api/sales.ts::CompleteSaleWithResolvedShortfallsArgs`
/// (20 fields), whose only sender is
/// the stock-shortfall dialog. Ported from the
/// tablet shell's copy (Phase 3.3 T4) so every shell fails loudly on an
/// unknown key.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompleteSaleWithResolvedShortfallsArgs {
    /// ID of the original cart (informational).
    pub cart_id: CartId,
    /// Payment method label.
    pub payment_method: String,
    /// Tendered amount in minor units.
    pub tendered_minor: Option<i64>,
    /// Optional customer id.
    pub customer_id: Option<String>,
    /// Optional payment splits.
    pub payment_splits: Option<Vec<PaymentSplitArg>>,
    /// Customer name (for credit sales).
    pub customer_name: Option<String>,
    /// Optional serial numbers.
    pub serial_numbers: Option<Vec<SerialNumberArg>>,
    /// Cart line data reconstructed by the frontend (needed because the
    /// original cart was deleted in the first `complete_sale_scoped` call).
    pub lines: Vec<CartLineData>,
    /// Total sale amount in minor units.
    pub total_minor: i64,
    /// ISO-4217 currency code.
    pub currency: String,
    /// Discount percentage (0-100).
    pub discount_percent: i64,
    /// Optional discount label.
    pub discount_label: Option<String>,
    /// Cashier-resolved shortfalls: per-SKU allocation to specific locations.
    pub resolutions: Vec<kasirmu_core::sale_deduction::ResolvedShortfall>,
    /// CUR-02: original sale currency when multi-currency checkout is used.
    pub base_currency: Option<String>,
    /// CUR-02: original sale total in `base_currency` minor units.
    pub base_total_minor: Option<i64>,
    /// CUR-02: fixed-point rate (millionths) `base_currency → sale currency`.
    pub tender_rate_millionths: Option<i64>,
    /// Tip amount in minor units collected at checkout (default 0).
    pub tip_minor: Option<i64>,
    /// Service-charge amount in minor units collected at checkout (default 0).
    pub service_charge_minor: Option<i64>,
    /// PROMO-3 checkout integration: promotions to engine-apply against
    /// the post-tax sale (see `CompleteSaleArgs::promotion_ids`).
    pub promotion_ids: Option<Vec<String>>,
    /// COR-7: identifies one checkout attempt. Every submission of the same
    /// attempt (first tap, shortfall retry, re-tap after a lost response)
    /// carries the same value, so a replay returns the receipt that already
    /// exists instead of ringing up a second sale. Absent means no guard.
    pub attempt_id: Option<String>,
}

/// Plugin `calc_line_tax` overrides for a cart — shared by the complete
/// and preview commands so a previewed total matches the charged one.
async fn lua_calc_line_overrides(
    ctx: &BridgeCtx<'_>,
    cart: &kasirmu_core::Cart,
) -> Result<Vec<(String, i64, bool)>, BridgeError> {
    let mut overrides: Vec<(String, i64, bool)> = Vec::new();
    let plugins = ctx.plugins.lock().await;
    if let Some(ref plugins) = *plugins {
        for cl in cart.lines() {
            let currency_str = String::from_utf8_lossy(&cl.unit_price.currency.0).into_owned();
            if let Some(override_) = plugins
                .calc_line_tax(
                    cl.sku.as_str(),
                    cl.qty,
                    cl.unit_price.minor_units,
                    &currency_str,
                )
                .map_err(|e| BridgeError::Internal(e.to_string()))?
            {
                overrides.push((
                    cl.sku.as_str().to_owned(),
                    override_.rate_bps,
                    override_.is_inclusive,
                ));
            }
        }
    }
    Ok(overrides)
}

/// Arguments for previewing the promotion-reduced payable of a cart.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewPromotedTotalArgs {
    /// ID of the associated cart.
    pub cart_id: CartId,
    /// Promotions to preview, in application order (they stack).
    pub promotion_ids: Vec<String>,
}

/// One promotion's discount in the preview result.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewPromotionDiscount {
    /// Promotion that was applied.
    pub promotion_id: String,
    /// Discount in minor units.
    pub discount_minor: i64,
    /// Human-readable description (name + amount).
    pub description: String,
}

/// Result of previewing the promotion-reduced payable.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewPromotedTotalResult {
    /// Cart total after cart discount + tax, before promotions.
    pub base_total_minor: i64,
    /// Final payable after promotions — what payment splits must cover.
    pub total_minor: i64,
    /// Per-promotion discounts in application order.
    pub discounts: Vec<PreviewPromotionDiscount>,
}

/// Preview the promotion-reduced payable for a cart without mutating it.
///
/// PROMO-3 checkout integration: the client needs the promoted total
/// BEFORE constructing payment splits (the checkout call validates splits
/// against the reduced total). This runs the same cart → sale → tax →
/// engine sequence as [`complete_sale_scoped`] — including plugin tax
/// overrides — but consumes no cart and writes no rows; the authoritative
/// computation still happens inside the checkout call, which re-validates
/// the splits against the freshly computed total.
pub async fn preview_promoted_total_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: PreviewPromotedTotalArgs,
) -> Result<PreviewPromotedTotalResult, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, kasirmu_core::permissions::SALES_PROCESS)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;

    // ── Lock 1: peek the cart (do NOT delete it) ──────────────────
    let cart = {
        let db = conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
        let store = Store::new(&db);
        store
            .load_active_cart(&args.cart_id)?
            .ok_or_else(|| BridgeError::Invalid(format!("cart not found: {}", args.cart_id)))?
    };

    let mut sale = kasirmu_core::Sale::from_cart(&cart)
        .ok_or_else(|| BridgeError::Invalid("cart total overflowed i64".into()))?;

    // ── Plugin tax overrides (no DB lock held) ────────────────────
    let lua_overrides = lua_calc_line_overrides(ctx, &cart).await?;

    // ── Lock 2: tax + engine discounts (no writes) ────────────────
    let (base_total_minor, discounts) = {
        let db = conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
        let store = Store::new(&db);
        store.compute_sale_tax_for_location(
            &mut sale,
            &lua_overrides,
            kasirmu_core::Settings::get_tax_rounding_mode(&db)?,
            Some(&tax_scope_now(&store, &session.store_id)),
        )?;
        let base_total_minor = sale.total.minor_units;
        let apps = store.compute_checkout_promotions(
            &mut sale,
            &args.promotion_ids,
            chrono::Utc::now(),
        )?;
        let discounts = apps
            .into_iter()
            .map(|app| PreviewPromotionDiscount {
                promotion_id: app.promotion_id,
                discount_minor: app.discount_minor,
                description: app.description,
            })
            .collect();
        (base_total_minor, discounts)
    };

    Ok(PreviewPromotedTotalResult {
        base_total_minor,
        total_minor: sale.total.minor_units,
        discounts,
    })
}

/// One cart line for the lines-based promotion preview.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewLineArgs {
    /// Product SKU.
    pub sku: String,
    /// Quantity.
    pub qty: i64,
    /// Unit price in minor units.
    pub unit_price_minor: i64,
    /// ISO-4217 code of the unit price currency.
    pub unit_price_currency: String,
}

/// Arguments for previewing the promotion-reduced payable from raw lines.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewPromotedTotalFromLinesArgs {
    /// Cart lines, in cart order (already in cart currency).
    pub lines: Vec<PreviewLineArgs>,
    /// Cart discount percent already applied client-side (0-100).
    pub discount_percent: i64,
    /// Promotions to preview, in application order (they stack).
    pub promotion_ids: Vec<String>,
}

/// Narrow a wire `discount_percent` (`i64`) to the `Percentage` the cart takes.
///
/// The ONE place this narrowing happens, because the two doors that need it
/// disagreed and the disagreement moved money. `as u8` TRUNCATES rather than
/// clamps — 300 becomes 44, 256 becomes 0 — and `Percentage::new` then accepts
/// the truncated value, so an out-of-range request became a valid-but-wrong
/// discount instead of a refusal. The preview door had always clamped with
/// `.min(100)`; the shortfall checkout door had not, so a cart previewed at
/// 100% was charged at 44%.
///
/// Clamping is the right resolution of the two candidate behaviours: the
/// preview door's `.min(100)` is the one already shipped and already tested,
/// and `Percentage`'s own ceiling is 100, so "everything above the maximum
/// means the maximum" is the reading the type already commits to.
#[must_use]
pub fn checkout_discount_percent(discount_percent: i64) -> i64 {
    discount_percent.clamp(0, 100)
}

/// Build an in-memory cart mirroring the client's displayed cart for the
/// lines-based promotion preview (no persistence, no cart id needed).
fn build_preview_cart(
    lines: &[PreviewLineArgs],
    discount_percent: i64,
) -> Result<kasirmu_core::Cart, BridgeError> {
    let first = lines
        .first()
        .ok_or_else(|| BridgeError::Invalid("cannot preview an empty cart".into()))?;
    let parse_currency = |code: &str| -> Result<kasirmu_core::Currency, BridgeError> {
        code.parse()
            .map_err(|_| BridgeError::Invalid(format!("invalid currency code: {code}")))
    };
    let mut cart = kasirmu_core::Cart::new(parse_currency(&first.unit_price_currency)?);
    for l in lines {
        cart.add_line(kasirmu_core::CartLine::new(
            kasirmu_core::Sku::new(l.sku.clone()),
            l.qty,
            kasirmu_core::Money {
                minor_units: l.unit_price_minor,
                currency: parse_currency(&l.unit_price_currency)?,
            },
        ))
        .map_err(|e| BridgeError::Invalid(format!("cart line rejected: {e}")))?;
    }
    if discount_percent > 0
        && let Some(pct) =
            foundation::Percentage::new(checkout_discount_percent(discount_percent) as u8)
    {
        cart.set_discount(pct, None);
    }
    Ok(cart)
}

/// Preview the promotion-reduced payable from raw cart lines.
///
/// PROMO-3 checkout integration: the client materializes its backend cart
/// only at the confirm step, but needs the engine-exact payable BEFORE
/// then — to show the promoted total and let split payments be entered
/// against it. Runs cart → sale → tax → engine on an in-memory cart built
/// from the caller's lines (plugin tax overrides included, so the number
/// matches what the checkout call will charge); the authoritative
/// computation still happens inside the checkout call, which re-validates
/// the splits against the freshly computed total.
pub async fn preview_promoted_total_from_lines_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: PreviewPromotedTotalFromLinesArgs,
) -> Result<PreviewPromotedTotalResult, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, kasirmu_core::permissions::SALES_PROCESS)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;

    let cart = build_preview_cart(&args.lines, args.discount_percent)?;
    let mut sale = kasirmu_core::Sale::from_cart(&cart)
        .ok_or_else(|| BridgeError::Invalid("cart total overflowed i64".into()))?;

    // ── Plugin tax overrides (no DB lock held) ────────────────────
    let lua_overrides = lua_calc_line_overrides(ctx, &cart).await?;

    // ── Lock: tax + engine discounts (no writes) ──────────────────
    let (base_total_minor, discounts) = {
        let db = conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
        let store = Store::new(&db);
        store.compute_sale_tax_for_location(
            &mut sale,
            &lua_overrides,
            kasirmu_core::Settings::get_tax_rounding_mode(&db)?,
            Some(&tax_scope_now(&store, &session.store_id)),
        )?;
        let base_total_minor = sale.total.minor_units;
        let apps = store.compute_checkout_promotions(
            &mut sale,
            &args.promotion_ids,
            chrono::Utc::now(),
        )?;
        let discounts = apps
            .into_iter()
            .map(|app| PreviewPromotionDiscount {
                promotion_id: app.promotion_id,
                discount_minor: app.discount_minor,
                description: app.description,
            })
            .collect();
        (base_total_minor, discounts)
    };

    Ok(PreviewPromotedTotalResult {
        base_total_minor,
        total_minor: sale.total.minor_units,
        discounts,
    })
}

/// Complete a sale with cashier-resolved shortfalls (split fulfillment).
///
/// This is the second command in the two-command flow (ADR-19 §6b).
/// After `complete_sale_scoped` returns a `PartialStockResult` error,
/// the cashier resolves shortfalls via the Stock Shortfall dialog.
/// This command re-checks stock at the resolved locations and deducts
/// accordingly — using [`Store::complete_sale_with_resolved_shortfalls`].
/// The front-end passes cart line data since the original cart was deleted
/// in the first `complete_sale_scoped` call.
pub async fn complete_sale_with_resolved_shortfalls_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: CompleteSaleWithResolvedShortfallsArgs,
) -> Result<CompleteSaleResult, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, kasirmu_core::permissions::SALES_PROCESS)
        .await?;
    let stock_target_instance_id = {
        let global_db = ctx.lock_global().await;
        // §B: when the offline grace window has fully lapsed, the register
        // is read-only — new sales are rejected until the subscription is
        // verified online. Active/in-grace registers pass untouched.
        let sub = kasirmu_core::TenantSubscription::load(&global_db, "default")?
            .ok_or_else(|| BridgeError::Internal("default tenant subscription not found".into()))?;
        sub.verify_signature()?;
        sub.enforce_pos_writable()?;
        resolve_runtime_stock_target(&global_db, &session.store_id, &session.instance_id)?
    };
    let deduction_instance_id = stock_target_instance_id
        .as_deref()
        .unwrap_or(&session.instance_id);
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;

    // ── COR-7 replay guard ─────────────────────────────────────────
    // This is the path the guard really matters on: the command rebuilds its
    // cart from the request body and invents a `resolved-<timestamp>` cart id,
    // so unlike complete_sale_scoped it has no cart to run out of and would
    // otherwise re-sell the same basket on every retry.
    let attempt = validated_attempt_id(args.attempt_id.as_deref())?;
    // Basket identity anchoring the re-key stem: the cart id here is the
    // SYNTHETIC resolved-<timestamp> one, regenerated per submit, so the
    // request CONTENTS are the only stable identity — two submits one tick
    // apart must hash to the same stem or the money counts twice.
    let basket_key = shortfall_basket_key(&args);
    let mut effective_attempt_id = attempt.clone();
    {
        let db = conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
        match replay_verdict(
            &db,
            attempt.as_deref(),
            Some(basket_key.as_str()),
            Some(&args.cart_id),
        )? {
            ReplayVerdict::Replayed(replay) => {
                tracing::info!(
                    sale_id = %replay.sale_id,
                    "shortfall retry replayed an existing attempt — returning the original receipt"
                );
                return Ok(replay);
            }
            ReplayVerdict::Fresh => {}
            ReplayVerdict::Rekey(rekey_stem) => {
                // The matched key's sale was VOIDED, or it belongs to a
                // different basket: settle under a stem derived from the
                // attempt id and THIS submission's basket identity, so a
                // retry finds its own receipt and the stale id never
                // mis-answers for another basket.
                tracing::warn!(
                    "replay guard re-keying — stamping a basket-derived idempotency key"
                );
                effective_attempt_id = Some(rekey_stem);
            }
        }
    }

    // ── Reconstruct the Cart from front-end line data ─────────────
    let currency: kasirmu_core::Currency = args
        .currency
        .parse()
        .map_err(|_| BridgeError::Invalid(format!("invalid currency code: {}", args.currency)))?;

    let mut cart = kasirmu_core::Cart::new(currency);
    for line_data in &args.lines {
        let unit_price = shortfall_line_unit_price(line_data, cart.currency())?;
        let mut line = kasirmu_core::CartLine::new(
            kasirmu_core::Sku::new(&line_data.sku),
            line_data.qty,
            unit_price,
        );
        line.set_course(line_data.course.as_deref());
        cart.add_line(line)
            .map_err(|e| BridgeError::Invalid(e.to_string()))?;
    }

    // Apply discount if configured
    if args.discount_percent > 0
        && let Some(pct) =
            foundation::Percentage::new(checkout_discount_percent(args.discount_percent) as u8)
    {
        cart.set_discount(pct, args.discount_label.clone());
    }

    let line_count = cart.line_count();

    // ── Plugin tax overrides (no DB lock held) ────────────────────
    // C2: the main checkout door passes the plugin's calc_line_tax overrides
    // into the tax computation; this door passed an EMPTY list, so a sale that
    // went through shortfall resolution was taxed at the DB rates while the
    // same basket at the main door was taxed at the plugin's. Same helper,
    // same list: computed here, consumed inside the tax lock below.
    let lua_overrides = lua_calc_line_overrides(ctx, &cart).await?;

    let mut sale = kasirmu_core::Sale::from_cart_with_user(&cart, Some(session.user_id.clone()))
        .ok_or_else(|| BridgeError::Invalid("cart total overflowed i64".into()))?;
    sale.payment_method = Some(args.payment_method.clone());
    sale.tendered_minor = args.tendered_minor;
    sale.customer_id = args.customer_id.clone();
    // CUR-02: record tender-currency metadata when multi-currency checkout
    // was used. All three are None for single-currency sales.
    sale.base_currency = args.base_currency.clone();
    sale.base_total_minor = args.base_total_minor;
    sale.tender_rate_millionths = args.tender_rate_millionths;
    sale.tip_minor = args.tip_minor.unwrap_or(0);
    sale.service_charge_minor = args.service_charge_minor.unwrap_or(0);

    let sale_id = sale.id.clone();

    // ── Lock: Compute tax + execute the resolved deduction ────────
    let _result = {
        let db = conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
        let store = Store::new(&db);
        if let Some(target_instance_id) = stock_target_instance_id.as_deref() {
            kasirmu_core::location_resolver::resolve_primary_location(
                &db,
                target_instance_id,
                None,
            )?;
        }

        // Compute tax (same as first command)
        store.compute_sale_tax_for_location(
            &mut sale,
            &lua_overrides,
            kasirmu_core::Settings::get_tax_rounding_mode(&db)?,
            Some(&tax_scope_now(&store, &session.store_id)),
        )?;

        // PROMO-3 checkout integration: engine-apply the selected
        // promotions against the post-tax sale; sale.total is reduced in
        // place and the application rows persist inside the checkout tx.
        let checkout_applications = store.compute_checkout_promotions(
            &mut sale,
            args.promotion_ids.as_deref().unwrap_or(&[]),
            chrono::Utc::now(),
        )?;

        let mut splits = if let Some(ref splits) = args.payment_splits {
            splits.clone()
        } else {
            vec![PaymentSplitArg {
                method: args.payment_method.clone(),
                amount_minor: sale.total.minor_units,
                gateway_reference: args.customer_name.clone(),
                gateway_status: None,
                gateway_response: None,
                idempotency_key: None,
            }]
        };
        // COR-7: one key per split, derived from the attempt id so a replay of
        // this attempt reproduces the same keys and the UNIQUE index rejects a
        // second sale. The per-split index is what stops a multi-tender sale
        // from colliding with itself on its own second row. A stale id the
        // guard refused above was re-keyed, so this stamps the fresh one.
        stamp_attempt_split_keys(effective_attempt_id.as_deref(), &mut splits);

        // Multi-terminal: terminal_id is passed to complete_sale so that
        // the sale record tracks which terminal processed it. This enables
        // per-terminal reporting and cash drawer isolation.
        store.complete_sale_with_resolved_shortfalls(
            &sale,
            Some(deduction_instance_id),
            &splits,
            &session.user_id,
            Some(&session.terminal_id),
            &args.resolutions,
            &checkout_applications,
        )?
    };

    // Promotion-reduced payable (cart.total() would ignore promotions).
    let total = Some(sale.total);

    tracing::info!(%sale_id, store_id = %session.store_id, "sale completed with resolved shortfalls");

    // ── Event publishing (no DB lock held) ────────────────────────
    {
        let line_items: Vec<kasirmu_core::events::SaleCompletedLine> = sale
            .lines
            .iter()
            .map(|l| kasirmu_core::events::SaleCompletedLine {
                sku: l.sku.clone(),
                qty: l.qty,
                unit_price_minor: l.unit_price.minor_units,
                tax_minor: l.tax_amount.minor_units,
                tax_rate_id: l.tax_rate_id.clone(),
            })
            .collect();

        ctx.publish_event(&kasirmu_core::events::SaleCompleted {
            sale_id: sale_id.clone(),
            store_id: Some(session.store_id.clone()),
            line_items,
            total_minor: sale.total.minor_units,
            currency: String::from_utf8_lossy(&sale.currency.0).into_owned(),
            customer_id: args.customer_id.clone(),
        })
        .await;
    }

    Ok(CompleteSaleResult {
        sale_id,
        total,
        line_count,
    })
}

/// Complete a sale within the store resolved from a session token.
///
/// ADR #7: Scoped variant of `complete_sale`. The `user_id` for
/// permission checks, the sale audit trail, and plugin hooks is read
/// from the resolved `SessionContext`. Uses the store-scoped database
/// with two sequential locks (cart removal then sale creation) while
/// plugin hooks and event publishing run without holding any DB lock.
pub async fn complete_sale_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: CompleteSaleScopedArgs,
) -> Result<CompleteSaleResult, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, kasirmu_core::permissions::SALES_PROCESS)
        .await?;
    let stock_target_instance_ids = {
        let global_db = ctx.lock_global().await;
        // §B read-only lock (see complete_sale_with_resolved_shortfalls_scoped).
        let sub = kasirmu_core::TenantSubscription::load(&global_db, "default")?
            .ok_or_else(|| BridgeError::Internal("default tenant subscription not found".into()))?;
        sub.verify_signature()?;
        sub.enforce_pos_writable()?;
        resolve_runtime_stock_targets(&global_db, &session.store_id, &session.instance_id)?
    };
    let deduction_instance_id = stock_target_instance_ids
        .first()
        .map(String::as_str)
        .unwrap_or(&session.instance_id);
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    if !stock_target_instance_ids.is_empty() {
        let db = conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
        for target_instance_id in &stock_target_instance_ids {
            kasirmu_core::location_resolver::resolve_primary_location(
                &db,
                target_instance_id,
                None,
            )?;
        }
    }

    // ── COR-7 replay guard ─────────────────────────────────────────
    // Resolved before the cart is touched: the first attempt already removed
    // it, so a retry that fell through to Lock 1 would fail with "cart not
    // found" on a sale that actually completed. Key equality is not basket
    // identity: while the request's cart still exists, a key match belongs to
    // a DIFFERENT basket and must not be handed back as this receipt.
    //
    // Concurrency note (the two-lock shape is deliberate): this lookup runs
    // under its own lock and the settlement two locks below, because the
    // plugin hooks and event publish between them await — the store
    // connection is a std Mutex, whose guard cannot be held across an
    // await, so ONE lock spanning lookup-to-write is impossible without
    // restructuring the hook layout. The gap is still money-safe: two
    // concurrent submits of one attempt both pass this lookup, then
    // serialise on Lock 1 — the loser fails "cart not found" and never
    // settles — and the UNIQUE index on payments.idempotency_key closes the
    // key-write race. The only residual is a transient "cart not found" for
    // a retry racing an in-flight commit; it replays correctly on re-tap.
    let attempt = validated_attempt_id(args.attempt_id.as_deref())?;
    // Basket identity anchoring the re-key stem: the REAL cart id is stable
    // across retries of the same basket (the shortfall command hashes its
    // request contents instead — its cart id is synthetic per submit).
    let basket_key = format!("cart:{}", args.cart_id);
    let mut effective_attempt_id = attempt.clone();
    {
        let db = conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
        match replay_verdict(
            &db,
            attempt.as_deref(),
            Some(basket_key.as_str()),
            Some(&args.cart_id),
        )? {
            ReplayVerdict::Replayed(replay) => {
                tracing::info!(
                    sale_id = %replay.sale_id,
                    "checkout attempt replayed — returning the original receipt"
                );
                return Ok(replay);
            }
            ReplayVerdict::Fresh => {}
            ReplayVerdict::Rekey(rekey_stem) => {
                // The matched key's sale was VOIDED, or it belongs to a
                // different basket: settle under a stem derived from the
                // attempt id and THIS submission's basket identity, so a
                // retry finds its own receipt and the stale id never
                // mis-answers for another basket.
                tracing::warn!(
                    "replay guard re-keying — stamping a basket-derived idempotency key"
                );
                effective_attempt_id = Some(rekey_stem);
            }
        }
    }

    // ── Lock 1: Load and remove the cart ──────────────────────────
    let mut cart = {
        let db = conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
        let store = Store::new(&db);

        let cart = store
            .load_active_cart(&args.cart_id)?
            .ok_or_else(|| BridgeError::Invalid(format!("cart not found: {}", args.cart_id)))?;
        store.delete_active_cart(&args.cart_id)?;
        cart // db lock dropped here
    };

    let line_count = cart.line_count();

    // ── Plugin business-rule hooks (no DB lock held) ──────────────
    // A plugin discount is collected here and applied AFTER the plugin guard
    // is dropped, because applying it now needs a permission check that
    // awaits (C13) and a guard must never be held across one.
    let mut plugin_discount: Option<(i64, String)> = None;
    {
        let plugins = ctx.plugins.lock().await;
        if let Some(ref plugins) = *plugins {
            let lines: Vec<kasirmu_lua::CartLineData> = cart
                .lines()
                .iter()
                .map(|cl| kasirmu_lua::CartLineData {
                    sku: cl.sku.as_str().to_owned(),
                    qty: cl.qty,
                    unit_price_minor: cl.unit_price.minor_units,
                    currency: String::from_utf8_lossy(&cl.unit_price.currency.0).into_owned(),
                })
                .collect();

            let errors = plugins
                .validate_order(
                    &lines,
                    cart.total().map(|m| m.minor_units).unwrap_or(0),
                    &String::from_utf8_lossy(&cart.currency().0),
                )
                .map_err(|e| BridgeError::Internal(e.to_string()))?;
            if !errors.is_empty() {
                return Err(BridgeError::Invalid(format!(
                    "order validation failed: {}",
                    errors.join("; ")
                )));
            }

            if let Some(discount) = plugins
                .apply_discount(&lines)
                .map_err(|e| BridgeError::Internal(e.to_string()))?
            {
                let label = discount.label.clone().unwrap_or_else(|| "Lua Rule".into());
                if !(0..=100).contains(&discount.percent) {
                    return Err(BridgeError::Invalid(format!(
                        "Lua returned invalid discount percent: {}",
                        discount.percent
                    )));
                }
                plugin_discount = Some((discount.percent, label));
            }

            let currency = String::from_utf8_lossy(&cart.currency().0).into_owned();
            let total_minor = cart.total().map(|m| m.minor_units).unwrap_or(0);
            plugins
                .fire_sale_before_complete(&lines, total_minor, &currency, &session.user_id)
                .map_err(|e| BridgeError::Internal(e.to_string()))?;

            if let Some(pd) = plugins.drain_pending_discounts().into_iter().next() {
                if !(0..=100).contains(&pd.percent) {
                    return Err(BridgeError::Invalid(format!(
                        "Plugin returned invalid discount percent: {}",
                        pd.percent
                    )));
                }
                plugin_discount = Some((pd.percent, pd.target));
            }
        }
    }

    // C13: a plugin-supplied discount is money off the bill, so it clears the
    // SAME gate the manual path enforces (set_cart_discount_scoped). The plugin
    // manifest's required_permissions list is self-declared and never compared
    // with the caller's role, so without this gate anything able to drop a .lua
    // file in the plugin directory could discount an order with no permission
    // and no audit. Checked here, not before the drain, so a checkout that
    // pushes no discount still needs no extra permission.
    if let Some((percent, label)) = plugin_discount {
        ctx.require_session_permission(&session, kasirmu_core::permissions::SALES_DISCOUNT)
            .await?;
        // SAFETY: `percent` is validated 0..=100 at the point it is collected
        // above, on both the apply_discount and the drained path.
        let pct = Percentage::new(percent as u8).unwrap();
        cart.set_discount(pct, Some(label));
    }

    let mut sale = kasirmu_core::Sale::from_cart_with_user(&cart, Some(session.user_id.clone()))
        .ok_or_else(|| BridgeError::Invalid("cart total overflowed i64".into()))?;
    let kind = if args.payment_splits.as_ref().is_some_and(|s| !s.is_empty()) {
        PaymentKind::Split
    } else {
        PaymentKind::Single
    };
    sale.payment_method = Some(kind.wire_method(&args.payment_method));
    sale.tendered_minor = args.tendered_minor;
    sale.customer_id = args.customer_id.clone();
    // CUR-02: record tender-currency metadata when multi-currency checkout
    // was used. All three are None for single-currency sales.
    sale.base_currency = args.base_currency.clone();
    sale.base_total_minor = args.base_total_minor;
    sale.tender_rate_millionths = args.tender_rate_millionths;
    sale.tip_minor = args.tip_minor.unwrap_or(0);
    sale.service_charge_minor = args.service_charge_minor.unwrap_or(0);

    // ── Apply Lua calc_line_tax overrides (no DB lock) ────────────
    let lua_overrides = lua_calc_line_overrides(ctx, &cart).await?;

    let sale_id = sale.id.clone();

    // ── Lock 2: Compute tax and create sale ───────────────────────
    let _res = {
        let db = conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
        let store = Store::new(&db);
        let mut stock_locations = Vec::with_capacity(stock_target_instance_ids.len());
        for target_instance_id in &stock_target_instance_ids {
            let location = kasirmu_core::location_resolver::resolve_primary_location(
                &db,
                target_instance_id,
                None,
            )?;
            if !stock_locations.contains(&location) {
                stock_locations.push(location);
            }
        }

        store.compute_sale_tax_for_location(
            &mut sale,
            &lua_overrides,
            kasirmu_core::Settings::get_tax_rounding_mode(&db)?,
            Some(&tax_scope_now(&store, &session.store_id)),
        )?;

        if let Some(ref serial_numbers) = args.serial_numbers {
            for sn in serial_numbers {
                if let Some(line) = sale.lines.iter_mut().find(|l| l.sku == sn.sku) {
                    line.serial_number = Some(sn.serial.clone());
                }
            }
        }

        // PROMO-3 checkout integration: engine-apply the selected
        // promotions against the post-tax sale; sale.total is reduced in
        // place and the application rows persist inside the checkout tx.
        let checkout_applications = store.compute_checkout_promotions(
            &mut sale,
            args.promotion_ids.as_deref().unwrap_or(&[]),
            chrono::Utc::now(),
        )?;

        let mut splits = if let Some(ref splits) = args.payment_splits {
            splits.clone()
        } else {
            vec![PaymentSplitArg {
                method: args.payment_method.clone(),
                amount_minor: sale.total.minor_units,
                gateway_reference: args.customer_name.clone(),
                gateway_status: None,
                gateway_response: None,
                idempotency_key: None,
            }]
        };
        // COR-7: one key per split, derived from the attempt id so a replay of
        // this attempt reproduces the same keys and the UNIQUE index rejects a
        // second sale. The per-split index is what stops a multi-tender sale
        // from colliding with itself on its own second row. A stale id the
        // guard refused above was re-keyed, so this stamps the fresh one.
        stamp_attempt_split_keys(effective_attempt_id.as_deref(), &mut splits);

        if stock_locations.is_empty() {
            // Same primary-location resolution the legacy
            // complete_sale_deduction wrapper performs internally —
            // routed through with_locations so checkout promotions
            // persist on this branch too.
            let primary = kasirmu_core::location_resolver::resolve_primary_location(
                &db,
                deduction_instance_id,
                None,
            )
            .unwrap_or_else(|_| kasirmu_core::location_resolver::get_default_location_id());
            store.complete_sale_deduction_with_locations_and_estimate(
                &sale,
                Some(deduction_instance_id),
                &[primary],
                &splits,
                &session.user_id,
                Some(&session.terminal_id),
                &checkout_applications,
                args.tax_estimated.unwrap_or(false),
            )?
        } else {
            store.complete_sale_deduction_with_locations_and_estimate(
                &sale,
                Some(deduction_instance_id),
                &stock_locations,
                &splits,
                &session.user_id,
                Some(&session.terminal_id),
                &checkout_applications,
                args.tax_estimated.unwrap_or(false),
            )?
        }
    };

    // Promotion-reduced payable (cart.total() would ignore promotions).
    let total = Some(sale.total);
    tracing::info!(%sale_id, ?total, line_count, store_id = %session.store_id, "sale completed (scoped)");

    // ── Event publishing (no DB lock held) ────────────────────────
    {
        let line_items: Vec<SaleCompletedLine> = sale
            .lines
            .iter()
            .map(|l| SaleCompletedLine {
                sku: l.sku.clone(),
                qty: l.qty,
                unit_price_minor: l.unit_price.minor_units,
                tax_minor: l.tax_amount.minor_units,
                tax_rate_id: l.tax_rate_id.clone(),
            })
            .collect();

        let event = SaleCompleted {
            sale_id: sale_id.clone(),
            store_id: Some(session.store_id.clone()),
            line_items,
            total_minor: total.map(|m| m.minor_units).unwrap_or(0),
            currency: String::from_utf8_lossy(&sale.currency.0).into_owned(),
            customer_id: args.customer_id.clone(),
        };

        ctx.publish_event(&event).await;
    }

    Ok(CompleteSaleResult {
        sale_id,
        total,
        line_count,
    })
}

#[cfg(test)]
#[path = "pos_tests.rs"]
mod tests;
