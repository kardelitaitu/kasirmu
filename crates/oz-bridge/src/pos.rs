//! POS cart and held-bill bridge module (Wave D / D1a) - the tauri-free half of
//! apps/desktop-client/src/commands/pos.rs.
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
use oz_core::db::Store;
use oz_core::{Cart, CartId, CartLine, Currency, LineId, Money, Sku};

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
/// `as_of` is the UTC calendar date, and that is a recorded compromise rather
/// than the answer: `locations.timezone` is written as an IANA name but read as
/// a fixed offset (todo-global-saas-2.md §Regional configuration, open question
/// 1), so a locally-correct business date is not available yet. UTC is what
/// `sale.created_at` already records, which keeps the cart preview and the
/// checkout receipt resolving on the SAME date instead of straddling a rate
/// boundary differently — the failure mode that matters, because
/// `effective_to` is exclusive and a boundary day must have exactly one answer.
pub fn tax_scope_now(store: &Store, location_id: &str) -> oz_core::TaxSaleScope {
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
    oz_core::TaxSaleScope {
        location_id: location_id.to_string(),
        as_of: oz_core::timezone::business_date_in_zone(chrono::Utc::now(), &timezone),
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
    let Some(json) = oz_core::Settings::get(conn, &key)? else {
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Setcartdiscountargs.
pub struct SetCartDiscountArgs {
    /// ID of the associated cart.
    pub cart_id: CartId,
    /// Discount percentage (0-100). Pass 0 to clear.
    pub percent: i64,
    /// Optional human-readable label (e.g. "Senior 10%").
    pub label: Option<String>,
    /// ID of the user setting the discount (for authz).
    pub user_id: String,
}

/// Args for `set_cart_discount_scoped` — without `user_id`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetCartDiscountScopedArgs {
    /// ID of the associated cart.
    pub cart_id: CartId,
    /// Percent.
    pub percent: i64,
    /// Label.
    pub label: Option<String>,
}

/// Set a cart discount within the store resolved from a session token.
///
/// ADR #7: Scoped variant of `set_cart_discount`. The `user_id` for
/// permission checks is read from the resolved `SessionContext`.
pub async fn set_cart_discount_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: SetCartDiscountScopedArgs,
) -> Result<(), BridgeError> {
    if !(0..=100).contains(&args.percent) {
        return Err(BridgeError::Invalid(format!(
            "discount percent must be between 0 and 100, got {}",
            args.percent
        )));
    }
    // SAFETY: args.percent is validated 0..=100 above, so the unwrap is safe.
    let percent = Percentage::new(args.percent as u8).unwrap();

    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, oz_core::permissions::SALES_DISCOUNT)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;

    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let mut cart = store
        .load_active_cart(&args.cart_id)?
        .ok_or_else(|| BridgeError::Invalid(format!("cart not found: {}", args.cart_id)))?;
    cart.set_discount(percent, args.label);
    store.save_active_cart(&cart, None)?;
    drop(db);
    tracing::info!(cart_id = %args.cart_id, percent = %args.percent, "cart discount set (scoped)");
    Ok(())
}

// ── Start Sale ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Startsaleargs.
pub struct StartSaleArgs {
    /// ISO-4217 currency code for the new cart.
    #[serde(default)]
    pub currency: String,
}

#[derive(Debug, Serialize)]
/// Startsaleresult.
pub struct StartSaleResult {
    /// ID of the associated cart.
    pub cart_id: CartId,
    /// ADR-19 §5.1: the deduction location locked at cart-start time.
    pub deduction_location_id: Option<String>,
}

