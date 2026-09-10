/*
last audited 25-07-26 by RSA-Agent (desktop-client slice C: pos head+sweep)
crate: desktop-client | status: SAFE | lint: CLEAN
findings: head 1-160 read + global sweep — all six Percentage::new unwraps preceded by explicit 0..=100 range checks with SAFETY comments (contains LUA-2 at consumer); ADR-20 PaymentKind marker; authz decorators present; cart/sale state machine lives in oz_core (audited). Coverage note: risk-ranked sampling, not full deep read
next: none | perf: N/A
*/
//! Point-of-Sale pipeline commands: start a cart, add a line,
//! complete the sale, hold/resume carts.
//!
//! These commands are the IPC surface for the POS screen. The actual
//! cart/sale state machine lives in `oz_core`; this file translates
//! between the Tauri argument structs and the domain types.
//!
//! Carts are persisted in the SQLite `active_carts` table so they
//! survive application restarts.

use serde::{Deserialize, Serialize};
#[allow(unused_imports)] // sibling pos_tests.rs depends on it
use serde_json::Value;
use tauri::State;

use foundation::Percentage;
use oz_core::db::Store;
use oz_core::events::{SaleCompleted, SaleCompletedLine};
#[allow(unused_imports)] // sibling pos_tests.rs depends on these types
use oz_core::{Cart, CartId, CartLine, Currency, LineId, Money, PaymentSplitArg, Sku};

use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;

// Wave D / D1a: the cart, held-bill and open-bill bodies moved to
// oz_bridge::pos. The DTOs and the pure helpers still named here are
// re-exported so the sibling pos_tests.rs (which opens use super::*;) and the
// checkout bodies below keep resolving them from this module unchanged.
pub use oz_bridge::pos::{
    AddLineArgs, AddLineResult, DeductionLocationInfo, HoldCartArgs, HoldCartResult,
    OverrideLinePriceArgs, OverrideLinePriceScopedArgs, SetCartDiscountArgs,
    SetCartDiscountScopedArgs, StartSaleArgs, StartSaleResult, default_bill_type,
    resolve_runtime_stock_target, resolve_runtime_stock_targets, runtime_stock_target_instances,
    tax_scope_now,
};

/// Resolve the unit price for an add_line request (FRONTEND-03) with the
/// shell's error type - the body lives in oz_bridge::pos::line_unit_price.
#[allow(dead_code)] // sibling pos_tests.rs calls the shell-shaped helper
fn line_unit_price(args: &AddLineArgs, cart_currency: Currency) -> Result<Money, AppError> {
    oz_bridge::pos::line_unit_price(args, cart_currency).map_err(Into::into)
}

/// The cart/line mutation behind override_line_price_scoped, shell error type -
/// the body lives in oz_bridge::pos::run_override_line_price_unchecked.
#[allow(dead_code)] // kept for the shell-shaped helper contract
fn run_override_line_price_unchecked(
    db: &rusqlite::Connection,
    cart_id: &CartId,
    line_id: &LineId,
    new_price_minor: i64,
) -> Result<(), AppError> {
    oz_bridge::pos::run_override_line_price_unchecked(db, cart_id, line_id, new_price_minor)
        .map_err(Into::into)
}

