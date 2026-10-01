/*
last audited 25-07-26 by RSA-Agent (mobile-tauri slice A: pos head+sweep)
crate: kasirmu-mobile | status: SAFE | lint: CLEAN
findings: sweep + guard sites verified — both Percentage::new unwraps (lines 57, 100) preceded by explicit 0..=100 range checks with SAFETY comments; authz decorators present; cart/sale state machine lives in kasirmu_core (audited). Coverage note: risk-ranked sampling, not full deep read
next: none | perf: N/A
*/
//! Point-of-Sale pipeline commands: start a cart, add a line,
//! complete the sale, hold/resume carts.
//!
//! These commands are the IPC surface for the POS screen. The actual
//! cart/sale state machine lives in `kasirmu_core`; this file translates
//! between the Tauri argument structs and the domain types.
//!
//! Carts are persisted in the SQLite `active_carts` table so they
//! survive application restarts.
//!
//! Checkout is idempotent per attempt (COR-7): `complete_sale_scoped` and
//! `complete_sale_with_resolved_shortfalls_scoped` read a client-supplied
//! `attempt_id`, treat it as an opaque key, stamp every payment split as
//! `{attempt}:{index}` and answer a replay with the original receipt. The
//! rules are copied from `crates/kasirmu-bridge/src/pos.rs`, which this forked
//! command layer cannot import — keep the two in step.

use tauri::{State, command};

use foundation::Percentage;
use kasirmu_core::db::Store;

use kasirmu_core::location_resolver;
use kasirmu_core::session::SessionContext;
use kasirmu_core::{Cart, CartId, CartLine, Currency, Money, PaymentSplitArg};

use crate::commands::authz::require_permission_for_user;
use crate::error::AppError;
use crate::state::AppState;

// Phase 3.3 T4: the wire DTOs below moved to the shared `kasirmu_bridge::pos`
// module (Agent 2's Wave D extraction) and are re-exported here, same as
// the desktop shell — one wire definition across both shells, ending the
// "keep the two in step" fork burden this header used to carry. The
// CompleteSale pair inherits the tablet's `deny_unknown_fields` hardening
// (now ported INTO the bridge DTOs so every shell fails loudly on an
// unknown key instead of silently dropping it — the incident that let
// `attemptId` vanish). The unscoped `CompleteSaleArgs` gains the two
// fields its fork had lost (`payment_splits`, `promotion_ids`); the
// unscoped command is not registered on this shell, so the wire is
// unwitnessed either way. The command bodies stay tablet-native (no
// BridgeCtx yet — see the T2 seam notes in void.rs).
pub use kasirmu_bridge::pos::{
    AddLineArgs, AddLineResult, BILL_TYPE_OPEN_BILL, CartLineData, CompleteSaleArgs,
    CompleteSaleResult, CompleteSaleScopedArgs, CompleteSaleWithResolvedShortfallsArgs,
    DeductionLocationInfo, HoldCartArgs, HoldCartResult, OverrideLinePriceArgs,
    OverrideLinePriceScopedArgs, PreviewLineArgs, PreviewPromotedTotalArgs,
    PreviewPromotedTotalFromLinesArgs, PreviewPromotedTotalResult, PreviewPromotionDiscount,
    PublishCourseFiredArgs, PublishCourseFiredItem, SerialNumberArg, SetCartDiscountArgs,
    SetCartDiscountScopedArgs, SetLineCourseArgs, StartSaleArgs, StartSaleResult,
    is_restaurant_pos_workspace,
};