/// Start a new sale in the store resolved from a session token. ADR #7.
///
/// ADR-19 §5.1: resolves the primary deduction location from the workspace
/// instance and locks it on the `active_carts` row at cart-start time.
///
/// Requires `SALES_PROCESS` permission from the resolved session (Bug #5).
pub async fn start_sale_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: StartSaleArgs,
) -> Result<StartSaleResult, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, oz_core::permissions::SALES_PROCESS)
        .await?;
    let conn = ctx.resolve_store(session_token)?;
    let stock_target_instance_id = {
        let global_db = ctx.lock_global().await;
        resolve_runtime_stock_target(&global_db, &session.store_id, &session.instance_id)?
    };
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let currency: oz_core::Currency = if args.currency.is_empty() {
        // M-6: lookup the store profile's default currency instead of hardcoding "USD".
        let code =
            oz_core::Settings::get_default_currency(&db)?.unwrap_or_else(|| "USD".to_string());
        code.parse()
            .map_err(|_| BridgeError::Invalid(format!("invalid default currency code: {code}")))?
    } else {
        args.currency.parse().map_err(|_| {
            BridgeError::Invalid(format!("invalid currency code: {}", args.currency))
        })?
    };
    let cart = Cart::new(currency);
    let id = cart.id();

    // Resolve the primary deduction location for this workspace instance.
    let deduction_location_id = match stock_target_instance_id.as_deref() {
        Some(target_instance_id) => {
            oz_core::location_resolver::resolve_primary_location(&db, target_instance_id, None)?
        }
        None => {
            oz_core::location_resolver::resolve_primary_location(&db, &session.instance_id, None)
                .unwrap_or_else(|_| oz_core::location_resolver::get_default_location_id())
        }
    };

    store.save_active_cart(&cart, Some(deduction_location_id.as_str()))?;
    drop(db);

    tracing::info!(
        cart_id = %id,
        deduction_location_id = %deduction_location_id,
        "cart created with deduction location lock",
    );

    Ok(StartSaleResult {
        cart_id: id,
        deduction_location_id: Some(deduction_location_id.to_string()),
    })
}

// ── Add Line ─────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Addlineargs.
pub struct AddLineArgs {
    /// ID of the associated cart.
    pub cart_id: CartId,
    /// Stock-keeping unit identifier.
    pub sku: Sku,
    /// Quantity.
    pub qty: i64,
    /// Unit Price Minor.
    pub unit_price_minor: i64,
    /// FRONTEND-03: ISO-4217 code of the currency the line is priced in.
    /// When present the command builds the line in this currency and
    /// `Cart::add_line` enforces it matches the cart's currency; when
    /// absent (legacy callers) the cart currency is stamped as before.
    pub unit_price_currency: Option<String>,
}

#[derive(Debug, Serialize)]
/// Addlineresult.
pub struct AddLineResult {
    /// ID of the associated line.
    pub line_id: LineId,
    /// Line Total.
    pub line_total: Option<Money>,
}

/// Resolve the unit price for an `add_line` request (FRONTEND-03).
///
/// The line's own currency crosses the IPC boundary so a cross-currency
/// line is rejected by `Cart::add_line` instead of being silently re-stamped
/// to the cart's currency. `None` preserves the legacy fallback.
pub fn line_unit_price(args: &AddLineArgs, cart_currency: Currency) -> Result<Money, BridgeError> {
    let currency = match args.unit_price_currency.as_deref() {
        Some(s) => s
            .parse::<Currency>()
            .map_err(|_| BridgeError::Invalid(format!("invalid unit price currency: {s}")))?,
        None => cart_currency,
    };
    Ok(Money {
        minor_units: args.unit_price_minor,
        currency,
    })
}

/// Add a line to an active cart in the store resolved from a session token. ADR #7.
///
/// ADR-19 §5.1: rejects the command when the cart has no `deduction_location_id`
/// lock (carts must be created via `start_sale_scoped` which resolves and locks
/// the deduction location at cart-start time).
///
/// Requires `SALES_PROCESS` permission from the resolved session (Bug #6).
pub async fn add_line_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: AddLineArgs,
) -> Result<AddLineResult, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, oz_core::permissions::SALES_PROCESS)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    // ADR-19 §5.1: reject add_line when the cart has no deduction location lock.
    store
        .ensure_cart_deduction_location_lock(&args.cart_id)
        .map_err(|_| {
            BridgeError::Invalid(format!(
                "cart {} has no deduction location lock — create via start_sale_scoped first",
                args.cart_id
            ))
        })?;

    let mut cart = store
        .load_active_cart(&args.cart_id)?
        .ok_or_else(|| BridgeError::Invalid(format!("cart not found: {}", args.cart_id)))?;

    let unit_price = line_unit_price(&args, cart.currency())?;
    let line = CartLine::new(args.sku.clone(), args.qty, unit_price);
    let line_id = line.id;
    let line_total = line.total();
    cart.add_line(line)
        .map_err(|e| BridgeError::Invalid(e.to_string()))?;
    store.save_active_cart(&cart, None)?;
    drop(db);

    Ok(AddLineResult {
        line_id,
        line_total,
    })
}

