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
use oz_core::events::{CourseFired, CourseItem, SaleCompleted, SaleCompletedLine};
use oz_core::{Cart, CartId, CartLine, Currency, LineId, Money, PaymentSplitArg, Sku};

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
    /// Restaurant course assignment at add time (e.g. "appetizer", "main").
    /// Normalized through `foundation::cart::normalize_course` (legacy
    /// "drinks" → "beverage"); `None` leaves the line unassigned.
    /// Modifiers ride this same wire in a later tranche.
    #[serde(default)]
    pub course: Option<String>,
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
    let mut line = CartLine::new(args.sku.clone(), args.qty, unit_price);
    line.set_course(args.course.as_deref());
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

// ── Set Line Course ────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Setlinecourseargs.
pub struct SetLineCourseArgs {
    /// ID of the associated cart.
    pub cart_id: CartId,
    /// ID of the associated line.
    pub line_id: LineId,
    /// Restaurant course to assign (e.g. "appetizer", "main"); empty or
    /// absent clears the assignment. Normalized through
    /// `foundation::cart::normalize_course` (legacy "drinks" → "beverage").
    #[serde(default)]
    pub course: Option<String>,
}

/// Assign (or clear) the restaurant course on an active cart line.
///
/// The UI assigns course after the line exists (`assignCourse(lineId,
/// courseId)`), so this is a dedicated command rather than an `add_line`
/// extension. Requires `SALES_PROCESS` — the same gate as adding a line.
pub async fn set_line_course_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: SetLineCourseArgs,
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
    run_set_line_course_unchecked(&db, &args.cart_id, &args.line_id, args.course.as_deref())
}

/// The cart/line mutation behind set_line_course_scoped, with no permission
/// check of its own (the gate runs in the caller, verbatim order).
pub fn run_set_line_course_unchecked(
    db: &rusqlite::Connection,
    cart_id: &CartId,
    line_id: &LineId,
    course: Option<&str>,
) -> Result<(), BridgeError> {
    let store = Store::new(db);
    let mut cart = store
        .load_active_cart(cart_id)?
        .ok_or_else(|| BridgeError::Invalid(format!("cart not found: {}", cart_id)))?;

    let assigned = {
        let line = cart
            .lines_mut()
            .iter_mut()
            .find(|l| l.id == *line_id)
            .ok_or_else(|| BridgeError::Invalid(format!("line not found: {}", line_id)))?;
        line.set_course(course);
        line.course.clone()
    };

    store.save_active_cart(&cart, None)?;

    tracing::info!(%cart_id, %line_id, course = ?assigned, "line course assigned");
    Ok(())
}

// ── Publish Course Fired ───────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Publishcoursefiredargs.
pub struct PublishCourseFiredArgs {
    /// ID of the completed sale this course belongs to.
    pub sale_id: String,
    /// Restaurant course that was fired (e.g. "appetizer", "main").
    /// Normalized through `foundation::cart::normalize_course`.
    pub course_id: String,
    /// Display number shown on the ticket (from the KDS fan-out), if any.
    #[serde(default)]
    pub display_number: Option<i64>,
    /// Items in this course.
    pub items: Vec<PublishCourseFiredItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
/// A single item within a fired course (mirrors `CourseItem`).
pub struct PublishCourseFiredItem {
    /// Stock-keeping unit.
    pub sku: String,
    /// Quantity fired.
    pub qty: i64,
    /// Human-readable item name.
    pub name: String,
}

/// Publish one fired course for a completed sale.
///
/// Called at checkout after the KDS fan-out, once per course whose lines the
/// waiter fired. Carries the REAL sale id (firing publishes at checkout, not
/// on the pre-sale cart, so no cart-id correlation is needed) and the ticket
/// display number. The event is fire-and-forget (`publish_event` logs and
/// swallows a bus failure), so a committed sale never becomes a failed
/// response. Unassigned lines are NOT auto-included: the caller groups only
/// the lines already fired for `course_id`. Requires `SALES_PROCESS`.
pub async fn publish_course_fired_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: PublishCourseFiredArgs,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, oz_core::permissions::SALES_PROCESS)
        .await?;

    let course_id = foundation::normalize_course(Some(args.course_id.as_str()))
        .ok_or_else(|| BridgeError::Invalid(format!("empty course id: {}", args.course_id)))?;

    // Confirm the sale exists in this store (no sale join for the consumer —
    // the id is correlation, but a typo'd id must fail loudly, not publish
    // an event for a sale that never happened).
    {
        let conn = ctx
            .db_manager
            .open_store(&session.store_id)
            .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
        let db = conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
        let store = Store::new(&db);
        store
            .get_sale(&args.sale_id)?
            .ok_or_else(|| BridgeError::Invalid(format!("sale not found: {}", args.sale_id)))?;
    } // conn, db, store dropped before the publish `.await` (Send, see below)

    ctx.publish_event(&CourseFired {
        sale_id: args.sale_id,
        store_id: Some(session.store_id.clone()),
        course_id,
        display_number: args.display_number,
        items: args
            .items
            .into_iter()
            .map(|i| CourseItem {
                sku: i.sku,
                qty: i.qty,
                name: i.name,
            })
            .collect(),
    })
    .await;
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