/// The tax scope for a sale rung up at `location_id` right now.
///
/// Mirrors the desktop helper of the same name; see
/// `apps/desktop-tauri/src/commands/pos.rs` for why `as_of` is the UTC
/// calendar date and why that is a recorded compromise rather than the answer
/// (`locations.timezone` IANA-vs-offset is regional open question 1, so a
/// locally-correct business date is not available yet). UTC is what
/// `sale.created_at` already records, which keeps a cart preview and its
/// checkout receipt resolving on the same side of an exclusive `effective_to`.
fn tax_scope_now(store: &Store, location_id: &str) -> kasirmu_core::TaxSaleScope {
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

// ── Discount ─────────────────────────────────────────────────────────

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
        kasirmu_core::permissions::SALES_DISCOUNT,
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
    let currency: kasirmu_core::Currency = currency_str
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
        kasirmu_core::permissions::SALES_PROCESS,
    )?;

    // Resolve the primary deduction location for this workspace instance.
    //
    // PROPAGATES. The earlier `.unwrap_or_else(|_| get_default_location_id())` had
    // a consequence worse than a wrong value here: the next line LOCKS this on the
    // cart row (`save_active_cart(.., Some(deduction_location_id))`), so a failed
    // resolve would persist the canonical default as the cart's deduction location
    // for its whole lifetime — every subsequent deduction for that cart landing in
    // the wrong place, with no error ever surfacing at the till.
    //
    // A failed resolve means the workspace's binding could NOT BE READ, which is
    // not the same as a workspace with no binding: `resolve_primary_location`
    // already returns tier 4 (the canonical default) for that genuine case, so this
    // arm is only ever reached on an error. Same rule as the four bridge callers and
    // the two core callers fixed in 5a931d80f.
    let deduction_location_id =
        location_resolver::resolve_primary_location(&db, &session.instance_id, None)?;

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
        kasirmu_core::permissions::SALES_PROCESS,
    )?;
    let ids = store.list_active_carts()?;
    drop(db);
    Ok(ids)
}

// ── Get Active Cart ──────────────────────────────────────────────────

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
        kasirmu_core::permissions::SALES_PROCESS,
    )?;
    let cart = store.load_active_cart(&cart_id)?;
    drop(db);
    Ok(cart)
}

// ── Add Line ─────────────────────────────────────────────────────────

/// Resolve the unit price for an `add_line_scoped` request (FRONTEND-03).
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

    require_permission_for_user(&store, user_id, kasirmu_core::permissions::SALES_PROCESS)?;

    // ADR-19 §5.1: reject add_line_scoped when the cart has no deduction location lock.
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
        kasirmu_core::permissions::SALES_OVERRIDE_PRICE,
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

// ── Set Line Course ────────────────────────────────────────────────

/// Assign (or clear) the restaurant course on an active cart line. ADR #7.
///
/// Delegated to `kasirmu_bridge::pos::run_set_line_course_unchecked` so the
/// cart mutation stays in one place; the `SALES_PROCESS` gate runs here,
/// ahead of the bridge body (same order as the price-override command).
#[command]
pub async fn set_line_course_scoped(
    session_token: String,
    args: SetLineCourseArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(
        &store,
        &session.user_id,
        kasirmu_core::permissions::SALES_PROCESS,
    )?;
    kasirmu_bridge::pos::run_set_line_course_unchecked(
        &db,
        &args.cart_id,
        &args.line_id,
        args.course.as_deref(),
    )
    .map_err(Into::into)
}

// ── Publish Course Fired ───────────────────────────────────────────

/// Publish one fired course for a completed sale. ADR #7.
///
/// Thin shell over `kasirmu_bridge::pos::publish_course_fired_scoped`, which
/// resolves the session, gates on `SALES_PROCESS`, and publishes
/// `order.course_fired`. The tablet kernel carries the bus, so the publish
/// lands there; the LAN forward remains desktop-only (no kasirmu-lan dep here).
#[command]
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

// ── Get Cart Deduction Location ───────────────────────────────────────

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
/// does, and as `desktop-tauri`'s `get_cart_deduction_location_scoped` already does.
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
/// `desktop-tauri` has registered this command since the ADR #7 sweep; tablet never did, and the
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

    require_permission_for_user(
        &store,
        user_id,
        kasirmu_core::permissions::SALES_OVERRIDE_PRICE,
    )?;

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

pub mod checkout;
// `#[tauri::command]` generates hidden `__cmd__*` and `__tauri_command_name_*`
// items beside each command, and `tauri::generate_handler!` in `lib.rs` expands
// `commands::pos::complete_sale_scoped` into a reference to them. A name-list
// `pub use` re-exports only the function, so the generated items would stay
// invisible and the macro would fail with `cannot find __cmd__...`. The glob
// carries them.
pub use checkout::*;
// The COR-7 helpers are module-private (`pub(super)`), so the glob above does not
// carry them; the hold-order and shortfall commands below call them directly.
use checkout::{
    ReplayVerdict, SaleSettlement, normalized_attempt_id, replay_verdict, stamp_attempt_split_keys,
};

// ── Compute Cart Tax ──────────────────────────────────────────────────

