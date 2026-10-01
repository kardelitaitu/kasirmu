//! Promotion-preview commands for the POS bridge.
//!
//! These answer "what would this cart cost with these promotions?" without
//! committing anything: they rebuild a preview cart, apply the promotions and
//! return the reduced payable plus a per-promotion breakdown. The checkout half
//! (`complete_sale_*`, in [`super`]) consumes [`checkout_discount_percent`] to
//! turn the previewed percentage into the minor-unit discount it persists, so
//! the two halves agree by construction rather than by duplicated arithmetic.
//!
//! Main entry points: [`preview_promoted_total_scoped`],
//! [`preview_promoted_total_from_lines_scoped`], [`checkout_discount_percent`].

use serde::{Deserialize, Serialize};

use kasirmu_core::CartId;
use kasirmu_core::db::Store;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

use super::checkout::lua_calc_line_overrides;
use super::tax_scope_now;

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
/// engine sequence as
/// [`complete_sale_scoped`](crate::pos::checkout::complete_sale_scoped) —
/// including plugin tax
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
pub(in crate::pos) fn build_preview_cart(
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
