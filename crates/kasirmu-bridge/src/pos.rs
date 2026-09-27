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

// The moved halves each own their imports (`pos/cart.rs`, `pos/preview.rs`,
// `pos/checkout.rs`). What remains here is what the prologue helpers
// (`tax_scope_now`, the topology resolvers), `PaymentKind`, and the sibling test
// module still name directly — so a warning here means a leftover rather than a
// missing dependency.
use serde_json::Value;

use kasirmu_core::db::Store;
// `Currency`, `Money`, `LineId` and `Sku` are named only by `pos_tests.rs`
// through `use super::*` — every function that used them moved to a submodule
// that imports them directly. Gated to the test build so the library build
// stays warning-free.
#[cfg(test)]
use crate::ctx::BridgeCtx;
#[cfg(test)]
use kasirmu_core::{CartId, Currency, LineId, Money, PaymentSplitArg, Sku};

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

mod checkout;
pub use checkout::{
    CartLineData, CompleteSaleArgs, CompleteSaleResult, CompleteSaleScopedArgs,
    CompleteSaleWithResolvedShortfallsArgs, SerialNumberArg, complete_sale_scoped,
    complete_sale_with_resolved_shortfalls_scoped, shortfall_line_unit_price,
    stamp_attempt_split_keys,
};
// The replay guard is private to `pos::checkout::replay`, but `pos_tests.rs`
// reaches it through `use super::*` to pin the re-key and validation rules
// directly. Gated to the test build so the library keeps them internal.
#[cfg(test)]
use checkout::replay::{rekey_stem, validated_attempt_id};

mod preview;
pub use preview::{
    PreviewLineArgs, PreviewPromotedTotalArgs, PreviewPromotedTotalFromLinesArgs,
    PreviewPromotedTotalResult, PreviewPromotionDiscount, checkout_discount_percent,
    preview_promoted_total_from_lines_scoped, preview_promoted_total_scoped,
};
// `lua_calc_line_overrides` is called by the checkout code, which lives in
// `pos/checkout.rs` and imports it from there; `build_preview_cart` is reached
// only by `pos_tests.rs` through `use super::*`, so it is gated to test builds.
#[cfg(test)]
use preview::build_preview_cart;

#[cfg(test)]
#[path = "pos_tests.rs"]
mod tests;