// ── Override Line Price ──────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Overridelinepriceargs.
pub struct OverrideLinePriceArgs {
    /// ID of the associated cart.
    pub cart_id: CartId,
    /// ID of the associated line.
    pub line_id: LineId,
    /// The new unit price in minor units (e.g. cents).
    pub new_price_minor: i64,
    /// ID of the manager authorising the override.
    pub user_id: String,
}

/// Args for `override_line_price_scoped` — without `user_id`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverrideLinePriceScopedArgs {
    /// ID of the associated cart.
    pub cart_id: CartId,
    /// ID of the associated line.
    pub line_id: LineId,
    /// New Price Minor.
    pub new_price_minor: i64,
}

/// Override a line price within the store resolved from a session token.
///
/// ADR #7: Scoped variant of `override_line_price`. The `user_id` for
/// permission checks is read from the resolved `SessionContext`.
pub async fn override_line_price_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: OverrideLinePriceScopedArgs,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, oz_core::permissions::SALES_OVERRIDE_PRICE)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;

    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    run_override_line_price_unchecked(&db, &args.cart_id, &args.line_id, args.new_price_minor)
}

/// The cart/line mutation behind override_line_price_scoped, with no permission
/// check of its own (the gate runs in the caller, verbatim order).
pub fn run_override_line_price_unchecked(
    db: &rusqlite::Connection,
    cart_id: &CartId,
    line_id: &LineId,
    new_price_minor: i64,
) -> Result<(), BridgeError> {
    let store = Store::new(db);
    let mut cart = store
        .load_active_cart(cart_id)?
        .ok_or_else(|| BridgeError::Invalid(format!("cart not found: {}", cart_id)))?;

    let currency = cart.currency();
    let new_price = Money {
        minor_units: new_price_minor,
        currency,
    };

    let line = cart
        .lines_mut()
        .iter_mut()
        .find(|l| l.id == *line_id)
        .ok_or_else(|| BridgeError::Invalid(format!("line not found: {}", line_id)))?;

    line.set_overridden_price(new_price)
        .map_err(|e| BridgeError::Invalid(e.to_string()))?;

    store.save_active_cart(&cart, None)?;

    tracing::info!(%cart_id, %line_id, new_price_minor, "line price overridden");
    Ok(())
}

// ── Get Cart Deduction Location ───────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
/// Info about the deduction location locked on an active cart. ADR-19 §17.
pub struct DeductionLocationInfo {
    /// The location UUID.
    pub location_id: String,
    /// Human-readable location name.
    pub location_name: String,
    /// ISO-8601 timestamp of the last manager override, or `None`.
    pub overridden_at: Option<String>,
}

// ── Override Deduction Location ───────────────────────────────────────

/// Override the deduction location lock on an active cart.
///
/// Records the manager override timestamp (`location_override_at`) on the
/// cart.  The `deduction_location_id` itself is not changed — this is an
/// audit record that a manager authorised the current location.
///
/// ADR-19 §17: called after FastPINOverlay PIN verification.
pub async fn override_cart_deduction_location_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    cart_id: CartId,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, oz_core::permissions::SALES_OVERRIDE_PRICE)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;

    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    // Permission check: require sales override permission.

    store
        .override_active_cart_deduction_location(&cart_id)
        .map_err(|e| {
            BridgeError::Internal(format!("failed to override deduction location: {e}"))
        })?;

    tracing::info!(
        cart_id = %cart_id,
        user_id = %session.user_id,
        "deduction location override recorded",
    );
    Ok(())
}
// ── Compute Cart Tax ──────────────────────────────────────────────────

/// Compute cart tax for the store resolved from a session token. ADR #7.
///
/// Requires `SALES_PROCESS` permission.
pub async fn compute_cart_tax_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    lines: Vec<oz_core::db::CartLineTaxInput>,
    currency: String,
) -> Result<oz_core::db::CartTaxResult, BridgeError> {
    let parsed: oz_core::Currency = currency
        .parse()
        .map_err(|_| BridgeError::Invalid(format!("invalid currency code: {currency}")))?;
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, oz_core::permissions::SALES_PROCESS)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let tax = store.compute_cart_tax_for_location(
        &lines,
        parsed,
        oz_core::Settings::get_tax_rounding_mode(&db)?,
        Some(&tax_scope_now(&store, &session.store_id)),
    )?;
    drop(db);
    Ok(tax)
}

