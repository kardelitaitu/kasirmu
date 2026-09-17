//! Promotion discount engine — pure, fail-closed discount computation.
//!
//! Single source of truth for how a [`Promotion`] maps to a discount
//! amount against a [`Sale`]; both IPC shells (desktop and tablet) call
//! this instead of keeping their own copies of the math.
//!
//! Key items:
//! - [`compute_discount`] — full gate pipeline (active flag, time window,
//!   minimum order) followed by the type-specific math
//! - [`compute_discount_unscoped`] — convenience wrapper for promotions
//!   without a category scope
//!
//! Invariants (money discipline):
//! - every multiply is `checked_*` — overflow is a `CoreError`, never a
//!   wrapped value (PROMO-2)
//! - the returned discount is always `0 <= discount <= sale.total`
//!   (PROMO-1: a percentage promotion can never discount more than the
//!   payable total, even with a misconfigured `value_minor`)
//! - percentage truncation rounds down (customer-favorable), matching
//!   the cart-discount convention in `foundation/src/cart.rs`
//! - `category_id` scoping is enforced: when set, only lines whose
//!   product resolves to that category contribute to the base (PROMO-6)
//! - a Buy-X-Get-Y promotion that is not satisfied yields `Ok(0)` (no
//!   discount), while a *misconfigured* one (empty trigger, non-positive
//!   quantities) is a validation error

use crate::error::CoreError;
use crate::promotion::{Promotion, PromotionType};
use crate::sale::Sale;
use chrono::{DateTime, Utc};

