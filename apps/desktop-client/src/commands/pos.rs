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

#[allow(unused_imports)] // sibling pos_tests.rs depends on it
use serde_json::Value;
use tauri::State;

#[allow(unused_imports)] // sibling pos_tests.rs depends on it
use oz_core::db::Store;
#[allow(unused_imports)] // sibling pos_tests.rs depends on these types
use oz_core::{Cart, CartId, CartLine, Currency, LineId, Money, PaymentSplitArg, Sku};

use crate::error::AppError;
use crate::state::AppState;

// Wave D / D1a: the cart, held-bill and open-bill bodies moved to
// kasirmu_bridge::pos. The DTOs and the pure helpers still named here are
// re-exported so the sibling pos_tests.rs (which opens use super::*;) and the
// checkout bodies below keep resolving them from this module unchanged.
pub use kasirmu_bridge::pos::{
    AddLineArgs, AddLineResult, CartLineData, CompleteSaleArgs, CompleteSaleResult,
    CompleteSaleScopedArgs, CompleteSaleWithResolvedShortfallsArgs, DeductionLocationInfo,
    HoldCartArgs, HoldCartResult, OverrideLinePriceArgs, OverrideLinePriceScopedArgs, PaymentKind,
    PreviewLineArgs, PreviewPromotedTotalArgs, PreviewPromotedTotalFromLinesArgs,
    PreviewPromotedTotalResult, PreviewPromotionDiscount, PublishCourseFiredArgs,
    PublishCourseFiredItem, SerialNumberArg, SetCartDiscountArgs, SetCartDiscountScopedArgs,
    SetLineCourseArgs, StartSaleArgs, StartSaleResult, default_bill_type,
    resolve_runtime_stock_target, resolve_runtime_stock_targets, runtime_stock_target_instances,
    shortfall_line_unit_price, stamp_attempt_split_keys, tax_scope_now,
};

/// Resolve the unit price for an add_line request (FRONTEND-03) with the
/// shell's error type - the body lives in kasirmu_bridge::pos::line_unit_price.
#[allow(dead_code)] // sibling pos_tests.rs calls the shell-shaped helper
fn line_unit_price(args: &AddLineArgs, cart_currency: Currency) -> Result<Money, AppError> {
    kasirmu_bridge::pos::line_unit_price(args, cart_currency).map_err(Into::into)
}

/// The cart/line mutation behind override_line_price_scoped, shell error type -
/// the body lives in kasirmu_bridge::pos::run_override_line_price_unchecked.
#[allow(dead_code)] // kept for the shell-shaped helper contract
fn run_override_line_price_unchecked(
    db: &rusqlite::Connection,
    cart_id: &CartId,
    line_id: &LineId,
    new_price_minor: i64,
) -> Result<(), AppError> {
    kasirmu_bridge::pos::run_override_line_price_unchecked(db, cart_id, line_id, new_price_minor)
        .map_err(Into::into)
}

