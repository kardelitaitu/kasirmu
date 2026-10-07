//! The checkout half of the POS bridge: complete-sale, its shortfall retry,
//! and the COR-7 replay guard that makes a retried submission return a receipt
//! instead of double-charging.
//!
//! Kept in ONE module deliberately. The replay machinery (`ReplayVerdict`,
//! `replay_verdict`, `rekey_stem`, `count_rekey_settlements`,
//! `shortfall_basket_key`, `validated_attempt_id`) is bidirectionally coupled to
//! the commands that use it - measured at 14 references across the two halves -
//! so splitting them further would spread one invariant over two files.
//!
//! Main entry points: [`complete_sale_scoped`],
//! [`complete_sale_with_resolved_shortfalls_scoped`].
//!
//! Invariant: the replay decision is made BEFORE any write, and an attempt id
//! is validated colon-free, because the key namespace around it is
//! colon-separated.

use serde::{Deserialize, Serialize};

use foundation::Percentage;
use kasirmu_core::db::Store;
use kasirmu_core::events::{SaleCompleted, SaleCompletedLine};
use kasirmu_core::{CartId, Currency, Money, PaymentSplitArg};

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

use super::preview::checkout_discount_percent;
use super::{
    PaymentKind, resolve_runtime_stock_target, resolve_runtime_stock_targets, tax_scope_now,
};

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
    /// Document kind for statutory numbering: "receipt" (default) or "invoice"
    /// for formal B2B Tax Invoicing.
    pub document_kind: Option<String>,
}

#[derive(Debug, Deserialize)]
/// Completesalescopedargs.
///
/// `deny_unknown_fields` is deliberate hardening, ported from the tablet
/// shell's copy (Phase 3.3 T4): the absence of it is what let the shipped
/// UI's `attemptId` vanish silently on the tablet while looking guarded.
/// Every field the wire can carry is listed field-for-field against
/// `ui/src/api/sales.ts::CompleteSaleScopedArgs` (16 fields) and both
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
    /// Document kind for statutory numbering: "receipt" (default) or "invoice"
    /// for formal B2B Tax Invoicing.
    pub document_kind: Option<String>,
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
    /// Receipt Number / display code.
    pub receipt_number: Option<String>,
    /// The statutory document number (e.g. invoice or receipt sequence).
    pub statutory_number: Option<String>,
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

pub(super) mod replay;
use replay::{ReplayVerdict, replay_verdict, shortfall_basket_key, validated_attempt_id};

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
    /// Modifier choices serialized as JSON string array.
    #[serde(default)]
    pub modifiers_json: Option<String>,
    /// Optional customer / kitchen note for this line.
    #[serde(default)]
    pub note: Option<String>,
}

/// Resolve the unit price for a reconstructed shortfall line
/// (FRONTEND-03 follow-up). Mirrors
/// [`line_unit_price`](crate::pos::cart::line_unit_price): the line's own
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
pub(super) async fn lua_calc_line_overrides(
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
        line.set_modifiers(line_data.modifiers_json.clone());
        line.set_note(line_data.note.clone());
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
    let (receipt_number, statutory_number) = {
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
        let deduct = store.complete_sale_with_resolved_shortfalls(
            &sale,
            Some(deduction_instance_id),
            &splits,
            &session.user_id,
            Some(&session.terminal_id),
            &args.resolutions,
            &checkout_applications,
        )?;
        (Some(deduct.receipt_number), deduct.statutory_number)
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
        receipt_number,
        statutory_number,
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
    let (receipt_number, statutory_number) = {
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

        let deduct = if stock_locations.is_empty() {
            // Same primary-location resolution the legacy
            // complete_sale_deduction wrapper performs internally —
            // routed through with_locations so checkout promotions
            // persist on this branch too.
            //
            // PROPAGATES, like every other site in this family. A swallowed failure
            // here made the sale deduct stock from the canonical default location
            // while reporting success — the same defect as the core and tablet
            // callers, on the bridge's explicit-stock-locations branch. A workspace
            // with genuinely no binding still gets tier 4 from the resolver; only a
            // READ FAILURE reaches this `?`.
            let primary = kasirmu_core::location_resolver::resolve_primary_location(
                &db,
                deduction_instance_id,
                None,
            )?;
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
        };
        let mut statutory_number = deduct.statutory_number;
        let receipt_number = Some(deduct.receipt_number);

        if args.document_kind.as_deref() == Some("invoice") {
            let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
            let primary = kasirmu_core::location_resolver::resolve_primary_location(
                &db,
                deduction_instance_id,
                None,
            )?;
            if let Ok(inv_num) = store.issue_tax_invoice_for_sale(&sale_id, primary.as_str(), &now)
            {
                statutory_number = Some(inv_num);
            }
        }
        (receipt_number, statutory_number)
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
        receipt_number,
        statutory_number,
    })
}