/// Compute the discount (minor units, `0 <= d <= sale.total`) that
/// `promo` yields against `sale` at instant `now`.
///
/// `category_of` resolves a SKU to its product category id (`None` when
/// the product is unknown or uncategorized). It is only consulted when
/// the promotion carries a `category_id` scope.
///
/// Errors (`CoreError::Validation`) cover: unknown `promo_type`,
/// inactive promotion, time window violations, minimum-order shortfall,
/// negative `value_minor`, misconfigured Buy-X-Get-Y fields, and
/// arithmetic overflow.
pub fn compute_discount(
    promo: &Promotion,
    sale: &Sale,
    now: DateTime<Utc>,
    category_of: impl Fn(&str) -> Option<String>,
) -> Result<i64, CoreError> {
    let promo_type =
        PromotionType::from_str(promo.promo_type.trim()).ok_or_else(|| CoreError::Validation {
            field: "promo_type",
            message: format!("unknown promotion type: {}", promo.promo_type),
        })?;

    if !promo.active {
        return Err(CoreError::Validation {
            field: "active",
            message: "promotion is not active".into(),
        });
    }

    if let Some(ref starts_at) = promo.starts_at {
        let start = DateTime::parse_from_rfc3339(starts_at).map_err(|e| CoreError::Validation {
            field: "starts_at",
            message: format!("invalid starts_at: {e}"),
        })?;
        if now < start {
            return Err(CoreError::Validation {
                field: "starts_at",
                message: "promotion has not started yet".into(),
            });
        }
    }
    if let Some(ref ends_at) = promo.ends_at {
        let end = DateTime::parse_from_rfc3339(ends_at).map_err(|e| CoreError::Validation {
            field: "ends_at",
            message: format!("invalid ends_at: {e}"),
        })?;
        if now > end {
            return Err(CoreError::Validation {
                field: "ends_at",
                message: "promotion has expired".into(),
            });
        }
    }

    if sale.total.minor_units < promo.min_order_minor {
        return Err(CoreError::Validation {
            field: "min_order_minor",
            message: format!(
                "sale total {} is below minimum order {}",
                sale.total.minor_units, promo.min_order_minor
            ),
        });
    }

    if promo.value_minor < 0 {
        return Err(CoreError::Validation {
            field: "value_minor",
            message: "value_minor must not be negative".into(),
        });
    }

    // The scoped base: sum of line totals for lines inside the promoted
    // category, or the full payable total when the promotion is not
    // category-scoped. A scoped promotion whose category matches no line
    // yields a base of 0 — the promotion then applies nothing.
    let scope_id = promo.category_id.as_deref();
    let base = match scope_id {
        Some(scope_id) => {
            let mut base = 0_i64;
            for line in &sale.lines {
                let in_scope = category_of(&line.sku)
                    .map(|c| c == scope_id)
                    .unwrap_or(false);
                if !in_scope {
                    continue;
                }
                base = base
                    .checked_add(line.line_total.minor_units)
                    .ok_or_else(|| overflow("line_total"))?;
            }
            base
        }
        // Unscoped promotions use the payable total (same as the
        // pre-engine behavior), which includes cart-level discounts.
        None => sale.total.minor_units,
    };

    let discount = match promo_type {
        PromotionType::Percentage => {
            // Truncating division rounds down — customer-favorable.
            let raw = base
                .checked_mul(promo.value_minor)
                .ok_or_else(|| overflow("value_minor"))?
                / 100;
            raw.min(base)
        }
        PromotionType::FixedAmount => promo.value_minor.min(base),
        PromotionType::BuyXGetY => {
            let trigger_sku = promo.trigger_sku.as_deref().unwrap_or_default();
            if trigger_sku.is_empty() {
                return Err(CoreError::Validation {
                    field: "trigger_sku",
                    message: "buy_x_get_y promotion requires trigger_sku".into(),
                });
            }
            let min_qty = promo.min_qty.unwrap_or(1);
            let reward_qty = promo.reward_qty.unwrap_or(1);
            if min_qty < 1 {
                return Err(CoreError::Validation {
                    field: "min_qty",
                    message: "buy_x_get_y min_qty must be at least 1".into(),
                });
            }
            if reward_qty < 1 {
                return Err(CoreError::Validation {
                    field: "reward_qty",
                    message: "buy_x_get_y reward_qty must be at least 1".into(),
                });
            }

            let reward_sku = promo.reward_sku.as_deref().unwrap_or(trigger_sku);
            let mut trigger_qty = 0_i64;
            let mut cheapest: Option<i64> = None;
            let mut reward_qty_in_cart = 0_i64;
            for line in &sale.lines {
                let in_scope = match scope_id {
                    Some(scope_id) => category_of(&line.sku)
                        .map(|c| c == scope_id)
                        .unwrap_or(false),
                    None => true,
                };
                if !in_scope {
                    continue;
                }
                if line.sku == trigger_sku {
                    trigger_qty += line.qty;
                }
                if line.sku == reward_sku {
                    reward_qty_in_cart += line.qty;
                    let price = line.unit_price.minor_units;
                    cheapest = Some(match cheapest {
                        Some(c) if c <= price => c,
                        _ => price,
                    });
                }
            }

            match cheapest {
                Some(cheapest) if trigger_qty >= min_qty => {
                    let applicable = reward_qty.min(reward_qty_in_cart);
                    let per_item = cheapest
                        .checked_mul(applicable)
                        .ok_or_else(|| overflow("reward_qty"))?;
                    let raw = per_item
                        .checked_mul(promo.value_minor)
                        .ok_or_else(|| overflow("value_minor"))?
                        / 100;
                    // Never discount more than the reward merchandise.
                    raw.min(per_item).max(0)
                }
                _ => 0,
            }
        }
    };

    // Final clamps: never negative, never more than the payable total.
    Ok(discount.clamp(0, sale.total.minor_units))
}

/// [`compute_discount`] for promotions without a category scope.
pub fn compute_discount_unscoped(
    promo: &Promotion,
    sale: &Sale,
    now: DateTime<Utc>,
) -> Result<i64, CoreError> {
    compute_discount(promo, sale, now, |_| None)
}

fn overflow(field: &'static str) -> CoreError {
    CoreError::Validation {
        field,
        message: "discount computation overflow".into(),
    }
}

#[cfg(test)]
#[path = "promotion_engine_tests.rs"]
mod tests;