// ── Hold Orders ──────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Holdcartargs.
pub struct HoldCartArgs {
    /// Label.
    pub label: String,
    /// Cart Data.
    pub cart_data: String,
    /// Item Count.
    pub item_count: i64,
    /// Total amount in minor currency units.
    pub total_minor: i64,
    /// ISO-4217 currency code.
    pub currency: String,
    #[serde(default = "default_bill_type")]
    /// Bill Type.
    pub bill_type: String,
    /// Customer Name.
    pub customer_name: Option<String>,
    /// ADR-19 §6.3: deduction location UUID locked at cart-start time.
    /// When restoring a held cart, the caller should pass the same
    /// `deduction_location_id` that was stored when the cart was held.
    pub deduction_location_id: Option<String>,
}

/// Serde default for HoldCartArgs::bill_type: a plain hold, not an open bill.
pub fn default_bill_type() -> String {
    "hold".to_string()
}

#[derive(Debug, Serialize)]
/// Holdcartresult.
pub struct HoldCartResult {
    /// Unique identifier.
    pub id: String,
}

/// Hold a cart in the store resolved from a session token. ADR #7.
///
/// Requires `SALES_PROCESS` permission.
pub async fn hold_cart_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: HoldCartArgs,
) -> Result<HoldCartResult, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, oz_core::permissions::SALES_PROCESS)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let id = store.hold_cart(
        &args.label,
        &args.cart_data,
        args.item_count,
        args.total_minor,
        &args.currency,
        &args.bill_type,
        args.customer_name.as_deref(),
        args.deduction_location_id.as_deref(),
    )?;
    drop(db);
    tracing::info!(held_cart_id = %id, label = %args.label, "cart held (scoped)");
    Ok(HoldCartResult { id })
}

/// List held carts for the store resolved from a session token. ADR #7.
///
/// Requires `SALES_PROCESS` permission.
pub async fn list_held_carts_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<oz_core::db::HeldCartRow>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, oz_core::permissions::SALES_PROCESS)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let carts = store.list_held_carts()?;
    drop(db);
    Ok(carts)
}

/// List open bills for the store resolved from a session token. ADR #7.
///
/// Requires `SALES_PROCESS` permission.
pub async fn list_open_bills_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<oz_core::db::HeldCartRow>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, oz_core::permissions::SALES_PROCESS)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let carts = store.list_open_bills()?;
    drop(db);
    Ok(carts)
}

/// Get a held cart from the store resolved from a session token. ADR #7.
///
/// Requires `SALES_PROCESS` permission.
pub async fn get_held_cart_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    id: String,
) -> Result<Option<oz_core::db::HeldCartFull>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, oz_core::permissions::SALES_PROCESS)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let cart = store.get_held_cart(&id)?;
    drop(db);
    Ok(cart)
}

/// Delete a held cart in the store resolved from a session token. ADR #7.
///
/// Requires `SALES_PROCESS` permission.
pub async fn delete_held_cart_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    id: String,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, oz_core::permissions::SALES_PROCESS)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    store.delete_held_cart(&id)?;
    drop(db);
    tracing::info!(held_cart_id = %id, "held cart deleted (scoped)");
    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────

// ── Scoped variants (ADR #7) ────────────────────────────────────

/// Scoped variant of `get_cart_deduction_location` (ADR #7).
pub async fn get_cart_deduction_location_scoped(
    ctx: &BridgeCtx<'_>,
    cart_id: CartId,
    session_token: &str,
) -> Result<Option<DeductionLocationInfo>, BridgeError> {
    let (_session, _conn) = ctx.resolve_scope(session_token)?;
    let db = _conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let result = store.get_active_cart_deduction_location_info(&cart_id)?;
    drop(db);
    Ok(
        result.map(|(loc_id, loc_name, overridden_at)| DeductionLocationInfo {
            location_id: loc_id,
            location_name: loc_name,
            overridden_at,
        }),
    )
}