/// Compute tax within the session scope. ADR #7.
#[command]
pub async fn compute_cart_tax_scoped(
    session_token: String,
    lines: Vec<kasirmu_core::db::CartLineTaxInput>,
    currency: String,
    state: State<'_, AppState>,
) -> Result<kasirmu_core::db::CartTaxResult, AppError> {
    let session = state.resolve_session(&session_token)?;
    let parsed: kasirmu_core::Currency = currency
        .parse()
        .map_err(|_| AppError::Invalid(format!("invalid currency code: {currency}")))?;
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(
        &store,
        &session.user_id,
        kasirmu_core::permissions::SALES_PROCESS,
    )?;
    let tax = store.compute_cart_tax_for_location(
        &lines,
        parsed,
        kasirmu_core::Settings::get_tax_rounding_mode(&db)?,
        Some(&tax_scope_now(&store, &session.store_id)),
    )?;
    drop(db);
    Ok(tax)
}

// ── Complete Sale With Resolved Shortfalls ───────────────────────────

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

/// The write half of `complete_sale_with_resolved_shortfalls_scoped`:
/// cart rebuild from the request body, tax, promotions, split stamping, the
/// settlement write, and the UNIQUE-index replay conversion. The caller MUST
/// have run the replay guard under the SAME db lock — the lock is what
/// closes the same-process double-tap; this fn is deliberately guard-free so
/// the tests can model the cross-process window where the guard read raced
/// the winner's commit.
fn settle_shortfall_resolved(
    db: &rusqlite::Connection,
    session: &SessionContext,
    args: &CompleteSaleWithResolvedShortfallsArgs,
    attempt_id: Option<&str>,
    effective_attempt_id: Option<&str>,
) -> Result<SaleSettlement, AppError> {
    let store = Store::new(db);

    // ── Reconstruct the Cart from front-end line data ─────────────
    let currency: kasirmu_core::Currency = args
        .currency
        .parse()
        .map_err(|_| AppError::Invalid(format!("invalid currency code: {}", args.currency)))?;

    let mut cart = kasirmu_core::Cart::new(currency);
    for line_data in &args.lines {
        let unit_price = shortfall_line_unit_price(line_data, cart.currency())?;
        let line = kasirmu_core::CartLine::new(
            kasirmu_core::Sku::new(&line_data.sku),
            line_data.qty,
            unit_price,
        );
        cart.add_line(line)
            .map_err(|e| AppError::Invalid(e.to_string()))?;
    }

    // Apply discount if configured.
    //
    // Clamped through the bridge helper, NOT `args.discount_percent as u8`. The
    // bare cast truncates, and this is the SHORTFALL door -- the one the bridge's
    // own test was written about: `preview_and_shortfall_doors_treat_a_high_
    // discount_percent_identically` records that this door once cast raw while the
    // preview door clamped, so 300 previewed at 100% and charged at 44%, and 256
    // truncated to 0 and DROPPED the discount entirely. The bridge is fixed
    // (pos/checkout.rs:404 routes through `checkout_discount_percent`); this copy
    // of the same door was not, so the tablet and the desktop disagreed for every
    // wire value above 100.
    //
    // Measured: bridge 101/128/200/256/300/357/511/512 all resolve to 100; this
    // cast resolved them to 101/128/200/0/44/101/255/0. The `> 0` guard and
    // `Percentage::new`'s own rejection make every value at or below 100 agree, so
    // only the out-of-range band differed -- and 256 silently discarding the whole
    // discount is the case that costs the store the money.
    if args.discount_percent > 0
        && let Some(pct) = foundation::Percentage::new(
            kasirmu_bridge::pos::checkout_discount_percent(args.discount_percent) as u8,
        )
    {
        cart.set_discount(pct, args.discount_label.clone());
    }

    let line_count = cart.line_count();

    let mut sale = kasirmu_core::Sale::from_cart_with_user(&cart, Some(session.user_id.clone()))
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
        kasirmu_core::Settings::get_tax_rounding_mode(db)?,
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
    stamp_attempt_split_keys(effective_attempt_id, &mut splits);

    match store
        .complete_sale_with_resolved_shortfalls(
            &sale,
            Some(&session.instance_id),
            &splits,
            &session.user_id,
            Some(&session.terminal_id),
            &args.resolutions,
            &checkout_applications,
        )
        .map_err(AppError::from)
    {
        Ok(_) => Ok(SaleSettlement {
            result: CompleteSaleResult {
                sale_id: sale.id.clone(),
                total: Some(sale.total),
                line_count,
            },
            sale: Some(sale),
        }),
        Err(e) => {
            // The re-lookup runs by the BASE attempt id (not the re-key
            // stem): `replay_verdict` consults the re-keyed key itself, so
            // the base id resolves a winner settled under either stamping.
            let receipt = replay_on_unique_collision(&store, attempt_id, Some(&args.cart_id), e)?;
            Ok(SaleSettlement {
                result: receipt,
                sale: None,
            })
        }
    }
}