/// Set a cart discount within the store resolved from a session token (ADR #7).
#[tauri::command]
pub async fn set_cart_discount_scoped(
    session_token: String,
    args: SetCartDiscountScopedArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::pos::set_cart_discount_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// Start a new sale in the store resolved from a session token (ADR #7).
/// Resolves and locks the primary deduction location on the cart at start.
#[tauri::command]
pub async fn start_sale_scoped(
    session_token: String,
    args: StartSaleArgs,
    state: State<'_, AppState>,
) -> Result<StartSaleResult, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::pos::start_sale_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// Add a line to an active cart in the store resolved from a session token (ADR #7).
/// Rejects carts without a deduction-location lock (ADR-19 §5.1).
#[tauri::command]
pub async fn add_line_scoped(
    session_token: String,
    args: AddLineArgs,
    state: State<'_, AppState>,
) -> Result<AddLineResult, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::pos::add_line_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// Override a line price within the store resolved from a session token (ADR #7).
#[tauri::command]
pub async fn override_line_price_scoped(
    session_token: String,
    args: OverrideLinePriceScopedArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::pos::override_line_price_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// Assign (or clear) the restaurant course on an active cart line (ADR #7).
/// Dedicated command because the UI assigns course after the line exists.
#[tauri::command]
pub async fn set_line_course_scoped(
    session_token: String,
    args: SetLineCourseArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::pos::set_line_course_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// Publish one fired course for a completed sale (ADR #7).
/// Called at checkout after the KDS fan-out, once per course whose lines the
/// waiter fired. Carries the real sale id and the ticket display number.
#[tauri::command]
pub async fn publish_course_fired_scoped(
    session_token: String,
    args: PublishCourseFiredArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::pos::publish_course_fired_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// Override the deduction location lock on an active cart (ADR-19 §17).
/// Records the manager override timestamp; the locked location itself is unchanged.
#[tauri::command]
pub async fn override_cart_deduction_location_scoped(
    session_token: String,
    cart_id: CartId,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::pos::override_cart_deduction_location_scoped(&ctx, &session_token, cart_id)
        .await
        .map_err(Into::into)
}

/// Compute cart tax for the store resolved from a session token (ADR #7).
#[tauri::command]
pub async fn compute_cart_tax_scoped(
    session_token: String,
    lines: Vec<oz_core::db::CartLineTaxInput>,
    currency: String,
    state: State<'_, AppState>,
) -> Result<oz_core::db::CartTaxResult, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::pos::compute_cart_tax_scoped(&ctx, &session_token, lines, currency)
        .await
        .map_err(Into::into)
}

/// Hold a cart in the store resolved from a session token (ADR #7).
#[tauri::command]
pub async fn hold_cart_scoped(
    session_token: String,
    args: HoldCartArgs,
    state: State<'_, AppState>,
) -> Result<HoldCartResult, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::pos::hold_cart_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// List held carts for the store resolved from a session token (ADR #7).
#[tauri::command]
pub async fn list_held_carts_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<oz_core::db::HeldCartRow>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::pos::list_held_carts_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// List open bills for the store resolved from a session token (ADR #7).
#[tauri::command]
pub async fn list_open_bills_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<oz_core::db::HeldCartRow>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::pos::list_open_bills_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Get a held cart from the store resolved from a session token (ADR #7).
#[tauri::command]
pub async fn get_held_cart_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<oz_core::db::HeldCartFull>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::pos::get_held_cart_scoped(&ctx, &session_token, id)
        .await
        .map_err(Into::into)
}

/// Delete a held cart in the store resolved from a session token (ADR #7).
#[tauri::command]
pub async fn delete_held_cart_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::pos::delete_held_cart_scoped(&ctx, &session_token, id)
        .await
        .map_err(Into::into)
}

/// Read the deduction-location info for a cart in the store resolved from a session token.
#[tauri::command]
pub async fn get_cart_deduction_location_scoped(
    cart_id: CartId,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<DeductionLocationInfo>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::pos::get_cart_deduction_location_scoped(&ctx, cart_id, &session_token)
        .await
        .map_err(Into::into)
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
    let ctx = state.bridge_ctx();
    kasirmu_bridge::pos::preview_promoted_total_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
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
    let ctx = state.bridge_ctx();
    kasirmu_bridge::pos::preview_promoted_total_from_lines_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
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
    let ctx = state.bridge_ctx();
    let result = kasirmu_bridge::pos::complete_sale_with_resolved_shortfalls_scoped(
        &ctx,
        &session_token,
        args,
    )
    .await
    .map_err(Into::into);

    // SYNC-EW: wake the sync daemons so a completed sale reaches the cloud
    // portal within seconds rather than waiting up to 120 s for the next
    // periodic tick. The nudge is fire-and-forget: if the daemon is offline
    // the enqueued item stays in offline_queue and the normal backoff retries.
    if result.is_ok() {
        state.sync_daemon.nudge();
        state.pg_sync_daemon.nudge();
    }

    result
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
    let ctx = state.bridge_ctx();
    let result = kasirmu_bridge::pos::complete_sale_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into);

    // SYNC-EW: wake the sync daemons so a completed sale reaches the cloud
    // portal within seconds rather than waiting up to 120 s for the next
    // periodic tick.
    if result.is_ok() {
        state.sync_daemon.nudge();
        state.pg_sync_daemon.nudge();
    }

    result
}