/// The `bill_type` value marking a held cart as an open bill.
pub const BILL_TYPE_OPEN_BILL: &str = "open_bill";

/// True when the session is bound to the Restaurant POS workspace vertical.
///
/// The vertical is read from `session.type_key` — validated by `create_session`
/// against the licence's `allowed_types` and fixed for the session's lifetime —
/// which is what makes it a sound basis for an authorization decision, unlike
/// [`HoldCartArgs::bill_type`], which arrives afresh on every call and was
/// previously trusted exactly as sent.
///
/// Named `…_workspace`, not `is_restaurant_pos`, to keep it distinct from
/// `SessionContext::restaurant_pos_id`: that field is a **terminal id** (the
/// ADR #40 peer-terminal binding used to resolve the effective store), not a
/// vertical. The two are unrelated and only the name distinguishes them.
///
/// An open bill is a Restaurant POS concept: its only reader,
/// `list_open_bills_scoped`, is reached from the restaurant terminal alone, and
/// the shared `PaymentModal` offers it as the "Open Bill" tender. Every other
/// vertical — [`oz_core::workspace_type::STORE_POS`], `kds`, `warehouse`,
/// `admin` — is refused.
pub fn is_restaurant_pos_workspace(session: &oz_core::session::SessionContext) -> bool {
    oz_core::workspace_type::is_restaurant_pos_type(&session.type_key)
}

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
///
/// # Terminal identity
///
/// `bill_type` is checked against the caller's workspace type rather than
/// trusted. `open_bill` is a Restaurant POS concept, so a session whose
/// `type_key` is not [`oz_core::workspace_type::RESTAURANT_POS`] is refused fail-closed. Before
/// this check the value was written through as sent, which let the retail
/// terminal create an open bill — reachable through the shared `PaymentModal`,
/// whose Open Bill tender was not workspace-gated. A plain `hold` stays
/// available to every terminal.
pub async fn hold_cart_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: HoldCartArgs,
) -> Result<HoldCartResult, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, oz_core::permissions::SALES_PROCESS)
        .await?;
    if args.bill_type == BILL_TYPE_OPEN_BILL && !is_restaurant_pos_workspace(&session) {
        return Err(BridgeError::PermissionDenied(format!(
            "workspace '{}' may not create an open bill; only '{}' may",
            session.type_key,
            oz_core::workspace_type::RESTAURANT_POS
        )));
    }
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
///
/// # Terminal identity
///
/// Restaurant POS only. An open bill is that terminal's own concept — the
/// restaurant cart reads it as "Open Bills" while the retail cart reads
/// `list_held_carts_scoped` as "Held Carts" — so a session whose `type_key` is
/// not [`oz_core::workspace_type::RESTAURANT_POS`] is refused rather than served an empty list,
/// which would read as "there are none" instead of "this is not your terminal".
pub async fn list_open_bills_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<oz_core::db::HeldCartRow>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, oz_core::permissions::SALES_PROCESS)
        .await?;
    if !is_restaurant_pos_workspace(&session) {
        return Err(BridgeError::PermissionDenied(format!(
            "workspace '{}' may not list open bills; only '{}' may",
            session.type_key,
            oz_core::workspace_type::RESTAURANT_POS
        )));
    }
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
fn replay_receipt(sale: &oz_core::Sale) -> CompleteSaleResult {
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
    ctx: &BridgeCtx<'_>,
    cart: &oz_core::Cart,
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
    ctx.require_session_permission(&session, oz_core::permissions::SALES_PROCESS)
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

    let mut sale = oz_core::Sale::from_cart(&cart)
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
) -> Result<oz_core::Cart, BridgeError> {
    let first = lines
        .first()
        .ok_or_else(|| BridgeError::Invalid("cannot preview an empty cart".into()))?;
    let parse_currency = |code: &str| -> Result<oz_core::Currency, BridgeError> {
        code.parse()
            .map_err(|_| BridgeError::Invalid(format!("invalid currency code: {code}")))
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
        .map_err(|e| BridgeError::Invalid(format!("cart line rejected: {e}")))?;
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
pub async fn preview_promoted_total_from_lines_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: PreviewPromotedTotalFromLinesArgs,
) -> Result<PreviewPromotedTotalResult, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, oz_core::permissions::SALES_PROCESS)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;

    let cart = build_preview_cart(&args.lines, args.discount_percent)?;
    let mut sale = oz_core::Sale::from_cart(&cart)
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
pub async fn complete_sale_with_resolved_shortfalls_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: CompleteSaleWithResolvedShortfallsArgs,
) -> Result<CompleteSaleResult, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, oz_core::permissions::SALES_PROCESS)
        .await?;
    let stock_target_instance_id = {
        let global_db = ctx.lock_global().await;
        // §B: when the offline grace window has fully lapsed, the register
        // is read-only — new sales are rejected until the subscription is
        // verified online. Active/in-grace registers pass untouched.
        let sub = oz_core::TenantSubscription::load(&global_db, "default")?
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
    let currency: oz_core::Currency = args
        .currency
        .parse()
        .map_err(|_| BridgeError::Invalid(format!("invalid currency code: {}", args.currency)))?;

    let mut cart = oz_core::Cart::new(currency);
    for line_data in &args.lines {
        let unit_price = shortfall_line_unit_price(line_data, cart.currency())?;
        let mut line =
            oz_core::CartLine::new(oz_core::Sku::new(&line_data.sku), line_data.qty, unit_price);
        line.set_course(line_data.course.as_deref());
        cart.add_line(line)
            .map_err(|e| BridgeError::Invalid(e.to_string()))?;
    }

    // Apply discount if configured
    if args.discount_percent > 0
        && let Some(pct) = foundation::Percentage::new(args.discount_percent as u8)
    {
        cart.set_discount(pct, args.discount_label.clone());
    }

    let line_count = cart.line_count();

    let mut sale = oz_core::Sale::from_cart_with_user(&cart, Some(session.user_id.clone()))
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

        ctx.publish_event(&oz_core::events::SaleCompleted {
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
    ctx.require_session_permission(&session, oz_core::permissions::SALES_PROCESS)
        .await?;
    let stock_target_instance_ids = {
        let global_db = ctx.lock_global().await;
        // §B read-only lock (see complete_sale_with_resolved_shortfalls_scoped).
        let sub = oz_core::TenantSubscription::load(&global_db, "default")?
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
            oz_core::location_resolver::resolve_primary_location(&db, target_instance_id, None)?;
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
    {
        let plugins = ctx.plugins.lock().await;
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
                // SAFETY: discount.percent is validated 0..=100 above.
                let lua_pct = Percentage::new(discount.percent as u8).unwrap();
                cart.set_discount(lua_pct, Some(label));
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
                // SAFETY: pd.percent is validated 0..=100 above.
                let pct = Percentage::new(pd.percent as u8).unwrap();
                cart.set_discount(pct, Some(pd.target));
            }
        }
    }

    let mut sale = oz_core::Sale::from_cart_with_user(&cart, Some(session.user_id.clone()))
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
        // from colliding with itself on its own second row. A stale id the
        // guard refused above was re-keyed, so this stamps the fresh one.
        stamp_attempt_split_keys(effective_attempt_id.as_deref(), &mut splits);

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
