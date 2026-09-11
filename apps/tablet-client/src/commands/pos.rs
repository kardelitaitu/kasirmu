/*
last audited 25-07-26 by RSA-Agent (tablet-client slice A: pos head+sweep)
crate: tablet-client | status: SAFE | lint: CLEAN
findings: sweep + guard sites verified — both Percentage::new unwraps (lines 57, 100) preceded by explicit 0..=100 range checks with SAFETY comments; authz decorators present; cart/sale state machine lives in oz_core (audited). Coverage note: risk-ranked sampling, not full deep read
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
//!
//! Checkout is idempotent per attempt (COR-7): `complete_sale_scoped` and
//! `complete_sale_with_resolved_shortfalls_scoped` read a client-supplied
//! `attempt_id`, treat it as an opaque key, stamp every payment split as
//! `{attempt}:{index}` and answer a replay with the original receipt. The
//! rules are copied from `crates/oz-bridge/src/pos.rs`, which this forked
//! command layer cannot import — keep the two in step.

use serde::{Deserialize, Serialize};
use tauri::{State, command};

use foundation::Percentage;
use oz_core::db::Store;
use oz_core::events::{SaleCompleted, SaleCompletedLine};
use oz_core::location_resolver;
use oz_core::session::SessionContext;
use oz_core::{Cart, CartId, CartLine, Currency, LineId, Money, PaymentSplitArg, SaleStatus, Sku};

use crate::commands::authz::require_permission_for_user;
use crate::error::AppError;
use crate::state::AppState;

/// The tax scope for a sale rung up at `location_id` right now.
///
/// Mirrors the desktop helper of the same name; see
/// `apps/desktop-client/src/commands/pos.rs` for why `as_of` is the UTC
/// calendar date and why that is a recorded compromise rather than the answer
/// (`locations.timezone` IANA-vs-offset is regional open question 1, so a
/// locally-correct business date is not available yet). UTC is what
/// `sale.created_at` already records, which keeps a cart preview and its
/// checkout receipt resolving on the same side of an exclusive `effective_to`.
fn tax_scope_now(store: &Store, location_id: &str) -> oz_core::TaxSaleScope {
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

/// Set or clear a cart-level percentage discount.
///
/// The discount is applied when the cart total is computed and when
/// the sale is completed. Pass `percent = 0` to clear any existing
/// discount.
#[command]
pub async fn set_cart_discount(
    args: SetCartDiscountArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    if !(0..=100).contains(&args.percent) {
        return Err(AppError::Invalid(format!(
            "discount percent must be between 0 and 100, got {}",
            args.percent
        )));
    }
    // SAFETY: args.percent is validated 0..=100 above, so the unwrap is safe.
    let percent = Percentage::new(args.percent as u8).unwrap();

    let db = state.db.lock().await;
    let store = Store::new(&db);

    require_permission_for_user(&store, &args.user_id, oz_core::permissions::SALES_DISCOUNT)?;

    let mut cart = store
        .load_active_cart(&args.cart_id)?
        .ok_or_else(|| AppError::Invalid(format!("cart not found: {}", args.cart_id)))?;
    cart.set_discount(percent, args.label);
    store.save_active_cart(&cart, None)?;
    drop(db);
    tracing::info!(cart_id = %args.cart_id, percent = %args.percent, "cart discount set");
    Ok(())
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

/// Set a cart discount within the session scope. ADR #7 / ADR-19.
#[command]
pub async fn set_cart_discount_scoped(
    session_token: String,
    args: SetCartDiscountScopedArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    if !(0..=100).contains(&args.percent) {
        return Err(AppError::Invalid(format!(
            "discount percent must be between 0 and 100, got {}",
            args.percent
        )));
    }
    // SAFETY: args.percent is validated 0..=100 above, so the unwrap is safe.
    let percent = Percentage::new(args.percent as u8).unwrap();

    let db = state.db.lock().await;
    let store = Store::new(&db);

    let session = state.resolve_session(&session_token)?;
    require_permission_for_user(
        &store,
        &session.user_id,
        oz_core::permissions::SALES_DISCOUNT,
    )?;

    let mut cart = store
        .load_active_cart(&args.cart_id)?
        .ok_or_else(|| AppError::Invalid(format!("cart not found: {}", args.cart_id)))?;
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

#[command]
/// Start sale.
pub async fn start_sale(
    args: StartSaleArgs,
    state: State<'_, AppState>,
) -> Result<StartSaleResult, AppError> {
    let currency_str = if args.currency.is_empty() {
        "USD"
    } else {
        &args.currency
    };
    let currency: oz_core::Currency = currency_str
        .parse()
        .map_err(|_| AppError::Invalid(format!("invalid currency code: {currency_str}")))?;
    let cart = Cart::new(currency);
    let id = cart.id();

    let db = state.db.lock().await;
    let store = Store::new(&db);
    store.save_active_cart(&cart, None)?;
    drop(db);

    Ok(StartSaleResult {
        cart_id: id,
        deduction_location_id: None,
    })
}

/// Start a new sale in the session scope. ADR #7 / ADR-19 §5.1.
///
/// Resolves the primary deduction location from the workspace instance
/// and locks it on the `active_carts` row at cart-start time.
///
/// Requires `SALES_PROCESS` permission from the resolved session (Bug #4).
#[command]
pub async fn start_sale_scoped(
    session_token: String,
    args: StartSaleArgs,
    state: State<'_, AppState>,
) -> Result<StartSaleResult, AppError> {
    let currency_str = if args.currency.is_empty() {
        "USD"
    } else {
        &args.currency
    };
    let currency: oz_core::Currency = currency_str
        .parse()
        .map_err(|_| AppError::Invalid(format!("invalid currency code: {currency_str}")))?;
    let cart = Cart::new(currency);
    let id = cart.id();

    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    let store = Store::new(&db);

    require_permission_for_user(
        &store,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )?;

    // Resolve the primary deduction location for this workspace instance.
    let deduction_location_id =
        location_resolver::resolve_primary_location(&db, &session.instance_id, None)
            .unwrap_or_else(|_| location_resolver::get_default_location_id());

    store.save_active_cart(&cart, Some(deduction_location_id.as_str()))?;
    drop(db);

    tracing::info!(
        cart_id = %id,
        deduction_location_id = %deduction_location_id,
        "cart created with deduction location lock (scoped)",
    );

    Ok(StartSaleResult {
        cart_id: id,
        deduction_location_id: Some(deduction_location_id.to_string()),
    })
}

// ── List Active Carts ────────────────────────────────────────────────

/// Return all active cart IDs so the front-end can restore carts
/// after a restart.
#[command]
pub async fn list_active_carts(state: State<'_, AppState>) -> Result<Vec<CartId>, AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    let ids = store.list_active_carts()?;
    drop(db);
    Ok(ids)
}

/// List active carts in the session scope. ADR #7.
#[command]
pub async fn list_active_carts_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<CartId>, AppError> {
    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(
        &store,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )?;
    let ids = store.list_active_carts()?;
    drop(db);
    Ok(ids)
}

// ── Get Active Cart ──────────────────────────────────────────────────

/// Load and return the full cart state (lines, discount) by id.
/// The front end uses this to restore a cart after restart or navigation.
#[command]
pub async fn get_active_cart(
    cart_id: CartId,
    state: State<'_, AppState>,
) -> Result<Option<Cart>, AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    let cart = store.load_active_cart(&cart_id)?;
    drop(db);
    Ok(cart)
}

/// Load a cart in the session scope. ADR #7.
#[command]
pub async fn get_active_cart_scoped(
    session_token: String,
    cart_id: CartId,
    state: State<'_, AppState>,
) -> Result<Option<Cart>, AppError> {
    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(
        &store,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )?;
    let cart = store.load_active_cart(&cart_id)?;
    drop(db);
    Ok(cart)
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
fn line_unit_price(args: &AddLineArgs, cart_currency: Currency) -> Result<Money, AppError> {
    let currency = match args.unit_price_currency.as_deref() {
        Some(s) => s
            .parse::<Currency>()
            .map_err(|_| AppError::Invalid(format!("invalid unit price currency: {s}")))?,
        None => cart_currency,
    };
    Ok(Money {
        minor_units: args.unit_price_minor,
        currency,
    })
}

#[command]
/// Add line.
pub async fn add_line(
    args: AddLineArgs,
    state: State<'_, AppState>,
) -> Result<AddLineResult, AppError> {
    // Load the cart and add the line in a single DB transaction scope.
    let db = state.db.lock().await;
    let store = Store::new(&db);
    let mut cart = store
        .load_active_cart(&args.cart_id)?
        .ok_or_else(|| AppError::Invalid(format!("cart not found: {}", args.cart_id)))?;

    let unit_price = line_unit_price(&args, cart.currency())?;
    let line = CartLine::new(args.sku.clone(), args.qty, unit_price);
    let line_id = line.id;
    let line_total = line.total();
    cart.add_line(line)
        .map_err(|e| AppError::Invalid(e.to_string()))?;
    store.save_active_cart(&cart, None)?;
    drop(db);

    Ok(AddLineResult {
        line_id,
        line_total,
    })
}

/// Add a line to an active cart in the session scope.
///
/// ADR #7 / ADR-19 §5.1: rejects the command when the cart has no
/// `deduction_location_id` lock.
///
/// Requires `SALES_PROCESS` permission from the resolved session (Bug #3).
#[command]
pub async fn add_line_scoped(
    session_token: String,
    args: AddLineArgs,
    state: State<'_, AppState>,
) -> Result<AddLineResult, AppError> {
    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    run_add_line_scoped(&db, &session.user_id, &args)
}

/// Shared business logic: permission-check + add line to cart.
/// Extracted so the `SALES_PROCESS` gate is unit-testable without
/// constructing an `AppState` (Bug #3 fix).
fn run_add_line_scoped(
    db: &rusqlite::Connection,
    user_id: &str,
    args: &AddLineArgs,
) -> Result<AddLineResult, AppError> {
    let store = Store::new(db);

    require_permission_for_user(&store, user_id, oz_core::permissions::SALES_PROCESS)?;

    // ADR-19 §5.1: reject add_line when the cart has no deduction location lock.
    store
        .ensure_cart_deduction_location_lock(&args.cart_id)
        .map_err(|_| {
            AppError::Invalid(format!(
                "cart {} has no deduction location lock — create via start_sale_scoped first",
                args.cart_id
            ))
        })?;

    let mut cart = store
        .load_active_cart(&args.cart_id)?
        .ok_or_else(|| AppError::Invalid(format!("cart not found: {}", args.cart_id)))?;

    let unit_price = line_unit_price(args, cart.currency())?;
    let line = CartLine::new(args.sku.clone(), args.qty, unit_price);
    let line_id = line.id;
    let line_total = line.total();
    cart.add_line(line)
        .map_err(|e| AppError::Invalid(e.to_string()))?;
    store.save_active_cart(&cart, None)?;

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

/// Override the unit price of a cart line, authorised by a manager PIN.
#[command]
pub async fn override_line_price(
    args: OverrideLinePriceArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    let mut cart = store
        .load_active_cart(&args.cart_id)?
        .ok_or_else(|| AppError::Invalid(format!("cart not found: {}", args.cart_id)))?;

    // Permission check: the user authorising the override must have SALES_OVERRIDE_PRICE.
    require_permission_for_user(
        &store,
        &args.user_id,
        oz_core::permissions::SALES_OVERRIDE_PRICE,
    )?;

    let currency = cart.currency();
    let new_price = Money {
        minor_units: args.new_price_minor,
        currency,
    };

    // Find the line and set the override
    let line = cart
        .lines_mut()
        .iter_mut()
        .find(|l| l.id == args.line_id)
        .ok_or_else(|| AppError::Invalid(format!("line not found: {}", args.line_id)))?;

    line.set_overridden_price(new_price)
        .map_err(|e| AppError::Invalid(e.to_string()))?;

    store.save_active_cart(&cart, None)?;
    drop(db);

    tracing::info!(cart_id = %args.cart_id, line_id = %args.line_id, new_price_minor = args.new_price_minor, "line price overridden");
    Ok(())
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

/// Override a line price within the session scope. ADR #7.
#[command]
pub async fn override_line_price_scoped(
    session_token: String,
    args: OverrideLinePriceScopedArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    let store = Store::new(&db);
    let mut cart = store
        .load_active_cart(&args.cart_id)?
        .ok_or_else(|| AppError::Invalid(format!("cart not found: {}", args.cart_id)))?;

    require_permission_for_user(
        &store,
        &session.user_id,
        oz_core::permissions::SALES_OVERRIDE_PRICE,
    )?;

    let currency = cart.currency();
    let new_price = Money {
        minor_units: args.new_price_minor,
        currency,
    };

    let line = cart
        .lines_mut()
        .iter_mut()
        .find(|l| l.id == args.line_id)
        .ok_or_else(|| AppError::Invalid(format!("line not found: {}", args.line_id)))?;

    line.set_overridden_price(new_price)
        .map_err(|e| AppError::Invalid(e.to_string()))?;

    store.save_active_cart(&cart, None)?;
    drop(db);

    tracing::info!(cart_id = %args.cart_id, line_id = %args.line_id, new_price_minor = args.new_price_minor, "line price overridden (scoped)");
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

/// Return the deduction location info for an active cart.
#[command]
pub async fn get_cart_deduction_location(
    cart_id: CartId,
    state: State<'_, AppState>,
) -> Result<Option<DeductionLocationInfo>, AppError> {
    let db = state.db.lock().await;
    run_get_cart_deduction_location(&db, &cart_id)
}

/// Shared body for the ambient and session-scoped variants above.
///
/// Extracted to match this file's existing `run_*` convention (see
/// `run_override_cart_deduction_location`), so the two variants cannot drift apart. Note that the
/// store getter takes only a `cart_id` -- there is no ownership parameter to pass -- so the scoped
/// variant's added value is authenticating the session, exactly as every other ADR #7 pair here
/// does, and as `desktop-client`'s `get_cart_deduction_location_scoped` already does.
fn run_get_cart_deduction_location(
    db: &rusqlite::Connection,
    cart_id: &CartId,
) -> Result<Option<DeductionLocationInfo>, AppError> {
    let store = Store::new(db);
    let result = store.get_active_cart_deduction_location_info(cart_id)?;
    // No `drop(db)` here, unlike the inline original: `db` is a borrow of the caller's MutexGuard,
    // so dropping it is a no-op that rustc warns about. The lock is released when the caller's
    // guard goes out of scope, and the mapping below touches no DB state, so holding it a few
    // instructions longer is immaterial.
    Ok(
        result.map(|(loc_id, loc_name, overridden_at)| DeductionLocationInfo {
            location_id: loc_id,
            location_name: loc_name,
            overridden_at,
        }),
    )
}

/// Scoped variant of `get_cart_deduction_location` (ADR #7).
///
/// `desktop-client` has registered this command since the ADR #7 sweep; tablet never did, and the
/// UI invokes the ambient name, which desktop never registered -- so the two shells exposed
/// opposite halves of the same pair and the call threw on desktop. This closes that half.
#[command]
pub async fn get_cart_deduction_location_scoped(
    session_token: String,
    cart_id: CartId,
    state: State<'_, AppState>,
) -> Result<Option<DeductionLocationInfo>, AppError> {
    let _session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    run_get_cart_deduction_location(&db, &cart_id)
}

// ── Override Deduction Location ───────────────────────────────────────

/// Override the deduction location lock on an active cart.
///
/// **Deprecated for session-scoped auth (ADR #7):** Use
/// `override_cart_deduction_location_scoped` which reads the user ID from
/// the resolved session.
///
/// Requires `SALES_OVERRIDE_PRICE` permission (Bug #2 fix).
#[command]
pub async fn override_cart_deduction_location(
    cart_id: CartId,
    user_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let db = state.db.lock().await;
    run_override_cart_deduction_location(&db, &user_id, &cart_id)
}

/// Shared business logic: permission-check + override.
/// Extracted so both the deprecated and scoped commands share the same
/// `SALES_OVERRIDE_PRICE` gate, and so the gate is unit-testable without
/// constructing an `AppState`.
fn run_override_cart_deduction_location(
    db: &rusqlite::Connection,
    user_id: &str,
    cart_id: &CartId,
) -> Result<(), AppError> {
    let store = Store::new(db);

    require_permission_for_user(&store, user_id, oz_core::permissions::SALES_OVERRIDE_PRICE)?;

    store
        .override_active_cart_deduction_location(cart_id)
        .map_err(|e| AppError::Internal(format!("failed to override deduction location: {e}")))?;

    tracing::info!(cart_id = %cart_id, user_id = %user_id, "deduction location override recorded");
    Ok(())
}

/// Override the deduction location lock on an active cart (scoped).
///
/// ADR-19 §17: Records the manager override timestamp on the cart.
/// Requires `SALES_OVERRIDE_PRICE` permission from the resolved session.
#[command]
pub async fn override_cart_deduction_location_scoped(
    session_token: String,
    cart_id: CartId,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    run_override_cart_deduction_location(&db, &session.user_id, &cart_id)
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

// ── COR-7: per-attempt checkout idempotency (tablet port) ───────────
//
// Semantics copied from the desktop implementation in
// `crates/oz-bridge/src/pos.rs` (`stamp_attempt_split_keys`,
// `replay_verdict`), which this crate cannot import: the tablet shell is a
// fork of the command layer, so the helpers below are a second
// implementation of the SAME rules, not shared code. Keep them in step.

/// The checkout attempt id this submission wants guarded, normalised.
///
/// The value is an OPAQUE client-owned key and is never parsed — its only
/// contract is to be identical on every submission of one attempt.
///
/// Absent, empty and whitespace-only all mean UNGUARDED and collapse to
/// `None`, so every payment row is stamped NULL. Trimming is load-bearing,
/// not cosmetic: an untrimmed "   " would become the stem `"   :0"`, a key
/// no client can ever replay, which would look guarded while guarding
/// nothing. No key is ever minted server-side.
fn normalized_attempt_id(raw: Option<&str>) -> Option<String> {
    raw.map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Stamp one idempotency key per split from a normalised attempt id.
///
/// The index is required, not cosmetic: a split tender whose rows all
/// carried the same key would collide with itself on the second row and
/// reject a legitimate first sale. `{attempt}:{n}` is deterministic, so
/// replaying an attempt reproduces exactly the same set of keys and the
/// UNIQUE index on `payments.idempotency_key` closes the race between two
/// concurrent submits.
///
/// `None` stamps nothing: the caller asked for no guard, so the rows keep
/// their NULL key and stay invisible to the replay lookup.
fn stamp_attempt_split_keys(attempt_id: Option<&str>, splits: &mut [PaymentSplitArg]) {
    if let Some(attempt) = attempt_id {
        for (i, split) in splits.iter_mut().enumerate() {
            split.idempotency_key = Some(format!("{attempt}:{i}"));
        }
    }
}

/// What the COR-7 replay guard decided for this submission.
///
/// Three verdicts, mirroring the desktop enum exactly — a fourth would mean
/// the two shells answer the same request differently.
enum ReplayVerdict {
    /// The attempt already completed: hand back this receipt and touch
    /// nothing (no cart delete, no sale, no event).
    Replayed(CompleteSaleResult),
    /// No completed attempt sits behind this key: settle normally with the
    /// request's own attempt id.
    Fresh,
    /// A key matched but its sale is VOIDED — it took no money and returned
    /// its stock, so it must neither block a new sale nor be presented as a
    /// receipt. The `String` is the deterministic re-key stem derived from
    /// the attempt id and the request's cart, which the caller stamps
    /// instead of the request's attempt id.
    Rekey(String),
}

/// Build the receipt a replay hands back for a matched sale.
///
/// Success-shaped on purpose: the client's `await` resolves with the sale it
/// lost the response to, so a double-tap cannot be mistaken for a failure
/// and retried into a third path.
fn replay_receipt(sale: &oz_core::Sale) -> CompleteSaleResult {
    CompleteSaleResult {
        sale_id: sale.id.clone(),
        total: Some(sale.total),
        line_count: sale.lines.len(),
    }
}

/// Decide whether a submission replays an already-completed attempt.
///
/// The caller cannot supply the sale id — the response that carried it is
/// the very thing that was lost — so the attempt key is the only handle back
/// to the original sale. Resolving it BEFORE any write is what makes a replay
/// return a receipt instead of an error, and specifically before the cart is
/// consumed: a retry that deleted a live cart would strand the basket the
/// customer is still looking at.
///
/// A match is trusted as THIS request's receipt only when it can be tied to
/// the request's own basket:
///
/// - a settlement re-keyed for this exact cart (`{attempt}:rekey:{cart}:0`)
///   is provably this basket's, so it wins over the base key;
/// - the base key `{attempt}:0` answers only while the request's cart is
///   already consumed; if that cart still exists the matched sale belongs to
///   a DIFFERENT basket — a key collision, refused loudly rather than
///   silently re-keyed, because a silent re-key is what orphans receipts;
/// - a VOIDED sale satisfies no replay.
///
/// Only the first split's key is consulted: every key of one attempt maps to
/// the same sale.
fn replay_verdict(
    store: &Store,
    attempt_id: Option<&str>,
    request_cart_id: Option<&CartId>,
) -> Result<ReplayVerdict, AppError> {
    let Some(attempt) = attempt_id else {
        return Ok(ReplayVerdict::Fresh);
    };
    // Step 1 — a settlement re-keyed for this exact basket is unambiguous.
    if let Some(cart_id) = request_cart_id {
        let rekey_key = format!("{attempt}:rekey:{cart_id}:0");
        if let Some(sale_id) = store.find_sale_by_idempotency_key(&rekey_key)? {
            let sale = store.get_sale(&sale_id)?.ok_or_else(|| {
                AppError::Internal("re-keyed payment points at a missing sale".into())
            })?;
            if sale.status == SaleStatus::Voided {
                return Err(AppError::Invalid(format!(
                    "checkout attempt {attempt} for this basket was already settled and then voided — start a new checkout"
                )));
            }
            return Ok(ReplayVerdict::Replayed(replay_receipt(&sale)));
        }
    }
    // Step 2 — the attempt's own first-split key.
    let Some(sale_id) = store.find_sale_by_idempotency_key(&format!("{attempt}:0"))? else {
        return Ok(ReplayVerdict::Fresh);
    };
    let sale = store
        .get_sale(&sale_id)?
        .ok_or_else(|| AppError::Internal("replayed payment points at a missing sale".into()))?;
    // A voided sale took no money and returned its stock: it must not block
    // this settlement either, because its key is taken.
    if sale.status == SaleStatus::Voided {
        let Some(cart_id) = request_cart_id else {
            return Err(AppError::Invalid(format!(
                "checkout attempt {attempt} was voided and no cart was supplied — start a new checkout"
            )));
        };
        return Ok(ReplayVerdict::Rekey(format!("{attempt}:rekey:{cart_id}")));
    }
    // Key equality is not basket identity: while the request's cart still
    // exists, the matched sale belongs to a DIFFERENT basket. Refuse loudly.
    if let Some(cart_id) = request_cart_id
        && store.load_active_cart(cart_id)?.is_some()
    {
        return Err(AppError::Invalid(format!(
            "checkout attempt {attempt} already completed a different basket (sale {sale_id}) — cancel and start a new checkout"
        )));
    }
    Ok(ReplayVerdict::Replayed(replay_receipt(&sale)))
}

/// What one guarded settlement produced.
struct SaleSettlement {
    /// The receipt to hand back to the client — original sale id on a replay.
    result: CompleteSaleResult,
    /// `Some` only when THIS call created the sale. `None` means the
    /// submission replayed an existing one, so the caller must publish
    /// nothing: the domain event already fired with the original sale.
    sale: Option<oz_core::Sale>,
}

#[command]
/// Complete sale.
pub async fn complete_sale(
    args: CompleteSaleArgs,
    state: State<'_, AppState>,
) -> Result<CompleteSaleResult, AppError> {
    // Load and remove the cart from the DB in one scope.
    let cart = {
        let db = state.db.lock().await;
        let store = Store::new(&db);

        require_permission_for_user(&store, &args.user_id, oz_core::permissions::SALES_PROCESS)?;

        // §B read-only lock: a lapsed grace window rejects new sales.
        let sub = oz_core::TenantSubscription::load(&db, "default")?
            .ok_or_else(|| AppError::Internal("default tenant subscription not found".into()))?;
        sub.verify_signature()?;
        sub.enforce_pos_writable()?;

        let cart = store
            .load_active_cart(&args.cart_id)?
            .ok_or_else(|| AppError::Invalid(format!("cart not found: {}", args.cart_id)))?;
        store.delete_active_cart(&args.cart_id)?;
        cart
    };

    let line_count = cart.line_count();

    let mut sale = oz_core::Sale::from_cart_with_user(&cart, Some(args.user_id))
        .ok_or_else(|| AppError::Invalid("cart total overflowed i64".into()))?;
    sale.payment_method = Some(args.payment_method);
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

    // Scope the DB borrow so Store (which is !Send) is dropped before
    // the next .await point when we lock the kernel for event publishing.
    let updated = {
        let db = state.db.lock().await;
        let store = Store::new(&db);
        // Deliberately the UNSCOPED door. This is the legacy `complete_sale`
        // with no session token — it writes `store_id: None` on the event below,
        // so there is no location to resolve against and inventing one would be
        // worse than admitting the gap: no location known, tenant-global rate.
        // Every `*_scoped` command in this file passes a real scope.
        store.compute_sale_tax(
            &mut sale,
            &[],
            oz_core::Settings::get_tax_rounding_mode(&db)?,
        )?;

        // Match serial numbers from args to sale lines by SKU.
        if let Some(ref serial_numbers) = args.serial_numbers {
            for sn in serial_numbers {
                if let Some(line) = sale.lines.iter_mut().find(|l| l.sku == sn.sku) {
                    line.serial_number = Some(sn.serial.clone());
                }
            }
        }

        store.create_sale(&sale)?;
        // Transition through Active before Completed — the state machine
        // does not allow Pending → Completed directly.
        store.update_sale_status(&sale_id, SaleStatus::Active)?;
        store.update_sale_status(&sale_id, SaleStatus::Completed)?
    };

    let total = cart.total();
    tracing::info!(%sale_id, ?total, line_count, "sale completed and persisted");

    // Publish the SaleCompleted domain event so that subscribers
    // (InventoryStockHandler, AuditLogHandler, etc.) fire their side
    // effects. Customer spend/loyalty projections are NOT event-driven:
    // they are written atomically inside the completion transaction
    // (CRM-06/LOY-06) — the old CrmHistoryHandler (non-idempotent,
    // currency-blind) was unsubscribed in platform/startup.
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
            store_id: None,
            line_items,
            total_minor: total.map(|m| m.minor_units).unwrap_or(0),
            currency: String::from_utf8_lossy(&sale.currency.0).into_owned(),
            customer_id: args.customer_id.clone(),
        };

        let kernel = state.kernel.lock().await;
        let bus = kernel.event_bus();
        if let Err(e) = bus.publish(&event) {
            // Logged by the bus; do not fail the command.
            tracing::warn!(%sale_id, error = %e, "event bus publish failed");
        }
    }

    Ok(CompleteSaleResult {
        sale_id: updated.id,
        total,
        line_count,
    })
}

/// Args for `complete_sale_scoped` — without `user_id`.
///
/// `deny_unknown_fields` is deliberate: the absence of it is what let the
/// shipped UI's `attemptId` vanish silently on the tablet while looking
/// guarded. Every field the wire can carry is listed here, field-for-field
/// against `ui/src/api/sales.ts::CompleteSaleScopedArgs` (15 fields) and
/// both senders in `ui/src/features/sales/PaymentModal.tsx` (the main path
/// and the QRIS path, whose extra spread is `tenderSnapshot` — tip, service
/// charge and the three CUR-02 fields, all present below). An unknown key
/// now fails loudly instead of being dropped.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompleteSaleScopedArgs {
    /// ID of the associated cart.
    pub cart_id: CartId,
    /// Payment Method.
    pub payment_method: String,
    /// Tendered Minor.
    pub tendered_minor: Option<i64>,
    /// Customer ID.
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
    /// the post-tax sale. Each reduces the payable total (stacking) and
    /// the application rows persist inside the checkout transaction;
    /// payment splits are validated against the reduced total.
    pub promotion_ids: Option<Vec<String>>,
    /// COR-7: identifies one checkout attempt. Every submission of the same
    /// attempt (first tap, shortfall retry, re-tap after a lost response)
    /// carries the same value, so a replay returns the receipt that already
    /// exists instead of ringing up a second sale. Absent, empty or
    /// whitespace-only means no guard.
    ///
    /// The shipped UI already sends this (`ui/src/features/sales/PaymentModal.tsx`,
    /// `attemptId`); before this field existed the tablet DTO silently dropped it,
    /// which made the tablet look guarded and left it unprotected.
    pub attempt_id: Option<String>,
    /// F2-6: the client's claim that the displayed tax was an ESTIMATE (tax
    /// cache stale/unknown at checkout). Core verifies by computing the tax
    /// itself and stamps claim + computed tax into `sales.tax_estimate_note`
    /// (D61 ruling 4: flag for recompute, never silent). Absent/false is
    /// the zero-change default: no stamp.
    pub tax_estimated: Option<bool>,
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
/// against the reduced total). Runs the same cart → sale → tax → engine
/// sequence as [`complete_sale_scoped`] but consumes no cart and writes
/// no rows; the authoritative computation still happens inside the
/// checkout call, which re-validates the splits against the freshly
/// computed total.
#[command]
pub async fn preview_promoted_total_scoped(
    session_token: String,
    args: PreviewPromotedTotalArgs,
    state: State<'_, AppState>,
) -> Result<PreviewPromotedTotalResult, AppError> {
    let session = state.resolve_session(&session_token)?;

    // ── Lock 1: peek the cart (do NOT delete it) ──────────────────
    let (cart, rounding_mode) = {
        let db = state.db.lock().await;
        let store = Store::new(&db);
        require_permission_for_user(
            &store,
            &session.user_id,
            oz_core::permissions::SALES_PROCESS,
        )?;
        let cart = store
            .load_active_cart(&args.cart_id)?
            .ok_or_else(|| AppError::Invalid(format!("cart not found: {}", args.cart_id)))?;
        let rounding_mode = oz_core::Settings::get_tax_rounding_mode(&db)?;
        (cart, rounding_mode)
    };

    let mut sale = oz_core::Sale::from_cart(&cart)
        .ok_or_else(|| AppError::Invalid("cart total overflowed i64".into()))?;

    // ── Lock 2: tax + engine discounts (no writes) ────────────────
    let (base_total_minor, discounts) = {
        let db = state.db.lock().await;
        let store = Store::new(&db);
        store.compute_sale_tax_for_location(
            &mut sale,
            &[],
            rounding_mode,
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
/// from the caller's lines (no plugin tax overrides — the tablet checkout
/// path applies none either); the authoritative computation still happens
/// inside the checkout call, which re-validates the splits against the
/// freshly computed total.
#[command]
pub async fn preview_promoted_total_from_lines_scoped(
    session_token: String,
    args: PreviewPromotedTotalFromLinesArgs,
    state: State<'_, AppState>,
) -> Result<PreviewPromotedTotalResult, AppError> {
    let session = state.resolve_session(&session_token)?;

    let cart = build_preview_cart(&args.lines, args.discount_percent)?;
    let mut sale = oz_core::Sale::from_cart(&cart)
        .ok_or_else(|| AppError::Invalid("cart total overflowed i64".into()))?;

    // ── Lock: permission + tax + engine discounts (no writes) ─────
    let (base_total_minor, discounts) = {
        let db = state.db.lock().await;
        let store = Store::new(&db);
        require_permission_for_user(
            &store,
            &session.user_id,
            oz_core::permissions::SALES_PROCESS,
        )?;
        store.compute_sale_tax_for_location(
            &mut sale,
            &[],
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

/// Complete one guarded checkout attempt against the store connection.
///
/// Split out of the `#[command]` wrapper (the house `run_*` seam this file
/// already uses for `run_add_line_scoped` and friends) so the replay guard
/// and the cart consumption can be driven from a test with a plain
/// `Connection` — the command itself needs a Tauri `State`, a session token
/// and an event bus.
///
/// The order inside is the whole point:
/// 1. permission check;
/// 2. the COR-7 replay lookup;
/// 3. only then the cart read and its deletion;
/// 4. tax, promotions, split stamping and the deduction, under the one lock
///    the caller holds.
///
/// A replay therefore returns at step 2 with the original receipt and has
/// already deleted nothing — a retried tap cannot consume a live cart.
/// Steps 2-4 share a single lock so two concurrent submits carrying one key
/// serialise: the loser sees the winner's stamped key and answers with the
/// winner's sale (the UNIQUE index on `payments.idempotency_key` is the back
/// stop when a second process is involved).
fn run_complete_sale_scoped(
    db: &rusqlite::Connection,
    session: &SessionContext,
    args: &CompleteSaleScopedArgs,
) -> Result<SaleSettlement, AppError> {
    let store = Store::new(db);

    require_permission_for_user(
        &store,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )?;

    // ── COR-7 replay guard — BEFORE any write, including the cart ──
    let attempt = normalized_attempt_id(args.attempt_id.as_deref());
    let mut effective_attempt_id = attempt.clone();
    match replay_verdict(&store, attempt.as_deref(), Some(&args.cart_id))? {
        ReplayVerdict::Replayed(receipt) => {
            tracing::info!(
                sale_id = %receipt.sale_id,
                "tablet checkout replayed an existing attempt — returning the original receipt"
            );
            return Ok(SaleSettlement {
                result: receipt,
                sale: None,
            });
        }
        ReplayVerdict::Fresh => {}
        ReplayVerdict::Rekey(rekey_stem) => {
            // The key's sale was VOIDED: it took no money and returned its
            // stock, so it must not block this settlement. Re-key
            // deterministically from (attempt, cart) so a retry of THIS
            // submission finds its own receipt instead of an older one.
            tracing::warn!(
                "replay attempt id points at a voided sale — stamping a deterministic re-key"
            );
            effective_attempt_id = Some(rekey_stem);
        }
    }

    let cart = store
        .load_active_cart(&args.cart_id)?
        .ok_or_else(|| AppError::Invalid(format!("cart not found: {}", args.cart_id)))?;
    store.delete_active_cart(&args.cart_id)?;

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

    store.compute_sale_tax_for_location(
        &mut sale,
        &[],
        oz_core::Settings::get_tax_rounding_mode(db)?,
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
    // the same attempt reproduces exactly these rows instead of a second
    // sale. No attempt id, no keys — the unguarded path stays NULL-stamped.
    stamp_attempt_split_keys(effective_attempt_id.as_deref(), &mut splits);

    // Same primary-location resolution the legacy complete_sale_deduction
    // wrapper performs internally — routed through with_locations so
    // checkout promotions persist.
    let primary = oz_core::location_resolver::resolve_primary_location(
        db,
        session.instance_id.as_str(),
        None,
    )
    .unwrap_or_else(|_| oz_core::location_resolver::get_default_location_id());
    store.complete_sale_deduction_with_locations_and_estimate(
        &sale,
        Some(&session.instance_id),
        &[primary],
        &splits,
        &session.user_id,
        Some(&session.terminal_id),
        &checkout_applications,
        args.tax_estimated.unwrap_or(false),
    )?;

    // Promotion-reduced payable (cart.total() would ignore promotions).
    let result = CompleteSaleResult {
        sale_id: sale.id.clone(),
        total: Some(sale.total),
        line_count,
    };
    tracing::info!(
        sale_id = %result.sale_id,
        total = ?result.total,
        line_count,
        store_id = %session.store_id,
        "sale completed (scoped)"
    );
    Ok(SaleSettlement {
        result,
        sale: Some(sale),
    })
}

/// Complete a sale within the session scope. ADR #7 / ADR-19 §6.
///
/// Uses the `complete_sale_deduction` path which checks stock at the
/// resolved deduction location, performs per-location deduction, and
/// writes `deduction_locations` JSON on the sale row.
/// Returns `PartialStockResult` as an error when stock is insufficient.
///
/// COR-7: `args.attempt_id` makes the call idempotent — see
/// [`run_complete_sale_scoped`] for the guard and its ordering rules.
#[command]
pub async fn complete_sale_scoped(
    session_token: String,
    args: CompleteSaleScopedArgs,
    state: State<'_, AppState>,
) -> Result<CompleteSaleResult, AppError> {
    let session = state.resolve_session(&session_token)?;

    // §B read-only lock: a lapsed grace window rejects new sales.
    {
        let db = state.db.lock().await;
        let sub = oz_core::TenantSubscription::load(&db, "default")?
            .ok_or_else(|| AppError::Internal("default tenant subscription not found".into()))?;
        sub.verify_signature()?;
        sub.enforce_pos_writable()?;
    }

    // One lock covers the replay lookup AND the settlement, so a double-tap
    // cannot have both requests pass the guard before either writes.
    let settlement = {
        let db = state.db.lock().await;
        run_complete_sale_scoped(&db, &session, &args)?
    };
    let CompleteSaleResult {
        sale_id,
        total,
        line_count,
    } = settlement.result;

    // A replay wrote nothing, so it must publish nothing: the domain event
    // already fired with the original sale, and firing it twice would deduct
    // stock and re-credit customer spend for one payment.
    let Some(sale) = settlement.sale else {
        return Ok(CompleteSaleResult {
            sale_id,
            total,
            line_count,
        });
    };

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

// ── Compute Cart Tax ──────────────────────────────────────────────────

/// Compute tax within the session scope. ADR #7.
#[command]
pub async fn compute_cart_tax_scoped(
    session_token: String,
    lines: Vec<oz_core::db::CartLineTaxInput>,
    currency: String,
    state: State<'_, AppState>,
) -> Result<oz_core::db::CartTaxResult, AppError> {
    let session = state.resolve_session(&session_token)?;
    let parsed: oz_core::Currency = currency
        .parse()
        .map_err(|_| AppError::Invalid(format!("invalid currency code: {currency}")))?;
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(
        &store,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )?;
    let tax = store.compute_cart_tax_for_location(
        &lines,
        parsed,
        oz_core::Settings::get_tax_rounding_mode(&db)?,
        Some(&tax_scope_now(&store, &session.store_id)),
    )?;
    drop(db);
    Ok(tax)
}

// ── Complete Sale With Resolved Shortfalls ───────────────────────────

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
///
/// `deny_unknown_fields` for the same reason as [`CompleteSaleScopedArgs`]:
/// enumerated field-for-field against
/// `ui/src/api/sales.ts::CompleteSaleWithResolvedShortfallsArgs` (20 fields),
/// whose only sender is `ui/src/features/sales/StockShortfallDialog.tsx`.
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
    /// Cart line data reconstructed by the frontend.
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
    /// the post-tax sale (see `CompleteSaleScopedArgs::promotion_ids`).
    pub promotion_ids: Option<Vec<String>>,
    /// COR-7: the SAME attempt id the original `complete_sale_scoped`
    /// submission carried, so this second command of the two-command flow
    /// settles under the same keys and a retry of it replays instead of
    /// re-selling. Absent, empty or whitespace-only means no guard.
    pub attempt_id: Option<String>,
}

/// Complete a sale with cashier-resolved shortfalls (split fulfillment).
///
/// This is the second command in the two-command flow (ADR-19 §6b).
/// After `complete_sale_scoped` returns a `PartialStockResult` error,
/// the cashier resolves shortfalls via the Stock Shortfall dialog.
/// This command re-checks stock at the resolved locations and deducts
/// accordingly.
#[command]
pub async fn complete_sale_with_resolved_shortfalls_scoped(
    session_token: String,
    args: CompleteSaleWithResolvedShortfallsArgs,
    state: State<'_, AppState>,
) -> Result<CompleteSaleResult, AppError> {
    let session = state.resolve_session(&session_token)?;

    // §B read-only lock: a lapsed grace window rejects new sales.
    {
        let db = state.db.lock().await;
        let sub = oz_core::TenantSubscription::load(&db, "default")?
            .ok_or_else(|| AppError::Internal("default tenant subscription not found".into()))?;
        sub.verify_signature()?;
        sub.enforce_pos_writable()?;
    }

    // ── COR-7 replay guard — before any write ────────────────────────
    // This is the path the guard matters most on: the command rebuilds its
    // cart from the request body and carries a synthetic `resolved-<ts>`
    // cart id, so unlike `complete_sale_scoped` it has no cart to run out of
    // and would otherwise re-sell the same basket on every retry.
    let attempt = normalized_attempt_id(args.attempt_id.as_deref());
    let mut effective_attempt_id = attempt.clone();
    {
        let db = state.db.lock().await;
        match replay_verdict(&Store::new(&db), attempt.as_deref(), Some(&args.cart_id))? {
            ReplayVerdict::Replayed(receipt) => {
                tracing::info!(
                    sale_id = %receipt.sale_id,
                    "shortfall retry replayed an existing attempt — returning the original receipt"
                );
                return Ok(receipt);
            }
            ReplayVerdict::Fresh => {}
            ReplayVerdict::Rekey(rekey_stem) => {
                tracing::warn!(
                    "replay attempt id points at a voided sale — stamping a deterministic re-key"
                );
                effective_attempt_id = Some(rekey_stem);
            }
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
        let db = state.db.lock().await;
        let store = Store::new(&db);

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
        // COR-7: one key per split from the attempt id, so a retry of this
        // submission resolves back to the sale it already created.
        stamp_attempt_split_keys(effective_attempt_id.as_deref(), &mut splits);

        store.complete_sale_with_resolved_shortfalls(
            &sale,
            Some(&session.instance_id),
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

fn default_bill_type() -> String {
    "hold".to_string()
}

#[derive(Debug, Serialize)]
/// Holdcartresult.
pub struct HoldCartResult {
    /// Unique identifier.
    pub id: String,
}

/// Park the current sale as a held order.
#[command]
pub async fn hold_cart(
    args: HoldCartArgs,
    state: State<'_, AppState>,
) -> Result<HoldCartResult, AppError> {
    let db = state.db.lock().await;
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
    tracing::info!(held_cart_id = %id, label = %args.label, "cart held");
    Ok(HoldCartResult { id })
}

/// Park the current sale as a held order (scoped).
#[command]
pub async fn hold_cart_scoped(
    session_token: String,
    args: HoldCartArgs,
    state: State<'_, AppState>,
) -> Result<HoldCartResult, AppError> {
    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(
        &store,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )?;
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

/// List all held (parked) orders, most recent first.
#[command]
pub async fn list_held_carts(
    state: State<'_, AppState>,
) -> Result<Vec<oz_core::db::HeldCartRow>, AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    let carts = store.list_held_carts()?;
    drop(db);
    Ok(carts)
}

/// List held carts in the session scope. ADR #7.
#[command]
pub async fn list_held_carts_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<oz_core::db::HeldCartRow>, AppError> {
    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(
        &store,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )?;
    let carts = store.list_held_carts()?;
    drop(db);
    Ok(carts)
}

/// List open bills (bill_type = 'open_bill'), most recent first.
#[command]
pub async fn list_open_bills(
    state: State<'_, AppState>,
) -> Result<Vec<oz_core::db::HeldCartRow>, AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    let carts = store.list_open_bills()?;
    drop(db);
    Ok(carts)
}

/// List open bills in the session scope. ADR #7.
#[command]
pub async fn list_open_bills_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<oz_core::db::HeldCartRow>, AppError> {
    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(
        &store,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )?;
    let carts = store.list_open_bills()?;
    drop(db);
    Ok(carts)
}

/// Resume a held cart by id.
#[command]
pub async fn get_held_cart(
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<oz_core::db::HeldCartFull>, AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    let cart = store.get_held_cart(&id)?;
    drop(db);
    Ok(cart)
}

/// Resume a held cart in the session scope. ADR #7.
#[command]
pub async fn get_held_cart_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<oz_core::db::HeldCartFull>, AppError> {
    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(
        &store,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )?;
    let cart = store.get_held_cart(&id)?;
    drop(db);
    Ok(cart)
}

/// Delete a held cart by id.
#[command]
pub async fn delete_held_cart(id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    store.delete_held_cart(&id)?;
    drop(db);
    tracing::info!(held_cart_id = %id, "held cart deleted");
    Ok(())
}

/// Delete a held cart in the session scope. ADR #7.
#[command]
pub async fn delete_held_cart_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(
        &store,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )?;
    store.delete_held_cart(&id)?;
    drop(db);
    tracing::info!(held_cart_id = %id, "held cart deleted (scoped)");
    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "pos_tests.rs"]
mod tests;
