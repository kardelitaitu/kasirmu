//! Cart-authoring commands: discount, start sale, add line, price override,
//! line course, course-publish, deduction-location and cart-tax.
//!
//! These are the pre-checkout mutations a cashier performs while building a
//! basket. They share NO helper with the checkout half: `replay_verdict` and
//! `lua_calc_line_overrides` are checkout-only and never appear here, while the
//! scaffold helpers this file needs (`tax_scope_now`,
//! `resolve_runtime_stock_target`) are reached through `super`.
//!
//! Main entry points: [`start_sale_scoped`], [`add_line_scoped`],
//! [`set_cart_discount_scoped`], [`compute_cart_tax_scoped`].

use serde::{Deserialize, Serialize};

use foundation::Percentage;
use kasirmu_core::db::Store;
use kasirmu_core::events::{CourseFired, CourseItem};
use kasirmu_core::{Cart, CartId, CartLine, Currency, LineId, Money, Sku};

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

use super::{resolve_runtime_stock_target, tax_scope_now};

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
    ctx.require_session_permission(&session, kasirmu_core::permissions::SALES_DISCOUNT)
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
    ctx.require_session_permission(&session, kasirmu_core::permissions::SALES_PROCESS)
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

    let currency: kasirmu_core::Currency = if args.currency.is_empty() {
        // M-6: lookup the store profile's default currency instead of hardcoding "USD".
        let code =
            kasirmu_core::Settings::get_default_currency(&db)?.unwrap_or_else(|| "USD".to_string());
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
    //
    // BOTH arms propagate. The `None` arm used to swallow with
    // `.unwrap_or_else(|_| get_default_location_id())` while the `Some` arm beside it
    // used `?` — a split WITHIN one match, which is the clearest form of this defect
    // in the whole family: the two arms differ only in where the instance id comes
    // from, so there was never a reason to handle a failed read differently.
    //
    // The `None` arm is also the one real deployments take (no stock-target override),
    // and the next statement LOCKS the answer on the cart row
    // (`save_active_cart(.., Some(deduction_location_id))`), so the swallow persisted
    // the canonical default as that cart's deduction location for its whole lifetime.
    // A workspace with genuinely no binding still gets tier 4 from the resolver
    // itself; only a READ FAILURE reaches this `?`.
    let deduction_location_id = match stock_target_instance_id.as_deref() {
        Some(target_instance_id) => kasirmu_core::location_resolver::resolve_primary_location(
            &db,
            target_instance_id,
            None,
        )?,
        None => kasirmu_core::location_resolver::resolve_primary_location(
            &db,
            &session.instance_id,
            None,
        )?,
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
    #[serde(default)]
    pub course: Option<String>,
    /// Modifier choices serialized as JSON string array.
    #[serde(default)]
    pub modifiers_json: Option<String>,
    /// Optional customer / kitchen note for this line.
    #[serde(default)]
    pub note: Option<String>,
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
    ctx.require_session_permission(&session, kasirmu_core::permissions::SALES_PROCESS)
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
    line.set_modifiers(args.modifiers_json);
    line.set_note(args.note);
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
    ctx.require_session_permission(&session, kasirmu_core::permissions::SALES_OVERRIDE_PRICE)
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
        .ok_or_else(|| BridgeError::Invalid(format!("cart not found: {cart_id}")))?;

    let currency = cart.currency();
    let new_price = Money {
        minor_units: new_price_minor,
        currency,
    };

    let line = cart
        .lines_mut()
        .iter_mut()
        .find(|l| l.id == *line_id)
        .ok_or_else(|| BridgeError::Invalid(format!("line not found: {line_id}")))?;

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
    ctx.require_session_permission(&session, kasirmu_core::permissions::SALES_PROCESS)
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
        .ok_or_else(|| BridgeError::Invalid(format!("cart not found: {cart_id}")))?;

    let assigned = {
        let line = cart
            .lines_mut()
            .iter_mut()
            .find(|l| l.id == *line_id)
            .ok_or_else(|| BridgeError::Invalid(format!("line not found: {line_id}")))?;
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
    ctx.require_session_permission(&session, kasirmu_core::permissions::SALES_PROCESS)
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
    ctx.require_session_permission(&session, kasirmu_core::permissions::SALES_OVERRIDE_PRICE)
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
    lines: Vec<kasirmu_core::db::CartLineTaxInput>,
    currency: String,
) -> Result<kasirmu_core::db::CartTaxResult, BridgeError> {
    let parsed: kasirmu_core::Currency = currency
        .parse()
        .map_err(|_| BridgeError::Invalid(format!("invalid currency code: {currency}")))?;
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, kasirmu_core::permissions::SALES_PROCESS)
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
        kasirmu_core::Settings::get_tax_rounding_mode(&db)?,
        Some(&tax_scope_now(&store, &session.store_id)),
    )?;
    drop(db);
    Ok(tax)
}

// ── Scoped variants (ADR #7) ────────────────────────────────────

// ── Scoped variants (ADR #7) ────────────────────────────────────

/// Scoped variant of `get_cart_deduction_location` (ADR #7).
pub async fn get_cart_deduction_location_scoped(
    ctx: &BridgeCtx<'_>,
    cart_id: CartId,
    session_token: &str,
) -> Result<Option<DeductionLocationInfo>, BridgeError> {
    // ungated-ok: a read of the caller's own active cart's deduction location
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