/// Convert a lost cross-process idempotency race into a replay receipt.
///
/// The UNIQUE index on `payments.idempotency_key` is the only guard that
/// spans processes (`state.rs`'s tokio Mutex is process-local and no
/// single-instance guard exists), so a loser that passed the replay guard
/// before the winner committed still reaches the settlement write and fails
/// with `UNIQUE constraint failed: payments.idempotency_key`. Surfacing
/// that as a Db error turns a double-tap into a failed-checkout toast — the
/// exact failure the replay design exists to eliminate — so the collision is
/// converted: the replay lookup is re-run by the attempt stem and, when it
/// resolves to a COMPLETED sale, the winner's receipt is returned exactly as
/// the `Replayed` verdict does, publishing nothing extra.
///
/// Absorbed: only a Db UNIQUE violation on the stamped idempotency key whose
/// re-lookup resolves to a completed sale. NOT absorbed: any other error
/// kind, any other UNIQUE violation, and a collision whose re-lookup comes
/// back `Fresh` (the collided key belongs to something this attempt cannot
/// name — returning a receipt would mean handing back a stranger's sale) or
/// `Rekey` (the winner was voided; re-settling would need the re-key dance,
/// so the original error propagates unchanged).
fn replay_on_unique_collision(
    store: &Store,
    attempt_id: Option<&str>,
    request_cart_id: Option<&CartId>,
    err: AppError,
) -> Result<CompleteSaleResult, AppError> {
    let AppError::Core {
        sub_kind: kasirmu_core::CoreErrorKind::Db,
        message,
    } = &err
    else {
        return Err(err);
    };
    if !(message.contains("UNIQUE constraint failed") && message.contains("idempotency_key")) {
        return Err(err);
    }
    match replay_verdict(store, attempt_id, request_cart_id)? {
        ReplayVerdict::Replayed(receipt) => {
            tracing::info!(
                sale_id = %receipt.sale_id,
                "settlement lost the cross-process idempotency race — returning the winner's receipt"
            );
            Ok(receipt)
        }
        _ => Err(err),
    }
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
        let sub = kasirmu_core::TenantSubscription::load(&db, "default")?
            .ok_or_else(|| AppError::Internal("default tenant subscription not found".into()))?;
        sub.verify_signature()?;
        sub.enforce_pos_writable()?;
    }

    // ── COR-7: replay guard + settlement under ONE lock ─────────────
    // This is the path the guard matters most on: the command rebuilds its
    // cart from the request body and carries a synthetic `resolved-<ts>`
    // cart id, so unlike `complete_sale_scoped` it has no cart to run out of
    // and would otherwise re-sell the same basket on every retry.
    //
    // The guard and the write share one lock span. Tablet `state.db` is a
    // `tokio::sync::Mutex` (state.rs:50), whose guard may be held across
    // `.await`, and the whole lookup→write segment below contains no await
    // point — the cart is rebuilt in memory from the request body — so one
    // `lock().await` covers the replay lookup through the settlement write
    // and a same-process double-tap serialises: the loser re-runs the guard
    // AFTER the winner committed and answers with the winner's receipt.
    // DRIFT NOTE (deliberate, not carelessness): the desktop shell cannot
    // hold its equivalent span — its store connection is a STD `Mutex` and
    // the plugin hooks + event publish sitting between its two lock regions
    // are `.await` points (crates/kasirmu-bridge/src/pos.rs:1740-1754), so the
    // desktop two-lock gap is still open for structural reasons and relies
    // on fail-closed settlement + the UNIQUE index instead.
    // `?` so a colon-bearing attempt id is refused before any key is stamped;
    // see `normalized_attempt_id` in pos/checkout.rs for why `:` is refused at all.
    let attempt = normalized_attempt_id(args.attempt_id.as_deref())?;
    let settlement = {
        let db = state.db.lock().await;
        let store = Store::new(&db);
        let mut effective_attempt_id = attempt.clone();
        match replay_verdict(&store, attempt.as_deref(), Some(&args.cart_id))? {
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
        settle_shortfall_resolved(
            &db,
            &session,
            &args,
            attempt.as_deref(),
            effective_attempt_id.as_deref(),
        )?
    };

    // A replay (guard or UNIQUE-index conversion) wrote nothing, so it must
    // publish nothing: the domain event already fired with the original
    // sale, and firing it twice would deduct stock and re-credit customer
    // spend for one payment.
    let Some(sale) = settlement.sale else {
        return Ok(settlement.result);
    };

    tracing::info!(sale_id = %sale.id, store_id = %session.store_id, "sale completed with resolved shortfalls");

    // ── Event publishing (no DB lock held) ────────────────────────
    {
        let kernel = state.kernel.lock().await;
        let bus = kernel.event_bus();
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

        if let Err(e) = bus.publish(&kasirmu_core::events::SaleCompleted {
            sale_id: sale.id.clone(),
            store_id: Some(session.store_id.clone()),
            line_items,
            total_minor: sale.total.minor_units,
            currency: String::from_utf8_lossy(&sale.currency.0).into_owned(),
            customer_id: args.customer_id.clone(),
        }) {
            tracing::warn!(sale_id = %sale.id, error = %e, "event bus publish failed");
        }
    }

    Ok(settlement.result)
}