#[tauri::command]
pub async fn set_cart_discount_scoped(
    session_token: String,
    args: SetCartDiscountScopedArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::pos::set_cart_discount_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn start_sale_scoped(
    session_token: String,
    args: StartSaleArgs,
    state: State<'_, AppState>,
) -> Result<StartSaleResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::pos::start_sale_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn add_line_scoped(
    session_token: String,
    args: AddLineArgs,
    state: State<'_, AppState>,
) -> Result<AddLineResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::pos::add_line_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn override_line_price_scoped(
    session_token: String,
    args: OverrideLinePriceScopedArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::pos::override_line_price_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn override_cart_deduction_location_scoped(
    session_token: String,
    cart_id: CartId,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::pos::override_cart_deduction_location_scoped(&ctx, &session_token, cart_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn compute_cart_tax_scoped(
    session_token: String,
    lines: Vec<oz_core::db::CartLineTaxInput>,
    currency: String,
    state: State<'_, AppState>,
) -> Result<oz_core::db::CartTaxResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::pos::compute_cart_tax_scoped(&ctx, &session_token, lines, currency)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn hold_cart_scoped(
    session_token: String,
    args: HoldCartArgs,
    state: State<'_, AppState>,
) -> Result<HoldCartResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::pos::hold_cart_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn list_held_carts_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<oz_core::db::HeldCartRow>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::pos::list_held_carts_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn list_open_bills_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<oz_core::db::HeldCartRow>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::pos::list_open_bills_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn get_held_cart_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<oz_core::db::HeldCartFull>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::pos::get_held_cart_scoped(&ctx, &session_token, id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn delete_held_cart_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::pos::delete_held_cart_scoped(&ctx, &session_token, id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn get_cart_deduction_location_scoped(
    cart_id: CartId,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<DeductionLocationInfo>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::pos::get_cart_deduction_location_scoped(&ctx, cart_id, &session_token)
        .await
        .map_err(Into::into)
}

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
#[serde(rename_all = "camelCase")]
/// Completesalescopedargs.
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
fn stamp_attempt_split_keys(attempt_id: Option<&str>, splits: &mut [PaymentSplitArg]) {
    if let Some(attempt) = attempt_id {
        for (i, split) in splits.iter_mut().enumerate() {
            split.idempotency_key = Some(format!("{attempt}:{i}"));
        }
    }
}

/// Return the receipt an already-completed attempt produced, if there is one.
///
/// The caller cannot supply the sale id — the response that carried it is the
/// very thing that was lost — so the attempt key is the only handle back to the
/// original sale. Resolving it here, before any write, is what makes a replay
/// return a receipt instead of an error:
///
/// - `complete_sale_scoped` removes the cart as its first step, so a retry
///   would otherwise fail with "cart not found" while the sale sits completed.
/// - the shortfall command rebuilds its lines from the request body and carries
///   a synthetic `resolved-<timestamp>` cart id, so it has no cart dependency
///   at all and would otherwise sell the same basket a second time.
///
/// Only the first split's key is consulted: every key of one attempt maps to
/// the same sale.
fn replayed_receipt(
    store: &Store,
    attempt_id: Option<&str>,
) -> Result<Option<CompleteSaleResult>, AppError> {
    let Some(attempt) = attempt_id else {
        return Ok(None);
    };
    let Some(sale_id) = store.find_sale_by_idempotency_key(&format!("{attempt}:0"))? else {
        return Ok(None);
    };
    let sale = store
        .get_sale(&sale_id)?
        .ok_or_else(|| AppError::Internal("replayed payment points at a missing sale".into()))?;
    Ok(Some(CompleteSaleResult {
        sale_id: sale.id.clone(),
        total: Some(sale.total),
        line_count: sale.lines.len(),
    }))
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
}

/// Resolve the unit price for a reconstructed shortfall line
/// (FRONTEND-03 follow-up). Mirrors [`line_unit_price`]: the line's own
/// currency crosses the IPC boundary so a mismatch is rejected instead of
/// silently re-stamped to the sale currency.
fn shortfall_line_unit_price(
    line_data: &CartLineData,
    sale_currency: Currency,
) -> Result<Money, AppError> {
    let currency = match line_data.unit_price_currency.as_deref() {
        Some(s) => s
            .parse::<Currency>()
            .map_err(|_| AppError::Invalid(format!("invalid unit price currency: {s}")))?,
        None => sale_currency,
    };
    Ok(Money {
        minor_units: line_data.unit_price_minor,
        currency,
    })
}

/// Arguments for completing a sale with resolved shortfalls (split fulfillment).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
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
    pub resolutions: Vec<oz_core::sale_deduction::ResolvedShortfall>,
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
    state: &State<'_, AppState>,
    cart: &oz_core::Cart,
) -> Result<Vec<(String, i64, bool)>, AppError> {
    let mut overrides: Vec<(String, i64, bool)> = Vec::new();
    let plugins = state.plugins.lock().await;
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
                .map_err(|e| AppError::Internal(e.to_string()))?
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
#[tauri::command]
pub async fn preview_promoted_total_scoped(
    session_token: String,
    args: PreviewPromotedTotalArgs,
    state: State<'_, AppState>,
) -> Result<PreviewPromotedTotalResult, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, oz_core::permissions::SALES_PROCESS).await?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;

    // ── Lock 1: peek the cart (do NOT delete it) ──────────────────
    let cart = {
        let db = conn
            .lock()
            .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
        let store = Store::new(&db);
        store
            .load_active_cart(&args.cart_id)?
            .ok_or_else(|| AppError::Invalid(format!("cart not found: {}", args.cart_id)))?
    };

    let mut sale = oz_core::Sale::from_cart(&cart)
        .ok_or_else(|| AppError::Invalid("cart total overflowed i64".into()))?;

    // ── Plugin tax overrides (no DB lock held) ────────────────────
    let lua_overrides = lua_calc_line_overrides(&state, &cart).await?;

    // ── Lock 2: tax + engine discounts (no writes) ────────────────
    let (base_total_minor, discounts) = {
        let db = conn
            .lock()
            .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
        let store = Store::new(&db);
        store.compute_sale_tax_for_location(
            &mut sale,
            &lua_overrides,
            oz_core::Settings::get_tax_rounding_mode(&db)?,
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

/// Build an in-memory cart mirroring the client's displayed cart for the
/// lines-based promotion preview (no persistence, no cart id needed).
fn build_preview_cart(
    lines: &[PreviewLineArgs],
    discount_percent: i64,
) -> Result<oz_core::Cart, AppError> {
    let first = lines
        .first()
        .ok_or_else(|| AppError::Invalid("cannot preview an empty cart".into()))?;
    let parse_currency = |code: &str| -> Result<oz_core::Currency, AppError> {
        code.parse()
            .map_err(|_| AppError::Invalid(format!("invalid currency code: {code}")))
    };
    let mut cart = oz_core::Cart::new(parse_currency(&first.unit_price_currency)?);
    for l in lines {
        cart.add_line(oz_core::CartLine::new(
            oz_core::Sku::new(l.sku.clone()),
            l.qty,
            oz_core::Money {
                minor_units: l.unit_price_minor,
                currency: parse_currency(&l.unit_price_currency)?,
            },
        ))
        .map_err(|e| AppError::Invalid(format!("cart line rejected: {e}")))?;
    }
    if discount_percent > 0
        && let Some(pct) = foundation::Percentage::new(discount_percent.min(100) as u8)
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
#[tauri::command]
pub async fn preview_promoted_total_from_lines_scoped(
    session_token: String,
    args: PreviewPromotedTotalFromLinesArgs,
    state: State<'_, AppState>,
) -> Result<PreviewPromotedTotalResult, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, oz_core::permissions::SALES_PROCESS).await?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;

    let cart = build_preview_cart(&args.lines, args.discount_percent)?;
    let mut sale = oz_core::Sale::from_cart(&cart)
        .ok_or_else(|| AppError::Invalid("cart total overflowed i64".into()))?;

    // ── Plugin tax overrides (no DB lock held) ────────────────────
    let lua_overrides = lua_calc_line_overrides(&state, &cart).await?;

    // ── Lock: tax + engine discounts (no writes) ──────────────────
    let (base_total_minor, discounts) = {
        let db = conn
            .lock()
            .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
        let store = Store::new(&db);
        store.compute_sale_tax_for_location(
            &mut sale,
            &lua_overrides,
            oz_core::Settings::get_tax_rounding_mode(&db)?,
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
#[tauri::command]
pub async fn complete_sale_with_resolved_shortfalls_scoped(
    session_token: String,
    args: CompleteSaleWithResolvedShortfallsArgs,
    state: State<'_, AppState>,
) -> Result<CompleteSaleResult, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, oz_core::permissions::SALES_PROCESS).await?;
    let stock_target_instance_id = {
        let global_db = state.db.lock().await;
        // §B: when the offline grace window has fully lapsed, the register
        // is read-only — new sales are rejected until the subscription is
        // verified online. Active/in-grace registers pass untouched.
        let sub = oz_core::TenantSubscription::load(&global_db, "default")?
            .ok_or_else(|| AppError::Internal("default tenant subscription not found".into()))?;
        sub.verify_signature()?;
        sub.enforce_pos_writable()?;
        resolve_runtime_stock_target(&global_db, &session.store_id, &session.instance_id)?
    };
    let deduction_instance_id = stock_target_instance_id
        .as_deref()
        .unwrap_or(&session.instance_id);
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;

    // ── COR-7 replay guard ─────────────────────────────────────────
    // This is the path the guard really matters on: the command rebuilds its
    // cart from the request body and invents a `resolved-<timestamp>` cart id,
    // so unlike complete_sale_scoped it has no cart to run out of and would
    // otherwise re-sell the same basket on every retry.
    {
        let db = conn
            .lock()
            .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
        if let Some(replay) = replayed_receipt(&Store::new(&db), args.attempt_id.as_deref())? {
            tracing::info!(
                sale_id = %replay.sale_id,
                "shortfall retry replayed an existing attempt — returning the original receipt"
            );
            return Ok(replay);
        }
    }

    // ── Reconstruct the Cart from front-end line data ─────────────
    let currency: oz_core::Currency = args
        .currency
        .parse()
        .map_err(|_| AppError::Invalid(format!("invalid currency code: {}", args.currency)))?;

    let mut cart = oz_core::Cart::new(currency);
    for line_data in &args.lines {
        let unit_price = shortfall_line_unit_price(line_data, cart.currency())?;
        let line =
            oz_core::CartLine::new(oz_core::Sku::new(&line_data.sku), line_data.qty, unit_price);
        cart.add_line(line)
            .map_err(|e| AppError::Invalid(e.to_string()))?;
    }

    // Apply discount if configured
    if args.discount_percent > 0
        && let Some(pct) = foundation::Percentage::new(args.discount_percent as u8)
    {
        cart.set_discount(pct, args.discount_label.clone());
    }

    let line_count = cart.line_count();

    let mut sale = oz_core::Sale::from_cart_with_user(&cart, Some(session.user_id.clone()))
        .ok_or_else(|| AppError::Invalid("cart total overflowed i64".into()))?;
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
            .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
        let store = Store::new(&db);
        if let Some(target_instance_id) = stock_target_instance_id.as_deref() {
            oz_core::location_resolver::resolve_primary_location(&db, target_instance_id, None)?;
        }

        // Compute tax (same as first command)
        store.compute_sale_tax_for_location(
            &mut sale,
            &[],
            oz_core::Settings::get_tax_rounding_mode(&db)?,
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
        // from colliding with itself on its own second row.
        stamp_attempt_split_keys(args.attempt_id.as_deref(), &mut splits);

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
        let kernel = state.kernel.lock().await;
        let bus = kernel.event_bus();
        let line_items: Vec<oz_core::events::SaleCompletedLine> = sale
            .lines
            .iter()
            .map(|l| oz_core::events::SaleCompletedLine {
                sku: l.sku.clone(),
                qty: l.qty,
                unit_price_minor: l.unit_price.minor_units,
                tax_minor: l.tax_amount.minor_units,
                tax_rate_id: l.tax_rate_id.clone(),
            })
            .collect();

        if let Err(e) = bus.publish(&oz_core::events::SaleCompleted {
            sale_id: sale_id.clone(),
            store_id: Some(session.store_id.clone()),
            line_items,
            total_minor: sale.total.minor_units,
            currency: String::from_utf8_lossy(&sale.currency.0).into_owned(),
            customer_id: args.customer_id.clone(),
        }) {
            tracing::warn!(%sale_id, error = %e, "event bus publish failed");
        }
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
#[tauri::command]
pub async fn complete_sale_scoped(
    session_token: String,
    args: CompleteSaleScopedArgs,
    state: State<'_, AppState>,
) -> Result<CompleteSaleResult, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, oz_core::permissions::SALES_PROCESS).await?;
    let stock_target_instance_ids = {
        let global_db = state.db.lock().await;
        // §B read-only lock (see complete_sale_with_resolved_shortfalls_scoped).
        let sub = oz_core::TenantSubscription::load(&global_db, "default")?
            .ok_or_else(|| AppError::Internal("default tenant subscription not found".into()))?;
        sub.verify_signature()?;
        sub.enforce_pos_writable()?;
        resolve_runtime_stock_targets(&global_db, &session.store_id, &session.instance_id)?
    };
    let deduction_instance_id = stock_target_instance_ids
        .first()
        .map(String::as_str)
        .unwrap_or(&session.instance_id);
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    if !stock_target_instance_ids.is_empty() {
        let db = conn
            .lock()
            .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
        for target_instance_id in &stock_target_instance_ids {
            oz_core::location_resolver::resolve_primary_location(&db, target_instance_id, None)?;
        }
    }

    // ── COR-7 replay guard ─────────────────────────────────────────
    // Resolved before the cart is touched: the first attempt already removed
    // it, so a retry that fell through to Lock 1 would fail with "cart not
    // found" on a sale that actually completed.
    {
        let db = conn
            .lock()
            .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
        if let Some(replay) = replayed_receipt(&Store::new(&db), args.attempt_id.as_deref())? {
            tracing::info!(
                sale_id = %replay.sale_id,
                "checkout attempt replayed — returning the original receipt"
            );
            return Ok(replay);
        }
    }

    // ── Lock 1: Load and remove the cart ──────────────────────────
    let mut cart = {
        let db = conn
            .lock()
            .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
        let store = Store::new(&db);

        let cart = store
            .load_active_cart(&args.cart_id)?
            .ok_or_else(|| AppError::Invalid(format!("cart not found: {}", args.cart_id)))?;
        store.delete_active_cart(&args.cart_id)?;
        cart // db lock dropped here
    };

    let line_count = cart.line_count();

    // ── Plugin business-rule hooks (no DB lock held) ──────────────
    {
        let plugins = state.plugins.lock().await;
        if let Some(ref plugins) = *plugins {
            let lines: Vec<oz_lua::CartLineData> = cart
                .lines()
                .iter()
                .map(|cl| oz_lua::CartLineData {
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
                .map_err(|e| AppError::Internal(e.to_string()))?;
            if !errors.is_empty() {
                return Err(AppError::Invalid(format!(
                    "order validation failed: {}",
                    errors.join("; ")
                )));
            }

            if let Some(discount) = plugins
                .apply_discount(&lines)
                .map_err(|e| AppError::Internal(e.to_string()))?
            {
                let label = discount.label.clone().unwrap_or_else(|| "Lua Rule".into());
                if !(0..=100).contains(&discount.percent) {
                    return Err(AppError::Invalid(format!(
                        "Lua returned invalid discount percent: {}",
                        discount.percent
                    )));
                }
                // SAFETY: discount.percent is validated 0..=100 above.
                let lua_pct = Percentage::new(discount.percent as u8).unwrap();
                cart.set_discount(lua_pct, Some(label));
            }

            let currency = String::from_utf8_lossy(&cart.currency().0).into_owned();
            let total_minor = cart.total().map(|m| m.minor_units).unwrap_or(0);
            plugins
                .fire_sale_before_complete(&lines, total_minor, &currency, &session.user_id)
                .map_err(|e| AppError::Internal(e.to_string()))?;

            if let Some(pd) = plugins.drain_pending_discounts().into_iter().next() {
                if !(0..=100).contains(&pd.percent) {
                    return Err(AppError::Invalid(format!(
                        "Plugin returned invalid discount percent: {}",
                        pd.percent
                    )));
                }
                // SAFETY: pd.percent is validated 0..=100 above.
                let pct = Percentage::new(pd.percent as u8).unwrap();
                cart.set_discount(pct, Some(pd.target));
            }
        }
    }

    let mut sale = oz_core::Sale::from_cart_with_user(&cart, Some(session.user_id.clone()))
        .ok_or_else(|| AppError::Invalid("cart total overflowed i64".into()))?;
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
    let lua_overrides = lua_calc_line_overrides(&state, &cart).await?;

    let sale_id = sale.id.clone();

    // ── Lock 2: Compute tax and create sale ───────────────────────
    let _res = {
        let db = conn
            .lock()
            .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
        let store = Store::new(&db);
        let mut stock_locations = Vec::with_capacity(stock_target_instance_ids.len());
        for target_instance_id in &stock_target_instance_ids {
            let location = oz_core::location_resolver::resolve_primary_location(
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
            oz_core::Settings::get_tax_rounding_mode(&db)?,
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
        // from colliding with itself on its own second row.
        stamp_attempt_split_keys(args.attempt_id.as_deref(), &mut splits);

        if stock_locations.is_empty() {
            // Same primary-location resolution the legacy
            // complete_sale_deduction wrapper performs internally —
            // routed through with_locations so checkout promotions
            // persist on this branch too.
            let primary = oz_core::location_resolver::resolve_primary_location(
                &db,
                deduction_instance_id,
                None,
            )
            .unwrap_or_else(|_| oz_core::location_resolver::get_default_location_id());
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

        let kernel = state.kernel.lock().await;
        let bus = kernel.event_bus();
        if let Err(e) = bus.publish(&event) {
            tracing::warn!(%sale_id, error = %e, "event bus publish failed");
        }
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