// ── Hold Orders ──────────────────────────────────────────────────────

/// Park the current sale as a held order (scoped).
///
/// `bill_type` is checked against the caller's workspace type rather than
/// trusted: `open_bill` is a Restaurant POS concept, so any other terminal is
/// refused fail-closed. Mirrors `kasirmu_bridge::pos::hold_cart_scoped` — this shell
/// forked the body, so the check has to exist on both sides of the fork.
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
        kasirmu_core::permissions::SALES_PROCESS,
    )?;
    if args.bill_type == BILL_TYPE_OPEN_BILL && !is_restaurant_pos_workspace(&session) {
        return Err(AppError::PermissionDenied(format!(
            "workspace '{}' may not create an open bill; only '{}' may",
            session.type_key,
            kasirmu_core::workspace_type::RESTAURANT_POS
        )));
    }
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

/// List held carts in the session scope. ADR #7.
#[command]
pub async fn list_held_carts_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<kasirmu_core::db::HeldCartRow>, AppError> {
    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(
        &store,
        &session.user_id,
        kasirmu_core::permissions::SALES_PROCESS,
    )?;
    let carts = store.list_held_carts()?;
    drop(db);
    Ok(carts)
}

/// List open bills in the session scope. ADR #7.
///
/// Restaurant POS only — an open bill is that terminal's own concept, so a
/// session whose `type_key` is not [`kasirmu_core::workspace_type::RESTAURANT_POS`] is refused
/// rather than served an empty list, which would read as "there are none"
/// instead of "this is not your terminal". Mirrors
/// `kasirmu_bridge::pos::list_open_bills_scoped`; this shell forked the body, so the
/// check has to exist on both sides of the fork.
#[command]
pub async fn list_open_bills_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<kasirmu_core::db::HeldCartRow>, AppError> {
    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(
        &store,
        &session.user_id,
        kasirmu_core::permissions::SALES_PROCESS,
    )?;
    if !is_restaurant_pos_workspace(&session) {
        return Err(AppError::PermissionDenied(format!(
            "workspace '{}' may not list open bills; only '{}' may",
            session.type_key,
            kasirmu_core::workspace_type::RESTAURANT_POS
        )));
    }
    let carts = store.list_open_bills()?;
    drop(db);
    Ok(carts)
}

/// Resume a held cart in the session scope. ADR #7.
#[command]
pub async fn get_held_cart_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<kasirmu_core::db::HeldCartFull>, AppError> {
    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(
        &store,
        &session.user_id,
        kasirmu_core::permissions::SALES_PROCESS,
    )?;
    let cart = store.get_held_cart(&id)?;
    drop(db);
    Ok(cart)
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
        kasirmu_core::permissions::SALES_PROCESS,
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
